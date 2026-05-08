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
import type { HandlerFactWithTurn } from './session/store.js';

import { emit, TelemetryEvents, log } from '../utils/telemetry.js';
import { GraphV3, type GraphV3T } from '../schemas/cee-v3.js';
import { computeStructuralReadiness } from '../orchestrator/tools/analysis-ready-helper.js';

import { getTurnExecutorBudgets } from './budgets.js';
import { SessionReadError, type SessionStore } from './session/store.js';
import { getSessionStore } from './session/index.js';
import type { PendingAction } from './session/pending-action.js';

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
  /**
   * Same facts as `prior_facts` but each entry pairs the fact with
   * its parent turn's row id and creation timestamp via the FK
   * `v5_handler_facts.v5_conversation_turn_id`. Consumed by the
   * proposed-change synthesis idempotency path which filters facts
   * by `turn_created_at >= proposal.emitted_at_iso` — a schema-
   * aligned ownership link, not a positional heuristic across
   * `prior_turns` and `prior_facts`. Order matches `prior_facts`.
   *
   * Empty when the session store doesn't implement
   * `readFactsWithTurnFor` (only the case for legacy test mocks);
   * production always populates this from the FK join.
   */
  readonly prior_facts_with_turn: readonly HandlerFactWithTurn[];
  /**
   * V5 Phase 1 brief persistence: the user-supplied free-text decision
   * brief, sourced from canonical state (`scenarios.brief_text`) rather
   * than the legacy out-of-band `RunTurnExecutorOptions.scenarioBrief`
   * channel. Populated on every turn AFTER the first draft turn that
   * persisted the brief; null on the first draft turn (no brief in DB
   * yet — that turn is the one writing it) or when no brief has been
   * persisted for this scenario.
   *
   * Consumed by:
   *   - turn-executor.ts (decision-review enricher invocation, ~L1264)
   *   - chip-click-dispatch.ts (decision-review enricher invocation, ~L323)
   *
   * This field replaces both the legacy `options.scenarioBrief` (always
   * undefined in practice — no caller populated it) and the hardcoded
   * `brief: null` in chip-click-dispatch (which made decision_review
   * always skip with reason `no_brief` on the chip-click path).
   */
  readonly scenarioBriefText: string | null;
  /**
   * V5 Phase 1 brief persistence: the persisted graph from
   * `scenarios.graph`, loaded in the same round trip as
   * `scenarioBriefText` via `loadGraphAndBriefText`. Surfaced on the
   * context so the turn-executor's no-graphState fallback can avoid a
   * second Supabase read of the same column.
   *
   * Null when no graph is persisted for this scenario, or when the
   * canonical-state read failed (graceful degradation matches
   * scenarioBriefText behaviour).
   */
  readonly persistedGraph: unknown | null;
  /**
   * V5 Wave 2: pending actions emitted by the most recent prior turn.
   * Populated from `SessionStore.readMostRecentPendingActions`. Empty
   * array means either "no prior turn carried pending actions" or
   * "persistence read degraded" (in the latter case
   * `session.pending_actions.read_degraded` telemetry is emitted, mirroring
   * the prior_turns degradation path). Read-side narrowing is enforced
   * upstream — only the LAST prior turn's pending_actions appear here.
   *
   * Optional on the type so existing tests that hand-construct
   * `EnrichedTurnContext` with `prior_turns: []` keep working without
   * a fixture update. TurnExecutor reads via `?? []`.
   */
  readonly most_recent_pending_actions?: readonly PendingAction[];
}

export interface BuildTurnContextOptions {
  /**
   * Override the default session store. Production code passes nothing and
   * the factory resolves the singleton. Tests pass a mock to avoid touching
   * real Supabase.
   */
  readonly sessionStore?: SessionStore;
}

export interface RunAnalysisScenarioSnapshot {
  readonly graph: GraphV3T;
  readonly options: Array<{
    readonly id: string;
    readonly option_id: string;
    readonly label: string;
    readonly interventions: Record<string, number>;
  }>;
  readonly goal_node_id: string;
  /**
   * V5 D1 (Brief: D1 deterministic handlers, P0-2 follow-up):
   * `add_constraint` persists to `graph.goal_constraints` (top-level
   * field on GraphV3). PLoT consumes them via the run payload's
   * top-level `goal_constraints`, not via the graph object — so the
   * handler must explicitly forward them. Surfaced on the snapshot
   * so `runAnalysisHandler` can attach without a second graph parse.
   */
  readonly goal_constraints?: unknown;
  /**
   * V5 state-trust: the RAW persisted graph as stored in
   * `scenarios.graph` BEFORE GraphV3.safeParse. This is the same shape
   * turn-executor sees when it falls back to loadPersistedGraph +
   * GraphStateIngressSchema.safeParse on a follow-up explain turn.
   *
   * Why surface this alongside the V3-parsed `graph` field: the V3
   * schema strips top-level `options` and `goal_node_id` (they're not
   * declared on GraphV3) AND it transforms the V3 options shape to
   * the PLoT-projection here in loadScenarioSnapshotForRunAnalysis.
   * Hashing either of those projections would produce a hash that
   * differs from what the turn-executor freshness derivation computes
   * from the same persisted JSON. The raw persisted graph is the
   * single representation both sides can hash to a matching value.
   *
   * Note: `goal_constraints` IS declared on GraphV3 (D1 added it as
   * an optional top-level field) and therefore survives the parse —
   * but the rest of the rationale above still applies for `options`
   * and `goal_node_id`.
   */
  readonly rawPersistedGraph: unknown;
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

  const store = options.sessionStore ?? tryGetSessionStore(requestId, payload.scenario_id);
  const priorTurns = await fetchPriorTurns(payload.scenario_id, requestId, store);
  const { facts: priorFacts, factsWithTurn: priorFactsWithTurn } = await fetchPriorFacts(
    priorTurns,
    requestId,
    payload.scenario_id,
    store,
  );
  // V5 Phase 1 brief persistence: load the persisted brief_text alongside
  // the graph so callers can read both from canonical state. Failure to
  // read scenarios.* is non-fatal (graceful degradation); the field
  // collapses to null and decision_review skips with `no_brief` exactly
  // as before.
  const scenarioState = await fetchPersistedScenarioState(
    payload.scenario_id,
    requestId,
    store,
  );

  // V5 Wave 2: read pending actions from the most recent prior turn.
  // Read failures are non-fatal — empty array on degradation, mirrors
  // the prior_turns degradation path.
  const mostRecentPendingActions = await fetchMostRecentPendingActions(
    payload.scenario_id,
    requestId,
    store,
  );

  return {
    ...baseContext,
    prior_turns: priorTurns,
    prior_facts: priorFacts,
    prior_facts_with_turn: priorFactsWithTurn,
    scenarioBriefText: scenarioState.briefText,
    persistedGraph: scenarioState.graph,
    most_recent_pending_actions: mostRecentPendingActions,
  };
}

async function fetchMostRecentPendingActions(
  scenarioId: string,
  requestId: string,
  store: SessionStore | undefined,
): Promise<readonly PendingAction[]> {
  if (!store) return [];
  try {
    return await store.readMostRecentPendingActions(scenarioId);
  } catch (e) {
    log.warn(
      {
        request_id: requestId,
        scenario_id: scenarioId,
        err: (e as Error)?.message ?? String(e),
      },
      'V5 build-turn-context — readMostRecentPendingActions failed; degrading to empty list',
    );
    return [];
  }
}

async function fetchPersistedScenarioState(
  scenarioId: string,
  requestId: string,
  store: SessionStore | undefined,
): Promise<{ readonly graph: unknown | null; readonly briefText: string | null }> {
  if (!store) return { graph: null, briefText: null };
  try {
    return await store.loadGraphAndBriefText(scenarioId);
  } catch (error) {
    const errorCode = error instanceof SessionReadError ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    log.warn(
      { request_id: requestId, scenario_id: scenarioId, error_code: errorCode, err: message },
      'V5 buildTurnContext: scenarios.* read failed, continuing with null graph + null briefText',
    );
    emit(TelemetryEvents.SessionReadDegraded, {
      request_id: requestId,
      scenario_id: scenarioId,
      error_code: errorCode ?? 'unknown',
      severity: 'warning',
    });
    return { graph: null, briefText: null };
  }
}

/**
 * Resolve the session store, returning undefined on factory failure so the
 * turn can proceed with empty prior_turns/facts (graceful degradation).
 *
 * Factory failure is NOT silent: a `session.read_degraded` telemetry event
 * is emitted with `severity: 'warning'` so ops alerting on
 * `session.read_degraded_total > 0` catches the case where missing
 * env/config disables session reads entirely. Without this, a deployment
 * that lost its Supabase env vars would run for an arbitrary window with
 * no prior-turn history and no signal that anything was wrong.
 *
 * Logged fields are intentionally narrow (error class name + message) —
 * stack traces are omitted to avoid emitting internal stack frames into
 * production telemetry.
 */
function tryGetSessionStore(requestId: string, scenarioId: string): SessionStore | undefined {
  try {
    return getSessionStore();
  } catch (error) {
    const errorClass = error instanceof Error ? error.name : 'unknown';
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.warn(
      {
        request_id: requestId,
        scenario_id: scenarioId,
        err_class: errorClass,
        err: errorMessage,
      },
      'V5 buildTurnContext: getSessionStore() factory threw — continuing with empty prior_turns/facts',
    );
    emit(TelemetryEvents.SessionReadDegraded, {
      request_id: requestId,
      scenario_id: scenarioId,
      error_code: errorClass,
      severity: 'warning',
    });
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
): Promise<{
  readonly facts: readonly HandlerFact[];
  readonly factsWithTurn: readonly HandlerFactWithTurn[];
}> {
  // Critical correctness fix: `readFactsFor` filters against
  // `v5_handler_facts.v5_conversation_turn_id`, which is the FK to the
  // `v5_conversation_turns.id` row UUID — NOT the client-supplied
  // `turn_id` string. Passing `turn_id` here silently matched zero rows
  // and made `prior_facts` always empty in production, breaking both the
  // analysis-fallback feature (Task 1.4) and the coaching-cache decision
  // review / signal lookups. Use `t.id` so the FK lookup resolves.
  const handlerRowIds = priorTurns
    .filter((t) => t.turn_class === 'handler')
    .map((t) => t.id);
  // Lean info row: counts and presence flags only. Verbose arrays moved to
  // debug — set LOG_LEVEL=debug to recover handler_row_ids / per-turn
  // class+handler arrays when investigating fact-chain issues.
  log.info(
    {
      event: 'v5_fact_chain_trace',
      request_id: requestId,
      scenario_id: scenarioId,
      session_store_present: store !== undefined,
      prior_turn_count: priorTurns.length,
      handler_row_id_count: handlerRowIds.length,
    },
    'V5 buildTurnContext: fact chain trace',
  );
  log.debug(
    {
      event: 'v5_fact_chain_trace_detail',
      request_id: requestId,
      scenario_id: scenarioId,
      prior_turn_classes: priorTurns.map((t) => t.turn_class),
      prior_turn_handler_ids: priorTurns.map((t) => t.handler_id ?? null),
      handler_row_ids: handlerRowIds,
    },
    'V5 buildTurnContext: fact chain trace (verbose)',
  );
  const empty = { facts: [] as readonly HandlerFact[], factsWithTurn: [] as readonly HandlerFactWithTurn[] };
  if (!store) return empty;
  if (priorTurns.length === 0) return empty;
  if (handlerRowIds.length === 0) return empty;
  try {
    // Prefer the with-turn variant when the store implements it
    // (production SupabaseSessionStore always does). Test mocks
    // that pre-date this method fall back to readFactsFor with an
    // empty factsWithTurn — the proposed-change synthesis path is
    // disabled in that case (it never triggers without facts), but
    // every other consumer keeps working.
    const factsWithTurn = store.readFactsWithTurnFor
      ? await store.readFactsWithTurnFor(handlerRowIds)
      : ([] as readonly HandlerFactWithTurn[]);
    const facts =
      factsWithTurn.length > 0
        ? factsWithTurn.map((w) => w.fact)
        : await store.readFactsFor(handlerRowIds);
    log.info(
      {
        event: 'v5_turn_context_facts',
        request_id: requestId,
        scenario_id: scenarioId,
        prior_turn_count: priorTurns.length,
        handler_row_id_count: handlerRowIds.length,
        fact_count: facts.length,
        fact_types: facts.map((f) => f.fact_type),
        has_run_analysis_fact: facts.some((f) => f.fact_type === 'run_analysis'),
      },
      'V5 buildTurnContext: prior_facts loaded',
    );
    return { facts, factsWithTurn };
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
    return empty;
  }
}

/**
 * V5 ingress pre-flight: ensure the scenarios row exists, creating it on-
 * demand. Replaces the 2026-04-20 existence-only check (dbd59c9e) which
 * rejected valid traffic when the UI's INSERT race-landed after the first
 * V5 turn.
 *
 * Lives alongside buildTurnContext because this file is the declared
 * session-layer integration point (per the state-write invariant at
 * scripts/validate-state-write-invariant.sh — only session/, commit.ts,
 * and build-turn-context.ts are allowed to import the SessionStore).
 *
 * Behaviour matrix:
 *
 *   userId PRESENT (authenticated UI path):
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
 *   userId ABSENT (guest mode — VITE_AUTH_MODE=guest):
 *     - RPC is STILL called. scenarios.user_id is nullable; the row is
 *       created with user_id = NULL. Ownership check is skipped (no
 *       ownership concept in guest mode). Returns `{ ok: true }`.
 *     - RPC errors → same fail-open behaviour as the authenticated path.
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
  let authoritativeUserId: string | null;
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

  // Skip ownership check in guest mode (either side null means no auth identity).
  if (userId !== null && authoritativeUserId !== null && authoritativeUserId !== userId) {
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

/**
 * Load the persisted scenario state (graph + brief_text) from the
 * session store in a single round trip.
 *
 * Called by TurnExecutor and ad-hoc handlers when canonical scenario
 * state is needed (no graphState supplied; brief_text needed for
 * decision_review enrichment). Failure is swallowed and the result
 * collapses to `{ graph: null, briefText: null }` — callers treat null
 * fields as "not available" and continue with degraded context.
 *
 * Centralised here (rather than in turn-executor.ts) so the session
 * store access surface stays bounded to the three declared integration
 * points: session/, commit.ts, build-turn-context.ts.
 */
export async function loadPersistedScenarioState(
  scenarioId: string,
  requestId: string,
  sessionStore?: SessionStore,
): Promise<{ readonly graph: unknown | null; readonly briefText: string | null }> {
  try {
    const store = sessionStore ?? getSessionStore();
    return await store.loadGraphAndBriefText(scenarioId);
  } catch (e) {
    log.warn(
      { request_id: requestId, scenario_id: scenarioId, err: e instanceof Error ? e.message : String(e) },
      'V5 build-turn-context: loadPersistedScenarioState failed, returning null graph + null briefText',
    );
    return { graph: null, briefText: null };
  }
}

/**
 * Load the persisted graph for a scenario from the session store.
 *
 * @deprecated Prefer {@link loadPersistedScenarioState} which returns
 *   both the graph and the persisted brief_text in one round trip.
 *   Retained as a thin wrapper for callers that only need the graph
 *   and have not yet been migrated.
 */
export async function loadPersistedGraph(
  scenarioId: string,
  requestId: string,
  sessionStore?: SessionStore,
): Promise<unknown | null> {
  return (await loadPersistedScenarioState(scenarioId, requestId, sessionStore)).graph;
}

/**
 * Strict variant of `loadPersistedGraph` that does NOT swallow errors.
 *
 * Same authoritative read against `scenarios.graph` via the session
 * store, but propagates `SessionReadError` to the caller instead of
 * collapsing into `null`. Use when the caller needs to distinguish
 * "store reachable, no graph stored" (returns null) from
 * "store unreachable / RPC threw" (throws) — for example, the V5
 * Phase 2.5 edit-routing recovery path uses this distinction to emit
 * `reason: 'no_persisted_graph'` versus `reason: 'session_store_failed'`
 * on the `v5.edit_graph.graph_state_unavailable` telemetry event.
 *
 * Lives in this module (rather than at the call site) so the
 * `SessionStore` import surface stays bounded to the three declared
 * integration points: session/, commit.ts, build-turn-context.ts.
 * The pre-push `state-write-invariant` check enforces that boundary.
 */
export async function loadPersistedGraphStrict(
  scenarioId: string,
  sessionStore?: SessionStore,
): Promise<unknown | null> {
  const store = sessionStore ?? getSessionStore();
  return await store.loadGraph(scenarioId);
}

export async function loadScenarioSnapshotForRunAnalysis(
  scenarioId: string,
  requestId: string,
  sessionStore?: SessionStore,
): Promise<RunAnalysisScenarioSnapshot> {
  const persistedGraph = await loadPersistedGraph(scenarioId, requestId, sessionStore);
  if (!persistedGraph) {
    throw new Error(`No persisted graph found for scenario ${scenarioId}`);
  }

  const parsedGraph = GraphV3.safeParse(persistedGraph);
  if (!parsedGraph.success) {
    throw new Error(`Persisted graph failed GraphV3 validation for scenario ${scenarioId}`);
  }

  const readiness = computeStructuralReadiness(parsedGraph.data);
  if (!readiness?.goal_node_id) {
    throw new Error(`Could not derive analysis_ready.goal_node_id for scenario ${scenarioId}`);
  }

  return {
    graph: parsedGraph.data,
    options: readiness.options.map((option) => ({
      id: option.option_id,
      option_id: option.option_id,
      label: option.label,
      interventions: normaliseNumericInterventions(option.interventions),
    })),
    goal_node_id: readiness.goal_node_id,
    rawPersistedGraph: persistedGraph,
    // V5 D1 P0-2: forward graph.goal_constraints so PLoT receives
    // constraints added via `add_constraint`. Omitted when absent so
    // run-analysis can use the existing optional-field idiom.
    ...(parsedGraph.data.goal_constraints !== undefined
      ? { goal_constraints: parsedGraph.data.goal_constraints }
      : {}),
  };
}

function normaliseNumericInterventions(
  interventions: Record<string, unknown>,
): Record<string, number> {
  const entries: Array<[string, number]> = [];
  for (const [factorId, rawValue] of Object.entries(interventions)) {
    const numeric = extractNumericInterventionValue(rawValue);
    if (numeric !== null) entries.push([factorId, numeric]);
  }
  return Object.fromEntries(entries);
}

function extractNumericInterventionValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = (value as Record<string, unknown>).value;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}
