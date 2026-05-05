/**
 * V5 — side-band answer-text quality check for explanation handlers.
 *
 * Runs AFTER `validateToolCall()` succeeds for explanation handlers
 * (`explain_from_structure`, `explain_results`, `what_would_flip`). The
 * verdict is threaded into `HandlerInvocation.explanation`; the handler
 * decides whether to use Sonnet's `answer_text` or compose a deterministic
 * fallback.
 *
 * VALIDATION FAILURES NEVER SURFACE TO THE USER. The user always gets a
 * useful response — either Sonnet's text (when valid) or a deterministic
 * fallback composed from the context pack (when invalid or absent).
 *
 * Rules:
 *  1. answer_text present and non-empty
 *  2. answer_text.length >= 80 (too short to be a real explanation)
 *  3. Must NOT contain forbidden internal terms
 *  4. Must NOT contain mutation language (uses `containsMutationLanguage`)
 *  5. For explain_results / what_would_flip without a non-noop run_analysis
 *     fact: must NOT contain analysis language (probability, driver, etc.)
 *
 * Staleness caveat ordering used to be rule 6 (regex-based) but has been
 * superseded by deterministic prefixing in the handler — the handler's
 * `applyStalenessPrefix` helper prepends the caveat to whatever text the
 * answer-text path produced (Sonnet's or the deterministic fallback's).
 * That guarantees ordering by construction without needing a validator
 * rule that can disagree with Sonnet's freeform prose.
 *
 * Precondition bypass: when `explain_results` / `what_would_flip` has no
 * non-noop `run_analysis` fact, ALL answer-text validation is skipped — the
 * handler returns the existing "no analysis yet" template directly.
 *
 * Mutation/computation handlers (run_analysis, draft_graph, edit_graph)
 * are NOT this module's concern. They tolerate a stray `explanation`
 * payload silently; the turn-executor emits `v5_unexpected_explanation_payload`
 * telemetry and drops the field.
 */

import { containsMutationLanguage } from './mutation-language.js';
import { EXPLANATION_HANDLER_IDS, type ProposalExplanation } from './types.js';

const MIN_ANSWER_TEXT_LENGTH = 80;

// Word-boundary patterns: "fact" must match "fact" but NOT "factor"; "node"
// must match "node" but NOT "noted". The brief's intent is that user-facing
// answer text not leak internal machinery vocabulary; ordinary English words
// that contain these letters as substrings are fine.
//
// Identifier-style terms (snake_case, ALLCAPS, capitalised library names) are
// matched case-sensitively where their plain English use is rare to
// non-existent — `noop`, `fact_type`, `BUDGET_TARGET`, `graph_hash`, `Zod`.
// Egress-blocking these here means an LLM-generated answer containing them
// is marked invalid and downgraded to deterministic fallback BEFORE reaching
// the user. The narrate-output sanitiser remains as defence-in-depth on
// upstream orientation text, but this validator is the canonical user-facing
// egress guard.
const FORBIDDEN_INTERNAL_TERM_PATTERNS: readonly RegExp[] = [
  /\bhandlers?\b/i,
  /\bvalidators?\b/i,
  /\bnodes?\b/i,
  /\bedges?\b/i,
  /\bfacts?\b/i,
  /\bprojections?\b/i,
  /\banalysis_ready\b/i,
  /\bcontext pack\b/i,
  /\bnoop\b/i,
  /\bfact_type\b/i,
  /\bBUDGET_TARGET\b/,
  /\bgraph_hash\b/i,
  /\bZod\b/,
];

const ANALYSIS_LANGUAGE_TERMS: readonly string[] = [
  'probability',
  'driver',
  'sensitivity',
  'robustness',
  'margin',
  'leading option',
  'performs best',
];

const HANDLERS_REQUIRING_ANALYSIS_FACT: ReadonlySet<string> = new Set([
  'explain_results',
  'what_would_flip',
]);

/** Subset of HandlerFact the side-band validator needs. */
export interface SideBandPriorFact {
  readonly fact_type: string;
  readonly noop?: boolean;
}

export type ExplanationAnswerErrorReason =
  | 'missing'
  | 'too_short'
  | 'forbidden_internal_term'
  | 'mutation_language_detected'
  | 'analysis_language_without_analysis_fact'
  | 'raw_decimal_coefficient';

/**
 * Raw-decimal egress guard. The brief lists "long raw decimals" and "raw
 * sensitivity coefficients" as forbidden user-facing output.
 *
 * Two-rule guard, calibrated for sensible precision:
 *
 *  1. ANY decimal with 3+ fractional digits (e.g. `0.7346938775510203`,
 *     `-0.123` followed by anything) is rejected, regardless of unit
 *     marker. Probabilities and percentage points have known sensible
 *     precision (0–1 dp); 3+ fractional digits is false precision even
 *     with a "%" suffix.
 *
 *  2. Decimals with EXACTLY 2 fractional digits AND a unit marker are
 *     also rejected (e.g. `62.34%`, `5.67 percentage points`). Margins
 *     and probabilities should round to integer or 1 dp; 2-dp is
 *     misleading false precision in this domain.
 *
 *  3. Decimals with 1 fractional digit + unit marker pass (e.g.
 *     `62.3%` is acceptable rounding precision).
 *
 *  4. Plain integers + unit markers pass.
 *
 * Tested directly against the brief's evidence value
 * `-0.7346938775510203`, the previously-permissive case `62.345%`,
 * the unit-bolted case `0.7346938775510203 percent`, and positive
 * cases (1-dp percentages, integer percentages, percentage points).
 */
const UNIT_MARKER = '\\s*(?:%|pp\\b|percent|percentage)';
// Rule 1: 3+ fractional digits, regardless of unit marker.
const RAW_DECIMAL_LONG_FRACTIONAL = /-?\d+\.\d{3,}/i;
// Rule 2: exactly 2 fractional digits followed by a unit marker (false precision).
const RAW_DECIMAL_TWO_DP_WITH_UNIT = new RegExp(
  `-?\\d+\\.\\d{2}(?!\\d)${UNIT_MARKER}`,
  'i',
);
function answerHasRawDecimal(answerText: string): boolean {
  if (RAW_DECIMAL_LONG_FRACTIONAL.test(answerText)) return true;
  if (RAW_DECIMAL_TWO_DP_WITH_UNIT.test(answerText)) return true;
  return false;
}

export interface ExplanationAnswerVerdict {
  /**
   * When true, this turn hits a precondition path the handler will resolve
   * deterministically (e.g. explain_results with no analysis fact). The
   * caller MUST NOT attach an `explanation` payload to the invocation —
   * the handler renders its existing template unchanged.
   */
  readonly skip: boolean;
  /**
   * The payload to thread into HandlerInvocation when `skip === false`.
   * `answer_text_valid` tells the handler whether to use `answer_text` or
   * compose a deterministic fallback.
   */
  readonly payload?: {
    readonly answer_text: string;
    readonly answer_text_valid: boolean;
    readonly answer_validation_error?: ExplanationAnswerErrorReason;
    readonly evidence_used?: readonly string[];
    readonly cited_fields?: readonly string[];
  };
}

/**
 * Run the side-band check. Pure function; never throws; returns a verdict.
 *
 * @param handlerId The proposal's handler_id. Non-explanation handlers get a
 *   `skip: true` verdict (caller should not attach `explanation`).
 * @param explanation The Sonnet-supplied explanation payload, if present.
 * @param priorFacts The conversation's prior handler facts. Used to detect
 *   the precondition bypass for `explain_results` / `what_would_flip`.
 */
export function validateExplanationAnswer(
  handlerId: string,
  explanation: ProposalExplanation | undefined,
  priorFacts: readonly SideBandPriorFact[],
): ExplanationAnswerVerdict {
  // Non-explanation handler: nothing to do here. Caller will not attach
  // explanation to the invocation; mutation handlers' stray fields are
  // dropped at the turn-executor layer with telemetry.
  if (!EXPLANATION_HANDLER_IDS.has(handlerId)) {
    return { skip: true };
  }

  // Precondition bypass: explain_results / what_would_flip with no non-noop
  // run_analysis fact in priorFacts. The handler's existing path renders the
  // "no analysis yet" template; skip ALL answer-text validation.
  const requiresAnalysis = HANDLERS_REQUIRING_ANALYSIS_FACT.has(handlerId);
  const hasAnalysisFact = priorFacts.some(
    (f) => f.fact_type === 'run_analysis' && f.noop !== true,
  );
  if (requiresAnalysis && !hasAnalysisFact) {
    return { skip: true };
  }

  const answerText = explanation?.answer_text ?? '';

  // Rule 1: present and non-empty.
  if (!explanation || answerText.trim().length === 0) {
    return {
      skip: false,
      payload: {
        answer_text: '',
        answer_text_valid: false,
        answer_validation_error: 'missing',
        evidence_used: explanation?.evidence_used,
        cited_fields: explanation?.cited_fields,
      },
    };
  }

  // Rule 2: minimum length.
  if (answerText.length < MIN_ANSWER_TEXT_LENGTH) {
    return invalid(answerText, explanation, 'too_short');
  }

  // Rule 4: mutation language. Checked BEFORE forbidden internal terms so
  // the canonical "Proposing to add a competitive response risk factor"
  // failure surfaces as 'mutation_language_detected' rather than getting
  // shadowed by the word "factor" being misclassified. Mutation language
  // is the more specific, more actionable signal.
  if (containsMutationLanguage(answerText)) {
    return invalid(answerText, explanation, 'mutation_language_detected');
  }

  // Rule 3: forbidden internal terms (word-boundary matched so "factor"
  // does not falsely match "fact").
  if (FORBIDDEN_INTERNAL_TERM_PATTERNS.some((pat) => pat.test(answerText))) {
    return invalid(answerText, explanation, 'forbidden_internal_term');
  }

  // Rule 6: raw decimal coefficient + false-precision percentage.
  // See `answerHasRawDecimal` docstring for the two-rule guard.
  if (answerHasRawDecimal(answerText)) {
    return invalid(answerText, explanation, 'raw_decimal_coefficient');
  }

  // Rule 5: analysis language without an analysis fact (only meaningful for
  // explain_results / what_would_flip — but those hit the precondition
  // bypass above when no analysis fact exists, so this branch is defensive
  // in case the handler set or precondition logic changes later).
  if (requiresAnalysis && !hasAnalysisFact) {
    const lower = answerText.toLowerCase();
    if (ANALYSIS_LANGUAGE_TERMS.some((term) => lower.includes(term))) {
      return invalid(answerText, explanation, 'analysis_language_without_analysis_fact');
    }
  }

  return {
    skip: false,
    payload: {
      answer_text: answerText,
      answer_text_valid: true,
      evidence_used: explanation.evidence_used,
      cited_fields: explanation.cited_fields,
    },
  };
}

function invalid(
  answerText: string,
  explanation: ProposalExplanation,
  reason: ExplanationAnswerErrorReason,
): ExplanationAnswerVerdict {
  return {
    skip: false,
    payload: {
      answer_text: answerText,
      answer_text_valid: false,
      answer_validation_error: reason,
      evidence_used: explanation.evidence_used,
      cited_fields: explanation.cited_fields,
    },
  };
}
