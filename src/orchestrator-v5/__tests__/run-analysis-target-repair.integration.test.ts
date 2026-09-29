/**
 * ⭐ THE FOUNDER-LOOP BREAK: "Rerun." REFUSED WITH AN EDIT ERROR.
 *
 * Driven through the REAL `runTurnExecutor`, because the defect is not in any
 * predicate — it is in what happens to a proposal the election gate has
 * already ADMITTED.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CAUSAL CHAIN, and note which link is broken.
 *
 *   1. `looksLikeExplicitAnalysisRequest('Rerun.')` is TRUE, so the
 *      analysis-election gate ADMITS the turn. That link is correct and is
 *      pinned by `routing/__tests__/analysis-election-gate.test.ts`.
 *   2. `looksLikeImperativeRerun('Rerun.')` is FALSE — DELIBERATELY. That
 *      predicate may dispatch with NO LLM call, so it fails closed, and eight
 *      of these exact strings are pinned to stay false by a test named
 *      *"does NOT widen the LLM-free dispatch predicate (trap 21 — the
 *      separation holds)"*. ⚠ NOTHING IN THIS FILE MAY MOVE IT.
 *   3. So the turn is routed by the LLM. `entity` is REQUIRED on every
 *      proposal while `run_analysis`'s target is semantically the whole
 *      scenario, so the model INVENTS one and picks the decision node about
 *      half the time.
 *   4. `toEntityKind('decision')` is `'node'`; `run_analysis` accepts
 *      `['option','goal']`; `validator.ts` returns ENTITY_KIND_MISMATCH.
 *   5. The user asked to run an analysis and is told *"I found <Decision>,
 *      but I can't make that change to it."*
 *
 * Link 4 is the break. This file pins the repair AT LINK 4 and asserts, in
 * the opposite direction, that links 1-2 are untouched.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ WHY A SPY HANDLER AND NOT A TEXT ASSERTION. The harm is that the analysis
 * does NOT run. A test that only inspected the reply would pass on a build
 * that refused politely. Every twin asserts on `runAnalysisSpy` invocation
 * counts, bound to the handler by IDENTITY (`'run_analysis'` in the registry
 * map), never by a value predicate another handler could satisfy.
 *
 * ⚠ AND EVERY TWIN PINS ITS OWN PRECONDITION (trap 13b). A repair test that
 * passed because the turn never reached validation, or because the LLM was
 * never consulted, would be a tautology. `chatWithTools` call counts and the
 * gate's own telemetry are asserted alongside the outcome, so a twin that
 * stops discriminating REDs instead of quietly agreeing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink, TelemetryEvents } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { HandlerFn, HandlerRegistry } from '../tools/registry.js';
import type { V5ActionType } from '@talchain/schemas/orchestrator';
import type { PendingAction } from '../session/pending-action.js';

// ---------------------------------------------------------------------------
// Session-store mock (same harness shape as the sibling executor tests)
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
    invalidateScoped: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => mockState.persistedGraph,
    loadGraphAndBriefText: async () => ({
      graph: mockState.persistedGraph,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => mockState.pendingActions,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCENARIO_ID = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';

/**
 * A full `runTurnExecutor` turn imports and boots a large module graph. On a
 * loaded machine the first of these took 9.6s against vitest's undocumented 5s
 * default, which reported a TIMEOUT for a test that has no timing dependence
 * at all. Set once here rather than hand-passed per case.
 */
const TURN_EXECUTOR_TIMEOUT_MS = 60_000;

/**
 * ⚠ THE DECISION NODE IS THE POINT OF THIS FIXTURE. The captured production
 * refusals name it verbatim — *"I found Engineering Hiring Decision, but I
 * can't make that change to it."* — so the graph must carry one, and its
 * label must be the thing the failing copy would quote.
 */
const DECISION_LABEL = 'Engineering Hiring Decision';
const DECISION_ID = 'dec_hiring';

const GRAPH_WITH_DECISION = {
  nodes: [
    { id: DECISION_ID, kind: 'decision', label: DECISION_LABEL },
    { id: 'goal_profit', kind: 'goal', label: 'Bakery profit' },
    { id: 'fac_capex', kind: 'factor', label: 'Capital expenditure' },
    {
      id: 'opt_open',
      kind: 'option',
      label: 'Open a second bakery',
      interventions: { fac_capex: 1 },
    },
    {
      id: 'opt_hold',
      kind: 'option',
      label: 'Hold',
      is_baseline: true,
      interventions: { fac_capex: 0 },
    },
  ],
  edges: [
    {
      from: 'opt_open',
      to: 'fac_capex',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_hold',
      to: 'fac_capex',
      strength: { mean: 0.01, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_capex',
      to: 'goal_profit',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
  goal_node_id: 'goal_profit',
};

/** The same graph with every option removed — the fall-through control. */
const GRAPH_WITHOUT_OPTIONS = {
  ...GRAPH_WITH_DECISION,
  nodes: GRAPH_WITH_DECISION.nodes.filter((n) => n.kind !== 'option'),
  edges: [],
};

function mkPayload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: randomUUID(),
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  };
}

/**
 * The election the live router produces on these turns: `run_analysis`, with
 * an INVENTED target — the decision node. Verbatim shape of the captured
 * failure.
 */
const ELECTION_TARGETING_DECISION = {
  intent_class: 'execute',
  action: {
    handler_id: 'run_analysis',
    entity: {
      id: DECISION_ID,
      kind: 'option',
      label: DECISION_LABEL,
      resolution_status: 'resolved',
      resolution_method: 'label_match',
    },
    parameters: [],
    cited_context_fields: ['graph.options'],
  },
};

/** The other side of the same coin flip: a target the registry accepts. */
const ELECTION_TARGETING_OPTION = {
  intent_class: 'execute',
  action: {
    handler_id: 'run_analysis',
    entity: {
      id: 'opt_open',
      kind: 'option',
      label: 'Open a second bakery',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [],
    cited_context_fields: ['graph.options'],
  },
};

const ORIENTATION = 'Right, I will run the simulation now to test which option performs best.';

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    { type: 'text', text: ORIENTATION },
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: input as Record<string, unknown>,
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 42,
  };
}

function mockRoutingAdapter(election: unknown = ELECTION_TARGETING_DECISION) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(mkToolUseResult(election)),
  };
}

function spyRegistry(): { registry: HandlerRegistry; runAnalysisSpy: ReturnType<typeof vi.fn> } {
  const runAnalysisSpy = vi.fn(async () => ({
    assistant_text: 'ANALYSIS-HANDLER-RAN',
    handler_facts: [],
    llm_calls_used: 0,
  }));
  const registry = new Map<V5ActionType, HandlerFn>([
    ['run_analysis' as V5ActionType, runAnalysisSpy as unknown as HandlerFn],
  ]);
  return { registry, runAnalysisSpy };
}

type SinkEvent = { event: string; data: Record<string, unknown> };
let events: SinkEvent[] = [];

beforeEach(() => {
  events = [];
  mockState.priorTurns = [];
  mockState.priorFacts = [];
  mockState.persistedGraph = GRAPH_WITH_DECISION;
  mockState.pendingActions = [];
  setTestSink((event, data) => events.push({ event, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

/** Bound to the FROZEN ENUM, never to a re-typed literal (trap 12). */
const repairEvents = (): SinkEvent[] =>
  events.filter((e) => e.event === TelemetryEvents.V5RunAnalysisTargetRepair);
const gateEvents = (): SinkEvent[] =>
  events.filter((e) => e.event === TelemetryEvents.V5AnalysisElectionGate);

// ---------------------------------------------------------------------------
// TWIN A — the founder-loop break itself
// ---------------------------------------------------------------------------

describe('TWIN A — an admitted analysis whose target the model invented still RUNS', () => {
  it.each(['Rerun.', 'Run analysis.'])(
    '%j runs the analysis even though the election targets the decision node',
    async (message) => {
      const adapter = mockRoutingAdapter();
      const { registry, runAnalysisSpy } = spyRegistry();

      const { response } = await runTurnExecutor(
        mkPayload(message),
        `req-repair-a-${randomUUID()}`,
        { routingAdapter: adapter, handlerRegistry: registry },
      );

      // PRECONDITION 1 — the LLM was consulted. Without this the assertion
      // below could pass on a build where a deterministic pre-route claimed
      // the turn, which would prove nothing about the repair.
      expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
      // PRECONDITION 2 — the gate ADMITTED it. This is the link the repair
      // depends on and does not touch.
      expect(gateEvents()).toHaveLength(1);
      expect(gateEvents()[0]!.data).toMatchObject({
        handler_id: 'run_analysis',
        outcome: 'admitted',
      });

      // ⭐ THE LOAD-BEARING ASSERTION — the handler RAN.
      expect(runAnalysisSpy).toHaveBeenCalledTimes(1);

      // The repair is observable, and says what it did.
      expect(repairEvents()).toHaveLength(1);
      expect(repairEvents()[0]!.data).toMatchObject({
        handler_id: 'run_analysis',
        outcome: 'repaired',
        proposed_kind: 'node',
        repaired_kind: 'option',
      });

      // And the user never sees the edit-shaped refusal.
      expect(response.assistant_text).not.toContain("can't make that change to it");
      expect(response.assistant_text).not.toContain(DECISION_LABEL);
    },
    // ⚠ AN EXPLICIT TIMEOUT, NOT A DEFAULT. These twins have no timing
    // dependence by design — they assert invocation counts on a stubbed
    // adapter — so vitest's 5s default is the only thing that can make them
    // report a failure they are not testing for. A timeout here would be a
    // manufactured red, and a manufactured red is not evidence.
    TURN_EXECUTOR_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// TWIN B — the OPPOSITE direction: the repair widens nothing
// ---------------------------------------------------------------------------

describe('TWIN B (opposite direction) — a demoted election gains nothing from the repair', () => {
  it('a model-building message with the same election still does NOT run the analysis', async () => {
    const adapter = mockRoutingAdapter();
    const { registry, runAnalysisSpy } = spyRegistry();

    await runTurnExecutor(
      mkPayload('Use your best guess for the rest and draft the model now.'),
      'req-repair-b',
      { routingAdapter: adapter, handlerRegistry: registry },
    );

    // PRECONDITION — the election really was the same one TWIN A repairs.
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(gateEvents()[0]!.data).toMatchObject({ outcome: 'demoted' });

    // ⭐ THE DISCRIMINATION: demotion happens BEFORE validation, so the repair
    // never sees this proposal. If the repair were ever moved ahead of the
    // gate, this REDs.
    expect(runAnalysisSpy).not.toHaveBeenCalled();
    expect(repairEvents()).toHaveLength(0);
  }, TURN_EXECUTOR_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// TWIN C — the repair binds to the MISMATCH, not to the handler id
// ---------------------------------------------------------------------------

describe('TWIN C — an election that already names an option is left alone', () => {
  it('runs, and emits NO repair event', async () => {
    const adapter = mockRoutingAdapter(ELECTION_TARGETING_OPTION);
    const { registry, runAnalysisSpy } = spyRegistry();

    await runTurnExecutor(mkPayload('Rerun.'), 'req-repair-c', {
      routingAdapter: adapter,
      handlerRegistry: registry,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(runAnalysisSpy).toHaveBeenCalledTimes(1);
    // ⭐ Neither twin alone shows binding. TWIN A proves the repair fires on
    // the unaddressable target; TWIN C proves it does NOT fire on the
    // addressable one — i.e. it is bound to the kind mismatch and not to
    // `handler_id === 'run_analysis'`.
    expect(repairEvents()).toHaveLength(0);
  }, TURN_EXECUTOR_TIMEOUT_MS);

  it('a kind mismatch on a DIFFERENT handler is not this repair’s business', async () => {
    // ⭐ THE OTHER HALF OF THE BINDING. TWIN C above shows the repair does not
    // fire on an acceptable target; this shows it does not fire on an
    // unacceptable target belonging to another handler. Delete the
    // `handler_id === 'run_analysis'` conjunct and this REDs — without it, that
    // conjunct is unguarded and a tidy-up could remove it silently.
    //
    // `set_factor_value` accepts ['node']; the goal node is kind 'goal', so
    // this election fails validation for exactly the same reason TWIN A's
    // does, which is what makes it the discriminating case rather than merely
    // a different one.
    const adapter = mockRoutingAdapter({
      intent_class: 'execute',
      action: {
        handler_id: 'set_factor_value',
        entity: {
          id: 'goal_profit',
          kind: 'node',
          label: 'Bakery profit',
          resolution_status: 'resolved',
          resolution_method: 'label_match',
        },
        parameters: [{ name: 'value', value: 5, source: 'user_explicit' }],
        cited_context_fields: ['graph.nodes'],
      },
    });
    const { registry, runAnalysisSpy } = spyRegistry();

    await runTurnExecutor(mkPayload('Rerun.'), 'req-repair-c2', {
      routingAdapter: adapter,
      handlerRegistry: registry,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(runAnalysisSpy).not.toHaveBeenCalled();
    expect(repairEvents()).toHaveLength(0);
  }, TURN_EXECUTOR_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// TWIN D — the fall-through contract: no option ⇒ no substitution
// ---------------------------------------------------------------------------

describe('TWIN D — with no option node the repair DECLINES rather than guessing', () => {
  it('leaves the turn exactly as it is and says why', async () => {
    mockState.persistedGraph = GRAPH_WITHOUT_OPTIONS;
    const adapter = mockRoutingAdapter();
    const { registry, runAnalysisSpy } = spyRegistry();

    await runTurnExecutor(mkPayload('Rerun.'), 'req-repair-d', {
      routingAdapter: adapter,
      handlerRegistry: registry,
    });

    // PRECONDITION — the fixture really has no options, so this test is
    // about the decline and not about an accident of the graph.
    expect(GRAPH_WITHOUT_OPTIONS.nodes.some((n) => n.kind === 'option')).toBe(false);
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);

    // Substituting the goal here would only trade ENTITY_KIND_MISMATCH for
    // PRECONDITION_UNMET — a different refusal, not a fix. So: no run, and a
    // decline that is distinguishable from silence in ops.
    expect(runAnalysisSpy).not.toHaveBeenCalled();
    expect(repairEvents()).toHaveLength(1);
    expect(repairEvents()[0]!.data).toMatchObject({
      outcome: 'declined',
      reason: 'no_option_target',
    });
  }, TURN_EXECUTOR_TIMEOUT_MS);
});
