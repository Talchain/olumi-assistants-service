/**
 * V5 H5 — `dispatchEditGraph` false-success invariant tests.
 *
 * The V4 Mode B fix in `handleEditGraph` drops `llmResult.coaching.summary`
 * passthrough on the no-op path so success-claim narration cannot be
 * forwarded by that emit path. This file pins the V5-side defence-in-depth:
 * if ANY future emit path returns wasRejected=false + empty operations +
 * no applied graph with success-claim language in assistantText, the
 * dispatcher rewrites assistant_text to the neutral fallback before commit.
 *
 * Counterpart to `edit-graph-dispatch-fact-emission.test.ts`:
 *   - That file pins the receipt-emission contract (PR #163 / DL-7 PR B).
 *   - This file pins that the wire CANNOT carry a success claim that no
 *     persisted state backs.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

// ── module-level mocks ──────────────────────────────────────────────

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

// Capture telemetry emissions to assert on the false-success rewrite event.
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return {
    ...actual,
    emit: vi.fn(),
  };
});

// ── imports after mocks ─────────────────────────────────────────────

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { emit, TelemetryEvents } from '../../../utils/telemetry.js';
import {
  EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT,
} from '../../compose/forbidden-user-facing-phrases.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

// ── helpers ─────────────────────────────────────────────────────────

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message: 'Make Price more important.',
    turn_class: 'frame' as const,
    source: 'composer' as const,
    ...overrides,
  };
}

const INGRESS_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_price', kind: 'factor', label: 'Price' },
  ],
  edges: [{ from: 'fac_price', to: 'goal_revenue' }],
};

function makeNoOpFalseSuccessResult(assistantText: string): EditGraphResult {
  return {
    blocks: [],
    assistantText,
    latencyMs: 500,
    appliedGraph: null,
    wasRejected: false,
    operations: [],
  };
}

function makeAppliedSuccessResult(assistantText: string): EditGraphResult {
  return {
    blocks: [],
    assistantText,
    latencyMs: 1000,
    appliedGraph: {
      nodes: [
        { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
        { id: 'fac_price', kind: 'factor', label: 'Price (revised)' },
      ],
      edges: [
        {
          from: 'fac_price',
          to: 'goal_revenue',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'positive' as const,
        },
      ],
    } as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [
      { op: 'update_node', path: 'fac_price', value: { label: 'Price (revised)' } },
    ],
    appliedChanges: {
      summary: 'Renamed "Price" to "Price (revised)"',
      changes: [
        { label: 'Price', description: 'Renamed.', element_ref: 'fac_price' },
      ],
      rerun_recommended: false,
    },
    operation_meta: [{ impact: 'low', rationale: '' }],
  };
}

function makeCommitResult() {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-test',
    graphPersisted: true,
  };
}

const STUB_REQUEST = {} as FastifyRequest;

// ── tests ───────────────────────────────────────────────────────────

describe('dispatchEditGraph — V5 H5 false-success invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rewrites assistant_text to neutral fallback when no-commit result carries success-claim language', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(
        makeNoOpFalseSuccessResult(
          "I've successfully updated the Price factor to reflect your request.",
        ),
      );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-false-success-1',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(out.response.assistant_text).toBe(EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT);
    expect(out.response.assistant_text).not.toMatch(/successfully\s+updated/i);
  });

  it('emits V5EditGraphFalseSuccessRewritten telemetry on rewrite', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(
        makeNoOpFalseSuccessResult("I've applied the change to Price."),
      );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-false-success-2',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    const emitMock = emit as MockedFunction<typeof emit>;
    const falseSuccessCalls = emitMock.mock.calls.filter(
      ([eventName]) => eventName === TelemetryEvents.V5EditGraphFalseSuccessRewritten,
    );
    expect(falseSuccessCalls.length).toBe(1);
    const [, payload] = falseSuccessCalls[0];
    expect((payload as Record<string, unknown>).request_id).toBe('req-false-success-2');
    expect((payload as Record<string, unknown>).scenario_id).toBe(SCENARIO_ID);
    expect((payload as Record<string, unknown>).dispatch_path).toBe('edit_graph_finalise');
    expect((payload as Record<string, unknown>).original_phrase).toMatch(/applied/i);
  });

  it('does NOT rewrite when no-commit result carries honest forward-looking copy', async () => {
    // The Mode B fix uses forward-looking copy ("Tell me the specific
    // factor and value…") rather than a denial ("No changes were
    // needed…"). The forward-looking copy must pass both the
    // false-success invariant (no success-claim language) and the
    // existing forbidden-phrase guard (no denial language).
    const honestNoOp =
      'I couldn’t see a concrete change to make from that description. Tell me the specific factor and value you’d like, and I’ll apply it directly.';
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(makeNoOpFalseSuccessResult(honestNoOp));
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-honest-noop',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(out.response.assistant_text).toBe(honestNoOp);
    const emitMock = emit as MockedFunction<typeof emit>;
    const falseSuccessCalls = emitMock.mock.calls.filter(
      ([eventName]) => eventName === TelemetryEvents.V5EditGraphFalseSuccessRewritten,
    );
    expect(falseSuccessCalls.length).toBe(0);
  });

  it('does NOT rewrite when no-commit result carries Mode A propose-and-confirm copy', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue({
        ...makeNoOpFalseSuccessResult(
          "I have a change in mind for **Price**, but I need the specifics to apply it directly. Reply with the exact change you'd like (e.g. \"Set Price to 120k\" or \"Lower Price by 20%\") and I'll make it.",
        ),
      });
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-mode-a',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(out.response.assistant_text).toMatch(/I have a change in mind/);
    const emitMock = emit as MockedFunction<typeof emit>;
    const falseSuccessCalls = emitMock.mock.calls.filter(
      ([eventName]) => eventName === TelemetryEvents.V5EditGraphFalseSuccessRewritten,
    );
    expect(falseSuccessCalls.length).toBe(0);
  });

  it('does NOT rewrite on a happy-path commit even when text contains legitimate success language', async () => {
    // wasRejected=false + appliedGraph present + operations non-empty.
    // The invariant requires ALL of: no operations + no applied graph.
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(
        makeAppliedSuccessResult("I've updated Price to 'Price (revised)'."),
      );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-happy-path',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(out.response.assistant_text).toMatch(/I['’]ve updated/);
    const emitMock = emit as MockedFunction<typeof emit>;
    const falseSuccessCalls = emitMock.mock.calls.filter(
      ([eventName]) => eventName === TelemetryEvents.V5EditGraphFalseSuccessRewritten,
    );
    expect(falseSuccessCalls.length).toBe(0);
  });

  it('does NOT rewrite when result is rejected (wasRejected=true) even with operations empty', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue({
        blocks: [],
        assistantText:
          "The proposed change wasn't applied. Try restating the specific value.",
        latencyMs: 500,
        appliedGraph: null,
        wasRejected: true,
        operations: [],
      });
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-rejected',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(out.response.assistant_text).toMatch(/wasn't applied/);
    const emitMock = emit as MockedFunction<typeof emit>;
    const falseSuccessCalls = emitMock.mock.calls.filter(
      ([eventName]) => eventName === TelemetryEvents.V5EditGraphFalseSuccessRewritten,
    );
    expect(falseSuccessCalls.length).toBe(0);
  });
});
