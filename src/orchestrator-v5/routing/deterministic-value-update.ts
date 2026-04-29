/**
 * V5 explain-stabilisation Task 4 — deterministic pre-route for value
 * updates. Inserted into TurnExecutor's lifecycle BEFORE `routeWithToolUse`
 * (the LLM call), to catch obvious value-update phrasings that prompt
 * tuning has not been able to route reliably.
 *
 * SCOPE DEVIATION FROM ORIGINAL BRIEF (Paul, 2026-04-29, AskUserQuestion):
 * The original brief specified an exact-match → `edit_graph` dispatch
 * path. Paul chose "Always go to clarify (defer exact match)" because
 * `edit_graph` is a system-layer dispatch at route-v2.ts requiring a
 * FastifyRequest, which is not available inside `runTurnExecutor`.
 * Wiring it cleanly from the turn-executor would require a separate
 * architectural decision. The exact-match branch is therefore deferred to
 * a follow-up brief. This pre-route's only output is a clarify dispatch —
 * the user picks the intended factor from up to four chips, and the next
 * turn (after the chip click) carries the disambiguated phrasing into
 * Sonnet's normal routing path.
 *
 * Detection (all conditions must hold):
 *   1. message contains an edit verb (`increase|decrease|reduce|raise|
 *      lower|set|change|update|make|adjust`, word-boundary, case-insensitive)
 *   2. CQE extracted at least one numeric value (we do NOT regex-parse
 *      the message for numbers — F.6: code computes, LLM doesn't; CQE is
 *      the canonical extractor)
 *   3. graphLookup is available (no graph → no factor labels to match)
 *   4. message does NOT contain a hypothetical phrase (`what if`, `what
 *      would`, `how would`, `would it`, `if we`, `if I`, `suppose`,
 *      `imagine`, `\btest\b`, `scenario`) — those phrasings should reach
 *      the LLM so Sonnet can frame the right exploratory response.
 *
 * Label matching (substring first, Dice as fallback):
 *   - Pass 1: substring match (case-insensitive, trimmed) — deterministic
 *     and reliable for "Set <Factor Label> to <value>" prompts.
 *   - Pass 2: bigramDice on candidates that did not substring-match,
 *     threshold 0.4. Whole-message-vs-label, mirroring the entity
 *     resolver's existing path.
 *
 * Outcome:
 *   - At least one candidate qualifies → `dispatch: 'clarify'` with up to
 *     four candidates sorted by score (substring matches first).
 *   - No candidate qualifies → `{ matched: false }` (LLM falls through).
 */

import type { QuantityExtractionResult } from '../context/cqe/schema-types.js';
import type { GraphLookup } from './validator.js';
import { bigramDice } from './validator.js';

const EDIT_VERB_PATTERN =
  /\b(increase|decrease|reduce|raise|lower|set|change|update|make|adjust)\b/i;

// Case-insensitive substring matches; some are anchored on word boundary
// so "fastest" doesn't trigger `\btest\b` and "iframe" doesn't trigger
// `imagine`. Multi-word phrases are unambiguous as substring matches.
const HYPOTHETICAL_PATTERNS: readonly RegExp[] = [
  /\bwhat if\b/i,
  /\bwhat would\b/i,
  /\bhow would\b/i,
  /\bwould it\b/i,
  /\bif we\b/i,
  /\bif i\b/i,
  /\bsuppose\b/i,
  /\bimagine\b/i,
  /\btest\b/i,
  /\bscenario\b/i,
];

/** Minimum bigramDice score to qualify as a fuzzy candidate. */
const DICE_FLOOR = 0.4;

/** Maximum number of clarify candidates to surface. */
export const MAX_CANDIDATES = 4;

/**
 * How a candidate was selected — useful for routing diagnostics. `score: 0`
 * alone is too implicit for telemetry, so each candidate carries an explicit
 * source tag.
 */
export type CandidateSource = 'substring' | 'dice';

export interface ValueUpdateCandidate {
  readonly id: string;
  readonly label: string;
  readonly score: number;
  readonly source: CandidateSource;
}

export type ValueUpdateDispatch =
  | { readonly matched: false; readonly skip_reason: SkipReason }
  | {
      readonly matched: true;
      readonly dispatch: 'clarify';
      readonly candidates: readonly ValueUpdateCandidate[];
      readonly quantity: QuantityExtractionResult;
    };

export type SkipReason =
  | 'no_edit_verb'
  | 'no_quantity'
  | 'no_graph'
  | 'hypothetical_gate'
  | 'no_candidate_match';

export function tryDeterministicValueUpdate(
  message: string,
  parsedQuantities: readonly QuantityExtractionResult[],
  graphLookup: GraphLookup | undefined,
): ValueUpdateDispatch {
  if (!EDIT_VERB_PATTERN.test(message)) {
    return { matched: false, skip_reason: 'no_edit_verb' };
  }

  // F.6: code computes, LLM doesn't. CQE is the canonical numeric
  // extractor — if it found nothing, fall through to the LLM rather than
  // re-running a regex here.
  const quantity = parsedQuantities.find((q) => q.value !== null);
  if (!quantity) {
    return { matched: false, skip_reason: 'no_quantity' };
  }

  if (graphLookup === undefined) {
    return { matched: false, skip_reason: 'no_graph' };
  }

  // Negative gate: hypothetical phrasings should reach the LLM. The
  // pre-route is for explicit value updates, not exploratory scenarios.
  for (const pat of HYPOTHETICAL_PATTERNS) {
    if (pat.test(message)) {
      return { matched: false, skip_reason: 'hypothetical_gate' };
    }
  }

  // Candidate pool: GraphLookup buckets factor / outcome / decision / risk
  // / action node kinds together under EntityKind 'node' (per
  // graph-lookup-adapter.ts:toEntityKind). The interface cannot
  // disambiguate factor from outcome/risk inside the 'node' bucket.
  // Substring/Dice matches on this pool may surface non-factor candidates
  // (e.g. an outcome whose label happens to substring-match the user's
  // text). We accept this: the chip click on the next turn carries a
  // disambiguated phrasing into Sonnet's normal routing path, where the
  // validator catches kind-mismatched proposals via the recoverable
  // path. Tightening this would require widening GraphLookup to expose
  // 'factor' separately — deferred (would touch the validator surface).
  const candidatesPool = graphLookup.listEntitiesByKind('node');
  if (candidatesPool.length === 0) {
    return { matched: false, skip_reason: 'no_candidate_match' };
  }

  const normMessage = message.trim().toLowerCase();
  const substringMatches: ValueUpdateCandidate[] = [];
  const remaining: Array<{ id: string; label: string | null }> = [];

  for (const f of candidatesPool) {
    if (f.label == null) {
      // No label means we cannot anchor a substring or Dice match on this
      // candidate — drop it from consideration.
      continue;
    }
    const normLabel = f.label.trim().toLowerCase();
    if (normLabel.length === 0) continue;
    if (normMessage.includes(normLabel)) {
      substringMatches.push({ id: f.id, label: f.label, score: 1, source: 'substring' });
    } else {
      remaining.push(f);
    }
  }

  const diceMatches: ValueUpdateCandidate[] = [];
  for (const f of remaining) {
    if (f.label == null) continue;
    const score = bigramDice(message, f.label);
    if (score >= DICE_FLOOR) {
      diceMatches.push({ id: f.id, label: f.label, score, source: 'dice' });
    }
  }
  diceMatches.sort((a, b) => b.score - a.score);

  const matched = [...substringMatches, ...diceMatches].slice(0, MAX_CANDIDATES);
  if (matched.length === 0) {
    // Brief contract: "All candidates < 0.4 → { matched: false } (LLM
    // falls through)". Pure semantic-synonym mismatches like "budget" →
    // "Hiring and Staffing Cost" (bigramDice ~0.04, no shared lexical
    // material) land here. KNOWN RESIDUAL RISK: Test G's exact
    // "Increase the budget to £300k" prompt against a graph with no
    // budget-keyworded label still falls through to the LLM, which has
    // been observed to misroute. A robust fix needs either a curated
    // synonym layer or LLM understanding — deferred.
    return { matched: false, skip_reason: 'no_candidate_match' };
  }

  return {
    matched: true,
    dispatch: 'clarify',
    candidates: matched,
    quantity,
  };
}

/**
 * Build the user-visible clarify prose. Kept here (not in compose) because
 * the wording is specific to this pre-route and the helper has zero deps
 * on the wider compose pipeline.
 */
export function buildClarifyAssistantText(
  candidates: readonly ValueUpdateCandidate[],
): string {
  if (candidates.length === 1) {
    const c = candidates[0];
    return `I wasn't sure which factor you meant. Did you mean ${c.label}?`;
  }
  return `I wasn't sure which factor you meant. Did you mean one of these?`;
}

/**
 * Build prompt-replay messages for each candidate chip, preserving the
 * user's original verb where possible.
 */
export function buildClarifyChipMessage(
  message: string,
  candidate: ValueUpdateCandidate,
  quantity: QuantityExtractionResult,
): string {
  const verbMatch = message.match(EDIT_VERB_PATTERN);
  const verb = verbMatch ? verbMatch[0].toLowerCase() : 'set';
  const valueText = quantity.raw_text || (quantity.value != null ? String(quantity.value) : '');
  if (valueText === '') {
    return `${capitalise(verb)} ${candidate.label}.`;
  }
  return `${capitalise(verb)} ${candidate.label} to ${valueText}.`;
}

function capitalise(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
