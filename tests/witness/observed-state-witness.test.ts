import { describe, it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { runStructuralParse } from '../../src/cee/unified-pipeline/stages/repair/structural-parse.js';
import type { StageContext } from '../../src/cee/unified-pipeline/types.js';

vi.mock('../../src/utils/telemetry.js', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const out: string[] = [];
const W = (s: string) => out.push(s);

// A graph shaped like Paul's live session: £49->£59 pricing decision, a churn
// factor that is the goal_constraints target, options that set both.
const buildGraph = () => ({
  nodes: [
    { id: 'opt_59', kind: 'option', label: 'Raise Pro from £49 to £59 with feature release' },
    { id: 'opt_49', kind: 'option', label: 'Hold price at £49 (status quo)' },
    { id: 'fac_price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.49, raw_value: 49, unit: '£' } },
    { id: 'ab78e513', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.03, raw_value: 3, unit: '%' } },
    // the malformed one — provenance only, no numeric value
    { id: 'fac_featq', kind: 'factor', label: 'Feature release quality', observed_state: { unit: 'rating' } },
    { id: 'goal_mrr', kind: 'goal', label: 'Reach £20k MRR within 12 months' },
  ] as Array<Record<string, unknown>>,
  edges: [] as unknown[],
});

const CONSTRAINTS = [
  { constraint_id: 'constraint_ab78e513_max', node_id: 'ab78e513', operator: '<=' as const, value: 0.04 },
];

const run = (graph: unknown, goalConstraints?: unknown) => {
  const ctx = { graph, requestId: 'witness', goalConstraints } as unknown as StageContext;
  runStructuralParse(ctx);
  return ctx;
};

const snapshot = (g: ReturnType<typeof buildGraph>) =>
  g.nodes.map((n) => `${String(n.id).padEnd(12)} ${String(n.kind).padEnd(10)} observed_state=${JSON.stringify(n.observed_state ?? null)}`);

describe('BEHAVIOUR WITNESS — #1674', () => {
  it('CASE A: a malformed observed_state on a NON-constraint factor is shed; every user meaning survives', () => {
    const g = buildGraph();
    W('=== CASE A — malformed observed_state on a plain factor ===');
    W('BEFORE:'); snapshot(g).forEach((l) => W('  ' + l));
    const ctx = run(g, CONSTRAINTS);
    W(`\nOUTCOME: ${ctx.earlyReturn ? 'HTTP ' + ctx.earlyReturn.statusCode + ' — USER GETS NOTHING' : 'SALVAGED — user gets the model'}`);
    W('AFTER:'); snapshot(g).forEach((l) => W('  ' + l));

    expect(ctx.earlyReturn, 'the user must get a model').toBeUndefined();
    // USER MEANING PRESERVED:
    expect(g.nodes.filter((n) => n.kind === 'option')).toHaveLength(2);
    expect(g.nodes[2].observed_state).toEqual({ value: 0.49, raw_value: 49, unit: '£' }); // £49 intact
    expect(g.nodes[3].observed_state).toEqual({ value: 0.03, raw_value: 3, unit: '%' });  // churn intact
    expect(g.nodes[4]).not.toHaveProperty('observed_state');                               // only the bad one shed
    expect(g.nodes[4].label).toBe('Feature release quality');                              // node itself survives
    W('\nPRESERVED: 2 options · £49 price provenance · churn 3% + its <=4% constraint target');
    W('SHED     : fac_featq.observed_state ONLY (it carried no usable quantity)');
  });

  it('CASE B PERTURBED: the SAME malformed shape on the CONSTRAINT TARGET declines — no silent loss', () => {
    const g = buildGraph();
    // perturbation: move the malformed observed_state onto the churn node,
    // which goal_constraints names. Everything else identical.
    g.nodes[3].observed_state = { unit: '%' };
    W('\n=== CASE B — SAME malformation, now on the goal_constraints target ab78e513 ===');
    W('BEFORE:'); snapshot(g).forEach((l) => W('  ' + l));
    const ctx = run(g, CONSTRAINTS);
    W(`\nOUTCOME: ${ctx.earlyReturn ? 'HTTP ' + ctx.earlyReturn.statusCode + ' — DECLINED, fail-closed' : 'SALVAGED'}`);
    W('AFTER:'); snapshot(g).forEach((l) => W('  ' + l));

    expect(ctx.earlyReturn?.statusCode, 'must decline rather than shed a threshold carrier').toBe(400);
    expect(g.nodes[3]).toHaveProperty('observed_state'); // untouched
    W('\nDECLINED: ab78e513 is goal_constraints[0].node_id — shedding it would let ISL use base=0.0');
    W('          ("worse than not checked" — constraint-write-admissibility.ts:41-44)');
  });

  it('CASE C GATE-0 PROBE: does a shed observed_state ever carry USER meaning?', () => {
    // Gate 0 criterion 4: "unsupported semantics are exposed as unsupported,
    // never silently approximated". The salvage INVENTS nothing, so it cannot
    // approximate. The question that remains is whether it can silently drop
    // something the USER stated.
    //
    // `FactorObservedState` is `.passthrough()`, so an observed_state can carry
    // arbitrary extra fields — including `stated_role`, which `stages/boundary.ts`
    // writes to record that a quantity is a user-stated limit.
    const g = buildGraph();
    g.nodes[4].observed_state = {
      unit: 'rating',
      stated_role: 'user_stated_limit',   // USER AUTHORITY MARKER
      source: 'user_override',            // USER AUTHORITY MARKER
    };
    W('\n=== CASE C — malformed observed_state CARRYING user-authority markers ===');
    W('BEFORE: ' + JSON.stringify(g.nodes[4].observed_state));

    const ctx = run(g, CONSTRAINTS);
    W(`OUTCOME: ${ctx.earlyReturn ? 'HTTP ' + ctx.earlyReturn.statusCode + ' — declined' : 'SALVAGED'}`);
    W('AFTER : ' + JSON.stringify(g.nodes[4].observed_state ?? null));

    const shed = !Object.prototype.hasOwnProperty.call(g.nodes[4], 'observed_state');
    W(shed
      ? '\n⛔ GATE-0 FINDING: user-authority markers (stated_role, source=user_override) were SHED SILENTLY.'
      : '\n✅ declined — user authority preserved.');
    writeFileSync('/private/tmp/WITNESS.txt', out.join('\n') + '\n');

    // Recorded as an OBSERVATION, not an assertion of desired behaviour — the
    // point of the probe is to find out, and the answer goes to Paul.
    expect(typeof shed).toBe('boolean');
  });
});
