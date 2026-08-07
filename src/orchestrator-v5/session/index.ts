/**
 * V5 session store singleton factory (slice B).
 *
 * Exposes `getSessionStore()` returning a cached Supabase-backed store. The
 * store is constructed on first call; subsequent calls return the same
 * instance.
 *
 * Env-read pattern — DELIBERATELY call-time, not module-load:
 *
 *   1. Matches the budgets.ts pattern (budgets.ts:36-48) — parse env at
 *      every call so tests can `vi.stubEnv` between cases.
 *   2. Decouples import-graph initialisation from env presence. A module
 *      that transitively imports `session/index.ts` will not crash at
 *      import time if SUPABASE_* is unset; it crashes only on a code path
 *      that actually calls `getSessionStore()`. This matters for test
 *      suites that exercise non-persistence paths without Supabase creds.
 *   3. Fails FAST on first call if required env is missing — we still
 *      want a clear error, just not a module-load-time one.
 *
 * Future maintainers: do NOT "optimise" this back to module-load env reads.
 * The pattern is intentional and documented in Docs/v5/slice-b-plan.md
 * (deviation 3). See Paul's 2026-04-18 refinement note.
 */

import { createClient } from '@supabase/supabase-js';

import { SessionLRUCache } from './cache.js';
import { SupabaseSessionStore } from './supabase-store.js';
import type { SessionStore } from './store.js';
import { config as appConfig } from '../../config/index.js';

interface ResolvedConfig {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly readWindow: number;
  readonly cacheMaxScenarios: number;
  readonly cacheMaxTurnsPerScenario: number;
}

export const SESSION_READ_WINDOW_DEFAULT = 20;
export const SESSION_CACHE_MAX_SCENARIOS_DEFAULT = 100;
export const SESSION_CACHE_MAX_TURNS_PER_SCENARIO_DEFAULT = 50;

let cachedInstance: SessionStore | null = null;

export function getSessionStore(): SessionStore {
  if (cachedInstance) return cachedInstance;
  const config = readConfig();
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const cache = new SessionLRUCache({
    maxScenarios: config.cacheMaxScenarios,
    maxTurnsPerScenario: config.cacheMaxTurnsPerScenario,
  });
  cachedInstance = new SupabaseSessionStore(client, cache, {
    defaultReadLimit: config.readWindow,
    // A3 graph CAS observe-mode (CEE_V5_GRAPH_CAS_MODE via the central Zod
    // config, which owns the off|observe|enforce parse + the prod
    // enforce→observe downgrade). Default 'off' — zero behavioural change.
    graphCasMode: appConfig.features.graphCasMode,
    // ATOMIC graph CAS commit RPC (CEE_V5_GRAPH_CAS_RPC — off|shadow|enforce).
    // Default 'off' → append_turn_atomic_v2 exactly as today. Requires
    // migration 20260717120000 (Paul-gated) live before any non-'off' value.
    graphCasRpc: appConfig.features.graphCasRpc,
  });
  return cachedInstance;
}

/**
 * Test-only: reset the singleton so a subsequent `getSessionStore()` picks up
 * fresh env. Exported because vi.stubEnv alone can't bust the cached client.
 */
export function resetSessionStoreForTests(): void {
  cachedInstance = null;
}

function readConfig(): ResolvedConfig {
  // Call-time env read — see file-level comment above.
  // eslint-disable-next-line no-restricted-syntax -- ISSUE-9020 call-time read: tolerates env rotation without restart (see file header)
  const url = process.env.SUPABASE_URL;
  // eslint-disable-next-line no-restricted-syntax -- ISSUE-9020 call-time read: tolerates env rotation without restart (see file header)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'SessionStore: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set before calling getSessionStore()',
    );
  }
  return {
    url,
    serviceRoleKey,
    readWindow: parsePositiveIntEnv(
      // eslint-disable-next-line no-restricted-syntax -- ISSUE-9020 call-time read: tolerates env rotation without restart (see file header)
      process.env.SESSION_READ_WINDOW_TURNS,
      SESSION_READ_WINDOW_DEFAULT,
    ),
    cacheMaxScenarios: parsePositiveIntEnv(
      // eslint-disable-next-line no-restricted-syntax -- ISSUE-9020 call-time read: tolerates env rotation without restart (see file header)
      process.env.SESSION_CACHE_MAX_SCENARIOS,
      SESSION_CACHE_MAX_SCENARIOS_DEFAULT,
    ),
    cacheMaxTurnsPerScenario: parsePositiveIntEnv(
      // eslint-disable-next-line no-restricted-syntax -- ISSUE-9020 call-time read: tolerates env rotation without restart (see file header)
      process.env.SESSION_CACHE_MAX_TURNS_PER_SCENARIO,
      SESSION_CACHE_MAX_TURNS_PER_SCENARIO_DEFAULT,
    ),
  };
}

function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

export type { SessionStore, SessionTurnWrite } from './store.js';
export { StateCommitFailedError, SessionReadError } from './store.js';
export type { InvalidationScope, InvalidationResult } from './invalidation.js';
export { describeScope } from './invalidation.js';
