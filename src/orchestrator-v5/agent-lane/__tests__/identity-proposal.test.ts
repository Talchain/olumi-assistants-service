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
      words: `Is “${node(served(0), 'mrr').label}” your “${node(served(0), 'pro_plan_price').label}” × “${node(served(0), 'paying_subscribers').label}”? £49 × 1,500 = £73,500, close to your £75,000. If yes, Olumi will calculate “${node(served(0), 'mrr').label}” that way, and you can run the analysis again.`,
    });
  });
  it('RED: runs 3 and 4 get the card too, the rate first whatever the edge order', () => {
    expect(proposeProductIdentity(served(3))?.factor_ids).toStrictEqual(['pro_plan_price', 'paying_pro_subscribers']);
    expect(proposeProductIdentity(served(4))?.factor_ids).toStrictEqual(['pro_plan_price', 'pro_paying_subscribers']);
  });
  it('FORK (iii) (R3 5891486222): served run 1 (Olumi\'s own product on the goal, the "99.8%" reply) → the card, over exactly its two parents', () => {
    expect(proposeProductIdentity(served(1))?.factor_ids).toStrictEqual(['pro_plan_price', 'paying_subscribers']);
  });
  it('NO CARD: the user\'s own product (stated_in_brief: true, e.g. after the card\'s Yes)', () => {
    const g = served(1);
    node(g, 'mrr').nonlinear_identity.stated_in_brief = true;
    expect(proposeProductIdentity(g)).toBeNull();
  });
  // DL 5892120941: run 2's goal has one intermediate parent, a FACTOR carrying Olumi's product, which PLoT #420 (d)
  // withholds. The goal card cannot apply (not the goal's own two parents); the card on the carrier does.
  it('run 2 (one intermediate parent, a factor holding Olumi\'s product) → the card on the CARRIER, not the goal', () => {
    expect(proposeProductIdentity(served(2))).toMatchObject({ outcome_id: 'pro_plan_mrr', operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'] });
  });
  it('NO CARD: Olumi\'s product over OTHER factors than the goal\'s two parents is not this card\'s to confirm', () => {
    const g = served(1);
    node(g, 'mrr').nonlinear_identity.factor_ids = ['pro_plan_price', 'something_else'];
    expect(proposeProductIdentity(g)).toBeNull();
  });
  it('every served card fits the door (≤ CARD_WORDS_MAX characters)', () => {
    for (const run of [0, 3, 4]) expect(proposeProductIdentity(served(run))!.words.length, `run ${run}`).toBeLessThanOrEqual(CARD_WORDS_MAX);
  });
  it('the price names its item ("GBP per subscriber per month"): STILL the card: the drafter\'s unit licenses nothing (AIQ 5891286280, DL 5891050797)', () => {
    const g = served(0);
    node(g, 'pro_plan_price').observed_state.unit = 'GBP per subscriber per month';
    expect(proposeProductIdentity(g)?.factor_ids).toStrictEqual(['pro_plan_price', 'paying_subscribers']);
  });
  it('the card is not a write: the graph is byte-identical after it', () => {
    const g = served(0);
    const before = JSON.stringify(g);
    proposeProductIdentity(g);
    expect(JSON.stringify(g)).toBe(before);
  });
  it('a level the user EDITED since the brief is still theirs: the card (AIQ 5888571809 (1))', () => {
    const g = served(0);
    node(g, 'paying_subscribers').observed_state.source = 'user_edited';
    expect(proposeProductIdentity(g)?.factor_ids).toStrictEqual(['pro_plan_price', 'paying_subscribers']);
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
    ['the subscribers level was only CONFIRMED by the user (ratification, not a stated figure)', (g: Json) => { node(g, 'paying_subscribers').observed_state.source = 'user_confirmed'; }],
    ['two goals', (g: Json) => { g.nodes.push({ id: 'g2', kind: 'goal', label: 'Other' }); }],
    ['card words past the #2292 door\'s 400 characters (a 400-character label)', (g: Json) => { node(g, 'pro_plan_price').label = 'P'.repeat(400); }],
  ] as const)('%s', (_why, f) => {
    expect(proposeProductIdentity(edit(f))).toBeNull();
  });
});

// ⛔ DL owner call 5892120941 (AIQ 5892069497's dead end, 1/19 served Paul-brief goals): Olumi's product on a CARRIER beside
// another goal parent was withheld by PLoT #420 (d) with nothing to press. The card offers the same reading on the carrier.
// Fixture: that registered graph, served on CEE `ed49d44` (AIQ pb5 run 4): `pro_plan_mrr` = price × subscribers beside
// Olumi's `other_plan_mrr` (£1,500), goal MRR £75,000. Each negative control changes exactly one thing on it.
const BESIDE = JSON.parse(readFileSync(new URL('./fixtures/served-paul-mrr-carrier-beside-residual-ed49d44.json', import.meta.url), 'utf8')) as { graph: Json };
const beside = (): Json => structuredClone(BESIDE.graph);

describe('a card-domain carrier BESIDE another goal parent (the 1/19 served dead end)', () => {
  it('PRECONDITION: MRR has no identity; its parents are the carrier and Olumi\'s £1,500; the carrier holds Olumi\'s price × subscribers', () => {
    const g = beside();
    expect(node(g, 'mrr').nonlinear_identity).toBeUndefined();
    expect(g.edges.filter((e: Json) => e.to === 'mrr').map((e: Json) => e.from).sort()).toStrictEqual(['other_plan_mrr', 'pro_plan_mrr']);
    expect(node(g, 'pro_plan_mrr').nonlinear_identity).toStrictEqual({ operation: 'product', factor_ids: ['pro_plan_price', 'paying_subscribers'], stated_in_brief: false });
    expect([node(g, 'other_plan_mrr').observed_state.raw_value, node(g, 'other_plan_mrr').observed_state.source]).toStrictEqual([1500, 'cee_inference']);
  });
  it('RED: the card on the CARRIER, its own two factors, the user\'s arithmetic against the goal\'s £75,000', () => {
    const g = beside();
    const label = (id: string): string => node(g, id).label;
    expect(proposeProductIdentity(g)).toStrictEqual({
      outcome_id: 'pro_plan_mrr',
      operation: 'product',
      factor_ids: ['pro_plan_price', 'paying_subscribers'],
      // AIQ 5892754930 (3): the Yes makes MRR the carrier PLUS its other parent, so the card names it and whose figure it is.
      words: `Is “${label('pro_plan_mrr')}” your “${label('pro_plan_price')}” × “${label('paying_subscribers')}”? £49 × 1,500 = £73,500; with “${label('other_plan_mrr')}” (Olumi's estimate, £1,500) that gives your £75,000 “${label('mrr')}”. If yes, Olumi will calculate “${label('pro_plan_mrr')}” that way, and you can run the analysis again.`,
    });
    expect(proposeProductIdentity(g)!.words.length).toBeLessThanOrEqual(CARD_WORDS_MAX);
  });
  // AIQ 5892754930 (3): whose figure the other parent is; "that gives" only when the figures add up to the goal (5%).
  it.each<[string, (g: Json) => void, string]>([
    ['the other parent is the user\'s figure', (g) => { node(g, 'other_plan_mrr').observed_state.source = 'brief_extraction'; }, '; with “Other-plan MRR” (your figure, £1,500) that gives your £75,000 “MRR”.'],
    ['the other parent has no figure', (g) => { delete node(g, 'other_plan_mrr').observed_state; }, ', close to your £75,000 “MRR”, which also adds “Other-plan MRR” (no figure yet).'],
    ['the figures do not add up to the goal (£10,000 beside £73,500)', (g) => { node(g, 'other_plan_mrr').observed_state.raw_value = 10000; }, ', close to your £75,000 “MRR”, which also adds “Other-plan MRR” (Olumi\'s estimate, £10,000).'],
    ['two other parents', (g) => { g.edges.push({ ...g.edges.find((e: Json) => e.from === 'other_plan_mrr' && e.to === 'mrr'), id: 'churn_to_mrr', from: 'monthly_churn_rate' }); }, ', close to your £75,000 “MRR”, which also adds “Other-plan MRR” (Olumi\'s estimate, £1,500) (and 1 more).'],
  ])('WORDS: %s', (_why, change, clause) => {
    const g = beside();
    change(g);
    expect(node(g, 'other_plan_mrr').label).toBe('Other-plan MRR');
    expect(proposeProductIdentity(g)?.words).toContain(`£49 × 1,500 = £73,500${clause} If yes,`);
  });
  it('the card is not a write: the graph is byte-identical after it', () => {
    const g = beside();
    const before = JSON.stringify(g);
    proposeProductIdentity(g);
    expect(JSON.stringify(g)).toBe(before);
  });
  it.each<[string, (g: Json) => void]>([
    ['the carrier\'s product is the user\'s (after the Yes)', (g) => { node(g, 'pro_plan_mrr').nonlinear_identity.stated_in_brief = true; }],
    ['a subscriber count Olumi estimated', (g) => { node(g, 'paying_subscribers').observed_state.source = 'cee_inference'; }],
    ['the product 18% off the goal (£90,000 against 49 × 1,500 = £73,500)', (g) => { node(g, 'mrr').observed_state.raw_value = 90000; }],
    ['a third parent into the carrier', (g) => { g.edges.push({ ...g.edges.find((e: Json) => e.to === 'pro_plan_mrr'), from: 'monthly_churn_rate' }); }],
    ['a SECOND qualifying carrier (two would be a guess)', (g) => {
      g.nodes.push({ ...structuredClone(node(g, 'pro_plan_mrr')), id: 'pro_plan_mrr_2', label: 'Pro plan MRR (copy)' });
      g.edges.push(...g.edges.filter((e: Json) => e.to === 'pro_plan_mrr' || e.from === 'pro_plan_mrr').map((e: Json) => ({ ...e, id: `${e.id}_2`, from: e.from === 'pro_plan_mrr' ? 'pro_plan_mrr_2' : e.from, to: e.to === 'pro_plan_mrr' ? 'pro_plan_mrr_2' : e.to })));
    }],
    ['units that do not compose (the count typed as £)', (g) => { node(g, 'paying_subscribers').observed_state.unit = '£/month'; }],
  ])('NO CARD: %s', (_why, change) => {
    const g = beside();
    change(g);
    expect(proposeProductIdentity(g)).toBeNull();
  });
});
