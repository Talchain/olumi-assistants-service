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
  GraphStaleWriteError,
  SessionReadError,
  StateCommitFailedError,
  type SessionStore,
  type SessionTurnWrite,
} from './store.js';
import {
  categoriseGraphCasWrite,
  computeExpectedGraphCasHashes,
  unavailableGraphCasEvaluation,
  GRAPH_CAS_RPC_CONFLICT_SQLSTATE,
  type GraphCasEvaluation,
  type GraphCasMode,
  type GraphCasRpcMode,
} from '../context/graph-cas-conflict.js';
import {
  claimTurnFence,
  classifyAtomicFenceError,
  currentTurnFenceSlot,
  errMessage,
  evaluateTurnFence,
  markTurnStopped,
  TurnFenceRejectedError,
  type TurnFenceEvaluation,
  type TurnFenceHandle,
  type TurnFenceVerdict,
  type TurnStopOutcome,
} from './turn-fence.js';

/**
 * 2.174 fix c — how a graph-bearing write will be fenced:
 *  · `atomic`  — the turn holds an admitted claim and `append_turn_atomic_v4`
 *    is (as far as we know) available: the fence check rides INSIDE the
 *    append transaction; no pre-RPC evaluation happens at all.
 *  · `checked` — everything else: the pre-v4 behaviour ran (evaluation
 *    passed, or the write proceeds unfenced per the documented gaps) and the
 *    caller dispatches the pre-v4 RPC (v2/v3).
 */
type TurnFencePlan =
  | { readonly path: 'atomic'; readonly generation: number }
  | { readonly path: 'checked' };
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
import { repairGraphForPersistence } from '../repair-graph-for-persistence.js';

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
  /**
   * A3 graph CAS observe-mode (`CEE_V5_GRAPH_CAS_MODE`). Absent → 'off'
   * (zero SELECTs, byte-identical write path). See `evaluateGraphCas` and
   * graph-cas-conflict.ts for semantics and the coverage caveat.
   */
  readonly graphCasMode?: GraphCasMode;
  /**
   * ATOMIC graph CAS commit RPC (`CEE_V5_GRAPH_CAS_RPC`). Absent → 'off'
   * (call append_turn_atomic_v2 exactly as today — safe against the
   * un-migrated schema). 'shadow'/'enforce' route graph-bearing writes to
   * append_turn_atomic_v3 (migration 20260717120000; Paul-gated). See
   * `GraphCasRpcMode` and the RPC-v3 proposal doc. Independent of
   * `graphCasMode` — the observe hook and the atomic RPC are orthogonal.
   */
  readonly graphCasRpc?: GraphCasRpcMode;
}

/** Telemetry hash-prefix length for the 64-hex identity hashes. */
const GRAPH_CAS_HASH_PREFIX_LENGTH = 16;

function identityHashPrefix(hash: string | null | undefined): string | null {
  return typeof hash === 'string' && hash.length > 0
    ? hash.slice(0, GRAPH_CAS_HASH_PREFIX_LENGTH)
    : null;
}

export class SupabaseSessionStore implements SessionStore {
  /**
   * 2.174 fix c — set once when `append_turn_atomic_v4` answers PGRST202
   * (not migrated); every later graph write then takes the pre-v4 two-step
   * without re-probing. Per-instance by design: the expected order is
   * migrate → deploy (which restarts the process), so no invalidation path
   * is needed; an out-of-order deploy simply keeps the pre-v4 protection
   * until its next restart, stated in the fallback WARN.
   */
  private atomicFenceRpcUnavailable = false;

  constructor(
    private readonly client: SupabaseClient,
    private readonly cache: SessionLRUCache,
    private readonly options: SupabaseSessionStoreOptions,
  ) {}

  async append(write: SessionTurnWrite): Promise<{ id: string }> {
    // A3 graph CAS observe-mode — pre-RPC stale-write evaluation. Runs ONLY
    // for graph-bearing writes when the mode is not 'off'; flag-off pays zero
    // SELECTs and the RPC call below is byte-identical to today. In observe
    // mode there is NO code path from this hook to a thrown error, a changed
    // response, or a skipped RPC — the commit always proceeds. In enforce mode
    // (non-prod only; prod config auto-downgrades to observe) ONLY
    // `analysis_affecting_conflict` blocks, pre-RPC, via GraphStaleWriteError
    // (extends StateCommitFailedError → existing typed failure envelope).
    //
    // NOT atomic: the SELECT inside evaluateGraphCas and the RPC below are
    // separate round-trips (TOCTOU window). This is observation, not write
    // safety — see graph-cas-conflict.ts and the RPC-v3 proposal doc.
    await this.runGraphCasHook(write);

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
    // The 15 named args are identical for v2 and v3 (v3 is a strict superset:
    // v2's params + 3 trailing CAS params). Build once, spread into both.
    const baseRpcArgs = {
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
    };

    // ATOMIC graph CAS (CEE_V5_GRAPH_CAS_RPC). Route graph-bearing writes to
    // append_turn_atomic_v3 (in-transaction FOR UPDATE + compare) when the
    // flag is not 'off'. Non-graph writes and flag-'off' always call v2 —
    // this is what keeps the DEFAULT path byte-identical to today AND safe
    // against the un-migrated schema (v3 need not exist). See GraphCasRpcMode.
    const rpcMode: GraphCasRpcMode = this.options.graphCasRpc ?? 'off';
    const useV3 = rpcMode !== 'off' && write.graph != null;

    // ── V5 TURN FENCE — the last thing before the write ────────────────────
    // Placed HERE, after every argument is built and with nothing between it
    // and the RPC dispatch below. 2.174 fix c: for a CLAIMED turn with
    // `append_turn_atomic_v4` available, this resolves to the ATOMIC plan —
    // no pre-RPC evaluation at all; the check runs INSIDE the append
    // transaction under a lock on the turn's own fence row, so the
    // evaluate→append window (turn-fence.ts arrival 10) does not exist on
    // that path. Everything else (unfenced / unclaimed / v4-missing
    // fallback) keeps the pre-v4 evaluate-then-append behaviour exactly.
    const fencePlan = await this.enforceTurnFence(write);

    if (fencePlan.path === 'atomic') {
      return await this.appendAtomicFenced(write, baseRpcArgs, rpcMode, fencePlan.generation);
    }

    const rpcName = useV3 ? 'append_turn_atomic_v3' : 'append_turn_atomic_v2';
    const { data, error } = useV3
      ? await this.client.rpc('append_turn_atomic_v3', {
          ...baseRpcArgs,
          // Trusted server-read base captured at turn start (undefined =
          // uninstrumented, null = server-read-but-empty → both map to
          // SQL NULL = no base to compare = unconditional, v2-equivalent).
          p_expected_graph_identity_hash: write.expectedGraphIdentityHash ?? null,
          // Identity of the graph BEING written (the exact JSONB in p_graph),
          // via the single normaliser authority. Stamped into
          // scenarios.graph_identity_hash so the column tracks the persisted
          // graph in lock-step, and used by v3's self-noop guard.
          p_incoming_graph_identity_hash:
            computeExpectedGraphCasHashes(write.graph).expectedGraphIdentityHash,
          // enforce → real CAS (OLGC1 on divergence); shadow → unconditional.
          p_cas_enforce: rpcMode === 'enforce',
        })
      : await this.client.rpc('append_turn_atomic_v2', baseRpcArgs);

    if (error) {
      // v3 atomic CAS conflict → typed 409-class refusal, NEVER a silent
      // clobber. The whole transaction (turn row included) rolled back in the
      // DB, so no partial state survives; surface GraphStaleWriteError so the
      // TurnExecutor's existing `instanceof StateCommitFailedError` catch maps
      // it onto the typed failure envelope (refresh-reconfirm).
      if (useV3 && errCode(error) === GRAPH_CAS_RPC_CONFLICT_SQLSTATE) {
        this.emitRpcCasConflict(write, rpcMode, errCode(error));
        throw new GraphStaleWriteError(
          `append_turn_atomic_v3 rejected a stale graph write for scenario ${write.scenario_id} ` +
            `(SQLSTATE ${GRAPH_CAS_RPC_CONFLICT_SQLSTATE}) — refresh and reconfirm. ` +
            'Atomic in-transaction CAS: the whole turn rolled back, nothing clobbered.',
          {
            conflict_category: 'rpc_cas_conflict',
            cause: error,
            expected_base_graph_hash: write.expectedGraphIdentityHash ?? undefined,
          },
        );
      }
      throw new StateCommitFailedError(
        `${rpcName} RPC failed: ${errMsg(error)}`,
        { cause: error, rpc_code: errCode(error) },
      );
    }
    if (typeof data !== 'string') {
      throw new StateCommitFailedError(
        `${rpcName} returned non-string id: ${JSON.stringify(data)}`,
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

  /**
   * V5 TURN FENCE — claim this turn's place in the scenario's start order.
   * Delegates to the fence module with THIS store's client, so there is one
   * Supabase client and one set of credentials in play, not a second one built
   * from a second env read.
   */
  async claimTurnFence(scenarioId: string, turnId: string): Promise<TurnFenceHandle | null> {
    const result = await claimTurnFence(this.client, scenarioId, turnId);
    if (result.handle === null) {
      log.error(
        {
          event: 'v5.turn_fence.claim_failed',
          scenario_id: scenarioId,
          turn_id: turnId,
          err: result.error,
        },
        'V5 turn fence — CLAIM FAILED; this turn is UNCLAIMED and any graph write it makes will be REFUSED at the commit (fail closed)',
      );
      return null;
    }
    return result.handle;
  }

  /** V5 TURN FENCE — record an explicit user Stop (server-visible). */
  async markTurnStopped(scenarioId: string, turnId: string): Promise<TurnStopOutcome> {
    return await markTurnStopped(this.client, scenarioId, turnId);
  }

  /**
   * 2.174 fix a — one indexed primary-key read on `scenarios`. Throws on a
   * failed read (the caller fails open); a clean no-row result is the honest
   * `false` that refuses the Stop without a fence write.
   */
  async scenarioExists(scenarioId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('scenarios')
      .select('id')
      .eq('id', scenarioId)
      .maybeSingle();
    if (error) {
      throw new Error(`scenarios existence read failed: ${errMsg(error)}`);
    }
    return data !== null;
  }

  /**
   * V5 TURN FENCE / ROADMAP 2.171 — post-explicit-Stop state read.
   *
   * One indexed select on the fence table this store already owns (the
   * scenario+generation index built for the evaluate RPC serves it): the
   * newest fence row EXCLUDING the asking turn, tombstoned or not. Direct
   * table read rather than a new RPC — `v5_turn_fence` is service_role-only
   * with RLS on (migration 20260731120000) and this client IS the service
   * role; the RPCs exist for write-path atomicity, which a single read does
   * not need.
   *
   * Best-effort per the interface contract: any error resolves `false` (the
   * ordinary coach copy) with a WARN — copy must never fail a turn.
   */
  async wasLatestScenarioTurnStopped(scenarioId: string, excludeTurnId: string): Promise<boolean> {
    try {
      const { data, error } = await this.client
        .from('v5_turn_fence')
        .select('stopped_at')
        .eq('scenario_id', scenarioId)
        .neq('turn_id', excludeTurnId)
        .order('generation', { ascending: false })
        .limit(1);
      if (error) {
        log.warn(
          {
            event: 'v5.turn_fence.post_stop_read_failed',
            scenario_id: scenarioId,
            err: errMessage(error),
          },
          'V5 turn fence — post-Stop state read failed; treating as not-post-Stop (ordinary copy)',
        );
        return false;
      }
      const row = Array.isArray(data) ? (data[0] as { stopped_at?: unknown } | undefined) : undefined;
      return row != null && row.stopped_at != null;
    } catch (err) {
      log.warn(
        {
          event: 'v5.turn_fence.post_stop_read_failed',
          scenario_id: scenarioId,
          err: errMessage(err),
        },
        'V5 turn fence — post-Stop state read threw; treating as not-post-Stop (ordinary copy)',
      );
      return false;
    }
  }

  /**
   * V5 TURN FENCE — refuse a graph write that the user stopped, or that a later
   * turn has superseded.
   *
   * SCOPE, precisely: graph-bearing writes only. A superseded turn ROW is
   * harmless history; a superseded GRAPH is the reproduced defect. Non-graph
   * writes return on the first line — no RPC, no added latency, no new failure
   * mode for answers / analysis receipts / graph-free system events.
   *
   * FAIL CLOSED on every outcome that is not provably `current`, including
   * `unavailable` and `unclaimed`. That is the opposite posture to
   * `runGraphCasHook` below, deliberately: that hook OBSERVES (and must never
   * fail a live write), this one is the integrity check the write is not
   * allowed to skip. If we cannot prove the graph we are about to store is
   * still the current one, we do not store it — the same reasoning as
   * `commit.ts`'s terminal invariant refusal.
   *
   * The ONE non-refusing gap is `no_ingress_fence`: a commit that never passed
   * through the fenced ingress has no handle at all. It is logged at ERROR and
   * emitted, never swallowed, because that is a coverage gap and not a state to
   * be comfortable with — and `turn-fence-route-registration.test.ts` pins that
   * the ingress does bind the handle, so the claim rests on a test rather than
   * on this sentence.
   *
   * ⚠ A FAILED CLAIM IS NOT THAT GAP, AND TREATING IT AS ONE WAS THE #759
   *   REVIEW'S SEVERE FINDING. A turn whose claim failed now arrives with a
   *   handle whose `generation` is `null` and is REFUSED below. Before that fix
   *   it arrived with no handle, fell through this gap, and was allowed — which
   *   let a claim blip on turn B end with turn A CLOBBERING it, no timing
   *   inversion required.
   */
  private async enforceTurnFence(write: SessionTurnWrite): Promise<TurnFencePlan> {
    if (write.graph == null) return { path: 'checked' };

    // 2.174 fix b: read the SLOT, not the handle — a slot whose handle is
    // still null is a THIRD absence (`bound at ingress, never admitted`),
    // distinct from both "never came through the fenced ingress" (no slot →
    // proceeds as arrival 12) and "admission ran and the claim failed"
    // (unclaimed handle → refused). No code path dispatches work before
    // admission, so a pending-slot graph write is refused fail-closed.
    const slot = currentTurnFenceSlot();
    if (slot === undefined) {
      log.error(
        {
          event: 'v5.turn_fence.no_ingress_fence',
          scenario_id: write.scenario_id,
          turn_id: write.turn_id,
          turn_class: write.turn_class,
        },
        'V5 turn fence — a GRAPH WRITE reached the store with no ingress fence handle; it is proceeding UNFENCED',
      );
      this.emitFenceEvaluated(write, 'unfenced', null, null, 'no_ingress_fence');
      return { path: 'checked' };
    }
    const handle: TurnFenceHandle =
      slot.handle ?? { scenarioId: slot.scenarioId, turnId: slot.turnId, generation: null };
    const neverAdmitted = slot.handle === null;
    if (handle.scenarioId !== write.scenario_id) {
      // A turn writing a graph to a scenario other than the one it claimed. No
      // ordering exists for that pair, so there is nothing to compare — but it
      // is not a state to pass over quietly either.
      log.error(
        {
          event: 'v5.turn_fence.scenario_mismatch',
          claimed_scenario_id: handle.scenarioId,
          write_scenario_id: write.scenario_id,
          turn_id: handle.turnId,
        },
        'V5 turn fence — the graph write targets a DIFFERENT scenario than this turn claimed; proceeding UNFENCED',
      );
      this.emitFenceEvaluated(write, 'unfenced', null, null, 'scenario_mismatch');
      return { path: 'checked' };
    }

    // ── 2.174 fix c: the ATOMIC plan ─────────────────────────────────────
    // A claimed turn with `append_turn_atomic_v4` available skips the
    // pre-RPC evaluation entirely — the fence check runs INSIDE the append
    // transaction, under a lock on this turn's own fence row, so there is
    // no window between "checked" and "wrote" at all. When v4 is not
    // migrated yet (feature-detected via PGRST202 in appendAtomicFenced and
    // remembered per store instance) every claimed turn takes the pre-v4
    // evaluate-then-append below, byte-equivalent to the pre-fix path.
    if (handle.generation !== null && !this.atomicFenceRpcUnavailable) {
      return { path: 'atomic', generation: handle.generation };
    }

    // The ingress claim did not land, so this turn has NO position in the
    // scenario's order. Refuse WITHOUT the RPC: there is nothing to ask — we
    // already know we cannot prove the write is current, and asking would only
    // add a round trip to a decision that is already made.
    //
    // ⚠ THIS IS THE BRANCH THE #759 REVIEW PROVED UNREACHABLE. It was written,
    //   documented and tested-in-the-classifier, but no handle with a failed
    //   claim ever reached it, because a failed claim bound no handle at all and
    //   landed in `no_ingress_fence` above — which ALLOWS the write. See
    //   `TurnFenceHandle.generation`.
    //
    // R-11 (sweep-2 fence rider): this branch CONSTRUCTS its evaluation and
    // falls through to the ONE refusal tail below. It used to carry its own
    // emit + log + throw, and the two refusal paths had already drifted (the
    // early copy logged `reason` but not the generations; the tail logged the
    // generations but no reason). Two refusal paths must never log
    // differently, so now there is one.
    const evaluation: TurnFenceEvaluation =
      handle.generation === null
        ? {
            verdict: 'unclaimed',
            generation: null,
            maxGeneration: null,
            // 2.174 fix b: the two null-generation states carry distinct
            // reasons — `never_admitted` means the request was bound at
            // ingress but work dispatched without passing the admission
            // gate (no code path does this; refused on principle), while
            // `claim_did_not_land` is the #759 failed-claim state.
            unavailableReason: neverAdmitted ? 'never_admitted' : 'claim_did_not_land',
          }
        : await evaluateTurnFence(this.client, handle);

    this.emitFenceEvaluated(
      write,
      evaluation.verdict,
      evaluation.generation,
      evaluation.maxGeneration,
      evaluation.unavailableReason,
    );
    if (evaluation.verdict === 'current') return { path: 'checked' };

    this.throwFenceRefusal(write, handle.turnId, evaluation, 'pre_rpc');
  }

  /**
   * The ONE refusal tail (R-11: two refusal paths must never log
   * differently), shared by the pre-RPC evaluation and the v4
   * in-transaction gate. The caller has already emitted the fence
   * telemetry (emitFenceEvaluated also emits the refused event for
   * non-current verdicts — calling it here too would double-count).
   */
  private throwFenceRefusal(
    write: SessionTurnWrite,
    turnId: string,
    evaluation: TurnFenceEvaluation,
    channel: 'pre_rpc' | 'atomic_append',
  ): never {
    const detail =
      evaluation.verdict === 'stopped'
        ? 'the user explicitly stopped this turn'
        : evaluation.verdict === 'superseded'
          ? `a later turn has claimed this scenario (generation ${String(evaluation.generation)} < ${String(evaluation.maxGeneration)})`
          : evaluation.verdict === 'unclaimed'
            ? 'no fence row exists for this turn, so its position in the scenario order is unknown'
            : `the fence could not be read (${evaluation.unavailableReason ?? 'unknown'})`;

    log.warn(
      {
        event: 'v5.turn_fence.graph_write_refused',
        scenario_id: write.scenario_id,
        turn_id: turnId,
        turn_class: write.turn_class,
        verdict: evaluation.verdict,
        generation: evaluation.generation,
        max_generation: evaluation.maxGeneration,
        reason: evaluation.unavailableReason ?? null,
        channel,
      },
      `V5 turn fence — REFUSING this graph write: ${detail}. Nothing was written; the turn row rolled back with it.`,
    );
    throw new TurnFenceRejectedError(
      `V5 turn fence refused a graph write for scenario ${write.scenario_id} ` +
        `turn ${turnId} — ${detail}. ` +
        (channel === 'atomic_append'
          ? 'The fence check ran INSIDE the append transaction (append_turn_atomic_v4); the whole turn rolled back.'
          : 'The fence is a pre-write CHECK, not a lock.'),
      evaluation,
    );
  }

  /**
   * 2.174 fix c — the fence-checked atomic append. Reaches here ONLY for a
   * graph-bearing write whose turn holds an admitted claim; the fence
   * verdict is computed by `append_turn_atomic_v4` inside the same
   * transaction as the append, under `FOR UPDATE` on this turn's fence row,
   * so a concurrent Stop either commits first (refusal below) or waits for
   * this commit (and then reports `already_committed` honestly). The
   * evaluate→append window of the pre-v4 design does not exist on this path.
   *
   * BEFORE THE MIGRATION EXECUTES the RPC does not exist: PostgREST answers
   * PGRST202, we remember that per store instance, and the append re-runs
   * through the pre-v4 two-step — FEATURE-DETECT, not fail-closed, stated
   * and pinned (turn-fence-atomic-append.test.ts). A restart after the
   * migration lands picks v4 up again (deploys restart the process, so the
   * expected order migrate→deploy needs no cache invalidation).
   */
  private async appendAtomicFenced(
    write: SessionTurnWrite,
    baseRpcArgs: Record<string, unknown>,
    rpcMode: GraphCasRpcMode,
    generation: number,
  ): Promise<{ id: string }> {
    // CAS args mirror EXACTLY what the pre-v4 dispatch sends per mode:
    // 'off' → the v2 shape (no hashes, no stamp, no compare); shadow/enforce
    // → the v3 shape. v4's CAS block is v3's verbatim, so mode semantics are
    // unchanged — the fence gate is the only delta.
    const casArgs =
      rpcMode !== 'off'
        ? {
            p_expected_graph_identity_hash: write.expectedGraphIdentityHash ?? null,
            p_incoming_graph_identity_hash:
              computeExpectedGraphCasHashes(write.graph).expectedGraphIdentityHash,
            p_cas_enforce: rpcMode === 'enforce',
          }
        : {
            p_expected_graph_identity_hash: null,
            p_incoming_graph_identity_hash: null,
            p_cas_enforce: false,
          };

    const { data, error } = await this.client.rpc('append_turn_atomic_v4', {
      ...baseRpcArgs,
      ...casArgs,
      p_fence_generation: generation,
    });

    if (error) {
      if (errCode(error) === 'PGRST202') {
        // v4 is not migrated on this database. Remember it (per instance),
        // say so once, and re-run this append through the pre-v4 two-step
        // (enforceTurnFence will now evaluate pre-RPC and dispatch v2/v3).
        // Costs one extra RPC round trip and one duplicate A3 observe pass
        // on the single discovery call — every later graph write skips v4.
        this.atomicFenceRpcUnavailable = true;
        log.warn(
          {
            event: 'v5.turn_fence.atomic_rpc_unavailable',
            scenario_id: write.scenario_id,
            turn_id: write.turn_id,
          },
          'V5 turn fence — append_turn_atomic_v4 is not present in this database (PGRST202); falling back to the pre-v4 evaluate-then-append for the life of this instance. Execute migration 20260731130000 to close the evaluate→append window.',
        );
        return await this.append(write);
      }
      const fenceEvaluation = classifyAtomicFenceError(error);
      if (fenceEvaluation !== null) {
        this.emitFenceEvaluated(
          write,
          fenceEvaluation.verdict,
          fenceEvaluation.generation,
          fenceEvaluation.maxGeneration,
          'atomic_append',
        );
        this.throwFenceRefusal(write, write.turn_id, fenceEvaluation, 'atomic_append');
      }
      if (errCode(error) === GRAPH_CAS_RPC_CONFLICT_SQLSTATE) {
        this.emitRpcCasConflict(write, rpcMode, errCode(error));
        throw new GraphStaleWriteError(
          `append_turn_atomic_v4 rejected a stale graph write for scenario ${write.scenario_id} ` +
            `(SQLSTATE ${GRAPH_CAS_RPC_CONFLICT_SQLSTATE}) — refresh and reconfirm. ` +
            'Atomic in-transaction CAS: the whole turn rolled back, nothing clobbered.',
          {
            conflict_category: 'rpc_cas_conflict',
            cause: error,
            expected_base_graph_hash: write.expectedGraphIdentityHash ?? undefined,
          },
        );
      }
      throw new StateCommitFailedError(
        `append_turn_atomic_v4 RPC failed: ${errMsg(error)}`,
        { cause: error, rpc_code: errCode(error) },
      );
    }
    if (typeof data !== 'string') {
      throw new StateCommitFailedError(
        `append_turn_atomic_v4 returned non-string id: ${JSON.stringify(data)}`,
      );
    }

    // The in-transaction verdict was `current` — emit it on the same
    // telemetry contract as the pre-RPC evaluation (max_generation is not
    // returned by a successful v4; the reason names the channel).
    this.emitFenceEvaluated(write, 'current', generation, null, 'atomic_append');

    // Commit ordering — identical to the pre-v4 path: RPC success → cache
    // evict → return.
    this.cache.invalidateAll(write.scenario_id);
    return { id: data };
  }

  /**
   * Fence telemetry. Content-free (ids, the closed-enum verdict, two integers)
   * and guarded, on the same contract as the CAS payloads: a telemetry fault
   * must never change which writes are refused.
   */
  private emitFenceEvaluated(
    write: SessionTurnWrite,
    verdict: TurnFenceVerdict | 'unfenced',
    generation: number | null,
    maxGeneration: number | null,
    reason?: string,
  ): void {
    try {
      // R-13: ONE payload, two emits. The two literals had to be kept
      // key-identical by hand; now they cannot diverge.
      const payload = {
        scenario_id: write.scenario_id,
        turn_id: write.turn_id,
        turn_class: write.turn_class,
        verdict,
        generation,
        max_generation: maxGeneration,
        reason: reason ?? null,
      };
      emit(TelemetryEvents.V5TurnFenceEvaluated, payload);
      if (verdict !== 'current' && verdict !== 'unfenced') {
        emit(TelemetryEvents.V5TurnFenceGraphWriteRefused, payload);
      }
    } catch {
      // Never let telemetry decide whether a write is fenced.
    }
  }

  /**
   * A3 graph CAS hook — evaluate, emit telemetry, and (enforce mode only)
   * block `analysis_affecting_conflict` writes pre-RPC.
   *
   * Guarantees:
   *  - mode 'off' or graph-absent write → returns immediately: no SELECT, no
   *    hashing, no telemetry, no behavioural change of any kind.
   *  - observe mode → NEVER throws, never changes the response, never skips
   *    the RPC. Any internal fault (including telemetry) degrades to an
   *    `unavailable` evaluation or a swallowed emit — the commit proceeds.
   *  - enforce mode → throws GraphStaleWriteError ONLY for
   *    `analysis_affecting_conflict`. Every other category — including
   *    `self_noop` (idempotent replays / duplicate submissions),
   *    `cosmetic_concurrent_edit`, `no_expected`, `first_write`, `match` and
   *    every `unavailable` reason (SELECT failure, parse failure, hook fault)
   *    — always proceeds. Infrastructure faults must never fail a live write.
   */
  private async runGraphCasHook(write: SessionTurnWrite): Promise<void> {
    const mode = this.options.graphCasMode ?? 'off';
    if (mode === 'off' || write.graph == null) return;

    const { evaluation, select_ms, select_failed } = await this.evaluateGraphCas(write);

    // Guarded telemetry: a telemetry fault must never fail (or block) the
    // write, in either mode.
    try {
      const payload = {
        scenario_id: write.scenario_id,
        turn_id: write.turn_id,
        mode,
        category: evaluation.category,
        reason: evaluation.reason,
        expected_identity_hash: identityHashPrefix(write.expectedGraphIdentityHash),
        current_identity_hash: identityHashPrefix(evaluation.current_identity_hash),
        incoming_identity_hash: identityHashPrefix(evaluation.incoming_identity_hash),
        // Analysis hashes are already 16-hex (graph-hash.ts HASH_HEX_LENGTH).
        expected_analysis_hash: write.expectedGraphAnalysisHash ?? null,
        current_analysis_hash: evaluation.current_analysis_hash,
        select_ms,
        select_failed,
      };
      emit(TelemetryEvents.V5GraphCasEvaluated, payload);
      if (mode === 'enforce' && evaluation.category === 'analysis_affecting_conflict') {
        emit(TelemetryEvents.V5GraphCasWriteBlocked, payload);
      }
    } catch (telemetryErr) {
      try {
        log.warn(
          {
            scenario_id: write.scenario_id,
            turn_id: write.turn_id,
            err: (telemetryErr as Error)?.message ?? String(telemetryErr),
          },
          'A3 graph CAS — telemetry emit failed; continuing (write is never failed by telemetry)',
        );
      } catch {
        // Nothing in this hook may fail the write via logging either.
      }
    }

    if (mode === 'enforce' && evaluation.category === 'analysis_affecting_conflict') {
      throw new GraphStaleWriteError(
        `graph CAS enforce: stale write blocked pre-RPC for scenario ${write.scenario_id} ` +
          `(category=${evaluation.category}, reason=${evaluation.reason}). ` +
          'App-side best-effort check (SELECT-then-write), not an atomicity guarantee.',
        {
          conflict_category: evaluation.category,
          expected_base_graph_hash: write.expectedGraphIdentityHash ?? undefined,
        },
      );
    }
  }

  /**
   * A3 graph CAS — pre-RPC evaluation: timed PK SELECT of the current
   * `scenarios.graph`, then the pure categoriser. The whole body is
   * fault-isolated: any throw degrades to `unavailable`/observe_hook_failed
   * and the commit ALWAYS proceeds (a SELECT failure is
   * `unavailable`/select_failed — also always proceeds, even under enforce).
   */
  private async evaluateGraphCas(write: SessionTurnWrite): Promise<{
    readonly evaluation: GraphCasEvaluation;
    readonly select_ms: number | null;
    readonly select_failed: boolean;
  }> {
    try {
      const selectStartedAt = Date.now();
      const { data, error } = await this.client
        .from('scenarios')
        .select('graph')
        .eq('id', write.scenario_id)
        .maybeSingle();
      const select_ms = Date.now() - selectStartedAt;

      if (error) {
        return {
          evaluation: unavailableGraphCasEvaluation('select_failed'),
          select_ms,
          select_failed: true,
        };
      }

      const currentGraphRaw =
        data == null ? null : ((data as { graph?: unknown }).graph ?? null);
      return {
        evaluation: categoriseGraphCasWrite({
          expectedIdentityHash: write.expectedGraphIdentityHash,
          expectedAnalysisHash: write.expectedGraphAnalysisHash,
          currentGraphRaw,
          incomingGraphRaw: write.graph,
        }),
        select_ms,
        select_failed: false,
      };
    } catch {
      return {
        evaluation: unavailableGraphCasEvaluation('observe_hook_failed'),
        select_ms: null,
        select_failed: false,
      };
    }
  }

  /**
   * Emit the atomic-CAS conflict telemetry (append_turn_atomic_v3 OLGC1).
   * Guarded: a telemetry fault must never mask the GraphStaleWriteError the
   * caller is about to throw. Content-free — closed enums + 16-hex hash
   * prefixes + the rpc_code only, mirroring the A3 observe payload's privacy
   * contract.
   */
  private emitRpcCasConflict(
    write: SessionTurnWrite,
    mode: GraphCasRpcMode,
    rpcCode: string | undefined,
  ): void {
    try {
      emit(TelemetryEvents.V5GraphCasRpcConflict, {
        scenario_id: write.scenario_id,
        turn_id: write.turn_id,
        mode,
        conflict_category: 'rpc_cas_conflict',
        expected_identity_hash: identityHashPrefix(write.expectedGraphIdentityHash),
        incoming_identity_hash: identityHashPrefix(
          computeExpectedGraphCasHashes(write.graph).expectedGraphIdentityHash,
        ),
        rpc_code: rpcCode ?? null,
      });
    } catch {
      // Never let telemetry convert an atomic-CAS rejection into a different
      // failure — the GraphStaleWriteError throw is the load-bearing outcome.
    }
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

  /**
   * Pre-cap turn total for the scenario — see {@link SessionStore.countTurns}
   * for why this is a separate read rather than a `count` rider on
   * {@link readRecent}'s SELECT (that SELECT is skipped on an LRU hit, which
   * is exactly the beyond-window case).
   *
   * `head: true` sends no rows at all: PostgREST answers with `Content-Range`
   * only. The COUNT runs over the same `(scenario_id, created_at DESC)` index
   * `readRecent` already uses, filtered to one scenario's handful of rows.
   *
   * Throws when the count is missing or malformed. There is no fallback on
   * purpose: falling back to the window length is the falsehood this method
   * removes, so an assume-good default here would reintroduce it silently.
   */
  async countTurns(scenarioId: string): Promise<number> {
    // SCOPE AT THE BYTES: `.eq('scenario_id', …)` is the only thing between
    // this service-role read and every other scenario's turns — the client
    // bypasses RLS. Select the narrowest column; `head: true` returns none.
    const { count, error } = await this.client
      .from('v5_conversation_turns')
      .select('turn_id', { count: 'exact', head: true })
      .eq('scenario_id', scenarioId);
    if (error) {
      throw new SessionReadError(`countTurns(${scenarioId}) failed: ${errMsg(error)}`, {
        cause: error,
        code: errCode(error),
      });
    }
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
      throw new SessionReadError(
        `countTurns(${scenarioId}): PostgREST returned no exact count (got ${String(count)})`,
      );
    }
    return count;
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

  /**
   * The scenario's newest non-noop `run_analysis` fact — see
   * {@link SessionStore.readNewestAnalysisFactFor} for WHY this is scoped to
   * the scenario and not to the read window.
   *
   * SCOPE AT THE BYTES: `.eq('scenario_id', …)` is the only thing between this
   * service-role read and every other scenario's facts — the client bypasses
   * RLS. Same stance as `countTurns`.
   *
   * INDEX: `(scenario_id, handler_id, created_at DESC)`
   * (`v5_handler_facts_scenario_handler_idx`, migration 20260417160000). The
   * two `.eq()`s are the leading columns and `created_at DESC` is the third,
   * so the `ORDER BY … LIMIT 1` is a single index descent with no sort.
   * Live `EXPLAIN (ANALYZE)` on staging: `Index Scan using
   * v5_handler_facts_scenario_handler_idx … rows=1`, cost 0.28..2.50.
   *
   * `handler_id`, not `payload->>'fact_type'`: the JSONB path is not indexed
   * and would force a scenario-wide heap scan. They are the same value on
   * every row — the write path fills both from the same fact (`mapFactsForRpc`
   * → the RPC's `v_fact->>'handler_id'`), verified across all 1,600+ live rows
   * (`run_analysis` 697, `explain_results` 380, …). `noop` is a real column
   * for exactly this kind of SQL-level filtering.
   *
   * ⚠ DELIBERATELY NOT CACHED. `readRecent` consults `this.cache` first; this
   * read must not, because the session LRU is process-local, has no TTL, and
   * is invalidated only on the instance that performed the append
   * (`invalidateAll` is a local `Map` operation). A cached permission could
   * therefore be stale across instances — which is the SECOND independent
   * route to the same guarantee-decay this method exists to close, and a route
   * that can move the answer in BOTH directions. One indexed read per turn,
   * derived from the source of truth every time; a cached copy of it would be
   * the hand-maintained mirror (CLAUDE.md trap 12) all over again.
   */
  async readNewestAnalysisFactFor(scenarioId: string): Promise<HandlerFact | null> {
    const { data, error } = await this.client
      .from('v5_handler_facts')
      .select('payload, noop')
      .eq('scenario_id', scenarioId)
      .eq('handler_id', 'run_analysis')
      .eq('noop', false)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      // THROWS, never returns null on failure: "the scenario has no analysis"
      // and "I could not look" are precisely the two states this whole change
      // exists to stop conflating. The caller degrades explicitly.
      throw new SessionReadError(
        `readNewestAnalysisFactFor(${scenarioId}) failed: ${errMsg(error)}`,
        { cause: error, code: errCode(error) },
      );
    }

    const rows = (data ?? []) as Array<{ payload: unknown; noop?: unknown }>;
    const row = rows[0];
    if (!row) return null;

    // Same hydration contract as readFactsWithTurnFor: `payload` JSONB carries
    // {fact_type, fact_version, result} while `noop` lives on its own column,
    // and HandlerFactSchema is `.strict()` + requires `noop`. Rejoin before
    // parsing or every row fails.
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
    const parsed = HandlerFactSchema.safeParse({ ...payloadObj, noop });
    if (!parsed.success) {
      throw new SessionReadError(
        `readNewestAnalysisFactFor(${scenarioId}): payload failed HandlerFactSchema — ${parsed.error.message}`,
        { cause: parsed.error },
      );
    }
    return parsed.data;
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
    // True no-op on an absent graph: return BEFORE any RPC. Unlike
    // append_turn_atomic_v2 (which guards `IF p_graph IS NOT NULL`), the
    // store_draft_graph RPC runs an UNCONDITIONAL `UPDATE scenarios SET
    // graph = p_graph` (migration 20260422120000), so passing null would CLEAR
    // scenarios.graph rather than leave it unchanged. Never issue the RPC unless
    // there is an actual graph to write.
    if (graph === undefined || graph === null) return;

    // Track S 0.13c-4: persist-site intercept repair on the SECOND scenarios.graph
    // write RPC. `store_draft_graph` is currently dead on the live V5 path
    // (commitDirectAnswer → append_turn_atomic_v2 is the sole live writer), but this
    // method is reserved for out-of-band admin/migration use — exactly the caller
    // class the persist-site repair must defend against. Repairing here keeps the
    // coverage airtight if it is ever re-wired.
    const p_graph = repairGraphForPersistence(graph, { scenarioId });
    const { error } = await this.client.rpc('store_draft_graph', {
      p_scenario_id: scenarioId,
      p_graph,
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

  async getScenarioOwner(scenarioId: string): Promise<string | null> {
    // Plain read, no upsert — see store.ts JSDoc. SELECT only user_id;
    // `id` is already known to the caller (the scenarioId parameter).
    const { data, error } = await this.client
      .from('scenarios')
      .select('user_id')
      .eq('id', scenarioId)
      .maybeSingle();

    if (error) {
      throw new SessionReadError(
        `getScenarioOwner failed for scenario ${scenarioId}: ${errMsg(error)}`,
        { cause: error, code: errCode(error) },
      );
    }

    if (data == null) return null;
    const userId = (data as { user_id?: unknown }).user_id;
    return typeof userId === 'string' && userId.length > 0 ? userId : null;
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

  async hasPriorTurns(scenarioId: string): Promise<boolean> {
    // V5 Signature Loop — cheapest existence read: select a single id, limit 1.
    // No data transfer beyond a row id; O(1) on the scenario_id access pattern.
    const { data, error } = await this.client
      .from('v5_conversation_turns')
      .select('id')
      .eq('scenario_id', scenarioId)
      .limit(1);
    if (error) {
      throw new SessionReadError(
        `hasPriorTurns(${scenarioId}) failed: ${errMsg(error)}`,
        { cause: error, code: errCode(error) },
      );
    }
    return (data ?? []).length > 0;
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
