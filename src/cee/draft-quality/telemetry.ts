/**
 * ⭐⭐ DRAFT-QUALITY TELEMETRY — the continuous draft-quality metric.
 *
 * ## Why this is the most valuable half of the lane
 *
 * The estate currently cannot answer "is the drafter getting better or worse?"
 * without a bespoke multi-draw experiment — 16 manual draws every time the
 * question is asked. And a repair pass WITHOUT this measurement would make the
 * question permanently unanswerable, because every impoverished draft would be
 * silently absorbed by the redraw: we would trade a visible problem for an
 * invisible one, which is worse than the defect.
 *
 * So `cee.draft_graph.quality` is emitted on EVERY draft — nominated or not, judged
 * or not, redrawn or not, and on every fail-open arm. **Fail open must be
 * observable, not silent.** A draft that emits nothing is a bug in this file.
 *
 * ## The discipline, inherited verbatim from `cee/dual-draft/telemetry.ts`
 *
 * "no wire field, no coaching surface, no persisted-turn metadata. Free-text
 * proposal content is never emitted — counts, coded reasons and models only."
 * Every field below is an integer, a boolean, a fixed enum, or a model id.
 * There is no field through which a node label, an option name or any part of
 * the user's brief could reach a log line.
 *
 * ## Where it goes, stated honestly
 *
 * `emit` writes to stdout via pino (always) and to Datadog StatsD (only for
 * events with an explicit `case` in `telemetry.ts`'s switch — these have none,
 * so they are stdout/Render-log only today). There is NO Postgres telemetry
 * store in CEE. Building the quality metric therefore means a Render/Datadog
 * log query over `event = "cee.draft_graph.quality"`, subject to that retention.
 * That is a real limitation and it is named here rather than discovered later.
 */

import { emit, TelemetryEvents } from '../../utils/telemetry.js';
import type {
  DraftAttemptSource,
  DraftQualityAssessment,
  NoRedrawReason,
  RedrawOutcome,
} from './types.js';

export interface DraftQualityEventInput {
  readonly requestId: string;
  readonly scenarioId?: string | null;
  readonly turnId?: string | null;
  readonly assessment: DraftQualityAssessment;
  readonly noRedrawReason: NoRedrawReason | null;
  readonly retryBudgetMs: number | null;
  /**
   * WHICH DRAW this row is about. `is_redraw` is DERIVED from it below rather
   * than passed alongside, so the two can never disagree — a boolean and an
   * enum describing the same fact is a mirror waiting to drift.
   */
  readonly attemptSource: DraftAttemptSource;
  /** Milliseconds spent on the request when the assessment was taken. */
  readonly elapsedMs: number;
}

/**
 * ⭐ EMITTED ON EVERY DRAFT. One row per assessed draw — so a redrawn turn emits
 * TWO, discriminated by `is_redraw`.
 *
 * Reading the metric:
 *   · impoverished rate  = count(verdict="impoverished")
 *                          / count(verdict IN ("impoverished","adequate"))
 *     — over the JUDGED population only. ⭐ This denominator is now expressible:
 *     the three never-asked arms report `not_assessed` with a coded reason
 *     instead of `adequate`, so an unjudged draw can be excluded rather than
 *     silently counted as a pass.
 *   · nomination rate    = count(nominated=true) / count(*)
 *   · judge availability = 1 − count(verdict="unavailable") / count(judged)
 *   · ⚠ `causal_waist = 0` means one of two things and `goal_count`
 *     discriminates them: with no goal node the waist is undefined, not zero
 *     (see the goal precondition in `coverage.ts`). Filter on
 *     `goal_count >= 1` before reading any waist distribution.
 *   · structural trend   = the causal_waist / option_count / factor_count
 *     distributions over time — available on EVERY draft, including the ones
 *     nothing else in this pass touches. This is the free continuous metric.
 */
export function emitDraftQuality(input: DraftQualityEventInput): void {
  const { assessment: a } = input;
  emit(TelemetryEvents.CeeDraftQuality, {
    request_id: input.requestId,
    ...(input.scenarioId ? { scenario_id: input.scenarioId } : {}),
    ...(input.turnId ? { turn_id: input.turnId } : {}),
    is_redraw: input.attemptSource !== 'first',
    // ⭐ WHICH attempt-2 population, when there is one. A quality redraw and an
    // enforcement retry are different diagnoses and used to share one boolean.
    attempt_source: input.attemptSource,
    elapsed_ms: input.elapsedMs,
    // ── The verdict half ──────────────────────────────────────────────────
    nominated: a.nominated,
    verdict: a.verdict.kind,
    // Coded grounds only — a five-member enum, never free text.
    ...(a.verdict.kind === 'impoverished' ? { grounds: [...a.verdict.grounds] } : {}),
    // Named on BOTH fail-open arms so a silent skip is impossible: a draft that
    // was not judged says WHY it was not judged.
    ...(a.verdict.kind === 'unavailable' ? { unavailable_reason: a.verdict.reason } : {}),
    // ⭐ AND ON THE NEVER-ASKED ARM. `not_assessed` used to be spelled
    // `adequate`, which made the impoverished RATE uninterpretable: it is a
    // ratio over the judged population, and an unjudged draw counted as a pass.
    ...(a.verdict.kind === 'not_assessed' ? { not_assessed_reason: a.verdict.reason } : {}),
    ...(input.noRedrawReason ? { no_redraw_reason: input.noRedrawReason } : {}),
    ...(input.retryBudgetMs !== null ? { retry_budget_ms: input.retryBudgetMs } : {}),
    // ── The cost half, reported honestly ──────────────────────────────────
    judge_latency_ms: a.judgeLatencyMs,
    ...(a.judgeModel ? { judge_model: a.judgeModel } : {}),
    // null when the adapter did not report usage — never a fabricated zero,
    // which would be indistinguishable from "the call was free".
    ...(a.judgeTokens
      ? { judge_tokens_in: a.judgeTokens.in, judge_tokens_out: a.judgeTokens.out }
      : {}),
    // ── The continuous structural metric — present on every draft ─────────
    ...(a.coverage
      ? {
          option_count: a.coverage.option_count,
          factor_count: a.coverage.factor_count,
          outcome_count: a.coverage.outcome_count,
          risk_count: a.coverage.risk_count,
          goal_count: a.coverage.goal_count,
          edge_count: a.coverage.edge_count,
          causal_waist: a.coverage.causal_waist,
          private_factor_count: a.coverage.private_factor_count,
          shared_factor_count: a.coverage.shared_factor_count,
          max_causal_depth: a.coverage.max_causal_depth,
        }
      : { coverage_unreadable: true }),
  });
}

export interface DraftQualityRedrawEventInput {
  readonly requestId: string;
  readonly scenarioId?: string | null;
  readonly turnId?: string | null;
  /** Coverage of the FIRST draw. */
  readonly firstCoverage: DraftQualityAssessment['coverage'];
  /** Coverage of the SECOND draw. null when the redraw failed outright. */
  readonly secondCoverage: DraftQualityAssessment['coverage'];
  /** Which draw was shipped. */
  readonly shipped: 'first' | 'second';
  /**
   * Did the redraw improve the model? The whole reason this event exists —
   * without it we would know redraws happen and nothing about whether they
   * work, which is the measurement the pass is supposed to buy us.
   */
  readonly improved: boolean;
  /**
   * Coded outcome of the second draw.
   *
   * ⚠⚠ THIS NOTE PREVIOUSLY SAID THE SECOND DRAW IS NOT RE-JUDGED, AND THAT WAS
   * THE DEFECT, NOT A LIMITATION. Selecting on `isMaterallyRicher` alone means
   * selecting on SHAPE — which is exactly what a fabricating drawer gets right,
   * so a second draw inventing off-brief factors scored richer and replaced a
   * graph the judge had already reviewed. The second draw IS now read against
   * the brief before it may win (`assessRedrawForSelection`), bounded by the
   * judge's own headroom gate.
   *
   *   · `richer`                — richer AND cleared against the brief. This is
   *                               a CONJUNCTION; reading either half alone is an
   *                               over-read.
   *   · `richer_but_not_cleared`— structurally richer, not vouched for. The
   *                               fabricated-redraw signature. Deliberately NOT
   *                               folded into `not_richer`: "cannot do better"
   *                               and "did something we will not stand behind"
   *                               are opposite diagnoses.
   *   · `not_richer`            — the deterministic comparison said no.
   *   · `draft_failed`          — the redraw produced no shippable graph.
   */
  readonly secondOutcome: RedrawOutcome;
  readonly totalElapsedMs: number;
}

/**
 * Emitted ONCE per turn on which a redraw was actually spent.
 *
 * `improved` is the acceptance metric for this whole capability. A redraw rate
 * that rises while `improved` stays flat means the pass is spending money and
 * latency to reproduce the same failure — exactly the outcome trap 23 warns
 * about (killing the symptom metric while the defect lives on), and the only
 * way to see it is to report both.
 */
export function emitDraftQualityRedraw(input: DraftQualityRedrawEventInput): void {
  emit(TelemetryEvents.CeeDraftQualityRedraw, {
    request_id: input.requestId,
    ...(input.scenarioId ? { scenario_id: input.scenarioId } : {}),
    ...(input.turnId ? { turn_id: input.turnId } : {}),
    shipped: input.shipped,
    improved: input.improved,
    second_outcome: input.secondOutcome,
    total_elapsed_ms: input.totalElapsedMs,
    ...(input.firstCoverage
      ? {
          first_option_count: input.firstCoverage.option_count,
          first_factor_count: input.firstCoverage.factor_count,
          first_causal_waist: input.firstCoverage.causal_waist,
          first_private_factor_count: input.firstCoverage.private_factor_count,
        }
      : {}),
    ...(input.secondCoverage
      ? {
          second_option_count: input.secondCoverage.option_count,
          second_factor_count: input.secondCoverage.factor_count,
          second_causal_waist: input.secondCoverage.causal_waist,
          second_private_factor_count: input.secondCoverage.private_factor_count,
        }
      : {}),
  });
}
