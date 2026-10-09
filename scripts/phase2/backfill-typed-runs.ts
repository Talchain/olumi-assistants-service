/** Explicit operator job; never imported/run by CI. Sweep history through CEE's ONE mapper/write door. */
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { SupabaseSessionStore } from '../../src/orchestrator-v5/session/supabase-store.js';
import { createAnalysisRunDerivationPort } from '../../src/orchestrator-v5/session/index.js';
import { SessionLRUCache } from '../../src/orchestrator-v5/session/cache.js';

export async function backfillTypedRuns(): Promise<void> {
  if (process.env.CI) throw new Error('Typed Run backfill is an operator job, not a CI task');
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const store = new SupabaseSessionStore(client, new SessionLRUCache({ maxScenarios: 1, maxTurnsPerScenario: 1 }), { defaultReadLimit: 20, analysisRunDerivation: createAnalysisRunDerivationPort(client) });
  // The durable watermark starts at -infinity and visits historical facts in
  // capped indexed windows. No extra writer or secondary mapper is involved.
  for (;;) {
    const counts = await store.deriveAnalysisRuns({ sweepLimit: 20 });
    if (counts.failed) throw new Error('Retryable drain failures; rerun to continue durable attempts');
    if (counts.depthEstimate === null) throw new Error('Another worker holds the sweep lease; rerun after expiry');
    if (counts.scanned === 0) break;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) console.log('SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node --import tsx scripts/phase2/backfill-typed-runs.ts\nOperator-only job: sweeps history in capped batches of 20; no schema apply.');
  else void backfillTypedRuns().catch(error => { console.error(error instanceof Error ? error.message : 'Backfill failed'); process.exitCode = 1; });
}
