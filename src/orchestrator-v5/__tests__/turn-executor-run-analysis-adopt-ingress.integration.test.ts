/**
 * #343 CEE half — ROUTED run_analysis adopts a valid ingress graph when no
 * model is persisted, and STEP 7 persists it atomically with the turn commit.
 *
 * Drives the REAL `runTurnExecutor` end-to-end (session store mocked at the
 * module seam, Sonnet routing mocked to a run_analysis tool call, PLoT mocked
 * at the transport). The handler registry is built with the REAL
 * `createRegistry` + the REAL run_analysis handler; the scenarioReader is the
 * REAL `loadScenarioSnapshotForRunAnalysis` (production forwarding shape).
 *
 * Pins:
 *   1. GO: null persisted + ingress graph_state → the commit's
 *      `SessionTurnWrite.graph` is the adopted canonical graph AND the
 *      wire-bound freshness for the turn reads FRESH (run-hash consistency).
 *   2. Kill-switch OFF: byte-parity with today — recoverable "draft a model
 *      first" turn, no graph write.
 *   3. TOCTOU withhold: a graph appears between the handler's strict read and
 *      STEP 7's re-verify → the turn commits WITHOUT the graph.
 *   4. Fail closed: a degraded STEP 7 re-verify aborts the commit
 *      (STATE_COMMIT_FAILED), zero rows appended — graph-bearing commits are
 *      never taken on an unverifiable base (same rule as V5-D1-SHAPE-01).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import { config } from '../../config/index.js';

type Dict = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Stateful session-store mock (same pattern as
// turn-executor-d1-mutation-commit-graph.test.ts). `loadGraphAndBriefText`
// feeds the handler's strict pre-read; `loadGraph` feeds STEP 7's strict
// re-verify — separately armable so the TOCTOU case can diverge them.
// ---------------------------------------------------------------------------
interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  handler_facts?: unknown;
}
const appendCalls: AppendWrite[] = [];
let preLoadGraph: unknown = null;
let reVerifyGraph: unknown = null;
let reVerifyError: Error | null = null;
const loadGraphCalls: unknown[] = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async (scenarioId: unknown) => {
      loadGraphCalls.push(scenarioId);
      if (reVerifyError) throw reVerifyError;
      return reVerifyGraph;
    },
    loadGraphAndBriefText: async () => ({ graph: preLoadGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');
const { createRegistry } = await import('../tools/registry.js');
const { loadScenarioSnapshotForRunAnalysis } = await import('../build-turn-context.js');
const { GraphStateIngressSchema } = await import('../boundary/request-extensions.js');

const SCENARIO_ID = '49769b89-37c7-4c98-a278-4e389fa1cfc1';

function payload(turnId: string) {
  return makeMessagePayload({
    kind: 'message',
    source: 'composer',
    turn_id: turnId,
    scenario_id: SCENARIO_ID,
    message: 'Run the analysis on my model.',
    turn_class: 'decide',
    stage: 'analyse',
  });
}

function makeIngressGraph(): Dict {
  return {
    goal_node_id: 'goal_1',
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Maximise outcome', goal_threshold: 0.5 },
      { id: 'dec_1', kind: 'decision', label: 'Choose approach' },
      { id: 'fac_annual_cost', kind: 'factor', label: 'Annual cost', observed_state: { value: 0.6, unit: '£', cap: 150000 } },
      { id: 'opt_hybrid', kind: 'option', label: 'Hybrid', interventions: { fac_annual_cost: { value: 0.8, source: 'user_specified' } } },
      { id: 'opt_status_quo', kind: 'option', label: 'Status quo', is_baseline: true, interventions: {} },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_hybrid', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'dec_1', to: 'opt_status_quo', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'opt_hybrid', to: 'fac_annual_cost', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'opt_status_quo', to: 'fac_annual_cost', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'fac_annual_cost', to: 'goal_1', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
    ],
  };
}

function buildRunAnalysisToolInput() {
  return {
    intent_class: 'execute',
    action: {
      handler_id: 'run_analysis',
      entity: {
        id: 'opt_hybrid',
        kind: 'option',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [],
      cited_context_fields: ['graph.options'],
    },
  };
}
function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    { type: 'tool_use', id: 'tu-1', name: OLUMI_ACTION_TOOL_NAME, input: input as Record<string, unknown> },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 5,
  };
}
function mockAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(mkToolUseResult(buildRunAnalysisToolInput())),
  };
}

const PLOT_OK = {
  analysis_status: 'computed',
  results: [
    { option_id: 'opt_hybrid', option_label: 'Hybrid', win_probability: 0.6 },
    { option_id: 'opt_status_quo', option_label: 'Status quo', win_probability: 0.4 },
  ],
  response_hash: 'hash_x',
  meta: { seed_used: 1 },
};
const plotRunCalls = { n: 0 };
function makeRegistry() {
  return createRegistry({
    plotClient: {
      run: async () => { plotRunCalls.n += 1; return PLOT_OK; },
    } as never,
    // Production forwarding shape: (scenarioId, signal, ingressGraph) →
    // loadScenarioSnapshotForRunAnalysis(..., ingressGraph). Store defaults to
    // getSessionStore(), i.e. the module mock above — the strict reads are real.
    scenarioReader: (scenarioId: string, _signal?: AbortSignal, ingressGraph?: unknown) =>
      loadScenarioSnapshotForRunAnalysis(scenarioId, 'req-reader', undefined, ingressGraph),
  });
}

async function runAnalysisTurn(requestId: string, turnId: string) {
  return runTurnExecutor(payload(turnId), requestId, {
    routingAdapter: mockAdapter(),
    graphState: makeIngressGraph() as never,
    handlerRegistry: makeRegistry(),
  });
}

beforeEach(() => {
  setTestSink(() => {});
  appendCalls.length = 0;
  loadGraphCalls.length = 0;
  preLoadGraph = null;
  reVerifyGraph = null;
  reVerifyError = null;
  plotRunCalls.n = 0;
  // Flag now defaults OFF (dark); arm it explicitly per-test.
  (config.cee as { runAnalysisAdoptIngressGraph: boolean }).runAnalysisAdoptIngressGraph = true;
});
afterEach(() => {
  setTestSink(null);
  (config.cee as { runAnalysisAdoptIngressGraph: boolean }).runAnalysisAdoptIngressGraph = false;
  vi.restoreAllMocks();
});

describe('#343 adopt-on-empty — routed run_analysis (TurnExecutor STEP 7 persistence)', () => {
  it('GO: null persisted + ingress graph_state → analysis runs, the commit persists the adopted canonical graph, freshness reads FRESH', async () => {
    const result = await runAnalysisTurn('req-adopt-routed', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21');

    expect(plotRunCalls.n).toBe(1);
    expect(result.response.assistant_text ?? '').not.toContain('Draft or save a model first');

    const write = appendCalls.at(-1)!;
    expect(write.handler_id).toBe('run_analysis');
    expect(write.graph).toBeDefined();
    const parsed = GraphStateIngressSchema.safeParse(write.graph);
    expect(parsed.success).toBe(true);
    expect((parsed.data!.nodes as Dict[]).some((n) => n.id === 'goal_1')).toBe(true);

    // Run-hash consistency (brief §6 shape): the just-analysed turn reads
    // fresh, not stale — the fact's hash and the current-graph hash agree.
    expect(result.freshness?.freshness).toBe('fresh');

    // STEP 7 re-verified the base keyed by the SCENARIO id.
    expect(loadGraphCalls).toContain(SCENARIO_ID);
  });

  it('kill-switch OFF: byte-parity with today — recoverable draft-a-model-first turn, no graph write, zero PLoT', async () => {
    (config.cee as { runAnalysisAdoptIngressGraph: boolean }).runAnalysisAdoptIngressGraph = false;

    const result = await runAnalysisTurn('req-adopt-off', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22');

    expect(plotRunCalls.n).toBe(0);
    expect(result.response.assistant_text ?? '').toContain('Draft or save a model first');
    for (const write of appendCalls) {
      expect(write.graph == null).toBe(true);
    }
  });

  it('TOCTOU withhold: a graph appears before STEP 7 re-verify → the turn commits WITHOUT the adopted graph', async () => {
    reVerifyGraph = makeIngressGraph(); // concurrent writer landed a graph

    const result = await runAnalysisTurn('req-adopt-toctou', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa23');

    expect(plotRunCalls.n).toBe(1);
    expect(result.response.assistant_text ?? '').not.toContain('Draft or save a model first');
    const write = appendCalls.at(-1)!;
    expect(write.handler_id).toBe('run_analysis');
    expect(write.graph == null).toBe(true);
  });

  it('fail closed: degraded STEP 7 re-verify aborts the commit (STATE_COMMIT_FAILED), zero rows appended', async () => {
    reVerifyError = new Error('session store unreachable');

    const { response } = await runAnalysisTurn('req-adopt-degraded', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa24');

    expect(appendCalls).toHaveLength(0);
    const errorBlock = (
      response.blocks as Array<{ type: string; error_code?: string; details?: Dict }>
    ).find((b) => b.type === 'error');
    expect(errorBlock).toBeDefined();
    expect(errorBlock!.error_code).toBe('INTERNAL_ERROR');
    expect(errorBlock!.details).toMatchObject({ retryable: true, phase: 'commit' });
  });
});
