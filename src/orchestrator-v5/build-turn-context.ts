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
import { assessAnalysisReadiness, AnalysisNotReadyError, type ReadinessResult } from './tools/handlers/analysis-ready-core.js';
import { floorGraphSigmaForCompute } from '../validators/numeric-bounds.js';
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
import { computeAnalysisAffectingGraphHash } from './context/graph-hash.js';
import { extractGraphOptionIds } from './context/option-identity.js';
import { GraphStateIngressSchema } from './boundary/request-extensions.js';

import { getTurnExecutorBudgets } from './budgets.js';
import { SessionReadError, GraphStaleWriteError, type SessionStore } from './session/store.js';
// F4 — re-exported so turn-executor can detect a CAS conflict at its commit
// boundary WITHOUT importing session/store directly (the state-write-invariant
// guard bounds that import surface to session/, commit.ts, build-turn-context).
export { GraphStaleWriteError };
import { getSessionStore } from './session/index.js';
import type { PendingAction } from './session/pending-action.js';

/**
 * F2 (Codex deep-review) — discriminated canonical graph-read state.
 *
 * `persistedGraph: null` used to conflate two very different facts: "the
 * canonical read SUCCEEDED and no graph is stored" (adopt-on-first-touch is
 * SAFE) versus "the canonical read FAILED / degraded" (adopting the client's
 * `graph_state` would CLOBBER a real server model we simply could not see).
 * The adopt chokepoint derived `hasServerModel` from the nullable value, so a
 * transient read failure masqueraded as "no server model" and let Row A / Row B
 * overwrite authoritative state.
 *
 * This explicit state removes the conflation:
 *   - `ok_present` — read succeeded, a graph exists (carries it).
 *   - `ok_absent`  — read succeeded, no graph stored (first-touch adopt SAFE).
 *   - `degraded`   — the read threw; the true state is UNKNOWN (fail closed).
 */
export type CanonicalGraphReadState =
  | { readonly status: 'ok_present'; readonly graph: unknown }
  | { readonly status: 'ok_absent' }
  | { readonly status: 'degraded'; readonly errorCode: string };

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
   * How many conversation turns EXIST for this scenario — the store's pre-cap
   * count, not `prior_turns.length`.
   *
   * `prior_turns` is a WINDOW (`SESSION_READ_WINDOW_TURNS`, default 20). Its
   * length was being reported to the LLM as the conversation's total length,
   * so on a 78-turn scenario the coach said "Total turn count on record for
   * this conversation is 20" (live probe, build `f00b8ef`, 2026-07-25).
   *
   * `null` means UNKNOWN — the count read failed or the store predates
   * `countTurns` (test mocks). Consumers must then suppress any total rather
   * than substituting `prior_turns.length`; substituting it is the defect.
   *
   * Optional on the type so the many hand-constructed test contexts keep
   * compiling (mirrors `most_recent_pending_actions`); production
   * `buildTurnContext` always sets it.
   */
  readonly prior_turns_total?: number | null;
  /**
   * The SCENARIO's newest non-noop `run_analysis` fact — read past the window,
   * `WHERE scenario_id = … ORDER BY created_at DESC LIMIT 1`.
   *
   * `prior_facts` below is a WINDOW: its facts are fetched by an `IN` over the
   * 20 turn rows `readRecent` returned. The T1 claim-safety permission was
   * read off that array, so a `run_analysis` fact whose parent turn had aged
   * out was invisible and the "no analysis ⇒ nothing to withhold" branch fired
   * on a scenario that DOES have a withheld analysis. This field is what lets
   * the permission describe the scenario. Consumed ONLY through
   * `readMayNameLeadingOptionVerdict` — never read directly, or it becomes a
   * second derivation.
   *
   * `null` = the scenario has no such fact, OR the read did not run; those two
   * are told apart by `newest_analysis_fact_read_ok`, never by this field.
   *
   * Optional on the type so hand-constructed test contexts keep compiling
   * (mirrors `prior_turns_total`); production `buildTurnContext` always sets it.
   */
  readonly newest_analysis_fact?: HandlerFact | null;
  /**
   * Did the scenario-scoped analysis-fact read execute and succeed?
   *
   * `false` covers a thrown read AND a store that does not implement the
   * method. It is the ONLY input that arms the fail-closed truncation guard,
   * and it can only make the permission more restrictive — never less.
   */
  readonly newest_analysis_fact_read_ok?: boolean;
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
   * F2 (Codex deep-review) — the discriminated result of the canonical
   * `scenarios.graph` read that produced {@link persistedGraph}. Consumed by
   * the graph-commit chokepoint (turn-executor `graphForCommit`) so that a
   * DEGRADED read is never treated as "no server model" (which would let
   * adopt-on-first-touch clobber authoritative state). `persistedGraph` stays
   * as-is (null on degraded) for the read-only projections (DecisionContext,
   * coaching, freshness) that legitimately degrade to "no graph".
   *
   * Optional on the type (mirrors `most_recent_pending_actions`) so the many
   * hand-constructed test contexts keep compiling; production `buildTurnContext`
   * always sets it, and the chokepoint derives a safe fallback from
   * `persistedGraph` when it is absent.
   */
  readonly persistedGraphRead?: CanonicalGraphReadState;
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
  /**
   * Lane 28 — brief pipeline: the persisted `scenarios.brief_text`,
   * loaded on the SAME round trip as the graph (via
   * `loadPersistedScenarioStateStrict` → `store.loadGraphAndBriefText`).
   * Absent (not null) when no brief is persisted — the construction
   * site spreads the key conditionally. Mirrors the optional
   * `briefText` on run-analysis.ts's `RunAnalysisScenarioSnapshot`
   * (the handler-side declaration of this same snapshot shape).
   */
  readonly briefText?: string;
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
  // The window and its true size are read CONCURRENTLY — the count must not
  // add a serial round-trip to the turn's critical path. `fetchPriorTurns`
  // returns a window capped at SESSION_READ_WINDOW_TURNS; `fetchPriorTurnsTotal`
  // returns how many turns actually exist (or null when unknown).
  // The third read joins the same concurrent batch for the same reason: the T1
  // claim-safety permission must describe the SCENARIO, and `priorTurns` is a
  // 20-turn window. Concurrent ⇒ it costs the batch's max latency, not a
  // serial addition.
  const [priorTurns, priorTurnsTotal, newestAnalysisFactRead] = await Promise.all([
    fetchPriorTurns(payload.scenario_id, requestId, store),
    fetchPriorTurnsTotal(payload.scenario_id, requestId, store),
    fetchNewestAnalysisFact(payload.scenario_id, requestId, store),
  ]);
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
    prior_turns_total: priorTurnsTotal,
    newest_analysis_fact: newestAnalysisFactRead.fact,
    newest_analysis_fact_read_ok: newestAnalysisFactRead.readOk,
    prior_facts: priorFacts,
    prior_facts_with_turn: priorFactsWithTurn,
    scenarioBriefText: scenarioState.briefText,
    persistedGraph: scenarioState.graph,
    persistedGraphRead: scenarioState.read,
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
 * Context Architecture v2 S2 (ROADMAP 1.199) — standalone
 * `scenarios.brief_text` read for callers outside `buildTurnContext`'s
 * ORIENT step. Used by `dispatchEditGraph` (UNCONDITIONALLY — S2 shipped ON,
 * no-dark-launches) to thread the persisted decision brief into
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
): Promise<{
  readonly graph: unknown | null;
  readonly briefText: string | null;
  readonly read: CanonicalGraphReadState;
}> {
  // No store: nothing is (or can be) persisted for this scenario, and the
  // commit path cannot run without a store, so this is a genuine ABSENT read
  // for adopt purposes — never a degraded read that could mask a server model.
  if (!store) return { graph: null, briefText: null, read: { status: 'ok_absent' } };
  try {
    const result = await store.loadGraphAndBriefText(scenarioId);
    // ok_present only when a graph is actually stored; a null graph (row
    // absent or graph column null) is a SUCCESSFUL read of an absent graph.
    const read: CanonicalGraphReadState =
      result.graph != null
        ? { status: 'ok_present', graph: result.graph }
        : { status: 'ok_absent' };
    return { graph: result.graph, briefText: result.briefText, read };
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
    // F2 — a DEGRADED read must NOT collapse to "no graph" at the adopt
    // chokepoint. `graph`/`briefText` stay null for the read-only projections
    // (they legitimately degrade), but `read` carries the true `degraded`
    // state so the write path fails closed instead of clobbering.
    return {
      graph: null,
      briefText: null,
      read: { status: 'degraded', errorCode: errorCode ?? 'unknown' },
    };
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

/**
 * How many conversation turns EXIST for this scenario (pre-cap), or `null`
 * when that cannot be established.
 *
 * `null` is the honest "I don't know" — the ContextPack projection suppresses
 * the total rather than substituting the window length. Substituting the
 * window length is precisely the falsehood this read exists to remove, so the
 * degraded path must NOT be assume-good; it is telemetered like every other
 * session-read degradation and the pack falls back to a numberless disclosure.
 */
async function fetchPriorTurnsTotal(
  scenarioId: string,
  requestId: string,
  store: SessionStore | undefined,
): Promise<number | null> {
  // Absent method = a test mock predating countTurns. Production
  // SupabaseSessionStore always implements it, so this is not a live path;
  // it degrades to "unknown", never to a fabricated total.
  if (!store?.countTurns) return null;
  try {
    return await store.countTurns(scenarioId);
  } catch (error) {
    const errorCode = error instanceof SessionReadError ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    log.warn(
      { request_id: requestId, scenario_id: scenarioId, error_code: errorCode, err: message },
      'V5 buildTurnContext: session.countTurns failed — conversation total will be reported as unknown',
    );
    emit(TelemetryEvents.SessionReadDegraded, {
      request_id: requestId,
      scenario_id: scenarioId,
      error_code: errorCode ?? 'unknown',
      severity: 'warning',
    });
    return null;
  }
}

/**
 * The SCENARIO's newest non-noop `run_analysis` fact, plus whether the read
 * actually happened.
 *
 * WHY IT IS A SEPARATE READ FROM `fetchPriorFacts`. `fetchPriorFacts` loads
 * facts by an `IN` over the WINDOWED turn row ids — so past
 * `SESSION_READ_WINDOW_TURNS` (default 20) turns, the scenario's analysis fact
 * is simply not there. The T1 claim-safety permission was read off that array
 * while the channels it gates read the whole scenario (rolling summary
 * `LIMIT 1000`; decision records scenario-wide), so on a long conversation a
 * WITHHELD scenario shipped an ungated summary. This read makes the
 * permission's scope match the content's scope. Same shape of fix, and the
 * same justification, as `fetchPriorTurnsTotal`.
 *
 * ⚠ `readOk` IS NOT COSMETIC — it is what separates "the scenario has no
 * analysis" from "I could not look". The first is an honest `true`; the second
 * must not be allowed to masquerade as one, and it is the input that arms the
 * fail-closed guard in `readMayNameLeadingOptionVerdict`. A store without the
 * method (test mocks) is `readOk: false` for the same reason: absence of
 * evidence is not evidence of absence.
 *
 * Never throws: a degraded fact read must not fail the turn. It degrades to
 * `{fact: null, readOk: false}`, which is strictly MORE restrictive than the
 * pre-fix behaviour, never less.
 */
async function fetchNewestAnalysisFact(
  scenarioId: string,
  requestId: string,
  store: SessionStore | undefined,
): Promise<{ readonly fact: HandlerFact | null; readonly readOk: boolean }> {
  if (!store?.readNewestAnalysisFactFor) return { fact: null, readOk: false };
  try {
    const fact = await store.readNewestAnalysisFactFor(scenarioId);
    return { fact, readOk: true };
  } catch (error) {
    const errorCode = error instanceof SessionReadError ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    log.warn(
      { request_id: requestId, scenario_id: scenarioId, error_code: errorCode, err: message },
      'V5 buildTurnContext: session.readNewestAnalysisFactFor failed — claim-safety falls back to the window and may fail CLOSED',
    );
    emit(TelemetryEvents.SessionReadDegraded, {
      request_id: requestId,
      scenario_id: scenarioId,
      error_code: errorCode ?? 'unknown',
      severity: 'warning',
    });
    return { fact: null, readOk: false };
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
 * Ownership is keyed on the STORED owner (the RPC's authoritative user_id),
 * never on whether the caller happened to supply one — that distinction is
 * what closes the IDOR-class hole (a caller omitting user_id must NOT skip
 * the check on an owned scenario).
 *
 *   Stored owner NON-null (an owned scenario):
 *     - Caller == owner → `{ ok: true }`.
 *     - Caller is a DIFFERENT user → cross-tenant attempt;
 *       `{ ok: false, reason: 'scenario_owned_by_other_user' }`, route 422.
 *     - Caller ABSENT (no user_id) → IDOR fail-closed;
 *       `{ ok: false, reason: 'scenario_requires_authenticated_owner' }`,
 *       route 422. An anonymous caller is not the owner.
 *
 *   Stored owner NULL (a guest scenario — VITE_AUTH_MODE=guest):
 *     - Any caller (anonymous or identified) → `{ ok: true }`. There is no
 *       ownership concept for an unowned scenario.
 *       ⚠ This openness is a deliberate product decision AND a real
 *       disclosure/mutation surface: anyone holding a guest scenario's UUID
 *       can read its conversation and append turns to it. It is NOT closed
 *       here because nothing on the guest wire distinguishes the legitimate
 *       guest from any other caller — the guest journey carries no cookie,
 *       no token and no header. Closing it needs a client-side credential
 *       (a UI change), not a CEE change. Do not re-describe this as "a
 *       product feature, not a leak": it is both, and the second half is
 *       what an earlier version of this comment taught readers to skip.
 *
 *   Store NOT CONFIGURED (`getSessionStore()` throws — no Supabase in this
 *   environment), any caller:
 *     - Skipped, turn proceeds (`{ ok: true, skipped }`). There is no
 *       persistence here, therefore no stored owner to protect.
 *
 *   Ownership RPC FAILS against a CONFIGURED store, any caller:
 *     - Fail CLOSED (`{ ok: false, reason: 'scenario_ownership_unverifiable' }`,
 *       route 422). We asked who owns this scenario and could not find out;
 *       proceeding would grant access we cannot justify.
 *       This previously failed OPEN, on the stated grounds that
 *       "`append_turn_atomic` is the last line of defence". That premise is
 *       false for ownership: append_turn_atomic (v1/v2/v3) reads `user_id`
 *       FROM the scenarios row to denormalise it onto the turn and never
 *       compares it to any caller identity — it guards scenario EXISTENCE,
 *       not ownership. So the open path removed the ownership check with
 *       nothing behind it, and did so exactly when the DB was unhealthy.
 *
 * ⚠ Caller-ownership check is PoC-grade only. See ensureScenarioExists
 * on SessionStore and the migration file header for the production-
 * upgrade path (JWT-scoped client + auth.uid()).
 */
export type PreflightResult =
  | { readonly ok: true; readonly skipped?: boolean }
  | {
      readonly ok: false;
      readonly reason:
        | 'scenario_owned_by_other_user'
        | 'scenario_requires_authenticated_owner'
        /** The store is configured but could not tell us who owns the row. */
        | 'scenario_ownership_unverifiable';
    };

export async function preflightEnsureScenario(
  scenarioId: string,
  userId: string | null,
  requestId: string,
  sessionStore?: SessionStore,
): Promise<PreflightResult> {
  // Resolving the store and QUERYING it are separated on purpose: they are
  // different failures with opposite correct answers. "No store configured"
  // means this environment has no persistence and therefore no stored owner
  // to protect — skipping is right. "Store configured but the query failed"
  // means the ownership oracle is unavailable — skipping there would silently
  // delete the ownership check for the duration of the incident.
  let store: SessionStore;
  try {
    store = sessionStore ?? getSessionStore();
  } catch (e) {
    log.debug(
      {
        request_id: requestId,
        scenario_id: scenarioId,
        err_name: e instanceof Error ? e.name : 'unknown',
        err_message: e instanceof Error ? e.message : String(e),
      },
      'V5 pre-flight ensureScenarioExists skipped (no session store configured)',
    );
    return { ok: true, skipped: true };
  }

  // NO structural `typeof store.ensureScenarioExists === 'function'` probe
  // here, deliberately. A store that is PRESENT but cannot answer the
  // ownership question is the oracle-unavailable case, not the
  // no-persistence case: something was injected, it simply is not the thing
  // that can answer. Skipping it would restore — for that store shape only —
  // the exact fail-open the catch below exists to remove, and it would do so
  // for a shape the interface forbids (`ensureScenarioExists` is REQUIRED on
  // SessionStore), so the compiler offers no warning and only a DI
  // mis-wiring produces it in production. The missing-method TypeError
  // therefore falls into the same catch as an RPC failure and refuses the
  // turn. Test doubles get completeness from `createMockSessionStore()`
  // (tests/utils/mock-session-store.ts), which is typed
  // `Required<SessionStore>` and fails the typecheck loudly on drift — that
  // is where double-completeness belongs, not in a production branch.
  let authoritativeUserId: string | null;
  try {
    const result = await store.ensureScenarioExists(scenarioId, userId);
    authoritativeUserId = result.user_id;
  } catch (e) {
    // Fail CLOSED. Logged at WARN, not DEBUG: a control that has stopped
    // functioning is an operational event, not a debugging detail.
    log.warn(
      {
        request_id: requestId,
        scenario_id: scenarioId,
        caller_identified: userId !== null,
        err_name: e instanceof Error ? e.name : 'unknown',
        err_code: e instanceof SessionReadError ? e.code : undefined,
        err_message: e instanceof Error ? e.message : String(e),
      },
      'V5 pre-flight: ownership oracle unavailable (ensureScenarioExists failed) — refusing turn (fail closed)',
    );
    emit(TelemetryEvents.SessionReadDegraded, {
      request_id: requestId,
      scenario_id: scenarioId,
      error_code: e instanceof SessionReadError ? (e.code ?? 'unknown') : 'unknown',
      severity: 'error',
    });
    return { ok: false, reason: 'scenario_ownership_unverifiable' };
  }

  // Ownership is enforced ONLY when the scenario has a stored owner. A null
  // stored owner means a guest (unowned) scenario, which by design any caller
  // may act on — that carve-out is a product feature (VITE_AUTH_MODE=guest),
  // NOT the either-null skip that opened the IDOR hole below.
  if (authoritativeUserId !== null) {
    if (userId === null) {
      // IDOR fail-closed: the scenario has a non-null owner but the caller
      // presented NO identity. The previous `userId !== null &&` guard skipped
      // the whole check here, so any request that simply omitted user_id could
      // act on any owned scenario. Refuse — an anonymous caller is not the
      // owner. (The JWT-derivation half — making identity un-spoofable on
      // browser paths — is tracked separately in user-identity.ts.)
      log.warn(
        {
          request_id: requestId,
          scenario_id: scenarioId,
          owner_user_id_prefix: authoritativeUserId.slice(0, 8),
        },
        'V5 pre-flight: anonymous caller (no user_id) on an owned scenario — refusing turn (fail closed)',
      );
      return { ok: false, reason: 'scenario_requires_authenticated_owner' };
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
/**
 * Prior handler facts for a scenario, best-effort.
 *
 * Added for the `factor_value_edit` system-event dispatch (ROADMAP 1.346), which
 * needs `prior_facts` to decide whether `set_factor_value` appends its staleness
 * narrative ("This makes the last analysis stale."). It lives HERE, beside the
 * other persisted-read helpers, because the state-write invariant
 * (`scripts/ci/check-state-write-invariant.sh`) allows `SessionStore` imports in
 * exactly three places — `session/`, `commit.ts` and this file — and a dispatch
 * module reaching for the store directly is precisely what that gate exists to
 * stop. Keeping the read on this side of the chokepoint is the point.
 *
 * BEST-EFFORT ON PURPOSE, and the failure mode is bounded: the worst case of a
 * failed read is a receipt missing one sentence, so this degrades to `[]` and
 * logs rather than throwing. It must never be used where a fact read is
 * load-bearing for a decision — for that, read through a path that fails closed.
 */
export async function loadPriorFactsQuietly(
  scenarioId: string,
  requestId: string,
  sessionStore?: SessionStore,
): Promise<readonly HandlerFact[]> {
  try {
    const store = sessionStore ?? getSessionStore();
    const recent = await store.readRecent(scenarioId);
    const rowIds = recent
      .map((t) => t.id)
      .filter((id): id is string => typeof id === 'string');
    if (rowIds.length === 0) return [];
    return await store.readFactsFor(rowIds);
  } catch (err) {
    log.warn(
      {
        event: 'v5.prior_facts.read_failed',
        request_id: requestId,
        scenario_id: scenarioId,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'Prior-fact read failed; proceeding without prior facts',
    );
    return [];
  }
}

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

export async function loadScenarioSnapshotForRunAnalysis(
  scenarioId: string,
  requestId: string,
  sessionStore?: SessionStore,
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
  if (persistedGraph == null) {
    // GENUINELY no persisted graph (store reachable, scenarios.graph absent) — e.g. a
    // guest scenario that never drafted/saved a model; deployed V5 run_analysis sends
    // no graph_state to fall back to. Convert the legacy raw-500 into a typed
    // RECOVERABLE failure: AnalysisNotReadyError → the run_analysis handler maps it to
    // `analysis_not_ready` (a 200 with an honest "draft a model first" next-step +
    // recovery chip). This throw is BEFORE the PLoT payload build and before any
    // run_analysis handler fact. INDEPENDENT of EP2 (`analysisReadyGuardEnabled`) — the
    // deployed path runs EP2 OFF — and gated only by its own default-ON kill-switch
    // (`runAnalysisNullGraphRecoverable`) so a code-free rollback to the raw 500 stays
    // available. A store/RPC failure does NOT reach here (it threw above → propagates
    // to scenario_read_failed). The EP2 guard below still runs only on a non-null graph.
    if (config.cee.runAnalysisNullGraphRecoverable) {
      throw new AnalysisNotReadyError(assessAnalysisReadiness(null));
    }
    throw new Error(`No persisted graph found for scenario ${scenarioId}`);
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
  let graphForSnapshot: unknown = persistedGraph;
  if (config.cee.analysisReadyGuardEnabled) {
    const verdict = assessAnalysisReadiness(persistedGraph);
    if (verdict.status === 'unrecoverable') {
      throw new AnalysisNotReadyError(verdict);
    }
    graphForSnapshot = verdict.canonicalGraph ?? persistedGraph;
  }

  // W2E-2 round 4 — persisted-sigma floor, BEFORE the GraphV3 parse that
  // used to kill the turn. `EdgeStrengthV3.std` is `z.number().positive()`,
  // but the live UI writer floors at ZERO (`Math.max(0, strengthStdValue)`),
  // so persisted `std = 0` is continuously produced and has an unambiguous
  // safe reading ("no uncertainty stated"). Constraint order (rounds 1–3):
  //   (1) never brick a persisted scenario → repair, don't reject;
  //   (2) never fork graph identity → the floor is COPY-ON-WRITE and applies
  //       ONLY to the compute projection parsed below. `rawPersistedGraph`
  //       (the graph_hash_at_run input, run-analysis.ts) and the persisted
  //       object stay byte-identical to what every freshness hash site reads.
  //       Round 3 placed this floor inside PLoTClient.run, where the parse
  //       below had already thrown before it could ever execute (dead code on
  //       every live path — the only other plotClient.run caller hangs off
  //       the 410 V1 route / unregistered V4 pipeline).
  //   (3) never let bad numerics reach computation → repaired sigma is
  //       contract-valid; anything still out of range refuses honestly below.
  // Telemetry is code-keyed: field path + floor written, never the offending
  // value, never a label (PII rule).
  const sigmaFloor = floorGraphSigmaForCompute(graphForSnapshot);
  for (const repair of sigmaFloor.repairs) {
    emit(TelemetryEvents.ComputeSigmaFloor, {
      path: repair.path,
      kind: repair.kind,
      repaired_to: repair.repaired_to,
      request_id: requestId,
    });
  }

  const parsedGraph = GraphV3.safeParse(sigmaFloor.graph);
  if (!parsedGraph.success) {
    // Numeric range violations with NO safe reading (exists_probability
    // outside [0,1] — we cannot know whether 1.4 meant 1.0 or 0.14) must be
    // an HONEST refusal: a typed AnalysisNotReadyError that run_analysis maps
    // to `analysis_not_ready` (non-retryable, actionable next step), not the
    // generic `scenario_read_failed, retryable: true` — which promises a
    // retry that can never succeed. Persisted values are NOT repaired here:
    // rewriting a hash-projected field on a persisted graph forks its
    // identity from every token minted off the unrepaired bytes (round-2
    // regression). The user self-heals by fixing the value on the canvas.
    // Zod's too_small/too_big with type 'number' is exactly the
    // range-violation class; shape/structural failures stay on the existing
    // scenario_read_failed path (a user who HAS a graph must never be told
    // to "draft a model first").
    const numericRangeIssues = parsedGraph.error.issues.filter(
      (issue) =>
        (issue.code === 'too_small' || issue.code === 'too_big') &&
        'type' in issue &&
        issue.type === 'number',
    );
    if (numericRangeIssues.length > 0) {
      const verdict: ReadinessResult = {
        status: 'unrecoverable',
        reasonCodes: ['SCHEMA_INVALID'],
        reasonCategory: 'numeric_integrity',
        deterministicRecovery: false,
        safeToAnalyse: false,
        safeToPersist: false,
        userActionRequired: true,
        canonicalGraph: null,
        // User-safe: names the violation class only — never the offending
        // value, never a node/edge label (PII rule).
        nextStep:
          'A probability or uncertainty value in this model is outside its valid range. Fix the value on the canvas, then run the analysis again.',
      };
      throw new AnalysisNotReadyError(verdict);
    }
    throw new Error(`Persisted graph failed GraphV3 validation for scenario ${scenarioId}`);
  }

  const readiness = computeStructuralReadiness(parsedGraph.data);
  if (!readiness?.goal_node_id) {
    throw new Error(`Could not derive analysis_ready.goal_node_id for scenario ${scenarioId}`);
  }

  // CEE → PLoT value-scale egress net (Tier 0, Phase 1) — UNCONDITIONAL since
  // 2026-07-20 (O-7 wave 2: CEE_PLOT_EGRESS_SCALE_NET_ENABLED deleted,
  // live-true on staging).
  //
  // PLoT consumes intervention input `value` as RAW user-scale and normalises
  // internally using the target factor node's `observed_state.cap` (re-verified
  // clean on PLoT staging `78aea76`, 2026-06-18). CEE historically projected the
  // normalised `[0,1]` convention, which double-normalises capped interventions
  // (e.g. sends 0.25 where PLoT expects 25000). We therefore canonicalise the
  // OUTBOUND interventions here — the single egress projection point — via the
  // evidence-gated rule in `plot-intervention-scale.ts` (no silent corruption,
  // double-conversion-safe). Read-only: the persisted graph is never mutated;
  // only the outbound PLoT projection changes.
  const options = projectOptionsToRawScale(parsedGraph.data.nodes, readiness.options, requestId, scenarioId);

  return {
    graph: parsedGraph.data,
    options,
    goal_node_id: readiness.goal_node_id,
    // EP2: canonical graph when the guard is on (graphForSnapshot === persistedGraph
    // when off) — keeps graph_hash_at_run consistent with the freshness-side hash.
    rawPersistedGraph: graphForSnapshot,
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

// normaliseNumericInterventions deleted 2026-07-20 (O-7 wave 2): it was the
// legacy [0,1]-convention projection used only by the egress-scale-net OFF
// branch, which no longer exists (the net is unconditional above).
