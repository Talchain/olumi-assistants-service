/**
 * Context Architecture v2 — S4 rolling summary — module entry.
 *
 * ONE sanctioned production call site: the commit-seam maintainer
 * (`maintainRollingSummaryForCommit` in capture.ts, invoked from
 * src/orchestrator-v5/commit.ts after EVERY durable commit — unconditional
 * since the O-2 activation deleted CEE_ROLLING_SUMMARY; fire-and-forget —
 * failures never affect the turn).
 *
 * Env-read pattern — call-time, not module-load (mirrors decision-records/
 * index.ts): tests can stub env between cases, and importing this module never
 * crashes on missing SUPABASE_* creds; only an actual getRollingSummaryStore()
 * call on a flag-on path requires them.
 */

import { createClient } from '@supabase/supabase-js';

import { AnthropicSummariserModel } from './summariser.js';
import type { SummariserModel } from './summariser.js';
import { SupabaseRollingSummaryStore } from './store-adapter.js';
import type { RollingSummaryStorePort } from './store-adapter.js';

let cachedStore: RollingSummaryStorePort | null = null;
let cachedModel: SummariserModel | null = null;

export function getRollingSummaryStore(): RollingSummaryStorePort {
  if (cachedStore) return cachedStore;
  // eslint-disable-next-line no-restricted-syntax -- call-time read by design (see file header; mirrors decision-records/index.ts)
  const url = process.env.SUPABASE_URL;
  // eslint-disable-next-line no-restricted-syntax -- call-time read by design (see file header; mirrors decision-records/index.ts)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'RollingSummary: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set before calling getRollingSummaryStore()',
    );
  }
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cachedStore = new SupabaseRollingSummaryStore(client);
  return cachedStore;
}

export function getRollingSummaryModel(): SummariserModel {
  if (cachedModel) return cachedModel;
  cachedModel = new AnthropicSummariserModel();
  return cachedModel;
}

/** Test-only: reset the singletons so a subsequent call picks up fresh env. */
export function resetRollingSummaryForTests(): void {
  cachedStore = null;
  cachedModel = null;
}

export { SupabaseRollingSummaryStore, RollingSummaryStoreError } from './store-adapter.js';
export type {
  RollingSummaryStorePort,
  UpsertRollingSummaryOutcome,
} from './store-adapter.js';
export { AnthropicSummariserModel, SUMMARISER_SYSTEM_PROMPT, resolveSummaryModel } from './summariser.js';
export type { SummariserModel, SummariserModelResult } from './summariser.js';
