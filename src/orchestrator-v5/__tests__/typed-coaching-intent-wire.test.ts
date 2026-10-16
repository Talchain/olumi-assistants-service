/**
 * ⭐ A TYPED COACHING INTENT OTHER THAN `add_option` REACHES THE COACH — ASSERTED
 * AT THE WIRE, AND WITHOUT COSTING THE USER THE RUN AFFORDANCE.
 *
 * ── WHY AT THE WIRE, AND NOT BY READING THE REPLY ────────────────────────────
 * The arm STEERS the coach; it never authors copy. So "did it work?" cannot be
 * answered from reply text — the adapter is a stub, and even against a real
 * model the prose would be a judgement call, which is not a test. The checkable
 * fact is the one the arm is actually responsible for: THE BYTES HANDED TO THE
 * ROUTER. Everything below asserts on the message the adapter received.
 *
 * ── WHAT THE HARM WAS, SO THE ASSERTIONS CAN BE READ AGAINST IT ──────────────
 * `CEE_ACCEPTED_INTENTS` held exactly one member. Four MOUNTED sparks declared
 * coaching intents with no routing arm behind them, so the send gate failed
 * closed and the click arrived as anonymous prose — and on the widening card the
 * fall-through was worse than silent: the turn took the free-text edit lane,
 * came back a refusal, and the recovery chips REPLACED the row that held
 * `Run analysis`. The user accepted the product's own suggestion and paid for it
 * with their ability to run. The last test in this file is that harm, pinned.
 *
 * ── BOUND BY IDENTITY, NEVER BY A TYPED SUBSTRING ────────────────────────────
 * Every expectation is derived by CALLING the production builders
 * (`buildCoachingMethodDirective`, `composeCoachingRoutingMessage`). A test that
 * asserted a hand-copied phrase would pass while the arm emitted something else
 * entirely, and would go RED on a copy edit that changed nothing (CLAUDE.md
 * trap 19).
 */

import { randomUUID } from 'node:crypto';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

import { TelemetryEvents,setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';

import type { PendingAction } from '../session/pending-action.js';

// ---------------------------------------------------------------------------
// Session-store mock — same harness shape as the sibling post-analysis suites.
// ---------------------------------------------------------------------------

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
  pendingActions: readonly PendingAction[];
} = { priorTurns: [], priorFacts: [], persistedGraph: null, pendingActions: [] };

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => mockState.priorFacts,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    loadGraph: async () => mockState.persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: mockState.persistedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => mockState.pendingActions,
  }),
  resetSessionStoreForTests: () => undefined,
}));






/** Two options, one goal, every non-baseline option carrying an intervention —
 * the shape `analysis_ready` resolves to `ready` on, so the Run affordance is
 * genuinely on offer and its LOSS is observable. */
const READY_GRAPH = {
  nodes: [
    { id: 'goal_q3', kind: 'goal', label: 'Q3 Roadmap' },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    { id: 'opt_hire', kind: 'option', label: 'Hire', interventions: { fac_capacity: 1 } },
    {
      id: 'opt_status_quo',
      kind: 'option',
      label: 'Hold',
      is_baseline: true,
      interventions: { fac_capacity: 0 },
    },
  ],
  edges: [
    {
      from: 'opt_hire',
      to: 'fac_capacity',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_status_quo',
      to: 'fac_capacity',
      strength: { mean: 0.01, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_capacity',
      to: 'goal_q3',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
  goal_node_id: 'goal_q3',
};

void computeAnalysisAffectingGraphHash(READY_GRAPH as never);





/**
 * A prior SUCCESSFUL analysis whose `graph_hash_at_run` does NOT match the
 * current graph — so `deriveAnalysisFreshness` resolves `stale`, and the
 * post-analysis wrapper's stale path offers its `run_analysis` chip.
 *
 * ⭐ WHY THIS FIXTURE RATHER THAN A PRE-ANALYSIS ONE. The Run affordance has to
 * be genuinely, deterministically ON OFFER for its LOSS to be observable — an
 * assertion that Run survives on a turn where Run was never offered is
 * satisfied by any build at all. A stale analysis is the state where the
 * product owes the user a rerun control, it is derived rather than injected,
 * and it is also the state the wrapper's own stage gate governs, so this pins
 * the coaching arm and the wrapper fix against each other rather than
 * separately.
 */












/** Captures the exact user message handed to the router — the wire under test. */


/**
 * ⚠ THE ASSERTION THAT NEARLY WENT UNWRITTEN, AND WOULD HAVE MADE THE HARM TEST
 * A LIE. The first version of this suite used a tool-call fixture the interpreter
 * could not parse, so every turn fell into the BOUNDED ROUTING FALLBACK
 * (`failure_type: LLM_UNAVAILABLE`) — which offers its own
 * `chip_action_run_analysis_retry`. The Run assertion below passed. It was
 * passing on a FAILED TURN's retry control, not on a healthy coaching turn
 * keeping the user's affordance, and no assertion in the file could tell the
 * two apart.
 *
 * So the harm tests pin the turn's HEALTH first. A Run chip that only exists
 * because the turn broke is not the affordance being defended.
 */


type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  events = [];
  mockState.priorTurns = [];
  mockState.priorFacts = [];
  mockState.persistedGraph = READY_GRAPH;
  mockState.pendingActions = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  vi.clearAllMocks();
  setTestSink(null);
});







/**
 * ⭐ F2 — A NON-ROUTED `chip.intent` MUST NOT BE SILENTLY DROPPED.
 *
 * `resolveCoachingIntent` answers `undefined` for an intent CEE does not route,
 * and the arm above then simply skips — no telemetry, no log, no trace. A
 * silently-dropped intent is the exact mechanism that kept the four mounted
 * sparks degrading to anonymous prose for as long as they did: nothing anywhere
 * recorded that a typed click had arrived and been ignored.
 *
 * ── THE EVENT'S JOB, STATED PRECISELY ────────────────────────────────────────
 * It fires when a turn CARRIES a `chip.intent` and the router DECLINED it. It
 * must NOT fire on an ordinary turn — every composer turn in the product has no
 * `chip.intent` at all, and an event that fired on those would bury its own
 * signal under the entire traffic of the service.
 *
 * Content-free by construction: the intent token, the request id, the session
 * id and the stage. Never user text.
 */
describe('F2 — an unrouted typed intent is OBSERVABLE, not silently dropped', () => {
  // Bound to the literal, not to the enum member: at the pristine commit the
  // member does not exist, so a constant-bound filter would read `undefined`
  // and match nothing — a test that could not go red for the right reason.
  const UNROUTED_EVENT = 'v5.typed_coaching_intent_unrouted';

  it('the event name is registered in the frozen TelemetryEvents registry', () => {
    expect(
      (TelemetryEvents as Record<string, string>).V5TypedCoachingIntentUnrouted,
      'the emit is not registered in the frozen enum — `validate-event-names` CI ' +
        'would red on the raw string',
    ).toBe(UNROUTED_EVENT);
  });






});
