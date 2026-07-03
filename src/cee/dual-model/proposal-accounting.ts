/**
 * Proposal-tally candidate (quarantined scaffold — not imported by any live
 * path).
 *
 * Generalises the exact-one-bucket accounting the MVP merge guarantees
 * (applied | artifact/deferred | failure) into a checkable tally, following
 * the counter idiom of MergeReport and compound-goal's rejected_* counters.
 * The invariant checker exists so future stages ASSERT the partition instead
 * of assuming it.
 */
import type { DeferArtifact, MergeReport } from '../dual-draft/merge.js';
import { failureHistogram } from './accounting.js';

export interface ProposalTally {
  readonly total: number;
  readonly applied: number;
  readonly deferred: number;
  readonly rejected: number;
  /** Histogram by coded failure reason — codes only, no free text. */
  readonly rejected_by_code: Readonly<Record<string, number>>;
  /** Histogram of deferred artifacts by proposal type. */
  readonly deferred_by_type: Readonly<Record<string, number>>;
}

/** Builds a tally from a real merge outcome (report + its defer artifacts). */
export function tallyFromMergeReport(
  report: MergeReport,
  artifacts: readonly DeferArtifact[],
): ProposalTally {
  const deferred_by_type: Record<string, number> = {};
  for (const a of artifacts) {
    deferred_by_type[a.type] = (deferred_by_type[a.type] ?? 0) + 1;
  }
  return {
    total: report.proposals_total,
    applied: report.applied,
    deferred: report.artifacts,
    rejected: report.failures.length,
    rejected_by_code: failureHistogram(report.failures),
    deferred_by_type,
  };
}

export interface TallyInvariantResult {
  readonly ok: boolean;
  /** total − (applied + deferred + rejected); 0 when the partition holds. */
  readonly delta: number;
}

/** Exact-one-bucket partition check: total === applied + deferred + rejected. */
export function checkTallyInvariant(tally: ProposalTally): TallyInvariantResult {
  const delta = tally.total - (tally.applied + tally.deferred + tally.rejected);
  return { ok: delta === 0, delta };
}
