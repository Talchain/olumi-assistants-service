/**
 * Decision Records v1 (ROADMAP 3.1, CEE half) — module entry.
 *
 * ONE sanctioned production call site: the commit-seam capture hook
 * (`recordDecisionRecordForCommit` in capture.ts, invoked from
 * src/orchestrator-v5/commit.ts after a durable commit carrying a
 * successful run_analysis fact — UNCONDITIONAL since #539 deleted
 * CEE_DECISION_RECORD_CAPTURE, Paul's 19 Jul no-dark-launch ruling;
 * fire-and-forget — failures never affect the turn).
 *
 * Env-read pattern — call-time, not module-load (mirrors
 * model-management/index.ts and session/index.ts and their documented
 * rationale): tests can stub env between cases, and importing this module
 * never crashes on missing SUPABASE_* creds; only an actual
 * `getDecisionRecordStore()` call on a capture path requires them.
 */

import { createClient } from '@supabase/supabase-js';

import { SupabaseDecisionRecordStore } from './store-adapter.js';
import type { DecisionRecordStorePort } from './store-adapter.js';

let cachedInstance: DecisionRecordStorePort | null = null;

export function getDecisionRecordStore(): DecisionRecordStorePort {
  if (cachedInstance) return cachedInstance;
  // eslint-disable-next-line no-restricted-syntax -- call-time read by design (see file header; mirrors model-management/index.ts)
  const url = process.env.SUPABASE_URL;
  // eslint-disable-next-line no-restricted-syntax -- call-time read by design (see file header; mirrors model-management/index.ts)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'DecisionRecords: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set before calling getDecisionRecordStore()',
    );
  }
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cachedInstance = new SupabaseDecisionRecordStore(client);
  return cachedInstance;
}

/** Test-only: reset the singleton so a subsequent call picks up fresh env. */
export function resetDecisionRecordStoreForTests(): void {
  cachedInstance = null;
}

export {
  SupabaseDecisionRecordStore,
  DecisionRecordSignInRequiredError,
  DecisionRecordStoreError,
} from './store-adapter.js';
export { DECISION_RECORDS_HARD_CAP } from './store-adapter.js';
export type {
  CreateDecisionRecordWrite,
  DecisionRecordWriteOutcome,
  DecisionRecordStorePort,
  DecisionRecordRead,
  RetrieveDecisionRecordsOpts,
} from './store-adapter.js';
export {
  projectDecisionRecords,
  loadOlderRelevantFactsSection,
  type DecisionRecordsProjection,
} from './project.js';
