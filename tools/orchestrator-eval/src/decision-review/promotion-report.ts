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
import { MIN_CERTIFYING_SAMPLE_SIZE } from '../promotion-gate/types.js';
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
  /**
   * PROVENANCE, REQUIRED: what corpus produced the outputs being aggregated.
   *
   * ⚠ This is required rather than defaulted on purpose. It used to be a
   * string LITERAL inside the builder naming H1 #767's two captures, so every
   * later report described a corpus it had never seen (E1, 2026-07-31). A
   * defaulted provenance is the same defect with a politer name: the caller
   * must state what was scored, because only the caller knows.
   */
  readonly evidenceSource: string;
  /** PROVENANCE, REQUIRED: the model id whose outputs were scored. */
  readonly model: string;
  /** Optional free-text note appended to the evidence block. */
  readonly note?: string;
  /**
   * Optional additional provenance fields (run ids, sampling posture, artefact
   * paths). Merged into `evidence`; it cannot overwrite the derived keys, which
   * are written last.
   */
  readonly extraEvidence?: Readonly<Record<string, unknown>>;
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

  // DERIVED block reasons: the names come from the aggregation itself, so they
  // cannot describe a corpus other than the one scored. The previous version
  // emitted a fixed sentence naming "r1 no_internal_vocabulary, r3 no_dashes"
  // on ANY failing input — a gate artifact that lied about its own evidence.
  const failedDims = dims.filter((d) => d.status === 'fail').map((d) => d.name);
  const naRequiredDims = dims
    .filter((d) => d.required && d.status === 'not_applicable')
    .map((d) => d.name);
  const anyFail = failedDims.length > 0;
  const requiredNa = naRequiredDims.length > 0;
  // The n-threshold is the SHARED constant the gate's floor re-derives from —
  // one source, no twin (trap 12). A literal here would drift the moment the
  // gate's minimum moved, and the drift would read as green.
  const tooFewSamples = scoredCaptures < MIN_CERTIFYING_SAMPLE_SIZE;
  const verdict: 'PASS' | 'BLOCK' = anyFail || requiredNa || tooFewSamples ? 'BLOCK' : 'PASS';

  return {
    schemaVersion: 1,
    task: 'decision_review',
    promptSha16: opts.promptSha16,
    generatedAt: opts.generatedAt,
    verdict,
    sampleSize: scoredCaptures,
    dims,
    evidence: {
      // Caller-supplied provenance first, so a stray `extraEvidence` key can
      // never shadow a DERIVED one.
      ...(opts.extraEvidence ?? {}),
      source: opts.evidenceSource,
      model: opts.model,
      aggregation: 'worst-case per dimension across captures (ab-verdict safety discipline)',
      block_reasons: [
        anyFail
          ? `observed failures on ${failedDims.length} dimension(s): ${failedDims.join(', ')}`
          : null,
        requiredNa
          ? `required dimension(s) not measured on this corpus (not_applicable): ${naRequiredDims.join(', ')}`
          : null,
        tooFewSamples
          ? `n=${scoredCaptures} < ${MIN_CERTIFYING_SAMPLE_SIZE}: a promotion verdict needs ≥${MIN_CERTIFYING_SAMPLE_SIZE} paired reruns (ab-verdict); this is a compliance rate, not a score`
          : null,
      ].filter((x): x is string => x !== null),
      ...(opts.note === undefined ? {} : { note: opts.note }),
    },
  };
}

export { promptHash16 };
