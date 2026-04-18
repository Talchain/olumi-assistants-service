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
import type { SessionTurn, TurnContext } from '@talchain/schemas/orchestrator';

import { emit, TelemetryEvents, log } from '../utils/telemetry.js';

import { getTurnExecutorBudgets } from './budgets.js';
import { SessionReadError, type SessionStore } from './session/store.js';
import { getSessionStore } from './session/index.js';

export interface EnrichedTurnContext extends TurnContext {
  /**
   * Prior turns for this scenario, fetched at turn-build time from the
   * session store (Supabase, with LRU cache). Ordered by `created_at DESC`
   * — most recent first. Empty array means either "no prior history" or
   * "persistence read degraded" — disambiguate via the
   * `session.read_degraded` telemetry event.
   */
  readonly prior_turns: readonly SessionTurn[];
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

  const priorTurns = await fetchPriorTurns(payload.scenario_id, requestId, options.sessionStore);

  return { ...baseContext, prior_turns: priorTurns };
}

async function fetchPriorTurns(
  scenarioId: string,
  requestId: string,
  injected: SessionStore | undefined,
): Promise<readonly SessionTurn[]> {
  try {
    const store = injected ?? getSessionStore();
    return await store.readRecent(scenarioId);
  } catch (error) {
    const errorCode = error instanceof SessionReadError ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    log.warn(
      { request_id: requestId, scenario_id: scenarioId, error_code: errorCode, err: message },
      'V5 buildTurnContext: session.readRecent failed — continuing with empty prior_turns',
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
