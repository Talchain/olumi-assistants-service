/**
 * Dual-model accounting helpers (quarantined scaffold — not imported by any
 * live path).
 *
 * The canonical LLM-call classifier stays in dual-draft (m2LlmCallMade,
 * co-located with the frozen reason taxonomy) and is RE-EXPORTED here, never
 * re-implemented. The pure helpers generalise the MVP's telemetry accounting
 * (failure histogram, merge-report summary) for future multi-stage pipelines,
 * with exact parity to dual-draft/telemetry.ts semantics pinned by tests.
 */
import type { EnrichmentReason } from '../dual-draft/types.js';
import type { MergeFailure, MergeReport } from '../dual-draft/merge.js';
import { m2LlmCallMade } from '../dual-draft/index.js';
import { type StageAccounting, toStageAccounting } from './contracts.js';

export { m2LlmCallMade } from '../dual-draft/index.js';

/**
 * Failure histogram by coded reason — the exact shape emitMergeReport puts on
 * the v6_dual_draft_merge_report event (codes only, no free text).
 */
export function failureHistogram(
  failures: readonly MergeFailure[],
): Readonly<Record<string, number>> {
  const histogram: Record<string, number> = {};
  for (const f of failures) {
    histogram[f.reason_code] = (histogram[f.reason_code] ?? 0) + 1;
  }
  return histogram;
}

/** MergeReport → stage-generic accounting (alias of the contracts adapter). */
export function summariseMergeReport(report: MergeReport): StageAccounting {
  return toStageAccounting(report);
}

/** Sums accounting across stages/batches; histograms merge by key. */
export function combineAccounting(...parts: readonly StageAccounting[]): StageAccounting {
  const failure_codes: Record<string, number> = {};
  let items_total = 0;
  let applied = 0;
  let deferred = 0;
  let failed = 0;
  for (const part of parts) {
    items_total += part.items_total;
    applied += part.applied;
    deferred += part.deferred;
    failed += part.failed;
    for (const [code, count] of Object.entries(part.failure_codes)) {
      failure_codes[code] = (failure_codes[code] ?? 0) + count;
    }
  }
  return { items_total, applied, deferred, failed, failure_codes };
}

/**
 * Total LLM calls implied by a sequence of stage outcome reasons — the
 * multi-stage generalisation of the dispatch's single `+ 1 if m2LlmCallMade`
 * accounting. Delegates per-reason classification to the canonical
 * m2LlmCallMade so the two can never drift.
 */
export function countLlmCalls(reasons: readonly EnrichmentReason[]): number {
  return reasons.reduce((total, reason) => total + (m2LlmCallMade(reason) ? 1 : 0), 0);
}
