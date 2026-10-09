import type { SupabaseClient } from '@supabase/supabase-js';
import { orderRunAnalysisFactsByTime } from '../context/freshness.js';

/** Stored run identity and frozen inputs; option rows remain a separate table. */
export interface AnalysisRunReadRow {
  readonly run_id: string;
  readonly scenario_id: string;
  readonly user_id: string | null;
  readonly scenario_revision: number | null;
  readonly revision_source: 'recorded' | 'legacy_unknown';
  readonly fact_created_at: string;
  readonly canonical_request_hash: string;
  readonly status: 'succeeded' | 'failed' | 'withheld';
  readonly computed_at: string | null;
  readonly graph_identity_hash: string | null;
  readonly input_snapshot: unknown;
  readonly fact_id: string;
  readonly created_at: string;
}

const RUN_READ_COLUMNS =
  'run_id, scenario_id, user_id, scenario_revision, revision_source, canonical_request_hash, status, computed_at:recorded_computed_at, graph_identity_hash, input_snapshot, fact_id, fact_created_at, created_at';

/** Read every successful row; transport pagination never chooses a Run. Still dormant. */
async function orderedRuns(client: Pick<SupabaseClient, 'from'>, scenarioId: string): Promise<AnalysisRunReadRow[]> {
  const rows: AnalysisRunReadRow[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from('analysis_runs').select(RUN_READ_COLUMNS)
      .eq('scenario_id', scenarioId).eq('status', 'succeeded')
      // Primary-key ordering is ONLY a deterministic transport page, never latest-Run selection.
      .order('fact_id', { ascending: true }).range(offset, offset + pageSize - 1).returns<AnalysisRunReadRow[]>();
    if (error) throw new Error(`readLatestRun failed: ${error.message}`, { cause: error });
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) break;
  }
  return orderRunAnalysisFactsByTime(rows, row => ({ created_at: row.fact_created_at, id: row.fact_id }));
}

/** Same canonical computed-time/insertion ordering as selectRunAnalysisFact. */
export async function readLatestRun(client: Pick<SupabaseClient, 'from'>, scenarioId: string): Promise<AnalysisRunReadRow | null> {
  return (await orderedRuns(client, scenarioId))[0] ?? null;
}
export async function readTwoLatestRuns(client: Pick<SupabaseClient, 'from'>, scenarioId: string): Promise<AnalysisRunReadRow[]> {
  return (await orderedRuns(client, scenarioId)).slice(0, 2);
}
