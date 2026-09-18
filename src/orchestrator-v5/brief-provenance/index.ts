/**
 * Brief + analysis-provenance (ROADMAP 2.1229, CEE half) — module entry.
 *
 * ONE sanctioned production call site: the commit-seam hook
 * (`recordBriefProvenanceForCommit` in capture.ts, invoked from
 * src/orchestrator-v5/commit.ts after a durable commit carrying a
 * successful run_analysis fact; fire-and-forget — failures never affect
 * the turn).
 *
 * Env-read pattern — call-time, not module-load (mirrors
 * decision-records/index.ts and its documented rationale): tests can stub
 * env between cases, and importing this module never crashes on missing
 * SUPABASE_* creds. This is also what makes the hook's byte-identical
 * property REAL rather than nominal — a commit with no qualifying fact
 * never calls `getBriefProvenanceStore()`, so it performs no env read and
 * constructs no client.
 */

import { createClient } from '@supabase/supabase-js';

import { SupabaseBriefProvenanceStore } from './store-adapter.js';
import type { BriefProvenanceStorePort } from './store-adapter.js';

let cachedInstance: BriefProvenanceStorePort | null = null;

export function getBriefProvenanceStore(): BriefProvenanceStorePort {
  if (cachedInstance) return cachedInstance;
  // eslint-disable-next-line no-restricted-syntax -- call-time read by design (see file header; mirrors decision-records/index.ts)
  const url = process.env.SUPABASE_URL;
  // eslint-disable-next-line no-restricted-syntax -- call-time read by design (see file header; mirrors decision-records/index.ts)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'BriefProvenance: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set before calling getBriefProvenanceStore()',
    );
  }
  // SERVICE ROLE — `store_brief_and_provenance` is granted to service_role
  // only. See the adapter header for why a user session is the wrong client
  // here, not merely an unnecessary one.
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cachedInstance = new SupabaseBriefProvenanceStore(client);
  return cachedInstance;
}

/** Test-only: reset the singleton so a subsequent call picks up fresh env. */
export function resetBriefProvenanceStoreForTests(): void {
  cachedInstance = null;
}

export { SupabaseBriefProvenanceStore, BriefProvenanceStoreError } from './store-adapter.js';
export type {
  BriefProvenanceStorePort,
  StoreBriefAndProvenanceWrite,
} from './store-adapter.js';
