/**
 * Structural facts — derived from the persisted graph, never invented.
 *
 * ⭐ MEASURED MOTIVATION. On the same 29-node model, current CEE answered two
 * of three questions better than the Agent lane, and the difference was not
 * reasoning: CEE could say "every option reaches the goal" and "twelve factors
 * still lack values". The Agent had only an entity list and an edge list.
 */

import { describe, it, expect } from 'vitest';
import { structuralFacts } from '../structural-facts.js';

const nodes = [
  { id: 'goal', kind: 'goal', label: 'MRR' },
  { id: 'opt_a', kind: 'option', label: 'Raise price' },
  { id: 'opt_b', kind: 'option', label: 'Does nothing' },
  { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 49 } },
  { id: 'churn', kind: 'factor', label: 'Monthly churn' },
  { id: 'lonely', kind: 'factor', label: 'Competitive pricing' },
  { id: 'sidetrack', kind: 'outcome', label: 'Brand sentiment' },
];
const edges = [
  { from: 'opt_a', to: 'price' },
  { from: 'price', to: 'churn' },
  { from: 'churn', to: 'goal' },
  // connected, but nothing downstream of it leads to the goal
  { from: 'price', to: 'sidetrack' },
];

describe('structuralFacts', () => {
  const f = structuralFacts(nodes, edges);

  it('separates options that reach the goal from those that cannot', () => {
    expect(f.options_reaching_goal).toEqual(['Raise price']);
    expect(f.options_not_reaching_goal).toEqual(['Does nothing']);
  });

  it('names every entity with no edge at all, options included', () => {
    // An option with no edges is BOTH unreachable and unconnected. Both
    // statements are true and they are not the same statement, so it appears
    // in both lists deliberately rather than being filtered out of one.
    expect(f.entities_with_no_connections).toEqual(['Does nothing', 'Competitive pricing']);
    expect(f.options_not_reaching_goal).toContain('Does nothing');
  });

  it('distinguishes UNCONNECTED from CONNECTED-BUT-STRANDED', () => {
    // The whole point of two fields: "it has no edges" and "its edges lead
    // nowhere useful" are different problems with different fixes, and
    // collapsing them would make the Agent's advice wrong.
    expect(f.entities_with_no_connections).not.toContain('Brand sentiment');
    expect(f.entities_that_cannot_reach_goal).toContain('Brand sentiment');
  });

  it('counts only FACTORS that lack a value, not every node', () => {
    // \u26d4 Counting every node reported "28 entities have no value" on a
    // 29-node model, and the Agent said exactly that to a user. A goal, an
    // option, a risk and an outcome never carry an observed value, so almost
    // all of that count was never a gap. Fixture: 3 factors, one of which
    // (`price`) has a value.
    expect(f.factors_without_a_value).toBe(2);
  });

  it('does not count an option or a risk as a missing value \u2014 contrast control', () => {
    const optionsAndOutcomes = nodes.filter((n) => n.kind === 'option' || n.kind === 'outcome');
    expect(optionsAndOutcomes.length).toBeGreaterThan(0);
    // If these were counted, the number above could not be 2.
    expect(f.factors_without_a_value).toBeLessThan(nodes.length - 1);
  });

  it('reports no goal rather than guessing one', () => {
    const g = structuralFacts(nodes.filter((n) => n.kind !== 'goal'), edges);
    expect(g.goal_label).toBeNull();
    expect(g.options_reaching_goal).toEqual([]);
    expect(g.options_not_reaching_goal).toEqual([]);
  });

  it('terminates on a cycle', () => {
    const cyclic = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'b', to: 'goal' }];
    const n = [{ id: 'goal', kind: 'goal', label: 'G' }, { id: 'a', kind: 'option', label: 'A' }, { id: 'b', kind: 'factor', label: 'B' }];
    expect(structuralFacts(n, cyclic).options_reaching_goal).toEqual(['A']);
  });
});
