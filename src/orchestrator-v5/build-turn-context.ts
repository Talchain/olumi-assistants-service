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

import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';
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

export async function buildTurnContext(
  payload: OrchestratorTurnPayload,
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
 * Group 3 Task A pre-flight: check that the scenario row exists BEFORE
 * running the turn executor. Surfaces a missing scenario as a clean 422
 * at the ingress boundary rather than as an opaque STATE_COMMIT_FAILED
 * at commit time.
 *
 * Lives alongside buildTurnContext because this file is the declared
 * session-layer integration point (per the state-write invariant at
 * scripts/validate-state-write-invariant.sh — only session/, commit.ts,
 * and build-turn-context.ts are allowed to import the SessionStore).
 * Keeping the pre-flight here preserves the narrow-write-surface
 * invariant without the route needing a SessionStore import.
 *
 * Return contract:
 *   - `{ ok: true }`             scenario exists, turn can proceed
 *   - `{ ok: false, reason: 'scenario_not_found' }`
 *                                scenario is genuinely absent from the
 *                                table; route emits 422 with typed
 *                                BoundaryError
 *   - `{ ok: true, skipped: true }`
 *                                store unreachable or read error; route
 *                                passes the turn through (the commit
 *                                RPC is the last line of defence, and
 *                                we must not block traffic on a session
 *                                outage)
 *
 * ⚠ Does NOT enforce caller ownership. See ⚠ CROSS-TENANT LIMITATION
 * on SupabaseSessionStore.checkScenarioExists.
 */
export type PreflightResult =
  | { readonly ok: true; readonly skipped?: boolean }
  | { readonly ok: false; readonly reason: 'scenario_not_found' };

export async function preflightScenarioCheck(
  scenarioId: string,
  requestId: string,
  sessionStore?: SessionStore,
): Promise<PreflightResult> {
  let exists: boolean;
  try {
    const store = sessionStore ?? getSessionStore();
    exists = await store.checkScenarioExists(scenarioId);
  } catch (e) {
    log.debug(
      {
        request_id: requestId,
        scenario_id: scenarioId,
        err_name: e instanceof Error ? e.name : 'unknown',
        err_message: e instanceof Error ? e.message : String(e),
      },
      'V5 pre-flight scenario check skipped (store unavailable or read error)',
    );
    return { ok: true, skipped: true };
  }

  if (exists) return { ok: true };

  log.warn(
    { request_id: requestId, scenario_id: scenarioId },
    'V5 pre-flight: scenario not found — rejecting turn',
  );
  return { ok: false, reason: 'scenario_not_found' };
}
