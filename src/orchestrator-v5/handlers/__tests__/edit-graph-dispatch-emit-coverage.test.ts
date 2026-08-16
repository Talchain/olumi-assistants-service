/**
 * R7 (NB-1) — assembly-region exactly-once coverage.
 *
 * An unexpected throw in the response-assembly region (between the handler-throw
 * catch and the commit-try) must still emit exactly one v5.edit_graph.turn event
 * before the exception propagates, and a telemetry fault must never mask that
 * original exception. Also pins no-double-emit on the normal success path (which
 * now passes through both the inner commit-`finally` and the new outer `finally`).
 *
 * The assembly throw is injected via buildCanonicalAnalysisReadyFromGraph (called at the
 * tail of the assembly region, only on a successful applied mutation).
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));
vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({}),
}));

// V5-PERSIST-FIX-01: stub ONLY the strict persisted read so applied
// mutations do not fail closed against the unconfigured test store.
// `null` = a genuinely-empty scenarios.graph → ingress-base fallback merge,
// i.e. the same (request-graph) base these tests used before the fix.
// Everything else in build-turn-context stays real.
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
  };
});
vi.mock('../../../adapters/llm/prompt-loader.js', () => ({
  getSystemPromptMeta: vi.fn(() => ({
    taskId: 'edit_graph',
    source: 'store',
    promptId: 'edit_graph_default',
    version: 9,
    prompt_version: 'edit_graph_default@v9',
    prompt_hash: '313665a4',
  })),
}));
// The injection point: throw from the assembly tail.
vi.mock('../../../orchestrator/tools/analysis-ready-helper.js', () => ({
  buildCanonicalAnalysisReadyFromGraph: vi.fn(),
}));

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { setTestSink } from '../../../utils/telemetry.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUB_REQUEST = {} as FastifyRequest;

const INGRESS_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
  ],
  edges: [{ from: 'dec_launch', to: 'goal_revenue' }],
};

const POST_EDIT_GRAPH = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_marketing', kind: 'factor', label: 'Marketing' },
  ],
  edges: [
    { from: 'fac_marketing', to: 'goal_revenue', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
  ],
} as unknown as EditGraphResult['appliedGraph'];

function makeAppliedResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Edge strength increased.',
    latencyMs: 1200,
    appliedGraph: POST_EDIT_GRAPH,
    wasRejected: false,
    operations: [{ op: 'update_edge', path: 'fac_marketing->goal_revenue', value: 0.7 }] as unknown as EditGraphResult['operations'],
  };
}

const hg = handleEditGraph as MockedFunction<typeof handleEditGraph>;
const commit = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
const buildCanonical = buildCanonicalAnalysisReadyFromGraph as MockedFunction<
  typeof buildCanonicalAnalysisReadyFromGraph
>;
let events: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  commit.mockResolvedValue({ response: {}, performed: true, persisted_row_id: 'r', graphPersisted: true } as Awaited<ReturnType<typeof commitDirectAnswer>>);
  buildCanonical.mockReturnValue(
    undefined as unknown as ReturnType<typeof buildCanonicalAnalysisReadyFromGraph>,
  );
  events = [];
  setTestSink((event, data) => events.push({ event, data }));
});
afterEach(() => setTestSink(null));

function turnEvents() {
  return events.filter((e) => e.event === 'v5.edit_graph.turn');
}
async function run() {
  return dispatchEditGraph({
    payload: { kind: 'message' as const, scenario_id: SCENARIO_ID, turn_id: TURN_ID, stage: 'analyse' as const, message: 'Strengthen the edge', turn_class: 'frame' as const, source: 'composer' as const },
    requestId: 'req-cov',
    request: STUB_REQUEST,
    graphState: INGRESS_GRAPH,
    analysisState: null,
  });
}

describe('R7 NB-1 — assembly-region exactly-once', () => {
  it('emits exactly one event AND propagates the original error when the assembly region throws', async () => {
    hg.mockResolvedValue(makeAppliedResult());
    const boom = new Error('readiness boom');
    buildCanonical.mockImplementation(() => { throw boom; });

    await expect(run()).rejects.toBe(boom); // original exception surfaces unmasked
    const te = turnEvents();
    expect(te).toHaveLength(1); // outer finally fired exactly once
    // The mutation itself succeeded; the crash was in post-mutation assembly.
    expect(te[0]!.data.outcome).toBe('success');
    expect(commit).not.toHaveBeenCalled(); // never reached the commit
  });

  it('a telemetry fault during the assembly-throw emit still cannot mask the original error', async () => {
    hg.mockResolvedValue(makeAppliedResult());
    const boom = new Error('readiness boom');
    buildCanonical.mockImplementation(() => { throw boom; });
    setTestSink((event) => { if (event === 'v5.edit_graph.turn') throw new Error('telemetry boom'); });

    // The ORIGINAL assembly error must surface, not 'telemetry boom'.
    await expect(run()).rejects.toBe(boom);
  });

  it('normal success path emits exactly once across both finallys (no double-emit)', async () => {
    hg.mockResolvedValue(makeAppliedResult());
    buildCanonical.mockReturnValue(
      undefined as unknown as ReturnType<typeof buildCanonicalAnalysisReadyFromGraph>,
    );
    const result = await run();
    expect(result.commitPerformed).toBe(true);
    expect(turnEvents()).toHaveLength(1); // inner finally emits; outer finally is a guarded no-op
  });
});
