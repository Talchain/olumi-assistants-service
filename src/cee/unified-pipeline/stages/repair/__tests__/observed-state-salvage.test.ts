/**
 * AN OPTIONAL FIELD MUST NOT DESTROY THE USER'S WHOLE MODEL — PINNED.
 *
 * ── THE PROPERTY ────────────────────────────────────────────────────────────
 * `Node.observed_state` is declared `NodeObservedState.optional()`
 * (`schemas/graph.ts:336`). A node that OMITS it parses cleanly. A node that
 * carries a MALFORMED one fails the whole `DraftGraphOutput.parse`, so one
 * unparseable optional provenance field on one node returns a 400 that becomes
 * a user-facing 500 with an empty `assistant_text` — the user is shown nothing.
 *
 * That asymmetry is the defect. On 2026-09-21 the deployed `Staging Journey
 * Smoke` gate recorded draft failure rates of 40/60/20/40/40% across five
 * consecutive staging heads, and a complete census of that window's
 * `cee.structural_parse.failed` events (17 events, 20 issues, no truncation)
 * put EVERY issue at `graph.nodes.N.observed_state`, code `invalid_union`.
 *
 * ── WHY THE FIX CANNOT MAKE ANYTHING WORSE ──────────────────────────────────
 * The salvage runs ONLY after the full parse has already failed — a path whose
 * current outcome is a guaranteed 500 — and only when EVERY issue is an
 * `invalid_union` at an `observed_state` path. One issue anywhere else, or of
 * any other code, and it declines and the pre-existing 500 is byte-identical.
 *
 * ── THE DISCRIMINATION THAT MATTERS ─────────────────────────────────────────
 * `FactorObservedState` carries a refinement forbidding any `metadata` key, so
 * a MALFORMED CONSTRAINT observed_state (metadata present, operator missing) is
 * reported as `custom`, NOT `invalid_union`. That refusal is DELIBERATE:
 * `schemas/graph.ts:255-259` exists so "you cannot slip a broken operator
 * through by shedding the constraint shape". Shedding it is precisely what this
 * module does, so salvaging a `custom` issue would override that ruling.
 *
 * T2 is therefore the load-bearing test: it differs from T1 ONLY in the shape
 * of one `observed_state`, and it must still 400. A fix that keys on the PATH
 * alone — the obvious implementation, and the one first written here — passes
 * T1 and FAILS T2.
 *
 * ── PRECONDITION PINS ───────────────────────────────────────────────────────
 * Every test asserts its fixture reproduces the situation before asserting the
 * outcome, so none can hold vacuously: T0 pins that the same graph WITHOUT the
 * malformed field parses cleanly (otherwise the salvage would be credited for a
 * graph that was never savable), and T1/T2 pin the observed Zod issue CODE.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DraftGraphOutput } from '../../../../../schemas/assist.js';
import { log } from '../../../../../utils/telemetry.js';
import { runStructuralParse } from '../structural-parse.js';
import type { StageContext } from '../../../types.js';

vi.mock('../../../../../utils/telemetry.js', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const FACTOR = (observed_state?: unknown) => {
  const n: Record<string, unknown> = { id: 'fac_spend', kind: 'factor', label: 'Marketing spend' };
  if (observed_state !== undefined) n.observed_state = observed_state;
  return n;
};

const graphWith = (...nodes: Array<Record<string, unknown>>) => ({ nodes, edges: [] as unknown[] });

const ctxFor = (graph: unknown, goalConstraints?: unknown): StageContext =>
  ({ graph, requestId: 'req-test', goalConstraints } as unknown as StageContext);

const issueCodesFor = (graph: unknown): string[] => {
  const r = DraftGraphOutput.safeParse({ graph });
  return r.success ? [] : r.error.issues.map((i) => i.code as string);
};

describe('observed_state salvage — an optional field must not destroy the model', () => {
  beforeEach(() => vi.clearAllMocks());

  it('T0 PRECONDITION: the same graph without the malformed field parses cleanly', () => {
    expect(DraftGraphOutput.safeParse({ graph: graphWith(FACTOR()) }).success).toBe(true);
  });

  it('T1 a provenance-only observed_state is SHED and the model is preserved', () => {
    const graph = graphWith(FACTOR({ unit: '%' }));
    expect(issueCodesFor(graph)).toEqual(['invalid_union']); // precondition pin

    const ctx = ctxFor(graph);
    runStructuralParse(ctx);

    expect(ctx.earlyReturn).toBeUndefined();                 // no 500 — the user gets a model
    expect(graph.nodes[0]).not.toHaveProperty('observed_state');
    expect(graph.nodes[0]).toMatchObject({ id: 'fac_spend', kind: 'factor', label: 'Marketing spend' });
  });

  it('T2 DISCRIMINATING TWIN: a malformed CONSTRAINT observed_state still 400s', () => {
    const graph = graphWith(FACTOR({ value: 1, metadata: {} }));
    expect(issueCodesFor(graph)).toEqual(['custom']);        // precondition pin: NOT invalid_union

    const ctx = ctxFor(graph);
    runStructuralParse(ctx);

    expect(ctx.earlyReturn?.statusCode).toBe(400);           // the deliberate refusal is preserved
    expect(graph.nodes[0]).toHaveProperty('observed_state'); // and nothing was shed
  });

  it('T7 a CONSTRAINT node is never stripped — the salvage declines and the 500 stands', () => {
    // A constraint's `observed_state` carries its THRESHOLD. Shed it and the
    // node still renders, so the user sees a model whose own limit has quietly
    // stopped being expressed — for "£20k MRR while keeping churn under 4%",
    // that is the user's stated constraint vanishing with no refusal to see.
    //
    // The complete 30h Render census cannot say whether a constraint has ever
    // reached this path (every issue message is the bare "Invalid input" and
    // `path` carries the node INDEX, not its kind), so shipping a silent strip
    // would be a bet on an unmeasured population. Declining costs nothing if
    // constraints never appear, and surfaces them if they do.
    const graph = graphWith({
      id: 'con_churn',
      kind: 'constraint',
      label: 'Monthly churn under 4%',
      observed_state: { unit: '%' },
    });
    expect(issueCodesFor(graph)).toEqual(['invalid_union']); // precondition: the salvageable code

    const ctx = ctxFor(graph);
    runStructuralParse(ctx);

    expect(ctx.earlyReturn?.statusCode).toBe(400);            // the 500 stands
    expect(graph.nodes[0]).toHaveProperty('observed_state');  // nothing was shed
  });

  it('T13 ROLE: a goal_constraints TARGET is never stripped, whatever its kind', () => {
    // THE CASE `kind` MISSED. `buildParameterUncertaintiesV3`'s passes are both
    // factor-only, so an outcome or risk target must carry its OWN
    // `observed_state.value` (`constraint-write-admissibility.ts:47-52`). Lose
    // it and PLoT logs `plot.constraint_no_observed_value` with "ISL may use
    // base=0.0" — the user's threshold compared against a FABRICATED ZERO,
    // which that file calls "worse than not checked".
    const graph = graphWith({
      id: 'ab78e513', kind: 'factor', label: 'Monthly churn',
      observed_state: { unit: '%' },
    });
    const goalConstraints = [
      { constraint_id: 'c1', node_id: 'ab78e513', operator: '<=' as const, value: 0.04 },
    ];
    // PRECONDITION: the graph's only defect is the observed_state, so the
    // decline below can only come from the ROLE check.
    expect(issueCodesFor(graph)).toEqual(['invalid_union']);

    const ctx = ctxFor(graph, goalConstraints);
    runStructuralParse(ctx);

    expect(ctx.earlyReturn?.statusCode).toBe(400);
    expect(graph.nodes[0]).toHaveProperty('observed_state');
  });

  it('T14 DISCRIMINATING TWIN of T13: the same node, NOT a constraint target, IS salvaged', () => {
    // Byte-identical to T13 except `goal_constraints` does not name it. So T13
    // binds to the ROLE and not to the id, the label, or the kind.
    const graph = graphWith({
      id: 'ab78e513', kind: 'factor', label: 'Monthly churn',
      observed_state: { unit: '%' },
    });
    // ⚠ PRECONDITION PIN (trap 13b). The first version of this fixture omitted
    // `operator` and `value`, which GoalConstraintSchema REQUIRES — so it added
    // an issue OUTSIDE observed_state and the salvage declined for a reason that
    // had nothing to do with the role check. T13 would then have passed with the
    // guard deleted. Both fixtures are now valid, and asserted so here.
    const otherTarget = [
      { constraint_id: 'c1', node_id: 'some_other_node', operator: '<=' as const, value: 0.04 },
    ];
    expect(issueCodesFor(graph)).toEqual(['invalid_union']); // the ONLY issue is the field

    const ctx = ctxFor(graph, otherTarget);
    runStructuralParse(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    expect(graph.nodes[0]).not.toHaveProperty('observed_state');
  });

  it('T15 SHAPE: a constraint-SHAPED observed_state on a FACTOR is never stripped', () => {
    // Reproduced at review on all seven non-constraint kinds: a
    // `{metadata:{operator}}` observed_state was shed because the guard asked
    // the node what KIND it was instead of what its observed_state CARRIED.
    const graph = graphWith({
      id: 'f_mislabelled', kind: 'factor', label: 'Mislabelled threshold',
      observed_state: { metadata: { operator: '>' } },
    });
    const ctx = ctxFor(graph);
    runStructuralParse(ctx);

    expect(ctx.earlyReturn?.statusCode).toBe(400);
    expect(graph.nodes[0]).toHaveProperty('observed_state');
  });

  it('T16 DISCRIMINATING TWIN of T15: the same factor WITHOUT metadata IS salvaged', () => {
    // Differs from T15 only in the presence of the `metadata` key, so T15 binds
    // to the SHAPE. This is the twin the reviewer asked for in place of the
    // kind-keyed one: re-cut on shape, or it pins the wrong axis and keeps
    // passing while the hazard is live.
    const graph = graphWith({
      id: 'f_mislabelled', kind: 'factor', label: 'Mislabelled threshold',
      observed_state: { unit: '%' },
    });
    const ctx = ctxFor(graph);
    runStructuralParse(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    expect(graph.nodes[0]).not.toHaveProperty('observed_state');
  });

  it('T8 KIND (weakest axis, kept as well not instead): the same shape as a FACTOR is salvaged', () => {
    // Differs from T7 in `kind` and NOTHING else — same label, same malformed
    // observed_state, same Zod code. So T7 binds to the node's KIND, not to
    // something incidental about its shape.
    const graph = graphWith({
      id: 'con_churn',
      kind: 'factor',
      label: 'Monthly churn under 4%',
      observed_state: { unit: '%' },
    });
    expect(issueCodesFor(graph)).toEqual(['invalid_union']); // same precondition as T7

    const ctx = ctxFor(graph);
    runStructuralParse(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    expect(graph.nodes[0]).not.toHaveProperty('observed_state');
  });

  it('T9 a constraint ANYWHERE in the batch declines the WHOLE salvage', () => {
    // Wholesale, not per-node: that constraint's observed_state would still be
    // invalid, so a partial strip cannot re-parse, and a half-stripped graph is
    // a state no caller ever produces.
    const graph = graphWith(
      FACTOR({ unit: '%' }),
      { id: 'con_x', kind: 'constraint', label: 'Limit', observed_state: {} },
    );
    const ctx = ctxFor(graph);
    runStructuralParse(ctx);

    expect(ctx.earlyReturn?.statusCode).toBe(400);
    expect(graph.nodes[0]).toHaveProperty('observed_state'); // the factor kept its field too
  });

  // ── THE DECLINE LABEL MUST NAME THE REAL CONDITION ────────────────────────
  // Review finding: four distinct conditions all reported as
  // `issue_outside_observed_state`, including the CONSTRAINT refusal — which is
  // an issue squarely INSIDE observed_state, refused on its CODE. Anyone
  // watching whether that narrowing fires would have concluded it never does.
  //
  // ⚠ This whole change exists because a telemetry census found the defect.
  // Telemetry that misnames its own cases is how the NEXT census gets misled,
  // so the labels are pinned rather than left to drift.
  const declineReasonFor = (graph: unknown): unknown => {
    const ctx = ctxFor(graph);
    runStructuralParse(ctx);
    const calls = (log.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.length, 'the emitter logged exactly once').toBe(1);
    return (calls[0][0] as Record<string, unknown>).salvage_declined;
  };

  it('T10 the CONSTRAINT refusal names itself, not "outside observed_state"', () => {
    const graph = graphWith({
      id: 'con_churn', kind: 'constraint', label: 'Churn under 4%',
      observed_state: { unit: '%' },
    });
    expect(declineReasonFor(graph)).toBe('would_strip_constraint');
  });

  it('T11 a wrong-CODE issue names the CODE, not the path', () => {
    // A malformed constraint shape trips the refinement => code `custom`, which
    // is INSIDE observed_state and refused on its code. Reporting this as
    // "outside observed_state" was the false label the review caught.
    const graph = graphWith(FACTOR({ value: 1, metadata: {} }));
    expect(issueCodesFor(graph)).toEqual(['custom']);
    expect(declineReasonFor(graph)).toBe('issue_code_not_invalid_union');
  });

  it('T12 an issue genuinely elsewhere still says so', () => {
    // The control for T10/T11: this one really IS outside observed_state, so
    // the original label is correct here and must survive.
    const graph = graphWith({ id: 'f1', label: 'no kind' });
    expect(declineReasonFor(graph)).toBe('issue_outside_observed_state');
  });

  it('T3 an issue ANYWHERE ELSE still 400s and sheds nothing', () => {
    const graph = graphWith({ id: 'f1', label: 'no kind' });  // `kind` is required
    const ctx = ctxFor(graph);
    runStructuralParse(ctx);
    expect(ctx.earlyReturn?.statusCode).toBe(400);
  });

  it('T4 a MIX of an observed_state issue and another issue still 400s, graph restored', () => {
    const bad = FACTOR({ unit: '%' });
    const graph = graphWith(bad, { id: 'f2', label: 'no kind' });
    const ctx = ctxFor(graph);
    runStructuralParse(ctx);
    expect(ctx.earlyReturn?.statusCode).toBe(400);
    expect(graph.nodes[0]).toHaveProperty('observed_state');  // untouched — byte-identical path
  });

  it('T5 a VALID graph is untouched and never enters the salvage', () => {
    const graph = graphWith(FACTOR({ value: 0.5 }));
    const ctx = ctxFor(graph);
    runStructuralParse(ctx);
    expect(ctx.earlyReturn).toBeUndefined();
    expect(graph.nodes[0]).toHaveProperty('observed_state', { value: 0.5 });
  });

  it('T6 several bad nodes are all shed, and good neighbours keep their provenance', () => {
    const graph = graphWith(
      FACTOR({ unit: '%' }),
      { id: 'fac_ok', kind: 'factor', label: 'Fine', observed_state: { value: 0.25 } },
      { id: 'fac_bad2', kind: 'factor', label: 'Also bad', observed_state: {} },
    );
    const ctx = ctxFor(graph);
    runStructuralParse(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    expect(graph.nodes[0]).not.toHaveProperty('observed_state');
    expect(graph.nodes[1]).toHaveProperty('observed_state', { value: 0.25 }); // neighbour intact
    expect(graph.nodes[2]).not.toHaveProperty('observed_state');
  });
});
