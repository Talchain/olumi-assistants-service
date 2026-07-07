/**
 * Model Management v1 — service layer (Layer 2, DARK).
 *
 * Flag gate: EVERY entry point checks `CEE_MODEL_VERSIONS_ENABLED`
 * (config.cee.modelVersionsEnabled, default OFF) FIRST and fail-closed
 * no-ops to `{ status: 'disabled' }` — no store call, no hashing, no
 * side effects — when off.
 *
 * NOTHING here is wired into routes or the turn-executor this slice
 * (Track 3 isolation discipline): zero production call sites.
 *
 * Identity: the Group A primitives are REUSED, never re-implemented —
 * `computeGraphIdentityHash` supplies the content identity envelope the
 * RPC persists verbatim; comparison delegates to compare.ts (which reuses
 * the sanctioned analysis-affecting hash). The service never throws: every
 * outcome is a typed ModelManagementResult.
 */

import { config } from '../../config/index.js';
import { computeGraphIdentityHash } from '../context/graph-identity.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import { compareVersionRecords } from './compare.js';
import {
  ModelVersionCasConflictError,
  ModelVersionNotFoundError,
  ModelVersionSignInRequiredError,
  type ModelVersionStorePort,
} from './store-adapter.js';
import {
  CAS_CONFLICT_KIND,
  SIGN_IN_REQUIRED_MESSAGE,
  type ModelManagementResult,
  type ModelVersionEvent,
  type ModelVersionRecord,
  type ModelVersionSummary,
  type VersionComparison,
  type VersionEventSink,
  type VersionWriteOutcome,
} from './types.js';
import { journeyRpcVersionEventSink, notifyVersionEventSink } from './version-event-sink.js';

export interface SaveVersionRequest {
  readonly scenario_id: string;
  /** The graph to snapshot (wire/persisted shape; hashed CEE-side). */
  readonly graph: unknown;
  readonly label?: string;
  readonly provenance?: string;
  /** Optional write-time CAS: expected current-head identity hash. */
  readonly expected_graph_identity_hash?: string;
}

export interface RestoreVersionRequest {
  readonly scenario_id: string;
  readonly version_id: string;
  readonly label?: string;
  readonly expected_graph_identity_hash?: string;
}

export interface ModelManagementServiceOptions {
  readonly store: ModelVersionStorePort;
  /** Additional-consumer seam (contract §7.3); the durable v1 sink is the
   *  RPC journey event — see version-event-sink.ts. */
  readonly eventSink?: VersionEventSink;
  /** Flag probe — call-time so tests/env flips are honoured per call.
   *  Defaults to the CEE_MODEL_VERSIONS_ENABLED config flag. */
  readonly isEnabled?: () => boolean;
}

function flagFromConfig(): boolean {
  return config.cee.modelVersionsEnabled === true;
}

export class ModelManagementService {
  private readonly store: ModelVersionStorePort;
  private readonly eventSink: VersionEventSink;
  private readonly isEnabled: () => boolean;

  constructor(options: ModelManagementServiceOptions) {
    this.store = options.store;
    this.eventSink = options.eventSink ?? journeyRpcVersionEventSink;
    this.isEnabled = options.isEnabled ?? flagFromConfig;
  }

  async saveVersion(
    request: SaveVersionRequest,
  ): Promise<ModelManagementResult<VersionWriteOutcome>> {
    if (!this.isEnabled()) return { status: 'disabled' };

    // Content identity is computed HERE (Group A module), never client- or
    // SQL-side. Persisted `scenarios.graph` payloads and boundary ingress
    // graphs share the wire JSON shape GraphStateIngress models.
    const identity = computeGraphIdentityHash(
      request.graph as GraphStateIngress | null | undefined,
    );
    if (identity === null) {
      return {
        status: 'error',
        error: {
          code: 'empty_graph',
          recoverable: true,
          message: 'No graph content to version (absent or identity-empty graph).',
        },
      };
    }

    return this.runWrite('model_version_created', request.scenario_id, () =>
      this.store.saveVersion({
        scenario_id: request.scenario_id,
        graph: request.graph,
        graph_identity_hash: identity.value,
        hash_algorithm: identity.algorithm,
        identity_projection_version: identity.projection_version,
        identity_normaliser_version: identity.normaliser_version,
        graph_schema_version: identity.graph_schema_version,
        ...(request.label !== undefined ? { label: request.label } : {}),
        ...(request.provenance !== undefined ? { provenance: request.provenance } : {}),
        ...(request.expected_graph_identity_hash !== undefined
          ? { expected_graph_identity_hash: request.expected_graph_identity_hash }
          : {}),
      }),
    );
  }

  async restoreVersion(
    request: RestoreVersionRequest,
  ): Promise<ModelManagementResult<VersionWriteOutcome>> {
    if (!this.isEnabled()) return { status: 'disabled' };
    return this.runWrite('model_version_restored', request.scenario_id, () =>
      this.store.restoreVersion({
        scenario_id: request.scenario_id,
        version_id: request.version_id,
        ...(request.label !== undefined ? { label: request.label } : {}),
        ...(request.expected_graph_identity_hash !== undefined
          ? { expected_graph_identity_hash: request.expected_graph_identity_hash }
          : {}),
      }),
    );
  }

  async listVersions(
    scenarioId: string,
    limit?: number,
  ): Promise<ModelManagementResult<readonly ModelVersionSummary[]>> {
    if (!this.isEnabled()) return { status: 'disabled' };
    try {
      const versions =
        limit === undefined
          ? await this.store.listVersions(scenarioId)
          : await this.store.listVersions(scenarioId, limit);
      return { status: 'ok', value: versions };
    } catch (err) {
      return mapThrownError(err);
    }
  }

  async getVersion(
    scenarioId: string,
    versionId: string,
  ): Promise<ModelManagementResult<ModelVersionRecord>> {
    if (!this.isEnabled()) return { status: 'disabled' };
    try {
      const version = await this.store.getVersion(scenarioId, versionId);
      if (version === null) {
        return {
          status: 'error',
          error: {
            code: 'version_not_found',
            recoverable: true,
            message: `Version ${versionId} not found for scenario ${scenarioId}.`,
          },
        };
      }
      return { status: 'ok', value: version };
    } catch (err) {
      return mapThrownError(err);
    }
  }

  /**
   * Resolve the scenario's current-version head pointer to its full record.
   *
   *  - flag off                → `disabled`.
   *  - pointer NULL            → `ok` with `value: null` (no versions yet — an
   *                              empty state, not an error; the UI's "no saved
   *                              versions" case). No `getVersion` call is made.
   *  - pointer → record        → `ok` with the record.
   *  - pointer → absent record → `version_not_found` (the head pointer does not
   *                              resolve; the `ON DELETE SET NULL` FK should make
   *                              this impossible, so it is surfaced honestly as a
   *                              data inconsistency rather than masked as "none").
   *
   * Scenario-scoped read: `getCurrentVersionId` reads the pointer off the
   * scenario row and `getVersion` filters by BOTH `scenario_id` and `id`, so a
   * pointer can only ever resolve to a version owned by this scenario — a
   * cross-scenario version can never leak through the current-version read
   * (owner isolation is the scenario's own; this method adds no new trust).
   */
  async getCurrentVersion(
    scenarioId: string,
  ): Promise<ModelManagementResult<ModelVersionRecord | null>> {
    if (!this.isEnabled()) return { status: 'disabled' };
    try {
      const currentId = await this.store.getCurrentVersionId(scenarioId);
      if (currentId === null) {
        return { status: 'ok', value: null };
      }
      const record = await this.store.getVersion(scenarioId, currentId);
      if (record === null) {
        return {
          status: 'error',
          error: {
            code: 'version_not_found',
            recoverable: false,
            message: `Current-version pointer ${currentId} does not resolve to a version for scenario ${scenarioId}.`,
          },
        };
      }
      return { status: 'ok', value: record };
    } catch (err) {
      return mapThrownError(err);
    }
  }

  /**
   * Compare two persisted versions (direction: `from` → `to`), CEE-side:
   * identity-hash short-circuit, else analysis-affecting equivalence + a
   * compact structural diff summary (compare.ts).
   */
  async compareVersions(
    scenarioId: string,
    fromVersionId: string,
    toVersionId: string,
  ): Promise<ModelManagementResult<VersionComparison>> {
    if (!this.isEnabled()) return { status: 'disabled' };
    try {
      const [from, to] = await Promise.all([
        this.store.getVersion(scenarioId, fromVersionId),
        this.store.getVersion(scenarioId, toVersionId),
      ]);
      if (from === null || to === null) {
        const missing = from === null ? fromVersionId : toVersionId;
        return {
          status: 'error',
          error: {
            code: 'version_not_found',
            recoverable: true,
            message: `Version ${missing} not found for scenario ${scenarioId}.`,
          },
        };
      }
      return { status: 'ok', value: compareVersionRecords(from, to) };
    } catch (err) {
      return mapThrownError(err);
    }
  }

  /** Shared write path: typed-error mapping + post-commit event emission. */
  private async runWrite(
    eventType: ModelVersionEvent['event_type'],
    scenarioId: string,
    write: () => Promise<VersionWriteOutcome>,
  ): Promise<ModelManagementResult<VersionWriteOutcome>> {
    try {
      const outcome = await write();
      // Dedupe = no new version, no durable journey event ⇒ no sink event
      // (version history records changes, not confirmations — contract §7.3).
      if (!outcome.deduped && outcome.event_id !== null) {
        await notifyVersionEventSink(this.eventSink, {
          event_version: 'model_version_event.v1',
          event_id: outcome.event_id,
          event_type: eventType,
          scenario_id: scenarioId,
          version_id: outcome.version_id,
          version_number: outcome.version_number,
          graph_identity_hash: outcome.graph_identity_hash,
          restored_from_version_id: outcome.restored_from_version_id ?? null,
          occurred_at_iso: new Date().toISOString(),
        });
      }
      return { status: 'ok', value: outcome };
    } catch (err) {
      return mapThrownError(err);
    }
  }
}

/** Fail-closed typed mapping — the service never rethrows. */
function mapThrownError<T>(err: unknown): ModelManagementResult<T> {
  if (err instanceof ModelVersionSignInRequiredError) {
    return {
      status: 'error',
      error: {
        code: 'sign_in_required',
        recoverable: true,
        // D3 Branch A interim posture — exact copy semantics.
        message: SIGN_IN_REQUIRED_MESSAGE,
      },
    };
  }
  if (err instanceof ModelVersionCasConflictError) {
    return {
      status: 'conflict',
      conflict: {
        kind: CAS_CONFLICT_KIND,
        expected_graph_identity_hash: err.expectedHash,
        message: 'Version write rejected: the model changed since the expected state was read.',
      },
    };
  }
  if (err instanceof ModelVersionNotFoundError) {
    return {
      status: 'error',
      error: {
        code: 'version_not_found',
        recoverable: true,
        message: err.message,
      },
    };
  }
  return {
    status: 'error',
    error: {
      code: 'store_error',
      recoverable: false,
      message: err instanceof Error ? err.message : String(err),
    },
  };
}
