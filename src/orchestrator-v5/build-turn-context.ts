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
import type {
  DecisionContext,
  HandlerFact,
  SessionTurn,
  TurnContext,
} from '@talchain/schemas/orchestrator';
import type { HandlerFactWithTurn } from './types/handler-fact.js';
import type { SessionTurnWithContent } from './session/conversation-content.js';

import { emit, TelemetryEvents, log } from '../utils/telemetry.js';
import { GraphV3, type GraphV3T } from '../schemas/cee-v3.js';
import { config } from '../config/index.js';
import {
  computeStructuralReadiness,
  mergeInterventionSourceObjects,
} from '../orchestrator/tools/analysis-ready-helper.js';
import {
  buildFactorScaleMap,
  projectInterventionsToRawScale,
  summariseConversions,
  summaryIsNoteworthy,
  type InterventionConversion,
} from './tools/plot-intervention-scale.js';
import { assessAnalysisReadiness, AnalysisNotReadyError } from './tools/handlers/analysis-ready-core.js';
// Types-only base for the run_analysis snapshot's shared fields — see the
// module doc: zero runtime coupling; the handler-ownership check gates the
// RUNTIME handler module (tools/handlers/run-analysis), not this sibling.
import type { RunAnalysisSnapshotSharedFields } from './tools/handlers/run-analysis-snapshot-types.js';
import { deriveDecisionContext } from './coaching/decision-context.js';
import { deriveCoachingState, type CoachingState } from './coaching/coaching-state.js';
import type { CoachingStateSnapshot } from './coaching/coaching-state-snapshot.js';
import {
  deriveCoachingEvaluability,
  deriveCoachingLifecycle,
  EMPTY_COACHING_LIFECYCLE,
  type CoachingLifecycle,
} from './coaching/coaching-lifecycle.js';
import { deriveAnalysisFreshness } from './context/freshness.js';
import { summariseGraphCounts } from './context/build-context-summary.js';
import { computeAnalysisAffectingGraphHash } from './context/graph-hash.js';
import { extractGraphOptionIds } from './context/option-identity.js';
import { GraphStateIngressSchema } from './boundary/request-extensions.js';

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
   *
   * V5 Conversation Context Reliability: carries the content-bearing superset
   * (user_message / assistant_message) so the ContextPack conversation
   * projection can surface prior turn text to the LLM. Superset of SessionTurn,
   * so fact-loading and other consumers that read only metadata are unaffected.
   */
  readonly prior_turns: readonly SessionTurnWithContent[];
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
   * by `fact_created_at >= proposal.emitted_at_iso` — a schema-
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
  /**
   * V5 Coaching State Spine — Stage 1: deterministic projection of canonical
   * state (`scenarios.brief_text` + `scenarios.graph`) into the already-shipped
   * `@talchain/schemas` `DecisionContext` shape — domain anchors (monetary
   * figures, timeline, named entities) + goal translation. INTERNAL ONLY: never
   * serialised on the wire, never added to the LLM-facing ContextPack or the
   * routing prompt. Re-derived from persisted state every turn, so it is always
   * consistent with the current graph; `not_populated` (EMPTY_DECISION_CONTEXT)
   * on the first draft turn (no brief/graph persisted yet) and populated
   * thereafter.
   *
   * Required (not optional): production `buildTurnContext` populates it on every
   * turn, so downstream Stage 2 coaching consumers can rely on its presence
   * without a `?? EMPTY_DECISION_CONTEXT` guard. Tests that hand-construct an
   * `EnrichedTurnContext` set it explicitly (or cast via `as unknown as`).
   */
  readonly decision_context: DecisionContext;
  /**
   * V5 Coaching State Spine — Stage 2A: deterministic CURRENT-TURN coaching-signal
   * container, derived from canonical state (decision_context status + the single
   * analysis-freshness verdict + structural readiness blockers + present `defaulted` /
   * decision_review `evidence_enhancements` fields). Each signal carries a stable
   * `signal_id` and a current `active | stale | unavailable` status — NO cross-turn
   * lifecycle (no `resolved`). INTERNAL ONLY: never serialised on the wire, never added
   * to the ContextPack or the routing prompt. Re-derived every turn, so it is always
   * consistent with the current graph.
   *
   * Distinct from the durable `v5_coaching_state` table Stage 2B will introduce, and from
   * the Step-5 coaching-TEXT detector (`../signals/coaching-signals.ts`).
   *
   * Required (not optional): production `buildTurnContext` populates it on every turn, so
   * Stage 2B/3 consumers can rely on its presence without a `?? EMPTY_COACHING_STATE`
   * guard. Tests that hand-construct an `EnrichedTurnContext` set it explicitly (or cast
   * via `as unknown as`).
   */
  readonly coaching_state: CoachingState;
  /**
   * V5 Coaching State Spine — Stage 2B-1b: the most recent PRIOR pre-dispatch
   * coaching-state snapshot for this scenario, read from
   * `v5_conversation_turns.coaching_state` (non-null, bounded `ORDER BY
   * created_at DESC LIMIT 1`). `null` when no prior turn persisted a coaching
   * state, the read degraded, or the snapshot failed the defensive parse.
   *
   * Carries the `snapshot_timing: 'pre_dispatch'` envelope so a future Stage
   * 2B-2 lifecycle can compare like-for-like (pre-dispatch prior vs pre-dispatch
   * current). 2B-1b ONLY makes it available internally — NO lifecycle is derived
   * here. INTERNAL ONLY: never on the wire, ContextPack, or routing prompt.
   *
   * Required (not optional) with a nullable VALUE: production `buildTurnContext`
   * always sets it (to a snapshot or `null`). Tests that hand-construct an
   * `EnrichedTurnContext` set it explicitly (or cast via `as unknown as`).
   */
  readonly prior_coaching_state: CoachingStateSnapshot | null;
  /**
   * V5 Coaching State Spine — Stage 2B-2: internal lifecycle facts derived by comparing
   * `prior_coaching_state` (pre-dispatch) against the current `coaching_state` (pre-dispatch)
   * with per-source evaluability — each signal labelled `active | resolved | stale |
   * unavailable`. Pure/total derivation; `resolved` requires POSITIVE evaluability evidence
   * (never absence alone). NO consumer in 2B-2; NO user-facing surface.
   *
   * Required (not optional): production `buildTurnContext` always sets it (to a derived
   * lifecycle or `EMPTY_COACHING_LIFECYCLE`). INTERNAL ONLY: never on the wire, ContextPack,
   * routing prompt, or DGAI output. Tests set it explicitly (or cast via `as unknown as`).
   */
  readonly coaching_lifecycle: CoachingLifecycle;
}

export interface BuildTurnContextOptions {
  /**
   * Override the default session store. Production code passes nothing and
   * the factory resolves the singleton. Tests pass a mock to avoid touching
   * real Supabase.
   */
  readonly sessionStore?: SessionStore;
}

/**
 * Reader-side declaration of the run_analysis snapshot. The handler-side
 * contract lives in tools/handlers/run-analysis.ts (the handler-ownership
 * invariant forbids importing that RUNTIME module here); the shared
 * optional-metadata fields derive from the types-only base
 * `run-analysis-snapshot-types.ts` so the two declarations cannot drift on
 * those fields. Only the genuinely-divergent fields are declared here:
 * `graph` is the GraphV3-PARSED form on this side (the handler side keeps
 * `unknown`), and `rawPersistedGraph` is narrowed optional→REQUIRED because
 * production loads always populate it.
 */
export interface RunAnalysisScenarioSnapshot extends RunAnalysisSnapshotSharedFields {
  readonly graph: GraphV3T;
  readonly options: Array<{
    readonly id: string;
    readonly option_id: string;
    readonly label: string;
    readonly interventions: Record<string, number>;
  }>;
  readonly goal_node_id: string;
  /**
   * Narrowed from the base's optional: every load from
   * `loadScenarioSnapshotForRunAnalysis` populates it.
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
  // V5 Conversation Context Reliability: continuity-gap guard. A 'chip'/'chip_click'
  // turn PROVABLY continues a prior conversation — the chip can only exist if a
  // prior assistant turn rendered it — so zero prior turns under this scenario_id
  // means the conversation was fragmented across scenario_ids (UI did not hold a
  // stable scenario_id). CEE cannot repair the id (it takes ingress.scenario_id
  // verbatim and the payload carries no history), but it must not silently accept
  // a blank context. Emit a content-free warning so the gap is observable rather
  // than surfacing as a baffling "the AI forgot everything". Guard is gated to
  // store-present so a degraded read (already telemetered as session.read_degraded)
  // is not double-counted as a fragmentation gap.
  if (
    store !== undefined &&
    priorTurns.length === 0 &&
    (payload.source === 'chip_click' || payload.source === 'chip')
  ) {
    log.warn(
      {
        event: 'v5_session_continuity_gap',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        source: payload.source,
        stage: payload.stage,
        prior_turn_count: 0,
      },
      'V5 buildTurnContext: continuity gap — chip-sourced turn arrived with zero prior turns (likely scenario-id fragmentation)',
    );
    emit(TelemetryEvents.V5SessionContinuityGap, {
      scenario_id: payload.scenario_id,
      source: payload.source,
      stage: payload.stage,
      prior_turn_count: 0,
    });
  }
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

  // V5 Coaching State Spine — Stage 2B-1b: read the most recent PRIOR pre-dispatch
  // coaching-state snapshot (non-null, bounded LIMIT 1). Internal-only; attached as
  // prior_coaching_state for future (Stage 2B-2) lifecycle consumers. Read failures
  // degrade to null — never fail the turn. No lifecycle is derived here.
  const priorCoachingState = await fetchMostRecentCoachingState(
    payload.scenario_id,
    requestId,
    store,
  );

  // V5 Coaching State Spine — Stage 1: derive the DecisionContext projection
  // deterministically from canonical state (brief_text + graph). Pure + total
  // (never throws), internal-only — it is attached to EnrichedTurnContext and
  // never reaches the wire or the LLM prompt. The provenance hash is recorded
  // in telemetry only; Stage 2 carries it on durable state.
  const decisionContext = deriveDecisionContext(
    scenarioState.briefText,
    scenarioState.graph,
  );
  // Single canonical persisted-graph hash, computed once and reused by both the
  // DecisionContext provenance telemetry and the Stage-2A coaching-state derivation.
  const persistedGraphHash = deriveDecisionContextGraphHash(scenarioState.graph);
  emit(TelemetryEvents.DecisionContextDerived, {
    request_id: requestId,
    scenario_id: payload.scenario_id,
    status: decisionContext.status,
    monetary_count: decisionContext.domain_anchors.monetary_figures.length,
    has_timeline: decisionContext.domain_anchors.timeline !== null,
    entity_count: decisionContext.domain_anchors.named_entities.length,
    has_goal_metric: decisionContext.goal_translation.user_scale_metric !== null,
    has_goal_target: decisionContext.goal_translation.user_scale_target !== null,
    derived_from_graph_hash: persistedGraphHash,
  });

  // V5 Coaching State Spine — Stage 2A: derive the current-turn coaching-signal
  // container from canonical state. The analysis-freshness verdict is computed here
  // from the SAME single source of truth (`deriveAnalysisFreshness`) and the SAME
  // persisted-graph hash the routing path uses — reused internally only, NOT emitted
  // as freshness telemetry (turn-executor owns that), so there is no second freshness
  // signal. Pure + total, internal-only — never reaches the wire or the LLM prompt.
  const coachingFreshness = deriveAnalysisFreshness(
    priorFacts,
    persistedGraphHash,
    // Option-identity guard (CEE_OPTION_IDENTITY_FRESHNESS_GUARD): keep the
    // internal coaching freshness consistent with the wire verdict so there is
    // no second freshness authority. Same graph the hash is derived from.
    config.cee.optionIdentityFreshnessGuard
      ? extractGraphOptionIds(scenarioState.graph)
      : undefined,
  );
  const coachingState = deriveCoachingState({
    decisionContext,
    freshness: coachingFreshness,
    priorFacts,
    graphHash: persistedGraphHash,
    persistedGraph: scenarioState.graph,
  });
  emit(TelemetryEvents.V5CoachingStateDerived, {
    request_id: requestId,
    scenario_id: payload.scenario_id,
    status: coachingState.status,
    signal_count: coachingState.signals.length,
    active_count: coachingState.summary.active_count,
    stale_count: coachingState.summary.stale_count,
    unavailable_count: coachingState.summary.unavailable_count,
    kinds_present: distinctSorted(coachingState.signals.map((s) => s.kind)),
    reason_codes: distinctSorted(coachingState.signals.map((s) => s.reason_code)),
    graph_hash: coachingState.graph_hash,
    analysis_graph_hash: coachingState.analysis_graph_hash,
    freshness: coachingFreshness.freshness,
  });

  // V5 Coaching State Spine — Stage 2B-2: derive internal lifecycle facts by comparing the
  // prior pre-dispatch snapshot against the current pre-dispatch coaching_state, with
  // per-source evaluability evidence (shared with the Stage-2A producers). Pure/total and
  // internal-only — never wire/ContextPack/prompt/DGAI. `resolved` requires POSITIVE
  // evaluability evidence, never absence alone. Derivation is defensively guarded; the
  // telemetry emit is separately guarded so a telemetry fault degrades to a warning and
  // NEVER fails turn construction (this emit path is pre-dispatch). Global emit() hardening
  // is a separate telemetry-infra lane — out of scope here.
  let coachingLifecycle: CoachingLifecycle = EMPTY_COACHING_LIFECYCLE;
  try {
    const coachingEvaluability = deriveCoachingEvaluability({
      freshness: coachingFreshness,
      priorFacts,
      persistedGraph: scenarioState.graph,
    });
    coachingLifecycle = deriveCoachingLifecycle({
      prior: priorCoachingState,
      current: coachingState,
      evaluability: coachingEvaluability,
      currentGraphHash: persistedGraphHash,
    });
  } catch {
    coachingLifecycle = EMPTY_COACHING_LIFECYCLE;
  }
  try {
    emit(TelemetryEvents.V5CoachingStateLifecycleDerived, {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      status: coachingLifecycle.status,
      prior_snapshot_available: coachingLifecycle.prior_snapshot_available,
      version_mismatch: coachingLifecycle.version_mismatch,
      active_count: coachingLifecycle.summary.active_count,
      resolved_count: coachingLifecycle.summary.resolved_count,
      stale_count: coachingLifecycle.summary.stale_count,
      unavailable_count: coachingLifecycle.summary.unavailable_count,
      kinds_present: distinctSorted(coachingLifecycle.items.map((i) => i.kind)),
      reason_codes: distinctSorted(coachingLifecycle.items.map((i) => i.reason_code)),
      lifecycle_statuses_present: distinctSorted(
        coachingLifecycle.items.map((i) => i.lifecycle_status),
      ),
      prior_graph_hash_present: coachingLifecycle.items.some((i) => i.prior_graph_hash !== null),
      current_graph_hash_present: persistedGraphHash !== null,
      snapshot_timing: coachingLifecycle.snapshot_timing,
      version: coachingLifecycle.version,
    });
  } catch {
    // Internal-only observability — a telemetry fault must never fail turn construction.
    log.warn(
      { request_id: requestId, scenario_id: payload.scenario_id },
      'V5 build-turn-context — v5.coaching_state.lifecycle_derived emit failed; continuing',
    );
  }

  return {
    ...baseContext,
    prior_turns: priorTurns,
    prior_facts: priorFacts,
    prior_facts_with_turn: priorFactsWithTurn,
    scenarioBriefText: scenarioState.briefText,
    persistedGraph: scenarioState.graph,
    most_recent_pending_actions: mostRecentPendingActions,
    decision_context: decisionContext,
    coaching_state: coachingState,
    prior_coaching_state: priorCoachingState,
    coaching_lifecycle: coachingLifecycle,
  };
}

/**
 * Distinct, lexicographically-sorted copy of a string list — used to emit closed-enum
 * sets (signal kinds / reason codes) on `v5.coaching_state.derived` deterministically and
 * with bounded cardinality.
 */
function distinctSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}

/**
 * Provenance hash for the graph the DecisionContext was derived from, computed
 * via the same path the turn-executor uses for the current-graph hash
 * (`GraphStateIngressSchema.safeParse` → `computeAnalysisAffectingGraphHash`)
 * so the two values are comparable. Telemetry-only in Stage 1; returns null
 * when no graph is persisted or the parse fails — provenance is diagnostic and
 * never affects correctness.
 */
export function deriveDecisionContextGraphHash(graph: unknown | null): string | null {
  if (graph == null) return null;
  try {
    let toHash: unknown = graph;
    // EP2 (V5 Edit Safety Core), gated atomically with the run-time guard. When
    // ON: (a) an unrecoverable graph short-circuits to null → freshness resolves
    // as `unknown`/current_graph_hash_unavailable (not fresh), so a prior result is
    // never shown as current over an un-analysable graph (Blocker 2); (b) a
    // ready/repaired graph is canonicalised BEFORE hashing so this matches the
    // run-time `graph_hash_at_run` (brief §6 consistency). Flag OFF ⇒ unchanged.
    //
    // UI RESIDUAL (EP2): the backend proves an unrecoverable graph does NOT read
    // fresh/current (freshness → `unknown`/current_graph_hash_unavailable). On
    // non-run turns, whether DGAI renders `unknown` as a clear "needs fixing" cue
    // is NOT verified here — the explicit recovery copy is tied to the run_analysis
    // `analysis_not_ready` outcome. UI rendering of `unknown` should be checked in
    // EP3 or a separate read-only UI verification.
    if (config.cee.analysisReadyGuardEnabled) {
      const verdict = assessAnalysisReadiness(graph);
      if (verdict.status === 'unrecoverable') return null;
      toHash = verdict.canonicalGraph ?? graph;
    }
    const parsed = GraphStateIngressSchema.safeParse(toHash);
    return parsed.success ? computeAnalysisAffectingGraphHash(parsed.data) : null;
  } catch {
    return null;
  }
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

/**
 * V5 Coaching State Spine — Stage 2B-1b: read the most recent prior pre-dispatch
 * coaching-state snapshot. Returns null when the store doesn't implement the
 * method (legacy test mocks), when no prior non-null snapshot exists, or when
 * the read throws. Graceful degradation mirrors `fetchMostRecentPendingActions`
 * — a read failure never fails the turn.
 */
async function fetchMostRecentCoachingState(
  scenarioId: string,
  requestId: string,
  store: SessionStore | undefined,
): Promise<CoachingStateSnapshot | null> {
  if (!store?.readMostRecentCoachingState) return null;
  try {
    return await store.readMostRecentCoachingState(scenarioId);
  } catch (e) {
    log.warn(
      {
        request_id: requestId,
        scenario_id: scenarioId,
        err: (e as Error)?.message ?? String(e),
      },
      'V5 build-turn-context — readMostRecentCoachingState failed; degrading to null prior_coaching_state',
    );
    return null;
  }
}

/**
 * V5 P0 proposal-memory continuation — public load helper.
 *
 * Standalone variant of `fetchMostRecentPendingActions` for callers that
 * need just the pending actions without paying the cost of a full
 * `buildTurnContext` load (which also reads prior_facts +
 * scenario_state + persistedGraph). Used by the pre-LLM intercept in
 * `dispatchEditGraph` so a fast Stage 1 / Stage 2 emit can read pending
 * state before deciding whether to skip the LLM call.
 *
 * Resolves the session store inline via `tryGetSessionStore` so the
 * state-write-invariant pre-push guard stays satisfied (SessionStore
 * imports are restricted to session/, commit.ts, and this module).
 *
 * Graceful degradation: store-factory failure or read failure both
 * resolve to an empty array — never throws. Telemetry on
 * read-degradation is emitted at the store layer.
 */
export async function loadMostRecentPendingActions(
  scenarioId: string,
  requestId: string,
): Promise<readonly PendingAction[]> {
  const store = tryGetSessionStore(requestId, scenarioId);
  return fetchMostRecentPendingActions(scenarioId, requestId, store);
}

/**
 * ROADMAP 1.33 — public load helper for the prior-conversation-turns read.
 *
 * Standalone variant of `fetchPriorTurns` for callers that need just the
 * recent turns (for the same 5-turn conversation-slice projection
 * `context-pack-assembler.ts`'s `projectConversation` already builds for
 * the coaching/draft LLM path) without paying the cost of a full
 * `buildTurnContext` load. Used by `dispatchEditGraph` — the V4 edit-graph
 * dispatch runs entirely outside `buildTurnContext`/`turn-executor.ts`'s
 * ORIENT step (see route-v2.ts), so it has no other route to this read.
 *
 * Resolves the session store inline via `tryGetSessionStore` so the
 * state-write-invariant pre-push guard stays satisfied (SessionStore
 * imports are restricted to session/, commit.ts, and this module).
 *
 * Graceful degradation: store-factory failure or read failure both
 * resolve to an empty array — never throws. Telemetry on
 * read-degradation is emitted at the store layer (via `fetchPriorTurns`).
 */
export async function loadRecentConversationTurns(
  scenarioId: string,
  requestId: string,
): Promise<readonly SessionTurnWithContent[]> {
  const store = tryGetSessionStore(requestId, scenarioId);
  return fetchPriorTurns(scenarioId, requestId, store);
}

/**
 * Context Architecture v2 S2 (ROADMAP 1.73, 02 §Seam 1) — standalone
 * `scenarios.brief_text` read for callers outside `buildTurnContext`'s
 * ORIENT step. Used by `dispatchEditGraph` (flag
 * CEE_CONTEXT_BRIEF_ALL_SITES) to thread the persisted decision brief into
 * the edit/repair LLM context — the V4 edit dispatch runs entirely outside
 * `buildTurnContext` (see route-v2.ts), so, like
 * {@link loadRecentConversationTurns}, it has no other route to this read.
 *
 * Lives here so the state-write-invariant pre-push guard stays satisfied
 * (SessionStore imports are restricted to session/, commit.ts, and this
 * module). Delegates to `SessionStore.loadGraphAndBriefText` (the one-round-
 * trip scenarios read) and discards the graph.
 *
 * Graceful degradation: store-factory failure or read failure resolve to
 * `null` (no brief) — an edit turn must never fail over a brief read.
 */
export async function loadScenarioBriefText(
  scenarioId: string,
  requestId: string,
): Promise<string | null> {
  const store = tryGetSessionStore(requestId, scenarioId);
  if (!store) return null;
  try {
    const { briefText } = await store.loadGraphAndBriefText(scenarioId);
    return briefText;
  } catch (err) {
    log.warn(
      {
        request_id: requestId,
        scenario_id: scenarioId,
        err: err instanceof Error ? err.message : String(err),
      },
      'loadScenarioBriefText degraded to null (edit-lane brief read failure)',
    );
    return null;
  }
}

/**
 * V5 Signature Loop — STRICT variant of {@link loadMostRecentPendingActions}.
 *
 * Unlike the swallowing variant (which returns `[]` on any failure and so
 * conflates "no pending proposal" with "read failed"), this one PROPAGATES a
 * read failure: a store-factory failure or a `SessionReadError` from the DB
 * surfaces as a throw. The caller (the route-level proposal-confirm suppressor)
 * needs that distinction to emit observable telemetry — a transient read
 * failure must not silently look like "no proposal" with no trace (amendment
 * #4). Parse-failures / empty results still resolve to `[]` (genuinely
 * no-proposal), with read-degradation telemetry emitted at the store layer.
 *
 * Mirrors `loadPersistedGraphStrict`'s strict/swallowing split and keeps the
 * SessionStore import surface bounded to this module.
 */
export async function loadMostRecentPendingActionsStrict(
  scenarioId: string,
  requestId: string,
): Promise<readonly PendingAction[]> {
  const store = tryGetSessionStore(requestId, scenarioId);
  if (!store) {
    throw new SessionReadError(
      `loadMostRecentPendingActionsStrict(${scenarioId}): session store unavailable`,
      {},
    );
  }
  return store.readMostRecentPendingActions(scenarioId);
}

/**
 * V5 Signature Loop — bounded "does this scenario already have committed turns?"
 * read for the route-level refresh-continuation guard. Degrades to `false` on
 * a missing store, an unimplemented method (legacy mocks), or a read failure —
 * an uncertain read must NOT suppress the draft / frame-no-brief shortcut (a
 * false negative just keeps today's behaviour; a false positive would strand a
 * genuine new decision). Resolves the store inline via `tryGetSessionStore` to
 * keep the SessionStore import surface bounded to this module.
 */
export async function loadHasPriorTurns(
  scenarioId: string,
  requestId: string,
): Promise<boolean> {
  const store = tryGetSessionStore(requestId, scenarioId);
  if (!store?.hasPriorTurns) return false;
  try {
    return await store.hasPriorTurns(scenarioId);
  } catch (e) {
    log.warn(
      {
        request_id: requestId,
        scenario_id: scenarioId,
        err: (e as Error)?.message ?? String(e),
      },
      'V5 build-turn-context — hasPriorTurns failed; degrading to false (do not suppress draft/frame)',
    );
    return false;
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
): Promise<readonly SessionTurnWithContent[]> {
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
  //
  // DL-7 PR B (2026-05-10): widened from
  // `priorTurns.filter((t) => t.turn_class === 'handler')` to all
  // prior turns. Historically only `turn_class === 'handler'` turns
  // emitted facts; PR B's edit_graph dispatch deliberately preserves
  // `turn_class: 'direct_answer'` while emitting an
  // `EditGraphHandlerFact`, so the historical filter would silently
  // exclude the new fact's parent turn and PR B's emission would be
  // downstream-invisible. The actual gate is the FK in
  // `readFactsFor` — turns without associated `v5_handler_facts` rows
  // contribute nothing to the result, so passing all prior-turn row
  // IDs is harmless. This is also more future-proof: any subsequent
  // turn class that emits facts works without further loader changes.
  // The variable name was historically `handlerRowIds`; renamed to
  // `priorTurnRowIds` post-widening so the wording matches what the
  // value now is — every prior turn's row id, not just the
  // `handler`-class ones.
  const priorTurnRowIds = priorTurns.map((t) => t.id);
  // Lean info row: counts and presence flags only. Verbose arrays moved to
  // debug — set LOG_LEVEL=debug to recover prior_turn_row_ids / per-turn
  // class+handler arrays when investigating fact-chain issues.
  log.info(
    {
      event: 'v5_fact_chain_trace',
      request_id: requestId,
      scenario_id: scenarioId,
      session_store_present: store !== undefined,
      prior_turn_count: priorTurns.length,
      prior_turn_row_id_count: priorTurnRowIds.length,
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
      prior_turn_row_ids: priorTurnRowIds,
    },
    'V5 buildTurnContext: fact chain trace (verbose)',
  );
  const empty = { facts: [] as readonly HandlerFact[], factsWithTurn: [] as readonly HandlerFactWithTurn[] };
  if (!store) return empty;
  if (priorTurns.length === 0) return empty;
  if (priorTurnRowIds.length === 0) return empty;
  try {
    // Prefer the with-turn variant when the store implements it
    // (production SupabaseSessionStore always does). Test mocks
    // that pre-date this method fall back to readFactsFor with an
    // empty factsWithTurn — the proposed-change synthesis path is
    // disabled in that case (it never triggers without facts), but
    // every other consumer keeps working.
    const factsWithTurn = store.readFactsWithTurnFor
      ? await store.readFactsWithTurnFor(priorTurnRowIds)
      : ([] as readonly HandlerFactWithTurn[]);
    const facts =
      factsWithTurn.length > 0
        ? factsWithTurn.map((w) => w.fact)
        : await store.readFactsFor(priorTurnRowIds);
    log.info(
      {
        event: 'v5_turn_context_facts',
        request_id: requestId,
        scenario_id: scenarioId,
        prior_turn_count: priorTurns.length,
        prior_turn_row_id_count: priorTurnRowIds.length,
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

/**
 * Strict variant of {@link loadPersistedScenarioState} that does NOT swallow
 * errors — the combined-read sibling of {@link loadPersistedGraphStrict}.
 *
 * Same single-round-trip `scenarios.graph` + `scenarios.brief_text` read via
 * `SessionStore.loadGraphAndBriefText`, but propagates `SessionReadError`
 * instead of collapsing to nulls, so callers can distinguish "store
 * reachable, nothing stored" (null fields) from "store unreachable / RPC
 * threw" (throws). Lane 28 — brief pipeline: added so
 * `loadScenarioSnapshotForRunAnalysis` can carry the persisted brief on the
 * snapshot without a second round trip AND without weakening its existing
 * strict-read error contract (`scenario_read_failed` vs `analysis_not_ready`
 * — see the call-site comment below).
 *
 * Lives in this module so the `SessionStore` import surface stays bounded to
 * the three declared integration points: session/, commit.ts,
 * build-turn-context.ts (enforced by the pre-push `state-write-invariant`
 * check).
 */
export async function loadPersistedScenarioStateStrict(
  scenarioId: string,
  sessionStore?: SessionStore,
): Promise<{ readonly graph: unknown | null; readonly briefText: string | null }> {
  const store = sessionStore ?? getSessionStore();
  return await store.loadGraphAndBriefText(scenarioId);
}

/**
 * #343 adopt-on-empty — is `g` a POPULATED graph candidate worth assessing?
 *
 * True only for a plain object carrying a non-empty `nodes` array. Everything
 * else — a non-object (`"x"`, a number), `{}`, or `{nodes:[],edges:[]}` — is
 * treated as "no adoptable model": the request carried nothing usable, so the
 * honest response is the draft-first NO_GRAPH nudge, NOT a structural
 * "options not configured" verdict (review #5) and NOT a throw that would map
 * to the retryable `scenario_read_failed` (review #7). A present-but-MALFORMED
 * graph WITH nodes is still a candidate → the readiness core gives it the
 * SPECIFIC verdict (the user sent SOMETHING, just broken).
 */
function isPopulatedGraphCandidate(g: unknown): boolean {
  return (
    g !== null &&
    typeof g === 'object' &&
    !Array.isArray(g) &&
    Array.isArray((g as { nodes?: unknown }).nodes) &&
    (g as { nodes: unknown[] }).nodes.length > 0
  );
}

/**
 * #343 adopt-on-empty — thrown by {@link reverifyAdoptedGraphFirstWrite} when
 * the commit-time strict re-verify read is DEGRADED (store/RPC threw). Both
 * dispatch paths let it propagate into their commit try/catch, which maps it
 * to the retryable commit-failed class (chip → `commit_failed`; TurnExecutor
 * STEP 7 → `STATE_COMMIT_FAILED`) — a graph-bearing commit is never taken on
 * an unverifiable base. Extends Error so the generic commit catches handle it
 * without a new instanceof branch.
 */
export class AdoptedGraphReverifyError extends Error {
  constructor(scenarioId: string, cause: unknown) {
    super(
      `V5 #343 — refusing to persist adopted ingress graph for scenario ${scenarioId}: persisted base unavailable at commit-time re-verify (${cause instanceof Error ? cause.message : String(cause)})`,
    );
    this.name = 'AdoptedGraphReverifyError';
  }
}

/**
 * #343 adopt-on-empty — the SINGLE commit-time re-verify shared by both
 * run_analysis dispatch paths (chip-click dispatch + TurnExecutor STEP 7).
 *
 * Adopting an ingress graph is a FIRST write onto a genuinely-empty
 * `scenarios.graph`. The handler's null read happened BEFORE the (seconds-long)
 * PLoT run, so the pre-run null is stale by construction. Re-read the base
 * STRICTLY and decide:
 *   - still null → `{ write: true, graph }` — the caller persists the adopted graph.
 *   - non-null   → `{ write: false }` — WITHHELD: a concurrent canonical write
 *     landed; the analysis facts stay honest (they hash the adopted graph, and
 *     later freshness compares against whatever is actually persisted).
 *   - degraded   → THROWS {@link AdoptedGraphReverifyError} — fail closed.
 *
 * ⚠ BEST-EFFORT, NOT atomic: the re-verify READ and the subsequent WRITE are two
 * separate operations. The strong "a concurrent canonical write is never
 * overwritten" guarantee holds only under `graphCasMode==='enforce'` (the RPC's
 * compare-and-set rejects a stale first-write expected-base). In observe/off
 * (staging today) a small TOCTOU window remains between this read and the
 * commit — this shrinks that window to milliseconds; it does not close it.
 *
 * Extracted to ONE function because the two call sites previously carried
 * near-identical re-verify + withhold + fail-closed blocks that had already
 * DIVERGED (the hand-maintained-mirror defect class) — two copies WILL drift.
 */
export async function reverifyAdoptedGraphFirstWrite(args: {
  readonly scenarioId: string;
  readonly requestId: string;
  readonly adoptedGraph: unknown;
  readonly dispatchPath: string;
  readonly sessionStore?: SessionStore;
}): Promise<{ readonly write: true; readonly graph: unknown } | { readonly write: false }> {
  let baseAtCommit: unknown;
  try {
    baseAtCommit = await loadPersistedGraphStrict(args.scenarioId, args.sessionStore);
  } catch (err) {
    throw new AdoptedGraphReverifyError(args.scenarioId, err);
  }
  if (baseAtCommit == null) {
    return { write: true, graph: args.adoptedGraph };
  }
  log.warn(
    {
      event: 'v5.run_analysis.adopted_graph_write_withheld',
      request_id: args.requestId,
      scenario_id: args.scenarioId,
      dispatch_path: args.dispatchPath,
    },
    'V5 run_analysis — adopted ingress graph write WITHHELD: a persisted graph appeared between the pre-run strict read and the commit (concurrent canonical write wins)',
  );
  return { write: false };
}

export async function loadScenarioSnapshotForRunAnalysis(
  scenarioId: string,
  requestId: string,
  sessionStore?: SessionStore,
  /**
   * #343 CEE half — adopt-on-empty candidate: the request-supplied
   * `graph_state` (boundary `extensions.graphState`), threaded from the
   * dispatch site (chip-click pre-load / `invocation.graphForTurn` on the
   * routed path). Consulted ONLY when the strict persisted read returns a
   * GENUINELY-null graph and `cee.runAnalysisAdoptIngressGraph` is on — a
   * present persisted graph always wins and the candidate is ignored.
   */
  ingressGraph?: unknown,
): Promise<RunAnalysisScenarioSnapshot> {
  // STRICT read: a store/RPC failure must PROPAGATE (→ the handler's retryable
  // `scenario_read_failed`), NOT be swallowed to null. The non-strict
  // `loadPersistedGraph` collapses store errors into null (loadPersistedScenarioState
  // catches and degrades), which would let the NULL-graph recovery below misclassify a
  // transient outage as `analysis_not_ready` ("draft a model first" 200) — masking the
  // infra failure and dropping retry guidance. `loadPersistedScenarioStateStrict`
  // returns null fields ONLY when the store is reachable and nothing is stored (the
  // genuine no-model case); it throws SessionReadError on a DB/RPC failure.
  //
  // Lane 28 — brief pipeline: the combined strict read also carries the persisted
  // `scenarios.brief_text` in the SAME round trip (the store's loadGraph already
  // delegated to loadGraphAndBriefText and discarded the brief), so the snapshot
  // can surface it for the flag-gated run_analysis → PLoT brief leg with no extra
  // DB traffic and identical error semantics.
  const { graph: persistedGraph, briefText } = await loadPersistedScenarioStateStrict(
    scenarioId,
    sessionStore,
  );
  // `== null` (not a truthy check): scope the recovery to a GENUINELY absent graph
  // (null/undefined). A present-but-corrupt falsy value (e.g. `0` / `""`) is malformed,
  // not missing — it falls through to GraphV3.safeParse below and fails into
  // scenario_read_failed like any other malformed graph, so we never tell a user who
  // has a (corrupt) graph to "draft a model first".
  // #343 CEE half — adopt-on-empty marker. Set ONLY on the genuinely-null-
  // persisted branch below when a request-supplied graph passes the full
  // readiness core; the commit seams (chip-click dispatch / TurnExecutor
  // STEP 7) read it off the snapshot to persist the adopted graph atomically
  // with the turn (CAS first_write, commit-time strict re-verify).
  let adoptedIngressGraph = false;
  let graphForSnapshot: unknown = persistedGraph;
  if (persistedGraph == null) {
    // GENUINELY no persisted graph (store reachable, scenarios.graph absent) — e.g. a
    // guest scenario that never drafted/saved a model. A store/RPC failure does NOT
    // reach here (it threw above → propagates to scenario_read_failed).
    //
    // #343 adopt-on-empty (CEE_RUN_ANALYSIS_ADOPT_INGRESS_GRAPH, default OFF /
    // dark): when the request carried a POPULATED graph_state (the client-built
    // model — starter/template inserts and hand-built canvas models exist ONLY
    // client-side; the V5 wire historically carried no graph, so this seam
    // starved and every first-CTA analyse dead-ended on NO_GRAPH), assess the
    // INGRESS graph with the SAME neutral readiness core EP2 uses:
    //   - ready/repaired  → adopt the canonical ingress graph as this run's
    //     graph. Persistence happens at the COMMIT seam (never here — a read
    //     path must not write), gated by a BEST-EFFORT strict re-verify
    //     (`reverifyAdoptedGraphFirstWrite`) that withholds the write if a
    //     concurrent canonical write appeared. Mirrors the edit-graph-dispatch
    //     ingress-base fallback doctrine ("a client that sent graph_state for a
    //     never-persisted scenario — there is nothing to lose").
    //   - unrecoverable   → the SPECIFIC verdict (missing cap / structure /
    //     options not configured), NEVER the false "Draft or save a model
    //     first" copy — the user HAS a model; telling them to draft one
    //     contradicts the canvas.
    // A present-but-EMPTY / non-object ingress (zero nodes, `{}`, `"x"`) is NOT
    // a candidate (`isPopulatedGraphCandidate`) → it falls through to the
    // null-branch draft-first nudge (reviews #5 + #7), never a structural
    // verdict and never a throw.
    if (config.cee.runAnalysisAdoptIngressGraph && isPopulatedGraphCandidate(ingressGraph)) {
      const verdict = assessAnalysisReadiness(ingressGraph);
      if (verdict.status === 'unrecoverable') {
        throw new AnalysisNotReadyError(verdict);
      }
      graphForSnapshot = verdict.canonicalGraph ?? ingressGraph;
      adoptedIngressGraph = true;
      // Counts via the two-caller standard summariser (turn-executor +
      // route-v2 use the same one) — no hand-rolled Array.isArray dance.
      const adoptedCounts = summariseGraphCounts(
        graphForSnapshot as Parameters<typeof summariseGraphCounts>[0],
      );
      log.info(
        {
          event: 'v5.run_analysis.ingress_graph_adopted',
          request_id: requestId,
          scenario_id: scenarioId,
          readiness_status: verdict.status,
          node_count: adoptedCounts?.nodes ?? null,
          edge_count: adoptedCounts?.edges ?? null,
        },
        'V5 run_analysis — no persisted graph; adopted the request-supplied ingress graph (#343 adopt-on-empty)',
      );
    } else if (config.cee.runAnalysisNullGraphRecoverable) {
      // No adoptable ingress graph (none sent, or the adopt kill-switch is
      // off). Convert the legacy raw-500 into a typed RECOVERABLE failure:
      // AnalysisNotReadyError → the run_analysis handler maps it to
      // `analysis_not_ready` (a 200 with an honest "draft a model first"
      // next-step + recovery chip). This throw is BEFORE the PLoT payload
      // build and before any run_analysis handler fact. INDEPENDENT of EP2
      // (`analysisReadyGuardEnabled`) — the deployed path runs EP2 OFF — and
      // gated only by its own default-ON kill-switch
      // (`runAnalysisNullGraphRecoverable`) so a code-free rollback to the
      // raw 500 stays available.
      throw new AnalysisNotReadyError(assessAnalysisReadiness(null));
    } else {
      throw new Error(`No persisted graph found for scenario ${scenarioId}`);
    }
  }

  // EP2 (V5 Edit Safety Core) — read-boundary analysis-ready guard. Behind
  // `analysisReadyGuardEnabled` (default OFF), canonicalise the persisted graph
  // BEFORE GraphV3.safeParse strips `node.data` (which would otherwise drop an
  // autosave-written `node.data.interventions` option → silent options_not_configured),
  // and block an un-analysable graph as a typed recoverable failure (NOT a 500).
  // `graphForSnapshot` (= the canonical graph when the guard is on) is also used as
  // `rawPersistedGraph` so `graph_hash_at_run` is computed from the SAME canonical
  // projection the freshness side hashes (brief §6 consistency). Flag OFF ⇒
  // `graphForSnapshot === persistedGraph` ⇒ byte-identical to today.
  // An ADOPTED ingress graph already went through the same core above, so the
  // guard is skipped for it (running it twice would be a no-op by idempotence,
  // but skipping keeps the adopted path's semantics independent of EP2's flag).
  if (!adoptedIngressGraph && config.cee.analysisReadyGuardEnabled) {
    const verdict = assessAnalysisReadiness(persistedGraph);
    if (verdict.status === 'unrecoverable') {
      throw new AnalysisNotReadyError(verdict);
    }
    graphForSnapshot = verdict.canonicalGraph ?? persistedGraph;
  }

  const parsedGraph = GraphV3.safeParse(graphForSnapshot);
  if (!parsedGraph.success) {
    throw new Error(`Persisted graph failed GraphV3 validation for scenario ${scenarioId}`);
  }

  const readiness = computeStructuralReadiness(parsedGraph.data);
  if (!readiness?.goal_node_id) {
    throw new Error(`Could not derive analysis_ready.goal_node_id for scenario ${scenarioId}`);
  }

  // CEE → PLoT value-scale egress net (Tier 0, Phase 1) — flag-gated, default OFF.
  //
  // PLoT consumes intervention input `value` as RAW user-scale and normalises
  // internally using the target factor node's `observed_state.cap` (re-verified
  // clean on PLoT staging `78aea76`, 2026-06-18). CEE historically projected the
  // normalised `[0,1]` convention, which double-normalises capped interventions
  // (e.g. sends 0.25 where PLoT expects 25000). When `cee.plotEgressScaleNetEnabled`
  // is ON we canonicalise the OUTBOUND interventions here — the single egress
  // projection point — via the evidence-gated rule in `plot-intervention-scale.ts`
  // (no silent corruption, double-conversion-safe). When OFF this is a
  // byte-identical no-op (the legacy numeric projection). Read-only either way:
  // the persisted graph is never mutated; only the outbound PLoT projection changes.
  const options = config.cee.plotEgressScaleNetEnabled
    ? projectOptionsToRawScale(parsedGraph.data.nodes, readiness.options, requestId, scenarioId)
    : readiness.options.map((option) => ({
        id: option.option_id,
        option_id: option.option_id,
        label: option.label,
        interventions: normaliseNumericInterventions(option.interventions),
      }));

  return {
    graph: parsedGraph.data,
    options,
    goal_node_id: readiness.goal_node_id,
    // EP2: canonical graph when the guard is on (graphForSnapshot === persistedGraph
    // when off) — keeps graph_hash_at_run consistent with the freshness-side hash.
    // #343: when adopted, this IS the canonical ingress graph — the commit seams
    // persist exactly this value, so graph_hash_at_run, the persisted graph, and
    // every later freshness hash agree by construction.
    rawPersistedGraph: graphForSnapshot,
    // #343 adopt-on-empty marker (omitted on every non-adopted load so existing
    // snapshots are byte-identical). Commit seams key the atomic graph write +
    // strict re-verify off this.
    ...(adoptedIngressGraph ? { adoptedIngressGraph: true as const } : {}),
    // V5 D1 P0-2: forward graph.goal_constraints so PLoT receives
    // constraints added via `add_constraint`. Omitted when absent so
    // run-analysis can use the existing optional-field idiom.
    ...(parsedGraph.data.goal_constraints !== undefined
      ? { goal_constraints: parsedGraph.data.goal_constraints }
      : {}),
    // Lane 28 — brief pipeline: the persisted decision brief, loaded above in
    // the same round trip as the graph. Omitted when null (no brief persisted
    // / whitespace-coerced) so PLoT's `no_brief` skip stays honest — the
    // handler only forwards it behind `config.cee.sendBriefToPlot`
    // (default OFF, doctrine ask D5 Paul-gated).
    ...(briefText !== null ? { briefText } : {}),
  };
}

/**
 * Egress value-scale projection (flag-ON path). Re-reads the ORIGINAL
 * intervention objects from the persisted option nodes (object-preserving merge
 * — same precedence + membership as readiness) plus the target factors'
 * `observed_state` (cap + normalised-convention evidence), and canonicalises
 * each outbound intervention to raw user-scale via the evidence-gated rule. Emits
 * a SINGLE redacted diagnostic per load (rule counts + factor ids only — never
 * magnitudes or caps) when anything was denormalised / inconsistent / ambiguous.
 * Pure with respect to the persisted graph: it reads nodes but never mutates them.
 */
function projectOptionsToRawScale(
  nodes: GraphV3T['nodes'],
  options: ReadonlyArray<{ option_id: string; label: string; interventions: Record<string, unknown> }>,
  requestId: string,
  scenarioId: string,
): Array<{ id: string; option_id: string; label: string; interventions: Record<string, number> }> {
  const factorScaleById = buildFactorScaleMap(nodes);
  const optionNodesById = new Map<string, Record<string, unknown>>();
  for (const node of nodes) {
    if (node.kind === 'option' && typeof node.id === 'string') {
      optionNodesById.set(node.id, node as unknown as Record<string, unknown>);
    }
  }

  const egressConversions: InterventionConversion[] = [];
  const projected = options.map((option) => {
    const optionNode = optionNodesById.get(option.option_id);
    const rawObjects = optionNode ? mergeInterventionSourceObjects(optionNode) : {};
    const { interventions, conversions } = projectInterventionsToRawScale(rawObjects, factorScaleById);
    for (const conv of conversions) egressConversions.push(conv);
    return {
      id: option.option_id,
      option_id: option.option_id,
      label: option.label,
      interventions,
    };
  });

  const conversionSummary = summariseConversions(egressConversions);
  if (summaryIsNoteworthy(conversionSummary)) {
    log.info(
      {
        event: 'run_analysis.intervention_scale_egress',
        request_id: requestId,
        scenario_id: scenarioId,
        by_rule: conversionSummary.by_rule,
        cap_denormalised_factors: conversionSummary.cap_denormalised_factors,
        inconsistent_scale_factors: conversionSummary.inconsistent_scale_factors,
        ambiguous_no_evidence_factors: conversionSummary.ambiguous_no_evidence_factors,
      },
      'run_analysis egress intervention value-scale projection (redacted; no magnitudes)',
    );
  }

  return projected;
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
