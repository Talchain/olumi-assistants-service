/**
 * Track 3 — Slice 4: no-silent-outcome telemetry contract (T4.0 §5).
 *
 * Every referee decision maps to EXACTLY ONE event `v5.candidate_mutation.<verdict>`.
 * A held/stale/rejected/clarify verdict with no event is a defect class (the
 * #316-lane "silent suppression" lesson). The event is REDACTED: codes, enums,
 * hashes and booleans only — NEVER payload values. This is the Track 6 safety
 * surface. Events are NOT emitted live by this isolated core; the deferred wiring
 * slice feeds them to the telemetry sink (and `validate-event-names` CI) at that time.
 */
import type {
  CandidateKind,
  MutationClass,
  MutationVerdict,
  RefereeVerdict,
} from './types.js';
import type { MutationReasonCode } from './reason-codes.js';

export interface MutationTelemetryEvent {
  readonly event: `v5.candidate_mutation.${MutationVerdict}`;
  readonly kind: CandidateKind | null;
  readonly verdict: MutationVerdict;
  readonly mutation_class: MutationClass | null;
  readonly blocker_code: MutationReasonCode | null;
  readonly base_hash_match: boolean;
  /** provenance.source, supplied by the caller (not carried on the verdict). */
  readonly source: string | null;
}

/** Build the single redacted telemetry event for a verdict. Pure; never throws. */
export function mutationTelemetryEvent(
  v: RefereeVerdict,
  source: string | null = null,
): MutationTelemetryEvent {
  return {
    event: `v5.candidate_mutation.${v.verdict}`,
    kind: v.kind,
    verdict: v.verdict,
    mutation_class: v.mutation_class,
    blocker_code: v.blocker?.code ?? null,
    base_hash_match: v.base_hash_match,
    source,
  };
}
