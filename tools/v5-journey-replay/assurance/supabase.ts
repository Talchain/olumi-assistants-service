/**
 * V5 staging assurance — Supabase access (MANUAL / LOCAL ONLY).
 *
 * Reuses the connection pattern from `scripts/wave0-staging-probe.mjs`:
 * load `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `.env.staging.local`
 * and `createClient` with sessions disabled. Service-role is REQUIRED — the
 * scenario-keyed tables have RLS (`auth.uid() = user_id`) and assurance
 * scenarios are guest rows (`user_id IS NULL`), so a user JWT cannot read or
 * delete them; the service-role key bypasses RLS.
 *
 * SECURITY (Paul's decision, 2026-06-26): the service-role key is for the
 * LOCAL/MANUAL `pnpm assurance:v5:staging` command only and MUST NOT be put
 * into CI. This module never prints secret values.
 *
 * This file is the single place that imports `@supabase/supabase-js`. Reads
 * live in `./facts.ts`; cleanup logic lives in `./cleanup.ts` and talks to
 * Supabase only through the `TableAccess` abstraction returned here (so the
 * cleanup unit tests can mock it without a database).
 */

import { readFileSync } from 'node:fs';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface StagingEnv {
  readonly [key: string]: string;
}

/**
 * Parse a dotenv-style file into a flat string map. Mirrors the loader in
 * `scripts/wave0-staging-probe.mjs` (KEY=VALUE, quote-stripped). Returns an
 * empty map if the file is absent so the caller can produce a precise
 * "missing credentials" blocker rather than throwing on a missing file.
 */
export function loadStagingEnv(path: string): StagingEnv {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const env: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
  return env;
}

/**
 * Resolve a value from the loaded staging-env file first, then
 * `process.env`. The file is the canonical source for the manual command;
 * process.env is a convenience override for ad-hoc runs.
 */
export function resolveEnv(
  fileEnv: StagingEnv,
  name: string,
): string | undefined {
  const fromFile = fileEnv[name];
  if (fromFile !== undefined && fromFile.trim().length > 0) return fromFile;
  const fromProc = process.env[name];
  if (fromProc !== undefined && fromProc.trim().length > 0) return fromProc;
  return undefined;
}

export function createSupabaseClient(
  url: string,
  serviceRoleKey: string,
): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------------------------------------------------------------------------
// TableAccess — the narrow surface cleanup needs. Implemented here against
// supabase-js; mocked in cleanup unit tests.
// ---------------------------------------------------------------------------

export interface TableOpResult {
  /** Rows counted (count op) or deleted (remove op). 0 when table missing. */
  readonly count: number;
  /** True when the relation does not exist on this DB (tolerated, not a failure). */
  readonly tableMissing: boolean;
  /** Present when the op failed for a reason OTHER than a missing table. */
  readonly error?: string;
}

export interface TableAccess {
  count(
    table: string,
    scopeColumn: string,
    ids: readonly string[],
  ): Promise<TableOpResult>;
  remove(
    table: string,
    scopeColumn: string,
    ids: readonly string[],
  ): Promise<TableOpResult>;
}

/**
 * Detect a "relation does not exist" / "could not find the table" error so
 * cleanup can tolerate scenario-keyed tables that are absent on a given
 * deploy (the contract: tolerate zero rows AND missing tables). Anything
 * else is a real error and must be surfaced.
 */
export function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST204') return true;
  const message = (err as { message?: unknown }).message;
  if (typeof message === 'string') {
    return /does not exist|could not find the table|relation .* does not exist|schema cache/i.test(
      message,
    );
  }
  return false;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run a Supabase op, retrying ONCE after a short delay on a transient
 * (non-missing-table) error — covers PostgREST schema-cache / connection
 * blips that otherwise flake the residual-verify gate red.
 */
async function withRetry(
  op: () => Promise<{ count: number | null; error: { message?: string } | null }>,
): Promise<TableOpResult> {
  let last: { count: number | null; error: { message?: string } | null } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    last = await op();
    if (!last.error) return { count: last.count ?? 0, tableMissing: false };
    if (isMissingTableError(last.error)) return { count: 0, tableMissing: true };
    if (attempt === 0) await delay(300);
  }
  return { count: 0, tableMissing: false, error: last?.error?.message ?? 'unknown error' };
}

export function makeSupabaseTableAccess(client: SupabaseClient): TableAccess {
  return {
    async count(table, scopeColumn, ids) {
      if (ids.length === 0) return { count: 0, tableMissing: false };
      return withRetry(async () => {
        const { count, error } = await client
          .from(table)
          .select('*', { count: 'exact', head: true })
          .in(scopeColumn, ids as string[]);
        return { count, error };
      });
    },
    async remove(table, scopeColumn, ids) {
      if (ids.length === 0) return { count: 0, tableMissing: false };
      return withRetry(async () => {
        const { count, error } = await client
          .from(table)
          .delete({ count: 'exact' })
          .in(scopeColumn, ids as string[]);
        return { count, error };
      });
    },
  };
}
