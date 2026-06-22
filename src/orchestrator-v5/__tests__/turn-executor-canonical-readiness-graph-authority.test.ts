/**
 * V5 M5 — canonical-state graph-authority regression.
 *
 * Under client lag the freshness hash comes from the canonical PERSISTED graph
 * (H3 stale-aware logic), while the request graph can be older. The M5 canonical
 * state must derive its READINESS from the SAME graph authority as its freshness
 * — NOT the request-derived `analysisReadyForTurn` — so the diagnostic cannot
 * report e.g. `ready` (from a stale client graph) against a persisted graph that
 * now needs input.
 *
 * This drives a real execute turn where the persisted graph (1 option →
 * needs_user_input) and the request graph (2 options → not needs_user_input)
 * disagree, and asserts ONLY the diagnostic canonical state reflects the
 * persisted graph; the wire `analysisReady` + prose + suggested_actions stay
 * request-driven (unchanged vs a persisted==request control).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import type { HandlerFn, HandlerRegistry } from '../tools/registry.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => (global as Record<string, unknown>).__test_persisted_graph ?? null,
    loadGraphAndBriefText: async () => ({
      graph: (global as Record<string, unknown>).__test_persisted_graph ?? null,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => {
    delete (global as Record<string, unknown>).__test_persisted_graph;
  },
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BASE_PAYLOAD = makeMessagePayload({
  turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  scenario_id: SCENARIO_ID,
  message: 'run the analysis',
  turn_class: 'decide',
  stage: 'analyse',
});

const PROPOSAL_RUN_ANALYSIS = {
  intent_class: 'execute',
  action: {
    handler_id: 'run_analysis',
    entity: { id: 'opt_a', kind: 'option', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [],
    cited_context_fields: [],
  },
};

// Request graph: 2 options → analysisReadyForTurn is NOT needs_user_input.
const REQUEST_2OPT: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Profit' },
    { id: 'opt_a', kind: 'option', label: 'A' },
    { id: 'opt_b', kind: 'option', label: 'B' },
  ],
  edges: [],
  options: [
    { id: 'opt_a', status: 'ready', interventions: { f1: { value: 1 } } },
    { id: 'opt_b', status: 'ready', interventions: { f1: { value: 0 } } },
  ],
} as GraphStateIngress;

// Persisted graph (client lagged behind a delete): only 1 option →
// computeStructuralReadiness → needs_user_input.
const PERSISTED_1OPT: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Profit' },
    { id: 'opt_a', kind: 'option', label: 'A' },
  ],
  edges: [],
  options: [{ id: 'opt_a', status: 'ready', interventions: { f1: { value: 1 } } }],
} as GraphStateIngress;

function runAnalysisFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Ran the analysis on your scenario.',
      computed_at: '2026-04-30T01:00:00.000Z',
      enrichment: { analysis_status: 'completed' },
      win_probabilities: { opt_a: 0.62, opt_b: 0.38 },
    },
  } as HandlerFact;
}

function makeSuccessRegistry(): HandlerRegistry {
  const handler: HandlerFn = async () => ({
    assistant_text: 'Ran the analysis on your scenario.',
    handler_facts: [runAnalysisFact()],
    llm_calls_used: 0,
  });
  return new Map([['run_analysis', handler]]);
}

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    { type: 'text', text: 'Routing…' },
    { type: 'tool_use', id: 'tu-1', name: OLUMI_ACTION_TOOL_NAME, input: input as Record<string, unknown> },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function mockRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation((async () => mkToolUseResult(PROPOSAL_RUN_ANALYSIS)) as never),
  };
}

async function run(persisted: GraphStateIngress, reqId: string) {
  (global as Record<string, unknown>).__test_persisted_graph = persisted;
  return runTurnExecutor(BASE_PAYLOAD, reqId, {
    routingAdapter: mockRoutingAdapter(),
    handlerRegistry: makeSuccessRegistry(),
    graphState: REQUEST_2OPT,
  });
}

describe('TurnExecutor — canonical readiness uses the freshness graph authority (M5)', () => {
  beforeEach(() => setTestSink(() => {}));
  afterEach(() => {
    setTestSink(null);
    delete (global as Record<string, unknown>).__test_persisted_graph;
    vi.restoreAllMocks();
  });

  it('stale client: canonical state reflects PERSISTED readiness; wire analysisReady stays request-driven', async () => {
    const stale = await run(PERSISTED_1OPT, 'req-graph-authority-stale');
    const control = await run(REQUEST_2OPT, 'req-graph-authority-control');

    // Wire/chip authority (request graph, 2 options) is NOT needs_user_input
    // in BOTH runs — request graph is identical.
    expect(stale.analysisReady?.status).not.toBe('needs_user_input');
    expect(control.analysisReady?.status).not.toBe('needs_user_input');
    expect(stale.analysisReady?.status).toBe(control.analysisReady?.status);

    // Diagnostic canonical state: readiness comes from the PERSISTED graph.
    // Stale run (1-option persisted) → needs_user_input; control (2-option
    // persisted == request) → NOT needs_user_input. This is THE fix: the
    // canonical state no longer pairs the persisted-graph hash with the
    // request-derived readiness.
    expect(stale.canonicalState?.status).toBe('needs_user_input');
    expect(control.canonicalState?.status).not.toBe('needs_user_input');

    // Read-only: ONLY the diagnostic differs. Prose + actions (request-driven)
    // are identical across the two runs.
    expect(stale.response.assistant_text).toBe(control.response.assistant_text);
    expect(JSON.stringify(stale.response.suggested_actions)).toBe(
      JSON.stringify(control.response.suggested_actions),
    );
  });
});
