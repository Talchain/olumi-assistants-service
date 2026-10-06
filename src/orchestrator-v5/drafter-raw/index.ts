/**
 * ⭐ THE DRAFTER'S RAW ANSWER, KEPT FOR EVERY SERVED DRAFT — the hook and the store.
 *
 * ONE sanctioned production call site: `buildModelFromBrief` in `agent-lane/runtime/agent-capabilities.ts` (the served
 * agent lane's only construction, reached from `hostFirstCall` and from the Agent's own `build_model_from_brief`).
 * `buildWithDrafterRawRecord` wraps the drafter, lets the build run exactly as before, then writes ONE row per draft
 * that made at least one drafter call. A replayed construction makes no call and writes nothing.
 *
 * ⛔ THE DATABASE IS SHARED WITH PRODUCTION AND WITH OLDER PINNED SERVICES. So:
 *   · the row goes to its OWN table (`cee_drafter_raw_responses`), which no session window reads at any pin — never a
 *     new fact/row type in `v5_handler_facts` / `v5_conversation_turns`, whose windows (`readRecent` → `prior_facts`)
 *     an older service counts;
 *   · the table is created by a migration the DL applies. Until then every write fails with "relation not found" and
 *     is LOGGED AND SKIPPED, so merging before the migration is a no-op;
 *   · the write is fire-and-forget and bounded: the draft never waits on it, and no outcome of it reaches the turn.
 *
 * Env-read pattern — call-time, not module-load (mirrors `brief-provenance/index.ts`): absent SUPABASE_* creds mean
 * no store, and no store means nothing is written (a local or test service).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { GIT_COMMIT_SHA } from '../../version.js';
import { getRuntimeEnvResolution } from '../../config/env-resolver.js';
import { log } from '../../utils/telemetry.js';
import type { CallStructuredModel } from '../agent-lane/runtime/build-model.js';
import { DRAFTER_RAW_TABLE, drafterRawRow, recordingDrafter, type DrafterCallRecord, type DrafterRawRow } from './record.js';

export { DRAFTER_RAW_TABLE, DRAFTER_RAW_MAX_BYTES, capRawResponse, truncationMarker } from './record.js';
export type { DrafterRawRow, DrafterCallRecord } from './record.js';

/** How long a write may take before it is abandoned (it never delays the turn either way). */
const WRITE_TIMEOUT_MS = 5_000;

/** `written` · `table_absent` (migration not applied yet) · `failed` (any other refusal, or a throw/timeout). */
export type DrafterRawWriteOutcome = 'written' | 'table_absent' | 'failed';

export interface DrafterRawStorePort {
  insert(row: DrafterRawRow): Promise<DrafterRawWriteOutcome>;
}

/** PostgREST / Postgres codes for "this table does not exist" — the pre-migration state. */
const TABLE_ABSENT_CODES = new Set(['PGRST205', '42P01']);

export class SupabaseDrafterRawStore implements DrafterRawStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async insert(row: DrafterRawRow): Promise<DrafterRawWriteOutcome> {
    const { error } = await this.client
      .from(DRAFTER_RAW_TABLE)
      .insert(row)
      .abortSignal(AbortSignal.timeout(WRITE_TIMEOUT_MS));
    if (error === null) return 'written';
    const code = typeof error.code === 'string' ? error.code : '';
    if (TABLE_ABSENT_CODES.has(code) || /could not find the table|does not exist/i.test(error.message ?? '')) return 'table_absent';
    log.warn({ site: 'drafter-raw.insert', code, message: String(error.message ?? '').slice(0, 200) }, 'drafter-raw: insert refused; skipped');
    return 'failed';
  }
}

let cachedStore: DrafterRawStorePort | null = null;

/** The store, or `null` when this service has no Supabase credentials (nothing is written). */
export function getDrafterRawStore(): DrafterRawStorePort | null {
  if (cachedStore !== null) return cachedStore;
  // eslint-disable-next-line no-restricted-syntax -- call-time read by design (see file header; mirrors brief-provenance/index.ts)
  const url = process.env.SUPABASE_URL;
  // eslint-disable-next-line no-restricted-syntax -- call-time read by design (see file header; mirrors brief-provenance/index.ts)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  cachedStore = new SupabaseDrafterRawStore(createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }));
  return cachedStore;
}

/** Test-only: drop the cached store so the next call reads env afresh. */
export function resetDrafterRawStoreForTests(): void {
  cachedStore = null;
}

const pending = new Set<Promise<void>>();

/** Test-only: wait for every write started so far to settle (they are never awaited by the turn). */
export async function settleDrafterRawWritesForTests(): Promise<void> {
  await Promise.all([...pending]);
}

/** Write one row, fire-and-forget. Never throws, never rejects, never blocks the caller. */
export function persistDrafterRawRow(row: DrafterRawRow, store: DrafterRawStorePort | null = safeStore()): void {
  if (store === null) {
    log.debug({ site: 'drafter-raw.persist', scenario_id: row.scenario_id }, 'drafter-raw: no store configured; skipped');
    return;
  }
  const p = (async () => {
    try {
      const outcome = await store.insert(row);
      if (outcome === 'table_absent') {
        log.info({ site: 'drafter-raw.persist', table: DRAFTER_RAW_TABLE, scenario_id: row.scenario_id }, 'drafter-raw: table absent (migration not applied); skipped');
      } else if (outcome === 'written') {
        log.debug({ site: 'drafter-raw.persist', scenario_id: row.scenario_id, calls: row.calls.length }, 'drafter-raw: written');
      }
    } catch (err) {
      log.warn({ site: 'drafter-raw.persist', err: String(err).slice(0, 200) }, 'drafter-raw: write failed; skipped');
    }
  })();
  pending.add(p);
  void p.finally(() => pending.delete(p));
}

function safeStore(): DrafterRawStorePort | null {
  try { return getDrafterRawStore(); } catch { return null; }
}

function renderServiceName(): string | null {
  // eslint-disable-next-line no-restricted-syntax -- call-time read by design: which of the services sharing the DB wrote the row
  const name = process.env.RENDER_SERVICE_NAME;
  return typeof name === 'string' && name.length > 0 ? name.slice(0, 120) : null;
}

/**
 * ⭐ THE HOOK. Runs `build` with a recording drafter and, once it returns (or throws), writes ONE row for the draft if
 * the drafter was called at all. The build's result — or its throw — is passed through untouched.
 */
export async function buildWithDrafterRawRecord<T extends { readonly ok: boolean; readonly [k: string]: unknown }>(
  ctx: { readonly scenario_id: string; readonly request_id: string },
  brief: string,
  operationId: string,
  callStructured: CallStructuredModel,
  build: (drafter: CallStructuredModel) => Promise<T>,
): Promise<T> {
  const calls: DrafterCallRecord[] = [];
  let built: T | undefined;
  try {
    built = await build(recordingDrafter(callStructured, calls));
    return built;
  } finally {
    if (calls.length > 0) {
      try {
        const env = getRuntimeEnvResolution();
        persistDrafterRawRow(drafterRawRow({
          scenarioId: ctx.scenario_id, operationId, requestId: ctx.request_id, brief, built, calls,
          ceeBuild: GIT_COMMIT_SHA, environment: env.env, environmentSource: env.source, renderService: renderServiceName(),
        }));
      } catch { /* keeping a record never costs the draft */ }
    }
  }
}
