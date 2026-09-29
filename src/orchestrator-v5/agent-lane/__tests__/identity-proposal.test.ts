/**
 * ⛔ THE CARD FOR A PRODUCT THE MINT COULD NOT PROVE (DL 5888399097; AIQ 5886967509 step (2)).
 *
 * Fixture: the five STORED graphs of Paul's MRR brief served on CEE `ed49d44` (R3 witness #72 5888379558), where 4/5
 * replies said £59 does not reach £85k. Every row binds by node id on those served bytes; each negative control changes
 * exactly one thing on run 0's served graph.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CARD_WORDS_MAX, proposeProductIdentity } from '../identity-proposal.js';

type Json = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/served-paul-mrr-ed49d44.json', import.meta.url), 'utf8')) as { runs: { run: number; graph: Json }[] };
const served = (run: number): Json => structuredClone(FX.runs.find((r) => r.run === run)!.graph);
const node = (g: Json, id: string): Json => g.nodes.find((n: Json) => n.id === id);

describe('PRECONDITIONS — the served bytes', () => {
  it('runs 0, 3, 4: MRR has no identity; its two parents are the user\'s £49 (price, no per-item unit) and 1,500', () => {
    for (const run of [0, 3, 4]) {
      const g = served(run);
      expect(node(g, 'mrr').nonlinear_identity, `run ${run}`).toBeUndefined();
      const parents = g.edges.filter((e: Json) => e.to === 'mrr').map((e: Json) => node(g, e.from).observed_state);
      expect(parents.map((o: Json) => [o.raw_value, o.source]).sort(), `run ${run}`).toStrictEqual([[1500, 'brief_extraction'], [49, 'brief_extraction']]);
      expect(parents.find((o: Json) => o.raw_value === 49).unit, `run ${run}`).toMatch(/^(£|GBP)\/month$/);
    }
  });
  it('run 1 already carries MRR = price × subscribers (#2286 minted it); run 2\'s MRR has ONE parent, an intermediate product', () => {
    expect(node(served(1), 'mrr').nonlinear_identity).toMatchObject({ operation: 'product' });
    const g2 = served(2);
    expect(g2.edges.filter((e: Json) => e.to === 'mrr').map((e: Json) => e.from)).toStrictEqual(['pro_plan_mrr']);
  });
});

describe('the card on the served graphs', () => {
  it('RED: run 0 → the reading and its arithmetic on Paul\'s own stored figures', () => {
    expect(proposeProductIdentity(served(0))).toStrictEqual({
      outcome_id: 'mrr',
      operation: 'product',
      factor_ids: ['pro_plan_price', 'paying_subscribers'],
      words: `Is “${node(served(0), 'mrr').label}” your “${node(served(0), 'pro_plan_price').label}” × “${node(served(0), 'paying_subscribers').label}”? £49 × 1,500 = £73,500, close to your £75,000.`,
    });
  });
  it('RED: runs 3 and 4 get the card too, the rate first whatever the edge order', () => {
    expect(proposeProductIdentity(served(3))?.factor_ids).toStrictEqual(['pro_plan_price', 'paying_pro_subscribers']);
    expect(proposeProductIdentity(served(4))?.factor_ids).toStrictEqual(['pro_plan_price', 'pro_paying_subscribers']);
  });
  it('NO CARD: run 1 (the identity is already there) and run 2 (one intermediate parent: MG\'s construction guard)', () => {
    expect(proposeProductIdentity(served(1))).toBeNull();
    expect(proposeProductIdentity(served(2))).toBeNull();
  });
  it('every served card fits the door (≤ CARD_WORDS_MAX characters)', () => {
    for (const run of [0, 3, 4]) expect(proposeProductIdentity(served(run))!.words.length, `run ${run}`).toBeLessThanOrEqual(CARD_WORDS_MAX);
  });
  it('the card is not a write: the graph is byte-identical after it', () => {
    const g = served(0);
    const before = JSON.stringify(g);
    proposeProductIdentity(g);
    expect(JSON.stringify(g)).toBe(before);
  });
  it('an option edge into the goal is not a parent: still the card', () => {
    const g = served(0);
    const opt = g.nodes.find((n: Json) => n.kind === 'option');
    g.edges.push({ from: opt.id, to: 'mrr' });
    expect(proposeProductIdentity(g)?.factor_ids).toStrictEqual(['pro_plan_price', 'paying_subscribers']);
  });
});

describe('NO CARD — one change on run 0\'s served graph each', () => {
  const edit = (f: (g: Json) => void): Json => { const g = served(0); f(g); return g; };
  it.each([
    ['the subscribers level is Olumi\'s, not the user\'s', (g: Json) => { node(g, 'paying_subscribers').observed_state.source = 'cee_inference'; }],
    ['the goal\'s level is Olumi\'s', (g: Json) => { node(g, 'mrr').observed_state.source = 'cee_inference'; }],
    ['18% off: the goal\'s level is £60,000', (g: Json) => { node(g, 'mrr').observed_state.raw_value = 60000; }],
    ['a third parent into the goal', (g: Json) => { g.nodes.push({ id: 'brand', kind: 'factor', label: 'Brand', observed_state: { raw_value: 3, unit: 'score', source: 'brief_extraction' } }); g.edges.push({ from: 'brand', to: 'mrr' }); }],
    ['a parent is itself a product carrier', (g: Json) => { node(g, 'paying_subscribers').nonlinear_identity = { operation: 'product', factor_ids: ['a', 'b'], stated_in_brief: false }; }],
    ['the price is in another currency', (g: Json) => { node(g, 'pro_plan_price').observed_state.unit = 'USD/month'; }],
    ['the price is per SEAT (a mismatched denominator is invalid, not a question)', (g: Json) => { node(g, 'pro_plan_price').observed_state.unit = '£ per seat per month'; }],
    ['the goal is yearly, the price monthly', (g: Json) => { node(g, 'mrr').goal_threshold_unit = 'GBP/year'; }],
    ['the count is a rate ("subscribers per month")', (g: Json) => { node(g, 'paying_subscribers').observed_state.unit = 'subscribers per month'; }],
    ['two goals', (g: Json) => { g.nodes.push({ id: 'g2', kind: 'goal', label: 'Other' }); }],
    ['card words past the #2292 door\'s 400 characters (a 400-character label)', (g: Json) => { node(g, 'pro_plan_price').label = 'P'.repeat(400); }],
  ] as const)('%s', (_why, f) => {
    expect(proposeProductIdentity(edit(f))).toBeNull();
  });
});
