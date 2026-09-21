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

import { describe, it, expect, vi, beforeEach, type MockedFunction, afterEach } from 'vitest';
import { _resetConfigCache } from '../../../config/index.js';
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

// V5-PERSIST-FIX-01: stub ONLY the strict persisted read so applied
// mutations do not fail closed against the unconfigured test store.
// `null` = a genuinely-empty scenarios.graph → ingress-base fallback merge,
// i.e. the same (request-graph) base these tests used before the fix.
// Everything else in build-turn-context stays real.
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
  };
});

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

// ── ROADMAP 2.474 / A10 — the mode is now STATED, not inherited ──────────
// `CEE_GRAPH_MANAGEMENT_MODE`'s repo default moved 'off' → 'live' (the referee
// ships ON; a trust story hanging on a dashboard variable is one careless edit
// from being untrue). This file pins PERSISTENCE mechanics — the merge base,
// the projection, the advertised hash — on a turn that reaches the commit. It
// was authored under the implicit 'off' default, and that premise is exactly
// what it needs: 'off' is the mode in which the existing path proceeds
// byte-identically, so the seam under test is reached unchanged. Stating it
// here preserves the property this file was written to prove, and makes the
// dependency visible instead of inherited. Live-mode ROUTING is covered by its
// own files (edit-graph-dispatch-graph-management-modes.test.ts and the
// referee-gate suites), which is where a live regression would surface.
beforeEach(() => {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
  _resetConfigCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

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

// ---------------------------------------------------------------------------
// V5 H5 — graph-persistence backstop (Codex round-1 P1).
//
// `commitDirectAnswer` previously received
// `graph: editResult.appliedGraph ?? undefined` unconditionally. The
// fact-emission gate uses `isSuccessfulAppliedMutation()` which
// requires `wasRejected=false + operations.length > 0 + appliedGraph
// present`. The two gates were asymmetric: a future impossible-but-
// not-enforced shape (`appliedGraph` populated, `operations` empty)
// would persist graph state with no receipt fact. The backstop binds
// both gates so the invariant is symmetric.
// ---------------------------------------------------------------------------

describe('dispatchEditGraph — V5 H5 graph-persistence backstop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists graph state on a true successful applied mutation', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(
        makeAppliedSuccessResult("I've updated Price to 'Price (revised)'."),
      );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-graph-persist-yes',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    const commitMock = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
    const [, metadata] = commitMock.mock.calls[0]!;
    expect(metadata.graph).toBeDefined();
    expect(metadata.graph).not.toBeNull();
  });

  it('does NOT persist graph state when wasRejected=false but operations are empty', async () => {
    // The impossible-but-not-enforced shape: handler returns
    // appliedGraph WITHOUT operations. This should never happen in
    // production today, but the persistence gate now matches the
    // fact-emission gate so a future regression cannot leak graph
    // state without a receipt.
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue({
        blocks: [],
        assistantText:
          'I couldn’t see a concrete change to make from that description. Tell me the specific factor and value you’d like, and I’ll apply it directly.',
        latencyMs: 500,
        appliedGraph: {
          nodes: [{ id: 'goal_revenue', kind: 'goal', label: 'Revenue' }],
          edges: [],
        } as unknown as EditGraphResult['appliedGraph'],
        wasRejected: false,
        operations: [], // empty
      });
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-graph-persist-no',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    const commitMock = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
    const [, metadata] = commitMock.mock.calls[0]!;
    expect(metadata.graph).toBeUndefined();
    expect(metadata.handler_facts).toEqual([]);
  });

  it('does NOT persist graph state on a true no-op (appliedGraph null, operations empty)', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(
        makeNoOpFalseSuccessResult(
          'I couldn’t see a concrete change to make from that description. Tell me the specific factor and value you’d like, and I’ll apply it directly.',
        ),
      );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-true-noop',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    const commitMock = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
    const [, metadata] = commitMock.mock.calls[0]!;
    expect(metadata.graph).toBeUndefined();
    expect(metadata.handler_facts).toEqual([]);
  });

  it('does NOT persist graph state on a rejection (wasRejected=true)', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue({
        blocks: [],
        assistantText: 'The proposed edit was rejected.',
        latencyMs: 500,
        appliedGraph: null,
        wasRejected: true,
        operations: [],
      });
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-rejected-graph',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    const commitMock = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
    const [, metadata] = commitMock.mock.calls[0]!;
    expect(metadata.graph).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// V5 H5 — unified mutation predicate (Codex round-2 P1).
//
// `isSuccessfulAppliedMutation()` is now the single source of truth
// for "did the mutation truly apply?". Previously it was applied
// only at the commit boundary; other code paths (false-success
// rewrite, analysisReady, freshness, returned graph) still inspected
// `editResult.appliedGraph` directly. This left the impossible shape
// (`appliedGraph + empty operations`) able to:
//   - return success prose via the rewrite check,
//   - stamp analysis_ready from an unpersisted graph,
//   - derive freshness against an unpersisted graph,
//   - return the unpersisted graph to route-v2.
//
// These tests pin that the impossible shape now blocks ALL of those
// effects, not just commit-time graph persistence.
// ---------------------------------------------------------------------------

describe('dispatchEditGraph — V5 H5 unified mutation predicate (Codex round-2 P1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeImpossibleShapeResult(assistantText: string): EditGraphResult {
    return {
      blocks: [],
      assistantText,
      latencyMs: 500,
      // Non-null appliedGraph WITHOUT operations — impossible shape.
      appliedGraph: {
        nodes: [{ id: 'goal_revenue', kind: 'goal', label: 'Revenue' }],
        edges: [],
      } as unknown as EditGraphResult['appliedGraph'],
      wasRejected: false,
      operations: [],
    };
  }

  it('false-success rewrite FIRES on impossible shape with success-claim text', async () => {
    // Previously: rewrite did NOT fire because `!editResult.appliedGraph`
    // was false (appliedGraph is set). The unified predicate now
    // correctly classifies this as no-commit and the rewrite fires.
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(
        makeImpossibleShapeResult("I've successfully updated the Price factor."),
      );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-impossible-rewrite',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(out.response.assistant_text).toBe(
      "Let me know what you'd like me to do next, and I'll take it from there.",
    );
    const emitMock = emit as MockedFunction<typeof emit>;
    const falseSuccessCalls = emitMock.mock.calls.filter(
      ([eventName]) => eventName === TelemetryEvents.V5EditGraphFalseSuccessRewritten,
    );
    expect(falseSuccessCalls.length).toBe(1);
  });

  it('analysisReady is undefined on impossible shape (no stamping from unpersisted graph)', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(makeImpossibleShapeResult('Some honest copy.'));
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-impossible-analysisready',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(out.analysisReady).toBeUndefined();
  });

  it('returned graph is null on impossible shape (no leak to route-v2 / wire envelope)', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(makeImpossibleShapeResult('Some honest copy.'));
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-impossible-returned-graph',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(out.graph).toBeNull();
  });

  it('returned graph is the appliedGraph on a true successful applied mutation', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(
        makeAppliedSuccessResult("I've updated Price to 'Price (revised)'."),
      );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-true-success-returned-graph',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(out.graph).not.toBeNull();
    expect(out.analysisReady).toBeDefined();
  });

  it('returned graph is null on a true no-op (no false leak via the return value)', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(
        makeNoOpFalseSuccessResult(
          'I couldn’t see a concrete change to make from that description.',
        ),
      );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-noop-returned-graph',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(out.graph).toBeNull();
    expect(out.analysisReady).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// V5 appliedGraph-persistence fix — structural-invariant backstop.
//
// Post-H5 follow-up. The staging Layer-B replay surfaced the EXACT shape
// the V4 source fix targets: V4 returns `wasRejected: false` AND
// `operations.length > 0` AND `appliedGraph == null`. Under that
// signature, the LLM-authored prose ("Strengthened the headcount
// investment to delivery capacity edge from ~0.15 to 0.32...") is
// SAFE-LOOKING but not backed by any persisted state. The
// `findSuccessClaimHit` regex set doesn't enumerate every variant
// Sonnet produces — "Strengthened the X edge" does NOT match the
// existing regex set. The structural backstop fires UNCONDITIONALLY
// (no regex check) for this shape so the prose can never reach the
// wire regardless of how it's phrased.
//
// After the V4 source fix lands, V4 should never return this shape
// from the success branch — but the backstop remains live to catch
// future regressions in the V4 success-branch's appliedGraph plumbing.
// ---------------------------------------------------------------------------

describe('dispatchEditGraph — V5 structural-invariant backstop (ops + !appliedGraph)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeOpsButNoAppliedGraph(assistantText: string): EditGraphResult {
    // The exact shape the staging replay surfaced: V4 returns operations
    // and appliedChanges and LLM coaching prose, but PLoT didn't supply
    // applied_graph and the V4 success branch left it null.
    return {
      blocks: [],
      assistantText,
      latencyMs: 9500,
      appliedGraph: null,
      wasRejected: false,
      operations: [
        { op: 'update_edge', path: 'fac_price->goal_revenue', value: 0.32 },
      ],
    };
  }

  it('rewrites assistant_text UNCONDITIONALLY when ops > 0 and appliedGraph null (no regex check)', async () => {
    // The staging replay text. It does NOT match findSuccessClaimHit
    // (no "I've"/"successfully"/"has been"/etc. + line-leading
    // "Strengthened" is not in the regex's verb set). Pre-fix this
    // text would reach the user; with the structural backstop it
    // must be rewritten.
    const stagingProse =
      'Strengthened the headcount investment to delivery capacity edge from ~0.15 to 0.32 ' +
      'and raised its existence probability to 0.88. This makes the factor more influential in the model.';

    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(makeOpsButNoAppliedGraph(stagingProse));
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-structural-backstop',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(out.response.assistant_text).toBe(
      "Let me know what you'd like me to do next, and I'll take it from there.",
    );
    // No success-shaped prose can leak.
    expect(out.response.assistant_text).not.toMatch(/Strengthened/);
    expect(out.response.assistant_text).not.toMatch(/edge from/);
    // No false claim that anything was applied.
    expect(out.response.assistant_text).not.toMatch(/applied|updated/i);
  });

  it('emits V5EditGraphAppliedGraphMissingWithOperations telemetry (not the regex-based event)', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(
        makeOpsButNoAppliedGraph(
          'Strengthened the X to Y edge from 0.5 to 0.7.',
        ),
      );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-structural-telemetry',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    const emitMock = emit as MockedFunction<typeof emit>;
    const structuralCalls = emitMock.mock.calls.filter(
      ([eventName]) =>
        eventName === TelemetryEvents.V5EditGraphAppliedGraphMissingWithOperations,
    );
    const regexCalls = emitMock.mock.calls.filter(
      ([eventName]) => eventName === TelemetryEvents.V5EditGraphFalseSuccessRewritten,
    );
    expect(structuralCalls.length).toBe(1);
    // The regex-based event must NOT also fire — the structural backstop
    // takes the rewrite responsibility and the two events serve distinct
    // diagnostic purposes (regression dashboards).
    expect(regexCalls.length).toBe(0);

    const [, payload] = structuralCalls[0];
    const data = payload as Record<string, unknown>;
    expect(data.request_id).toBe('req-structural-telemetry');
    expect(data.scenario_id).toBe(SCENARIO_ID);
    expect(data.operations_count).toBe(1);
    expect(data.dispatch_path).toBe('edit_graph_finalise');
  });

  it('does NOT persist graph or emit fact under the structural-mismatch shape', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(
        makeOpsButNoAppliedGraph('Strengthened the X edge.'),
      );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-structural-no-persist',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    const commitMock = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
    const [, metadata] = commitMock.mock.calls[0]!;
    expect(metadata.graph).toBeUndefined();
    expect(metadata.handler_facts).toEqual([]);
  });

  it('still rewrites via regex backstop when operations=[] AND text matches success-claim regex (Mode B regression backstop)', async () => {
    // Sub-case B: operations is empty, but text matches regex. The
    // existing regex-based backstop must keep firing for this case.
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue({
        blocks: [],
        assistantText: "I've successfully updated the value.",
        latencyMs: 500,
        appliedGraph: null,
        wasRejected: false,
        operations: [],
      });
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-regex-backstop-still-fires',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(out.response.assistant_text).toBe(
      "Let me know what you'd like me to do next, and I'll take it from there.",
    );

    const emitMock = emit as MockedFunction<typeof emit>;
    // Regex-based event fires (operations=[] subcase), structural does NOT.
    const regexCalls = emitMock.mock.calls.filter(
      ([eventName]) => eventName === TelemetryEvents.V5EditGraphFalseSuccessRewritten,
    );
    const structuralCalls = emitMock.mock.calls.filter(
      ([eventName]) =>
        eventName === TelemetryEvents.V5EditGraphAppliedGraphMissingWithOperations,
    );
    expect(regexCalls.length).toBe(1);
    expect(structuralCalls.length).toBe(0);
  });

  it('does NOT fire structural backstop on a true successful applied mutation', async () => {
    // operations > 0 AND appliedGraph present → successfulAppliedMutation
    // is true → neither backstop fires.
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValue(
        makeAppliedSuccessResult("I've updated Price to 'Price (revised)'."),
      );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-happy-no-backstop',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(out.response.assistant_text).toMatch(/I['’]ve updated/);
    const emitMock = emit as MockedFunction<typeof emit>;
    expect(
      emitMock.mock.calls.filter(
        ([eventName]) =>
          eventName === TelemetryEvents.V5EditGraphAppliedGraphMissingWithOperations,
      ).length,
    ).toBe(0);
    expect(
      emitMock.mock.calls.filter(
        ([eventName]) => eventName === TelemetryEvents.V5EditGraphFalseSuccessRewritten,
      ).length,
    ).toBe(0);
  });
});
