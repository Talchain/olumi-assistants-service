import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_WORDS_MAX, proposeProductIdentity } from '../identity-proposal.js';
import { unconfirmedGoalProductFor } from '../../tools/handlers/unconfirmed-goal-product.js';
import { actionFactsOf } from '../actions/state.js';
import { actionBarOf } from '../actions/rank.js';
import { decidePress } from '../actions/handlers.js';
import { IDENTITY_ISSUED_FALLBACK, identityApproveMessage, identityIssuedText, readingOfIdentityApproval } from '../identity-card.js';

type Graph = { nodes: Record<string, any>[]; edges: Record<string, any>[] };
const PAUL = JSON.parse(readFileSync(new URL('./fixtures/goal-reach-paul-graph-632b92b9.json', import.meta.url), 'utf8')) as Graph;
const graph = (edit: (g: Graph) => void = () => {}) => { const g = structuredClone(PAUL); edit(g); return g; };
const node = (g: Graph, id: string) => g.nodes.find(n => n.id === id)!;
const offers = (g: Graph) => { const b = actionBarOf(actionFactsOf({ scenarioId: 'goal-reach', graph: g })); return [...b.priority, ...b.standard, ...b.more]; };
const confirm = (g: Graph) => offers(g).filter(o => o.action_id === 'confirm_reading');
const WORDS = 'Olumi reads ‘MRR’ as ‘Pro plan price’ × ‘Pro paying subscribers’. Is that how you work it out?';
const withCurrent = (current: number) => graph(g => {
  // Science's known answer is the earlier 300, not the final stored fixture's 8,000.
  node(g, 'pro_paying_subscribers').observed_state = { unit: 'subscribers', raw_value: 300, value: 0.15, source: 'cee_inference' };
  node(g, 'mrr').observed_state = { unit: '£/month', raw_value: current, value: current / 40000, cap: 40000, source: 'brief_extraction' };
});

describe('GOAL-REACH build 1 stored reading', () => {
  it('row 1: Paul’s stored graph offers the exact Science reading in stored factor order', () => {
    const before = JSON.stringify(PAUL);
    expect(proposeProductIdentity(PAUL)).toEqual({ outcome_id: 'mrr', operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], words: WORDS });
    expect(proposeProductIdentity(PAUL)!.words.length).toBeLessThanOrEqual(CARD_WORDS_MAX);
    expect(JSON.stringify(PAUL)).toBe(before);
  });
  it('row 1 control: unconfirmedGoalProductFor keeps its existing null for Paul’s stored identity', () => {
    expect(unconfirmedGoalProductFor(PAUL)).toBeNull();
  });
  it('row 2 bar: exactly one enabled priority confirmation routes to the existing capability', () => {
    const facts = actionFactsOf({ scenarioId: 'goal-reach', graph: PAUL });
    const b = actionBarOf(facts);
    expect(confirm(PAUL)).toHaveLength(1);
    expect(b.priority).toContainEqual(expect.objectContaining({ action_id: 'confirm_reading', enabled: true,
      label: 'Confirm reading', icon: 'BadgeCheck', group: 'gap', user_line: 'Check how Olumi works out the goal.',
      why_now: "Olumi can't show the chance until you check how it reads ‘MRR’." }));
    expect(decidePress({ id: 'act:confirm_reading' }, facts, b)).toMatchObject({ kind: 'route', handler: { route: 'propose_identity', gate: 'offer' } });
  });
  it('row 2 control: an already-confirmed reading offers no confirmation', () => {
    const g = graph(g => { node(g, 'mrr').nonlinear_identity.stated_in_brief = true; });
    expect(proposeProductIdentity(g)).toBeNull();
    expect(confirm(g)).toHaveLength(0);
    expect(decidePress({ id: 'act:confirm_reading' }, actionFactsOf({ scenarioId: 'goal-reach', graph: g }))).toMatchObject({ kind: 'reply', reply: { reason: 'nothing_in_scope' } });
  });
  it('row 3: price × churn percent is unit-incoherent and offers nothing', () => {
    const g = graph(g => { node(g, 'mrr').nonlinear_identity.factor_ids[1] = 'monthly_churn_rate'; g.edges.push({ from: 'monthly_churn_rate', to: 'mrr' }); });
    expect(proposeProductIdentity(g)).toBeNull();
    expect(confirm(g)).toHaveLength(0);
  });
  it('row 4: stated £30,000 contradicts £49 × 300; withhold and do not offer that reading', () => {
    expect(proposeProductIdentity(withCurrent(30000))).toBeNull();
    expect(confirm(withCurrent(30000))).toHaveLength(0);
  });
  it('row 4 resolving control: stated £14,700 reconciles with £49 × 300 and is offered', () => {
    expect(proposeProductIdentity(withCurrent(14700))).toMatchObject({ words: WORDS });
    expect(confirm(withCurrent(14700))).toHaveLength(1);
  });
  it.each([[], ['pro_plan_price'], ['pro_plan_price', 'pro_plan_price'], ['pro_plan_price', 'absent'], ['pro_plan_price', 'pro_paying_subscribers', 'monthly_churn_rate'], [3, 'pro_paying_subscribers']].map(ids => ({ ids })))('row 5: malformed factor_ids $ids fail closed', ({ ids }) => {
    const g = graph(g => { node(g, 'mrr').nonlinear_identity.factor_ids = ids; });
    expect(proposeProductIdentity(g)).toBeNull();
    expect(confirm(g)).toHaveLength(0);
  });
  it('row 5: two product carriers on the goal path leave no unique reading', () => {
    const g = withCurrent(14700);
    delete node(g, 'mrr').nonlinear_identity;
    node(g, 'pro_paying_subscribers').observed_state.source = 'brief_extraction';
    g.edges = g.edges.filter(e => e.to !== 'mrr');
    for (const id of ['carrier_a', 'carrier_b']) {
      g.nodes.push({ id, kind: 'outcome', label: id, nonlinear_identity: { operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], stated_in_brief: false } });
      g.edges.push({ from: 'pro_plan_price', to: id }, { from: 'pro_paying_subscribers', to: id }, { from: id, to: 'mrr' });
    }
    expect(proposeProductIdentity(g)).toBeNull();
    expect(confirm(g)).toHaveLength(0);
  });
  it('row 6: T1b goal card keeps its original words byte for byte', () => {
    const g = withCurrent(14700);
    node(g, 'pro_paying_subscribers').observed_state.source = 'brief_extraction';
    g.edges = g.edges.filter(e => e.to !== 'mrr' || ['pro_plan_price', 'pro_paying_subscribers'].includes(e.from));
    expect(proposeProductIdentity(g)?.words).toBe('Is “MRR” your “Pro plan price” × “Pro paying subscribers”? £49 × 300 = £14,700, close to your £14,700. If yes, Olumi will calculate “MRR” that way, and you can run the analysis again.');
  });
  it('row 6: existing served carrier card keeps its original words byte for byte', () => {
    const served = JSON.parse(readFileSync(new URL('./fixtures/served-paul-mrr-ed49d44.json', import.meta.url), 'utf8'));
    const g = served.runs.find((r: any) => r.run === 2).graph;
    // Pinned baseline generated before implementation, on the exact existing carrier branch.
    expect(proposeProductIdentity(g)?.words).toBe('Is “Pro plan MRR” your “Pro plan price” × “Pro paying subscribers”? £49 × 1,500 = £73,500, close to your £75,000 “MRR”. If yes, Olumi will calculate “Pro plan MRR” that way, and you can run the analysis again.');
  });
  it.each(['no_path', 'path_only', 'bidirected', 'excluded', 'unknown_unit', 'wrong_period', 'wrong_currency', 'scope_conflict', 'two_goals', 'long_words', 'second_reading', 'nonfactor'] as const)('fail closed: %s', change => {
    const g = graph(g => {
      const price = node(g, 'pro_plan_price'); const goal = node(g, 'mrr');
      if (change === 'no_path' || change === 'path_only') g.edges = g.edges.filter(e => e.from !== 'pro_paying_subscribers');
      // Science §(e) Q1.2 binds the goal's own parents, tighter than spec condition 2's any path.
      if (change === 'path_only') g.edges.push({ from: 'pro_paying_subscribers', to: 'risk_feature_release_slips' });
      if (change === 'bidirected') g.edges.find(e => e.from === 'pro_paying_subscribers' && e.to === 'mrr')!.edge_type = 'bidirected';
      if (change === 'excluded') price.analysis_participation = 'retained_excluded';
      if (change === 'unknown_unit') price.observed_state.unit = '?';
      if (change === 'wrong_period') price.observed_state.unit = '£/subscriber/year';
      if (change === 'wrong_currency') price.observed_state.unit = 'USD/subscriber/month';
      if (change === 'scope_conflict') goal.goal_scope = { modelled: 'Total MRR', alternative: 'Pro MRR', extent: 'total', stated_in_brief: true, source: { quote: 'Our MRR includes other plans' }, component: { label: 'Pro MRR', rate_id: 'pro_plan_price', count_id: 'pro_paying_subscribers', basis: 'unknown', source: { quote: 'Pro plan price and subscribers' } } };
      if (change === 'two_goals') g.nodes.push({ id: 'another_goal', kind: 'goal', label: 'Another' });
      if (change === 'long_words') price.label = 'p'.repeat(401);
      if (change === 'second_reading') node(g, 'risk_feature_release_slips').nonlinear_identity = { operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], stated_in_brief: false };
      if (change === 'nonfactor') price.kind = 'outcome';
    });
    expect(proposeProductIdentity(g)).toBeNull();
    expect(confirm(g)).toHaveLength(0);
  });
  it('condition 5: an unwritable base never offers a confirmation the real door would refuse', () => {
    const g = graph(g => { g.edges[0]!.strength.mean = 4; });
    expect(confirm(g)).toHaveLength(0);
  });
  it('stored order stays intact when the count precedes the rate', () => {
    const g = graph(g => { node(g, 'mrr').nonlinear_identity.factor_ids.reverse(); });
    expect(proposeProductIdentity(g)).toMatchObject({ factor_ids: ['pro_paying_subscribers', 'pro_plan_price'], words: 'Olumi reads ‘MRR’ as ‘Pro paying subscribers’ × ‘Pro plan price’. Is that how you work it out?' });
  });
  it('Science §(e) accepts the existing implicit per-count money-rate confirmation form', () => {
    const g = graph(g => { node(g, 'pro_plan_price').observed_state.unit = '£/month'; });
    expect(proposeProductIdentity(g)?.words).toBe(WORDS);
  });
  it('Science §(e) rejects stated current zero and a current level in another period', () => {
    expect(proposeProductIdentity(withCurrent(0))).toBeNull();
    const g = withCurrent(14700); node(g, 'mrr').observed_state.unit = '£/year';
    expect(proposeProductIdentity(g)).toBeNull();
    expect(confirm(g)).toHaveLength(0);
  });
  it('new and legacy card approval words are recognised; a bare yes or altered sentence is not', () => {
    expect(readingOfIdentityApproval(identityApproveMessage(WORDS))).toBe(WORDS);
    const legacy = 'Is “MRR” your “Price” × “Subscribers”?';
    expect(readingOfIdentityApproval(identityApproveMessage(legacy))).toBe(legacy);
    for (const message of ['yes', 'Yes, that\'s how', WORDS, identityApproveMessage('Olumi reads ‘MRR’ as ‘Price’.')]) {
      expect(readingOfIdentityApproval(message)).toBeUndefined();
    }
  });

  it('COPY-SHAPE guard: a bar-issued card never shows "undefined" (words → public label → fixed held line)', () => {
    expect(identityIssuedText({ card: { words: 'W' }, public_label: 'L' })).toBe('W');
    expect(identityIssuedText({ card: { words: '  ' }, public_label: 'L' })).toBe('L');
    expect(identityIssuedText({ card: {}, public_label: undefined })).toBe(IDENTITY_ISSUED_FALLBACK);
    expect(identityIssuedText({})).toBe(IDENTITY_ISSUED_FALLBACK);
    expect(identityIssuedText({ card: null, public_label: 7 })).not.toMatch(/undefined|null|7/);
  });
});
