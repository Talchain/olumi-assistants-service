/**
 * Model Management v1 — typed vocabulary (Layer 2, DARK).
 *
 * Isolated module: NOTHING here is wired into routes or the turn-executor
 * (Track 3 isolation discipline). Every service entry point is gated by
 * `CEE_MODEL_VERSIONS_ENABLED` (default OFF) and fail-closed no-ops to a
 * typed `disabled` result when the flag is off.
 *
 * Decisions carried (both signed 2026-07-05 — see
 * Docs/v5/layer-1-architecture-decisions-memo-v0.md on the layer-1 lane):
 *   D1 — substrate is the new `model_versions` table +
 *        `scenarios.current_model_version_id` pointer
 *        (migration 20260705120000_v5_model_versions.sql — AUTHORED, NOT
 *        EXECUTED; execution is separately Paul-gated).
 *   D3 — Branch A (login first): owner_user_id NOT NULL; guest scenarios
 *        are refused with a typed, recoverable sign-in-required error.
 */

// ---------------------------------------------------------------------------
// Version rows.
// ---------------------------------------------------------------------------

/** List-projection of a model_versions row — everything except the graph
 *  payload (list reads must not ship N full graphs over the wire). */
export interface ModelVersionSummary {
  readonly id: string;
  readonly scenario_id: string;
  readonly owner_user_id: string;
  readonly version_number: number;
  /** Group A identity envelope, stored verbatim per row (hashes are only
   *  comparable within matching projection/normaliser versions). */
  readonly graph_identity_hash: string;
  readonly hash_algorithm: string;
  readonly identity_projection_version: string;
  readonly identity_normaliser_version: string;
  readonly graph_schema_version: string;
  readonly label: string | null;
  readonly provenance: string | null;
  /** Restore lineage: the version whose graph this row copied, or null. */
  readonly restored_from_version_id: string | null;
  readonly created_at: string;
}

/** Full row including the graph snapshot (single-version reads only). */
export interface ModelVersionRecord extends ModelVersionSummary {
  readonly graph: unknown;
}

/** Outcome of a create/restore RPC call (the RPC's jsonb return). */
export interface VersionWriteOutcome {
  readonly version_id: string;
  readonly version_number: number;
  readonly graph_identity_hash: string;
  /** True when the RPC no-op-deduped against the current head (identical
   *  identity envelope): no new row, no pointer move, no journey event. */
  readonly deduped: boolean;
  /** Journey event id appended by the RPC; null when deduped. */
  readonly event_id: string | null;
  /** Set on restore outcomes only. */
  readonly restored_from_version_id?: string;
}

// ---------------------------------------------------------------------------
// Typed errors / results — every entry point resolves to one of these;
// the service layer never throws.
// ---------------------------------------------------------------------------

/**
 * CAS-conflict vocabulary term. Named `analysis_affecting_conflict` for
 * consistency with the A3 CAS vocabulary. NOTE: defined as a LOCAL string
 * literal because the A3 CAS interface (#346) has not landed on staging —
 * when it does, import the term from its module instead of this constant.
 */
export const CAS_CONFLICT_KIND = 'analysis_affecting_conflict' as const;

export interface VersionCasConflict {
  readonly kind: typeof CAS_CONFLICT_KIND;
  /** The expected head hash the caller supplied (64-hex), if known. */
  readonly expected_graph_identity_hash: string | null;
  readonly message: string;
}

export type ModelManagementErrorCode =
  /** D3 Branch A guest refusal (SQLSTATE MV001). Recoverable by design. */
  | 'sign_in_required'
  /** Restore/read target absent for this scenario (SQLSTATE MV404). */
  | 'version_not_found'
  /** The supplied graph is absent or identity-empty — nothing to version. */
  | 'empty_graph'
  /** Any other store/RPC failure (fail-closed catch-all). */
  | 'store_error';

/** Exact D3 interim-posture copy for the guest refusal. */
export const SIGN_IN_REQUIRED_MESSAGE = 'Version history requires sign-in.';

export interface ModelManagementError {
  readonly code: ModelManagementErrorCode;
  readonly recoverable: boolean;
  readonly message: string;
}

/**
 * Discriminated result of every service entry point.
 *  - 'disabled'  — CEE_MODEL_VERSIONS_ENABLED off: fail-closed typed no-op.
 *  - 'conflict'  — expected-hash CAS mismatch (stale write attempt).
 *  - 'error'     — typed error (see ModelManagementErrorCode).
 */
export type ModelManagementResult<T> =
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'disabled' }
  | { readonly status: 'conflict'; readonly conflict: VersionCasConflict }
  | { readonly status: 'error'; readonly error: ModelManagementError };

// ---------------------------------------------------------------------------
// Compare.
// ---------------------------------------------------------------------------

/** Compact structural diff — counts only, no prose. */
export interface VersionDiffSummary {
  readonly nodes_added: number;
  readonly nodes_removed: number;
  readonly nodes_changed: number;
  readonly edges_added: number;
  readonly edges_removed: number;
  readonly edges_changed: number;
}

export type VersionComparison =
  /** Identity hashes equal under matching projection/normaliser versions —
   *  graphs are identical by content-address; no diff computed. */
  | { readonly relation: 'identical'; readonly short_circuit: true }
  | {
      readonly relation: 'different';
      readonly short_circuit: false;
      /** True/false when both analysis-affecting hashes are computable;
       *  null when either graph has no analysis-affecting hash. */
      readonly analysis_equivalent: boolean | null;
      readonly diff: VersionDiffSummary;
    };

// ---------------------------------------------------------------------------
// Version-event hook — the VersionEventSink seam named in
// Docs/v5/graph-management-apply-reject-contract-v0.md §7.3 (layer-1 lane),
// specialised here to model-version lifecycle events.
// ---------------------------------------------------------------------------

export interface ModelVersionEvent {
  readonly event_version: 'model_version_event.v1';
  /** Idempotency key — the RPC journey-event id (deterministic per version
   *  row). Duplicate emits with the same event_id MUST be no-ops. */
  readonly event_id: string;
  readonly event_type: 'model_version_created' | 'model_version_restored';
  readonly scenario_id: string;
  readonly version_id: string;
  readonly version_number: number;
  readonly graph_identity_hash: string;
  readonly restored_from_version_id: string | null;
  readonly occurred_at_iso: string;
}

/**
 * The seam (contract §7.3 shape): at-least-once, idempotent-by-key.
 * emit() MUST NOT block or fail the user-facing result — failures are
 * telemetered by the caller and re-driven, never dropped silently.
 *
 * v1 sink: the RPC journey event. create_model_version /
 * restore_model_version append the durable `model_version_created` /
 * `model_version_restored` event into `scenarios.events` INSIDE the write
 * transaction (strictly atomic — stronger than the seam's at-least-once
 * minimum), idempotent by event_id. The TS-side sink is therefore an
 * additional-consumer seam (telemetry / external substrates), not the
 * durability path.
 */
export interface VersionEventSink {
  emit(event: ModelVersionEvent): Promise<void>;
}
