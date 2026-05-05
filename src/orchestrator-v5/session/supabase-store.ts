/**
 * Supabase-backed SessionStore implementation (slice B).
 *
 * Writes: exclusively via the `append_turn_atomic` RPC — idempotent via
 * `ON CONFLICT (scenario_id, turn_id) DO NOTHING`. Callers pass a client-
 * generated `turn_id`; two concurrent calls with identical keys return the
 * same row `id` and neither raises.
 *
 * Reads: direct SELECT from `v5_conversation_turns` with ORDER BY created_at
 * DESC + LIMIT. The `readFactsFor` path queries `v5_handler_facts` with the
 * parent turn-id list; Slice B rarely invokes it (no handlers emit facts
 * yet) but the path is exercised by tests.
 *
 * Cache interaction: RPC success → cache prepend → return. Cache invalidation
 * primitives are delegated to the LRU layer; Supabase rows are never
 * mutated or deleted by this module (history is immutable).
 *
 * Pressure-test (pre-implementation review) decisions codified here:
 *   1. Commit ordering: RPC success before cache prepend. Never prepend
 *      optimistically — a failing RPC would leave the cache ahead of DB.
 *   2. readFactsFor is lazy (brief deviation 2) — separate method, NOT joined
 *      into readRecent. Facts are opt-in for handlers that need them.
 *   3. Read errors throw `SessionReadError` so callers can choose to degrade
 *      gracefully; they never crash the turn.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  HandlerFactSchema,
  SessionTurnSchema,
  type HandlerFact,
  type SessionTurn,
  type V5ActionType,
} from '@talchain/schemas/orchestrator';

import type { SessionLRUCache } from './cache.js';
import type { InvalidationResult, InvalidationScope } from './invalidation.js';
import {
  SessionReadError,
  StateCommitFailedError,
  type SessionStore,
  type SessionTurnWrite,
} from './store.js';
import { parsePendingAction, type PendingAction } from './pending-action.js';

const V5_CONVERSATION_TURN_COLUMNS =
  'id, scenario_id, user_id, turn_id, turn_class, handler_id, request_hash, response_emitted, llm_calls_used, duration_ms, created_at';

interface SupabaseErrorLike {
  message?: string;
  code?: string;
}

function errMsg(e: unknown): string {
  return (e as SupabaseErrorLike | null)?.message ?? String(e);
}

function errCode(e: unknown): string | undefined {
  return (e as SupabaseErrorLike | null)?.code ?? undefined;
}

export interface SupabaseSessionStoreOptions {
  readonly defaultReadLimit: number;
}

export class SupabaseSessionStore implements SessionStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly cache: SessionLRUCache,
    private readonly options: SupabaseSessionStoreOptions,
  ) {}

  async append(write: SessionTurnWrite): Promise<{ id: string }> {
    // PostgREST overload disambiguation: always pass all 11 named args,
    // including p_graph and p_brief_text as `null` when absent. Omitting
    // either would make PostgREST consider lower-arity overloads as
    // candidates, and if a stale 9-arg or 10-arg version of
    // append_turn_atomic ever coexisted with the current 11-arg signature,
    // the request would fail with
    // "Could not choose the best candidate function between …".
    //
    // This was the root cause of the V5 Step 4 staging failure (request_id
    // 99a83f32-…, 2026-04-26): migration 20260422210000 added a 10-arg
    // overload via CREATE OR REPLACE, which does not drop a different
    // arity. The fix migration
    // 20260426160532_v5_drop_stale_append_turn_atomic_overload.sql drops
    // the stale 9-arg version, and 20260502120000_v5_brief_text_persistence
    // drops the 10-arg version when adding the 11-arg version. This
    // client-side change is defence-in-depth so any future overload
    // reintroduction does not silently wedge commits.
    //
    // Brief-text write-once: the RPC silently ignores subsequent
    // brief_text writes via its `WHERE brief_text IS NULL OR brief_text = ''`
    // predicate. Future briefText updates after the initial draft turn
    // will not persist. Regenerate semantics are out of scope for Phase 1.
    // PostgREST overload disambiguation continues post-Wave-0: always pass
    // all 12 named args. p_pending_actions defaults to an empty array on
    // omit, both at the wire (here) and the RPC body. The DB column is
    // NOT NULL with the same default — old rows backfill implicitly.
    const { data, error } = await this.client.rpc('append_turn_atomic', {
      p_scenario_id: write.scenario_id,
      p_turn_id: write.turn_id,
      p_turn_class: write.turn_class,
      p_handler_id: write.handler_id,
      p_request_hash: write.request_hash,
      p_response_emitted: write.response_emitted,
      p_llm_calls_used: write.llm_calls_used,
      p_duration_ms: write.duration_ms,
      p_handler_facts: serialiseHandlerFacts(write.handler_facts),
      p_graph: write.graph ?? null,
      p_brief_text: write.briefText ?? null,
      p_pending_actions: write.pending_actions ?? [],
    });

    if (error) {
      throw new StateCommitFailedError(
        `append_turn_atomic RPC failed: ${errMsg(error)}`,
        { cause: error, rpc_code: errCode(error) },
      );
    }
    if (typeof data !== 'string') {
      throw new StateCommitFailedError(
        `append_turn_atomic returned non-string id: ${JSON.stringify(data)}`,
      );
    }

    // Commit ordering (pressure-test §1): RPC success → cache evict → return.
    // Evicting (rather than optimistically prepending) is the correct move
    // because the RPC return carries only the row id — we do not have
    // user_id or the server-assigned created_at, and constructing a
    // partial SessionTurn would violate SessionTurnSchema.strict()
    // invariants. The next readRecent pays one DB round-trip and is
    // guaranteed consistent. Cache-ahead-of-DB is impossible.
    this.cache.invalidateAll(write.scenario_id);

    return { id: data };
  }

  async readRecent(
    scenarioId: string,
    limit: number = this.options.defaultReadLimit,
  ): Promise<readonly SessionTurn[]> {
    // Cache hit iff: we have enough cached turns OR the cache holds the
    // complete (exhausted) history for this scenario. Without the
    // `complete` check, a short-history scenario (DB has 2 turns) would
    // re-query DB on every read with a default limit of 20.
    const cached = this.cache.getScenario(scenarioId);
    if (cached && (cached.complete || cached.turns.length >= limit)) {
      return cached.turns.slice(0, limit);
    }

    const { data, error } = await this.client
      .from('v5_conversation_turns')
      .select(V5_CONVERSATION_TURN_COLUMNS)
      .eq('scenario_id', scenarioId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new SessionReadError(
        `readRecent(${scenarioId}) failed: ${errMsg(error)}`,
        { cause: error, code: errCode(error) },
      );
    }

    const rows = (data ?? []) as unknown[];
    const turns: SessionTurn[] = [];
    for (const row of rows) {
      const parsed = SessionTurnSchema.safeParse(row);
      if (parsed.success) {
        turns.push(parsed.data);
      } else {
        // Row shape drift — throw so the caller (build-turn-context) can
        // emit session.read_degraded telemetry and continue with empty
        // history. Without this throw, silent data corruption could
        // propagate to handlers.
        throw new SessionReadError(
          `readRecent(${scenarioId}): row failed SessionTurnSchema — ${parsed.error.message}`,
          { cause: parsed.error },
        );
      }
    }
    // Complete iff DB returned fewer rows than the caller's limit — more
    // rows would have been returned if they existed.
    this.cache.populate(scenarioId, turns, { complete: turns.length < limit });
    return turns;
  }

  async readFactsFor(
    conversationTurnRowIds: readonly string[],
    handlerId?: V5ActionType,
  ): Promise<readonly HandlerFact[]> {
    if (conversationTurnRowIds.length === 0) return [];

    // V5 review: facts must come back newest-first so callers (e.g. the
    // run_analysis fallback in `buildAnalysisFromPriorFacts`) can pick the
    // most recent entry deterministically via `.find()`. The prior
    // implementation relied on undefined Supabase row order, which made the
    // selection non-deterministic.
    //
    // Index note: the existing `v5_handler_facts_turn_idx` on
    // `v5_conversation_turn_id` covers the `IN` filter; the `ORDER BY
    // created_at DESC` is done in memory by Postgres after the filtered
    // rows are fetched. For the expected N (at most a handful of handler
    // turns per scenario, typically one fact each) this in-memory sort is
    // negligible. A composite
    // `(v5_conversation_turn_id, created_at DESC)` index would cover the
    // ORDER BY if N grows; flagged as a potential follow-up, not required
    // for the current workload.
    let query = this.client
      .from('v5_handler_facts')
      .select('payload, handler_id, action_type, noop')
      .in('v5_conversation_turn_id', conversationTurnRowIds as string[])
      .order('created_at', { ascending: false });

    if (handlerId) {
      query = query.eq('handler_id', handlerId);
    }

    const { data, error } = await query;

    if (error) {
      throw new SessionReadError(
        `readFactsFor failed: ${errMsg(error)}`,
        { cause: error, code: errCode(error) },
      );
    }

    // DB stores the wire-shape HandlerFact inside the `payload` JSONB column
    // (see schemas audit §observations); unwrap and parse.
    //
    // Hydration: the write path (`mapFactsForRpc`) intentionally splits the
    // wire shape — `payload` JSONB carries `{fact_type, fact_version, result}`
    // while `noop` lives on its own column for SQL-level filtering. The read
    // path must rejoin them before validation, otherwise `HandlerFactSchema`
    // (which is `.strict()` and requires `noop`) rejects every row and
    // `prior_facts` is silently empty for callers (analysis fallback,
    // coaching-cache reader, …). Prefer `row.noop`; fall through to a
    // payload-side `noop` if a future writer puts it there; default to
    // `false` so a missing column on legacy rows still parses.
    const facts: HandlerFact[] = [];
    for (const row of (data ?? []) as Array<{ payload: unknown; noop?: unknown }>) {
      const payloadObj =
        row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : {};
      const noop =
        typeof row.noop === 'boolean'
          ? row.noop
          : typeof payloadObj.noop === 'boolean'
            ? (payloadObj.noop as boolean)
            : false;
      const hydrated = { ...payloadObj, noop };
      const parsed = HandlerFactSchema.safeParse(hydrated);
      if (parsed.success) {
        facts.push(parsed.data);
      } else {
        throw new SessionReadError(
          `readFactsFor: payload failed HandlerFactSchema — ${parsed.error.message}`,
          { cause: parsed.error },
        );
      }
    }
    return facts;
  }

  async invalidateScoped(
    scenarioId: string,
    scope: InvalidationScope,
  ): Promise<InvalidationResult> {
    return this.cache.invalidateScoped(scenarioId, scope);
  }

  async invalidateAll(scenarioId: string): Promise<InvalidationResult> {
    return this.cache.invalidateAll(scenarioId);
  }

  async storeDraftGraph(scenarioId: string, graph: unknown): Promise<void> {
    const { error } = await this.client.rpc('store_draft_graph', {
      p_scenario_id: scenarioId,
      p_graph: graph,
    });
    if (error) {
      throw new StateCommitFailedError(
        `store_draft_graph RPC failed for scenario ${scenarioId}: ${errMsg(error)}`,
        { cause: error, rpc_code: errCode(error) },
      );
    }
  }

  async loadGraph(scenarioId: string): Promise<unknown | null> {
    return (await this.loadGraphAndBriefText(scenarioId)).graph;
  }

  async loadGraphAndBriefText(scenarioId: string): Promise<{
    readonly graph: unknown | null;
    readonly briefText: string | null;
  }> {
    // Note: scenarios.* fields are NOT cached by SessionLRUCache (which
    // is scoped to v5_conversation_turns). Every call hits Supabase
    // directly. The cache is invalidated on `append`, but reads here
    // bypass it because the cache holds a different table's rows.
    // SELECT only the columns this method returns. `id` is intentionally
    // omitted because it is already known to the caller (it's the
    // `scenarioId` parameter) and the return shape does not surface it.
    // Selecting it would be dead bytes on the wire.
    const { data, error } = await this.client
      .from('scenarios')
      .select('graph, brief_text')
      .eq('id', scenarioId)
      .maybeSingle();

    if (error) {
      throw new SessionReadError(
        `loadGraphAndBriefText failed for scenario ${scenarioId}: ${errMsg(error)}`,
        { cause: error, code: errCode(error) },
      );
    }

    if (data == null) {
      return { graph: null, briefText: null };
    }

    const rawBriefText = (data as { brief_text?: unknown }).brief_text;
    const briefText =
      typeof rawBriefText === 'string' && rawBriefText.length > 0
        ? rawBriefText
        : null;

    return {
      graph: (data as { graph?: unknown }).graph ?? null,
      briefText,
    };
  }

  async readMostRecentPendingActions(scenarioId: string): Promise<readonly PendingAction[]> {
    // Narrow read: only the most recent prior turn. Older orphan pending
    // actions are ignored by design — "yes" resolves against the last
    // assistant turn's explicit offer only. See store.ts JSDoc.
    const { data, error } = await this.client
      .from('v5_conversation_turns')
      .select('id, pending_actions')
      .eq('scenario_id', scenarioId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      throw new SessionReadError(
        `readMostRecentPendingActions(${scenarioId}) failed: ${errMsg(error)}`,
        { cause: error, code: errCode(error) },
      );
    }
    const rows = (data ?? []) as Array<{ id: string; pending_actions: unknown }>;
    if (rows.length === 0) return [];
    const raw = rows[0]!.pending_actions;
    if (!Array.isArray(raw)) return [];
    const out: PendingAction[] = [];
    for (const item of raw) {
      const parsed = parsePendingAction(item);
      if (parsed !== null) out.push(parsed);
      // Unparsable entries silently dropped — defence against future
      // shape drift. The resumer falls through to the non-resume path
      // when the array is empty after parsing.
    }
    return out;
  }

  async ensureScenarioExists(
    scenarioId: string,
    userId: string | null,
  ): Promise<{ user_id: string | null }> {
    // Upsert-on-append: the `ensure_scenario_exists` RPC runs
    // `INSERT … ON CONFLICT (id) DO NOTHING` and returns the
    // AUTHORITATIVE user_id from the stored row. When a row pre-
    // existed with a different owner the returned user_id will NOT
    // match the caller's — callers (pre-flight) must compare and
    // reject cross-tenant access there.
    //
    // ⚠ PoC security posture (see ensureScenarioExists on SessionStore
    // and the migration file header):
    //
    //   - `p_user_id` is trusted because CEE authenticates callers
    //     with API key + HMAC, not a JWT that PostgREST can forward.
    //     Under SECURITY DEFINER the function has no independent way
    //     to verify the user_id the caller supplies.
    //   - The service-role key is already full-trust; a compromised
    //     service-role caller can already bypass RLS entirely. The
    //     parameterised user_id here does not widen that blast
    //     radius for the PoC.
    //   - Note: the FK from scenarios.user_id → auth.users(id) was
    //     dropped by migration 20260422000000_v5_guest_mode_nullable_user_id
    //     to support guest sessions (user_id IS NULL). The FK is no
    //     longer a guardrail.
    //
    // TODO(production): replace with per-request JWT-scoped Supabase
    // client so `auth.uid()` resolves to the authenticated caller,
    // and rewrite the RPC to read user_id from `auth.uid()` rather
    // than a parameter. That is Group 3 round 2 Option A.
    const { data, error } = await this.client.rpc('ensure_scenario_exists', {
      p_scenario_id: scenarioId,
      p_user_id: userId,
    });

    if (error) {
      throw new SessionReadError(
        `ensureScenarioExists(${scenarioId}) failed: ${errMsg(error)}`,
        { cause: error, code: errCode(error) },
      );
    }
    // data is a UUID string for authenticated users or null for guest rows.
    if (data !== null && typeof data !== 'string') {
      throw new SessionReadError(
        `ensure_scenario_exists returned unexpected value: ${JSON.stringify(data)}`,
      );
    }
    return { user_id: data as string | null };
  }
}

/**
 * Wire-shape adapter from @talchain/schemas HandlerFact (fact_type / result
 * keyed) to the `append_turn_atomic` RPC's JSONB shape (handler_id /
 * action_type / payload keyed). See Docs/v5/slice-b-schemas-audit.md
 * observation 1. Slice B writes an empty array in practice; Slice C+ will
 * exercise this path.
 */
function serialiseHandlerFacts(
  facts: readonly HandlerFact[],
): Array<{ handler_id: string; action_type: string; noop: boolean; payload: unknown }> {
  return facts.map((f) => ({
    handler_id: f.fact_type,
    action_type: f.fact_type,
    noop: f.noop,
    payload: { fact_type: f.fact_type, fact_version: f.fact_version, result: f.result },
  }));
}
