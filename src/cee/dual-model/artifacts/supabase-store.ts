/**
 * Supabase ArtifactStore (quarantined scaffold — CONSTRUCTED BY NOTHING
 * LIVE; the cee_m2_artifacts migration is repo-owned and unapplied).
 *
 * Differences from the draft-failures store idiom, on purpose:
 *   - the client is INJECTED (no module singleton, no config read) so tests
 *     use a stub and constructing this class can never touch the network on
 *     its own;
 *   - append is best-effort and bounded: a short timeout race, and every
 *     failure swallows to a zero-counts result (artifact persistence must
 *     never break a turn).
 *
 * LOG-SAFETY: only ids, counts and coded errors are ever logged — artifact
 * bodies (question/rationale/evidence_pointer) never appear in any log or
 * telemetry argument (pinned by test).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from '../../../utils/telemetry.js';
import {
  type AppendArtifactsInput,
  type AppendArtifactsResult,
  type ArtifactStore,
  type M2ArtifactRecord,
  type ReadArtifactsOptions,
} from './types.js';
import { toArtifactRows } from './store.js';

export const M2_ARTIFACTS_TABLE = 'cee_m2_artifacts';

const DEFAULT_TIMEOUT_MS = 250;

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error('timeout')), timeoutMs);
    }),
  ]);
}

export interface SupabaseArtifactStoreOptions {
  readonly timeoutMs?: number;
}

export class SupabaseArtifactStore implements ArtifactStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly opts: SupabaseArtifactStoreOptions = {},
  ) {}

  private get timeoutMs(): number {
    return this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async appendArtifacts(input: AppendArtifactsInput): Promise<AppendArtifactsResult> {
    const { rows, accounting } = toArtifactRows(input);
    if (rows.length === 0) return accounting;
    try {
      const { data, error } = await withTimeout(
        this.client
          .from(M2_ARTIFACTS_TABLE)
          .upsert([...rows], {
            onConflict: 'scenario_id,turn_id,artifact_index',
            ignoreDuplicates: true,
          })
          .select('id'),
        this.timeoutMs,
      );
      if (error) {
        log.debug(
          { request_id: input.requestId, scenario_id: input.scenarioId, error_code: error.code },
          'dual-model artifact append failed; turn unaffected',
        );
        return { ...accounting, appended: 0 };
      }
      // ignoreDuplicates: conflicting rows are skipped — count what landed.
      return { ...accounting, appended: data?.length ?? 0 };
    } catch {
      log.debug(
        { request_id: input.requestId, scenario_id: input.scenarioId },
        'dual-model artifact append timed out or threw; turn unaffected',
      );
      return { ...accounting, appended: 0 };
    }
  }

  async readByScenario(
    scenarioId: string,
    opts?: ReadArtifactsOptions,
  ): Promise<readonly M2ArtifactRecord[]> {
    try {
      let query = this.client
        .from(M2_ARTIFACTS_TABLE)
        .select('*')
        .eq('scenario_id', scenarioId)
        .order('created_at', { ascending: true })
        .order('artifact_index', { ascending: true });
      if (opts?.statuses) query = query.in('status', [...opts.statuses]);
      if (opts?.limit !== undefined) query = query.limit(opts.limit);
      const { data, error } = await withTimeout(query, this.timeoutMs);
      if (error || !data) return [];
      return data as M2ArtifactRecord[];
    } catch {
      return [];
    }
  }

  async readByTurn(scenarioId: string, turnId: string): Promise<readonly M2ArtifactRecord[]> {
    try {
      const { data, error } = await withTimeout(
        this.client
          .from(M2_ARTIFACTS_TABLE)
          .select('*')
          .eq('scenario_id', scenarioId)
          .eq('turn_id', turnId)
          .order('created_at', { ascending: true })
          .order('artifact_index', { ascending: true }),
        this.timeoutMs,
      );
      if (error || !data) return [];
      return data as M2ArtifactRecord[];
    } catch {
      return [];
    }
  }
}
