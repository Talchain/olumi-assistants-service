/**
 * ⭐ NEAR-TIE ROW (red team 19 ts2-r2 at CEE 328d01fe; DL #87, 6 Oct): GOAL_FIGURES_TARGET_NOT_TESTABLE's `say` asked for a
 * link the user had set only as a BAND, in the goal's unit, but the warning typed only the goal's id, so the Strengthen
 * panel named a different input while the leader was withheld for a near tie. The warning now types the link its own
 * question asks (`first_ask`), by identity, only when the words ask exactly that link.
 *
 * The served r2 graph itself is TESTABLE on this base: #2648 (T1b) reads the user's two bands around the level-less
 * "Support capacity strain" as sizing that path (ablation: not_testable at a9daf7f0, testable at 09b873d6). The class it
 * exposed stands for a SINGLE band into the goal, so the rows edit ONE link of the served graph into the user's band.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { targetNotTestableWarning, targetTestabilityOf } from '../target-testability.js';

type Rec = Record<string, any>;
const CODE = 'GOAL_FIGURES_TARGET_NOT_TESTABLE';
const fx = JSON.parse(readFileSync(new URL('./fixtures/ts2-near-tie-served-graph.json', import.meta.url), 'utf8')) as Rec;
const warn = (g: Rec) => targetNotTestableWarning(g, targetTestabilityOf(g), fx.option_ids, CODE);
const LOST = 'customers_lost_from_price_rise';
const GOAL = 'monthly_recurring_revenue';
/** The ONE edit: the user set "Customers lost from price rise → MRR" as a band ("strong"), with no size. */
function singleBand(): Rec {
  const g = structuredClone(fx.graph);
  const e = g.edges.find((x: Rec) => x.from === LOST && x.to === GOAL);
  e.provenance = { source: 'user_specified' };
  e.provenance_display = 'user_set';
  e.strength = { mean: -0.6, std: 0.15 };
  return g;
}

describe('the target warning types the link its question asks', () => {
  it('CONTROL: the served r2 graph is testable on this base (#2648), so there is no warning and nothing to ask', () => {
    expect(targetTestabilityOf(fx.graph).kind).toBe('testable');
    expect(warn(fx.graph)).toBeNull();
  });
  it('a single user band into the goal: the words ask that link in the goal\'s unit, and `first_ask` names it by id', () => {
    const w = warn(singleBand())!;
    expect(w.say).toContain('You set this link as strong. To test your £126,000 / month target I need it in GBP/month: '
      + 'roughly how much monthly recurring revenue in GBP/month does a change in Customers lost from price rise bring?');
    expect(w.first_ask).toEqual({ kind: 'link', from: LOST, to: GOAL });
  });
  it('⛔ Codex r1 P1: a % LEVEL goal\'s question says "in %", which the writer refuses (points only), so no typed invitation', () => {
    const g: Rec = { goal_node_id: 'gm', goal_constraints: [{ node_id: 'gm', operator: '>=', value: 40, unit: '%', value_frame: 'level' }],
      nodes: [
        { id: 'gm', kind: 'goal', label: 'Gross margin', observed_state: { value: 0.3, raw_value: 30, baseline: 0.3, cap: 100, unit: '%', source: 'user_override' },
          goal_threshold_raw: 40, goal_threshold_unit: '%', goal_threshold: 0.4, goal_direction: '>=' },
        { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.5, raw_value: 50, cap: 100, unit: 'GBP', source: 'user_override' } },
        { id: 'o', kind: 'option', label: 'Raise price', interventions: { price: { value: 0.6, raw_value: 60 } } },
      ],
      edges: [
        { from: 'o', to: 'price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'cee_hypothesis' } },
        { from: 'price', to: 'gm', strength: { mean: 0.6, std: 0.15 }, exists_probability: 0.8, effect_direction: 'positive',
          provenance: { source: 'user_specified' }, provenance_display: 'user_set' },
      ] };
    const w = targetNotTestableWarning(g, targetTestabilityOf(g), ['o'], CODE)!;
    expect(w.say).toContain('roughly how much Gross margin in % does a change in Price bring?'); // PRECONDITION: the words ask it
    expect(w).not.toHaveProperty('first_ask');
  });
  it('TWIN (DL): when the words ask today\'s level first, they ask no link, so there is no `first_ask`', () => {
    const g = singleBand();
    delete g.nodes.find((n: Rec) => n.kind === 'goal').observed_state;
    const w = warn(g)!;
    expect(w.say).toContain("What's today's level of monthly recurring revenue?");
    expect(w).not.toHaveProperty('first_ask');
  });
});
