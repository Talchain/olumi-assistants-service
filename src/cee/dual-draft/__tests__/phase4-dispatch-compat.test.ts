/**
 * Phase 4 — dispatch-level immediate-analysis compatibility proofs.
 *
 * Proves the seam invariants the activation gate depends on, WITHOUT
 * activating anything (adapters and commit mocked; enricher mocked to return
 * a merged graph):
 *   - the merged graph is committed ONCE, atomically, and it is the SAME
 *     object the response's draft_graph field and the dispatch-result graph
 *     reference — no stale or intermediate graph state exists anywhere;
 *   - the analysis-affecting graph hash (the freshness source run_analysis
 *     compares against on later turns) is computed from the MERGED graph,
 *     not the M1 graph — uses the REAL graph-hash module (read-only import,
 *     same module the dispatch uses).
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';

const flag = vi.hoisted(() => ({ enabled: true }));

vi.mock('../../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/index.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      features: {
        ...actual.config.features,
        get v6DualDraftEnabled() {
          return flag.enabled;
        },
      },
    },
  };
});
vi.mock('../../../orchestrator/tools/draft-graph.js', () => ({
  handleDraftGraph: vi.fn(),
}));
vi.mock('../../../orchestrator-v5/commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});
vi.mock('../index.js', () => ({
  enrichDraftGraph: vi.fn(),
}));

import { dispatchDraftGraph } from '../../../orchestrator-v5/handlers/draft-graph-dispatch.js';
import { handleDraftGraph } from '../../../orchestrator/tools/draft-graph.js';
import { commitDirectAnswer } from '../../../orchestrator-v5/commit.js';
import { emit, TelemetryEvents } from '../../../utils/telemetry.js';
import { enrichDraftGraph } from '../index.js';
// REAL graph-hash module — the same one the dispatch calls. Read-only import.
import { computeAnalysisAffectingGraphHash } from '../../../orchestrator-v5/context/graph-hash.js';
import type { GraphStateIngress } from '../../../orchestrator-v5/boundary/request-extensions.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUB_REQUEST = {} as FastifyRequest;

const M1_GRAPH = {
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'opt_launch', kind: 'option', label: 'Launch now', interventions: { fac_price: 0.8 } },
    { id: 'opt_wait', kind: 'option', label: 'Wait 6 months', interventions: { fac_price: 0.2 } },
    { id: 'fac_price', kind: 'factor', label: 'Price point' },
  ],
  edges: [
    {
      from: 'fac_price',
      to: 'goal_revenue',
      strength: { mean: 0.6, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
};

const MERGED_GRAPH = {
  nodes: [
    ...M1_GRAPH.nodes,
    { id: 'risk_regulatory', kind: 'risk', label: 'Regulatory delay' },
  ],
  edges: [
    ...M1_GRAPH.edges,
    {
      from: 'risk_regulatory',
      to: 'fac_price',
      strength: { mean: -0.2, std: 0.1 },
      exists_probability: 0.6,
      effect_direction: 'negative',
    },
  ],
};

function makePayload() {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'frame' as const,
    message: 'Should we launch the product now?',
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

function makeDraftResult() {
  return {
    blocks: [],
    assistantText: 'Drafted.',
    latencyMs: 1234,
    strengthenItems: [],
    coachingSummary: null,
    coachingWideningLog: null,
    coachingBiasSignals: null,
    draftWarnings: [],
    graphOutput: M1_GRAPH,
  };
}

describe('Phase 4 — merged-graph dispatch compatibility (flag ON, enricher returns merged graph)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flag.enabled = true;
    (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue(
      makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>,
    );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue({
      response: {},
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: true,
    } as Awaited<ReturnType<typeof commitDirectAnswer>>);
    (enrichDraftGraph as MockedFunction<typeof enrichDraftGraph>).mockResolvedValue({
      enriched: true,
      reason: 'applied',
      graph: MERGED_GRAPH,
    } as Awaited<ReturnType<typeof enrichDraftGraph>>);
  });

  it('commits ONCE; the committed graph, the wire draft_graph field, and the dispatch-result graph are all the merged graph', async () => {
    const result = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-p4',
      request: STUB_REQUEST,
    });

    // Single atomic commit — no intermediate M1 write, no second merged write.
    expect(commitDirectAnswer).toHaveBeenCalledOnce();
    const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0];
    expect(metadata.graph).toEqual(MERGED_GRAPH);

    // The response the user sees references the same merged graph.
    expect(result.response.draft_graph?.nodes).toEqual(MERGED_GRAPH.nodes);
    expect(result.response.draft_graph?.edges).toEqual(MERGED_GRAPH.edges);
    expect(result.response.draft_graph?.node_count).toBe(MERGED_GRAPH.nodes.length);
    expect(result.response.draft_graph?.edge_count).toBe(MERGED_GRAPH.edges.length);

    // The dispatch-result graph (used by the egress sanitiser for label
    // resolution) is the merged graph too.
    expect(result.graph).toEqual(MERGED_GRAPH);
  });

  it('accounting: llm_calls_used=2 on enriched turns, and the M1 narration-count guard is not fired against merged counts', async () => {
    // M1 narration states the correct M1 counts (4 nodes / 1 edge); the
    // merged graph has 5/2. Without the swap-time narration null, the
    // count-mismatch guard would fire a spurious DraftNarrationCountMismatch
    // on every enriched turn, polluting the standing Sonnet-drift signal.
    (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue({
      ...makeDraftResult(),
      assistantText: 'Drafted a decision graph with 4 nodes and 1 edges.',
    } as Awaited<ReturnType<typeof handleDraftGraph>>);

    await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-p4-acct', request: STUB_REQUEST });

    const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0];
    expect(metadata.llm_calls_used).toBe(2);
    const mismatchEvents = (emit as unknown as MockedFunction<typeof emit>).mock.calls.filter(
      (c) => c[0] === TelemetryEvents.DraftNarrationCountMismatch,
    );
    expect(mismatchEvents).toHaveLength(0);
  });

  it('accounting: llm_calls_used stays 1 on degraded (M1-only) turns', async () => {
    (enrichDraftGraph as MockedFunction<typeof enrichDraftGraph>).mockResolvedValue({
      enriched: false,
      reason: 'm2_timeout',
      graph: M1_GRAPH,
    } as Awaited<ReturnType<typeof enrichDraftGraph>>);

    await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-p4-acct-deg', request: STUB_REQUEST });

    const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0];
    expect(metadata.llm_calls_used).toBe(1);
  });

  it('freshness current_graph_hash is computed from the MERGED graph, not the M1 graph', async () => {
    const result = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-p4-hash',
      request: STUB_REQUEST,
    });

    const mergedHash = computeAnalysisAffectingGraphHash(MERGED_GRAPH as unknown as GraphStateIngress);
    const m1Hash = computeAnalysisAffectingGraphHash(M1_GRAPH as unknown as GraphStateIngress);

    expect(result.freshness?.current_graph_hash).toBe(mergedHash);
    expect(result.freshness?.current_graph_hash).not.toBe(m1Hash);
    // First draft turn: no prior run_analysis fact — freshness verdict `none`.
    expect(result.freshness?.freshness).toBe('none');
  });

  it('degrade case (enriched=false): commit, response, and hash all reference the M1 graph — M1-only fallback is total', async () => {
    (enrichDraftGraph as MockedFunction<typeof enrichDraftGraph>).mockResolvedValue({
      enriched: false,
      reason: 'm2_timeout',
      graph: M1_GRAPH,
    } as Awaited<ReturnType<typeof enrichDraftGraph>>);

    const result = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-p4-degrade',
      request: STUB_REQUEST,
    });

    expect(commitDirectAnswer).toHaveBeenCalledOnce();
    const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0];
    expect(metadata.graph).toEqual(M1_GRAPH);
    expect(result.response.draft_graph?.node_count).toBe(M1_GRAPH.nodes.length);
    expect(result.freshness?.current_graph_hash).toBe(
      computeAnalysisAffectingGraphHash(M1_GRAPH as unknown as GraphStateIngress),
    );
  });

  it('enricher throwing unexpectedly (contract breach) still ships the M1 draft — dispatch backstop holds', async () => {
    (enrichDraftGraph as MockedFunction<typeof enrichDraftGraph>).mockRejectedValue(new Error('boom'));

    const result = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-p4-throw',
      request: STUB_REQUEST,
    });

    expect(result.commitPerformed).toBe(true);
    const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0];
    expect(metadata.graph).toEqual(M1_GRAPH);
  });
});
