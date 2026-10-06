/**
 * ⭐ D3 cut 5 (DL 0df0e1; Science d5 #87 6008242694 / 6008252938): J4's "about 50%, against about 35%" was driven by
 * Olumi's 0.8 existence prior on the USER's stated links (held at 1: 51 vs 54). The licence says so, typed: present iff a
 * user-stated link on a licensed option's goal path has exists_probability < 1; `one_in` only when every such link shares
 * one value. Twins: links at 1.0, an Olumi-estimated link, an off-path link → nothing; a withheld Run has no licence.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { goalChanceLicenceOf, userStatedLinksBelowOne } from '../goal-chance-licence.js';

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
  it('Codex r1 #1: the SCORED goal\'s path, never the first goal\'s', () => {
    const g = graph([olumiLink('price', 'mrr', 1), userLink('price', 'nps', 0.8)]);
    g.nodes.push({ id: 'nps', kind: 'goal', label: 'NPS', goal_threshold_raw: 40, goal_threshold: 0.4, goal_threshold_unit: 'points', goal_direction: '>=' });
    const onMrr = goalChanceLicenceOf(env(['a', 0.5], ['b', 0.35]), g, 'mrr');
    expect(onMrr, 'precondition: the Run is licensed').not.toBeNull();
    expect(onMrr!.user_link_existence).toBeUndefined();
    expect(goalChanceLicenceOf(env(['a', 0.5], ['b', 0.35]), g, 'nps')?.user_link_existence).toEqual({ links: 1, one_in: 5 });
  });
  it('Codex r1 #2: a relationship the user\'s BRIEF stated counts (brief_extraction); an Olumi hypothesis they only accepted does not', () => {
    const brief = { ...olumiLink('price', 'mrr', 0.8), provenance: { source: 'brief_extraction', magnitude: 'olumi_estimate', source_quote: '<quote>', reviewed_by_user: { intent: 'confirm' } } };
    expect(existence([brief])).toEqual({ links: 1, one_in: 5 });
    const accepted = { ...olumiLink('price', 'mrr', 0.8), provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm' } } };
    expect(existence([accepted])).toBeUndefined();
  });
  it('Codex r1 #3: an IDENTITY edge (ISL fixes it, no Bernoulli gate) never counts', () => {
    const g = graph([userLink('price', 'mrr', 0.8), olumiLink('customers', 'mrr', 1)]);
    g.nodes[0].nonlinear_identity = { op: 'product', factor_ids: ['price', 'customers'] };
    const l = goalChanceLicenceOf(env(['a', 0.5], ['b', 0.35]), g, 'mrr');
    expect(l, 'precondition: the Run is licensed').not.toBeNull();
    expect(l!.user_link_existence).toBeUndefined();
  });

  it('Science d5 6008444863, SERVED G1 draft 1 (CEE 231affb): every counted brief edge carries its quote; an unquoted one never counts', () => {
    const G1 = JSON.parse(readFileSync(new URL('./fixtures/g1-draft1-graph.json', import.meta.url), 'utf8')).graph as Rec;
    const options = G1.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => n.id as string);
    const counted = userStatedLinksBelowOne(G1, G1.goal_node_id ?? 'monthly_recurring_revenue', options);
    // A brief edge counts by its QUOTE unless the user stated its size (magnitude 'user_stated' is the user's own figure).
    const viaBrief = counted.filter((e) => e.provenance?.source === 'brief_extraction' && e.provenance?.magnitude !== 'user_stated');
    for (const e of viaBrief) expect(e.provenance.source_quote, `${e.from}->${e.to}`).toBe('<quote>');
    // PRECONDITION (non-vacuous): the draft holds an unquoted, Olumi-sized brief edge below 1 — and it is not counted.
    const unquoted = G1.edges.filter((e: Rec) => e.provenance?.source === 'brief_extraction' && !e.provenance.source_quote
      && e.provenance.magnitude !== 'user_stated' && e.exists_probability < 1);
    expect(unquoted.length).toBeGreaterThan(0);
    for (const e of unquoted) expect(counted).not.toContain(e);
  });

  it('a Run with no licence (no stated target) carries no record at all, so no line', () => {
    const g = graph([userLink('price', 'mrr', 0.8)]);
    delete g.nodes[0].goal_threshold_raw; delete g.nodes[0].goal_threshold;
    expect(goalChanceLicenceOf(env(['a', 0.5], ['b', 0.35]), g, 'mrr')).toBeNull();
  });
});
