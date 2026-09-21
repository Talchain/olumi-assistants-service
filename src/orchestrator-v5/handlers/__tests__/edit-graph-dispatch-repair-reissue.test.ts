/**
 * ⭐⭐ THE REPAIR AFFORDANCE IS RE-ISSUED WHILE THE MODEL IS STILL BLOCKED.
 *
 * THE WITNESSED DEFECT, on deployed CEE `a7ee21e` with a fresh guest, bound by
 * identity: the product's own prescribed sentence WROTE correctly —
 * `exit_path: edit_graph`, one gained option×factor pair, blockers **8 → 7**,
 * `graph_hash 79741e49c3d34916 → 87f6104999e9b25f`, the option flipped to
 * `ready` — and the reply came back with `suggested_actions: []`. No affordance,
 * with SEVEN blockers outstanding. Driven by hand the loop converges (second
 * repair 7 → 6, hash moves again, strictly decreasing), so the MECHANISM
 * terminates and only the USER's route to it disappears.
 *
 * **The product rewarded a correct action by withdrawing the means to repeat it.**
 *
 * ⚠ THE EMPTY ARRAY IS NOT A STRIP, AND THE FIX DEPENDS ON THAT DISTINCTION.
 * Derived at the bytes (independently, twice): `buildBoundarySuggestedActions`
 * merges exactly two sources — `result.suggestedActions` and
 * `result.pendingClarification` — and BOTH are failure-shaped. The V4 success
 * return mints only a `rerun_recommended` chip (gated on `hasExistingAnalysis`,
 * false while the model has never been analysable) and label-value-divergence
 * chips (an intervention write produces none). So a SUCCESS populates neither
 * and the key is omitted entirely. The absence is a missing success-path
 * composer, not a decision to suppress one — which is why no strip-hunting fix
 * would have found anything to remove.
 *
 * WHAT THIS SPEC PINS, and why each case exists rather than being one case:
 *   1. RED-FIRST — the affordance is present after a successful write while
 *      blockers remain. At pristine this REDs on `suggested_actions: []`.
 *   2. TERMINATION — when the post-write readiness is READY, no chip is added.
 *      This is the discriminating twin: it must stay GREEN both before and
 *      after, so case 1 cannot be satisfied by unconditionally appending a chip.
 *   3. THE CHIP NAMES THE **NEXT** SLOT, not the one just repaired. A re-issue
 *      that re-offered the answered pair would be the loop this estate keeps
 *      closing, and `guardLoopingChipsAtEgress` logs exactly that shape as
 *      `v5.invariant_violation`.
 *   4. A FAILED remedy turn is left alone — the non-apply branches keep their
 *      existing contract and their own composers.
 *
 * ⚠ EVERY CASE PINS ITS OWN PRECONDITION (CLAUDE.md trap 13b). The fixtures
 * assert the readiness they are about to exercise — a `missing_value` blocker
 * present for case 1, `status === 'ready'` for case 2 — so a fixture that
 * silently stopped reproducing the blocked state would RED rather than pass
 * vacuously. An empty `blockers[]` read off a payload that never computed is
 * indistinguishable from success without this.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

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

vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
  };
});

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** The repair affordance's id — `configure-option-chip-text.ts`'s one owner. */
const REPAIR_CHIP_ID = 'chip_prompt_repair_effect_value';

function edge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 0.6, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive' as const,
  };
}

function payload() {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message: "Set the Status quo option's effect on Marketing spend to 0.3.",
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

/**
 * THE PRE-WRITE GRAPH the turn arrives with: `opt_status_quo` has NO effect
 * values at all, so TWO slots are outstanding and the write this turn performs
 * closes one of them. Canonical shape (typed edges, decision→option links) so
 * the dispatcher's strict parse succeeds — an ingress that fails it sends the
 * whole turn down the structural-fallback path, where readiness is never
 * stamped and this spec would prove nothing.
 */
const INGRESS_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_marketing', kind: 'factor', label: 'Marketing spend' },
    { id: 'fac_price', kind: 'factor', label: 'Unit price' },
    {
      id: 'opt_launch',
      kind: 'option',
      label: 'Launch now',
      data: { interventions: { fac_marketing: 0.7, fac_price: 0.4 } },
    },
    { id: 'opt_status_quo', kind: 'option', label: 'Status quo' },
  ],
  edges: [
    edge('dec_launch', 'opt_launch'),
    edge('dec_launch', 'opt_status_quo'),
    edge('opt_launch', 'fac_marketing'),
    edge('opt_launch', 'fac_price'),
    edge('opt_status_quo', 'fac_marketing'),
    edge('opt_status_quo', 'fac_price'),
    edge('fac_marketing', 'goal_revenue'),
    edge('fac_price', 'goal_revenue'),
  ],
} as unknown as GraphStateIngress;

/**
 * THE POST-WRITE GRAPH OF THE WITNESSED SHAPE: one repair has just landed and
 * MORE REMAIN. `opt_status_quo` now has its `fac_marketing` value (the write
 * this turn performed) and still has NO value for `fac_price`, which it is
 * edge-linked to — exactly the "blockers 8 → 7, six still outstanding" state.
 */
const POST_EDIT_GRAPH_STILL_BLOCKED = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_marketing', kind: 'factor', label: 'Marketing spend' },
    { id: 'fac_price', kind: 'factor', label: 'Unit price' },
    {
      id: 'opt_launch',
      kind: 'option',
      label: 'Launch now',
      data: { interventions: { fac_marketing: 0.7, fac_price: 0.4 } },
    },
    {
      id: 'opt_status_quo',
      kind: 'option',
      label: 'Status quo',
      data: { interventions: { fac_marketing: 0.3 } },
    },
  ],
  edges: [
    // ⚠ THE DECISION→OPTION EDGES ARE LOAD-BEARING IN THE FIXTURE, not
    // decoration, and their absence was this spec's own first defect. Without
    // them readiness reports `OPTION_NOT_LINKED_TO_DECISION` — a
    // `graph_structure` blocking issue — the whole payload goes `blocked`, the
    // projection takes its `resolve_model_issue` branch, and the repair chip is
    // never the affordance under test. The spec would have been exercising a
    // different branch entirely while its assertions still read plausibly.
    // Derived by dumping `readiness_issues`, not guessed.
    edge('dec_launch', 'opt_launch'),
    edge('dec_launch', 'opt_status_quo'),
    edge('opt_launch', 'fac_marketing'),
    edge('opt_launch', 'fac_price'),
    edge('opt_status_quo', 'fac_marketing'),
    edge('opt_status_quo', 'fac_price'),
    edge('fac_marketing', 'goal_revenue'),
    edge('fac_price', 'goal_revenue'),
  ],
};

/** The same model with the LAST slot filled — the loop's terminal state. */
const POST_EDIT_GRAPH_READY = {
  ...POST_EDIT_GRAPH_STILL_BLOCKED,
  nodes: POST_EDIT_GRAPH_STILL_BLOCKED.nodes.map((n) =>
    n.id === 'opt_status_quo'
      ? { ...n, data: { interventions: { fac_marketing: 0.3, fac_price: 0.6 } } }
      : n,
  ),
};

function appliedResult(graph: unknown): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Updated.',
    latencyMs: 100,
    appliedGraph: graph as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [{ op: 'update_node', path: 'opt_status_quo', value: 0.3 }],
  };
}

function rejectedResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Edit rejected.',
    latencyMs: 100,
    appliedGraph: null,
    wasRejected: true,
  };
}

function commitOk() {
  return { response: {}, performed: true as const, persisted_row_id: 'row-1', graphPersisted: true };
}

const STUB_REQUEST = {} as FastifyRequest;

async function dispatch(result: EditGraphResult, requestId: string) {
  (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(result);
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue(
    commitOk() as Awaited<ReturnType<typeof commitDirectAnswer>>,
  );
  return dispatchEditGraph({
    payload: payload(),
    requestId,
    request: STUB_REQUEST,
    graphState: INGRESS_GRAPH,
    analysisState: null,
  });
}

describe('edit-graph-dispatch — the repair affordance survives a successful repair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PRECONDITION: the still-blocked fixture really does carry a missing_value blocker', () => {
    // ⭐ Trap 13b — a discriminator whose precondition nothing pins is a guard
    // agreeing with itself. If this fixture ever stops reproducing the blocked
    // state, THIS case REDs rather than the cases below passing vacuously.
    const ready = buildCanonicalAnalysisReadyFromGraph(POST_EDIT_GRAPH_STILL_BLOCKED);
    expect(ready).toBeDefined();
    expect(ready!.status).not.toBe('ready');
    const missing = (ready!.blockers ?? []).filter(
      (b) =>
        (b as { blocker_type?: string }).blocker_type === 'missing_value'
        || (b as { code?: string }).code === 'MISSING_OPTION_VALUE',
    );
    expect(missing.length).toBeGreaterThan(0);
    // The slot still outstanding is the one the write did NOT fill.
    expect((missing[0] as { option_id?: string }).option_id).toBe('opt_status_quo');
    expect((missing[0] as { factor_id?: string }).factor_id).toBe('fac_price');
  });

  it('PRECONDITION: the ready fixture really is READY (the loop terminates)', () => {
    const ready = buildCanonicalAnalysisReadyFromGraph(POST_EDIT_GRAPH_READY);
    expect(ready).toBeDefined();
    expect(ready!.status).toBe('ready');
  });

  it('RED-FIRST: a successful repair with blockers remaining RE-ISSUES the repair chip', async () => {
    // ⚠ THIS IS THE WITNESSED DEFECT. At pristine `a7ee21e` the response carries
    // `suggested_actions: []` and this assertion fails by name.
    const out = await dispatch(appliedResult(POST_EDIT_GRAPH_STILL_BLOCKED), 'req-reissue');

    const ids = out.response.suggested_actions.map((a) => a.id);
    expect(ids).toContain(REPAIR_CHIP_ID);
  });

  it('the re-issued chip names the NEXT slot, never the one just repaired', async () => {
    // ⭐ Bind by IDENTITY, not by a value predicate another object could satisfy
    // (trap 19). The chip's message must name the factor that is STILL missing
    // and must not name the one this turn filled.
    const out = await dispatch(appliedResult(POST_EDIT_GRAPH_STILL_BLOCKED), 'req-reissue-next');

    const chip = out.response.suggested_actions.find((a) => a.id === REPAIR_CHIP_ID);
    expect(chip).toBeDefined();
    expect(chip!.message).toContain('Unit price');
    expect(chip!.message).toContain('Status quo');
    // The slot just repaired must not be re-offered — the loop this closes.
    expect(chip!.message).not.toContain('Marketing spend');
  });

  it('TERMINATION: a successful write that leaves the model READY adds no chip', async () => {
    // ⭐ THE DISCRIMINATING TWIN. It is GREEN at pristine and must STAY green:
    // it is what stops case 3 being satisfied by appending a chip regardless of
    // readiness. Termination is structural — `buildReadinessRecoveryChip`
    // returns `null` on its `'run'` branch — not a count written here.
    const out = await dispatch(appliedResult(POST_EDIT_GRAPH_READY), 'req-reissue-ready');

    const ids = out.response.suggested_actions.map((a) => a.id);
    expect(ids).not.toContain(REPAIR_CHIP_ID);
  });

  it('a REJECTED edit is left alone — the non-apply branches keep their contract', async () => {
    // The head blocker on a non-apply turn is still the pair the user just tried
    // to answer, so re-issuing there would repeat a demand they have responded
    // to. Scope is deliberately narrow: this must be GREEN before and after.
    const out = await dispatch(rejectedResult(), 'req-reissue-rejected');

    const ids = out.response.suggested_actions.map((a) => a.id);
    expect(ids).not.toContain(REPAIR_CHIP_ID);
  });
});
