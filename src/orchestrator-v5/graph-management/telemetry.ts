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
  /** provenance.source (envelope), supplied by the caller (not carried on the verdict). */
  readonly source: string | null;
  /** identity.scenario_id / identity.turn_id (envelope), supplied by the caller. */
  readonly scenario_id: string | null;
  readonly turn_id: string | null;
  /** Referee wall-clock latency in ms, supplied by the caller at emit time. */
  readonly latency_ms: number | null;
}

/**
 * Context the verdict does not carry but the contract's event requires (T4.0 §5):
 * source + scenario_id + turn_id (from the envelope) and latency (measured at emit).
 */
export interface MutationTelemetryContext {
  readonly source?: string | null;
  readonly scenario_id?: string | null;
  readonly turn_id?: string | null;
  readonly latency_ms?: number | null;
}

/** The known provenance sources (mirrors the envelope's `provenance.source` enum). */
const KNOWN_SOURCES: ReadonlySet<string> = new Set([
  'dual_model_m2',
  'edit_graph_llm',
  'flip_proposal',
  'user_direct',
]);

/** Constrain `source` to the known set — an unrecognised value → null (clean signal). */
function normaliseSource(s: string | null | undefined): string | null {
  return typeof s === 'string' && KNOWN_SOURCES.has(s) ? s : null;
}

/** Normalise latency — only a finite, non-negative number is kept; else null. */
function normaliseLatency(ms: number | null | undefined): number | null {
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** Build the single redacted telemetry event for a verdict. Pure; never throws. */
export function mutationTelemetryEvent(
  v: RefereeVerdict,
  ctx: MutationTelemetryContext = {},
): MutationTelemetryEvent {
  return {
    event: `v5.candidate_mutation.${v.verdict}`,
    kind: v.kind,
    verdict: v.verdict,
    mutation_class: v.mutation_class,
    blocker_code: v.blocker?.code ?? null,
    base_hash_match: v.base_hash_match,
    source: normaliseSource(ctx.source),
    scenario_id: typeof ctx.scenario_id === 'string' ? ctx.scenario_id : null,
    turn_id: typeof ctx.turn_id === 'string' ? ctx.turn_id : null,
    latency_ms: normaliseLatency(ctx.latency_ms),
  };
}
