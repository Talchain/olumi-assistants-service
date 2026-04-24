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
      // p_graph is optional — only set for draft_graph turns. When present the
      // RPC atomically writes scenarios.graph in the same transaction as the
      // turn insert. Omitting it (DEFAULT NULL) leaves scenarios.graph unchanged.
      ...(write.graph !== undefined && { p_graph: write.graph }),
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
    turnIds: readonly string[],
    handlerId?: V5ActionType,
  ): Promise<readonly HandlerFact[]> {
    if (turnIds.length === 0) return [];

    // V5 review: facts must come back newest-first so callers (e.g. the
    // run_analysis fallback in `buildAnalysisFromPriorFacts`) can pick the
    // most recent entry deterministically via `.find()`. The prior
    // implementation relied on undefined Supabase row order, which made the
    // selection non-deterministic. The composite index
    // `v5_handler_facts_scenario_handler_idx` covers this ORDER BY.
    let query = this.client
      .from('v5_handler_facts')
      .select('payload, handler_id, action_type, noop')
      .in('v5_conversation_turn_id', turnIds as string[])
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
    const facts: HandlerFact[] = [];
    for (const row of (data ?? []) as Array<{ payload: unknown }>) {
      const parsed = HandlerFactSchema.safeParse(row.payload);
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
    const { data, error } = await this.client
      .from('scenarios')
      .select('graph')
      .eq('id', scenarioId)
      .maybeSingle();
    
    if (error) {
      throw new SessionReadError(
        `loadGraph failed for scenario ${scenarioId}: ${errMsg(error)}`,
        { cause: error, code: errCode(error) },
      );
    }
    
    return data?.graph ?? null;
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
