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

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return {
    ...actual,
    emit: vi.fn(),
  };
});

// ── imports after mocks ───────────────────────────────────────────────────────

import { dispatchDraftGraph } from '../draft-graph-dispatch.js';
import { handleDraftGraph } from '../../../orchestrator/tools/draft-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { emit, TelemetryEvents } from '../../../utils/telemetry.js';
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

// Cast to the DraftGraphResult['analysisReady'] shape rather than
// `as const`: the latter forces every literal field to readonly, which
// fails to assign through `makeDraftResult(_, analysisReady)`. The
// cast preserves type-level validation against the schema while
// allowing the fixture to flow through helper signatures expecting a
// mutable AnalysisReadyPayload.
const MINIMAL_ANALYSIS_READY = {
  status: 'ready',
  options: [
    { option_id: 'opt_launch_now', label: 'Launch now', status: 'ready', interventions: { fac_revenue: 0.8 } },
    { option_id: 'opt_delay',      label: 'Delay 6mo',  status: 'ready', interventions: { fac_revenue: 0.3 } },
  ],
  goal_node_id: 'goal_revenue',
} as unknown as NonNullable<DraftGraphResult['analysisReady']>;

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

      // Decision-coach narrative: no options/factors → just confirms the
      // goal and points the user at running analysis. No node/edge wording.
      expect(result.response.assistant_text).toContain("I've built a first decision model");
      expect(result.response.assistant_text).toContain('"B"');
      expect(result.response.assistant_text).toContain('run the analysis');
      expect(result.response.assistant_text).not.toContain('nodes');
      expect(result.response.assistant_text).not.toContain('edges');
    });

    // Decision-coach narrative — populated case (goal + options + factors + risk).
    it('coaching narrative names the goal and summarises options and factors when all present', async () => {
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

      const text = result.response.assistant_text;
      expect(text).toContain('"Maximise revenue"');
      expect(text).toContain('two routes');
      expect(text).toContain('Launch now');
      expect(text).toContain('Delay');
      expect(text).toMatch(/trade-off|consideration/);
      expect(text).toContain('Market size');
      expect(text).toContain('Cost');
      expect(text).toContain('run the analysis');
      expect(text).not.toContain('nodes');
      expect(text).not.toContain('edges');
    });

    it('coaching narrative omits any risk wording when riskCount is 0', async () => {
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

      const text = result.response.assistant_text;
      expect(text).toContain('"Improve uptime"');
      expect(text).toContain('Migrate');
      expect(text).toContain('one route');
      expect(text).toContain('Latency');
      expect(text).toContain('run the analysis');
      // Risk wording must not leak when no risk nodes exist.
      expect(text).not.toContain('risks');
      expect(text).not.toContain('risk of');
    });

    it('coaching narrative uses the goalless lead when no goal node is present', async () => {
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

      const text = result.response.assistant_text;
      expect(text).toContain("I've built a first decision model from your brief");
      expect(text).toContain('Plan A');
      expect(text).toContain('Plan B');
      expect(text).toContain('two routes');
      // No goal quote — there is no goal node to name.
      expect(text).not.toContain('"');
      expect(text).not.toContain('nodes');
    });

    // The handler narration (`assistantText` from V4) is no longer surfaced
    // to users at all. The deterministic coaching narrative is always shipped
    // on success, regardless of what (potentially graph-shaped) wording the
    // handler returned.
    it('coaching narrative is shipped even when handler narration is graph-shaped', async () => {
      const graph = {
        nodes: [
          { id: 'g1', kind: 'goal', label: 'Win Q3' },
          { id: 'o1', kind: 'option', label: 'Plan A' },
          { id: 'f1', kind: 'factor', label: 'Budget' },
        ],
        edges: [{ from: 'o1', to: 'g1' }],
      };
      const draftResult = {
        ...makeDraftResult(graph),
        // Narration mentions counts and they MATCH the final graph (3
        // nodes, 1 edge) — previously this would have shipped verbatim.
        assistantText: 'Drafted a decision graph with 3 nodes and 1 edges.',
      };
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(draftResult as Awaited<ReturnType<typeof handleDraftGraph>>);

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: 'req-1',
        request: STUB_REQUEST,
      });

      const text = result.response.assistant_text;
      expect(text).toContain('"Win Q3"');
      expect(text).toContain('Plan A');
      expect(text).toContain('Budget');
      expect(text).toContain('run the analysis');
      // The handler narration is now discarded — graph-shaped wording must
      // never reach the user from the success path.
      expect(text).not.toContain('nodes');
      expect(text).not.toContain('edges');
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

    it('threads briefText even when handleDraftGraph produces no graphOutput (V5 Phase 3A prerequisite — Fix A)', async () => {
      // V5 Phase 3A — fix folded into PR #178. Prior behaviour gated
      // briefText threading on `draftResult.graphOutput != null` to
      // protect against a feared "graphless first-write lockout". That
      // gating caused decision_review enrichment to skip with `no_brief`
      // because scenarios.brief_text stayed null on degraded draft turns.
      //
      // New contract: thread payload.message verbatim to briefText on
      // EVERY draft turn. The RPC's first-write-wins predicate
      // (`WHERE brief_text IS NULL OR brief_text = ''`) is sufficient
      // protection — a later draft with the real brief succeeds if it
      // hits the predicate while brief_text is still empty, and is a
      // no-op only when an earlier write has already populated it.
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
      // Fix A: brief is threaded even without graphOutput.
      expect(metadata.briefText).toBe('My decision');
      // Graph absence is independent — still undefined when graphless.
      expect(metadata.graph).toBeUndefined();
    });

    it('graphless-then-successful sequence: both attempts thread briefText; first-write-wins lives at the RPC, not the dispatch boundary', async () => {
      // Two-call sequence on the same scenario:
      //   1. handleDraftGraph returns null graphOutput → STILL threads briefText (Fix A).
      //   2. handleDraftGraph returns a real graph → ALSO threads briefText.
      // Both writes hit commitDirectAnswer; first-write-wins at the RPC
      // (`WHERE brief_text IS NULL OR brief_text = ''`) decides which
      // value lands in canonical state. This test verifies the dispatch
      // contract; the actual RPC predicate behaviour is exercised by
      // brief-persistence-composed-roundtrip.test.ts against a stateful
      // store that mirrors the WHERE clause.
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
      // Call 1: graphless → brief flows (Fix A).
      expect(calls[0][1].briefText).toBe('My decision');
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

  it('emits the three-chip post-draft coaching set when analysis_ready.status === "ready"', async () => {
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

    expect(result.response.suggested_actions).toHaveLength(3);
    // Run analysis stays the primary action chip with the existing
    // handler-dispatchable action_type. Order matters — the UI surfaces the
    // first chip as primary.
    expect(result.response.suggested_actions[0]).toMatchObject({
      id: 'chip_action_run_analysis',
      action_type: 'run_analysis',
      label: 'Run analysis',
    });
    // Review model — conversational chip, no action_type. Clicking sends
    // its `message` back through the turn-executor as a user message.
    expect(result.response.suggested_actions[1]).toMatchObject({
      id: 'chip_prompt_review_model',
      label: 'Review model',
    });
    expect(result.response.suggested_actions[1].action_type).toBeUndefined();
    expect(typeof result.response.suggested_actions[1].message).toBe('string');
    // What assumptions matter most? — second conversational chip.
    expect(result.response.suggested_actions[2]).toMatchObject({
      id: 'chip_prompt_assumptions',
      label: 'What assumptions matter most?',
    });
    expect(result.response.suggested_actions[2].action_type).toBeUndefined();
    expect(typeof result.response.suggested_actions[2].message).toBe('string');
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

// ---------------------------------------------------------------------------
// V5 post-draft coaching — gated-hybrid composer wiring
// ---------------------------------------------------------------------------
//
// These tests exercise the dispatch boundary: the new fields on
// DraftGraphResult (strengthenItems, coachingSummary, coachingBiasSignals)
// are passed to buildPostDraftNarrative, and the source-selection
// telemetry event fires on the success path.

describe('dispatchDraftGraph — gated-hybrid coaching wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);
  });

  const CLEAN_SUMMARY =
    'The routes here weigh delivery speed against quality risk. One assumption worth checking is whether the team can absorb extra coordination overhead in the first quarter. Next, run the analysis to see how the options compare under stress.';

  it('uses coachingSummary verbatim as assistant_text when it passes the full-response gate', async () => {
    const draftResult = {
      ...makeDraftResult(MINIMAL_GRAPH, MINIMAL_ANALYSIS_READY),
      coachingSummary: CLEAN_SUMMARY,
    };
    (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue(
      draftResult as Awaited<ReturnType<typeof handleDraftGraph>>,
    );

    const result = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-summary-pass',
      request: STUB_REQUEST,
    });

    expect(result.response.assistant_text).toBe(CLEAN_SUMMARY);
  });

  it('falls back to the five-sentence builder when coachingSummary fails the gate (premature recommendation)', async () => {
    const badSummary =
      "I've built a model. We recommend hiring a tech lead first given the timeline pressure. The options weigh delivery speed against risk. Next, run the analysis to validate the assumptions.";
    const draftResult = {
      ...makeDraftResult(MINIMAL_GRAPH, MINIMAL_ANALYSIS_READY),
      coachingSummary: badSummary,
    };
    (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue(
      draftResult as Awaited<ReturnType<typeof handleDraftGraph>>,
    );

    const result = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-summary-reject',
      request: STUB_REQUEST,
    });

    expect(result.response.assistant_text).not.toContain('we recommend hiring');
    expect(result.response.assistant_text).toMatch(/run the analysis/);
  });

  it('emits V5PostDraftCoachingSourceSelected telemetry with the right payload on the coachingSummary path', async () => {
    const draftResult = {
      ...makeDraftResult(MINIMAL_GRAPH, MINIMAL_ANALYSIS_READY),
      coachingSummary: CLEAN_SUMMARY,
      strengthenItems: [{ id: 's', label: 'L', detail: 'd', action_type: 'x' }],
      coachingBiasSignals: [{ type: 't', detail: 'whatever' }],
    };
    (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue(
      draftResult as unknown as Awaited<ReturnType<typeof handleDraftGraph>>,
    );

    await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-telemetry-summary',
      request: STUB_REQUEST,
    });

    const calls = (emit as unknown as MockedFunction<typeof emit>).mock.calls
      .filter((c) => c[0] === TelemetryEvents.V5PostDraftCoachingSourceSelected);
    expect(calls).toHaveLength(1);
    const payload = calls[0][1] as Record<string, unknown>;
    expect(payload.request_id).toBe('req-telemetry-summary');
    expect(payload.scenario_id).toBe(SCENARIO_ID);
    expect(payload.assumption_source).toBe('coaching_summary');
    expect(payload.coaching_summary_present).toBe(true);
    expect(payload.coaching_summary_passed_gate).toBe(true);
    expect(payload.fallback_reason).toBeNull();
    expect(payload.strengthen_items_count).toBe(1);
    expect(payload.coaching_bias_signals_count).toBe(1);
  });

  it('emits V5PostDraftCoachingSourceSelected telemetry with deterministic_fallback when no coaching sources are present', async () => {
    const draftResult = {
      ...makeDraftResult(MINIMAL_GRAPH, MINIMAL_ANALYSIS_READY),
      coachingSummary: null,
      strengthenItems: [],
      coachingBiasSignals: null,
    };
    (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue(
      draftResult as Awaited<ReturnType<typeof handleDraftGraph>>,
    );

    await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-telemetry-fallback',
      request: STUB_REQUEST,
    });

    const calls = (emit as unknown as MockedFunction<typeof emit>).mock.calls
      .filter((c) => c[0] === TelemetryEvents.V5PostDraftCoachingSourceSelected);
    expect(calls).toHaveLength(1);
    const payload = calls[0][1] as Record<string, unknown>;
    expect(payload.assumption_source).toBe('deterministic_fallback');
    expect(payload.coaching_summary_present).toBe(false);
    expect(payload.coaching_summary_passed_gate).toBe(false);
    expect(payload.fallback_reason).toBe('no_candidate');
    expect(payload.strengthen_items_count).toBe(0);
    expect(payload.coaching_bias_signals_count).toBe(0);
  });

  it('does NOT emit V5PostDraftCoachingSourceSelected when graph persistence fails', async () => {
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockRejectedValue(new Error('StateCommitFailedError'));
    (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue(
      makeDraftResult(MINIMAL_GRAPH, MINIMAL_ANALYSIS_READY) as Awaited<ReturnType<typeof handleDraftGraph>>,
    );

    await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-telemetry-nopersist',
      request: STUB_REQUEST,
    });

    const calls = (emit as unknown as MockedFunction<typeof emit>).mock.calls
      .filter((c) => c[0] === TelemetryEvents.V5PostDraftCoachingSourceSelected);
    expect(calls).toHaveLength(0);
  });

  it('uses strengthenItems[0].detail as assistant_text sentence 4 when summary is absent and detail passes the gate', async () => {
    const draftResult = {
      ...makeDraftResult(MINIMAL_GRAPH, MINIMAL_ANALYSIS_READY),
      coachingSummary: null,
      strengthenItems: [
        {
          id: 's1',
          label: 'Stress synergy estimate',
          detail: 'the synergy assumption sits as a point value and warrants a 10 to 30M range',
          action_type: 'add_constraint',
        },
      ],
    };
    (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue(
      draftResult as Awaited<ReturnType<typeof handleDraftGraph>>,
    );

    await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-strengthen-detail',
      request: STUB_REQUEST,
    });

    const calls = (emit as unknown as MockedFunction<typeof emit>).mock.calls
      .filter((c) => c[0] === TelemetryEvents.V5PostDraftCoachingSourceSelected);
    expect(calls).toHaveLength(1);
    const payload = calls[0][1] as Record<string, unknown>;
    expect(payload.assumption_source).toBe('strengthen_item_detail');
  });

  it('positive E2E: realistic CEE-style coachingSummary passes the gate and lands verbatim in assistant_text', async () => {
    // Shape mirrors the CEE pipeline's `coaching.summary` output: one
    // or two prose sentences that frame the decision, surface a
    // trade-off, then nudge toward analysis. No premature
    // recommendation, no internal IDs, no em-dashes, no schema terms.
    // The decision-language register reflects what Sonnet/Anthropic
    // generates in staging captures (see
    // tests/fixtures/cross-service/draft-graph.coaching-populated
    // .staging.json) once the next-step nudge is preserved.
    const realisticSummary =
      "This decision weighs faster Mid-Market Customer Acquisition against higher Cash Runway Risk across the three routes you're considering. One key assumption worth checking is whether the acquisition team can absorb the integration overhead a Series A path introduces. Try running the analysis next to see how the routes compare under stress and which assumptions matter most before you commit.";

    const draftResult = {
      ...makeDraftResult(MINIMAL_GRAPH, MINIMAL_ANALYSIS_READY),
      coachingSummary: realisticSummary,
      strengthenItems: [
        {
          id: 'strengthen_001',
          label: 'Stress synergy estimate',
          detail: 'the synergy assumption sits as a point value rather than a range',
          action_type: 'add_constraint',
          bias_category: 'anchoring',
        },
      ],
      coachingBiasSignals: [
        { type: 'narrow_framing', detail: 'the brief frames the decision as a binary go/no-go' },
      ],
    };
    (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue(
      draftResult as unknown as Awaited<ReturnType<typeof handleDraftGraph>>,
    );

    const result = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-realistic-summary-e2e',
      request: STUB_REQUEST,
    });

    // 1. The whole assistant_text is the summary, byte-for-byte. No
    //    deterministic five-sentence opener was prepended, no trailing
    //    text was appended, no characters were rewritten.
    expect(result.response.assistant_text).toBe(realisticSummary);

    // 2. The three-chip set is still emitted (chip generation is
    //    independent of which assistant_text source fired).
    expect(result.response.suggested_actions).toHaveLength(3);
    expect(result.response.suggested_actions[0].id).toBe('chip_action_run_analysis');
    expect(result.response.suggested_actions[1].id).toBe('chip_prompt_review_model');
    expect(result.response.suggested_actions[2].id).toBe('chip_prompt_assumptions');

    // 3. stage_indicator advances to 'analyse' as on the normal
    //    success path — the summary replacement does not change the
    //    persistence-driven stage signal.
    expect(result.response.stage_indicator).toBe('analyse');

    // 4. Source-selection telemetry reports the coaching_summary path,
    //    pass=true, and the counts of the other sources that were
    //    available but not used.
    const calls = (emit as unknown as MockedFunction<typeof emit>).mock.calls
      .filter((c) => c[0] === TelemetryEvents.V5PostDraftCoachingSourceSelected);
    expect(calls).toHaveLength(1);
    const payload = calls[0][1] as Record<string, unknown>;
    expect(payload.assumption_source).toBe('coaching_summary');
    expect(payload.coaching_summary_present).toBe(true);
    expect(payload.coaching_summary_passed_gate).toBe(true);
    expect(payload.fallback_reason).toBeNull();
    expect(payload.strengthen_items_count).toBe(1);
    expect(payload.coaching_bias_signals_count).toBe(1);

    // 5. assistant_text contains the legitimate user-facing labels
    //    from the summary verbatim (no sanitiser rewrite).
    expect(result.response.assistant_text).toContain('Mid-Market Customer Acquisition');
    expect(result.response.assistant_text).toContain('Cash Runway Risk');
    expect(result.response.assistant_text).toContain('Series A path');

    // 6. No banned phrases survived — the gate did its job by
    //    accepting only summaries free of premature recommendation
    //    and internal-id leaks.
    expect(result.response.assistant_text.toLowerCase()).not.toMatch(/\brecommend/);
    expect(result.response.assistant_text.toLowerCase()).not.toMatch(/\bwinner\b/);
    expect(result.response.assistant_text.toLowerCase()).not.toMatch(/\bbest option\b/);
    expect(result.response.assistant_text).not.toMatch(/[—–]/);
    expect(result.response.assistant_text).not.toMatch(/\b(?:fac|opt|out|risk|goal|dec|node)_[a-z0-9]+/i);
  });
});
