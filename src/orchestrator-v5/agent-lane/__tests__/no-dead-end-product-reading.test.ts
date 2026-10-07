/**
 * ⭐ FA1-3 (Acceptance e7 on CEE 5f8f24ce; DL ruling 6 Oct; MC 21 diagnosis #87 6010874426): a PRODUCT takes its operands'
 * composed unit. The served T1b draft carries ‘Monthly starter support cost’ = ‘Starter subscribers’ × ‘Support cost per
 * starter subscriber’ (`nonlinear_identity`, drafted), with no unit and no level, so the link out of it, the one the
 * comparison turns on, could not be asked ("Set it"), typed no `first_ask`, and the writer had no unit to take an answer in.
 * The units prove the product (`unitsCompose` 'proof': subscribers × £/subscriber/month = £/month), so the ONE reader
 * (`mediatorReadings`) reads it in £/month; the ask, the writer and the card read that one reading. Rows bind by node id.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectMediatorReadings, linkEffectReadingToken,
  type ApplyLinkEffectEditParams } from '../../system-events/link-effect-edit.js';
import { prepareLinkEffectUnitReadings } from '../../system-events/link-effect-unit-reading.js';
import { linkEffectReadingOf } from '../approval-chips.js';
import { unsizedLeaderGoalPaths, placeholderGoalWarning } from '../goal-certainty.js';
import { mediatorReadings } from '../mediator-reading.js';

type Rec = Record<string, any>;
const CODE = 'GOAL_FIGURES_PLACEHOLDER_PATH';
const fx = JSON.parse(readFileSync(new URL('./fixtures/fa1-3-served-graph.json', import.meta.url), 'utf8')) as Rec;
const PRODUCT = 'monthly_starter_support_cost';
const RISK = 'mrr_lost_to_starter_support_churn';
const RATE = 'support_cost_per_starter_subscriber';
const COUNT = 'starter_subscribers';
const OPTIONS = ['raise_prices_10', 'launch_starter_tier', 'keep_current_pricing'];
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
const twin = (mutate: (g: Rec) => void): Rec => { const g = structuredClone(fx.graph); mutate(g); return g; };
/** As served, the Run evaluated the product (its operand links are then exact, P5 / d5 6009457214), so one link is unsized. */
const EVALUATED = [{ node_id: PRODUCT, evaluated: true, operation: 'product', factor_ids: [COUNT, RATE] }];
const paths = (g: Rec) => unsizedLeaderGoalPaths(g, OPTIONS, EVALUATED);
const warn = (g: Rec) => placeholderGoalWarning(g, paths(g), CODE);
/** The served behaviour: the same graph with no product identity on the node. */
const noIdentity = (): Rec => twin((g) => { delete node(g, PRODUCT).nonlinear_identity; });
/** The served behaviour with the identity kept: a rate with no denominator only 'confirm's the product, so no reading. */
const noReading = (): Rec => twin((g) => { node(g, RATE).observed_state.unit = '£/month'; });

const ANSWER = { amount: 300, amount_unit: '£/month', per_source_change: 1000, per_source_change_unit: '£/month' } as const;
const QUOTE = 'every £1,000 a month of starter support cost loses about £300 a month of MRR to support churn';
const approved = (p: Omit<ApplyLinkEffectEditParams, 'reading_token'>): ApplyLinkEffectEditParams => ({ ...p, reading_token: linkEffectReadingToken(p) });
function write(graph: Rec, from: string, to: string, effect: ApplyLinkEffectEditParams['effect'], quote: string) {
  const prepared = prepareLinkEffectUnitReadings(graph, from, to, effect, quote);
  return applyLinkEffectEdit(approved({ persistedGraph: graph, from, to, effect, quote, unit_readings: prepared.unit_readings,
    expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: linkEffectEdgeToken(graph, from, to)! } }));
}

describe('THE ONE READER: a product takes its operands\' composed unit', () => {
  it('AS SERVED: ‘Monthly starter support cost’ reads £/month, as the rate × the count, into its one goal-path child', () => {
    expect(mediatorReadings(fx.graph).get(PRODUCT)).toEqual({ via: 'product', unit: '£/month', child: RISK, operands: [RATE, COUNT] });
  });
  it('PRECONDITION (served): no identity → no reading', () => {
    expect(mediatorReadings(noIdentity()).get(PRODUCT)).toBeUndefined();
  });
  it.each([
    // AIQ 5886967509: a rate with no denominator could be summed as easily as multiplied ('confirm'), never a reading.
    ['a rate with no denominator (\'confirm\', not \'proof\')', (g: Rec) => { node(g, RATE).observed_state.unit = '£/month'; }],
    ['a rate whose denominator is not the count', (g: Rec) => { node(g, RATE).observed_state.unit = '£/customer/month'; }],
    ['a rate in another period than the goal', (g: Rec) => { node(g, RATE).observed_state.unit = '£/subscriber/year'; }],
    ['an operand with no unit', (g: Rec) => { delete node(g, COUNT).observed_state.unit; }],
    ['a sum, not a product', (g: Rec) => { node(g, PRODUCT).nonlinear_identity.operation = 'sum'; }],
    ['three operands', (g: Rec) => { node(g, PRODUCT).nonlinear_identity.factor_ids.push('price_rise'); }],
    ['a product that holds its own level', (g: Rec) => { node(g, PRODUCT).observed_state = { value: 0.1, raw_value: 900, cap: 10000, source: 'user_override' }; }],
    ['a product with no frame of its own', (g: Rec) => { delete node(g, PRODUCT).scale_frame; }],
    ['a unit-bearing label that does not fit', (g: Rec) => { node(g, PRODUCT).label = 'Starter support hours per week'; }],
    ['a sized parent that states it in another unit', (g: Rec) => {
      const e = g.edges.find((x: Rec) => x.from === COUNT && x.to === PRODUCT);
      e.provenance = { source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: 6, amount_unit: 'hours', per_source_change: 1, per_source_change_unit: 'subscribers' } };
    }],
  ])('no reading: %s', (_name, mutate) => {
    expect(mediatorReadings(twin(mutate)).get(PRODUCT)).toBeUndefined();
  });
});

describe('THE ASK on the served FA1-3 graph', () => {
  it('PRECONDITION: the served paths, and with no product reading the served words byte for byte, no `first_ask`', () => {
    expect(paths(fx.graph).flatMap((p) => p.links)).toEqual(fx.placeholder_warning.links);
    expect(mediatorReadings(noReading()).get(PRODUCT)).toBeUndefined();
    const served = warn(noReading());
    // The captured fixture predates S-A's vocabulary (D-05, 7 Oct): the served words, byte for byte, with the one
    // phrase the vocabulary owner changed. The fixture itself stays as captured.
    expect(served.message).toBe(fx.placeholder_warning.message.replace('nobody has set yet', "isn't sized in the model yet"));
    expect(served).not.toHaveProperty('first_ask');
  });
  it('AS SERVED with the reading: (C) asks the link out of the product in £/month, says the reading, and types `first_ask`', () => {
    const w = warn(fx.graph);
    expect(w.first_ask).toEqual({ kind: 'link', from: PRODUCT, to: RISK });
    expect(w.message).toMatch(/Olumi measures ‘Monthly starter support[^’]*’ in £\/month, as ‘Support cost per starter[^’]*’ × ‘Starter subscribers’; correct that if it’s wrong\./u);
    // S-A label rule (D-04): a label shortens at a WORD boundary ("MRR lost to starter…"), never mid-word ("…starter sup…").
    expect(w.message).toMatch(/Roughly how much does each £1 \/ month of ‘Monthly starter support[^’]*’ change ‘MRR lost to starter[^’]*’, in £\/month\?/u);
    for (const [, shown] of w.message.matchAll(/‘([^’]*)…’/gu)) {
      expect(['Monthly starter support cost', 'MRR lost to starter support churn'].some((l) => l.startsWith(shown!) && l.charAt(shown!.length) === ' '), shown).toBe(true);
    }
    expect(w.message).not.toContain('Set it to see how much it matters.');
  });
});

describe('THE WRITER: the answer the ask invites, through the real door', () => {
  it('support cost → risk in £/month is written as the user\'s size on the served graph (refused with no reading)', () => {
    const r = write(fx.graph, PRODUCT, RISK, ANSWER, QUOTE);
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    if (r.kind !== 'mutated') return;
    const e = (r.mutatedGraph as Rec).edges.find((x: Rec) => x.from === PRODUCT && x.to === RISK);
    expect(e.provenance.magnitude).toBe('user_stated');
    expect(e.provenance.natural_effect).toMatchObject({ amount: 300, amount_unit: '£/month', per_source_change: 1000, per_source_change_unit: '£/month' });
    // The identity and its operands are untouched by the answer.
    expect(node(r.mutatedGraph as Rec, PRODUCT).nonlinear_identity).toEqual(node(fx.graph, PRODUCT).nonlinear_identity);
    expect(write(noReading(), PRODUCT, RISK, ANSWER, QUOTE).kind, 'PRECONDITION: the served writer refused it').not.toBe('mutated');
  });
});

describe('THE CARD: the reading is said for approval', () => {
  it('names the product reading with both operands', () => {
    const words = linkEffectReadingOf({ operations: [{ op: 'set_link_effect', path: `${PRODUCT}::${RISK}`, value: { from: PRODUCT, to: RISK,
      effect: ANSWER, quote: QUOTE, edge_token: 't', mediator_readings: linkEffectMediatorReadings(fx.graph, PRODUCT, RISK) } }] } as never,
    { from: 'Monthly starter support cost', to: 'MRR lost to starter support churn' });
    expect(words).toContain('Olumi measures ‘Monthly starter support cost’ in £/month, as ‘Support cost per starter subscriber’ × ‘Starter subscribers’; correct that if it’s wrong.');
  });
});
