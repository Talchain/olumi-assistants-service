/**
 * Unit tests for dispatchDraftGraph.
 *
 * Covers the three critical behaviours of the atomic graph-persistence path:
 *
 *  1. Persist success   → stage_indicator='analyse', commitPerformed=true
 *                         (commitDirectAnswer resolves with graphPersisted=true)
 *  2. Atomic commit failure → stage_indicator='frame' (no advancement),
 *                         commitPerformed=false, dispatcher does not throw
 *                         (commitDirectAnswer throws → dispatcher catch returns)
 *  3. No graphOutput    → stage_indicator stays at payload.stage,
 *                         commitDirectAnswer called with graph=undefined
 *
 * Graph persistence is atomic: CommitMetadata.graph is forwarded to
 * append_turn_atomic as p_graph. Both LLM I/O (handleDraftGraph) and the
 * commit stage (commitDirectAnswer) are mocked at module level.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';

// ── module-level mocks ────────────────────────────────────────────────────────

vi.mock('../../../orchestrator/tools/draft-graph.js', () => ({
  handleDraftGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

// ── imports after mocks ───────────────────────────────────────────────────────

import { dispatchDraftGraph } from '../draft-graph-dispatch.js';
import { handleDraftGraph } from '../../../orchestrator/tools/draft-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { Stage } from '@talchain/schemas/boundary';

// ── helpers ───────────────────────────────────────────────────────────────────

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID     = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'frame' as const,
    message: 'Should we launch the product now?',
    turn_class: 'frame' as const,
    source: 'composer' as const,
    ...overrides,
  };
}

const MINIMAL_GRAPH = {
  nodes: [{ id: 'dec_launch', kind: 'decision', label: 'Launch?' }],
  edges: [{ from: 'dec_launch', to: 'goal_revenue' }],
};

function makeDraftResult(graphOutput: unknown = MINIMAL_GRAPH) {
  return {
    blocks: [],
    assistantText: 'Drafted a decision graph with 1 nodes and 1 edges.',
    latencyMs: 1000,
    strengthenItems: [],
    coachingSummary: null,
    coachingWideningLog: null,
    coachingBiasSignals: null,
    draftWarnings: [],
    graphOutput,
  };
}

function makeCommitResult(graphPersisted: boolean) {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-1',
    graphPersisted,
  };
}

const STUB_REQUEST = {} as FastifyRequest;

// ── tests ─────────────────────────────────────────────────────────────────────

describe('dispatchDraftGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when persistence succeeds (commitDirectAnswer returns graphPersisted=true)', () => {
    beforeEach(() => {
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);
    });

    it('returns stage_indicator=analyse', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-1',
        request: STUB_REQUEST,
      });

      expect(result.response.stage_indicator).toBe('analyse');
    });

    it('passes graph directly in CommitMetadata to commitDirectAnswer', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);

      await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-1',
        request: STUB_REQUEST,
      });

      expect(commitDirectAnswer).toHaveBeenCalledOnce();
      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0];
      // graph is passed directly (not wrapped in graphToStore); the store
      // layer forwards it to append_turn_atomic as p_graph.
      expect(metadata.graph).toEqual(MINIMAL_GRAPH);
    });

    it('sets commitPerformed=true', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-1',
        request: STUB_REQUEST,
      });

      expect(result.commitPerformed).toBe(true);
    });

    it('includes draft_graph in response with non-empty nodes and edges', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-1',
        request: STUB_REQUEST,
      });

      expect(result.response.draft_graph).toBeDefined();
      expect(Array.isArray(result.response.draft_graph?.nodes)).toBe(true);
      expect(Array.isArray(result.response.draft_graph?.edges)).toBe(true);
      expect((result.response.draft_graph?.nodes?.length ?? 0) > 0).toBe(true);
    });

    it('draft_graph node_count and edge_count match the FINAL graph arrays', async () => {
      const graph = {
        nodes: [
          { id: 'n1', kind: 'decision', label: 'Launch?' },
          { id: 'n2', kind: 'goal', label: 'Revenue' },
          { id: 'n3', kind: 'factor', label: 'Market size' },
        ],
        edges: [
          { from: 'n1', to: 'n2' },
          { from: 'n3', to: 'n2' },
        ],
      };
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult(graph) as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-1',
        request: STUB_REQUEST,
      });

      expect(result.response.draft_graph?.node_count).toBe(3);
      expect(result.response.draft_graph?.edge_count).toBe(2);
      expect(result.response.draft_graph?.nodes).toHaveLength(3);
      expect(result.response.draft_graph?.edges).toHaveLength(2);
    });

    it('assistant_text uses FINAL node/edge counts (post-repair) when handler returns null assistantText', async () => {
      const graph = {
        nodes: [
          { id: 'n1', kind: 'decision', label: 'A' },
          { id: 'n2', kind: 'goal', label: 'B' },
        ],
        edges: [{ from: 'n1', to: 'n2' }],
      };
      const draftResult = { ...makeDraftResult(graph), assistantText: null };
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(draftResult as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-1',
        request: STUB_REQUEST,
      });

      expect(result.response.assistant_text).toBe('Drafted a decision graph with 2 nodes and 1 edges.');
    });
  });

  describe('when the atomic commit fails (commitDirectAnswer throws — graph and turn both roll back)', () => {
    beforeEach(() => {
      // With atomic commit, there is no "graph failed but turn committed" case.
      // If append_turn_atomic throws, both graph and turn are rolled back and
      // commitDirectAnswer re-throws as StateCommitFailedError. The dispatcher
      // catches this, logs it, and returns commitPerformed=false.
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockRejectedValue(new Error('StateCommitFailedError: RPC error'));
    });

    it('keeps stage_indicator=frame (no advancement when commit failed)', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-2',
        request: STUB_REQUEST,
      });

      expect(result.response.stage_indicator).toBe('frame');
    });

    it('assistant_text uses pipeline narration (route discards it — client sees 500 INTERNAL_ERROR)', async () => {
      // Route maps commitPerformed=false → HTTP 500 BoundaryError; dg.response
      // is never sent. The dispatcher still builds a valid OlumiResponse for
      // the success path — on failure, it falls back to the pipeline narration.
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-2',
        request: STUB_REQUEST,
      });

      // Narration from makeDraftResult — not a save-failure message.
      expect(result.response.assistant_text).toBe('Drafted a decision graph with 1 nodes and 1 edges.');
    });

    it('does not throw — commit failure is caught, commitPerformed=false returned', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);

      await expect(
        dispatchDraftGraph({
          payload: makePayload(),
          requestId: 'req-2',
          request: STUB_REQUEST,
        }),
      ).resolves.toBeDefined();
    });

    it('returns commitPerformed=false when the RPC throws', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-2',
        request: STUB_REQUEST,
      });

      expect(result.commitPerformed).toBe(false);
    });

    it('response does NOT include draft_graph when commit failed (route discards the response anyway)', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-2',
        request: STUB_REQUEST,
      });

      expect(result.response.draft_graph).toBeUndefined();
    });
  });

  describe('when handleDraftGraph produces no graphOutput', () => {
    beforeEach(() => {
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(false) as Awaited<ReturnType<typeof commitDirectAnswer>>);
    });

    it('keeps stage_indicator=frame', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult(null) as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-3',
        request: STUB_REQUEST,
      });

      expect(result.response.stage_indicator).toBe('frame');
    });

    it('passes no graph in CommitMetadata when graphOutput is null', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult(null) as Awaited<ReturnType<typeof handleDraftGraph>>);

      await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-3',
        request: STUB_REQUEST,
      });

      expect(commitDirectAnswer).toHaveBeenCalledOnce();
      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0];
      // No graph produced — metadata.graph must be undefined so p_graph is
      // omitted from the RPC call, leaving scenarios.graph unchanged.
      expect(metadata.graph).toBeUndefined();
    });

    it('response does NOT include draft_graph when no graphOutput', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult(null) as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-3',
        request: STUB_REQUEST,
      });

      expect(result.response.draft_graph).toBeUndefined();
    });
  });

  describe('when handleDraftGraph throws', () => {
    it('propagates the error — route maps it to 500', async () => {
      const boom = new Error('pipeline failure');
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockRejectedValue(boom);

      await expect(
        dispatchDraftGraph({
          payload: makePayload(),
          requestId: 'req-4',
          request: STUB_REQUEST,
        }),
      ).rejects.toBe(boom);
    });

    it('never calls commitDirectAnswer on pipeline failure', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockRejectedValue(new Error('pipeline failure'));

      await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-4',
        request: STUB_REQUEST,
      }).catch(() => {});

      expect(commitDirectAnswer).not.toHaveBeenCalled();
    });
  });
});

// ── Schema canonical value guard ──────────────────────────────────────────────

describe('stage_indicator canonical values', () => {
  it("Stage enum accepts 'analyse' — the value used on graph-persist success", () => {
    expect(() => Stage.parse('analyse')).not.toThrow();
  });

  it("Stage enum accepts 'frame' — the value used on graph-persist failure", () => {
    expect(() => Stage.parse('frame')).not.toThrow();
  });

  it("Stage enum rejects unknown values such as 'evaluate'", () => {
    expect(() => Stage.parse('evaluate')).toThrow();
  });
});
