/**
 * decision_review — build a PROMOTION REPORT from H1's live-capture scoring.
 *
 * H1 (#767) scored two real deployed-pair captures of the SERVED v14 prompt. This
 * turns that scoring into the promotion-gate's evidence artifact: it aggregates
 * the per-dimension results WORST-case across the captures (the ab-verdict
 * safety discipline — a fail in ANY run is a fail), marks each dimension
 * required/conditional, and derives the fail-closed verdict.
 *
 * For v14 the honest verdict is BLOCK, for two independent reasons the gate must
 * carry, not paper over:
 *   1. real failures — r1 leaked an internal-vocabulary field name, r3 emitted an
 *      em dash; both breach the served prompt's OWN banned list;
 *   2. n=2 — a promotion verdict needs N≥3 paired reruns (ab-verdict); two
 *      captures that failed DIFFERENT rules is a compliance RATE nobody has
 *      estimated, not a score.
 *
 * The gate consumes this BLOCK report and (because v14 is a pre-gate promotion)
 * the grandfather baseline tolerates it at its exact hash. A rewrite that fixes
 * v14 must replace this with a PASS report at the new hash — at which point the
 * grandfather entry becomes stale and the ratchet forces its removal.
 */

import { promptHash16 } from '../promotion-gate/manifest.js';
import type { PromotionReport, PromotionReportDim, PromotionReportDimStatus } from '../promotion-gate/types.js';

/**
 * Dimensions whose applicability depends on the scenario's content, so a
 * not_applicable on them is not a measurement gap. Everything else is REQUIRED:
 * it must be affirmatively measured before a pass can be certified. `tone_alignment`
 * is deliberately REQUIRED — its NA on a response-only capture is a measurement
 * LIMITATION (the input field it reads is CEE-internal), and certifying a pass
 * without measuring tone is exactly the "asserted, not measured" failure this
 * whole track exists to end.
 */
const CONDITIONAL_DIMS: ReadonlySet<string> = new Set([
  'entity_references_grounded', // needs bias findings to ground
  'infeasible_winner_disclosed', // only applies when the winner is infeasible
  'story_headlines_distinct', // needs ≥2 headlines for a collision to be possible
  'scenario_contexts_keyed_on_fragile_edges', // needs scenario_contexts present
]);

interface CaptureDim {
  readonly name: string;
  readonly status: string;
}
interface CaptureScore {
  readonly candidate: string;
  readonly dimensions: readonly CaptureDim[];
}
interface CaptureFixtureReport {
  readonly fixtureId: string;
  readonly scores: readonly CaptureScore[];
}
export interface LiveCaptureReport {
  readonly servedHash: string;
  readonly reports: readonly CaptureFixtureReport[];
}

/** WORST-case across captures: any fail ⇒ fail; else all NA ⇒ NA; else pass. */
function aggregateStatus(statuses: readonly string[]): PromotionReportDimStatus {
  if (statuses.some((s) => s === 'fail')) return 'fail';
  if (statuses.every((s) => s === 'not_applicable')) return 'not_applicable';
  return 'pass';
}

export interface BuildOptions {
  /** The candidate label in the captures to score (the served prompt arm). */
  readonly candidateLabel: string;
  /** sha256[:16] of the served prompt text — the report identity. */
  readonly promptSha16: string;
  /** ISO timestamp for the report. */
  readonly generatedAt: string;
}

/**
 * Build the decision_review promotion report from a live-capture scoring report.
 *
 * FAIL-LOUD on a capture report that yields no candidate rows or no dimensions:
 * an empty aggregation would produce a report the gate then evaluates over
 * nothing.
 */
export function buildDecisionReviewPromotionReport(
  capture: LiveCaptureReport,
  opts: BuildOptions,
): PromotionReport {
  const perDim = new Map<string, string[]>();
  let scoredCaptures = 0;
  for (const rep of capture.reports) {
    const score = rep.scores.find((s) => s.candidate === opts.candidateLabel);
    if (!score) continue;
    scoredCaptures += 1;
    for (const d of score.dimensions) {
      const arr = perDim.get(d.name) ?? [];
      arr.push(d.status);
      perDim.set(d.name, arr);
    }
  }
  if (scoredCaptures === 0) {
    throw new Error(
      `decision_review promotion report: no capture carried candidate "${opts.candidateLabel}" — ` +
        'refusing to build a report over zero samples.',
    );
  }
  if (perDim.size === 0) {
    throw new Error('decision_review promotion report: aggregated ZERO dimensions — refusing (vacuous).');
  }

  const dims: PromotionReportDim[] = [...perDim.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, statuses]) => ({
      name,
      status: aggregateStatus(statuses),
      required: !CONDITIONAL_DIMS.has(name),
    }));

  const anyFail = dims.some((d) => d.status === 'fail');
  const requiredNa = dims.some((d) => d.required && d.status === 'not_applicable');
  const verdict: 'PASS' | 'BLOCK' = anyFail || requiredNa || scoredCaptures < 3 ? 'BLOCK' : 'PASS';

  return {
    schemaVersion: 1,
    task: 'decision_review',
    promptSha16: opts.promptSha16,
    generatedAt: opts.generatedAt,
    verdict,
    sampleSize: scoredCaptures,
    dims,
    evidence: {
      source: 'H1 #767 live-capture scoring of the served v14 prompt (two 2026-07-30 deployed-pair captures)',
      model: 'gpt-4.1-2025-04-14',
      aggregation: 'worst-case per dimension across captures (ab-verdict safety discipline)',
      block_reasons: [
        anyFail ? 'observed failures: r1 no_internal_vocabulary, r3 no_dashes (both breach the served prompt own banned list)' : null,
        requiredNa ? 'required dimension unmeasured on response-only captures (tone_alignment)' : null,
        scoredCaptures < 3 ? `n=${scoredCaptures} < 3: a promotion verdict needs ≥3 paired reruns (ab-verdict); this is a compliance rate, not a score` : null,
      ].filter((x): x is string => x !== null),
      note: 'PRE-GATE promotion — grandfathered at this hash. A rewrite must ship a PASS report at the new hash; that makes this report and its grandfather entry stale (the ratchet forces removal).',
    },
  };
}

export { promptHash16 };
