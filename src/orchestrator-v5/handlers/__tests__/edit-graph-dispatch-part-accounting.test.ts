/**
 * Part-accounting conservation law at the edit_graph dispatch seam —
 * RED-first pins for rehearsal defect A + defect B's CEE half
 * (REHEARSAL-DEFECT-TRIAGE-2026-07-20.md, byte-verified diagnosis).
 *
 * THE EXACT LIVE FAILURE (wire 012, scenario 0985abff, build cbb619a):
 * "Change Support cost to 30, and add a new factor called Shipping costs
 * that reduces Gross margin." against a graph containing NEITHER
 * 'Support cost' NOR 'Gross margin'. The LLM emitted exactly two ops
 * (add_node 'Shipping costs' + add_edge to the EXISTING ARR outcome —
 * a silent stand-in for the absent 'Gross margin'), the referee held
 * them, and the held compose enumerated ONLY the ops: the value half of
 * the request vanished without a word, and the substitution was never
 * flagged as one.
 *
 * THE LAW UNDER TEST:
 *  1. SUBSTITUTION FAILS CLOSED (defect B): a named-but-absent target
 *     with an edge to a different existing node blocks the WHOLE batch
 *     to clarify — nothing persists, no pending that would commit the
 *     stand-in on confirm, and the reply enumerates every part and
 *     names the missing targets. Flag-free: holds in every GM mode.
 *  2. UNDER-ACCOUNT DISCLOSES (defect A): when the batch is legitimate
 *     but a decomposed part got no operation, the reply carries a
 *     deterministic disclosure naming the unserved part (appended on
 *     the held branch too — the branch that used to discard every
 *     disclosure channel).
 *  3. FALSE-COMPOUND TRAP: single-part messages are byte-identical to
 *     today — no disclosure, no accounting event.
 *
 * Harness mirrors edit-graph-dispatch-graph-management-modes.test.ts
 * (mocked handleEditGraph / commitDirectAnswer / loadPersistedGraphStrict).
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
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

const { persistedBaseRef } = vi.hoisted(() => ({
  persistedBaseRef: { current: null as unknown },
}));
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn(async () => persistedBaseRef.current),
    loadMostRecentPendingActions: vi.fn(async () => []),
    buildTurnContext: vi.fn(async () => ({
      prior_facts: [],
      prior_turns: [],
      most_recent_pending_actions: [],
    })),
  };
});

// ── imports after mocks ─────────────────────────────────────────────

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';
import { setTestSink, TelemetryEvents } from '../../../utils/telemetry.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import { _resetConfigCache } from '../../../config/index.js';

// ── fixtures ────────────────────────────────────────────────────────

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TURN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STUB_REQUEST = {} as FastifyRequest;

/** The EXACT compound message from the 2026-07-20 rehearsal (wire 012). */
const REHEARSAL_MESSAGE =
  'Change Support cost to 30, and add a new factor called Shipping costs that reduces Gross margin.';

/** Same shape with an EXISTING link target — the legitimate-hold variant. */
const EXISTING_TARGET_MESSAGE =
  'Change Support cost to 30, and add a new factor called Shipping costs that reduces EU Market Demand.';

function makePayload(message: string) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message,
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

/** Redraft-shaped graph: contains NEITHER 'Support cost' NOR 'Gross margin'. */
const INGRESS_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'goal_arr', kind: 'goal', label: 'ARR Growth' },
    { id: 'out_new_arr', kind: 'outcome', label: 'Incremental ARR Generated' },
    { id: 'fac_eu_demand', kind: 'factor', label: 'EU Market Demand' },
    { id: 'opt_eu_expand', kind: 'option', label: 'Expand to EU' },
  ],
  edges: [
    {
      from: 'fac_eu_demand',
      to: 'out_new_arr',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
};

const ADD_SHIPPING_NODE: PatchOperation = {
  op: 'add_node',
  path: 'fac_shipping_costs',
  value: { id: 'fac_shipping_costs', kind: 'factor', label: 'Shipping costs' },
};

/** The rehearsal substitution: edge to the EXISTING ARR outcome instead of
 *  the absent 'Gross margin'. */
const SUBSTITUTED_EDGE: PatchOperation = {
  op: 'add_edge',
  path: 'fac_shipping_costs::out_new_arr',
  value: {
    from: 'fac_shipping_costs',
    to: 'out_new_arr',
    strength: { mean: -0.2, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'negative',
  },
};

/** Legitimate edge: the user NAMED 'EU Market Demand' and it exists. */
const LEGITIMATE_EDGE: PatchOperation = {
  op: 'add_edge',
  path: 'fac_shipping_costs::fac_eu_demand',
  value: {
    from: 'fac_shipping_costs',
    to: 'fac_eu_demand',
    strength: { mean: -0.2, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'negative',
  },
};

function postEditGraph(ops: PatchOperation[]) {
  const addedNodes = ops
    .filter((o) => o.op === 'add_node')
    .map((o) => o.value as Record<string, unknown>);
  const addedEdges = ops
    .filter((o) => o.op === 'add_edge')
    .map((o) => o.value as Record<string, unknown>);
  return {
    nodes: [...INGRESS_GRAPH.nodes, ...addedNodes],
    edges: [...(INGRESS_GRAPH.edges ?? []), ...addedEdges],
  };
}

const APPLIED_CHANGES: AppliedChanges = {
  summary: "Added 'Shipping costs' and linked it.",
  changes: [
    { label: 'Shipping costs', description: 'Added.', element_ref: 'fac_shipping_costs' },
  ],
  rerun_recommended: false,
};

function makeAppliedEditResult(ops: PatchOperation[]): EditGraphResult {
  return {
    blocks: [],
    assistantText: "Added 'Shipping costs' and linked it.",
    latencyMs: 900,
    appliedGraph: postEditGraph(ops) as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    appliedChanges: APPLIED_CHANGES,
    operations: ops,
    operation_meta: ops.map(() => ({ impact: 'low' as const, rationale: '' })),
  };
}

function makeCommitResult() {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-part-accounting',
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

let events: Array<{ event: string; data: Record<string, unknown> }> = [];

async function runDispatch(message: string, ops: PatchOperation[]) {
  (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
    makeAppliedEditResult(ops),
  );
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue(
    makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>,
  );
  const result = await dispatchEditGraph({
    payload: makePayload(message),
    requestId: 'req-part-accounting',
    request: STUB_REQUEST,
    graphState: INGRESS_GRAPH,
    analysisState: null,
  });
  const calls = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls;
  expect(calls).toHaveLength(1);
  return { result, response: calls[0]![0], metadata: calls[0]![1] };
}

function setMode(mode: string): void {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', mode);
  _resetConfigCache();
}

function partAccountingEvents() {
  return events.filter((e) => e.event === TelemetryEvents.V5EditGraphPartAccounting);
}

beforeEach(() => {
  vi.clearAllMocks();
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
  persistedBaseRef.current = INGRESS_GRAPH;
});

afterEach(() => {
  setTestSink(null);
  vi.unstubAllEnvs();
  _resetConfigCache();
});

// ── 1. Substitution fails closed (defect B) ─────────────────────────

describe('substitution fails closed — the EXACT rehearsal shape', () => {
  it('live mode: blocks the whole batch to clarify — nothing persists, NO pending, both missing names spoken', async () => {
    setMode('live');
    const { result, response, metadata } = await runDispatch(REHEARSAL_MESSAGE, [
      ADD_SHIPPING_NODE,
      SUBSTITUTED_EDGE,
    ]);

    // Nothing persisted: no graph on the commit, no edit fact, no
    // analysis_ready, no returned graph.
    expect(metadata.graph).toBeUndefined();
    expect(((metadata.handler_facts as unknown[] | undefined) ?? []).length).toBe(0);
    expect(result.graph).toBeNull();
    expect(result.analysisReady).toBeUndefined();

    // NO pending: a confirm must never commit the substituted edge.
    expect(((metadata.pending_actions as unknown[] | undefined) ?? []).length).toBe(0);

    // The reply enumerates the request and names BOTH missing targets.
    const text = (response as { assistant_text: string }).assistant_text;
    expect(text).toContain("'Gross margin'");
    expect(text).toContain("'Support cost'");
    expect(text).toContain('Shipping costs');
    // It must NOT be the generic held ask (the pre-fix behaviour).
    expect(text).not.toContain('Nothing in the model moves until you confirm');
    // Copy is egress-clean.
    expect(findForbiddenPhraseHit(text)).toBeNull();
    expect(findSuccessClaimHit(text)).toBeNull();

    // Telemetry: the accounting event records the blocked substitution.
    const pa = partAccountingEvents();
    expect(pa).toHaveLength(1);
    expect(pa[0]!.data.substitution_blocked).toBe(true);
    expect(pa[0]!.data.parts_detected).toBe(2);
  });

  it('off mode: the law is flag-free — the substituted batch still fails closed', async () => {
    setMode('off');
    const { result, metadata, response } = await runDispatch(REHEARSAL_MESSAGE, [
      ADD_SHIPPING_NODE,
      SUBSTITUTED_EDGE,
    ]);
    expect(metadata.graph).toBeUndefined();
    expect(result.graph).toBeNull();
    const text = (response as { assistant_text: string }).assistant_text;
    expect(text).toContain("'Gross margin'");
  });
});

// ── 2. Under-account discloses (defect A) ───────────────────────────

describe('under-account discloses on the held branch', () => {
  it('live mode: the held consent ask carries the value-half disclosure naming Support cost', async () => {
    setMode('live');
    const { response, metadata } = await runDispatch(EXISTING_TARGET_MESSAGE, [
      ADD_SHIPPING_NODE,
      LEGITIMATE_EDGE,
    ]);

    // The structural batch is held with a REAL pending (unchanged).
    expect(((metadata.pending_actions as unknown[] | undefined) ?? []).length).toBe(1);

    // THE FIX: the reply also accounts for the value half by name —
    // pre-fix the held branch discarded every disclosure channel.
    const text = (response as { assistant_text: string }).assistant_text;
    expect(text).toContain("'Support cost'");
    expect(text.toLowerCase()).toContain("can't find");
    expect(findForbiddenPhraseHit(text)).toBeNull();
    expect(findSuccessClaimHit(text)).toBeNull();

    const pa = partAccountingEvents();
    expect(pa).toHaveLength(1);
    expect(pa[0]!.data.substitution_blocked).toBe(false);
    expect(pa[0]!.data.parts_uncovered).toBe(1);
  });

  it('shadow mode: the applied path also carries the disclosure', async () => {
    setMode('shadow');
    const { response } = await runDispatch(EXISTING_TARGET_MESSAGE, [
      ADD_SHIPPING_NODE,
      LEGITIMATE_EDGE,
    ]);
    const text = (response as { assistant_text: string }).assistant_text;
    expect(text).toContain("'Support cost'");
  });
});

// ── 3. False-compound trap: single-part messages byte-identical ─────

describe('single-part messages are untouched', () => {
  it('a single structural add is applied/held with NO disclosure and NO accounting event', async () => {
    setMode('live');
    const { response } = await runDispatch(
      'Add a new factor called Shipping costs that reduces EU Market Demand.',
      [ADD_SHIPPING_NODE, LEGITIMATE_EDGE],
    );
    const text = (response as { assistant_text: string }).assistant_text;
    expect(text).not.toContain("'Support cost'");
    expect(text).not.toMatch(/haven'?t taken forward/i);
    expect(partAccountingEvents()).toHaveLength(0);
  });
});
