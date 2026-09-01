/**
 * DRAFT-QUALITY PASS — shared types.
 *
 * ⭐ THE QUESTION THIS MODULE ANSWERS, stated once so it can never be confused
 * with the neighbouring one (trap 21):
 *
 *   `classifyRetryableDraftFailure` (draft-auto-retry.ts) answers
 *     "did this draft FAIL in a self-declared-stochastic way?"
 *   `assessDraftQuality` (this module) answers
 *     "did this draft SUCCEED and still produce a model that does not cover
 *      the causal dimensions the brief states?"
 *
 * They are DIFFERENT QUESTIONS with different defaults — the first fails
 * CLOSED (an invalid model is never shipped), the second fails OPEN (a
 * successful draft always ships). Aligning their defaults would be the wrong
 * fix. The wrapper consults them in sequence and each keeps its own answer.
 */

/**
 * Deterministic, LLM-free coverage facts derived from a drafted graph.
 *
 * ⛔ THESE ARE FACTS, NEVER A VERDICT. Nothing here decides whether a model is
 * good. They exist for two reasons and only two:
 *   1. as the CONTINUOUS DRAFT-QUALITY METRIC — emitted on every single draft,
 *      redraw or not, so "is the drafter getting better or worse?" stops
 *      costing a bespoke 16-draw experiment;
 *   2. as the cheap PRE-FILTER that decides whether the semantic judge is
 *      worth a call on this draft.
 *
 * ⛔ AND EXPLICITLY NOT A FACTOR-COUNT QUOTA. No field here is ever compared
 * against a minimum to reject a graph. `causal_waist <= 1` NOMINATES a draft
 * for semantic review; the judge — which has read the brief — is the only
 * authority that may call a model impoverished. A genuinely single-factor
 * decision is legal, is nominated, and is passed by the judge. That is the
 * control in `__tests__/draft-quality.single-factor-control.test.ts`, and it
 * was written before any judging logic existed.
 */
export interface DraftCoverageFacts {
  readonly option_count: number;
  readonly factor_count: number;
  readonly outcome_count: number;
  readonly risk_count: number;
  readonly goal_count: number;
  readonly edge_count: number;
  /**
   * The number of DISTINCT factor nodes that lie on at least one
   * option → … → goal path. This is the "waist" of the bowtie: the number of
   * causal dimensions through which the options can differ at all.
   *
   * The motivating failure (2026-09-01, funding brief) had option_count = 5
   * and causal_waist = 1 — five options distinguishable only by one number on
   * one shared node.
   */
  readonly causal_waist: number;
  /** Waist factors reachable from exactly ONE option. */
  readonly private_factor_count: number;
  /** Waist factors reachable from EVERY option. */
  readonly shared_factor_count: number;
  /** Longest option → … → goal chain, in edges. 0 when no option reaches goal. */
  readonly max_causal_depth: number;
}

/** Coded grounds the judge may return. Fixed enum — never free text, never
 *  user content. These ride telemetry and the system-authored retry directive,
 *  both of which are content-free by rule. */
export type ImpoverishmentGround =
  /** The brief states materially distinct causal dimensions the model collapses into one. */
  | 'collapsed_dimensions'
  /** Options named in the brief are absent, merged, or not represented as options. */
  | 'missing_options'
  /** Outcomes or goals the brief makes material are absent from the model. */
  | 'missing_outcomes'
  /** Risks or constraints the brief states explicitly are absent. */
  | 'missing_risks'
  /** The model's nodes do not correspond to what the brief is about. */
  | 'off_brief';

export const IMPOVERISHMENT_GROUNDS: readonly ImpoverishmentGround[] = [
  'collapsed_dimensions',
  'missing_options',
  'missing_outcomes',
  'missing_risks',
  'off_brief',
];

/**
 * The judge's verdict.
 *
 * ⛔ REJECT-ONLY BY CONSTRUCTION. There is no field here through which the
 * judge could contribute a factor, an edge, a label or any other content. It
 * may say "this does not cover the brief" and name CODED grounds; it may not
 * say what is missing. An enriching pass invents causal authority the user
 * never asserted, and this estate has already refused one such patch.
 */
export type DraftQualityVerdict =
  | { readonly kind: 'adequate' }
  | { readonly kind: 'impoverished'; readonly grounds: readonly ImpoverishmentGround[] }
  /**
   * FAIL OPEN. Every error, timeout, unparseable output, unconfigured model and
   * unprovisioned prompt lands here, and every one of them ships the draft
   * unchanged. The reason is CODED and always emitted — a fail-open that is
   * silent converts a measurable problem into an unmeasurable one, which is
   * strictly worse than the defect this pass exists to fix.
   */
  | { readonly kind: 'unavailable'; readonly reason: JudgeUnavailableReason };

export type JudgeUnavailableReason =
  | 'timeout'
  | 'llm_error'
  | 'parse_failed'
  | 'prompt_unavailable'
  | 'model_not_resolved'
  | 'graph_unreadable'
  | 'brief_unavailable'
  | 'insufficient_headroom';

/** Why no redraw happened. Coded, exhaustive, always emitted. */
export type NoRedrawReason =
  /** The pre-filter did not nominate this draft — the judge was never called. */
  | 'not_nominated'
  /** The judge read the brief and said the model covers it. */
  | 'judged_adequate'
  /** The judge could not answer; the draft ships unchanged (fail open). */
  | 'judge_unavailable'
  /** Impoverished, but the remaining request budget cannot fund a fresh draw. */
  | 'budget_unaffordable'
  /** Impoverished, but this attempt IS the redraw — one redraw, never a loop. */
  | 'redraw_already_spent';

/** The whole pass's outcome for ONE pipeline attempt. */
export interface DraftQualityAssessment {
  readonly coverage: DraftCoverageFacts | null;
  readonly nominated: boolean;
  readonly verdict: DraftQualityVerdict;
  /** Wall-clock cost of the judge call. 0 when the judge was not called. */
  readonly judgeLatencyMs: number;
  /** Tokens the judge consumed. null when the judge was not called or the
   *  adapter did not report usage. */
  readonly judgeTokens: { readonly in: number; readonly out: number } | null;
  readonly judgeModel: string | null;
}
