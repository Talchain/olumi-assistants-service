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
 * The judge's verdict — and, for the fourth member, the ABSENCE of one.
 *
 * ⛔ REJECT-ONLY BY CONSTRUCTION. There is no field here through which the
 * judge could contribute a factor, an edge, a label or any other content. It
 * may say "this does not cover the brief" and name CODED grounds; it may not
 * say what is missing. An enriching pass invents causal authority the user
 * never asserted, and this estate has already refused one such patch. Every
 * member below is a bare kind plus a fixed enum: no string field exists at any
 * arity, so adding `not_assessed` did not open a channel.
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
  | { readonly kind: 'unavailable'; readonly reason: JudgeUnavailableReason }
  /**
   * ⭐ THE JUDGE WAS NEVER ASKED — a different fact from every other member, and
   * it used to be spelled `adequate`.
   *
   * Three arms return without calling the judge: an un-nominated draft, a draft
   * that IS attempt 2, and a draft the remaining budget could not act on. All
   * three recorded `adequate`, so "assessed against the brief and found fine"
   * and "never assessed at all" were the same wire byte — and the impoverished
   * RATE, the headline number this pass exists to produce, was diluted by an
   * unjudged population it could not exclude.
   *
   * ⛔ THE JUDGE MAY NEVER RETURN THIS. `coerceVerdict` (index.ts) refuses it on
   * the way in, so the only authority that can say "not assessed" is the code
   * that did not ask. Without that refusal the fix would open the hole it
   * closes: a model able to mark itself unassessed could leave the judged
   * population at will.
   */
  | { readonly kind: 'not_assessed'; readonly reason: NotAssessedReason };

export type JudgeUnavailableReason =
  | 'timeout'
  | 'llm_error'
  | 'parse_failed'
  | 'prompt_unavailable'
  | 'model_not_resolved'
  | 'graph_unreadable'
  | 'brief_unavailable'
  | 'insufficient_headroom';

/** Why the judge was never called on a draft. Coded, exhaustive, always
 *  emitted alongside the coverage facts, so an unjudged draft is still
 *  measured — it is simply not counted as judged. */
export type NotAssessedReason =
  /** The pre-filter did not nominate this draft. */
  | 'not_nominated'
  /** The remaining request budget cannot fund a fresh draw, so an answer could
   *  not be acted on and buying one is pure cost. */
  | 'budget_unaffordable'
  /** This draft IS attempt 2 — a quality redraw or an enforcement retry. One
   *  further draw is structurally impossible, so there is nothing to decide.
   *  `attempt_source` on the telemetry row says WHICH kind of attempt 2. */
  | 'redraw_already_spent';

/**
 * Why no redraw happened. Coded, exhaustive, always emitted.
 *
 * ⚠ DERIVED FROM `NotAssessedReason`, NOT RE-LISTED. These two enums overlapped
 * by three members when both were hand-written, which is the mirror defect
 * (trap 12) waiting to happen: a new not-assessed reason would have needed
 * remembering in two places, and the compiler would not have said so.
 */
export type NoRedrawReason =
  | NotAssessedReason
  /** The judge read the brief and said the model covers it. */
  | 'judged_adequate'
  /** The judge could not answer; the draft ships unchanged (fail open). */
  | 'judge_unavailable';

/**
 * WHICH DRAW this assessment is about — the population discriminator.
 *
 * `is_redraw` alone conflated two populations that need reading apart: a
 * quality redraw (attempt 1 succeeded and was judged thin) and an enforcement
 * retry (attempt 1 FAILED a validator). A drafter whose enforcement retries are
 * getting thinner is a different diagnosis from one whose quality redraws are,
 * and a metric that cannot separate them cannot answer the question it exists
 * for.
 */
export type DraftAttemptSource = 'first' | 'quality_redraw' | 'enforcement_retry';

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

/**
 * ⭐⭐ THE INSPECTION RECORD — the discarded draw, carried to the PRODUCT
 * BOUNDARY rather than left inside the pipeline.
 *
 * ## Why this type exists at all
 *
 * The owner's ruling is that a repair pass which silently hides bad drafts
 * destroys the only signal we have about draft quality. The pass attaches this
 * record to `body.trace.pipeline.draft_quality`; the projection in
 * `orchestrator/tools/draft-graph.ts` lifts it onto `DraftGraphResult`, and
 * `buildV5DiagnosticTrace` puts it on the V5 trace the route ships. Before that
 * chain existed the record died at the return literal of `handleDraftGraph` —
 * the same construct that file's own comment calls the "THIRD SILENT-DROP
 * POINT", closed there for refusals and reopened here.
 *
 * ONE definition, read by every hop, so producer and consumer cannot drift into
 * disagreeing about the shape (trap 12 — derive, do not mirror).
 *
 * ## Where it may travel, and where it may NOT
 *
 * ⚠ `discarded_graph` carries user-derived LABELS. It therefore rides the
 * flag-gated diagnostic trace (`CEE_DIAGNOSTIC_TRACE_ENABLED`, checked at the
 * top of `buildV5DiagnosticTrace`) and NEVER telemetry, which is codes and
 * counts only. That split is the same one `judge.ts` draws between the user
 * message and the system directive, and conflating them is how a content
 * channel gets opened by a well-meaning refactor.
 */
export interface DraftQualityTraceRecord {
  readonly redraw_spent: true;
  readonly shipped: 'first' | 'second';
  readonly improved: boolean;
  /**
   * Why the second draw did or did not win. Distinguishes "the drafter could
   * not do better" from "the drafter produced something richer we would not
   * vouch for" — opposite diagnoses that must never share a code.
   */
  readonly second_outcome: RedrawOutcome;
  readonly first_coverage: DraftCoverageFacts | null;
  readonly second_coverage: DraftCoverageFacts | null;
  /** The judge's verdict on the SECOND draw. `null` when there was no second
   *  graph to judge (the redraw failed outright). */
  readonly second_verdict: DraftQualityVerdict | null;
  /** ⭐ The rejected draw, kept whole. `null` only when the redraw produced no
   *  shippable graph at all. This is the field the requirement is about. */
  readonly discarded_graph: unknown;
}

/**
 * Coded outcome of the second draw.
 *
 * ⚠ `richer` is a CONJUNCTION and reading it as either half alone is an
 * over-read: the second draw covers more causal dimensions than the first AND
 * the judge cleared it against the brief. `richer_but_not_cleared` is the arm
 * where the structure improved and the semantics could not be vouched for —
 * the fabricated-redraw signature, and the reason it is not folded into
 * `not_richer`.
 */
export type RedrawOutcome =
  | 'richer'
  | 'not_richer'
  | 'richer_but_not_cleared'
  | 'draft_failed';
