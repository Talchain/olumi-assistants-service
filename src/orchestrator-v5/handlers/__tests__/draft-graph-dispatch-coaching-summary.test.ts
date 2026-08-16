/**
 * F1 PR A — analysis_ready.coaching_summary emission on the post-draft path.
 *
 * dispatchDraftGraph attaches a short, sanitised, pre-analysis "assumption to
 * check" line to the analysis_ready payload it surfaces to the response
 * finaliser. DGAI (PR B) reads it to populate the already-built
 * ModelReceiptBlock; nothing renders it today.
 *
 * These tests pin the CEE-side contract:
 *   - emitted only when graph persisted + exact ready status + safe prose exists;
 *   - omitted before reading freeform coaching for every non-ready status;
 *   - sanitised via the egress scrub (analysis_ready is NOT walked by the
 *     central envelope sanitiser, so the dispatch must scrub it);
 *   - omitted when no safe summary exists, or when the graph did not persist;
 *   - existing analysis_ready fields unchanged; no new wire block;
 *   - no lifecycle / coaching_state field reaches the wire;
 *   - the stamped envelope still satisfies the strict boundary contract.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { DraftGraphResult } from '../../../orchestrator/tools/draft-graph.js';

// ── module-level mocks ──────────────────────────────────────────────────────

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

// ── imports after mocks ──────────────────────────────────────────────────────

import { dispatchDraftGraph } from '../draft-graph-dispatch.js';
import { handleDraftGraph } from '../../../orchestrator/tools/draft-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { canonicalCommitResultFixture } from './canonical-commit-result-fixture.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUB_REQUEST = {} as FastifyRequest;

const MINIMAL_GRAPH = {
  nodes: [{ id: 'dec_launch', kind: 'decision', label: 'Launch?' }],
  edges: [{ from: 'dec_launch', to: 'goal_revenue' }],
};

const MINIMAL_ANALYSIS_READY = {
  status: 'ready',
  options: [
    { option_id: 'opt_launch_now', label: 'Launch now', status: 'ready', interventions: { fac_revenue: 0.8 } },
    { option_id: 'opt_delay', label: 'Delay 6mo', status: 'ready', interventions: { fac_revenue: 0.3 } },
  ],
  goal_node_id: 'goal_revenue',
} as unknown as NonNullable<DraftGraphResult['analysisReady']>;

const NEEDS_INPUT_GRAPH = {
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Choose a launch route' },
    { id: 'opt_launch_now', kind: 'option', label: 'Launch now' },
    { id: 'opt_delay', kind: 'option', label: 'Delay 6mo' },
    { id: 'fac_revenue', kind: 'factor', label: 'Revenue impact' },
  ],
  edges: [],
};

const NEEDS_INPUT_ANALYSIS_READY = {
  status: 'needs_user_input',
  options: [
    { option_id: 'opt_launch_now', label: 'Launch now', status: 'needs_user_mapping', interventions: {} },
    { option_id: 'opt_delay', label: 'Delay 6mo', status: 'ready', interventions: { fac_revenue: 0.3 } },
  ],
  goal_node_id: 'goal_revenue',
  blockers: [{
    option_id: 'opt_launch_now',
    option_label: 'Launch now',
    factor_id: 'fac_revenue',
    factor_label: 'Revenue impact',
    blocker_type: 'missing_value',
    suggested_action: 'add_value',
  }],
} as unknown as NonNullable<DraftGraphResult['analysisReady']>;

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

function makeDraftResult(opts: {
  graphOutput?: unknown;
  analysisReady?: unknown;
  strengthenItems?: unknown[];
  coachingBiasSignals?: unknown[] | null;
} = {}) {
  return {
    blocks: [],
    assistantText: 'Drafted a decision graph.',
    latencyMs: 1000,
    strengthenItems: opts.strengthenItems ?? [],
    coachingSummary: null,
    coachingWideningLog: null,
    coachingBiasSignals: opts.coachingBiasSignals ?? null,
    draftWarnings: [],
    graphOutput: opts.graphOutput ?? MINIMAL_GRAPH,
    ...(opts.analysisReady !== undefined && { analysisReady: opts.analysisReady }),
  };
}

function makeCommitResult(graphPersisted: boolean) {
  return canonicalCommitResultFixture(graphPersisted ? MINIMAL_GRAPH : null, {
    persistedRowId: 'row-1',
  });
}

function mockPipeline(draftResult: unknown, graphPersisted: boolean): void {
  (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
    .mockResolvedValue(draftResult as Awaited<ReturnType<typeof handleDraftGraph>>);
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
    .mockResolvedValue(makeCommitResult(graphPersisted) as Awaited<ReturnType<typeof commitDirectAnswer>>);
}

const SAFE_STRENGTHEN = [{ detail: 'the delivery timeline may be optimistic' }];
const EXPECTED_SAFE_SUMMARY =
  'One assumption worth checking: the delivery timeline may be optimistic.';

// ── tests ──────────────────────────────────────────────────────────────────

describe('dispatchDraftGraph — analysis_ready.coaching_summary (F1 PR A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits a sanitised coaching_summary when the graph persists and safe prose exists', async () => {
    mockPipeline(
      makeDraftResult({ analysisReady: MINIMAL_ANALYSIS_READY, strengthenItems: SAFE_STRENGTHEN }),
      true,
    );

    const res = await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-1', request: STUB_REQUEST });

    expect(res.analysisReady).toBeDefined();
    expect((res.analysisReady as { coaching_summary?: string }).coaching_summary).toBe(
      EXPECTED_SAFE_SUMMARY,
    );
  });

  it('scrubs entity-ID leaks from the summary (analysis_ready is not walked by the envelope sanitiser)', async () => {
    // `node_*` passes the assumption gate (the gate's ID detector omits the
    // `node` prefix) but is a high-confidence multi-segment orphan the
    // coaching scrub replaces with a prefix-aware generic — proving the
    // dispatch applies sanitiseCoachingProse to the summary.
    mockPipeline(
      makeDraftResult({
        analysisReady: MINIMAL_ANALYSIS_READY,
        strengthenItems: [{ detail: 'node_revenue_target may be optimistic' }],
      }),
      true,
    );

    const res = await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-2', request: STUB_REQUEST });

    const summary = (res.analysisReady as { coaching_summary?: string }).coaching_summary ?? '';
    expect(summary).not.toContain('node_revenue_target');
    expect(summary).toContain('the relevant element');
  });

  it('omits coaching_summary when only the generic fallback applies', async () => {
    // No coaching signals + a graph with no factor/uncertainty material →
    // pickAssumption falls to the deterministic generic → helper returns null
    // → the field is omitted (the receipt renders without a top-insight).
    mockPipeline(makeDraftResult({ analysisReady: MINIMAL_ANALYSIS_READY }), true);

    const res = await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-3', request: STUB_REQUEST });

    expect(res.analysisReady).toBeDefined();
    expect('coaching_summary' in (res.analysisReady as object)).toBe(false);
  });

  it('serves only deterministic recovery and no receipt coaching when a real dispatch is non-ready', async () => {
    const freeformAction = 'run the analysis before committing to a route';
    mockPipeline(
      makeDraftResult({
        graphOutput: NEEDS_INPUT_GRAPH,
        analysisReady: NEEDS_INPUT_ANALYSIS_READY,
        strengthenItems: [{
          id: 'freeform-action',
          label: 'Check launch timing',
          detail: freeformAction,
          action_type: 'add_context',
        }],
      }),
      true,
    );

    const res = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-non-ready',
      request: STUB_REQUEST,
    });

    expect(res.response.assistant_text.toLowerCase()).not.toContain(freeformAction);
    expect(res.response.assistant_text).not.toMatch(/\brun the analysis\b/i);
    expect(res.response.assistant_text).toContain(
      "Assumption to check: whether the model's key inputs reflect your real delivery constraints",
    );
    expect(res.response.assistant_text).toContain(
      'Next, choose the missing effect value for "Launch now" on "Revenue impact" so the comparison can be prepared.',
    );
    expect(res.analysisReady).toBeDefined();
    expect('coaching_summary' in (res.analysisReady as object)).toBe(false);
  });

  it('emits no analysis_ready (and so no coaching_summary) when the graph did not persist', async () => {
    mockPipeline(
      makeDraftResult({ analysisReady: MINIMAL_ANALYSIS_READY, strengthenItems: SAFE_STRENGTHEN }),
      false,
    );

    const res = await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-4', request: STUB_REQUEST });

    expect(res.analysisReady).toBeUndefined();
  });

  it('leaves existing analysis_ready fields unchanged and emits no new wire block', async () => {
    mockPipeline(
      makeDraftResult({ analysisReady: MINIMAL_ANALYSIS_READY, strengthenItems: SAFE_STRENGTHEN }),
      true,
    );

    const res = await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-5', request: STUB_REQUEST });

    const ar = res.analysisReady as { status?: string; goal_node_id?: string; options?: unknown[] };
    expect(ar.status).toBe('ready');
    expect(ar.goal_node_id).toBe('goal_revenue');
    expect(ar.options).toHaveLength(2);
    // No new wire block is introduced on the draft path.
    expect(res.response.blocks).toEqual([]);
  });

  it('does not leak any lifecycle / coaching_state field onto the wire', async () => {
    mockPipeline(
      makeDraftResult({ analysisReady: MINIMAL_ANALYSIS_READY, strengthenItems: SAFE_STRENGTHEN }),
      true,
    );

    const res = await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-6', request: STUB_REQUEST });

    const ar = res.analysisReady as Record<string, unknown>;
    expect('coaching_state' in ar).toBe(false);
    expect('coaching_lifecycle' in ar).toBe(false);
    expect('prior_coaching_state' in ar).toBe(false);
    expect('coaching_state' in (res.response as Record<string, unknown>)).toBe(false);
  });

  it('keeps the stamped envelope valid under the strict boundary contract (passthrough preserves the field)', async () => {
    mockPipeline(
      makeDraftResult({ analysisReady: MINIMAL_ANALYSIS_READY, strengthenItems: SAFE_STRENGTHEN }),
      true,
    );

    const res = await dispatchDraftGraph({ payload: makePayload(), requestId: 'req-7', request: STUB_REQUEST });

    // Simulate the finaliser stamping analysis_ready onto the envelope.
    const stamped = { ...res.response, analysis_ready: res.analysisReady };
    const parsed = OlumiResponseSchema.safeParse(stamped);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data.analysis_ready as { coaching_summary?: string }).coaching_summary).toBe(
        EXPECTED_SAFE_SUMMARY,
      );
    }
  });
});
