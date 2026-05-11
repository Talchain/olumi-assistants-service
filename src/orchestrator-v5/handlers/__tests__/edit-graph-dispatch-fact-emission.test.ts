/**
 * V5 — `dispatchEditGraph` fact-emission tests (DL-7 PR B).
 *
 * Pins the contract that successful applied mutations now emit a
 * canonical `EditGraphHandlerFact` via the `commitDirectAnswer` call's
 * `handler_facts` parameter, while preserving `turn_class:
 * 'direct_answer'` (per War Room correction — the response-finaliser
 * path stays unchanged).
 *
 * Sibling to `edit-graph-dispatch.test.ts` which pins the R-001 graph
 * persistence contract; this file pins the receipt-emission contract.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';
import type { AppliedChanges, PatchOperation } from '../../../orchestrator/types.js';

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

// Default behaviour: pass through to the real fact-builder module.
// Individual tests that need to force a rich-builder throw replace
// `buildEditGraphHandlerFact` via the mock instance below; tests that
// need to force the generic-fallback builder to throw replace
// `buildGenericEditGraphHandlerFact` similarly.
vi.mock('../edit-graph-fact-builder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../edit-graph-fact-builder.js')>();
  return {
    ...actual,
    buildEditGraphHandlerFact: vi.fn(actual.buildEditGraphHandlerFact),
    buildGenericEditGraphHandlerFact: vi.fn(actual.buildGenericEditGraphHandlerFact),
  };
});

// ── imports after mocks ─────────────────────────────────────────────

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import {
  buildEditGraphHandlerFact,
  buildGenericEditGraphHandlerFact,
} from '../edit-graph-fact-builder.js';
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
    message: 'Rename Price to Price (revised)',
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

const POST_EDIT_GRAPH = {
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
};

const APPLIED_CHANGES: AppliedChanges = {
  summary: 'Renamed "Price" to "Price (revised)"',
  changes: [
    { label: 'Price', description: 'Renamed.', element_ref: 'fac_price' },
  ],
  rerun_recommended: false,
};

const PARAM_UPDATE_OPS: PatchOperation[] = [
  { op: 'update_node', path: 'fac_price', value: { label: 'Price (revised)' } },
];

function makeAppliedEditResult(overrides: Partial<EditGraphResult> = {}): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Renamed "Price" to "Price (revised)"',
    latencyMs: 1000,
    appliedGraph: POST_EDIT_GRAPH as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    appliedChanges: APPLIED_CHANGES,
    operations: PARAM_UPDATE_OPS,
    operation_meta: [{ impact: 'low', rationale: '' }],
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

function makeNoopEditResult(): EditGraphResult {
  return {
    blocks: [],
    // V5 H5 — `handleEditGraph` no-op path now emits forward-looking
    // copy ("Tell me the specific factor and value…") rather than a
    // denial ("No changes were needed…"). Denial phrasing matches the
    // FORBIDDEN_USER_FACING_PHRASES list and would be rewritten to the
    // generic neutral fallback at the dispatcher egress. The fixture
    // here mirrors production so this test exercises the same string
    // the dispatcher actually receives.
    assistantText:
      'I couldn’t see a concrete change to make from that description. Tell me the specific factor and value you’d like, and I’ll apply it directly.',
    latencyMs: 500,
    appliedGraph: POST_EDIT_GRAPH as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [],
    appliedChanges: undefined,
  };
}

function makeCommitResult(graphPersisted: boolean) {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-edit-fact',
    graphPersisted,
  };
}

const STUB_REQUEST = {} as FastifyRequest;

// ── tests ───────────────────────────────────────────────────────────

describe('dispatchEditGraph — DL-7 PR B fact emission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('successful applied mutation', () => {
    it('B1 emits an EditGraphHandlerFact via commitDirectAnswer.handler_facts', async () => {
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeAppliedEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-fact-1',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0]!;
      expect(metadata.handler_facts.length).toBe(1);
      const fact = metadata.handler_facts[0];
      expect(fact.fact_type).toBe('edit_graph');
      expect(fact.fact_version).toBe(1);
      expect(fact.noop).toBe(false);
      expect(fact.result.status).toBe('applied');
      expect(fact.result.operations_count).toBe(1);
    });

    it('B2 emitted fact carries display-safe summary (no raw IDs)', async () => {
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeAppliedEditResult({
          appliedChanges: {
            summary: 'Updated fac_price for the customer.',
            changes: [{ label: 'Price', description: 'Updated.', element_ref: 'fac_price' }],
            rerun_recommended: false,
          },
        }));
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-fact-scrub',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0]!;
      const fact = metadata.handler_facts[0];
      expect(fact.result.safe_summary).not.toContain('fac_price');
    });

    it('B3 PRESERVES turn_class: direct_answer (War Room correction)', async () => {
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeAppliedEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-fact-turnclass',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0]!;
      // Critical contract pin: PR B emits a fact while keeping
      // turn_class === 'direct_answer'. Verified at the SQL layer that
      // append_turn_atomic accepts handler_facts non-empty alongside
      // turn_class='direct_answer' (no coupling). Flipping turn_class
      // would require explicit re-authorisation per War Room.
      expect(metadata.turn_class).toBe('direct_answer');
    });

    it('B4 KEEPS handler_id: null (V5ActionType expansion is out of PR B scope)', async () => {
      // Setting metadata.handler_id to 'edit_graph' would require the
      // schemas-vendor `V5ActionType` enum to include 'edit_graph' as
      // a valid action — a schemas-vendor change like PR A. PR B's
      // authorised scope keeps the turn-row `handler_id` null and
      // relies on the fact-level `fact_type === 'edit_graph'` as the
      // canonical discriminator. Downstream consumers
      // (recent_changes, state-query guard, prior_facts readers)
      // filter on `fact_type`, not on parent turn's handler_id.
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeAppliedEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-fact-handler',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0]!;
      expect(metadata.handler_id).toBeNull();
      // BUT the fact itself is emitted with fact_type 'edit_graph'.
      expect(metadata.handler_facts).toHaveLength(1);
      expect(metadata.handler_facts[0].fact_type).toBe('edit_graph');
    });
  });

  describe('emission gates — no fact emitted', () => {
    it('B5 rejected edit emits NO fact (handler_facts stays [])', async () => {
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeRejectedEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(false) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-fact-rejected',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0]!;
      expect(metadata.handler_facts).toEqual([]);
      // Rejected edits also keep handler_id=null per the existing
      // contract, since no successful mutation occurred.
      expect(metadata.handler_id).toBeNull();
    });

    it('B6 noop / zero-ops edit emits NO fact', async () => {
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeNoopEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-fact-noop',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0]!;
      expect(metadata.handler_facts).toEqual([]);
    });

    it('B7 missing appliedChanges emits the GENERIC fallback fact (war-room correction)', async () => {
      // War-room correction: a successful applied mutation MUST NOT
      // commit with handler_facts: [] just because the rich path
      // doesn't have appliedChanges. The dispatch falls back to the
      // generic builder, emitting a minimal-but-valid fact with
      // safe_summary="Updated the decision model." and
      // affected_entities=[].
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeAppliedEditResult({ appliedChanges: undefined }));
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-fact-no-applied-changes',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0]!;
      expect(metadata.handler_facts).toHaveLength(1);
      const fact = metadata.handler_facts[0];
      expect(fact.fact_type).toBe('edit_graph');
      expect(fact.result.safe_summary).toBe('Updated the decision model.');
      expect(fact.result.affected_entities).toEqual([]);
      expect(fact.result.status).toBe('applied');
      expect(fact.noop).toBe(false);
    });

    it('B10 rich-builder returns null (no appliedChanges) → still emits a fact via generic fallback', async () => {
      // Companion to B11: B10 covers the rich-builder-returns-null
      // path (missing appliedChanges). B11 covers the
      // rich-builder-throws path. Both must produce a fact.
      const editResult = makeAppliedEditResult({ appliedChanges: undefined });
      (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(editResult);
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-fact-fallback',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0]!;
      expect(metadata.handler_facts.length).toBeGreaterThan(0);
      const fact = metadata.handler_facts[0];
      expect(fact.fact_type).toBe('edit_graph');
      expect(fact.result.status).toBe('applied');
      expect(fact.noop).toBe(false);
      expect(fact.result.operations_count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('direct_answer response path stability (regression guard)', () => {
    it('B8 graph still threads to commitDirectAnswer.metadata.graph (R-001 invariant)', async () => {
      const editResult = makeAppliedEditResult();
      (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(editResult);
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-fact-r001',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0]!;
      // PR B does NOT regress the R-001 graph-persistence contract.
      expect(metadata.graph).toBe(editResult.appliedGraph);
    });

    it('B11 rich-builder throw → generic fallback fact emitted (war-room must-fix)', async () => {
      // Force the rich path to throw. The dispatch MUST fall back to
      // the generic builder and persist a fact, NOT commit with
      // handler_facts: [].
      const mockedRich = buildEditGraphHandlerFact as MockedFunction<typeof buildEditGraphHandlerFact>;
      mockedRich.mockImplementationOnce(() => {
        throw new Error('Simulated schema-validation throw inside rich builder');
      });

      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeAppliedEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-fact-rich-throw',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      expect(mockedRich).toHaveBeenCalled();
      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0]!;

      // Must-fix: NOT empty.
      expect(metadata.handler_facts).toHaveLength(1);
      const fact = metadata.handler_facts[0];

      // Generic-fallback shape:
      expect(fact.fact_type).toBe('edit_graph');
      expect(fact.result.safe_summary).toBe('Updated the decision model.');
      expect(fact.result.affected_entities).toEqual([]);
      expect(fact.result.status).toBe('applied');
      expect(fact.noop).toBe(false);
      expect(fact.result.operations_count).toBe(1);

      // Other invariants preserved:
      expect(metadata.turn_class).toBe('direct_answer');
      expect(metadata.handler_id).toBeNull();
    });

    it('B12 BOTH builders fail on applied mutation → NO commit, dispatch surfaces failure (deepest fallback gate)', async () => {
      // DL-7 invariant: a successful applied mutation must never be
      // committed with handler_facts: []. If both the rich AND generic
      // builders fail, dispatch must REFUSE to commit the graph
      // mutation rather than persist a receipt-less mutation that
      // would be downstream-invisible to recent_changes / state-query
      // / prior_facts.
      //
      // Pre-fix behaviour: generic-fallback throw → log warn → commit
      // with handler_facts: []. That is the gap this test pins.

      const mockedRich = buildEditGraphHandlerFact as MockedFunction<typeof buildEditGraphHandlerFact>;
      const mockedGeneric =
        buildGenericEditGraphHandlerFact as MockedFunction<typeof buildGenericEditGraphHandlerFact>;
      mockedRich.mockImplementationOnce(() => {
        throw new Error('Simulated rich-builder failure');
      });
      mockedGeneric.mockImplementationOnce(() => {
        throw new Error('Simulated generic-builder failure');
      });

      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeAppliedEditResult());
      // commitDirectAnswer would normally succeed; we must prove it is
      // NEVER called, so any return shape would be unreachable.
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      const result = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-fact-both-throw',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      // (1) Both builders were exercised.
      expect(mockedRich).toHaveBeenCalledTimes(1);
      expect(mockedGeneric).toHaveBeenCalledTimes(1);

      // (2) commitDirectAnswer was NOT called — no graph mutation was
      //     persisted, so no receipt-less mutation can leak downstream.
      expect(commitDirectAnswer).not.toHaveBeenCalled();

      // (3) The dispatch returns commitPerformed=false so the caller
      //     can route to safe recovery rather than treat this as a
      //     successful applied mutation.
      expect(result.commitPerformed).toBe(false);
    });

    it('B13 rich throws AND generic RETURNS NULL on applied mutation → NO commit (deepest fallback gate, null-return path)', async () => {
      // Sibling to B12: B12 covers the throw-path for the generic
      // builder. The generic builder can also return null (for example
      // when its constructed fact fails schema validation deep
      // inside `EditGraphHandlerFactSchema.safeParse`). The deepest
      // fallback gate must fire for BOTH failure shapes — throw and
      // null-return — otherwise the null-return path would slip
      // through and commit with handler_facts: [].

      const mockedRich = buildEditGraphHandlerFact as MockedFunction<typeof buildEditGraphHandlerFact>;
      const mockedGeneric =
        buildGenericEditGraphHandlerFact as MockedFunction<typeof buildGenericEditGraphHandlerFact>;
      mockedRich.mockImplementationOnce(() => {
        throw new Error('Simulated rich-builder failure');
      });
      // Generic returns null (schema-validation failure) — NOT a throw.
      mockedGeneric.mockImplementationOnce(() => null);

      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeAppliedEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      const result = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-fact-rich-throw-generic-null',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      // (1) Both builders were exercised.
      expect(mockedRich).toHaveBeenCalledTimes(1);
      expect(mockedGeneric).toHaveBeenCalledTimes(1);
      // (2) Generic returned null without throwing — confirm the test
      //     actually exercised the null-return path, not the throw
      //     path again.
      expect(mockedGeneric.mock.results[0]!.type).toBe('return');
      expect(mockedGeneric.mock.results[0]!.value).toBeNull();

      // (3) commitDirectAnswer was NOT called — same gate behaviour
      //     as B12, regardless of whether the generic builder threw
      //     or returned null.
      expect(commitDirectAnswer).not.toHaveBeenCalled();

      // (4) Dispatch surfaces the failure to the caller.
      expect(result.commitPerformed).toBe(false);
    });

    it('B9 turn_class stays direct_answer even when fact emission fails (defensive)', async () => {
      // If buildEditGraphHandlerFact throws (e.g. schema violation
      // discovered late), dispatch should NOT fall back to
      // turn_class='handler' as a recovery — it should fall back to
      // the Phase 2A baseline of handler_facts=[].
      (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
        // Construct an appliedChanges with valid summary but malformed
        // operations to trigger an internal builder error path. In
        // practice, the builder's emission gates and schema validation
        // catch this before throw, so this test mainly asserts the
        // structural invariant: turn_class never flips.
        makeAppliedEditResult({
          // Force a degenerate state: operations array shape doesn't
          // match operation_meta length. The builder will still produce
          // a fact (it doesn't enforce that coupling internally), but
          // we just want to confirm the invariant.
          operation_meta: [],
        }),
      );
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-fact-defensive',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0]!;
      expect(metadata.turn_class).toBe('direct_answer');
    });
  });
});
