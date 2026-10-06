/**
 * ⭐ D3 cut 6 INTERIM (Science d5 #87 6009272273 + amendment; DL 0df0e1 adopted): no summary form (highest, either
 * all-likely-to-miss, similar) while a compared option's goal path carries an existence < 1 the user did not set. J4 R17
 * read "highest" 50/35 with Olumi's 0.8 prior and 46/46 without it; MC draft 7 flipped its leader. Form `each` plus a
 * typed `summary_withheld`; the per-option chances stay the headline. A HELD link (the user's range excludes zero) and an
 * identity edge are not Olumi's doubt.
 */
import { describe, expect, it } from 'vitest';
import { goalChanceLicenceOf, goalChanceLicenceForAgent, olumiExistenceOnGoalPath } from '../goal-chance-licence.js';

type Rec = Record<string, any>;
const env = (...ps: Array<[string, number]>): Rec => ({
  option_comparison: ps.map(([id, p]) => ({ option_id: id, id, probability_of_goal: p, win_probability: 0.5 })), inference_warnings: [] });
const link = (from: string, to: string, exists: number, provenance: Rec = { source: 'cee_hypothesis', magnitude: 'olumi_estimate' }): Rec =>
  ({ from, to, strength: { mean: 0.4, std: 0.2 }, exists_probability: exists, provenance });
const heldUser = (from: string, to: string): Rec => link(from, to, 0.8, { source: 'user_specified', magnitude: 'user_stated',
  natural_effect: { amount: 20, amount_unit: 'customers', per_source_change: 1, per_source_change_unit: '£', strength_mean: 0.4,
    strength_mean_frame: 'edge_strength', stated_range: { low: 20, high: 40, text: '20 to 40', end: 'low' } } });
function graph(edges: Rec[], extraNodes: Rec[] = []): Rec {
  return { nodes: [
    { id: 'mrr', kind: 'goal', label: 'MRR', goal_threshold_raw: 20000, goal_threshold: 0.5, goal_threshold_unit: '£', goal_direction: '>=' },
    { id: 'price', kind: 'factor', label: 'Price' }, { id: 'customers', kind: 'factor', label: 'Customers' },
    { id: 'office', kind: 'factor', label: 'Office move' },
    { id: 'a', kind: 'option', label: 'Raise', interventions: { price: { value: 0.6 } } },
    { id: 'b', kind: 'option', label: 'Starter', interventions: { price: { value: 0.4 } } },
    ...extraNodes,
  ], edges };
}
const lic = (e: Rec, g: Rec): Rec => goalChanceLicenceOf(e, g, 'mrr') as Rec;

describe('interim: a summary Olumi\'s own existence prior could have produced is not stated', () => {
  it('R17 shape: "highest" 50 vs 35 with an unheld 0.8 on the path → `each`, no leader, typed cause', () => {
    const l = lic(env(['a', 0.5], ['b', 0.35]), graph([link('price', 'customers', 0.8), link('customers', 'mrr', 1)]));
    expect(l.form).toBe('each');
    expect(l).not.toHaveProperty('leader_option_id');
    expect(l).not.toHaveProperty('next_option_id');
    expect(l.summary_withheld).toEqual({ cause: 'olumi_existence_assumption', form: 'highest' });
    expect(l.pct_by_option).toEqual({ a: 50, b: 35 }); // the per-option chances stay the headline
  });
  it('CONTRAST: every path link at 1.0 → "highest" is still licensed, no cause', () => {
    const l = lic(env(['a', 0.5], ['b', 0.35]), graph([link('price', 'customers', 1), link('customers', 'mrr', 1)]));
    expect(l.form).toBe('highest');
    expect(l.leader_option_id).toBe('a');
    expect(l).not.toHaveProperty('summary_withheld');
  });
  it('a HELD user link at 0.8 (range excludes zero) is the user\'s, not Olumi\'s doubt → "highest" stands', () => {
    const l = lic(env(['a', 0.5], ['b', 0.35]), graph([heldUser('price', 'customers'), link('customers', 'mrr', 1)]));
    expect(l.form).toBe('highest');
  });
  it('an IDENTITY edge at 0.8 is fixed by ISL → "highest" stands', () => {
    const g = graph([link('price', 'customers', 1), link('customers', 'mrr', 0.8)]);
    g.nodes.find((n: Rec) => n.id === 'mrr').nonlinear_identity = { factor_ids: ['customers'] };
    expect(lic(env(['a', 0.5], ['b', 0.35]), g).form).toBe('highest');
  });
  it('d5 amendment: `similar` (46 vs 44) with an unheld 0.8 → `each` too', () => {
    const on = lic(env(['a', 0.46], ['b', 0.44]), graph([link('price', 'customers', 0.8), link('customers', 'mrr', 1)]));
    expect(on.form).toBe('each');
    expect(on.summary_withheld).toEqual({ cause: 'olumi_existence_assumption', form: 'similar' });
    expect(on).not.toHaveProperty('similar_option_ids');
    // CONTRAST: the same chances with no prior on the path → `similar`.
    expect(lic(env(['a', 0.46], ['b', 0.44]), graph([link('price', 'customers', 1), link('customers', 'mrr', 1)])).form).toBe('similar');
  });
  it('both all-likely-to-miss forms (35 vs 20; 30 vs 28) with an unheld 0.8 → `each`', () => {
    const edges = [link('price', 'customers', 0.8), link('customers', 'mrr', 1)];
    expect(lic(env(['a', 0.35], ['b', 0.2]), graph(edges)).summary_withheld).toEqual({ cause: 'olumi_existence_assumption', form: 'highest_all_likely_to_miss' });
    expect(lic(env(['a', 0.3], ['b', 0.28]), graph(edges)).summary_withheld).toEqual({ cause: 'olumi_existence_assumption', form: 'all_likely_to_miss' });
    expect(lic(env(['a', 0.3], ['b', 0.28]), graph(edges)).form).toBe('each');
  });
  it('an OFF-PATH link at 0.8 (no compared option reaches it) does not withhold the summary', () => {
    const l = lic(env(['a', 0.5], ['b', 0.35]), graph([link('price', 'customers', 1), link('customers', 'mrr', 1), link('office', 'customers', 0.8)]));
    expect(olumiExistenceOnGoalPath(graph([link('office', 'customers', 0.8)]), 'mrr', ['a', 'b'])).toBe(false);
    expect(l.form).toBe('highest');
  });
  it('the Agent\'s view of the same record ranks nothing (`each`, no leader): the chat cannot name what the panel withholds', () => {
    const l = lic(env(['a', 0.5], ['b', 0.35]), graph([link('price', 'customers', 0.8), link('customers', 'mrr', 1)]));
    const agent = goalChanceLicenceForAgent({ enrichment: { inference_warnings: [l] } } as never) as Rec | undefined;
    expect(agent?.form).toBe('each');
    expect(agent).not.toHaveProperty('leader_option_id');
  });
});

describe('SERVED J4 R17 (scenario 49e22bef, graph_hash 97a724c215d9920d, CEE 231affb; Acceptance e7 read "highest … about 50%, against about 35%")', () => {
  const load = async (): Promise<Rec> => {
    const { readFileSync } = await import('node:fs');
    return JSON.parse(readFileSync(new URL('./fixtures/r17-served-graph.json', import.meta.url), 'utf8')) as Rec;
  };
  /** The served Run's own goal certainty earned Keep's exact 0 (`analysis_goal_certainty`, earned: true). */
  const earnedBy = (fx: Rec) => (id: string, p: 0 | 1): boolean =>
    (fx.goal_certainty as Rec[]).some((r) => r.option_id === id && r.probability_of_goal === p && r.earned === true);
  it('PRECONDITION (twin): with every path link at 1.0 the served Run licenses "highest", Raise over Starter', async () => {
    const fx = await load();
    const g = structuredClone(fx.graph);
    for (const e of g.edges) e.exists_probability = 1;
    const l = goalChanceLicenceOf(fx.envelope, g, fx.goal_node_id, earnedBy(fx)) as Rec;
    expect(l.form).toBe('highest');
    expect(l.leader_option_id).toBe('raise_prices_10');
  });
  it('AS SERVED: its user-stated links carry Olumi\'s 0.8 and no range (nothing held) → `each`, typed cause, chances kept', async () => {
    const fx = await load();
    const l = goalChanceLicenceOf(fx.envelope, fx.graph, fx.goal_node_id, earnedBy(fx)) as Rec;
    expect(l.form).toBe('each');
    expect(l.summary_withheld).toEqual({ cause: 'olumi_existence_assumption', form: 'highest' });
    expect(l.pct_by_option).toMatchObject({ raise_prices_10: 50, launch_starter_tier: 35 });
    expect(l).not.toHaveProperty('leader_option_id');
  });
});
