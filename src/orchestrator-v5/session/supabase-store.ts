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

    let query = this.client
      .from('v5_handler_facts')
      .select('payload, handler_id, action_type, noop')
      .in('v5_conversation_turn_id', turnIds as string[]);

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

  async checkScenarioExists(scenarioId: string): Promise<boolean> {
    // Single-column SELECT keyed on PK; service-role client bypasses RLS, so a
    // missing row reflects the true state of the table regardless of the
    // caller's auth context. This is exactly what we want for a pre-flight
    // existence check — the RPC we guard does the same service-role lookup.
    // Cross-tenant protection is orthogonal and lives in the RPC itself
    // (user_id is denormalised onto every v5_conversation_turns row for RLS).
    const { data, error } = await this.client
      .from('scenarios')
      .select('id')
      .eq('id', scenarioId)
      .limit(1);

    if (error) {
      throw new SessionReadError(
        `checkScenarioExists(${scenarioId}) failed: ${errMsg(error)}`,
        { cause: error, code: errCode(error) },
      );
    }
    return Array.isArray(data) && data.length > 0;
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
