/**
 * ⭐ D3 cut 6, HOLD-AT-1.0 (Science d5 #87 6008807178 / 6008817484): a USER-stated link whose own stated range excludes
 * zero holds at exists_probability 1.0 on the Run's input, with sd_β = |β(high) − β(low)| / 3.29 and the mean left at the
 * STATED value. One function: the PLoT payload, the licence's existence flag and the input snapshot all read it; the
 * persisted graph is untouched. No range → no hold (never mean ± k·std: circular).
 */
import { describe, expect, it } from 'vitest';
import { heldLinkOf, withHeldUserLinks } from '../held-user-links.js';
import { goalChanceLicenceOf, userStatedLinksBelowOne } from '../goal-chance-licence.js';

type Rec = Record<string, any>;
/** The user wrote "20 to 40 subscribers per £1"; the low end (20) is the size the link carries (A4), β 0.3 on its frame. */
const ranged = (low: number, high: number, amount = low): Rec => ({
  amount, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: '£', strength_mean: 0.3 * (amount / 20),
  strength_mean_frame: 'edge_strength', stated_range: { low, high, text: `${low} to ${high}`, end: 'low' },
});
const userLink = (from: string, to: string, ne: Rec | undefined, exists = 0.8): Rec => ({
  from, to, strength: { mean: ne?.strength_mean ?? 0.6, std: 0.15 }, exists_probability: exists,
  provenance: { source: 'user_specified', magnitude: 'user_stated', ...(ne !== undefined ? { natural_effect: ne } : {}) },
});
const sdOf = (low: number, high: number): number => Math.abs(0.3 * (high / 20) - 0.3 * (low / 20)) / 3.29;

describe('hold-at-1.0: a user link whose own range excludes zero holds on the Run input', () => {
  it('HELD: user-sized, range 20 to 40 → exists 1.0, sd_β = |β(40) − β(20)| / 3.29, the mean stays the stated β', () => {
    const e = userLink('price', 'subs', ranged(20, 40));
    expect(heldLinkOf(e)).toEqual({ std: sdOf(20, 40) });
    const g = withHeldUserLinks({ nodes: [], edges: [e] });
    expect(g.edges[0].exists_probability).toBe(1);
    expect(g.edges[0].strength.std).toBeCloseTo(sdOf(20, 40), 12);
    // Mutant "midpoint mean" → RED: the mean is the user's stated end, never (low + high) / 2.
    expect(g.edges[0].strength.mean).toBe(0.3);
  });
  it('a NEGATIVE range (−40 to −20) excludes zero too → held', () => {
    expect(heldLinkOf(userLink('price', 'churn', ranged(-40, -20, -40)))).toEqual({ std: sdOf(-40, -20) });
  });
  it('CONTRAST: a range that STRADDLES zero (−5 to 10) → not held, the edge is byte-identical', () => {
    const e = userLink('price', 'subs', ranged(-5, 10, 10));
    expect(heldLinkOf(e)).toBeNull();
    const g = { nodes: [], edges: [e] };
    expect(withHeldUserLinks(g)).toBe(g);
  });
  it('a range touching zero (0 to 10) does not exclude it → not held', () => {
    expect(heldLinkOf(userLink('price', 'subs', ranged(0, 10, 10)))).toBeNull();
  });
  it('NO RANGE → no hold, whatever the size or spread (never mean ± k·std)', () => {
    const ne = ranged(20, 40);
    delete ne.stated_range;
    expect(heldLinkOf(userLink('price', 'subs', ne))).toBeNull();
    expect(heldLinkOf(userLink('price', 'subs', undefined))).toBeNull();
  });
  it('CLASS: an Olumi estimate carrying a range → not held; a brief-quoted link → held; brief WITHOUT its quote → not', () => {
    const olumi = { ...userLink('price', 'subs', ranged(20, 40)), provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: ranged(20, 40) } };
    expect(heldLinkOf(olumi)).toBeNull();
    const brief = { ...userLink('price', 'subs', ranged(20, 40)), provenance: { source: 'brief_extraction', source_quote: 'each £1 brings 20 to 40 subscribers', natural_effect: ranged(20, 40) } };
    expect(heldLinkOf(brief)).toEqual({ std: sdOf(20, 40) });
    expect(heldLinkOf({ ...brief, provenance: { ...brief.provenance, source_quote: '  ' } })).toBeNull();
  });
  it('the PERSISTED graph is never written: the input is not mutated and a held graph is a new object', () => {
    const e = userLink('price', 'subs', ranged(20, 40));
    const g = { nodes: [], edges: [e] };
    const before = structuredClone(g);
    const out = withHeldUserLinks(g);
    expect(out).not.toBe(g);
    expect(g).toEqual(before);
  });
  it('mutant "default spread on a held link" → RED: the held std is the range\'s, never the edge\'s prior 0.15', () => {
    const out = withHeldUserLinks({ nodes: [], edges: [userLink('price', 'subs', ranged(20, 40))] });
    expect(out.edges[0].strength.std).not.toBe(0.15);
  });
});

describe('the licence reads the SAME hold: a held link never counts as Olumi\'s doubt', () => {
  const graph = (edges: Rec[]): Rec => ({ nodes: [
    { id: 'mrr', kind: 'goal', label: 'MRR', goal_threshold_raw: 20000, goal_threshold: 0.5, goal_threshold_unit: '£', goal_direction: '>=' },
    { id: 'price', kind: 'factor', label: 'Price' }, { id: 'subs', kind: 'factor', label: 'Subscribers' },
    { id: 'a', kind: 'option', label: 'Raise', interventions: { price: { value: 0.6 } } },
    { id: 'b', kind: 'option', label: 'Starter', interventions: { price: { value: 0.4 } } },
  ], edges });
  const env = { option_comparison: [['a', 0.5], ['b', 0.35]].map(([id, p]) => ({ option_id: id, id, probability_of_goal: p, win_probability: 0.5 })), inference_warnings: [] };
  it('TWIN (the deterministic line-absent case): both path links ranged off zero → no flag', () => {
    const edges = [userLink('price', 'subs', ranged(20, 40)), userLink('subs', 'mrr', ranged(20, 40))];
    expect(userStatedLinksBelowOne(graph(edges), 'mrr', ['a', 'b'])).toEqual([]);
    expect(goalChanceLicenceOf(env, graph(edges), 'mrr')?.user_link_existence).toBeUndefined();
  });
  it('CONTRAST: the same links with no range → both counted, 1-in-5', () => {
    const edges = [userLink('price', 'subs', undefined), userLink('subs', 'mrr', undefined)];
    expect(goalChanceLicenceOf(env, graph(edges), 'mrr')?.user_link_existence).toEqual({ links: 2, one_in: 5 });
  });
  it('one held, one not → the count is the unheld one only', () => {
    const edges = [userLink('price', 'subs', ranged(20, 40)), userLink('subs', 'mrr', undefined)];
    expect(goalChanceLicenceOf(env, graph(edges), 'mrr')?.user_link_existence).toEqual({ links: 1, one_in: 5 });
  });
});
