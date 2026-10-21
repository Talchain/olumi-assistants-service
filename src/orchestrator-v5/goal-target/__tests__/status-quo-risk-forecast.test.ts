/**
 * ⭐ A status quo exposed to an uncontrolled RISK is a real forecast, never "the reference moved" (DL lease, 22 Oct 2026).
 *
 * Served F2 (Track 2 witness, CEE 7249a567, captured in `tests/fixtures/track2-f2/`): "our key supplier has a 5–15% chance
 * of failing in the next 12 months, losing £8k a month; dual-sourcing cuts that by 70%". PLoT scored carrying on at
 * P(gross profit ≥ £12k) = 0.9135: at today's level (p50 = p90 = 0.8) except in the draws where the supplier fails. The
 * licence read that as a paired status quo whose row "moved" (`statusQuoReadingOf`: a paired chance strictly between 0 and
 * 1) and withheld it as `reference_moved`, so the person saw "Chance not shown yet" for carrying on while the engine had
 * the number.
 *
 * The same-draw reference cancels every link's spread for the status quo, but not a risk EVENT drawn on its own: a goal a
 * risk node reaches is not paired, so carrying on's chance is the Run's, shown like any option's. Genuinely paired goals
 * (no risk on the path) keep the D2 exact-equality check and `reference_moved` (`batch-d-status-quo-frame.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalChanceLicenceOf } from '../goal-chance-licence.js';
import { wireGoalConstraints } from '../../tools/handlers/run-analysis.js';

type Rec = Record<string, unknown>;
const FX = JSON.parse(readFileSync('tests/fixtures/track2-f2/served-f2-supplier-risk-20261021T222244Z.json', 'utf8')) as {
  envelope: Rec; graph: Rec; served_view: Rec };
const GOAL = 'gross_profit_floor';
const SQ = 'carry_on';
const DUAL = 'dual_source';

/** The envelope as the licence reads it, before transport: the served licence (this code's output) removed. */
const runEnvelope = (): Rec => {
  const env = structuredClone(FX.envelope);
  env.inference_warnings = (env.inference_warnings as Rec[]).filter((w) => w.code !== 'GOAL_CHANCE_LICENSED');
  return env;
};
const licence = (graph: Rec = FX.graph) => goalChanceLicenceOf(runEnvelope(), graph, GOAL, () => false, undefined, graph, {});
const reasonOf = (l: ReturnType<typeof licence>): Rec | undefined =>
  (l?.withheld_reason_by_option as Record<string, Rec> | undefined)?.[SQ];

describe('F2 (served): a status quo a supplier-failure risk reaches is a forecast, not a moved reference', () => {
  it('precondition: the engine scored both options; the served view withheld carrying on as reference_moved', () => {
    const rows = FX.envelope.option_comparison as Rec[];
    expect(rows.find((r) => r.option_id === SQ)).toMatchObject({ status: 'computed', probability_of_goal: 0.9135 });
    expect(rows.find((r) => r.option_id === DUAL)).toMatchObject({ status: 'computed', probability_of_goal: 0.9731 });
    const sq = (FX.served_view.options as Rec[]).find((o) => o.option_id === SQ)!;
    expect(sq.cell).toMatchObject({ kind: 'withheld', reasons: [{ code: 'reference_moved' }] });
    // The risk reaches the goal, and no option sets the risk itself.
    const nodes = FX.graph.nodes as Rec[];
    expect(nodes.find((n) => n.id === 'supplier_failure')).toMatchObject({ kind: 'risk' });
    expect((FX.graph.edges as Rec[]).some((e) => e.from === 'supplier_failure' && e.to === GOAL)).toBe(true);
  });

  it('RED → GREEN: carrying on gets its chance (about 91%), never withheld as reference_moved, never "by assumption"', () => {
    const l = licence();
    expect(l).not.toBeNull();
    expect(reasonOf(l)?.reason).not.toBe('reference_moved');
    // Nothing is withheld: the licence carries no withheld list at all, and both chances are present.
    expect(l!.withheld_option_ids ?? []).not.toContain(SQ);
    expect(l!.withheld_reason_by_option).toBeUndefined();
    expect(l!.pct_by_option[SQ]).toBe(91);
    // No "unchanged from today" claim for a status quo that faces a risk.
    expect(l!.status_quo).toBeUndefined();
    // The other option is untouched.
    expect(l!.pct_by_option[DUAL]).toBe(97);
  });

  // Codex r1 counterexamples: an event that cannot occur under carrying on leaves it exactly at today, so it stays paired.
  const withEvent = (edit: (risk: Rec, carryOn: Rec) => void): Rec => {
    const graph = structuredClone(FX.graph);
    const nodes = graph.nodes as Rec[];
    edit(nodes.find((n) => n.id === 'supplier_failure')!, nodes.find((n) => n.id === SQ)!);
    return graph;
  };

  it('contrast: an event with no chance of happening (p_low = p_high = 0) keeps carrying on paired', () => {
    const graph = withEvent((risk) => {
      (risk.event_risk as Rec).occurrence = { ...((risk.event_risk as Rec).occurrence as Rec), p_low: 0, p_high: 0 };
    });
    const l = licence(graph);
    expect(reasonOf(l)?.reason).toBe('reference_moved');
    expect(l!.withheld_option_ids).toContain(SQ);
  });

  it('contrast: an event fully prevented under carrying on (reduction 1, preventer in place) keeps carrying on paired', () => {
    const graph = withEvent((risk, carryOn) => {
      (risk.event_risk as Rec).mitigations = [{ factor_id: 'dual_sourcing_in_place', occurrence_reduction: 1 }];
      ((carryOn.interventions as Rec).dual_sourcing_in_place as Rec).value = 1;
    });
    const l = licence(graph);
    expect(reasonOf(l)?.reason).toBe('reference_moved');
    expect(l!.withheld_option_ids).toContain(SQ);
  });

  it('contrast: a preventer already in place today, which carrying on leaves as is, fully prevents it: still paired', () => {
    const graph = withEvent((risk, carryOn) => {
      (risk.event_risk as Rec).mitigations = [{ factor_id: 'dual_sourcing_in_place', occurrence_reduction: 1 }];
      delete (carryOn.interventions as Rec).dual_sourcing_in_place;
    });
    const preventer = (graph.nodes as Rec[]).find((n) => n.id === 'dual_sourcing_in_place')!;
    preventer.observed_state = { value: 1, raw_value: 1 };
    const l = licence(graph);
    expect(reasonOf(l)?.reason).toBe('reference_moved');
    expect(l!.withheld_option_ids).toContain(SQ);
  });

  it('control: the same mitigation NOT in place under carrying on (value 0) still moves it, so its chance is shown', () => {
    const graph = withEvent((risk) => {
      (risk.event_risk as Rec).mitigations = [{ factor_id: 'dual_sourcing_in_place', occurrence_reduction: 1 }];
    });
    const l = licence(graph);
    expect(reasonOf(l)?.reason).not.toBe('reference_moved');
    expect(l!.pct_by_option[SQ]).toBe(91);
  });

  it('contrast: the same Run with the risk taken off the goal path reads as paired again (the D2 check still applies)', () => {
    const graph = structuredClone(FX.graph);
    graph.edges = (graph.edges as Rec[]).filter((e) => e.from !== 'supplier_failure');
    graph.nodes = (graph.nodes as Rec[]).filter((n) => n.id !== 'supplier_failure');
    const l = licence(graph);
    // A paired status quo whose recorded chance is strictly between 0 and 1 is a reference that moved: withheld, not shown.
    expect(reasonOf(l)?.reason).toBe('reference_moved');
    expect(l!.withheld_option_ids).toContain(SQ);
  });
});

// ── Codex r1/r2 on #3610: the event-risk reading is the SINGLE goal's only. A joint keeps the reading as it was, so a status
// quo the engine scores at an exact 100% stays out of the joint and the primary target even when an event reaches the goal.
const J_LEVEL = (raw: number, cap: number, unit: string): Rec => ({ value: raw / cap, raw_value: raw, cap, unit, source: 'brief_extraction', extractionType: 'explicit' });
const J_LINK = (): Rec => ({ strength: { mean: 0.3, std: 0.05 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'user_specified', magnitude: 'user_stated' } });
const J_CELL = (node: string): Rec => ({ value: 0.6, raw_value: 60, source: 'user_specified', target_match: { node_id: node } });
const JGOAL = 'new_customers';
const J_BASIS = { quantity_frame: 'level', target_frame: 'level', target_raw: 20, reference: 'today', source: 'olumi_reading' };
const J_ROWS = [
  { constraint_id: 'target:new_customers', node_id: JGOAL, operator: '>=', value: 20, unit: 'customers', value_frame: 'level', role: 'goal_target' },
  { constraint_id: 'target:conversion_rate', node_id: 'conversion_rate', operator: '>=', value: 15, unit: '%', value_frame: 'level', role: 'goal_target' },
];
function jointGraph(withRisk: boolean): Rec {
  const nodes: Rec[] = [
    { id: 'which_plan', kind: 'decision', label: 'Which plan?' },
    { id: JGOAL, kind: 'goal', label: 'New customers', goal_threshold_frame: 'level', goal_threshold_raw: 20, goal_threshold_unit: 'customers',
      goal_threshold_cap: 50, goal_threshold: 0.4, goal_direction: '>=', goal_target_basis: J_BASIS, observed_state: J_LEVEL(30, 50, 'customers') },
    { id: 'conversion_rate', kind: 'factor', label: 'Conversion rate', observed_state: J_LEVEL(20, 100, '%') },
    { id: 'outreach', kind: 'factor', label: 'Outreach', observed_state: J_LEVEL(40, 100, 'points') },
    { id: 'carry_on', kind: 'option', label: 'Carry on as now', is_baseline: true, interventions: {} },
    { id: 'hire', kind: 'option', label: 'Hire', interventions: { outreach: J_CELL('outreach') } },
  ];
  const edges: Rec[] = [
    ...['carry_on', 'hire'].map((o) => ({ from: 'which_plan', to: o, ...J_LINK() })),
    { from: 'hire', to: 'outreach', ...J_LINK() },
    { from: 'outreach', to: JGOAL, ...J_LINK() },
    { from: 'conversion_rate', to: JGOAL, ...J_LINK() },
  ];
  if (withRisk) {
    nodes.push({ id: 'outage', kind: 'risk', label: 'Platform outage', event_risk: { version: 1, horizon: { months: 12 },
      occurrence: { basis: 'user', p_low: 0.05, p_high: 0.15 }, mitigations: [] } });
    edges.push({ from: 'outage', to: JGOAL, strength: { mean: -0.2, std: 0.05 }, exists_probability: 1, effect_direction: 'negative',
      provenance: { source: 'user_specified', magnitude: 'user_stated' } });
  }
  return { nodes, edges, goal_constraints: structuredClone(J_ROWS) };
}
const JP = { n_informative: 10000, standard_error: 0.005 };
const JOINT_RUN = (): Rec => ({ option_comparison: [
  { option_id: 'carry_on', probability_of_goal: 1, probability_of_joint_goal: 1, probability_of_joint_goal_precision: JP,
    constraint_probabilities: { 'target:new_customers': 1, 'target:conversion_rate': 1 },
    constraint_probabilities_precision: { 'target:new_customers': JP, 'target:conversion_rate': JP } },
  { option_id: 'hire', probability_of_goal: 0.7, probability_of_joint_goal: 0.48, probability_of_joint_goal_precision: JP,
    constraint_probabilities: { 'target:new_customers': 0.7, 'target:conversion_rate': 0.55 },
    constraint_probabilities_precision: { 'target:new_customers': JP, 'target:conversion_rate': JP } },
] });
const jointLicence = (withRisk: boolean): Rec => {
  const g = jointGraph(withRisk);
  return goalChanceLicenceOf(JOINT_RUN(), g, JGOAL, () => false, undefined, g,
    { storedConstraints: g.goal_constraints, sentConstraints: wireGoalConstraints(g.goal_constraints) } as never) as Rec;
};

describe('a joint over the goal keeps the status-quo reading as it was, with or without an event risk on the goal', () => {
  it('precondition: with no risk, the joint and the primary target leave carrying on out (no unearned exact 100%)', () => {
    const l = jointLicence(false);
    expect(l.targets.joint.status).toBe('licensed');
    expect(l.targets.joint.pct_by_option).not.toHaveProperty('carry_on');
    expect((l.targets.per_target as Rec[]).find((t) => t.constraint_id === 'target:new_customers')!.pct_by_option).not.toHaveProperty('carry_on');
  });

  it('an event risk reaching the primary goal changes nothing in the joint: carrying on stays out, exactly as without it', () => {
    const withRisk = jointLicence(true);
    expect(withRisk.targets.joint.pct_by_option).not.toHaveProperty('carry_on');
    expect((withRisk.targets.per_target as Rec[]).find((t) => t.constraint_id === 'target:new_customers')!.pct_by_option)
      .not.toHaveProperty('carry_on');
    expect(withRisk.targets).toEqual(jointLicence(false).targets);
    expect(withRisk.withheld_option_ids).toEqual(jointLicence(false).withheld_option_ids);
  });
});

