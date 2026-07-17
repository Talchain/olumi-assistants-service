/**
 * ROADMAP 1.77 (B1 neuro-symbolic experiment) — decompose the single
 * ~9.9k-token gpt-4.1 `decision_review` monolith into FOUR parallel haiku
 * calls, each owning one slice of the SAME output contract, composed
 * deterministically by code.
 *
 *   R1 HEADLINE     → narrative_summary, story_headlines, readiness_rationale
 *   R2 DRIVER       → evidence_enhancements, key_assumptions
 *   R3 FRAGILITY    → robustness_explanation, scenario_contexts, flip_thresholds, pre_mortem?
 *   R4 CALIBRATION  → bias_findings, decision_quality_prompts, framing_check?
 *
 * Contract (07-REVIEW mandatory revisions):
 *  - R1: a NEW composed-consistency check runs AFTER composition — the two
 *    reused production guards do not catch cross-fragment contradiction or
 *    number disagreement. On any FATAL inconsistency (a missing required
 *    field, story_headlines missing an option, the headline naming the wrong
 *    winner, an ungrounded number), we FALL BACK to the gpt-4.1 monolith. A
 *    self-contradictory review is never shipped.
 *  - R4: gated behind the dedicated CEE_DECISION_REVIEW_DECOMPOSE flag; the
 *    caller (`decision-review-enricher`) only routes here when the flag is on,
 *    so flag-off is byte-identical to today's monolith path.
 *  - R5: `invokeDecomposedDecisionReview` returns the IDENTICAL
 *    `DecisionReviewInvokeResult` shape the monolith returns, so every
 *    downstream consumer (`decision-review-enricher` sanitise/attach,
 *    `pick-decision-review`, `compose.ts` Phase-3 block rebuild) is unaffected.
 *  - R6: the ~4x/cost arithmetic is an ESTIMATE — this module books nothing;
 *    the harness A/B on the live haiku tier is the measurement of record.
 *
 * Cancellation contract (Codex r2 blocker 3): `options.signal` is forwarded
 * to all four sub-calls; a client abort cancels every in-flight request and
 * SUPPRESSES the monolith fallback (never bill a review nobody awaits). The
 * first fatal sub-call failure cancels its siblings. Fan-out + fallback share
 * ONE end-to-end deadline: the fallback gets the remaining budget, floored at
 * DECOMPOSE_FALLBACK_MIN_TIMEOUT_MS (disclosed via telemetry and provisioned
 * by the enricher's hard-abort budget).
 *
 * The module is import-safe: it never fires an LLM call at load time.
 */

import { chatWithAnthropic } from '../../adapters/llm/anthropic.js';
import { config } from '../../config/index.js';
import type { ModelResolution } from '../../adapters/llm/router.js';
import { extractJsonFromResponse } from '../../utils/json-extractor.js';
import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';

import {
  invokeDecisionReview,
  type DecisionReviewInvokeInput,
  type DecisionReviewInvokeResult,
  type InvokeDecisionReviewOptions,
} from './invoke.js';
import {
  performShapeCheck,
  type ReviewInputForGrounding,
} from './shape-check.js';
import {
  DECOMPOSE_R1_HEADLINE_PROMPT,
  DECOMPOSE_R2_DRIVER_PROMPT,
  DECOMPOSE_R3_FRAGILITY_PROMPT,
  DECOMPOSE_R4_CALIBRATION_PROMPT,
  DECOMPOSE_COMPOSITE_VERSION,
} from './decompose-prompts.js';

/**
 * Default model for the decomposed sub-calls: the haiku registry entry S4
 * established (models.ts:260). Overridable via CEE_MODEL_DECISION_REVIEW_HAIKU.
 * Mirrors the CEE_MODEL_SUMMARY resolution precedent (summariser.ts).
 */
export const DEFAULT_DECOMPOSE_MODEL = 'claude-haiku-4-5';

/** Resolve the decomposed sub-call model: env override, else the haiku default. */
export function resolveDecomposeModel(): string {
  const configured = config.cee.models.decision_review_haiku;
  return configured && configured.trim().length > 0 ? configured : DEFAULT_DECOMPOSE_MODEL;
}

/** Per-sub-call max tokens: operator knob (CEE_MAX_TOKENS_DECISION_REVIEW_HAIKU), else 1500. */
const DEFAULT_DECOMPOSE_MAX_TOKENS = 1500;
function resolveDecomposeMaxTokens(): number {
  const configured = config.cee.maxTokens.decision_review_haiku;
  return typeof configured === 'number' && configured > 0 ? configured : DEFAULT_DECOMPOSE_MAX_TOKENS;
}

/**
 * Minimum viable window for the monolith fallback (Codex r2 blocker 3 / #436).
 * The fan-out and the fallback share ONE end-to-end deadline
 * (`options.timeoutMs` from the moment the fan-out starts) — the fallback gets
 * what REMAINS of it, never a fresh full clock stacked on the time already
 * spent. But a fallback that inherits a near-exhausted budget is a guaranteed
 * second failure billed on top of the first, so it is floored at this value
 * (capped at the original budget for small budgets). When the floor engages
 * the shared deadline is knowingly exceeded by at most this amount — disclosed
 * per-event via `fallback_budget_floor_engaged`, and provisioned for by the
 * enricher's hard-abort budget (see `resolveDecisionReviewHardBudgetMs`).
 */
export const DECOMPOSE_FALLBACK_MIN_TIMEOUT_MS = 8_000;

/** Pure budget arithmetic for the monolith fallback — see the constant above. */
export function resolveDecomposeFallbackBudget(
  originalTimeoutMs: number,
  elapsedMs: number,
): { timeoutMs: number; floorEngaged: boolean } {
  const remainingMs = Math.max(0, originalTimeoutMs - elapsedMs);
  const floorMs = Math.min(DECOMPOSE_FALLBACK_MIN_TIMEOUT_MS, originalTimeoutMs);
  return { timeoutMs: Math.max(remainingMs, floorMs), floorEngaged: remainingMs < floorMs };
}

/** Light per-slice caps — each call gets a right-sized slice, never the monolith. */
const SLICE_MAX_OPTIONS = 20;
const SLICE_MAX_FACTORS = 8;
const SLICE_MAX_EDGES = 8;
const SLICE_MAX_FLIP = 8;
const SLICE_MAX_GAPS = 8;
const SLICE_MAX_CRITIQUES = 6;
const SLICE_MAX_BRIEF_CHARS = 1_600;

// ============================================================================
// Small defensive readers (local — decompose must not depend on the enricher)
// ============================================================================

function readRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
function readArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter((e): e is Record<string, unknown> => readRecord(e) !== null)
    : [];
}
function readNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function readStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function absElasticity(e: Record<string, unknown>): number {
  const n = readNum(e.elasticity);
  return n === null ? Number.NEGATIVE_INFINITY : Math.abs(n);
}

// ============================================================================
// Slice assembly — each call gets ONLY the state it owns
// ============================================================================

interface Slices {
  readonly r1: string;
  readonly r2: string;
  readonly r3: string;
  readonly r4: string;
}

/** Structural context the composer + consistency check need (not sent to the LLM). */
interface DecomposeContext {
  readonly optionIds: readonly string[];
  /**
   * Every option label the narrative could plausibly name (option_comparison
   * labels + winner + runner-up, case-insensitively deduped) — the corpus the
   * winner-semantics check matches lead sentences against.
   */
  readonly optionLabels: readonly string[];
  readonly winnerLabel: string;
  readonly evidenceGapFactorIds: ReadonlySet<string>;
  readonly fragileEdgeIds: ReadonlySet<string>;
  readonly flipFactorIds: ReadonlySet<string>;
  readonly reviewInput: ReviewInputForGrounding;
}

function briefSlice(brief: string): string {
  return brief.length <= SLICE_MAX_BRIEF_CHARS ? brief : brief.slice(0, SLICE_MAX_BRIEF_CHARS);
}

function block(tag: string, body: unknown): string {
  const json = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  return `<${tag}>\n${json}\n</${tag}>`;
}

/**
 * Build the four sub-call user messages + the structural context. Pure — no
 * network, deterministic given `input`.
 */
export function buildSlices(input: DecisionReviewInvokeInput): { slices: Slices; ctx: DecomposeContext } {
  const isl = input.isl_results;
  const dc = input.deterministic_coaching;

  const optionComparison = readArray(isl.option_comparison).slice(0, SLICE_MAX_OPTIONS);
  const factorSensitivity = [...readArray(isl.factor_sensitivity)]
    .sort((a, b) => absElasticity(b) - absElasticity(a))
    .slice(0, SLICE_MAX_FACTORS);
  const fragileEdges = readArray(isl.fragile_edges).slice(0, SLICE_MAX_EDGES);
  const robustness = readRecord(isl.robustness) ?? {};
  const evidenceGaps = readArray(dc.evidence_gaps).slice(0, SLICE_MAX_GAPS);
  const modelCritiques = readArray(dc.model_critiques).slice(0, SLICE_MAX_CRITIQUES);
  const flipData = Array.isArray(input.flip_threshold_data)
    ? [...input.flip_threshold_data].slice(0, SLICE_MAX_FLIP)
    : [];

  const readiness = readStr(dc.readiness) ?? 'unknown';
  const headlineType = readStr(dc.headline_type) ?? 'neutral';
  const margin = input._meta?.margin ?? null;

  const decisionContext = {
    winner: input.winner,
    runner_up: input.runner_up,
    margin,
  };

  const topFactor = factorSensitivity[0] ?? null;
  const topEdge = fragileEdges[0] ?? null;
  const driverHint = topFactor
    ? {
        factor_label: topFactor.factor_label ?? null,
        elasticity: readNum(topFactor.elasticity),
        confidence: readNum(topFactor.confidence),
      }
    : null;
  const stabilityHint = {
    recommendation_stability: readNum(robustness.recommendation_stability),
    overall_confidence: readNum(robustness.overall_confidence),
    top_fragile_edge: topEdge
      ? { from_label: topEdge.from_label ?? null, to_label: topEdge.to_label ?? null }
      : null,
  };

  // D-ask-1 (2.11 P0-1) — P1-2: scaffolded-placeholder disclosure block,
  // present in EVERY slice that narrates option numbers (all four — the
  // caveat governs the whole review). Empty array when the run scaffolded
  // nothing → byte-identical slices.
  const scaffoldBlocks =
    typeof input.scaffold_disclosure === 'string' && input.scaffold_disclosure.length > 0
      ? [block('SCAFFOLDED_OPTIONS', input.scaffold_disclosure)]
      : [];

  // R1 HEADLINE — verdict + per-option lines + readiness rationale.
  const r1 = [
    block('BRIEF', briefSlice(input.brief)),
    block('DECISION_CONTEXT', decisionContext),
    block('OPTION_COMPARISON', optionComparison),
    block('READINESS', { readiness, headline_type: headlineType }),
    block('DRIVER_HINT', driverHint),
    block('STABILITY_HINT', stabilityHint),
    ...scaffoldBlocks,
  ].join('\n\n');

  // R2 DRIVER — evidence enhancements + key assumptions.
  const r2 = [
    block('BRIEF', briefSlice(input.brief)),
    block('EVIDENCE_GAPS', evidenceGaps),
    block('FACTOR_SENSITIVITY', factorSensitivity),
    block('WINNER_LABEL', input.winner.label),
    ...scaffoldBlocks,
  ].join('\n\n');

  // R3 FRAGILITY — robustness + scenarios + flip thresholds + pre-mortem.
  const r3 = [
    block('DECISION_CONTEXT', { winner: input.winner, runner_up: input.runner_up }),
    block('ROBUSTNESS', {
      recommendation_stability: readNum(robustness.recommendation_stability),
      overall_confidence: readNum(robustness.overall_confidence),
      level: readStr(robustness.level),
    }),
    block('FRAGILE_EDGES', fragileEdges),
    block('FLIP_THRESHOLD_DATA', flipData),
    block('OPTION_COMPARISON', optionComparison),
    block('READINESS', { readiness, headline_type: headlineType }),
    ...scaffoldBlocks,
  ].join('\n\n');

  // R4 CALIBRATION — bias findings + decision-quality prompts + framing check.
  const r4 = [
    block('BRIEF', briefSlice(input.brief)),
    block('MODEL_CRITIQUES', modelCritiques),
    block('FACTOR_SENSITIVITY', factorSensitivity),
    block('CALIBRATION', {
      overall_confidence: readNum(robustness.overall_confidence),
      headline_type: headlineType,
      winner_win_probability: readNum(input.winner.win_probability),
      readiness,
      option_count: optionComparison.length,
    }),
    ...scaffoldBlocks,
  ].join('\n\n');

  // Structural context for composition + the consistency check.
  const optionIds = optionComparison
    .map((o) => readStr(o.option_id))
    .filter((s): s is string => s !== null);
  const optionLabelsByLower = new Map<string, string>();
  for (const label of [
    ...optionComparison.map((o) => readStr(o.option_label)),
    readStr(input.winner.label),
    input.runner_up ? readStr(input.runner_up.label) : null,
  ]) {
    if (label !== null && !optionLabelsByLower.has(label.toLowerCase())) {
      optionLabelsByLower.set(label.toLowerCase(), label);
    }
  }
  const optionLabels = [...optionLabelsByLower.values()];
  const evidenceGapFactorIds = new Set(
    evidenceGaps.map((g) => readStr(g.factor_id)).filter((s): s is string => s !== null),
  );
  const fragileEdgeIds = new Set(
    fragileEdges.map((e) => readStr(e.edge_id)).filter((s): s is string => s !== null),
  );
  const flipFactorIds = new Set(
    flipData
      .map((f) => readStr((f as Record<string, unknown>).factor_id))
      .filter((s): s is string => s !== null),
  );

  // The grounding validator reads every field defensively; we build its input
  // with explicit typed literals (no cast) so the number-grounding corpus is
  // assembled from exactly the numeric fields the validator scans. Arrays keep
  // their remaining keys via a spread — object literals are assignable to the
  // validator's indexed element types without a boundary cast.
  const reviewInput: ReviewInputForGrounding = {
    winner: {
      win_probability: readNum(input.winner.win_probability) ?? undefined,
      outcome_mean: readNum(input.winner.outcome_mean) ?? undefined,
      label: input.winner.label,
    },
    runner_up: input.runner_up
      ? {
          win_probability: readNum(input.runner_up.win_probability) ?? undefined,
          outcome_mean: readNum(input.runner_up.outcome_mean) ?? undefined,
          label: input.runner_up.label,
        }
      : null,
    isl_results: {
      option_comparison: optionComparison.map((o) => {
        const outcome = readRecord(o.outcome);
        return {
          ...o,
          win_probability: readNum(o.win_probability) ?? undefined,
          outcome: {
            mean: readNum(outcome?.mean) ?? undefined,
            p10: readNum(outcome?.p10) ?? undefined,
            p90: readNum(outcome?.p90) ?? undefined,
          },
          option_label: readStr(o.option_label) ?? undefined,
        };
      }),
      factor_sensitivity: factorSensitivity.map((f) => ({
        ...f,
        elasticity: readNum(f.elasticity) ?? undefined,
      })),
      fragile_edges: fragileEdges.map((e) => ({
        ...e,
        switch_probability: readNum(e.switch_probability) ?? undefined,
        marginal_switch_probability: readNum(e.marginal_switch_probability) ?? undefined,
      })),
      robustness: {
        ...robustness,
        recommendation_stability: readNum(robustness.recommendation_stability) ?? undefined,
        overall_confidence: readNum(robustness.overall_confidence) ?? undefined,
      },
    },
    flip_threshold_data: flipData.map((f) => {
      const r = f as Record<string, unknown>;
      return {
        ...r,
        current_value: readNum(r.current_value) ?? undefined,
        flip_value: readNum(r.flip_value),
      };
    }),
    margin,
  };

  return {
    slices: { r1, r2, r3, r4 },
    ctx: {
      optionIds,
      optionLabels,
      winnerLabel: input.winner.label,
      evidenceGapFactorIds,
      fragileEdgeIds,
      flipFactorIds,
      reviewInput,
    },
  };
}

// ============================================================================
// Composition — assemble the four fragments into one review object
// ============================================================================

/** One parsed sub-call fragment plus its call metadata. */
interface Fragment {
  readonly json: Record<string, unknown> | null;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

const EMPTY_FRAGMENT: Fragment = { json: null, latencyMs: 0, inputTokens: 0, outputTokens: 0 };

/**
 * Deterministically assemble the four fragments into a single review object
 * matching the monolith's output contract. Each fragment contributes ONLY its
 * owned keys; a missing key degrades to that field's safe empty form so the
 * shape stays valid. Optional keys (scenario_contexts, flip_thresholds,
 * pre_mortem, framing_check) are only included when the owning fragment
 * supplied them.
 */
export function composeFragments(
  r1: Record<string, unknown> | null,
  r2: Record<string, unknown> | null,
  r3: Record<string, unknown> | null,
  r4: Record<string, unknown> | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  // R1 — required narrative + headlines + rationale.
  out.narrative_summary = typeof r1?.narrative_summary === 'string' ? r1.narrative_summary : '';
  out.story_headlines = readRecord(r1?.story_headlines) ?? {};
  out.readiness_rationale =
    typeof r1?.readiness_rationale === 'string' ? r1.readiness_rationale : '';

  // R2 — evidence enhancements + key assumptions.
  out.evidence_enhancements = readRecord(r2?.evidence_enhancements) ?? {};
  out.key_assumptions = Array.isArray(r2?.key_assumptions) ? r2.key_assumptions : [];

  // R3 — robustness (required) + optional scenarios / flips / pre-mortem.
  const rob = readRecord(r3?.robustness_explanation);
  out.robustness_explanation = rob ?? {
    summary: '',
    primary_risk: '',
    stability_factors: [],
    fragility_factors: [],
  };
  out.scenario_contexts = readRecord(r3?.scenario_contexts) ?? {};
  out.flip_thresholds = Array.isArray(r3?.flip_thresholds) ? r3.flip_thresholds : [];
  const preMortem = readRecord(r3?.pre_mortem);
  if (preMortem !== null) out.pre_mortem = preMortem;

  // R4 — bias findings + decision-quality prompts + optional framing check.
  out.bias_findings = Array.isArray(r4?.bias_findings) ? r4.bias_findings : [];
  out.decision_quality_prompts = Array.isArray(r4?.decision_quality_prompts)
    ? r4.decision_quality_prompts
    : [];
  const framing = readRecord(r4?.framing_check);
  if (framing !== null) out.framing_check = framing;

  return out;
}

// ============================================================================
// Composed-consistency check (07-REVIEW R1) — the NEW guard
// ============================================================================

/**
 * Win-cue for lead sentences — a sentence asserting some option is winning /
 * leading / recommended. Adapted from the conversation-harness PQ6 LEAD_VERB
 * plus the noun forms ("leader", "winner", "front-runner") a review narrative
 * uses where chat prose uses verbs.
 */
const WIN_CUE =
  /\b(ahead|lead(?:s|ing|er)?|front[- ]?runner|win(?:s|ner|ning)?|comes? out (?:ahead|on top)|out in front|strongest|recommend(?:ed)?|best (?:option|choice|bet)|top (?:choice|pick)|favou?red|preferred|should be chosen)\b/i;

/**
 * Negation of a win-claim ("Option B is NOT the leader") — a negated lead
 * sentence names a non-leader but AGREES with the analysis, so it must not
 * fire the wrong-winner fatal. Conservative on purpose (any negation cue
 * suppresses the check for that sentence) — same trade the harness PQ6(c)
 * fix made: a missed contradiction falls back to the presence check; a
 * false fatal would burn a monolith call on a coherent review.
 */
const WIN_NEGATION_CUE = /\b(?:not|never|unlikely|rather than|instead of|far from|unlike|no longer)\b|n['’]t\b/i;

/**
 * Disqualifiers that restrict the wrong-winner FATAL to OVERALL-crowning claims
 * (M5, Codex r2 pre-merge review). The bare WIN_CUE fired on legitimate
 * per-dimension / historical / attention sentences that merely MENTION the
 * runner-up alongside a win-cue verb — e.g. "Option B wins on cost.",
 * "We recommend validating Option B pricing assumptions", "Option B was ahead
 * in early estimates", "The strongest objection concerns Option B costs" — even
 * when Option A is correctly crowned overall elsewhere. Each spurious fatal
 * burns a paid monolith fallback on a coherent review (and poisons the B1 rerun
 * fallback<10% criterion). We prefer to UNDER-fire here (the presence check +
 * the shape/number-grounding checks remain the safety net); the true overall
 * crownings ("Option B is the better choice", "the clear leader … should be
 * chosen") carry none of these qualifiers and still fire.
 *
 *  - DIMENSION: a win-cue scoped to one dimension via a preposition + a BARE
 *    dimension noun ("wins on cost", "wins in cost", "ahead at speed") or an
 *    explicit dimensional phrase ("in terms of X") — a per-dimension win, not an
 *    overall verdict.
 *  - HISTORICAL: genuine past-tense framing ("was ahead", "initially",
 *    "previously") — describes a prior state, not the current crowning.
 *  - ATTENTION: the sentence is about scrutinising / validating / objecting to
 *    an option ("recommend validating", "the strongest objection", "assumptions"),
 *    not crowning it.
 *
 * REGEX BRITTLENESS (known limitation): this is a heuristic on a heuristic. It is
 * inherently a trade-off — narrowing to stop over-suppression can re-open the
 * false-positive class and vice-versa. We accept residual imprecision at the
 * margins and err toward FIRING the FATAL (the gpt-4.1 monolith fallback is the
 * safety net for a spurious fatal; a MISSED wrong-winner is caught by the
 * presence + shape/number-grounding checks). Do not chase completeness here.
 *
 * Round-3/4 review MAJOR-2/B — narrowing history to stop over-suppressing
 * present-tense crownings, and re-adding in/at to DIMENSION with a noun gate:
 *  - HISTORICAL dropped `estimates`/`estimated`/`early` AND `has been` (4 tokens;
 *    the round-3 note documented only the first three — recorded here). A
 *    decision review is built ON estimated values, so "the estimates favour
 *    Option B, which should be chosen" is a present-tense crowning, not history;
 *    "has been the leader … should be chosen" is likewise present-relevant.
 *    Genuine history ("was ahead in early estimates") is still caught by `was`.
 *  - DIMENSION re-adds `in`/`at` (round-3 dropping them re-opened "wins in cost"
 *    as a false FATAL) but ONLY before a BARE dimension noun: a negative
 *    lookahead excludes determiners / pronouns / temporals, so "wins in cost"
 *    (per-dimension → suppress) is distinguished from "leads in this decision" /
 *    "the better choice for us" (overall crowning → FIRE). `for` is deliberately
 *    NOT a dimensional preposition — it heads overall crownings far more often
 *    than dimensions.
 */
const DIMENSION_QUALIFIER_CUE =
  /\b(?:wins?|won|winning|ahead|leads?|leading|strongest|stronger|scores?|beats?|outperforms?|better)\b[^.!?]*?(?:\b(?:on|in|at)\s+(?!the\b|a\b|an\b|this\b|that\b|these\b|those\b|our\b|your\b|their\b|his\b|her\b|its\b|my\b|us\b|it\b|them\b|me\b|you\b|him\b|now\b|today\b|present\b|current\b)[a-z]|\bin terms of\b|\bwhen it comes to\b|\bwith respect to\b|\bregarding\b)/i;
const HISTORICAL_QUALIFIER_CUE =
  /\b(?:was|were|had been|used to|previously|initially|earlier|originally|formerly|at first)\b/i;
const ATTENTION_QUALIFIER_CUE =
  /\b(?:validat\w*|investigat\w*|assumptions?|objections?|concerns?|caveats?|scrutin\w*|audit\w*|re-?examin\w*|reservations?|doubts?|worries|weakness\w*)\b/i;

/** True when a win-cue sentence is a per-dimension / historical / attention
 *  claim rather than an OVERALL crowning of the named option. */
function isNonCrowningWinSentence(sentence: string): boolean {
  return (
    DIMENSION_QUALIFIER_CUE.test(sentence) ||
    HISTORICAL_QUALIFIER_CUE.test(sentence) ||
    ATTENTION_QUALIFIER_CUE.test(sentence)
  );
}

function sentenceList(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Labels the narrative claims as OVERALL LEADER that are NOT the authoritative
 * winner. Negation-aware; qualifier-aware (per-dimension / historical /
 * attention sentences are skipped — see {@link isNonCrowningWinSentence});
 * conservative single-name rule (a lead sentence naming zero or 2+ options is
 * skipped, never guessed at).
 */
function claimedNonWinnerLeaders(
  narrative: string,
  optionLabels: readonly string[],
  winnerLabel: string,
): string[] {
  if (winnerLabel.length === 0 || optionLabels.length < 2) return [];
  const wrong: string[] = [];
  for (const sentence of sentenceList(narrative)) {
    if (!WIN_CUE.test(sentence)) continue;
    if (WIN_NEGATION_CUE.test(sentence)) continue;
    // Only OVERALL crownings are wrong-winner candidates; a per-dimension /
    // historical / attention sentence that merely names the runner-up is not.
    if (isNonCrowningWinSentence(sentence)) continue;
    const lower = sentence.toLowerCase();
    const named = optionLabels.filter((l) => l.length > 2 && lower.includes(l.toLowerCase()));
    if (named.length === 1 && named[0]!.toLowerCase() !== winnerLabel.toLowerCase()) {
      wrong.push(named[0]!);
    }
  }
  return wrong;
}

export interface ConsistencyResult {
  /** False → the composer must fall back to the monolith. */
  readonly consistent: boolean;
  /** FATAL violations that force a monolith fallback. */
  readonly fatal: readonly string[];
  /** Repairable violations that were fixed in-place (dropped unknown keys etc). */
  readonly repaired: readonly string[];
  /** The composition with repairable issues fixed (safe to ship when consistent). */
  readonly output: Record<string, unknown>;
}

/**
 * The composed-level consistency check the two reused production guards do NOT
 * provide. It (a) repairs cross-fragment reference drift the monolith enforced
 * implicitly (story_headlines / evidence_enhancements / scenario_contexts /
 * flip_thresholds keys that don't exist in the payload), then (b) declares a
 * FATAL inconsistency — forcing a monolith fallback — when the composed whole
 * is self-contradictory or ungrounded:
 *   - a required field is missing / mis-shaped (via performShapeCheck),
 *   - story_headlines omits a real option (can't be safely fabricated),
 *   - the headline names the wrong winner (narrative omits winner.label),
 *   - any number in descriptive prose is ungrounded (UNGROUNDED_NUMBER).
 */
export function checkComposedConsistency(
  composed: Record<string, unknown>,
  ctx: DecomposeContext,
): ConsistencyResult {
  const fatal: string[] = [];
  const repaired: string[] = [];

  // Deep clone so repairs never mutate the caller's object.
  const out: Record<string, unknown> = JSON.parse(JSON.stringify(composed));

  // --- (a) Repairs: drop payload-orphan keys the monolith would never emit ---
  //
  // ALWAYS intersect with the authoritative ID set (Codex r2): an EMPTY
  // authoritative set means an EMPTY allowed set, never an open filter. The
  // previous size>0 guards skipped the intersection entirely when the payload
  // carried no gaps/edges/flips — precisely the envelopes where every
  // fragment-invented key is a fabrication.
  const storyHeadlines = readRecord(out.story_headlines);
  if (storyHeadlines) {
    for (const key of Object.keys(storyHeadlines)) {
      if (!ctx.optionIds.includes(key)) {
        delete storyHeadlines[key];
        repaired.push(`story_headlines dropped orphan option_id "${key}"`);
      }
    }
  }
  const evidence = readRecord(out.evidence_enhancements);
  if (evidence) {
    for (const key of Object.keys(evidence)) {
      if (!ctx.evidenceGapFactorIds.has(key)) {
        delete evidence[key];
        repaired.push(`evidence_enhancements dropped orphan factor_id "${key}"`);
      }
    }
  }
  const scenarios = readRecord(out.scenario_contexts);
  if (scenarios) {
    for (const key of Object.keys(scenarios)) {
      if (!ctx.fragileEdgeIds.has(key)) {
        delete scenarios[key];
        repaired.push(`scenario_contexts dropped orphan edge_id "${key}"`);
      }
    }
  }
  if (Array.isArray(out.flip_thresholds)) {
    const before = out.flip_thresholds.length;
    let flips = out.flip_thresholds.filter((f) => {
      const id = readStr(readRecord(f)?.factor_id);
      return id !== null && ctx.flipFactorIds.has(id);
    });
    if (flips.length !== before) {
      repaired.push(`flip_thresholds dropped ${before - flips.length} orphan factor_id entr(y/ies)`);
    }
    // shape-check rejects >2 flip_thresholds as an ERROR — cap before validating.
    if (flips.length > 2) {
      repaired.push(`flip_thresholds truncated from ${flips.length} to 2 (shape ceiling)`);
      flips = flips.slice(0, 2);
    }
    out.flip_thresholds = flips;
  }

  // --- (b) Fatal checks on the repaired object ---

  // Winner naming: story_headlines must cover every real option; the narrative
  // must actually name the winner (a headline that names the wrong option as
  // the leader is the canonical cross-fragment contradiction).
  const repairedHeadlines = readRecord(out.story_headlines) ?? {};
  for (const id of ctx.optionIds) {
    if (!(id in repairedHeadlines)) {
      fatal.push(`story_headlines missing option "${id}"`);
    }
  }
  const narrative = typeof out.narrative_summary === 'string' ? out.narrative_summary : '';
  if (ctx.winnerLabel.length > 0 && !narrative.toLowerCase().includes(ctx.winnerLabel.toLowerCase())) {
    fatal.push('narrative_summary does not name the winning option (possible wrong-winner headline)');
  }
  // Winner SEMANTICS (Codex r2): substring presence is not enough — a
  // narrative can name the winner in passing while its win-cue sentence
  // crowns a different option. Port of the harness PQ6(c) learnings:
  // match lead sentences (win-cue), skip negated ones ("B is NOT the
  // leader" is consistent), and flag only when a lead sentence names
  // exactly ONE option and it is not the authoritative winner
  // (conservative single-name rule — multi-name sentences like
  // "A leads B" are skipped rather than guessed at).
  for (const claimed of claimedNonWinnerLeaders(narrative, ctx.optionLabels, ctx.winnerLabel)) {
    fatal.push(
      `narrative_summary crowns "${claimed}" but the authoritative winner is "${ctx.winnerLabel}" (wrong-winner claim)`,
    );
  }

  // Shape + number grounding via the production validator. `valid=false` covers
  // every missing/mis-shaped required field; UNGROUNDED_NUMBER warnings are
  // promoted to FATAL for the composed path (in the monolith a single model
  // kept numbers coherent; across four calls an ungrounded number is a real
  // cross-fragment contradiction, not a soft warning).
  const shape = performShapeCheck(out, ctx.reviewInput);
  if (!shape.valid) {
    for (const e of shape.errors) fatal.push(`shape: ${e}`);
  }
  for (const w of shape.warnings) {
    if (w.startsWith('UNGROUNDED_NUMBER')) fatal.push(w);
  }

  return { consistent: fatal.length === 0, fatal, repaired, output: out };
}

// ============================================================================
// Orchestration — fan out, compose, check, ship-or-fall-back
// ============================================================================

async function invokeOneSlice(
  systemPrompt: string,
  userMessage: string,
  model: string,
  maxTokens: number,
  options: InvokeDecisionReviewOptions,
  signal: AbortSignal,
  onFatalFailure: () => void,
): Promise<Fragment> {
  try {
    const res = await chatWithAnthropic({
      system: systemPrompt,
      userMessage,
      model,
      temperature: 0,
      maxTokens,
      timeoutMs: options.timeoutMs,
      requestId: options.requestId,
      // Codex r2 blocker 3: the abort signal is forwarded to every sub-call —
      // a client abort (or a sibling-cancel) kills the in-flight HTTP request
      // instead of leaving four paid haiku calls running to completion.
      signal,
    });
    const extraction = extractJsonFromResponse(res.content, {
      task: 'decision_review',
      model: res.model,
      correlationId: options.requestId,
    });
    const json =
      extraction.json && typeof extraction.json === 'object' && !Array.isArray(extraction.json)
        ? (extraction.json as Record<string, unknown>)
        : null;
    if (json === null) {
      // An unparseable fragment already guarantees the monolith fallback
      // (succeeded < 4) — stop paying for the siblings immediately.
      onFatalFailure();
    }
    return {
      json,
      latencyMs: res.latencyMs,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    };
  } catch (err) {
    log.warn(
      { request_id: options.requestId, err: err instanceof Error ? err.message : String(err) },
      'decomposed decision_review sub-call failed',
    );
    // First fatal failure cancels the siblings (idempotent — a sibling that
    // was itself cancelled lands here too and the repeat abort is a no-op).
    onFatalFailure();
    return EMPTY_FRAGMENT;
  }
}

/**
 * Drop-in alternative to `invokeDecisionReview` (SAME result shape, R5). Fires
 * the four haiku sub-calls in parallel, composes them, runs the composed-
 * consistency check, and either ships the composed review or FALLS BACK to the
 * gpt-4.1 monolith (07-REVIEW R1 — never ship a self-contradictory review).
 *
 * Fail-soft: an unparseable / failed fragment, or any fatal inconsistency,
 * routes straight to the monolith. The turn never fails.
 */
export async function invokeDecomposedDecisionReview(
  input: DecisionReviewInvokeInput,
  options: InvokeDecisionReviewOptions,
): Promise<DecisionReviewInvokeResult> {
  const model = resolveDecomposeModel();
  const maxTokens = resolveDecomposeMaxTokens();
  const { slices, ctx } = buildSlices(input);
  const startedAt = Date.now();

  // Client already gone before the fan-out: fire nothing, bill nothing.
  if (options.signal?.aborted) {
    emitAborted(options, 0, 0, 0, 0);
    throw new Error('decomposed decision_review aborted before fan-out (client abort)');
  }

  // ONE shared controller for the fan-out. It aborts on (a) the client's
  // signal — all four in-flight requests are cancelled together — or (b) the
  // first fatal sub-call failure, so a doomed fan-out never waits for (or
  // pays for) its stragglers before falling back.
  const fanout = new AbortController();
  const onClientAbort = () => fanout.abort();
  options.signal?.addEventListener('abort', onClientAbort, { once: true });
  const cancelSiblings = () => fanout.abort();

  const [f1, f2, f3, f4] = await Promise.all([
    invokeOneSlice(DECOMPOSE_R1_HEADLINE_PROMPT, slices.r1, model, maxTokens, options, fanout.signal, cancelSiblings),
    invokeOneSlice(DECOMPOSE_R2_DRIVER_PROMPT, slices.r2, model, maxTokens, options, fanout.signal, cancelSiblings),
    invokeOneSlice(DECOMPOSE_R3_FRAGILITY_PROMPT, slices.r3, model, maxTokens, options, fanout.signal, cancelSiblings),
    invokeOneSlice(DECOMPOSE_R4_CALIBRATION_PROMPT, slices.r4, model, maxTokens, options, fanout.signal, cancelSiblings),
  ]).finally(() => {
    options.signal?.removeEventListener('abort', onClientAbort);
  });

  const fragments = [f1, f2, f3, f4];
  const succeeded = fragments.filter((f) => f.json !== null).length;
  const wallMs = Date.now() - startedAt;
  const inputTokens = fragments.reduce((s, f) => s + f.inputTokens, 0);
  const outputTokens = fragments.reduce((s, f) => s + f.outputTokens, 0);

  // Client abort during the fan-out: the sub-calls were just cancelled;
  // launching the monolith now would bill a review nobody is waiting for.
  if (options.signal?.aborted) {
    emitAborted(options, succeeded, wallMs, inputTokens, outputTokens);
    throw new Error('decomposed decision_review aborted mid-fan-out (client abort); fallback suppressed');
  }

  // Any missing fragment → fall back. The A/B compares a COMPLETE decomposed
  // review against the monolith; a partial composition would poison the arm.
  if (succeeded < 4) {
    return fallBackToMonolith(input, options, {
      outcome: 'fell_back',
      fallback_reason: 'fragment_missing',
      fragments_succeeded: succeeded,
      violation_count: 0,
      wall_clock_ms: wallMs,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    });
  }

  const composed = composeFragments(f1.json, f2.json, f3.json, f4.json);
  const consistency = checkComposedConsistency(composed, ctx);

  if (!consistency.consistent) {
    return fallBackToMonolith(input, options, {
      outcome: 'fell_back',
      fallback_reason: 'inconsistent',
      fragments_succeeded: succeeded,
      violation_count: consistency.fatal.length,
      wall_clock_ms: wallMs,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      violations: consistency.fatal,
    });
  }

  emit(TelemetryEvents.V5DecisionReviewDecomposed, {
    request_id: options.requestId,
    outcome: 'composed',
    fallback_reason: null,
    fragments_succeeded: succeeded,
    violation_count: 0,
    repair_count: consistency.repaired.length,
    wall_clock_ms: wallMs,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  });

  const resolution: ModelResolution = {
    task: 'decision_review',
    resolved_model: model,
    resolution_source: 'env_var',
    provider: 'anthropic',
  };

  return {
    output: consistency.output,
    raw: JSON.stringify({ r1: f1.json, r2: f2.json, r3: f3.json, r4: f4.json }),
    model,
    provider: 'anthropic',
    llm_latency_ms: Math.max(f1.latencyMs, f2.latencyMs, f3.latencyMs, f4.latencyMs),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    prompt_version: DECOMPOSE_COMPOSITE_VERSION,
    resolution,
  };
}

interface DecomposedTelemetry {
  readonly outcome: 'composed' | 'fell_back';
  readonly fallback_reason: 'fragment_missing' | 'inconsistent' | null;
  readonly fragments_succeeded: number;
  readonly violation_count: number;
  readonly wall_clock_ms: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly violations?: readonly string[];
}

/** Client abort: no composed review, no fallback — disclose and stop. */
function emitAborted(
  options: InvokeDecisionReviewOptions,
  fragmentsSucceeded: number,
  wallMs: number,
  inputTokens: number,
  outputTokens: number,
): void {
  emit(TelemetryEvents.V5DecisionReviewDecomposed, {
    request_id: options.requestId,
    outcome: 'aborted',
    fallback_reason: 'client_abort',
    fragments_succeeded: fragmentsSucceeded,
    violation_count: 0,
    wall_clock_ms: wallMs,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  });
}

async function fallBackToMonolith(
  input: DecisionReviewInvokeInput,
  options: InvokeDecisionReviewOptions,
  tel: DecomposedTelemetry,
): Promise<DecisionReviewInvokeResult> {
  // ONE shared end-to-end deadline: the fallback gets what remains of the
  // budget the fan-out already spent from, floored at a disclosed minimum
  // viable window (Codex r2 blocker 3 / #436 — a near-exhausted inherited
  // budget made the fallback a guaranteed second failure).
  const budget = resolveDecomposeFallbackBudget(options.timeoutMs, tel.wall_clock_ms);
  emit(TelemetryEvents.V5DecisionReviewDecomposed, {
    request_id: options.requestId,
    outcome: tel.outcome,
    fallback_reason: tel.fallback_reason,
    fragments_succeeded: tel.fragments_succeeded,
    violation_count: tel.violation_count,
    wall_clock_ms: tel.wall_clock_ms,
    input_tokens: tel.input_tokens,
    output_tokens: tel.output_tokens,
    fallback_timeout_ms: budget.timeoutMs,
    fallback_budget_floor_engaged: budget.floorEngaged,
  });
  if (tel.violations && tel.violations.length > 0) {
    log.info(
      { request_id: options.requestId, violations: tel.violations.slice(0, 8) },
      'decomposed decision_review fell back to monolith on inconsistency',
    );
  }
  // The monolith honours `options.signal` and returns the canonical result shape.
  return invokeDecisionReview(input, { ...options, timeoutMs: budget.timeoutMs });
}
