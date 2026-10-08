/**
 * Science goals §(e) addendum 6 (8 Oct): a DECLARED product's operand the drafter typed as an OUTCOME reads as a factor,
 * with a label-derived count unit under guards. Fixture: P48's SERVED stored graph 552acb7d (Paul's brief, CEE b7653047).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { proposeProductIdentity } from '../identity-proposal.js';

type Rec = Record<string, any>;
const SERVED = (JSON.parse(readFileSync(new URL('./fixtures/goal-reach-served-p48-552acb7d.json', import.meta.url), 'utf8')) as Rec).graph as Rec;
const graph = (edit: (g: Rec) => void = () => {}): Rec => { const g = structuredClone(SERVED); edit(g); return g; };
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
const noRiskLink = (g: Rec) => { g.edges = g.edges.filter((e: Rec) => !(e.from === 'price_sensitivity' && e.to === 'mrr')); };
const WORDS = 'Olumi reads ‘MRR’ as ‘Pro plan monthly price’ × ‘Pro paying subscribers’. Is that how you work it out?';

describe('addendum 6 — an outcome operand of the declared product', () => {
  it('served 552acb7d as stored → null: the placeholder risk straight into MRR still vetoes (addenda 2/5)', () => {
    expect(node(SERVED, 'pro_paying_subscribers').kind).toBe('outcome');
    expect(proposeProductIdentity(SERVED)).toBeNull();
  });
  it('RED: the same graph with only that risk link gone → the card (outcome operand, label count unit)', () => {
    expect(proposeProductIdentity(graph(noRiskLink))).toEqual({ outcome_id: 'mrr', operation: 'product',
      factor_ids: ['pro_plan_monthly_price', 'pro_paying_subscribers'], words: WORDS });
  });
  it('guards: a money/rate label → null; a conflicting stored unit → null; a non-outcome, non-factor operand → null', () => {
    expect(proposeProductIdentity(graph(g => { noRiskLink(g); node(g, 'pro_paying_subscribers').label = 'Pro subscriber revenue'; }))).toBeNull();
    // Discriminating: this label COMPOSES (its noun ends in "subscriber"), so only the money-word guard refuses it.
    expect(proposeProductIdentity(graph(g => { noRiskLink(g); node(g, 'pro_paying_subscribers').label = 'Revenue-generating subscribers'; }))).toBeNull();
    expect(proposeProductIdentity(graph(g => { noRiskLink(g); node(g, 'pro_paying_subscribers').observed_state = { unit: 'hours' }; }))).toBeNull();
    // Kind guard isolated: the node keeps a stored count unit, so only its kind refuses it (Codex r1 #2826).
    expect(proposeProductIdentity(graph(g => { noRiskLink(g); Object.assign(node(g, 'pro_paying_subscribers'), { kind: 'risk', observed_state: { unit: 'subscribers' } }); }))).toBeNull();
    expect(proposeProductIdentity(graph(g => { noRiskLink(g); node(g, 'pro_paying_subscribers').label = 'Subscribers per month'; }))).toBeNull();
  });
  it('CONTROL: a stored count unit WINS over an unsafe label (the label is never read then)', () => {
    expect(proposeProductIdentity(graph(g => { noRiskLink(g); Object.assign(node(g, 'pro_paying_subscribers'), { label: 'Revenues from subscribers', observed_state: { unit: 'subscribers' } }); }))?.factor_ids)
      .toEqual(['pro_plan_monthly_price', 'pro_paying_subscribers']);
  });
  it.each(['Percentages of subscribers', 'Revenues from subscribers', 'Royalties from subscribers', 'Subscribers and seats', 'Average order count', 'Subscribers (k)'])(
    'Codex r1 P1: "%s" is not ONE count → null', label => {
      expect(proposeProductIdentity(graph(g => { noRiskLink(g); node(g, 'pro_paying_subscribers').label = label; }))).toBeNull();
    });
  it('CONTROL: an ordinary count label (word order varies) still reads as the count', () => {
    expect(proposeProductIdentity(graph(g => { noRiskLink(g); node(g, 'pro_paying_subscribers').label = 'Paying Pro subscribers'; }))).not.toBeNull();
  });
});
