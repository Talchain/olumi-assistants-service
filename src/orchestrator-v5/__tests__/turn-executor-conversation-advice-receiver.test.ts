/** Real executor receiving-path test; storage and one routing adapter are mocked.
 * Proves contextual prompt/response transport and no canonical write, not live model quality. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { OLUMI_ACTION_TOOL_NAME } from '../routing/tool-schema.js';
import nativeResearch from './fixtures/contextual-research-native-2026-09-08.json';
vi.mock('../coaching/draft-coaching-log.js', async () => {
  const actual = await vi.importActual<
    typeof import('../coaching/draft-coaching-log.js')
  >('../coaching/draft-coaching-log.js');
  return {
    ...actual,
    readLatestDraftCoaching: vi.fn(async () => null),
  };
});

vi.mock('../coaching/last-coaching-signal-log.js', async () => {
  const actual = await vi.importActual<
    typeof import('../coaching/last-coaching-signal-log.js')
  >('../coaching/last-coaching-signal-log.js');
  return {
    ...actual,
    readLatestLastCoachingSignal: vi.fn(async () => null),
    appendLastCoachingSignal: vi.fn(async () => undefined),
  };
});

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  priorTurnsTotal: number;
  newestAnalysisFact: Record<string, unknown> | null;
  newestAnalysisFactReadError: Error | null;
  scenarioAnalysisFactsOverride: Array<Record<string, unknown>> | null;
  scenarioAnalysisTotalCountOverride: number | null;
  persistedGraph: unknown | null;
  persistedBriefText: string | null;
  persistedGraphReadError: Error | null;
  appendWrites: Array<Record<string, unknown>>;
  invalidationCalls: number;
  storeDraftGraphCalls: number;
} = {
  priorTurns: [],
  priorFacts: [],
  priorTurnsTotal: 0,
  newestAnalysisFact: null,
  newestAnalysisFactReadError: null,
  scenarioAnalysisFactsOverride: null,
  scenarioAnalysisTotalCountOverride: null,
  persistedGraph: null,
  persistedBriefText: null,
  persistedGraphReadError: null,
  appendWrites: [],
  invalidationCalls: 0,
  storeDraftGraphCalls: 0,
};

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      mockState.appendWrites.push(write);
      return { id: `row-${randomUUID()}` };
    },
    readRecent: async () => mockState.priorTurns,
    countTurns: async () => mockState.priorTurnsTotal,
    readFactsFor: async () => mockState.priorFacts,
    readFactsWithTurnFor: async () =>
      mockState.priorFacts.map((fact, index) => ({
        fact,
        fact_row_id: `hot-fact-row-${index}`,
        turn_id:
          (mockState.priorTurns[index]?.id as string | undefined) ??
          PRIOR_RA_ROW_ID,
        fact_created_at:
          ((fact.result as Record<string, unknown> | undefined)
            ?.computed_at as string | undefined) ??
          '2026-08-27T09:00:00.000Z',
      })),
    readScenarioRunAnalysisFactsFor: async (_scenarioId: string, limit: number) => {
      if (mockState.newestAnalysisFactReadError) {
        throw mockState.newestAnalysisFactReadError;
      }
      const facts =
        mockState.scenarioAnalysisFactsOverride ??
        (mockState.newestAnalysisFact
          ? [mockState.newestAnalysisFact]
          : mockState.priorFacts.filter(
              (fact) => fact.fact_type === 'run_analysis' && fact.noop !== true,
            ));
      return {
        facts: facts.slice(0, limit).map((fact, index) => {
          const hotIndex = mockState.priorFacts.indexOf(fact);
          return {
            fact,
            fact_row_id:
              hotIndex >= 0
                ? `hot-fact-row-${hotIndex}`
                : `durable-analysis-fact-row-${index}`,
            fact_created_at:
              ((fact.result as Record<string, unknown> | undefined)
                ?.computed_at as string | undefined) ??
              '2026-08-27T09:00:00.000Z',
          };
        }),
        total_count:
          mockState.scenarioAnalysisTotalCountOverride ?? facts.length,
      };
    },
    // Separate claim-safety entitlement carrier remains unchanged by this
    // prompt-authority convergence.
    readNewestAnalysisFactFor: async () => {
      if (mockState.newestAnalysisFactReadError) {
        throw mockState.newestAnalysisFactReadError;
      }
      return mockState.newestAnalysisFact;
    },
    invalidateScoped: async () => {
      mockState.invalidationCalls += 1;
      return {
        scope: { kind: 'structural' as const },
        entries_invalidated: [],
      };
    },
    invalidateAll: async () => {
      mockState.invalidationCalls += 1;
      return {
        scope: { kind: 'structural' as const },
        entries_invalidated: [],
      };
    },
    storeDraftGraph: async () => {
      mockState.storeDraftGraphCalls += 1;
    },
    loadGraph: async () => {
      if (mockState.persistedGraphReadError)
        throw mockState.persistedGraphReadError;
      return mockState.persistedGraph;
    },
    loadGraphAndBriefText: async () => {
      if (mockState.persistedGraphReadError)
        throw mockState.persistedGraphReadError;
      return {
        graph: mockState.persistedGraph,
        briefText: mockState.persistedBriefText,
      };
    },
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const PRIOR_RA_ROW_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const READY_GRAPH = {
  nodes: [
    { id: 'dec_q3', kind: 'decision', label: 'Choose the Q3 resourcing route' },
    { id: 'goal_q3', kind: 'goal', label: 'Q3 Roadmap' },
    { id: 'fac_local_hire', kind: 'factor', label: 'Local Senior Hire Programme' },
    {
      id: 'opt_hire_local',
      kind: 'option',
      label: 'Hire Two Senior Engineers Locally',
      interventions: { fac_local_hire: 1 },
    },
    {
      id: 'opt_status_quo',
      kind: 'option',
      label: 'Continue with Current Team',
      is_baseline: true,
      interventions: { fac_local_hire: 0 },
    },
  ],
  edges: [
    {
      from: 'dec_q3',
      to: 'opt_hire_local',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'dec_q3',
      to: 'opt_status_quo',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_hire_local',
      to: 'fac_local_hire',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_status_quo',
      to: 'fac_local_hire',
      strength: { mean: 0.01, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_local_hire',
      to: 'goal_q3',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
  goal_node_id: 'goal_q3',
};

const READY_GRAPH_HASH = computeAnalysisAffectingGraphHash(READY_GRAPH as never)!;

function stagingShapedAnalysisState(): Record<string, unknown> {
  return {
    analysis_status: 'computed',
    option_comparison: [
      {
        option_id: 'opt_hire_local',
        option_label: 'Hire Two Senior Engineers Locally',
        outcome: { mean: 0.138, p10: -0.144, p90: 0.391 },
        status: 'computed',
        win_probability: 0.638,
      },
      {
        option_id: 'opt_status_quo',
        option_label: 'Continue with Current Team',
        outcome: { mean: 0.002, p10: -0.044, p90: 0.048 },
        status: 'computed',
        win_probability: 0.156,
      },
    ],
    factor_sensitivity: [
      { label: 'Local Senior Hire Programme', elasticity: 0.42, direction: 'positive', influence_score: 0.42 },
      { label: 'Offshore Partner Engagement', elasticity: 0.31, direction: 'negative', influence_score: 0.31 },
    ],
    robustness: {
      level: 'low',
      is_robust: false,
      recommended_option_id: 'opt_hire_local',
      recommended_option_label: 'Hire Two Senior Engineers Locally',
      fragile_edges: [
        {
          from_label: 'Offshore Partner Engagement',
          to_label: 'Onboarding and Integration Drag',
          switch_probability: 0.21,
        },
      ],
    },
    flip_thresholds: [
      {
        factor_id: 'fac_hiring_cost',
        factor_label: 'Hiring and Onboarding Cost',
        flip_value: null,
        current_value: 0,
        value_scale: null,
        margin_sensitivity: { value_scale: 'normalised' },
        direction: 'increase',
        unit: '£',
        cap: null,
      },
    ],
  };
}

function makeFreshRunAnalysisFact(
  enrichment: Record<string, unknown> = stagingShapedAnalysisState()
): Record<string, unknown> {
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire_local',
      summary: 'Prior analysis result',
      // T1 claim safety (ROADMAP 1.233). REQUIRED on any fixture that expects
      // leader-naming prose, and this is a re-point at source, not a baseline
      // bump (TESTING-DISCIPLINE rule 5).
      //
      // The fixture models a COMPLETED analysis, but omitted the field that
      // records whether the user's ratified constraints were checked against
      // it. `readMayNameLeadingOptionFromResult` treats a completed analysis
      // with no verdict as UNKNOWN and fails CLOSED — "unknown" and "verified
      // feasible" are different claims and only the second licenses naming a
      // leader. That default has been in force on the EXECUTE path since #710;
      // 1.233 hoists the read to turn entry, so it now governs the
      // deterministic non-execute composers too (advice gate, run comparison,
      // bounded fallback), which is where this fixture's expectations live.
      //
      // Adding the stamp makes the fixture model what it always meant: a real,
      // constraint-checked, feasible run. Its previous silence was under-
      // specification, and the fact that removing this line turns the
      // leader-naming assertions below red is the mutation check on the 1.233
      // gates — proof they bite, delivered by the pre-existing suite.
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible' as const,
      },
      graph_hash_at_run: READY_GRAPH_HASH,
      computed_at: new Date(Date.now() - 60_000).toISOString(),
      enrichment,
      win_probabilities: { opt_hire_local: 0.638, opt_status_quo: 0.156 },
    },
  };
}

const PRIOR_RUN_ANALYSIS_TURN = {
  id: PRIOR_RA_ROW_ID,
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-run-analysis',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-ra',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 200,
  created_at: new Date(Date.now() - 60_000).toISOString(),
};

function mkPayload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'frame',
    stage: 'analyse',
  };
}

function recordingRoutingAdapter(
  responseText = 'Routed coaching answer.',
) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content: [{ type: 'text', text: responseText }],
        stop_reason: 'end_turn' as const,
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'mock-routing',
        latencyMs: 0,
      })),
  };
}

function capturedRoutingPrompt(
  adapter: ReturnType<typeof recordingRoutingAdapter>
): string {
  const call = adapter.chatWithTools.mock.calls[0]?.[0];
  expect(call, 'the routed turn must reach the model adapter').toBeDefined();
  const user = call!.messages.find((message) => message.role === 'user');
  expect(user, 'the adapter call must contain a user message').toBeDefined();
  return typeof user!.content === 'string'
    ? user!.content
    : JSON.stringify(user!.content);
}

function expectNoCanonicalAuthorityWrite(): void {
  expect(mockState.storeDraftGraphCalls).toBe(0);
  expect(mockState.invalidationCalls).toBe(0);
  expect(
    mockState.appendWrites.length,
    'the ordinary answered turn remains durable'
  ).toBe(1);
  const write = mockState.appendWrites[0]!;
  expect(write.graph).toBeUndefined();
  expect(write.handler_facts).toEqual([]);
  expect(write).not.toHaveProperty('modelVersion');
}
const { runTurnExecutor } = await import('../turn-executor.js');

describe('conversation advice reaches contextual reasoning', () => {
  beforeEach(() => {
    mockState.priorTurns = [{ ...PRIOR_RUN_ANALYSIS_TURN,
      user_message: 'The codebase has technical debt and the team disagrees about its cost.',
      assistant_message: 'That context is available for the next discussion.',
    }];
    mockState.priorFacts = [makeFreshRunAnalysisFact()];
    mockState.priorTurnsTotal = 1;
    mockState.newestAnalysisFact = mockState.priorFacts[0]!;
    mockState.newestAnalysisFactReadError = null;
    mockState.scenarioAnalysisFactsOverride = null;
    mockState.scenarioAnalysisTotalCountOverride = null;
    mockState.persistedGraph = READY_GRAPH;
    mockState.persistedBriefText = null;
    mockState.persistedGraphReadError = null;
    mockState.appendWrites = [];
    mockState.invalidationCalls = 0;
    mockState.storeDraftGraphCalls = 0;
  });

  it.each([
    'We spoke to the team; one senior developer is already acting as lead. What do you think?',
    'What would you do next?',
    'What should I pay attention to?',
    // Original natural questions from the CI contracts remain positive
    // contextual receivers, with one call and inspected no-write persistence.
    "What do I change?",
    "What do we update?",
    "What needs to change?",
    "What needs changing?",
    "What needs to be updated?",
    "Help me figure out what to change.",
    "Help me decide what to update.",
    "Give me a starting point to change.",
    "Give me something to update.",
    "What's worth changing?",
    "What's worth updating?",
    "What should I change?",
    "What should we update?",
    "What should you adjust?",
    "What should we fix?",
    "What should we edit?",
    "What should I do?",
    "What would you recommend?",
    "What should we do next?",
  ])('forwards current and prior qualitative context and preserves the answer: %j', async message => {
    const answer = 'The informal lead may help coordination, but technical debt could still limit delivery. A useful next step is to ask which bottleneck the team sees most often.';
    const adapter = recordingRoutingAdapter(answer);
    const result = await runTurnExecutor(mkPayload(message), 'conversation-advice-receiver', {
      routingAdapter: adapter, graphState: READY_GRAPH as never,
      analysisState: stagingShapedAnalysisState() as never,
    });
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    const prompt = capturedRoutingPrompt(adapter);
    expect(prompt).toContain(message);
    expect(prompt).toContain('technical debt');
    expect(prompt).toContain('team disagrees');
    expect(result.response.assistant_text).toBe(answer);
    expect(result.telemetry.llm_calls_used).toBe(1);
    expectNoCanonicalAuthorityWrite();
  });

  it('keeps an explicit next-step request on its existing deterministic composer', async () => {
    const adapter = recordingRoutingAdapter();
    const result = await runTurnExecutor(mkPayload('What is the next step?'), 'conversation-specific-next-step', {
      routingAdapter: adapter, graphState: READY_GRAPH as never,
      analysisState: stagingShapedAnalysisState() as never,
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.telemetry.llm_calls_used).toBe(0);
    expect(result.response.assistant_text).toContain('What to check next');
    expect(result.response.suggested_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action_type: 'what_would_flip' }),
    ]));
    expectNoCanonicalAuthorityWrite();
  });

  function useCapturedResearchScenario() {
    const graph = GraphStateIngressSchema.parse(nativeResearch.graph);
    expect(computeAnalysisAffectingGraphHash(graph)).toBe(nativeResearch.analysis_result.computed_against_hash);
    mockState.persistedGraph = nativeResearch.graph;
    mockState.persistedBriefText = nativeResearch.brief_text;
    const fact = {
      fact_type: 'run_analysis', fact_version: 1, noop: false,
      result: {
        ...nativeResearch.analysis_result,
        scenario_id: nativeResearch.source.scenario_id,
        graph_hash_at_run: nativeResearch.analysis_result.computed_against_hash,
        computed_at: nativeResearch.analysis_state.run_state.computed_at,
      },
    };
    mockState.priorFacts = [fact];
    mockState.newestAnalysisFact = fact;
    mockState.priorTurns = [{ ...PRIOR_RUN_ANALYSIS_TURN,
      scenario_id: nativeResearch.source.scenario_id,
      user_message: 'Run analysis', assistant_message: nativeResearch.analysis_result.summary,
    }];
    // The captured native request supplied neither graph_state nor analysis_state.
    // Exercise the real persisted-graph and selected-fact fallback, not UI ingress.
    return {};
  }

  it.each([
    nativeResearch.message,
    'Given our limited data-team capacity, what evidence should we gather first? I want to weigh the practical options before deciding on a change.',
  ])('receives captured scientific state and qualitative research context: %j', async message => {
    const state = useCapturedResearchScenario();
    const answer = 'Research discussion from the receiving adapter, not a sensitivity template.';
    const adapter = recordingRoutingAdapter(answer);
    const result = await runTurnExecutor({ ...mkPayload(message), scenario_id: nativeResearch.source.scenario_id }, 'captured-contextual-research', {
      routingAdapter: adapter, ...state,
    });
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    const prompt = capturedRoutingPrompt(adapter);
    expect(prompt).toContain(message);
    expect(prompt).toContain('two-person data team');
    expect(prompt).toContain('Saved example: Customer Data Platform Selection');
    expect(prompt).toContain(JSON.stringify(nativeResearch.brief_text));
    expect(prompt).toContain('Migration and Integration Effort');
    expect(prompt).toContain('Data Team Capacity');
    expect(result.response.assistant_text).toBe(answer);
    expect(result.telemetry.llm_calls_used).toBe(1);
    expectNoCanonicalAuthorityWrite();
  });

  it('keeps the captured discussion read-only even if the receiving model proposes an explicit factor write', async () => {
    const state = useCapturedResearchScenario();
    const adapter = recordingRoutingAdapter();
    adapter.chatWithTools.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'unrequested-research-edit', name: OLUMI_ACTION_TOOL_NAME, input: {
        intent_class: 'execute', action: {
          handler_id: 'set_factor_value',
          entity: { id: 'fac_data_team_capacity', kind: 'node', label: 'Data Team Capacity', resolution_status: 'resolved', resolution_method: 'label_match' },
          parameters: [{ name: 'value', value: { value: 0.7 }, source: 'user_explicit' }],
          cited_context_fields: [],
        },
      } }],
      stop_reason: 'tool_use', usage: { input_tokens: 5, output_tokens: 5 }, model: 'mock-routing', latencyMs: 0,
    });
    const result = await runTurnExecutor({ ...mkPayload(nativeResearch.message), scenario_id: nativeResearch.source.scenario_id }, 'captured-research-no-consent', {
      routingAdapter: adapter, ...state,
    });
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(result.response.blocks.some(block => block.type === 'graph_patch')).toBe(false);
    expect(result.response.assistant_text).toContain('Nothing has been changed.');
    expect(result.response.assistant_text).toContain('confirm this with you before I edit the model');
    expectNoCanonicalAuthorityWrite();
  });

  it('keeps a narrow captured-model research query useful without promoting sensitivity to evidence value', async () => {
    useCapturedResearchScenario();
    const adapter = recordingRoutingAdapter();
    const result = await runTurnExecutor({ ...mkPayload('What should we investigate?'), scenario_id: nativeResearch.source.scenario_id }, 'captured-narrow-research', {
      routingAdapter: adapter,
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.response.assistant_text).toContain('Migration and Integration Effort');
    expect(result.response.assistant_text).toContain('Sensitivity alone does not establish where research would be most valuable');
    expectNoCanonicalAuthorityWrite();
  });

  it('positive control: the same captured factor can be changed by an explicit numeric instruction', async () => {
    const state = useCapturedResearchScenario();
    await runTurnExecutor({ ...mkPayload('Set Data Team Capacity to 0.7.'), scenario_id: nativeResearch.source.scenario_id }, 'captured-research-explicit-edit', {
      routingAdapter: recordingRoutingAdapter(), ...state,
    });
    const graphWrites = mockState.appendWrites.filter(write => write.graph !== undefined);
    expect(graphWrites).toHaveLength(1);
    const graph = GraphStateIngressSchema.parse(graphWrites[0]!.graph);
    expect(graph.nodes.find(node => node.id === 'fac_data_team_capacity')).toEqual(expect.objectContaining({
      observed_state: expect.objectContaining({ value: 0.7 }),
    }));
  });
});
