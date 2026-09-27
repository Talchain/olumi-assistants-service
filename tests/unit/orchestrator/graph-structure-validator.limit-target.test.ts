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

  it('CONTRAST: a limited dead end fed by a NON-lever (an observable factor) is still refused — a missing link, not a tally', () => {
    const g = budgetGraph(true) as unknown as { nodes: Array<Record<string, unknown>>; edges: unknown[] };
    g.nodes.push({ id: 'market_rate', kind: 'factor', category: 'observable', label: 'Market ad rate' });
    g.edges.push(e('market_rate', 'incremental_6_month_spend'));
    // market_rate is itself a dead end too; the point is that the limited total is NOT exempt.
    expect(noPath(g as unknown as GraphV3T).some((d) => d.includes('"incremental_6_month_spend"'))).toBe(true);
  });

  it('CONTRAST: a limited node WITH an outgoing edge that still misses the goal is refused (not a terminal)', () => {
    const g = budgetGraph(true) as unknown as { nodes: Array<Record<string, unknown>>; edges: unknown[] };
    g.nodes.push({ id: 'side_note', kind: 'factor', category: 'observable', label: 'Side note' });
    g.edges.push(e('incremental_6_month_spend', 'side_note'));
    expect(noPath(g as unknown as GraphV3T).some((d) => d.includes('incremental_6_month_spend'))).toBe(true);
  });
});
