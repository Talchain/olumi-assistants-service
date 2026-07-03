/**
 * Dual-model production-system contracts (quarantined scaffold).
 *
 * QUARANTINE RULE: nothing under src/cee/dual-model/ is imported by any live
 * path. These modules may import types/functions FROM live modules
 * (read-only); the reverse direction is forbidden until a wiring lane is
 * explicitly approved. There is deliberately NO index.ts barrel in this
 * namespace — future wiring must import specific modules so the diff shows
 * exactly what goes live.
 *
 * This module is the single place the scaffold touches the frozen dual-draft
 * contract surface: type-only re-exports (so future stages share one
 * vocabulary) plus stage-generic generalisations of the MVP's
 * EnrichmentOutcome/MergeReport shapes. The frozen types themselves are NOT
 * modified — see src/cee/dual-draft/types.ts freeze ruling.
 */
import type { GraphV3T } from '../../schemas/cee-v3.js';
import type { EnrichmentOutcome, EnrichmentReason } from '../dual-draft/types.js';
import type { MergeReport } from '../dual-draft/merge.js';

// ---------------------------------------------------------------------------
// Frozen-contract re-exports (types + contract constants only)
// ---------------------------------------------------------------------------

export type { EnrichmentInput, EnrichmentOutcome, EnrichmentReason } from '../dual-draft/types.js';
export type {
  MergeFailure,
  MergeFailureCode,
  MergeReport,
  MergeOutcome,
  DeferArtifact,
} from '../dual-draft/merge.js';
export type { M2ReviewResult, M2ModelResolutionCause } from '../dual-draft/m2-review.js';
export type { ProposalEnvelopeT } from '../dual-draft/proposals.js';
export {
  PROPOSAL_TYPES,
  MUTATING_PROPOSAL_TYPES,
  ARTIFACT_PROPOSAL_TYPES,
  PROPOSAL_CAP,
  isArtifactType,
} from '../dual-draft/proposals.js';

// ---------------------------------------------------------------------------
// Stage-generic generalisations (new, additive — future multi-stage pipeline)
// ---------------------------------------------------------------------------

/**
 * Generalisation of EnrichmentOutcome for an N-stage dual-model pipeline.
 * `changed === false` carries the SAME semantics as the MVP's
 * `enriched === false`: `graph` MUST be the untouched upstream graph (the
 * byte-identity guarantee), never a clone. See fail-open.ts, which enforces
 * this normatively.
 */
export interface StageResult<TGraph, TReason extends string> {
  readonly changed: boolean;
  readonly reason: TReason;
  readonly graph: TGraph;
  /** Coded/bounded sub-cause. Never free proposal text (log-safety rule). */
  readonly detail?: string;
}

/**
 * Generalisation of MergeReport accounting for stages that bucket work items
 * into applied / deferred / failed. Invariant (checkable, not assumed):
 * items_total === applied + deferred + failed.
 */
export interface StageAccounting {
  readonly items_total: number;
  readonly applied: number;
  readonly deferred: number;
  readonly failed: number;
  /** Histogram by coded failure reason — codes only, no free text. */
  readonly failure_codes: Readonly<Record<string, number>>;
}

/** Adapts the MVP's EnrichmentOutcome onto the stage-generic shape. */
export function toStageResult(outcome: EnrichmentOutcome): StageResult<GraphV3T, EnrichmentReason> {
  return {
    changed: outcome.enriched,
    reason: outcome.reason,
    graph: outcome.graph,
  };
}

/** Adapts the MVP's MergeReport onto the stage-generic accounting shape. */
export function toStageAccounting(report: MergeReport): StageAccounting {
  const failure_codes: Record<string, number> = {};
  for (const f of report.failures) {
    failure_codes[f.reason_code] = (failure_codes[f.reason_code] ?? 0) + 1;
  }
  return {
    items_total: report.proposals_total,
    applied: report.applied,
    deferred: report.artifacts,
    failed: report.failures.length,
    failure_codes,
  };
}
