/** Explicit operator job; never imported/run by CI. Enqueue history, then use CEE's ONE mapper/write door. */
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { SupabaseSessionStore } from '../../src/orchestrator-v5/session/supabase-store.js';
import { SessionLRUCache } from '../../src/orchestrator-v5/session/cache.js';

export async function backfillTypedRuns(): Promise<void> {
  if (process.env.CI) throw new Error('Typed Run backfill is an operator job, not a CI task');
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const store = new SupabaseSessionStore(client, new SessionLRUCache({ maxScenarios: 1, maxTurnsPerScenario: 1 }), { defaultReadLimit: 20 });
  let cursor: string | undefined;
  for (;;) {
    let query = client.from('v5_handler_facts').select('id').eq('action_type', 'run_analysis').eq('noop', false)
      .order('id', { ascending: true }).limit(20);
    if (cursor !== undefined) query = query.gt('id', cursor);
    const { data, error } = await query.returns<Array<{ id: string }>>();
    if (error) throw new Error(`Historical fact page failed (${error.code})`);
    if (!data?.length) break;
    const ids = data.map(row => row.id);
    const [runs, quarantines] = await Promise.all([
      client.from('analysis_runs').select('fact_id').in('fact_id', ids).returns<Array<{ fact_id: string }>>(),
      client.from('analysis_run_quarantine').select('fact_id').in('fact_id', ids).returns<Array<{ fact_id: string }>>(),
    ]);
    if (runs.error || quarantines.error) throw new Error('Historical disposition read failed');
    const done = new Set([...(runs.data ?? []), ...(quarantines.data ?? [])].map(row => row.fact_id));
    const pending = ids.filter(id => !done.has(id));
    if (pending.length) {
      const queued = await client.from('analysis_run_queue').upsert(pending.map(fact_id => ({ fact_id })), { onConflict: 'fact_id', ignoreDuplicates: true });
      if (queued.error) throw new Error(`Historical enqueue failed (${queued.error.code})`);
      const counts = await store.deriveQueuedAnalysisRuns({ factIds: pending, sweepLimit: 20 });
      if (counts.failed) throw new Error('Drain had retryable failures; rerun after the 30-second claim lease');
    }
    cursor = ids[ids.length - 1];
  }
  // Recover missed enqueues and work from other writers, also bounded per sweep.
  for (;;) {
    const counts = await store.deriveQueuedAnalysisRuns({ sweepLimit: 20 });
    if (counts.failed) throw new Error('Drain had retryable failures; rerun after the 30-second claim lease');
    if (counts.derived + counts.quarantined + counts.skipped === 0) {
      if ((counts.queueDepth ?? 0) > 0) throw new Error('Other workers/crashed leases remain; rerun after 30 seconds');
      break;
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) console.log('SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node --import tsx scripts/phase2/backfill-typed-runs.ts\nOperator-only job: enqueues history and drains in capped batches of 20; no schema apply.');
  else void backfillTypedRuns().catch(error => { console.error(error instanceof Error ? error.message : 'Backfill failed'); process.exitCode = 1; });
}
