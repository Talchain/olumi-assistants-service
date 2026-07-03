/**
 * In-memory ArtifactStore (quarantined scaffold) — the persist/reload test
 * double and the reference implementation of the store semantics:
 *   - unique (scenario_id, turn_id, artifact_index): conflicting appends are
 *     SKIPPED, mirroring the SQL unique index + ignoreDuplicates upsert;
 *   - deterministic: synthetic monotonic timestamps (fixed epoch + sequence),
 *     no wall clock, so reads order identically across runs.
 */
import {
  type AppendArtifactsInput,
  type AppendArtifactsResult,
  type ArtifactStore,
  type M2ArtifactRecord,
  type ReadArtifactsOptions,
} from './types.js';
import { toArtifactRows } from './store.js';

const SYNTHETIC_EPOCH_MS = Date.UTC(2026, 0, 1);

export class InMemoryArtifactStore implements ArtifactStore {
  private readonly records = new Map<string, M2ArtifactRecord>();
  private sequence = 0;

  private key(scenarioId: string, turnId: string, index: number): string {
    return `${scenarioId}|${turnId}|${index}`;
  }

  async appendArtifacts(input: AppendArtifactsInput): Promise<AppendArtifactsResult> {
    const { rows, accounting } = toArtifactRows(input);
    let appended = 0;
    for (const row of rows) {
      const key = this.key(row.scenario_id, row.turn_id, row.artifact_index);
      if (this.records.has(key)) continue; // conflict-skip (unique index)
      this.sequence++;
      this.records.set(key, {
        ...row,
        id: `mem_${this.sequence}`,
        status: 'deferred',
        created_at: new Date(SYNTHETIC_EPOCH_MS + this.sequence).toISOString(),
      });
      appended++;
    }
    return { ...accounting, appended };
  }

  async readByScenario(
    scenarioId: string,
    opts?: ReadArtifactsOptions,
  ): Promise<readonly M2ArtifactRecord[]> {
    const statuses = opts?.statuses;
    const all = [...this.records.values()]
      .filter((r) => r.scenario_id === scenarioId)
      .filter((r) => (statuses ? statuses.includes(r.status) : true))
      .sort(
        (a, b) =>
          a.created_at.localeCompare(b.created_at) || a.artifact_index - b.artifact_index,
      );
    return opts?.limit !== undefined ? all.slice(0, opts.limit) : all;
  }

  async readByTurn(scenarioId: string, turnId: string): Promise<readonly M2ArtifactRecord[]> {
    return (await this.readByScenario(scenarioId)).filter((r) => r.turn_id === turnId);
  }
}
