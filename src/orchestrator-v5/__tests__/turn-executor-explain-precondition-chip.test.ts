/**
 * Wire-level integration: TurnExecutor — `explain_results` precondition-fail
 * MUST emit an executable "Run analysis" chip on the final OlumiResponse.
 *
 * Test B from the answer-carrying staging verification reported chip count
 * was 0 in the response envelope. The handler-level integration test in
 * `tools/handlers/__tests__/integration-precondition-fail-chip.test.ts`
 * wires handler + generateChips directly; this test drives the full
 * `runTurnExecutor` pipeline (routing → handler → compose → finaliser) and
 * asserts the chip survives all the way to `response.suggested_actions`.
 *
 * Pattern follows `turn-executor-handler.test.ts` and `turn-executor.test.ts`:
 * the routing adapter is mocked to emit an explain_results tool call, the
 * graph is supplied via `graphState` so `computeStructuralReadiness` can
 * return `status: 'ready'`, and the session store is mocked to return no
 * prior facts so the handler hits the precondition-fail path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

import { makeMessagePayload } from './fixtures.js';

import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';

// Session-store mock returns no prior facts so explain_results lands on
// the precondition-fail path. Includes `loadGraph` / `ensureScenarioExists`
// so build-turn-context's loadPersistedGraph fallback does not log a
// `store.loadGraph is not a function` warning. Hoisted via vi.mock before
// importing turn-executor.
vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({
      scope,
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

import type { PLoTClient } from '../../orchestrator/plot-client.js';
import type { RunAnalysisScenarioSnapshot } from '../tools/handlers/run-analysis.js';

const { runTurnExecutor } = await import('../turn-executor.js');
const { createRegistry } = await import('../tools/registry.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const TEST_SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// Message must NOT match the analytical-intent classifier or any
// advice-gate pattern — otherwise the no-analysis-guard / advice gate
// would intercept the turn before Sonnet's tool_use mock fires and the
// precondition-fail chip-surfacing path under test would never execute.
// The grounded-fresh-analysis workstream broadened the classifier's
// `what_drove` predicate to include "leading", so the previous message
// "Why is the leading option winning?" is no longer a safe carrier here.
// "Tell me about the model" deliberately stays outside both the advice
// gate's CLASS_PATTERNS and the classifier's INTENT_PATTERNS so the turn
// reaches Sonnet, which the routing adapter mock then steers into the
// explain_results / what_would_flip tool_use proposal that this test
// exercises.
const BASE_PAYLOAD = makeMessagePayload({
  turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  scenario_id: TEST_SCENARIO_ID,
  message: 'Tell me about the model',
  turn_class: 'decide',
  stage: 'analyse',
});

// Graph satisfying GraphV3 strict parse + computeStructuralReadiness:
// goal node + 2 options, each with numeric interventions on the
// node-level `interventions` field. Edges use the canonical
// `{ strength: { mean, std }, exists_probability, effect_direction }`
// shape so GraphV3.safeParse succeeds and `analysisReadyForTurn` is
// computed (otherwise it remains undefined and the chip rule cannot fire).
const READY_GRAPH = {
  nodes: [
    { id: 'goal_q3', kind: 'goal', label: 'Goal' },
    { id: 'fac_capacity', kind: 'factor', label: 'Engineering Capacity' },
    {
      id: 'opt_hire',
      kind: 'option',
      label: 'Hire Two Senior Engineers Locally',
      interventions: { fac_capacity: 1 },
    },
    {
      id: 'opt_status_quo',
      kind: 'option',
      label: 'Maintain Current Team',
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
};

function buildToolInput(handlerId: 'explain_results' | 'what_would_flip') {
  return {
    intent_class: 'execute',
    action: {
      handler_id: handlerId,
      entity: {
        id: 'goal_q3',
        kind: 'goal',
        label: 'Goal',
        resolution_status: 'resolved',
        resolution_method: 'context_inference',
      },
      parameters: [],
      cited_context_fields: ['analysis.leading_option'],
      explanation: {
        // Long enough to clear the validator's 80-char floor and free of
        // forbidden / mutation terms — the answer-text is irrelevant on the
        // precondition path (handler renders the template), but a clean
        // payload removes any side-band-rejection confound from the test.
        answer_text:
          'Looking at the leading option, the strongest direct driver in the model is Engineering Capacity which connects to the goal. Walking the structure first will explain the result.',
      },
    },
  };
}

function mkToolUse(handlerId: 'explain_results' | 'what_would_flip'): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: `tu-${handlerId}`,
      name: OLUMI_ACTION_TOOL_NAME,
      input: buildToolInput(handlerId) as Record<string, unknown>,
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function makeReadyScenarioSnapshot(): RunAnalysisScenarioSnapshot {
  return {
    graph: READY_GRAPH,
    options: [
      { id: 'opt_hire', option_id: 'opt_hire', label: 'Hire Two Senior Engineers Locally', interventions: { fac_capacity: 1 } },
      { id: 'opt_status_quo', option_id: 'opt_status_quo', label: 'Maintain Current Team', interventions: { fac_capacity: 0 } },
    ],
    goal_node_id: 'goal_q3',
  };
}

function makeMockPlotClient(): PLoTClient {
  return {
    run: vi.fn(),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
}

function mockRoutingAdapter(impl: () => Promise<ChatWithToolsResult>) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(impl as never),
  };
}

let events: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
});

describe('turn-executor × explanation precondition-fail — wire-level chip surfacing (Test B)', () => {
  it('explain_results: drives runTurnExecutor end-to-end → final OlumiResponse.suggested_actions contains executable run_analysis chip', async () => {
    const routingAdapter = mockRoutingAdapter(async () => mkToolUse('explain_results'));
    const registry = createRegistry({
      plotClient: makeMockPlotClient(),
      scenarioReader: async () => makeReadyScenarioSnapshot(),
    });

    const { response, telemetry } = await runTurnExecutor(
      BASE_PAYLOAD,
      'req-explain-precondition',
      {
        routingAdapter,
        handlerRegistry: registry,
        graphState: READY_GRAPH,
      },
    );

    // Wire-shape sanity: response is a valid OlumiResponse.
    OlumiResponseSchema.parse(response);
    expect(telemetry.failure_type).toBeNull();

    // The headline assertion: the chip survives all the way to the wire.
    const runAnalysisChip = response.suggested_actions.find(
      (a: { action_type?: string }) => a.action_type === 'run_analysis',
    );
    expect(runAnalysisChip).toBeDefined();
    expect(runAnalysisChip).toMatchObject({
      id: 'chip_action_run_analysis',
      action_type: 'run_analysis',
      label: 'Run analysis',
    });
  });

  it('what_would_flip: drives runTurnExecutor end-to-end → final OlumiResponse.suggested_actions contains executable run_analysis chip', async () => {
    // Brief task 2 explicitly names both handlers for envelope-level
    // coverage. The chip rule reads from the typed handler-fact union,
    // and what_would_flip emits its own ExplainResultsHandlerFact-shaped
    // signal on the precondition-fail path. Wire-level symmetry test.
    const routingAdapter = mockRoutingAdapter(async () => mkToolUse('what_would_flip'));
    const registry = createRegistry({
      plotClient: makeMockPlotClient(),
      scenarioReader: async () => makeReadyScenarioSnapshot(),
    });

    const { response, telemetry } = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'What would change the outcome?' },
      'req-flip-precondition',
      {
        routingAdapter,
        handlerRegistry: registry,
        graphState: READY_GRAPH,
      },
    );

    OlumiResponseSchema.parse(response);
    expect(telemetry.failure_type).toBeNull();

    const runAnalysisChip = response.suggested_actions.find(
      (a: { action_type?: string }) => a.action_type === 'run_analysis',
    );
    expect(runAnalysisChip).toBeDefined();
    expect(runAnalysisChip).toMatchObject({
      id: 'chip_action_run_analysis',
      action_type: 'run_analysis',
      label: 'Run analysis',
    });
  });
});
