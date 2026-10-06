/**
 * ⭐ D3 cut 5 (DL 0df0e1; Science d5 #87 6008242694 / 6008252938): J4's "about 50%, against about 35%" was driven by
 * Olumi's 0.8 existence prior on the USER's stated links (held at 1: 51 vs 54). The licence says so, typed: present iff a
 * user-stated link on a licensed option's goal path has exists_probability < 1; `one_in` only when every such link shares
 * one value. Twins: links at 1.0, an Olumi-estimated link, an off-path link → nothing; a withheld Run has no licence.
 */
import { describe, expect, it } from 'vitest';
import { goalChanceLicenceOf } from '../goal-chance-licence.js';

type Rec = Record<string, any>;
const env = (...ps: Array<[string, number]>): Rec => ({
  option_comparison: ps.map(([id, p]) => ({ option_id: id, id, probability_of_goal: p, win_probability: 0.5 })), inference_warnings: [] });
const userLink = (from: string, to: string, exists: number): Rec => ({ from, to, strength: { mean: 0.6, std: 0.3 }, exists_probability: exists,
  provenance: { source: 'user_specified' } });
const olumiLink = (from: string, to: string, exists: number): Rec => ({ from, to, strength: { mean: 0.4, std: 0.2 }, exists_probability: exists,
  provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } });
/** T1b-like: two price options; price → customers → MRR (goal "at least £20,000"). */
function graph(edges: Rec[]): Rec {
  return { nodes: [
    { id: 'mrr', kind: 'goal', label: 'MRR', goal_threshold_raw: 20000, goal_threshold: 0.5, goal_threshold_unit: '£', goal_direction: '>=' },
    { id: 'price', kind: 'factor', label: 'Price' }, { id: 'customers', kind: 'factor', label: 'Customers' },
    { id: 'office', kind: 'factor', label: 'Office move' },
    { id: 'a', kind: 'option', label: 'Raise', interventions: { price: { value: 0.6 } } },
    { id: 'b', kind: 'option', label: 'Starter', interventions: { price: { value: 0.4 } } },
  ], edges };
}
const existence = (edges: Rec[]) => goalChanceLicenceOf(env(['a', 0.5], ['b', 0.35]), graph(edges), 'mrr')?.user_link_existence;

describe('the licence says when the chances count Olumi\'s doubt about the USER\'s links', () => {
  it('R17 shape: user-stated links on the path at 0.8 → 2 links, 1-in-5', () => {
    expect(existence([userLink('price', 'customers', 0.8), userLink('customers', 'mrr', 0.8)])).toEqual({ links: 2, one_in: 5 });
  });
  it('TWIN: the same links held at 1.0 → nothing', () => {
    expect(existence([userLink('price', 'customers', 1), userLink('customers', 'mrr', 1)])).toBeUndefined();
  });
  it('0.9 → 1-in-10 (never 1-in-5); mixed values → the count only (the words say Olumi\'s estimate for each)', () => {
    expect(existence([userLink('price', 'customers', 0.9), userLink('customers', 'mrr', 0.9)])).toEqual({ links: 2, one_in: 10 });
    expect(existence([userLink('price', 'customers', 0.8), userLink('customers', 'mrr', 0.9)])).toEqual({ links: 2 });
  });
  it('only USER-stated links count: an Olumi estimate at 0.8 → nothing', () => {
    expect(existence([olumiLink('price', 'customers', 0.8), olumiLink('customers', 'mrr', 0.8)])).toBeUndefined();
  });
  it('only links on a licensed option\'s goal path: a user link off every option\'s path → nothing', () => {
    expect(existence([olumiLink('price', 'mrr', 0.8), userLink('office', 'mrr', 0.8)])).toBeUndefined();
  });
  it('a Run with no licence (no stated target) carries no record at all, so no line', () => {
    const g = graph([userLink('price', 'mrr', 0.8)]);
    delete g.nodes[0].goal_threshold_raw; delete g.nodes[0].goal_threshold;
    expect(goalChanceLicenceOf(env(['a', 0.5], ['b', 0.35]), g, 'mrr')).toBeNull();
  });
});
