/**
 * Phase 0/1 contamination guard for the V6 dual-draft seam.
 *
 * Proves the two invariants of the flag-gated enrichment block in
 * dispatchDraftGraph:
 *   1. Flag OFF (default): enrichDraftGraph is never invoked and the M1 graph
 *      reaches commit unchanged — byte-identical to the pre-seam behaviour.
 *   2. Flag ON + no-op enricher (enriched=false): enrichDraftGraph is invoked
 *      exactly once with the M1 graph, and the committed graph is STILL the
 *      untouched M1 graph.
 *
 * The enrichment module is mocked so call-count can be asserted without loading
 * the real (no-op) implementation. Written RED-first: before the dispatch block
 * existed, invariant (2)'s "called exactly once" failed.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';

// Hoisted mutable flag so the config mock can vary per test (vi.mock is
// hoisted and static per file; a getter reading this holder gives per-test
// control of config.features.v6DualDraftEnabled).
const flag = vi.hoisted(() => ({ enabled: false }));

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
// Spy on the dual-draft entry point. The dispatch dynamic-imports
// '../../cee/dual-draft/index.js', which resolves to the same module id this
// mock keys on, so the dispatch's call lands on this vi.fn().
vi.mock('../index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../index.js')>();
  // Real m2LlmCallMade (dispatch destructures it for llm_calls_used); stub
  // only enrichDraftGraph so call-count can be asserted.
  return { ...actual, enrichDraftGraph: vi.fn() };
});

import { dispatchDraftGraph } from '../../../orchestrator-v5/handlers/draft-graph-dispatch.js';
import { handleDraftGraph } from '../../../orchestrator/tools/draft-graph.js';
import { commitDirectAnswer } from '../../../orchestrator-v5/commit.js';
import { enrichDraftGraph } from '../index.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUB_REQUEST = {} as FastifyRequest;

const M1_GRAPH = {
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'opt_launch', kind: 'option', label: 'Launch now' },
  ],
  edges: [{ from: 'opt_launch', to: 'goal_revenue' }],
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

function makeDraftResult(graphOutput: unknown = M1_GRAPH) {
  return {
    blocks: [],
    assistantText: 'Drafted.',
    latencyMs: 1234,
    strengthenItems: [],
    coachingSummary: null,
    coachingWideningLog: null,
    coachingBiasSignals: null,
    draftWarnings: [],
    graphOutput,
  };
}

function makeCommitResult(graphPersisted: boolean) {
  return { response: {}, performed: true as const, persisted_row_id: 'row-1', graphPersisted };
}

describe('dispatchDraftGraph — V6 dual-draft flag gate (Phase 0/1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flag.enabled = false;
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue(
      makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>,
    );
    (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue(
      makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>,
    );
  });

  describe('flag OFF (default)', () => {
    it('never invokes enrichDraftGraph', async () => {
      await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-off', request: STUB_REQUEST });
      expect(enrichDraftGraph).not.toHaveBeenCalled();
    });

    it('commits the M1 graph unchanged (byte-identity)', async () => {
      await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-off', request: STUB_REQUEST });
      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0];
      expect(metadata.graph).toEqual(M1_GRAPH);
    });

    it('advances stage_indicator to analyse and commitPerformed=true (unchanged behaviour)', async () => {
      const r = await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-off', request: STUB_REQUEST });
      expect(r.response.stage_indicator).toBe('analyse');
      expect(r.commitPerformed).toBe(true);
    });
  });

  describe('flag ON + no-op enricher (enriched=false)', () => {
    beforeEach(() => {
      flag.enabled = true;
      (enrichDraftGraph as MockedFunction<typeof enrichDraftGraph>).mockResolvedValue({
        enriched: false,
        reason: 'not_implemented',
        graph: M1_GRAPH,
      } as Awaited<ReturnType<typeof enrichDraftGraph>>);
    });

    it('invokes enrichDraftGraph exactly once with the M1 graph and brief', async () => {
      await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-on', request: STUB_REQUEST });
      expect(enrichDraftGraph).toHaveBeenCalledOnce();
      const [input] = (enrichDraftGraph as MockedFunction<typeof enrichDraftGraph>).mock.calls[0];
      expect(input.graph).toEqual(M1_GRAPH);
      expect(input.brief).toBe('Should we launch the product now?');
      expect(input.scenarioId).toBe(SCENARIO_ID);
    });

    it('commits the M1 graph unchanged when the enricher returns enriched=false', async () => {
      await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-on', request: STUB_REQUEST });
      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0];
      expect(metadata.graph).toEqual(M1_GRAPH);
    });

    it('commits the MERGED graph when the enricher returns enriched=true (seam swap contract)', async () => {
      const MERGED_GRAPH = {
        nodes: [...M1_GRAPH.nodes, { id: 'risk_new', kind: 'risk', label: 'New risk' }],
        edges: M1_GRAPH.edges,
      };
      (enrichDraftGraph as MockedFunction<typeof enrichDraftGraph>).mockResolvedValue({
        enriched: true,
        reason: 'applied',
        graph: MERGED_GRAPH,
      } as Awaited<ReturnType<typeof enrichDraftGraph>>);

      const result = await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-on-merged', request: STUB_REQUEST });

      // Single commit, receives the merged graph.
      expect(commitDirectAnswer).toHaveBeenCalledOnce();
      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0];
      expect(metadata.graph).toEqual(MERGED_GRAPH);
      // Response counts and dispatch-result graph derive from the merged graph.
      expect(result.response.draft_graph?.node_count).toBe(3);
      expect(result.graph).toEqual(MERGED_GRAPH);
    });

    it('does not invoke enrichDraftGraph when the pipeline produced no graph', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue(
        makeDraftResult(null) as Awaited<ReturnType<typeof handleDraftGraph>>,
      );
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue(
        makeCommitResult(false) as Awaited<ReturnType<typeof commitDirectAnswer>>,
      );
      await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-on-null', request: STUB_REQUEST });
      expect(enrichDraftGraph).not.toHaveBeenCalled();
    });
  });
});
