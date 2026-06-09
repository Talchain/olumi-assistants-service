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
import type { HandlerFactWithTurn } from '../types/handler-fact.js';
import { parsePendingAction, type PendingAction } from './pending-action.js';
import {
  parseConversationContent,
  type SessionTurnWithContent,
} from './conversation-content.js';
import {
  toPreDispatchSnapshot,
  parseCoachingStateSnapshot,
  type CoachingStateSnapshot,
} from '../coaching/coaching-state-snapshot.js';
import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';

// V5 Conversation Context Reliability: user_message / assistant_message added
// by migration 20260609120000. They are SELECTed here but parsed OUTSIDE the
// vendored `.strict()` SessionTurnSchema (see readRecent) and re-attached as
// SessionTurnWithContent. NOTE: this SELECT requires the migration to be live
// in the target DB — querying a column that does not exist is a hard Postgres
// error, so this build must not run against a pre-migration database (the
// migration ships first; see 20260609120000_v5_conversation_content.sql).
const V5_CONVERSATION_TURN_COLUMNS =
  'id, scenario_id, user_id, turn_id, turn_class, handler_id, request_hash, response_emitted, llm_calls_used, duration_ms, created_at, user_message, assistant_message';

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
    // PostgREST overload disambiguation continues post-2B-1a: always pass all
    // 13 named args. p_pending_actions defaults to an empty array on omit;
    // p_coaching_state defaults to null (the column is nullable, no default —
    // NULL meaningfully = "no coaching state for this turn"). The 2B-1a
    // migration drops the 12-arg overload so the single 13-arg function is
    // unambiguous; passing all 13 names is defence-in-depth against any future
    // overload reintroduction.
    //
    // Coaching-state snapshot (2B-1b): the internal Stage-2A coaching_state is
    // wrapped in a `pre_dispatch` envelope (snapshot_timing + version) before
    // persistence so the snapshot's derivation point is self-describing for
    // Stage 2B-2 lifecycle. Content-free — only closed-enum codes + hashes.
    // V5 Conversation Context Reliability: persist via append_turn_atomic_v2,
    // which is append_turn_atomic + two trailing content params
    // (p_user_message / p_assistant_message). It is a DISTINCTLY NAMED
    // function (not a same-name overload), so there is zero PostgREST
    // candidate ambiguity with the legacy append_turn_atomic — the two
    // coexist. The v2 RPC MUST be live in the target DB before this build
    // deploys (migration 20260609120000 ships first); calling it where the
    // migration is absent surfaces as StateCommitFailedError, never silent
    // data loss. Content columns are nullable and meaningfully NULL: write
    // NULL when the turn carried no user/assistant text.
    const { data, error } = await this.client.rpc('append_turn_atomic_v2', {
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
      p_coaching_state:
        write.coaching_state == null ? null : toPreDispatchSnapshot(write.coaching_state),
      p_user_message: write.userMessage ?? null,
      p_assistant_message: write.assistantMessage ?? null,
    });

    if (error) {
      throw new StateCommitFailedError(
        `append_turn_atomic_v2 RPC failed: ${errMsg(error)}`,
        { cause: error, rpc_code: errCode(error) },
      );
    }
    if (typeof data !== 'string') {
      throw new StateCommitFailedError(
        `append_turn_atomic_v2 returned non-string id: ${JSON.stringify(data)}`,
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
  ): Promise<readonly SessionTurnWithContent[]> {
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
      // Deterministic tiebreak: two turns can share a `created_at` (same-ms
      // commits, or fixtures with identical timestamps). Without a secondary
      // key their relative order is undefined, so the "most recent" turn the
      // ContextPack projects could flip between reads. `turn_id` is unique
      // per (scenario_id, turn_id), giving a stable total order.
      .order('turn_id', { ascending: false })
      .limit(limit);

    if (error) {
      throw new SessionReadError(
        `readRecent(${scenarioId}) failed: ${errMsg(error)}`,
        { cause: error, code: errCode(error) },
      );
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    const turns: SessionTurnWithContent[] = [];
    for (const row of rows) {
      // V5 Conversation Context Reliability: strip the two content columns
      // BEFORE the vendored strict parse. SessionTurnSchema is `.strict()` and
      // rejects unknown keys — feeding user_message / assistant_message to it
      // would fail every row. Parse the core row strictly, then re-attach the
      // content (tolerant parser; bad/absent content → null, never a throw).
      const { user_message, assistant_message, ...core } = row;
      const parsed = SessionTurnSchema.safeParse(core);
      if (parsed.success) {
        const content = parseConversationContent({ user_message, assistant_message });
        turns.push({ ...parsed.data, ...content });
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
    const wrapped = await this.readFactsWithTurnFor(conversationTurnRowIds, handlerId);
    return wrapped.map((w) => w.fact);
  }

  async readFactsWithTurnFor(
    conversationTurnRowIds: readonly string[],
    handlerId?: V5ActionType,
  ): Promise<readonly HandlerFactWithTurn[]> {
    if (conversationTurnRowIds.length === 0) return [];

    // V5 review: facts must come back newest-first so callers (e.g. the
    // run_analysis fallback in `buildAnalysisFromPriorFacts`) can pick the
    // most recent entry deterministically via `.find()`. The prior
    // implementation relied on undefined Supabase row order, which made the
    // selection non-deterministic.
    //
    // V5 G7/G8 P0-3: SELECT also pulls `v5_conversation_turn_id` and
    // `created_at` so callers can filter facts by their parent turn's
    // ownership link (rather than positional ordering across
    // `priorTurns` and `priorFacts`). The fact's own `created_at` is
    // a faithful proxy for the parent turn's `created_at` — both rows
    // are written inside the same `append_turn_atomic` call.
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
      .select('payload, handler_id, action_type, noop, v5_conversation_turn_id, created_at')
      .in('v5_conversation_turn_id', conversationTurnRowIds as string[])
      .order('created_at', { ascending: false });

    if (handlerId) {
      query = query.eq('handler_id', handlerId);
    }

    const { data, error } = await query;

    if (error) {
      throw new SessionReadError(
        `readFactsWithTurnFor failed: ${errMsg(error)}`,
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
    const out: HandlerFactWithTurn[] = [];
    for (const row of (data ?? []) as Array<{
      payload: unknown;
      noop?: unknown;
      v5_conversation_turn_id?: unknown;
      created_at?: unknown;
    }>) {
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
      if (!parsed.success) {
        throw new SessionReadError(
          `readFactsWithTurnFor: payload failed HandlerFactSchema — ${parsed.error.message}`,
          { cause: parsed.error },
        );
      }
      const turnId = typeof row.v5_conversation_turn_id === 'string'
        ? row.v5_conversation_turn_id
        : '';
      const createdAt = typeof row.created_at === 'string' ? row.created_at : '';
      out.push({
        fact: parsed.data,
        turn_id: turnId,
        fact_created_at: createdAt,
      });
    }
    return out;
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
    if (!Array.isArray(raw)) {
      // Column shape unexpectedly non-array — corrupted persistence.
      // Surface a degradation event so dashboards can distinguish
      // "no pending actions" from "data drift".
      emit(TelemetryEvents.PendingActionsReadDegraded, {
        scenario_id: scenarioId,
        turn_row_id: rows[0]!.id,
        reason: 'jsonb_not_array',
      });
      return [];
    }
    const out: PendingAction[] = [];
    let parseFailures = 0;
    let scenarioMismatches = 0;
    for (const item of raw) {
      const parsed = parsePendingAction(item);
      if (parsed === null) {
        parseFailures += 1;
        continue;
      }
      // Contract: pending actions never apply across scenarios. The
      // outer query already filters by scenario_id, but the persisted
      // JSONB is untrusted input — defence-in-depth against any
      // future writer that fails to set the field correctly.
      if (parsed.scenario_id !== scenarioId) {
        scenarioMismatches += 1;
        continue;
      }
      out.push(parsed);
    }
    if (parseFailures > 0 || scenarioMismatches > 0) {
      emit(TelemetryEvents.PendingActionsReadDegraded, {
        scenario_id: scenarioId,
        turn_row_id: rows[0]!.id,
        reason:
          parseFailures > 0 && scenarioMismatches > 0
            ? 'parse_and_scenario_mismatch'
            : parseFailures > 0
              ? 'parse_failed'
              : 'scenario_mismatch',
        parse_failure_count: parseFailures,
        scenario_mismatch_count: scenarioMismatches,
        kept_count: out.length,
      });
      log.warn(
        {
          scenario_id: scenarioId,
          turn_row_id: rows[0]!.id,
          parse_failures: parseFailures,
          scenario_mismatches: scenarioMismatches,
          kept: out.length,
        },
        'V5 readMostRecentPendingActions — partial read; degraded entries dropped',
      );
    }
    return out;
  }

  async readMostRecentCoachingState(scenarioId: string): Promise<CoachingStateSnapshot | null> {
    // Narrow, bounded read: the most recent prior turn whose coaching_state is
    // non-null. Filtering `coaching_state IS NOT NULL` means system-event /
    // draft / edit turns that persist NULL do NOT reset the prior snapshot;
    // ORDER BY created_at DESC + LIMIT 1 avoids any history scan (O(1) on the
    // existing scenario_id + created_at access pattern).
    const { data, error } = await this.client
      .from('v5_conversation_turns')
      .select('id, coaching_state')
      .eq('scenario_id', scenarioId)
      .not('coaching_state', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      throw new SessionReadError(
        `readMostRecentCoachingState(${scenarioId}) failed: ${errMsg(error)}`,
        { cause: error, code: errCode(error) },
      );
    }
    const rows = (data ?? []) as Array<{ id: string; coaching_state: unknown }>;
    if (rows.length === 0) return null;
    const snapshot = parseCoachingStateSnapshot(rows[0]!.coaching_state);
    if (snapshot === null) {
      // A non-null coaching_state that failed the defensive parse = data drift.
      // Degrade to null rather than crash the turn (no telemetry event added in
      // 2B-1b — the structured log is the operational signal).
      log.warn(
        { scenario_id: scenarioId, turn_row_id: rows[0]!.id },
        'V5 readMostRecentCoachingState — non-null coaching_state failed snapshot parse; degrading to null',
      );
      return null;
    }
    return snapshot;
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
