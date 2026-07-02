/**
 * V6 dual-draft telemetry emit helpers (G15 — invalid-proposal accounting).
 *
 * Everything M2-related is observable here and ONLY here in the MVP: no wire
 * field, no coaching surface, no persisted-turn metadata. Free-text proposal
 * content (questions, rationales) is never emitted — counts, coded reasons
 * and models only.
 */
import { emit, TelemetryEvents } from '../../utils/telemetry.js';
import type { EnrichmentInput } from './types.js';
import type { M2ReviewResult } from './m2-review.js';
import type { MergeReport } from './merge.js';

function baseFields(input: EnrichmentInput): Record<string, unknown> {
  return {
    request_id: input.requestId,
    scenario_id: input.scenarioId,
    turn_id: input.turnId,
  };
}

export function emitM2Outcome(input: EnrichmentInput, result: M2ReviewResult): void {
  emit(TelemetryEvents.V6DualDraftM2Outcome, {
    ...baseFields(input),
    outcome: result.kind,
    ...(result.kind === 'ok' && {
      latency_ms: result.latencyMs,
      model: result.model,
      proposals_count: result.proposals.length,
    }),
    // Coded model-resolution sub-cause (safe enum — config values only) so
    // activation dashboards distinguish unset / provider-unsupported /
    // model-mismatch, the three operator-actionable inert conditions.
    ...(result.kind === 'model_not_resolved' && { cause: result.cause }),
  });
}

export function emitMergeReport(input: EnrichmentInput, report: MergeReport): void {
  // Failure histogram: coded reasons only, no free text.
  const failureCodes: Record<string, number> = {};
  for (const f of report.failures) {
    failureCodes[f.reason_code] = (failureCodes[f.reason_code] ?? 0) + 1;
  }
  emit(TelemetryEvents.V6DualDraftMergeReport, {
    ...baseFields(input),
    proposals_total: report.proposals_total,
    applied: report.applied,
    artifacts: report.artifacts,
    failures: report.failures.length,
    failure_codes: failureCodes,
    post_merge_valid: report.post_merge_valid,
  });
}

export function emitDegraded(input: EnrichmentInput, reason: string, detail?: string): void {
  emit(TelemetryEvents.V6DualDraftDegraded, {
    ...baseFields(input),
    reason,
    // Coded sub-cause (e.g. the M2ReviewResult kind 'model_not_resolved' when
    // the frozen EnrichmentReason union maps it onto 'm2_llm_error') so the
    // degraded event alone identifies static-config conditions vs real LLM
    // instability, without joining against the m2_outcome event.
    ...(detail !== undefined && { detail }),
  });
}
