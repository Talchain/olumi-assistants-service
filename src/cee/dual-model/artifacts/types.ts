/**
 * M2 artifact persistence contract (quarantined scaffold — not imported by
 * any live path; the backing table's migration is repo-owned and UNAPPLIED).
 *
 * Persists the M2 review's non-mutating output bodies — evidence gaps,
 * uncertainty flags, clarification proposals, deferred options — which the
 * MVP currently discards after counting (dual-draft telemetry is counts/codes
 * only). Bounded by construction: at most MAX_ARTIFACTS_PER_TURN rows per
 * turn (= PROPOSAL_CAP, drift-guarded by test) and hard per-field caps that
 * mirror the SQL CHECK constraints (parity-tested against the migration).
 *
 * NON-USER-FACING BY DEFAULT: records are session-DB data. Nothing here
 * attaches to a wire response; surfacing is a separately-authorised lane
 * (dual-draft amendment #3). LOG-SAFETY: results expose counts only — bodies
 * never appear in logs or telemetry (pinned by test).
 */
import type { DeferArtifact } from '../../dual-draft/merge.js';

export const M2_ARTIFACT_TYPES = [
  'added_evidence_gap',
  'uncertainty_flag',
  'clarification_proposal',
  'added_option',
] as const;
export type M2ArtifactType = (typeof M2_ARTIFACT_TYPES)[number];

/**
 * Row lifecycle. There is deliberately NO 'rejected' status: rejected
 * proposals become MergeFailures whose bodies are discarded before artifact
 * creation — a rejected row is unreachable from today's data flow.
 */
export const M2_ARTIFACT_STATUSES = ['deferred', 'surfaced', 'dismissed', 'superseded'] as const;
export type M2ArtifactStatus = (typeof M2_ARTIFACT_STATUSES)[number];

/** Per-field storage caps (chars). MUST match the SQL CHECK constraints. */
export const ARTIFACT_FIELD_CAPS = {
  question: 500,
  rationale: 500,
  evidence_pointer: 300,
} as const;

/** Rows per (scenario, turn). Equals dual-draft's PROPOSAL_CAP (test-pinned). */
export const MAX_ARTIFACTS_PER_TURN = 8;

export interface M2ArtifactRecord {
  readonly id: string;
  readonly request_id: string;
  readonly scenario_id: string;
  readonly turn_id: string;
  /** Opaque caller-supplied graph hash (cee must not import orchestrator-v5). */
  readonly graph_hash: string | null;
  /** Original position in the merge's artifact list — part of the unique key. */
  readonly artifact_index: number;
  readonly proposal_type: M2ArtifactType;
  readonly question: string;
  readonly rationale: string | null;
  readonly evidence_pointer: string;
  readonly status: M2ArtifactStatus;
  readonly created_at: string;
}

export interface AppendArtifactsInput {
  readonly requestId: string;
  readonly scenarioId: string;
  readonly turnId: string;
  readonly graphHash: string | null;
  /** The merge outcome's defer artifacts, in merge order. */
  readonly artifacts: readonly DeferArtifact[];
}

/** Counts only — log-safe by construction. */
export interface AppendArtifactsResult {
  readonly appended: number;
  readonly dropped_over_cap: number;
  readonly truncated_fields: number;
  /** Unknown type, or empty-after-trim question/evidence_pointer. */
  readonly rejected_invalid: number;
}

export interface ReadArtifactsOptions {
  readonly limit?: number;
  readonly statuses?: readonly M2ArtifactStatus[];
}

export interface ArtifactStore {
  appendArtifacts(input: AppendArtifactsInput): Promise<AppendArtifactsResult>;
  /** Ordered by (created_at, artifact_index) ascending. */
  readByScenario(scenarioId: string, opts?: ReadArtifactsOptions): Promise<readonly M2ArtifactRecord[]>;
  readByTurn(scenarioId: string, turnId: string): Promise<readonly M2ArtifactRecord[]>;
}
