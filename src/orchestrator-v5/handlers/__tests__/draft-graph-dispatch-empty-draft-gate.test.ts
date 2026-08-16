/**
 * ROADMAP 2.1252 — a draft with no nodes must not be committed or narrated.
 *
 * ── THE GAP ────────────────────────────────────────────────────────────────
 * Nothing on the draft success path asserted that the draft contains anything.
 * The pipeline can return 200 with an empty `nodes` array, and from that point
 * every downstream step treats it as a success: the graph is committed,
 * `graphPersisted` comes back true, and the post-draft narrative opens
 * "I've built a first decision model from your brief." over an empty canvas.
 * A confident sentence about a thing that is not there.
 *
 * Latent, not observed — which is why the assertions here are written against
 * the POSTCONDITION ("a committed draft has at least one node") rather than
 * against a reproduction. There is no reproduction to write from.
 *
 * ── THE BOUNDARY THE GATE MUST NOT CROSS ───────────────────────────────────
 * `graphOutput === null` is a DIFFERENT, deliberately-supported path: the
 * commit still happens so `scenarios.brief_text` is seeded (the V5 Phase 3A
 * `no_brief` failure), and `draft-graph-dispatch.test.ts` pins it. The obvious
 * one-liner — `(graphOutput?.nodes?.length ?? 0) === 0`, the count expression
 * already computed downstream — silently captures both. Two absences under one
 * predicate is the two-questions-one-name defect; the null case gets its own
 * test below, asserting the OLD behaviour survives.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';

vi.mock('../../../orchestrator/tools/draft-graph.js', () => ({
  handleDraftGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});

import { dispatchDraftGraph } from '../draft-graph-dispatch.js';
import { handleDraftGraph } from '../../../orchestrator/tools/draft-graph.js';
import { commitDirectAnswer } from '../../commit.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUB_REQUEST = {} as FastifyRequest;

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

function makeDraftResult(graphOutput: unknown) {
  return {
    blocks: [],
    assistantText: null,
    latencyMs: 1000,
    strengthenItems: [],
    coachingSummary: null,
    coachingWideningLog: null,
    coachingBiasSignals: null,
    draftWarnings: [],
    graphOutput,
  };
}

const EMPTY_GRAPH = { nodes: [], edges: [] };
const POPULATED_GRAPH = {
  nodes: [{ id: 'dec_launch', kind: 'decision', label: 'Launch?' }],
  edges: [{ from: 'dec_launch', to: 'goal_revenue' }],
};

function mockDraft(graphOutput: unknown): void {
  (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue(
    makeDraftResult(graphOutput) as Awaited<ReturnType<typeof handleDraftGraph>>,
  );
}

function dispatch() {
  return dispatchDraftGraph({
    payload: makePayload(),
    requestId: 'req-empty-draft',
    request: STUB_REQUEST,
  });
}

describe('ROADMAP 2.1252 — empty-draft gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue({
      response: {},
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: true,
    } as Awaited<ReturnType<typeof commitDirectAnswer>>);
  });

  describe('a graph that exists and is empty', () => {
    it('is refused rather than returned as a successful draft', async () => {
      mockDraft(EMPTY_GRAPH);

      await expect(dispatch()).rejects.toThrow(/no nodes/i);
    });

    it('is NEVER committed — the refusal precedes persistence', async () => {
      // The ordering is the substance. A gate placed after the commit would
      // still throw and would still pass the test above, having already written
      // an empty graph to `p_graph`.
      mockDraft(EMPTY_GRAPH);

      await expect(dispatch()).rejects.toThrow();
      expect(commitDirectAnswer).not.toHaveBeenCalled();
    });

    it('carries the metadata route-v2 needs for the CEE_GRAPH_INVALID envelope', async () => {
      // Without these three fields the route falls through to its legacy
      // `draft_graph_pipeline_threw` shape — an opaque 500 with no recovery
      // copy. The envelope is the user-visible half of this fix.
      mockDraft(EMPTY_GRAPH);

      const err = await dispatch().then(
        () => { throw new Error('expected the dispatch to reject'); },
        (e: Record<string, unknown>) => e,
      );

      expect(err.pipelineStatusCode).toBe(422);
      expect(err.pipelineErrorCode).toBe('CEE_GRAPH_INVALID');
      expect(err.pipelineReason).toBe('empty_draft_graph');
    });

    it('declares itself RETRYABLE, because rerunning the same brief is the honest lever', async () => {
      // `mapDraftGraphPipelineReasonStatic` floors CEE_GRAPH_INVALID at
      // non-retryable; only an explicit producer `true` promotes it (2.718).
      // Without this the user gets "refine your brief" for a brief the pipeline
      // accepted — the cruel inversion the truncation arm already documents.
      mockDraft(EMPTY_GRAPH);

      const err = await dispatch().then(
        () => { throw new Error('expected the dispatch to reject'); },
        (e: Record<string, unknown>) => e,
      );

      expect(err.pipelineRetryable).toBe(true);
      const recovery = err.pipelineRecovery as { suggestion: string; hints: string[] };
      expect(recovery.suggestion).toMatch(/try again/i);
      expect(recovery.hints.length).toBeGreaterThan(0);
    });

    it('the reason string satisfies route-v2\'s pattern guard', async () => {
      // route-v2 drops any `pipelineReason` failing /^[a-z][a-z0-9_]{1,63}$/ —
      // silently, back to null. A reason that does not match is a reason that
      // does not exist, and nothing else in the chain would say so.
      mockDraft(EMPTY_GRAPH);

      const err = await dispatch().then(
        () => { throw new Error('expected the dispatch to reject'); },
        (e: Record<string, unknown>) => e,
      );

      expect(err.pipelineReason as string).toMatch(/^[a-z][a-z0-9_]{1,63}$/);
    });
  });

  describe('the cases the gate must NOT touch', () => {
    it('a populated graph commits exactly as before', async () => {
      mockDraft(POPULATED_GRAPH);

      const result = await dispatch();

      expect(result.commitPerformed).toBe(true);
      expect(commitDirectAnswer).toHaveBeenCalledOnce();
    });

    it('a NULL graphOutput still commits — the deliberately-supported graphless path', async () => {
      // The opposite-direction twin, and the reason the gate is not written
      // against the `?? 0` count expression. If this ever goes red, the gate has
      // widened into a path that exists to seed `scenarios.brief_text`.
      mockDraft(null);

      const result = await dispatch();

      expect(result.commitPerformed).toBe(true);
      expect(commitDirectAnswer).toHaveBeenCalledOnce();
    });
  });
});
