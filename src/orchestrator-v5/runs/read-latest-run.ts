import type { SupabaseClient } from '@supabase/supabase-js';

/** Stored run identity and frozen inputs; option rows remain a separate table. */
export interface AnalysisRunReadRow {
  readonly run_id: string;
  readonly scenario_id: string;
  readonly user_id: string | null;
  readonly scenario_revision: number;
  readonly canonical_request_hash: string;
  readonly status: 'succeeded' | 'failed' | 'withheld';
  readonly computed_at: string;
  readonly graph_identity_hash: string | null;
  readonly input_snapshot: unknown;
  readonly fact_id: string;
  readonly created_at: string;
}

const RUN_READ_COLUMNS =
  'run_id, scenario_id, user_id, scenario_revision, canonical_request_hash, status, computed_at, graph_identity_hash, input_snapshot, fact_id, created_at';

/** Service-role reader. An unsuccessful read throws; only no row means null. */
export async function readLatestRun(
  client: Pick<SupabaseClient, 'from'>,
  scenarioId: string,
): Promise<AnalysisRunReadRow | null> {
  const { data, error } = await client
    .from('latest_successful_run')
    .select(RUN_READ_COLUMNS)
    .eq('scenario_id', scenarioId)
    .order('scenario_revision', { ascending: false })
    .order('computed_at', { ascending: false })
    .order('run_id', { ascending: false })
    .limit(1)
    .returns<AnalysisRunReadRow[]>();
  if (error) {
    throw new Error(`readLatestRun failed: ${error.message}`, { cause: error });
  }
  return data?.[0] ?? null;
}

/** The same successful-run ordering as the view, retaining the previous run. */
export async function readTwoLatestRuns(
  client: Pick<SupabaseClient, 'from'>,
  scenarioId: string,
): Promise<AnalysisRunReadRow[]> {
  const { data, error } = await client
    .from('analysis_runs')
    .select(RUN_READ_COLUMNS)
    .eq('scenario_id', scenarioId)
    .eq('status', 'succeeded')
    .order('scenario_revision', { ascending: false })
    .order('computed_at', { ascending: false })
    .order('run_id', { ascending: false })
    .limit(2)
    .returns<AnalysisRunReadRow[]>();
  if (error) {
    throw new Error(`readTwoLatestRuns failed: ${error.message}`, { cause: error });
  }
  return data ?? [];
}
