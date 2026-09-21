/**
 * ⭐ THE ANALYSIS-ELECTION GATE — Paul's four discriminating twins, driven
 * through the REAL `runTurnExecutor`.
 *
 * The unit suite (`routing/__tests__/analysis-election-gate.test.ts`) proves
 * the PREDICATE. This file proves the thing a predicate cannot: that the
 * refusal is enforced by NOT RUNNING THE HANDLER, and that the paths which
 * must keep running still do.
 *
 * ⚠ WHY A SPY HANDLER AND NOT A TEXT ASSERTION. The witnessed harm is that an
 * analysis EXECUTES — it calls PLoT, writes a fact and a `graph_hash_at_run`,
 * and replaces the user's result. A test that only inspected the reply would
 * pass on a build that ran the analysis and then described it politely. Every
 * twin below asserts on `runAnalysisSpy` invocation counts, bound to the
 * handler by IDENTITY (`'run_analysis'` in the registry map), never by a value
 * predicate another handler could satisfy.
 *
 * ⭐ THE DISCRIMINATING PAIR IS TWIN A vs TWIN C, and it is the load-bearing
 * evidence for WHERE the gate sits. Both carry a message the gate's predicate
 * demotes. In TWIN A the proposal comes from the LLM router and the handler
 * must NOT run; in TWIN C an identical-handler proposal is synthesised by a
 * DETERMINISTIC pre-route (a bare "Yes." resuming a pending `run_analysis`)
 * and the handler MUST run. Neither twin alone shows anything: the first
 * proves the gate bites, the second proves it bites the LLM ELECTION rather
 * than the handler id or the message. Moving the gate out of the
 * `if (routingResult === undefined)` block — the mutation the turn-executor
 * comment names — leaves TWIN A green and turns TWIN C red.
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
import { PENDING_ACTION_DEFAULT_TURN_TTL, type PendingAction } from '../session/pending-action.js';

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
const { ANALYSIS_ELECTION_DEMOTION_TEXT } = await import('../routing/analysis-election-gate.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCENARIO_ID = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';

/** A model that already exists — the turn-2 situation the P0 was measured in. */
const DRAFTED_GRAPH = {
  nodes: [
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

/** The exact turn-2 follow-up the ~43.8% misroute was measured on. */
const P0_MESSAGE = 'Use your best guess for the rest and draft the model now.';

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

/** The `run_analysis` election the live router produces on these turns. */
const RUN_ANALYSIS_ELECTION = {
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

/**
 * ⚠ THE ROUTER'S PRE-ACTION ORIENTATION, and it is a LOAD-BEARING FIXTURE.
 *
 * The served routing prompt scopes the text beside a `run_analysis` tool call
 * to "pre-action orientation only. Say what the simulation will test", so on a
 * real election this channel carries a future-tense promise about a run. If a
 * demoted turn reused it, the user would be told an analysis is happening on
 * the very turn the gate stopped it.
 *
 * The first version of this fixture emitted NO text block, which made
 * `orientationText` the empty string — and a mutant that pointed the demoted
 * reply straight at `orientationText` SURVIVED, because there was nothing
 * contaminated to leak. The fixture was the reason the twin could not see the
 * defect (trap 13: an absence assertion must first be able to see a presence).
 */
const CONTAMINATED_ORIENTATION =
  'Right, I will run the simulation now to test which option performs best.';

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    { type: 'text', text: CONTAMINATED_ORIENTATION },
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

/**
 * A router that always elects `run_analysis`, plus a `chatWithTools` spy so a
 * twin can PIN ITS OWN PRECONDITION — whether the LLM was consulted at all
 * (trap 13b: a discriminator whose precondition is unpinned can silently stop
 * discriminating).
 */
function mockRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(mkToolUseResult(RUN_ANALYSIS_ELECTION)),
  };
}

/** A registry whose ONLY member is a spy standing in for the real analysis. */
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
  mockState.persistedGraph = DRAFTED_GRAPH;
  mockState.pendingActions = [];
  setTestSink((event, data) => events.push({ event, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

function gateEvents(): SinkEvent[] {
  // Bound to the FROZEN ENUM, not to a re-typed literal. The event was renamed
  // into the `v5.routing.*` namespace during this change and a hand-copied
  // string here silently stopped matching — the twins went green-to-red on a
  // rename that changed no behaviour at all (CLAUDE.md rule 12: derive, never
  // mirror). Reading the enum makes a future rename impossible to miss.
  return events.filter((e) => e.event === TelemetryEvents.V5AnalysisElectionGate);
}

// ---------------------------------------------------------------------------
// TWIN A — an ordinary model-building follow-up must NOT become an analysis
// ---------------------------------------------------------------------------

describe('TWIN A — the measured P0: an LLM-elected analysis on a drafting request', () => {
  it('does not invoke the run_analysis handler', async () => {
    const adapter = mockRoutingAdapter();
    const { registry, runAnalysisSpy } = spyRegistry();

    const { response } = await runTurnExecutor(mkPayload(P0_MESSAGE), 'req-twin-a', {
      routingAdapter: adapter,
      handlerRegistry: registry,
    });

    // Precondition, pinned in-test: the LLM WAS consulted and DID elect the
    // analysis. Without this the assertion below could pass on a build where
    // routing never happened at all.
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);

    // ⭐ THE LOAD-BEARING ASSERTION — enforced by not running the handler.
    expect(runAnalysisSpy).not.toHaveBeenCalled();

    // The gate is observable, and says WHY.
    expect(gateEvents()).toHaveLength(1);
    expect(gateEvents()[0]!.data).toMatchObject({
      handler_id: 'run_analysis',
      outcome: 'demoted',
      reason: 'no_explicit_analysis_request',
    });

    // And the reply is the honest one, not the handler's.
    expect(response.assistant_text).not.toContain('ANALYSIS-HANDLER-RAN');
  });
});

// ---------------------------------------------------------------------------
// TWIN B — the opposite-direction twin: explicit intent still runs
// ---------------------------------------------------------------------------

describe('TWIN B (opposite direction) — an explicit request still runs the analysis', () => {
  it.each(['Run the analysis.', 'Re-run the analysis.', 'Analyse this decision.'])(
    'invokes the run_analysis handler for %j',
    async (message) => {
      const adapter = mockRoutingAdapter();
      const { registry, runAnalysisSpy } = spyRegistry();

      await runTurnExecutor(mkPayload(message), `req-twin-b-${randomUUID()}`, {
        routingAdapter: adapter,
        handlerRegistry: registry,
      });

      expect(runAnalysisSpy).toHaveBeenCalledTimes(1);
      const gates = gateEvents();
      // 'Re-run the analysis.' is claimed by the ROADMAP 2.229 deterministic
      // pre-route and never reaches the gate; the other two are LLM-elected
      // and are admitted. Either way the handler runs, and no turn is demoted.
      for (const g of gates) expect(g.data.outcome).toBe('admitted');
    },
  );
});

// ---------------------------------------------------------------------------
// TWIN C — the sanctioned / deterministic paths are untouched
// ---------------------------------------------------------------------------

describe('TWIN C — a DETERMINISTICALLY synthesised run_analysis still executes', () => {
  it('a bare "Yes." resuming a pending run_analysis runs the handler, though the same message would be demoted if the LLM had elected it', async () => {
    mockState.pendingActions = [
      {
        id: 'pa-run-analysis',
        scenario_id: SCENARIO_ID,
        chip_id: 'chip_action_run_analysis',
        action: { kind: 'run_analysis' },
        preconditions: {},
        expires_at_turn_count: PENDING_ACTION_DEFAULT_TURN_TTL,
        expires_at_iso: new Date(Date.now() + 3_600_000).toISOString(),
        emitted_at_iso: new Date(Date.now() - 30_000).toISOString(),
      } satisfies PendingAction,
    ];
    const adapter = mockRoutingAdapter();
    const { registry, runAnalysisSpy } = spyRegistry();

    await runTurnExecutor(mkPayload('Yes.'), 'req-twin-c', {
      routingAdapter: adapter,
      handlerRegistry: registry,
    });

    // Precondition, pinned in-test: this turn was claimed by a DETERMINISTIC
    // pre-route, so the LLM was never consulted. If a future change routed it
    // through the router instead, this assertion REDs and tells you the twin
    // has stopped discriminating — rather than the twin quietly passing for
    // the wrong reason.
    expect(adapter.chatWithTools).not.toHaveBeenCalled();

    // ⭐ THE DISCRIMINATION: the gate never saw this proposal.
    expect(gateEvents()).toHaveLength(0);
    expect(runAnalysisSpy).toHaveBeenCalledTimes(1);
  });

  it('control — "Yes." IS a message the gate would demote, so the twin above is not passing by accident', async () => {
    // Same message, LLM-elected instead of pre-routed. This is the half that
    // proves the twin above discriminates on PROVENANCE and not on the words.
    const adapter = mockRoutingAdapter();
    const { registry, runAnalysisSpy } = spyRegistry();

    await runTurnExecutor(mkPayload('Yes.'), 'req-twin-c-control', {
      routingAdapter: adapter,
      handlerRegistry: registry,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(runAnalysisSpy).not.toHaveBeenCalled();
    expect(gateEvents()[0]?.data).toMatchObject({ outcome: 'demoted' });
  });
});

// ---------------------------------------------------------------------------
// TWIN D — a demoted election still answers, and never fabricates
// ---------------------------------------------------------------------------

describe('TWIN D — a demoted election answers the user (no silent substitution)', () => {
  it('emits the deterministic answer, not the router’s pre-action orientation', async () => {
    const adapter = mockRoutingAdapter();
    const { registry } = spyRegistry();

    const { response, telemetry } = await runTurnExecutor(mkPayload(P0_MESSAGE), 'req-twin-d', {
      routingAdapter: adapter,
      handlerRegistry: registry,
    });

    expect(telemetry.failure_type).toBeNull();
    expect(response.assistant_text).toContain(ANALYSIS_ELECTION_DEMOTION_TEXT);
    // ⭐ THE DISCRIMINATING ASSERTION. The router DID author a pre-action
    // orientation on this turn (pinned below, so this is not an absence test
    // over an absent thing), and none of it may reach the user.
    expect(CONTAMINATED_ORIENTATION).toMatch(/\bI will run\b/);
    expect(response.assistant_text).not.toContain(CONTAMINATED_ORIENTATION);
    expect(response.assistant_text).not.toMatch(/\bsimulation\b/i);
    // The turn is answered, not dropped: a non-trivial reply reached the user.
    expect(response.assistant_text.trim().length).toBeGreaterThan(0);
    // ⚠ P1 — one seam BEYOND the guard. The guard's job is "do not run the
    // handler"; the seam past it is what the COMPOSED, egress-processed reply
    // actually tells the user. A build that suppressed the handler and then
    // announced an analysis would satisfy the guard and still lie.
    expect(response.assistant_text).not.toMatch(
      /\b(?:running the analysis|analysis is running|I('| wi)ll run|results are ready|analysis complete)\b/i,
    );
  });
});
