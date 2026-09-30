/**
 * A LIMIT'S NODE NEEDS NO CAUSAL PATH TO THE GOAL (P2 re-measure on CEE 523e18d, #70 5858749394).
 *
 * Served, DL run pj-20260927T181846Z journey C (`205b462e`): Paul's budget brief never ran. Its spend total
 * `incremental_6_month_spend` is fed by the options, carries the stated limit "≤ £30,000", and — correctly, since A4
 * refuses a tally as a cause — has no outgoing edge. Loop 2's "every edged node must reach the goal" then refused the
 * whole model with NO_PATH_TO_GOAL on the node the limit exists to watch. A limit is evaluated on its node's own value;
 * it never needs that node to cause the goal.
 */
import { describe, it, expect } from 'vitest';
import { validateGraphStructure } from '../../../src/orchestrator/graph-structure-validator.js';
import type { GraphV3T } from '../../../src/schemas/cee-v3.js';

const e = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' });

/** Journey C's shape, minimal: two options set the two spends; both spends lift MRR; the total only sums them. */
function budgetGraph(withLimit: boolean): GraphV3T {
  return {
    nodes: [
      { id: 'dec', kind: 'decision', label: 'Where should the £30k go?' },
      { id: 'opt_features', kind: 'option', label: 'Put it into features' },
      { id: 'opt_ads', kind: 'option', label: 'Put it into advertising' },
      { id: 'feature_spend', kind: 'factor', category: 'controllable', label: 'Feature investment (6 months)' },
      { id: 'ad_spend', kind: 'factor', category: 'controllable', label: 'Advertising spend (6 months)' },
      { id: 'incremental_6_month_spend', kind: 'factor', label: 'Incremental 6-month spend' },
      { id: 'mrr', kind: 'goal', label: 'MRR' },
    ],
    edges: [
      e('dec', 'opt_features'), e('dec', 'opt_ads'),
      e('opt_features', 'feature_spend'), e('opt_ads', 'ad_spend'),
      e('feature_spend', 'mrr'), e('ad_spend', 'mrr'),
      e('feature_spend', 'incremental_6_month_spend'), e('ad_spend', 'incremental_6_month_spend'), e('opt_features', 'incremental_6_month_spend'),
    ],
    ...(withLimit
      ? { goal_constraints: [{ constraint_id: 'agent-lane:incremental_6_month_spend:<=', node_id: 'incremental_6_month_spend', operator: '<=', value: 30000, unit: 'GBP', provenance: 'explicit' }] }
      : {}),
  } as unknown as GraphV3T;
}

const noPath = (g: GraphV3T) => validateGraphStructure(g).violations
  .filter((v) => v.code === 'NO_PATH_TO_GOAL').map((v) => v.detail);

describe("a limit-only decision tally is a valid terminal (AIQ 5858730290 (a))", () => {
  it('journey C: the spend total carrying "≤ £30,000" does not refuse the model', () => {
    expect(noPath(budgetGraph(true))).toEqual([]);
  });

  it('CONTRAST: the same dead-end total with NO limit on it is still refused (the rule is unchanged elsewhere)', () => {
    const found = noPath(budgetGraph(false));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('incremental_6_month_spend');
  });

  it('CONTRAST: a limit on ANOTHER node does not exempt the dead end', () => {
    const g = budgetGraph(false) as unknown as { goal_constraints: unknown[] };
    g.goal_constraints = [{ constraint_id: 'c', node_id: 'ad_spend', operator: '<=', value: 1, unit: 'GBP', provenance: 'explicit' }];
    expect(noPath(g as unknown as GraphV3T)).toHaveLength(1);
  });

  // ⛔ SUPERSEDED (#2129's parents-only rule; AIQ 5903604206, DL lease 5903604509): an exogenous cause of a limited
  // quantity is part of its branch, not a missing link. A live arm on served cut-costs drew downtime's own uncertain
  // causes as roots ("Migration complexity", observable, no parent); refusing them blocked 3 of 4 Runs.
  it('an exogenous cause (an observable root) feeding a limited dead end is part of its branch — accepted', () => {
    const g = budgetGraph(true) as unknown as { nodes: Array<Record<string, unknown>>; edges: unknown[] };
    g.nodes.push({ id: 'market_rate', kind: 'factor', category: 'observable', label: 'Market ad rate' });
    g.edges.push(e('market_rate', 'incremental_6_month_spend'));
    expect(noPath(g as unknown as GraphV3T)).toEqual([]);
  });

  it('CONTRAST: a limited node WITH an outgoing edge that still misses the goal is refused (not a terminal)', () => {
    const g = budgetGraph(true) as unknown as { nodes: Array<Record<string, unknown>>; edges: unknown[] };
    g.nodes.push({ id: 'side_note', kind: 'factor', category: 'observable', label: 'Side note' });
    g.edges.push(e('incremental_6_month_spend', 'side_note'));
    expect(noPath(g as unknown as GraphV3T).some((d) => d.includes('incremental_6_month_spend'))).toBe(true);
  });
});

/**
 * ⛔ A LIMIT'S WHOLE BRANCH, DRIVEN ONLY BY THE DECISION'S LEVERS, IS A VALID SINK (R3 pre-flight #75 5903589565; AIQ
 * 5903604206; DL lease 5903604509). Served cut-costs on CEE `9f75612` (guest `15f48f0b`, R3 evidence
 * `preflight-cc-9f75612/journey-15f48f0b/alt/r0/02-read-after-brief.json`): the drafter routes downtime only into the
 * limit it exists for ("≤ 2 weeks"): planning quality (a lever) and migration duration (observable, set by the GCP share
 * lever) → expected migration downtime, with no downtime → spend link (downtime is not a cause of the bill). Loop 2 refused
 * all three (`NO_PATH_TO_GOAL`), so Run 1, Run 2 and the cold state were all blocked, and the Agent advised adding the
 * false cause. The exemption now reads the limit's ancestors, not only its parents: the limited terminal and every
 * ancestor are exempt when a lever (an option or a controllable factor) is among them — the decision moves it.
 */
describe('a limit branch driven only by the decision\'s levers is a valid sink (served cut-costs, 15f48f0b)', () => {
  /** The served stored graph after the brief (ids, kinds, categories, edges and the limit row, verbatim). */
  function cutCosts(withLimit = true): GraphV3T {
    return {
      nodes: [
        { id: 'should_we_switch', kind: 'decision', label: 'Should we switch our cloud…' },
        { id: 'monthly_spend', kind: 'goal', label: 'Monthly spend' },
        { id: 'keep_aws', kind: 'option', label: 'Keep AWS' },
        { id: 'switch_to_gcp', kind: 'option', label: 'Switch to GCP' },
        { id: 'phased_gcp_migration', kind: 'option', label: 'Phased GCP migration' },
        { id: 'gcp_workload_share', kind: 'factor', category: 'controllable', label: 'GCP workload share' },
        { id: 'workload_optimisation_coverage', kind: 'factor', category: 'controllable', label: 'Workload optimisation coverage' },
        { id: 'migration_planning_quality', kind: 'factor', category: 'controllable', label: 'Migration planning quality' },
        { id: 'migration_duration', kind: 'factor', category: 'observable', label: 'Migration duration' },
        { id: 'expected_migration_downtime', kind: 'outcome', label: 'Expected migration downtime' },
      ],
      edges: [
        e('should_we_switch', 'keep_aws'), e('should_we_switch', 'switch_to_gcp'), e('should_we_switch', 'phased_gcp_migration'),
        ...['keep_aws', 'switch_to_gcp', 'phased_gcp_migration'].flatMap((o) =>
          [e(o, 'gcp_workload_share'), e(o, 'workload_optimisation_coverage'), e(o, 'migration_planning_quality')]),
        e('gcp_workload_share', 'monthly_spend'), e('workload_optimisation_coverage', 'monthly_spend'),
        e('gcp_workload_share', 'migration_duration'),
        e('migration_duration', 'expected_migration_downtime'), e('migration_planning_quality', 'expected_migration_downtime'),
      ],
      ...(withLimit
        ? { goal_constraints: [{ unit: 'weeks', label: 'Expected migration downtime', value: 2, node_id: 'expected_migration_downtime',
          operator: '<=', provenance: 'inferred', value_frame: 'level', constraint_id: 'agent-lane:expected_migration_downtime:<=' }] }
        : {}),
    } as unknown as GraphV3T;
  }

  it('RED (served 15f48f0b): the downtime branch is not refused — the Run can go ahead', () => {
    expect(noPath(cutCosts())).toEqual([]);
  });

  it('CONTRAST: the same branch with NO limit on it is refused, all three nodes (the limit is what makes it a sink)', () => {
    const found = noPath(cutCosts(false));
    for (const id of ['expected_migration_downtime', 'migration_duration', 'migration_planning_quality']) {
      expect(found.some((d) => d.includes(`"${id}"`)), id).toBe(true);
    }
  });

  it('live-arm shape: an uncertain cause of downtime drawn as a root ("Migration complexity", observable) is accepted', () => {
    const g = cutCosts() as unknown as { nodes: Array<Record<string, unknown>>; edges: unknown[] };
    g.nodes.push({ id: 'migration_complexity', kind: 'factor', category: 'observable', label: 'Migration complexity' });
    g.edges.push(e('migration_complexity', 'expected_migration_downtime'));
    expect(noPath(g as unknown as GraphV3T)).toEqual([]);
  });

  it('a two-step uncertain cause (team experience → migration complexity → downtime) is accepted, root and all', () => {
    const g = cutCosts() as unknown as { nodes: Array<Record<string, unknown>>; edges: unknown[] };
    g.nodes.push({ id: 'migration_complexity', kind: 'factor', category: 'observable', label: 'Migration complexity' });
    g.nodes.push({ id: 'team_experience', kind: 'factor', category: 'observable', label: 'Team migration experience' });
    g.edges.push(e('team_experience', 'migration_complexity'), e('migration_complexity', 'expected_migration_downtime'));
    expect(noPath(g as unknown as GraphV3T)).toEqual([]);
  });

  it('a lever that reaches the limit only through an observable (planning quality → duration → downtime) still makes it a sink', () => {
    const g = cutCosts() as unknown as { nodes: Array<Record<string, unknown>>; edges: Array<{ from: string; to: string }> };
    // Planning quality now acts on downtime only THROUGH duration, and GCP share no longer feeds duration.
    g.edges = g.edges.filter((x) => !(x.from === 'migration_planning_quality' && x.to === 'expected_migration_downtime')
      && !(x.from === 'gcp_workload_share' && x.to === 'migration_duration'));
    g.edges.push(e('migration_planning_quality', 'migration_duration') as never);
    expect(noPath(g as unknown as GraphV3T)).toEqual([]);
  });

  it('CONTRAST: a limited island no lever reaches (the decision cannot move it) is still refused', () => {
    const g = cutCosts() as unknown as { nodes: Array<Record<string, unknown>>; edges: unknown[] };
    g.nodes.push({ id: 'vendor_sla', kind: 'factor', category: 'observable', label: 'Vendor SLA' });
    g.nodes.push({ id: 'support_backlog', kind: 'outcome', label: 'Support backlog' });
    g.edges.push(e('vendor_sla', 'support_backlog'));
    (g as unknown as { goal_constraints: unknown[] }).goal_constraints.push({ constraint_id: 'c2', node_id: 'support_backlog', operator: '<=', value: 50, unit: 'tickets', provenance: 'explicit' });
    const found = noPath(g as unknown as GraphV3T);
    expect(found.some((d) => d.includes('"support_backlog"'))).toBe(true);
    expect(found.some((d) => d.includes('"vendor_sla"'))).toBe(true);
    expect(found.some((d) => d.includes('"expected_migration_downtime"'))).toBe(false);
  });

  it('CONTRAST: a dead end that reaches neither the goal nor a limit is still refused beside the accepted branch', () => {
    const g = cutCosts() as unknown as { nodes: Array<Record<string, unknown>>; edges: unknown[] };
    g.nodes.push({ id: 'vendor_morale', kind: 'factor', category: 'observable', label: 'Vendor morale' });
    g.edges.push(e('switch_to_gcp', 'vendor_morale'));
    const found = noPath(g as unknown as GraphV3T);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('"vendor_morale"');
  });
});
