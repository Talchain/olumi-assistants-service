/**
 * Build a V5 TurnContext from an ingress payload.
 *
 * A1 (pre-slice-B) shipped a skeletal TurnContext with no persistence reads —
 * `prior_turns` was always empty because no SessionStore existed yet. Slice B
 * wires in `sessionStore.readRecent()` so successive turns of the same
 * scenario see each other.
 *
 * Graceful degradation: any failure of `getSessionStore()` or `readRecent()`
 * is caught, a `session.read_degraded` telemetry event is emitted with
 * `severity: 'warning'`, and the turn continues with an empty `prior_turns`
 * list. This distinguishes "empty because new scenario" from "empty because
 * persistence failed" — without the telemetry hook, silent session-loss
 * could run for days before an operator noticed.
 *
 * `EnrichedTurnContext` is a CEE-internal extension of the wire-level
 * `TurnContext` schema from @talchain/schemas/orchestrator. The wire schema
 * is `.strict()` — we cannot add fields to it without a schema bump — so
 * Slice B carries `prior_turns` on an internal superset type that handlers
 * in Slice C+ can consume. Existing V5 code that annotates arguments as
 * `TurnContext` continues to compile via structural subtyping.
 */

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { HandlerFact, SessionTurn, TurnContext } from '@talchain/schemas/orchestrator';

import { emit, TelemetryEvents, log } from '../utils/telemetry.js';

import { getTurnExecutorBudgets } from './budgets.js';
import { SessionReadError, type SessionStore } from './session/store.js';
import { getSessionStore } from './session/index.js';

export interface EnrichedTurnContext extends TurnContext {
  /**
   * Prior turns for this scenario, fetched at turn-build time from the
   * session store (Supabase, with LRU cache). Ordered by `created_at DESC`,
   * most recent first. Empty array means either "no prior history" or
   * "persistence read degraded"; disambiguate via the
   * `session.read_degraded` telemetry event.
   */
  readonly prior_turns: readonly SessionTurn[];
  /**
   * Handler facts for prior_turns (V5 Group 1: used by coaching-cache
   * reader to resolve decision_review enrichment and last coaching signal).
   * Order matches prior_turns (newest-first). Empty array when no prior
   * handler turns exist or when the facts read degraded.
   */
  readonly prior_facts: readonly HandlerFact[];
}

export interface BuildTurnContextOptions {
  /**
   * Override the default session store. Production code passes nothing and
   * the factory resolves the singleton. Tests pass a mock to avoid touching
   * real Supabase.
   */
  readonly sessionStore?: SessionStore;
}

// v0.7.0 schema note: the ingress `OrchestratorTurnPayload` is a discriminated
// union on `kind`. `buildTurnContext` only ever sees `kind: 'message'` payloads
// because `route-v2.ts` dispatches `kind: 'system_event'` BEFORE calling the
// TurnExecutor (system events have no `message` field). Typed as
// `MessageTurnPayload` to make the invariant visible at compile time.
export async function buildTurnContext(
  payload: MessageTurnPayload,
  requestId: string,
  options: BuildTurnContextOptions = {},
): Promise<EnrichedTurnContext> {
  const budgets = getTurnExecutorBudgets();

  const baseContext: TurnContext = {
    stage: payload.stage,
    entity_registry: {
      option_ids: [],
      goal_id: null,
    },
    capabilities: {
      can_run_analysis: false,
      can_edit_graph: false,
      can_run_decision_review: false,
      can_generate_coaching: false,
      can_invoke_tools: false,
      can_commit_session_state: false,
    },
    messages: [{ role: 'user', content: payload.message }],
    session_id: payload.scenario_id,
    request_id: requestId,
    budgets,
  };

  const store = options.sessionStore ?? tryGetSessionStore();
  const priorTurns = await fetchPriorTurns(payload.scenario_id, requestId, store);
  const priorFacts = await fetchPriorFacts(priorTurns, requestId, payload.scenario_id, store);

  return { ...baseContext, prior_turns: priorTurns, prior_facts: priorFacts };
}

function tryGetSessionStore(): SessionStore | undefined {
  try {
    return getSessionStore();
  } catch {
    return undefined;
  }
}

async function fetchPriorTurns(
  scenarioId: string,
  requestId: string,
  store: SessionStore | undefined,
): Promise<readonly SessionTurn[]> {
  if (!store) return [];
  try {
    return await store.readRecent(scenarioId);
  } catch (error) {
    const errorCode = error instanceof SessionReadError ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    log.warn(
      { request_id: requestId, scenario_id: scenarioId, error_code: errorCode, err: message },
      'V5 buildTurnContext: session.readRecent failed, continuing with empty prior_turns',
    );
    emit(TelemetryEvents.SessionReadDegraded, {
      request_id: requestId,
      scenario_id: scenarioId,
      error_code: errorCode ?? 'unknown',
      severity: 'warning',
    });
    return [];
  }
}

async function fetchPriorFacts(
  priorTurns: readonly SessionTurn[],
  requestId: string,
  scenarioId: string,
  store: SessionStore | undefined,
): Promise<readonly HandlerFact[]> {
  if (!store) return [];
  if (priorTurns.length === 0) return [];
  const handlerTurnIds = priorTurns
    .filter((t) => t.turn_class === 'handler')
    .map((t) => t.turn_id);
  if (handlerTurnIds.length === 0) return [];
  try {
    return await store.readFactsFor(handlerTurnIds);
  } catch (error) {
    const errorCode = error instanceof SessionReadError ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    log.warn(
      { request_id: requestId, scenario_id: scenarioId, error_code: errorCode, err: message },
      'V5 buildTurnContext: session.readFactsFor failed, continuing with empty prior_facts',
    );
    emit(TelemetryEvents.SessionReadDegraded, {
      request_id: requestId,
      scenario_id: scenarioId,
      error_code: errorCode ?? 'unknown',
      severity: 'warning',
    });
    return [];
  }
}

/**
 * V5 ingress pre-flight: ensure the scenarios row exists, creating it on-
 * demand if the caller supplied a `userId`. Replaces the 2026-04-20
 * existence-only check (dbd59c9e) which rejected valid traffic when the
 * UI's INSERT race-landed after the first V5 turn.
 *
 * Lives alongside buildTurnContext because this file is the declared
 * session-layer integration point (per the state-write invariant at
 * scripts/validate-state-write-invariant.sh — only session/, commit.ts,
 * and build-turn-context.ts are allowed to import the SessionStore).
 *
 * Behaviour matrix:
 *
 *   userId PRESENT (new UI path):
 *     - RPC INSERTs row if missing, no-ops if present, returns
 *       authoritative user_id. Match → `{ ok: true }`.
 *     - Returned user_id differs from caller's → cross-tenant attempt;
 *       `{ ok: false, reason: 'scenario_owned_by_other_user' }` and the
 *       route emits 422.
 *     - RPC errors (network, DB down, permission) → treated as skipped
 *       and the turn proceeds. `append_turn_atomic` is the last line of
 *       defence and will still surface a genuine missing-scenario as
 *       STATE_COMMIT_FAILED.
 *
 *   userId ABSENT (older UI or system events without identity):
 *     - Skip the RPC entirely. We CANNOT upsert without a user_id (the
 *       scenarios.user_id column is NOT NULL and the FK demands a real
 *       auth.users row). Pre-flight is a best-effort optimisation, not
 *       a correctness requirement — return `{ ok: true, skipped: true }`
 *       and let `append_turn_atomic` surface a missing scenario with
 *       its native "scenario X not found" error.
 *
 * ⚠ Caller-ownership check is PoC-grade only. See ensureScenarioExists
 * on SessionStore and the migration file header for the production-
 * upgrade path (JWT-scoped client + auth.uid()).
 */
export type PreflightResult =
  | { readonly ok: true; readonly skipped?: boolean }
  | { readonly ok: false; readonly reason: 'scenario_owned_by_other_user' };

export async function preflightEnsureScenario(
  scenarioId: string,
  userId: string | null,
  requestId: string,
  sessionStore?: SessionStore,
): Promise<PreflightResult> {
  if (userId === null) {
    log.debug(
      { request_id: requestId, scenario_id: scenarioId },
      'V5 pre-flight: no user_id on request — upsert skipped, letting commit RPC be the last line of defence',
    );
    return { ok: true, skipped: true };
  }

  let authoritativeUserId: string;
  try {
    const store = sessionStore ?? getSessionStore();
    const result = await store.ensureScenarioExists(scenarioId, userId);
    authoritativeUserId = result.user_id;
  } catch (e) {
    log.debug(
      {
        request_id: requestId,
        scenario_id: scenarioId,
        err_name: e instanceof Error ? e.name : 'unknown',
        err_message: e instanceof Error ? e.message : String(e),
      },
      'V5 pre-flight ensureScenarioExists skipped (store unavailable or RPC error)',
    );
    return { ok: true, skipped: true };
  }

  if (authoritativeUserId !== userId) {
    log.warn(
      {
        request_id: requestId,
        scenario_id: scenarioId,
        caller_user_id_prefix: userId.slice(0, 8),
        owner_user_id_prefix: authoritativeUserId.slice(0, 8),
      },
      'V5 pre-flight: scenario owned by a different user — rejecting turn as cross-tenant attempt',
    );
    return { ok: false, reason: 'scenario_owned_by_other_user' };
  }

  return { ok: true };
}
