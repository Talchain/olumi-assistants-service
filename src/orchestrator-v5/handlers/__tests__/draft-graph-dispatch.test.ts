/**
 * Unit tests for dispatchDraftGraph.
 *
 * Covers the three critical behaviours introduced by the graph-persistence
 * change:
 *
 *  1. Persist success   → stage_indicator='analyse', commitPerformed=true
 *                         (commitDirectAnswer returns graphPersisted=true)
 *  2. Persist failure   → stage_indicator='frame' (no advancement),
 *                         commitPerformed=true (turn commit is independent),
 *                         error is swallowed (non-fatal)
 *                         (commitDirectAnswer returns graphPersisted=false)
 *  3. No graphOutput    → stage_indicator stays at payload.stage,
 *                         commitDirectAnswer called with no graphToStore
 *
 * Graph persistence is delegated to commitDirectAnswer via CommitMetadata.graphToStore.
 * Both LLM I/O (handleDraftGraph) and the commit stage (commitDirectAnswer) are
 * mocked at module level so no network calls are made.
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

    it('passes graphToStore with scenarioId and graph to commitDirectAnswer', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);

      await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-1',
        request: STUB_REQUEST,
      });

      expect(commitDirectAnswer).toHaveBeenCalledOnce();
      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0];
      expect(metadata.graphToStore).toEqual({ scenarioId: SCENARIO_ID, graph: MINIMAL_GRAPH });
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
  });

  describe('when persistence fails (commitDirectAnswer returns graphPersisted=false)', () => {
    beforeEach(() => {
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(false) as Awaited<ReturnType<typeof commitDirectAnswer>>);
    });

    it('keeps stage_indicator=frame (does not advance stage)', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-2',
        request: STUB_REQUEST,
      });

      expect(result.response.stage_indicator).toBe('frame');
    });

    it('does not throw — persistence failure is non-fatal', async () => {
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

    it('still commits the turn (commitPerformed=true)', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-2',
        request: STUB_REQUEST,
      });

      expect(result.commitPerformed).toBe(true);
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

    it('passes no graphToStore when graphOutput is null', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult(null) as Awaited<ReturnType<typeof handleDraftGraph>>);

      await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-3',
        request: STUB_REQUEST,
      });

      expect(commitDirectAnswer).toHaveBeenCalledOnce();
      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0];
      expect(metadata.graphToStore).toBeUndefined();
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
