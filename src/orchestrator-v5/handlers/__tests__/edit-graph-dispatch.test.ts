/**
 * Unit tests for dispatchEditGraph.
 *
 * Pins the post-R-001 contract:
 *
 *  1. Applied edit (appliedGraph !== null, wasRejected === false)
 *     → commitDirectAnswer called with metadata.graph === editResult.appliedGraph
 *     so append_turn_atomic persists the post-edit graph atomically with the
 *     turn row. Without this, scenarios.graph would stay stale across edit
 *     turns (the original P0 finding).
 *
 *  2. Rejected edit (appliedGraph === null, wasRejected === true)
 *     → commitDirectAnswer called with metadata.graph === undefined so the RPC
 *     receives p_graph = null and scenarios.graph is left unchanged.
 *
 *  3. Handler throw → dispatchEditGraph rethrows; no commit attempted. The
 *     route-level catch maps the thrown error to a 500 BoundaryError.
 *
 *  4. Commit failure → dispatchEditGraph returns commitPerformed: false; the
 *     response is still returned (server-side fallback). No throw.
 *
 *  5. Permissive ingress graph that fails strict GraphV3 parse → handler is
 *     still invoked with a structural fallback graph (no throw, no skipped
 *     dispatch). This proves the adapter at graphStateToGraphV3 keeps the
 *     edit pipeline reachable even when the UI sends weakly-typed graph state.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

// ── module-level mocks ────────────────────────────────────────────────────────

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

// ── imports after mocks ───────────────────────────────────────────────────────

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import type { GraphStateIngress, AnalysisStateIngress } from '../../boundary/request-extensions.js';

// ── helpers ───────────────────────────────────────────────────────────────────

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID     = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message: 'Increase the strength of the launch → revenue edge',
    turn_class: 'frame' as const,
    source: 'composer' as const,
    ...overrides,
  };
}

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
    { id: 'fac_marketing', kind: 'factor', label: 'Marketing spend' },
  ],
  edges: [
    {
      from: 'fac_marketing',
      to: 'goal_revenue',
      strength: { mean: 0.6, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
};

function makeAppliedEditResult(overrides: Partial<EditGraphResult> = {}): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Edge strength increased.',
    latencyMs: 1200,
    appliedGraph: POST_EDIT_GRAPH as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    ...overrides,
  };
}

function makeRejectedEditResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'The proposed edit was rejected.',
    latencyMs: 800,
    appliedGraph: null,
    wasRejected: true,
  };
}

function makeCommitResult(graphPersisted: boolean) {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-edit-1',
    graphPersisted,
  };
}

const STUB_REQUEST = {} as FastifyRequest;

// ── tests ─────────────────────────────────────────────────────────────────────

describe('dispatchEditGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('R-001 regression — applied edit graph persistence', () => {
    it('forwards editResult.appliedGraph to commitDirectAnswer.metadata.graph', async () => {
      // This is the assertion that pins the R-001 fix. Before the fix, the
      // dispatcher omitted `graph` from the metadata, so `append_turn_atomic`
      // received `p_graph = null` and `scenarios.graph` stayed stale.
      const editResult = makeAppliedEditResult();
      (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(editResult);
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      const result = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-applied',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      expect(result.commitPerformed).toBe(true);
      expect(commitDirectAnswer).toHaveBeenCalledTimes(1);
      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0]!;
      expect(metadata.graph).toBe(editResult.appliedGraph);
      expect(metadata.scenario_id).toBe(SCENARIO_ID);
      expect(metadata.turn_id).toBe(TURN_ID);
      expect(metadata.handler_id).toBeNull();
      expect(metadata.handler_facts).toEqual([]);
    });
  });

  describe('rejected edit', () => {
    it('passes graph=undefined to commitDirectAnswer (so RPC receives p_graph=null)', async () => {
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeRejectedEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(false) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      const result = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-rejected',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      expect(result.commitPerformed).toBe(true);
      expect(commitDirectAnswer).toHaveBeenCalledTimes(1);
      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0]!;
      expect(metadata.graph).toBeUndefined();
      // Wire-side: rejected edit produces a neutral assistant_text.
      expect(result.response.assistant_text).toBe('The proposed edit was rejected.');
    });
  });

  describe('handler throw', () => {
    it('rethrows so the route can map to a 500 BoundaryError; no commit attempted', async () => {
      const handlerErr = new Error('PLoT semantic validation timed out');
      (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockRejectedValue(handlerErr);

      await expect(
        dispatchEditGraph({
          payload: makePayload(),
          requestId: 'req-edit-throw',
          request: STUB_REQUEST,
          graphState: INGRESS_GRAPH,
          analysisState: null,
        }),
      ).rejects.toBe(handlerErr);

      expect(commitDirectAnswer).not.toHaveBeenCalled();
    });
  });

  describe('commit failure', () => {
    it('returns commitPerformed: false without throwing when commitDirectAnswer rejects', async () => {
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeAppliedEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockRejectedValue(new Error('StateCommitFailedError: RPC timeout'));

      const result = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-commit-fail',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      expect(result.commitPerformed).toBe(false);
      // Response is still returned for server-side logging — the route-v2
      // path maps commitPerformed=false to a wire-level retryable error.
      expect(result.response.assistant_text).toBeDefined();
    });
  });

  describe('graph adapter fallback', () => {
    it('still invokes handleEditGraph when ingress graph fails strict GraphV3 parse', async () => {
      // Ingress shape strips required GraphV3 fields (effect_direction,
      // strength, exists_probability). The adapter logs a warn and builds a
      // structural fallback so the edit pipeline remains reachable.
      const weaklyTypedGraph: GraphStateIngress = {
        nodes: [
          { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
          { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
        ],
        edges: [{ from: 'dec_launch', to: 'goal_revenue' }],
      };
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeAppliedEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      const result = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-fallback',
        request: STUB_REQUEST,
        graphState: weaklyTypedGraph,
        analysisState: null,
      });

      expect(handleEditGraph).toHaveBeenCalledTimes(1);
      expect(result.commitPerformed).toBe(true);
      // Confirm the adapter passed something graph-shaped (nodes + edges) to
      // handleEditGraph rather than throwing on the strict-parse miss.
      const [context] = (handleEditGraph as MockedFunction<typeof handleEditGraph>).mock.calls[0]!;
      expect(context.graph?.nodes).toHaveLength(2);
      expect(context.graph?.edges).toHaveLength(1);
    });

    it('passes analysisState to context when provided', async () => {
      const analysis: AnalysisStateIngress = { analysis_status: 'complete' };
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeAppliedEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-with-analysis',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: analysis,
      });

      const [context] = (handleEditGraph as MockedFunction<typeof handleEditGraph>).mock.calls[0]!;
      expect(context.analysis_response).not.toBeNull();
      expect((context.analysis_response as { analysis_status: string }).analysis_status).toBe('complete');
    });
  });
});
