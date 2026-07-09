/**
 * Lane 20 — goal-target receipt honesty on the edit_graph dispatch path.
 *
 * LIVE-CAPTURED REPRO (staging build 7ae388b5, scenario
 * 55df6984-7e5e-4207-a1d9-9ba14e6e7d2a, turn fac8dc19…, request 313e7b61,
 * 2026-07-07T13:50:29Z): the user turn "Set a success target of a 15% cost
 * reduction on the goal Reduce Operating Costs" routed to edit_graph
 * (route-v2 edit-verb intercept — NOT add_constraint), whose LLM emitted ONE
 * update_node op stamping `{value: 0.15, type: 'percentage_reduction',
 * description: '15% reduction in operating costs'}` onto the goal node.
 * The shadow referee flagged 2 of the 3 fanned field-envelopes rejected +
 * 1 held (observe-only, never blocks); the graph write succeeded — but NONE
 * of the canonical goal-threshold contract fields (`goal_threshold_raw` /
 * `_unit` / `_cap` / `goal_threshold`) were written, `goal_constraints`
 * stayed null, `has_goal_target` stayed false — yet the wire shipped
 * "Success target of 15% cost reduction set on the Reduce Operating Costs
 * goal. Rerun the simulation to evaluate which options meet this threshold."
 * A rerun would NOT have scored options against any threshold. False
 * registration claim = structural honesty P0.
 *
 * This fixture drives the REAL dispatch through the REAL persist-merge seam
 * (only handleEditGraph's LLM result and the store write are faked) — the
 * integration altitude lane 15's unit-level handler tests missed. RED
 * before the guard: the false receipt ships verbatim. GREEN after: the
 * dispatcher swaps it for GOAL_TARGET_NOT_SAVED_TEXT pre-commit, so the
 * stored assistant_message equals the honest wire copy.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

// ── module-level mocks (same seams as edit-graph-dispatch-false-success) ──

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

// Strict persisted read: the pre-edit persisted graph (the live scenario had
// a rich draft-persisted graph; null would exercise the ingress fallback —
// both merge bases must behave identically for this guard).
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
  };
});

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
import {
  GOAL_TARGET_NOT_SAVED_TEXT,
  graphRegistersGoalTarget,
} from '../../compose/goal-target-receipt-guard.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

// ── live-captured shapes ────────────────────────────────────────────

const SCENARIO_ID = '55df6984-7e5e-4207-a1d9-9ba14e6e7d2a';
const TURN_ID = 'fac8dc19-d569-40f1-a1b3-d640e34bfda8';

/** The captured live receipt (v5_conversation_turns.assistant_message). */
const LIVE_FALSE_RECEIPT =
  'Success target of 15% cost reduction set on the Reduce Operating Costs ' +
  'goal. Rerun the simulation to evaluate which options meet this threshold.';

const INGRESS_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'goal_cost_reduction', kind: 'goal', label: 'Reduce Operating Costs' },
    { id: 'fac_office_rent', kind: 'factor', label: 'Annual Office Rent Cost' },
  ],
  edges: [{ from: 'fac_office_rent', to: 'goal_cost_reduction' }],
};

/**
 * The applied result exactly as the live turn produced it: ONE update_node
 * op writing NON-CONTRACT fields onto the goal node. The applied goal node
 * carries `value`/`type`/`description` — and NO goal_threshold* fields.
 */
function makeLiveGoalValueEditResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: LIVE_FALSE_RECEIPT,
    latencyMs: 5000,
    appliedGraph: {
      nodes: [
        {
          id: 'goal_cost_reduction',
          kind: 'goal',
          label: 'Reduce Operating Costs',
          value: 0.15,
          type: 'percentage_reduction',
          description: '15% reduction in operating costs',
        },
        { id: 'fac_office_rent', kind: 'factor', label: 'Annual Office Rent Cost' },
      ],
      edges: [
        {
          from: 'fac_office_rent',
          to: 'goal_cost_reduction',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'negative' as const,
        },
      ],
    } as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [
      {
        op: 'update_node',
        path: 'goal_cost_reduction',
        value: {
          value: 0.15,
          type: 'percentage_reduction',
          description: '15% reduction in operating costs',
        },
      },
    ],
    appliedChanges: {
      summary: 'Reduce Operating Costs: set to 0.15',
      changes: [
        {
          label: 'Reduce Operating Costs',
          description: 'Set to 0.15.',
          element_ref: 'goal_cost_reduction',
        },
      ],
      rerun_recommended: false,
    },
    operation_meta: [{ impact: 'moderate', rationale: '' }],
  };
}

function makeCommitResult() {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-lane20',
    graphPersisted: true,
    pendingLifecycle: {
      priorCount: 0,
      consumedCount: 0,
      supersededCount: 0,
      expiredWallCount: 0,
      expiredTurnsCount: 0,
      hashInvalidatedCount: 0,
      capDroppedCount: 0,
      survivedCount: 0,
    },
  };
}

function makePayload() {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message:
      'Set a success target of a 15% cost reduction on the goal Reduce Operating Costs',
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

const STUB_REQUEST = {} as FastifyRequest;

// ── tests ───────────────────────────────────────────────────────────

describe('dispatchEditGraph — lane 20 goal-target receipt honesty (live 313e7b61 replay)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue(
      makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>,
    );
  });

  it('ROADMAP 1.19(b) swap-vs-commit: an unbacked goal-target graph write is withheld entirely, not committed lacking the contract', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      makeLiveGoalValueEditResult(),
    );

    await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-lane20-proof',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    const commitMock = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
    expect(commitMock).toHaveBeenCalledTimes(1);
    const metadata = commitMock.mock.calls[0]![1];
    // Previously this asserted the OPPOSITE (`metadata.graph` defined,
    // carrying the LLM's non-contract fields) — that was the bug: the
    // text got swapped for the honest fallback while the unbacked
    // mutation still persisted. A swap turn must commit NO graph at
    // all, same as any other non-mutating turn.
    expect(metadata.graph).toBeUndefined();
    expect(graphRegistersGoalTarget(metadata.graph)).toBe(false);
  });

  it('RED→GREEN: the false "Success target … set" receipt is swapped for the honest fallback BEFORE commit (wire AND stored copy)', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      makeLiveGoalValueEditResult(),
    );

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-lane20-swap',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    // Wire copy: the honest fallback, never the false registration claim.
    expect(out.response.assistant_text).toBe(GOAL_TARGET_NOT_SAVED_TEXT);
    expect(out.response.assistant_text).not.toMatch(/success target[^.?!\n]*\bset\b/i);

    // Stored copy: the SAME honest text was what reached commit (no
    // post-commit divergence between scenarios row and wire).
    const commitMock = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
    const committedResponse = commitMock.mock.calls[0]![0];
    expect(committedResponse.assistant_text).toBe(GOAL_TARGET_NOT_SAVED_TEXT);

    // ROADMAP 1.19(b): the function's OWN returned `graph` (threaded by
    // route-v2 straight into `sendFinalised200`'s `graph` ctx — used for
    // egress label-resolution AND the diagnostic-trace graph counts) must
    // also be withheld, not just the persisted write — otherwise the wire
    // envelope's diagnostics could surface the unbacked mutation even
    // though nothing was actually saved.
    expect(out.graph).toBeNull();
  });

  // ==========================================================================
  // Overnight review F5+F6 — a withheld write must be coherent across EVERY
  // downstream signal (edit receipt fact, analysisReady, freshness), not
  // just the graph itself. Previously only `metadata.graph` /
  // `out.graph` were pinned; these extend the same swap scenario.
  // ==========================================================================

  it('F5: the withheld write does NOT commit an "applied" edit receipt FACT — no phantom edit to ground the next turn on', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      makeLiveGoalValueEditResult(),
    );

    await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-lane20-f5-fact',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    const commitMock = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
    const metadata = commitMock.mock.calls[0]![1];
    // Previously this committed a non-empty handler_facts array carrying a
    // `status: 'applied'` edit-graph fact built from the SAME unbacked
    // mutation whose graph write was withheld — a receipt narrating an
    // applied mutation with no persistable graph state behind it (DL-7
    // violation). A withheld-write turn must emit NO facts, same as any
    // other non-mutating turn.
    expect(metadata.handler_facts).toEqual([]);
  });

  it('F6: the withheld write does NOT stamp analysisReady from the unpersisted graph', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      makeLiveGoalValueEditResult(),
    );

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-lane20-f6-ready',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    // Previously `analysisReady` was computed from `editResult.appliedGraph`
    // — the unpersisted graph — regardless of the swap. Nothing persisted
    // this turn, so no readiness signal should ship either.
    expect(out.analysisReady).toBeUndefined();
  });

  it('F6: the withheld write re-derives freshness against the graph that ACTUALLY persists, not a phantom post-edit hash', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      makeLiveGoalValueEditResult(),
    );

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-lane20-f6-freshness',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    // `loadPersistedGraphStrict` is mocked to resolve null (genuinely-empty
    // scenarios.graph) for this suite, so the PRE-edit frame base — what
    // will actually still be in `scenarios.graph` after this withheld-write
    // turn — is the ingress echo. The phantom hash would instead be derived
    // from the merged POST-edit graph (the applied, never-persisted
    // mutation) — a hash the client can never actually observe on its next
    // read.
    const preEditHash = computeAnalysisAffectingGraphHash(INGRESS_GRAPH);
    const phantomPostEditHash = computeAnalysisAffectingGraphHash({
      nodes: makeLiveGoalValueEditResult().appliedGraph!.nodes,
      edges: makeLiveGoalValueEditResult().appliedGraph!.edges,
    } as unknown as GraphStateIngress);

    expect(out.freshness?.current_graph_hash).toBe(preEditHash);
    expect(out.freshness?.current_graph_hash).not.toBe(phantomPostEditHash);
  });

  it('control: a receipt on an edit that DOES register the target ships untouched', async () => {
    const result = makeLiveGoalValueEditResult();
    // Same turn shape, but the applied goal node carries the canonical
    // contract quad — the honest-success case the guard must not disturb.
    const goal = (result.appliedGraph as unknown as {
      nodes: Array<Record<string, unknown>>;
    }).nodes.find((n) => n.kind === 'goal')!;
    goal.goal_threshold_raw = 15;
    goal.goal_threshold_unit = '%';
    goal.goal_threshold_cap = 100;
    goal.goal_threshold = 0.15;
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(result);

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-lane20-control',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(out.response.assistant_text).toBe(LIVE_FALSE_RECEIPT);
    const commitMock = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
    expect(graphRegistersGoalTarget(commitMock.mock.calls[0]![1].graph)).toBe(true);
  });
});
