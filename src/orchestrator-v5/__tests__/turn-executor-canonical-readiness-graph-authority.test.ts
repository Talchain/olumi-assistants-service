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
 * This drives a real execute turn where the persisted graph contains an
 * unreachable controllable factor (`needs_user_mapping`) while the request
 * graph has two fully configured options (`ready`). Both the diagnostic state
 * and the served readiness must follow the persisted graph; the stale request
 * must not reopen Run admission.
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

const INTERVENTION_EDGE = {
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 1,
  effect_direction: 'positive' as const,
};

function intervention(value: number) {
  return {
    value,
    source: 'user_specified' as const,
    target_match: {
      node_id: 'f1',
      match_type: 'exact_id' as const,
      confidence: 'high' as const,
    },
  };
}

// Request graph: 2 configured options → canonical status is ready.
const REQUEST_2OPT: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Profit' },
    { id: 'dec_1', kind: 'decision', label: 'Choose an option' },
    { id: 'opt_a', kind: 'option', label: 'A' },
    { id: 'opt_b', kind: 'option', label: 'B' },
    { id: 'f1', kind: 'factor', label: 'Execution quality', category: 'controllable' },
  ],
  edges: [
    { from: 'dec_1', to: 'opt_a', ...INTERVENTION_EDGE },
    { from: 'dec_1', to: 'opt_b', ...INTERVENTION_EDGE },
    { from: 'opt_a', to: 'f1', ...INTERVENTION_EDGE },
    { from: 'opt_b', to: 'f1', ...INTERVENTION_EDGE },
    { from: 'f1', to: 'goal_1', ...INTERVENTION_EDGE },
  ],
  options: [
    { id: 'opt_a', label: 'A', status: 'ready', interventions: { f1: intervention(1) } },
    { id: 'opt_b', label: 'B', status: 'ready', interventions: { f1: intervention(0) } },
  ],
} as GraphStateIngress;

// Persisted graph advanced beyond the client: an additional controllable
// factor reaches the goal but no option reaches it. The canonical producer
// classifies this as needs_user_mapping; the legacy graph-only algorithm did
// not, which is the load-bearing authority discriminator.
const PERSISTED_UNREACHABLE_FACTOR: GraphStateIngress = {
  ...REQUEST_2OPT,
  nodes: [
    ...REQUEST_2OPT.nodes,
    { id: 'f2', kind: 'factor', label: 'Delivery capacity', category: 'controllable' },
  ],
  edges: [
    ...REQUEST_2OPT.edges,
    { from: 'f2', to: 'goal_1', ...INTERVENTION_EDGE },
  ],
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

  it('stale client: canonical state and wire readiness both follow the persisted graph', async () => {
    const stale = await run(PERSISTED_UNREACHABLE_FACTOR, 'req-graph-authority-stale');
    const control = await run(REQUEST_2OPT, 'req-graph-authority-control');

    // Served readiness follows persisted bytes, not the identical request graph.
    expect(stale.analysisReady?.status).toBe('needs_user_mapping');
    expect(control.analysisReady?.status).toBe('ready');

    // Diagnostic canonical state: readiness comes from the PERSISTED graph.
    // The same status authority now owns both diagnostic and wire projections.
    expect(stale.canonicalState?.status).toBe('needs_user_mapping');
    expect(control.canonicalState?.status).toBe('ready');

    // A stale request cannot reintroduce a user-visible Run action.
    expect(JSON.stringify(stale.response.suggested_actions ?? [])).not.toMatch(/run(?: the)? analysis/i);
  });
});
