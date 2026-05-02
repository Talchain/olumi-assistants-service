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
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { DraftGraphResult } from '../../../orchestrator/tools/draft-graph.js';

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

const MINIMAL_ANALYSIS_READY = {
  status: 'ready',
  options: [
    { option_id: 'opt_launch_now', label: 'Launch now', status: 'ready', interventions: { fac_revenue: 0.8 } },
    { option_id: 'opt_delay',      label: 'Delay 6mo',  status: 'ready', interventions: { fac_revenue: 0.3 } },
  ],
  goal_node_id: 'goal_revenue',
} as const;

function makeDraftResult(graphOutput: unknown = MINIMAL_GRAPH, analysisReady?: DraftGraphResult['analysisReady']) {
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
    ...(analysisReady !== undefined && { analysisReady }),
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

    it('assistant_text falls back to decision-language summary when handler returns null assistantText', async () => {
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

      // brief brief-display-safe-analysis A2: never include node/edge counts.
      // Graph has no option/factor/risk nodes → fallback template.
      expect(result.response.assistant_text).toBe('Your decision model is ready to explore.');
      expect(result.response.assistant_text).not.toContain('nodes');
      expect(result.response.assistant_text).not.toContain('edges');
    });

    // brief brief-display-safe-analysis A2 — draft narration template tiers.
    it('decision-language fallback names the goal and lists option/factor/risk counts when all present', async () => {
      const graph = {
        nodes: [
          { id: 'g1', kind: 'goal', label: 'Maximise revenue' },
          { id: 'o1', kind: 'option', label: 'Launch now' },
          { id: 'o2', kind: 'option', label: 'Delay' },
          { id: 'f1', kind: 'factor', label: 'Market size' },
          { id: 'f2', kind: 'factor', label: 'Cost' },
          { id: 'r1', kind: 'risk', label: 'Regulatory' },
        ],
        edges: [{ from: 'o1', to: 'g1' }],
      };
      const draftResult = { ...makeDraftResult(graph), assistantText: null };
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(draftResult as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-1',
        request: STUB_REQUEST,
      });

      expect(result.response.assistant_text).toBe(
        'Your decision model for "Maximise revenue" is ready, with 2 options, 2 factors, and 1 risks to consider.',
      );
      expect(result.response.assistant_text).not.toContain('nodes');
      expect(result.response.assistant_text).not.toContain('edges');
    });

    it('decision-language fallback omits the risks clause when riskCount is 0', async () => {
      const graph = {
        nodes: [
          { id: 'g1', kind: 'goal', label: 'Improve uptime' },
          { id: 'o1', kind: 'option', label: 'Migrate' },
          { id: 'f1', kind: 'factor', label: 'Latency' },
        ],
        edges: [{ from: 'o1', to: 'g1' }],
      };
      const draftResult = { ...makeDraftResult(graph), assistantText: null };
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(draftResult as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-1',
        request: STUB_REQUEST,
      });

      expect(result.response.assistant_text).toBe(
        'Your decision model for "Improve uptime" is ready, with 1 options and 1 factors to explore.',
      );
      expect(result.response.assistant_text).not.toContain('risks');
    });

    it('decision-language fallback drops the goal clause when no goal node is present', async () => {
      const graph = {
        nodes: [
          { id: 'o1', kind: 'option', label: 'Plan A' },
          { id: 'o2', kind: 'option', label: 'Plan B' },
          { id: 'f1', kind: 'factor', label: 'Budget' },
          { id: 'r1', kind: 'risk', label: 'Schedule slip' },
        ],
        edges: [{ from: 'o1', to: 'f1' }],
      };
      const draftResult = { ...makeDraftResult(graph), assistantText: null };
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(draftResult as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-1',
        request: STUB_REQUEST,
      });

      expect(result.response.assistant_text).toBe(
        'Your decision model is ready with 2 options, 1 factors, and 1 risks to explore.',
      );
      expect(result.response.assistant_text).not.toContain('"');
      expect(result.response.assistant_text).not.toContain('nodes');
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

  // ── analysisReady surfacing (response-finaliser brief) ──────────────────
  //
  // After the response-finaliser brief, the dispatcher no longer stamps
  // analysis_ready onto the response envelope. Instead it surfaces the
  // raw payload on `DispatchDraftGraphResult.analysisReady`; the
  // response-finaliser in route-v2.ts stamps it onto the wire envelope
  // (with a fresh computed_at) just before egress validation. These tests
  // assert on the dispatch-result field, not on the response.

  describe('analysisReady surfacing', () => {
    it('is set on the dispatch result when persistence succeeds and result.analysisReady is set', async () => {
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult(MINIMAL_GRAPH, MINIMAL_ANALYSIS_READY) as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-5',
        request: STUB_REQUEST,
      });

      // Composer-cleanliness invariant: response itself omits analysis_ready.
      expect('analysis_ready' in result.response).toBe(false);
      // Dispatch-result surfaces the raw payload for the finaliser.
      expect(result.analysisReady).toBeDefined();
      expect(result.analysisReady?.status).toBe('ready');
      expect(result.analysisReady?.goal_node_id).toBe('goal_revenue');
      expect(Array.isArray(result.analysisReady?.options)).toBe(true);
      expect((result.analysisReady?.options?.length ?? 0) > 0).toBe(true);
      // Dispatcher does NOT attach computed_at — that's the finaliser's job.
      expect((result.analysisReady as { computed_at?: string }).computed_at).toBeUndefined();
    });

    it('is undefined when commit fails (graphPersisted=false)', async () => {
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockRejectedValue(new Error('StateCommitFailedError: RPC error'));
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult(MINIMAL_GRAPH, MINIMAL_ANALYSIS_READY) as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-5',
        request: STUB_REQUEST,
      });

      expect('analysis_ready' in result.response).toBe(false);
      expect(result.analysisReady).toBeUndefined();
    });

    it('is undefined when result.analysisReady is undefined (no pipeline payload)', async () => {
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);
      // makeDraftResult with no analysisReady arg → analysisReady undefined
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult(MINIMAL_GRAPH) as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-5',
        request: STUB_REQUEST,
      });

      expect('analysis_ready' in result.response).toBe(false);
      expect(result.analysisReady).toBeUndefined();
    });
  });

  // ─── V5 Phase 1 brief persistence: scenarios.brief_text ────────────────────
  // The first draft turn supplies the user-supplied free-text brief via
  // payload.message. dispatchDraftGraph normalises it via
  // normaliseBriefText and threads it through CommitMetadata.briefText
  // → SessionStore.append → append_turn_atomic(p_brief_text) → row.
  // ───────────────────────────────────────────────────────────────────────────
  describe('V5 Phase 1 brief persistence — briefText threaded to commit metadata', () => {
    beforeEach(() => {
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);
    });

    it('threads payload.message verbatim as briefText (after trim)', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);

      await dispatchDraftGraph({
        payload: makePayload({ message: 'Should we launch the product now?' }),
        requestId: 'req-brief-1',
        request: STUB_REQUEST,
      });

      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0];
      expect(metadata.briefText).toBe('Should we launch the product now?');
    });

    it('trims surrounding whitespace before threading briefText', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);

      await dispatchDraftGraph({
        payload: makePayload({ message: '   trimmed message   ' }),
        requestId: 'req-brief-trim',
        request: STUB_REQUEST,
      });

      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0];
      expect(metadata.briefText).toBe('trimmed message');
    });

    it('truncates an over-8000 char briefText (commit succeeds, never errors on length)', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);

      const huge = 'a '.repeat(10_000); // ~20_000 chars after spaces
      const result = await dispatchDraftGraph({
        payload: makePayload({ message: huge }),
        requestId: 'req-brief-long',
        request: STUB_REQUEST,
      });

      expect(result.commitPerformed).toBe(true);
      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0];
      expect(metadata.briefText).toBeDefined();
      expect((metadata.briefText as string).length).toBeLessThanOrEqual(8000);
    });

    it('threads briefText AND graph together in CommitMetadata (initial draft turn shape)', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);

      await dispatchDraftGraph({
        payload: makePayload({ message: 'My decision' }),
        requestId: 'req-brief-shape',
        request: STUB_REQUEST,
      });

      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0];
      expect(metadata.graph).toEqual(MINIMAL_GRAPH);
      expect(metadata.briefText).toBe('My decision');
    });

    it('does NOT thread briefText when handleDraftGraph produces no graphOutput (graphless first-write lockout protection)', async () => {
      // Critical: a graphless draft (handleDraftGraph returned null
      // graphOutput) MUST NOT write brief_text, otherwise a successful
      // retry on the same scenario would find brief_text already
      // populated and the WHERE-based first-write-wins clause would
      // silently drop the real brief. Brief is tied to graph presence:
      // brief_text only persists alongside a usable graph the user
      // can act on.
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult(null) as Awaited<ReturnType<typeof handleDraftGraph>>);
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(false) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      await dispatchDraftGraph({
        payload: makePayload({ message: 'My decision' }),
        requestId: 'req-brief-no-graph',
        request: STUB_REQUEST,
      });

      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0];
      expect(metadata.briefText).toBeUndefined();
      expect(metadata.graph).toBeUndefined();
    });

    it('graphless draft retry does not lock out a later successful first-write (regression for graphless first-write bug)', async () => {
      // Two-call sequence on the same scenario:
      //   1. handleDraftGraph returns null graphOutput → MUST NOT write briefText.
      //   2. handleDraftGraph returns a real graph → MUST write briefText.
      // The dispatch-side guard ensures the WHERE clause never sees a
      // graphless write that would silently lock out the retry.
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValueOnce(makeDraftResult(null) as Awaited<ReturnType<typeof handleDraftGraph>>)
        .mockResolvedValueOnce(makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>);
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValueOnce(makeCommitResult(false) as Awaited<ReturnType<typeof commitDirectAnswer>>)
        .mockResolvedValueOnce(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      await dispatchDraftGraph({
        payload: makePayload({ message: 'My decision' }),
        requestId: 'req-brief-graphless-retry-1',
        request: STUB_REQUEST,
      });
      await dispatchDraftGraph({
        payload: makePayload({ message: 'My decision' }),
        requestId: 'req-brief-graphless-retry-2',
        request: STUB_REQUEST,
      });

      const calls = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls;
      expect(calls).toHaveLength(2);
      // Call 1: graphless → no brief.
      expect(calls[0][1].briefText).toBeUndefined();
      // Call 2: successful → brief flows.
      expect(calls[1][1].briefText).toBe('My decision');
    });
  });
});

// ── B1 egress: OlumiResponseSchema parse ─────────────────────────────────────
//
// Verifies the vendor tarball schema (the B1 egress validator) accepts a full
// draft_graph turn response containing both `draft_graph` and `analysis_ready`.
// This catches the class of deployment failure where the tarball is patched in
// source but the integrity hash in pnpm-lock.yaml was not updated (Render
// would then install the old tarball and the egress parse would throw).

describe('B1 egress: OlumiResponseSchema.parse', () => {
  it('accepts a complete draft_graph turn response with both draft_graph and analysis_ready', () => {
    const wireResponse = {
      response_version: 2 as const,
      assistant_text: 'Drafted a decision graph with 13 nodes and 24 edges.',
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'analyse' as const,
      draft_graph: {
        nodes: [
          { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
          { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
        ],
        edges: [
          { from: 'dec_launch', to: 'goal_revenue', strength: 0.8 },
        ],
        node_count: 2,
        edge_count: 1,
      },
      analysis_ready: {
        status: 'ready',
        options: [
          {
            option_id: 'opt_launch_now',
            label: 'Launch now',
            status: 'ready',
            interventions: { fac_revenue: 0.8 },
          },
        ],
        goal_node_id: 'goal_revenue',
      },
    };

    expect(() => OlumiResponseSchema.parse(wireResponse)).not.toThrow();
    const parsed = OlumiResponseSchema.parse(wireResponse);
    expect(parsed.analysis_ready?.status).toBe('ready');
    expect(parsed.analysis_ready?.goal_node_id).toBe('goal_revenue');
    expect(parsed.draft_graph?.node_count).toBe(2);
  });

  it('still accepts a response with only draft_graph (no analysis_ready) — backward compat', () => {
    const wireResponse = {
      response_version: 2 as const,
      assistant_text: 'Drafted a decision graph.',
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'analyse' as const,
      draft_graph: {
        nodes: [{ id: 'dec_launch', kind: 'decision', label: 'Launch?' }],
        edges: [],
        node_count: 1,
        edge_count: 0,
      },
    };

    expect(() => OlumiResponseSchema.parse(wireResponse)).not.toThrow();
    const parsed = OlumiResponseSchema.parse(wireResponse);
    expect(parsed.analysis_ready).toBeUndefined();
  });

  it('still accepts a plain conversational response (no draft_graph, no analysis_ready)', () => {
    const wireResponse = {
      response_version: 2 as const,
      assistant_text: 'Here is some information.',
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'frame' as const,
    };

    expect(() => OlumiResponseSchema.parse(wireResponse)).not.toThrow();
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

// ---------------------------------------------------------------------------
// V5 review: post-draft chip generation
// ---------------------------------------------------------------------------
//
// The brief's chip-mapping table calls for different chips on the draft
// response depending on analysis_ready status and persistence outcome.
// These tests exercise buildPostDraftChips end-to-end through the dispatcher
// and also assert the emitted chips pass the boundary `ActionSchema`, so an
// egress validator cannot reject the envelope.

describe('dispatchDraftGraph — post-draft chips (V5 review)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits an executable Run analysis chip when analysis_ready.status === "ready"', async () => {
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);
    (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue(
      makeDraftResult(MINIMAL_GRAPH, MINIMAL_ANALYSIS_READY) as Awaited<ReturnType<typeof handleDraftGraph>>,
    );

    const result = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-chip-ready',
      request: STUB_REQUEST,
    });

    expect(result.response.suggested_actions).toHaveLength(1);
    expect(result.response.suggested_actions[0]).toMatchObject({
      id: 'chip_action_run_analysis',
      action_type: 'run_analysis',
      label: 'Run analysis',
    });
  });

  it('emits a conversational setup chip when analysis_ready is absent', async () => {
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);
    (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue(
      makeDraftResult(MINIMAL_GRAPH) as Awaited<ReturnType<typeof handleDraftGraph>>,
    );

    const result = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-chip-unready',
      request: STUB_REQUEST,
    });

    expect(result.response.suggested_actions).toHaveLength(1);
    expect(result.response.suggested_actions[0]).toMatchObject({
      id: 'chip_prompt_set_option_values',
      label: 'Set values for options',
    });
    // Prompt chip — no action_type.
    expect(result.response.suggested_actions[0].action_type).toBeUndefined();
  });

  it('emits a conversational setup chip when analysis_ready.status is not "ready"', async () => {
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);
    const pending = { ...MINIMAL_ANALYSIS_READY, status: 'pending_values' } as unknown as typeof MINIMAL_ANALYSIS_READY;
    (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue(
      makeDraftResult(MINIMAL_GRAPH, pending) as Awaited<ReturnType<typeof handleDraftGraph>>,
    );

    const result = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-chip-pending',
      request: STUB_REQUEST,
    });

    expect(result.response.suggested_actions).toHaveLength(1);
    expect(result.response.suggested_actions[0].label).toBe('Set values for options');
  });

  it('emits NO chips when graph persistence failed (route returns 500 anyway)', async () => {
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockRejectedValue(new Error('StateCommitFailedError'));
    (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue(
      makeDraftResult(MINIMAL_GRAPH, MINIMAL_ANALYSIS_READY) as Awaited<ReturnType<typeof handleDraftGraph>>,
    );

    const result = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-chip-fail',
      request: STUB_REQUEST,
    });

    expect(result.commitPerformed).toBe(false);
    expect(result.response.suggested_actions).toEqual([]);
  });

  it('emitted chips pass B1 ActionSchema validation', async () => {
    const { ActionSchema } = await import('@talchain/schemas/boundary');
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

    const scenarios: Array<[string, unknown]> = [
      ['ready', MINIMAL_ANALYSIS_READY],
      ['absent', undefined],
    ];
    for (const [label, analysisReady] of scenarios) {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue(
        makeDraftResult(
          MINIMAL_GRAPH,
          analysisReady as typeof MINIMAL_ANALYSIS_READY,
        ) as Awaited<ReturnType<typeof handleDraftGraph>>,
      );
      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: `req-chip-schema-${label}`,
        request: STUB_REQUEST,
      });
      for (const chip of result.response.suggested_actions) {
        const parsed = ActionSchema.safeParse(chip);
        expect(parsed.success).toBe(true);
      }
    }
  });
});
