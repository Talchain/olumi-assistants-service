/**
 * ⭐ NO DEAD END: a withheld path through a level-less mediator gets an ask the user can answer (MC 21's chain; Science d5
 * #87 6006425419 gauge, 6006548763 carrier (i), 6006685510 label + brief3 fallback). Rows bind by node/edge id.
 */
import { describe, expect, it } from 'vitest';

import { convertLinkEffect } from '../../../cee/magnitude/link-effect.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectEndUnits, linkEffectMediatorReadings, linkEffectReadingToken,
  type ApplyLinkEffectEditParams } from '../../system-events/link-effect-edit.js';
import { prepareLinkEffectUnitReadings } from '../../system-events/link-effect-unit-reading.js';
import { linkEffectReadingOf } from '../approval-chips.js';
import { legacyLeaderGoalLinks, placeholderGoalWarning, unsizedLeaderGoalPaths } from '../goal-certainty.js';
import { labelUnitParts, mediatorReadings } from '../mediator-reading.js';
import { unsizedLinkSentence } from '../unsized-path-cause.js';

type Rec = Record<string, any>;
const GOAL = { id: 'mrr', kind: 'goal', label: 'MRR', observed_state: { value: 0.5, raw_value: 100000, cap: 200000, unit: '£/month', source: 'user_override' } };
const placeholder = (from: string, to: string, mean: number): Rec => ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 0.9,
  effect_direction: mean < 0 ? 'negative' : 'positive', defaulted: true, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } });

/** (B): price → strain (no unit, no level, no sized parent) → MRR. Path sign: + × − = −. */
function gaugeGraph(): Rec {
  return {
    goal_node_id: 'mrr',
    nodes: [
      structuredClone(GOAL),
      { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.49, raw_value: 49, cap: 100, unit: '£', source: 'user_override' } },
      { id: 'strain', kind: 'factor', label: 'Support capacity strain' },
      { id: 'o-raise', kind: 'option', label: 'Raise price', interventions: { price: { value: 0.59, raw_value: 59 } } },
    ],
    edges: [placeholder('price', 'strain', 0.4), placeholder('strain', 'mrr', -0.3)],
  };
}

/** (C): budget (£/month) → cost (no unit, own frame 5000; Olumi sized the link in £/month) → MRR. */
function sizedParentGraph(amountUnit = '£/month', costLabel = 'Support cost'): Rec {
  const beta = convertLinkEffect(250, 1000, 5000, 10000)!;
  return {
    goal_node_id: 'mrr',
    nodes: [
      structuredClone(GOAL),
      { id: 'budget', kind: 'factor', label: 'Support budget', observed_state: { value: 0.5, raw_value: 5000, cap: 10000, unit: '£/month', source: 'user_override' } },
      { id: 'cost', kind: 'factor', label: costLabel, scale_frame: 5000 },
      { id: 'o-spend', kind: 'option', label: 'Spend more', interventions: { budget: { value: 0.6, raw_value: 6000 } } },
    ],
    edges: [
      { from: 'budget', to: 'cost', strength: { mean: beta, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive',
        provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: { amount: 250, amount_unit: amountUnit,
          per_source_change: 1000, per_source_change_unit: '£/month', strength_mean: beta, strength_mean_frame: 'edge_strength' } } },
      placeholder('cost', 'mrr', -0.3),
    ],
  };
}

const approved = (p: Omit<ApplyLinkEffectEditParams, 'reading_token'>): ApplyLinkEffectEditParams => ({ ...p, reading_token: linkEffectReadingToken(p) });
function write(graph: Rec, from: string, to: string, effect: ApplyLinkEffectEditParams['effect'], quote: string) {
  const prepared = prepareLinkEffectUnitReadings(graph, from, to, effect, quote);
  expect(prepared.ask, 'the unit door asks nothing').toBeUndefined();
  return applyLinkEffectEdit(approved({ persistedGraph: graph, from, to, effect, quote, unit_readings: prepared.unit_readings,
    expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: linkEffectEdgeToken(graph, from, to)! } }));
}
const edge = (g: unknown, from: string, to: string): Rec => (g as Rec).edges.find((e: Rec) => e.from === from && e.to === to);
const E2E = { amount: -1200, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '£' } as const;
const E2E_QUOTE = 'every £1 on the price loses us about £1,200 a month of MRR through support strain';

describe('THE ONE READER: mediatorReadings', () => {
  it('(C) a level-less M takes the ONE unit its Olumi-sized parent states; nothing is written onto the graph', () => {
    const g = sizedParentGraph();
    const before = JSON.stringify(g);
    expect(mediatorReadings(g).get('cost')).toEqual({ via: 'sized_parents', unit: '£/month', child: 'mrr', parents: ['budget'] });
    expect(JSON.stringify(g), 'the reader stores nothing on M (data.unit is unhashed)').toBe(before);
    expect(g.nodes.find((n: Rec) => n.id === 'cost').data).toBeUndefined();
  });
  it.each([
    ['a placeholder parent', (e: Rec) => { e.provenance.magnitude = 'olumi_placeholder'; }],
    ['a projected-mean parent', (e: Rec) => { e.provenance.mean_projected = true; }],
    ["the user's parent (never olumi_estimate)", (e: Rec) => { e.provenance.magnitude = 'user_stated'; }],
  ])('(C) CONTRAST: %s gives no unit', (_why, mutate) => {
    const g = sizedParentGraph();
    mutate(edge(g, 'budget', 'cost'));
    expect(mediatorReadings(g).get('cost')?.via).not.toBe('sized_parents');
  });
  it('(C) two sized parents that disagree on U give no unit; agreeing ones do', () => {
    const agree = sizedParentGraph();
    agree.nodes.push({ id: 'staff', kind: 'factor', label: 'Support staff', observed_state: { value: 0.5, raw_value: 10, cap: 20, unit: 'agents' } });
    agree.edges.push({ ...structuredClone(edge(agree, 'budget', 'cost')), from: 'staff' });
    expect(mediatorReadings(agree).get('cost')?.unit).toBe('£/month');
    const disagree = structuredClone(agree);
    edge(disagree, 'staff', 'cost').provenance.natural_effect.amount_unit = 'GBP/year';
    expect(mediatorReadings(disagree).has('cost')).toBe(false);
  });
  it('LABEL (d5 6006685510 (1)): unit-bearing iff a currency token, %, a points spelling or "per <noun>"', () => {
    expect(labelUnitParts('Support capacity strain')).toBeNull();
    expect(labelUnitParts('Monthly fees')).toBeNull();
    expect(labelUnitParts('Revenue (£)')).toMatchObject({ kind: 'currency', code: 'GBP' });
    expect(labelUnitParts('Fee per café')).toMatchObject({ per: ['café'] });
    expect(labelUnitParts('Churn rate (%)')).toMatchObject({ kind: 'percent' });
    expect(labelUnitParts('Revenue per month')).toBeNull();
  });
  it('(C) LABEL: "Revenue (£)" fits "£ a month" (C3: no part both state conflicts); "Monthly fees" vs "GBP/year" refuses', () => {
    expect(mediatorReadings(sizedParentGraph('£ a month', 'Revenue (£)')).get('cost')?.via).toBe('sized_parents');
    expect(mediatorReadings(sizedParentGraph('GBP/year', 'Monthly fees')).has('cost')).toBe(false);
    expect(mediatorReadings(sizedParentGraph('GBP/year', 'Annual fees')).get('cost')?.via, 'CONTROL: the same period passes').toBe('sized_parents');
  });
  it("(B) a level-less M with no sized parent is a gauge in its one child's unit and frame", () => {
    expect(mediatorReadings(gaugeGraph()).get('strain')).toEqual({ via: 'gauge', unit: '£/month', scale_frame: 200000, child: 'mrr' });
  });
  it('(B) MUTANT GUARD: M with TWO children on the goal path never collapses', () => {
    const g = gaugeGraph();
    g.nodes.push({ id: 'churn', kind: 'factor', label: 'Churn', observed_state: { value: 0.05, raw_value: 5, cap: 100, unit: '%' } });
    g.edges.push(placeholder('strain', 'churn', 0.2), placeholder('churn', 'mrr', -0.5));
    expect(mediatorReadings(g).has('strain')).toBe(false);
  });
  it('(B) CONTRASTS: a unit-bearing label is asked its level instead; a frameless child gives no gauge yet', () => {
    const labelled = gaugeGraph();
    labelled.nodes.find((n: Rec) => n.id === 'strain').label = 'Support strain (%)';
    expect(mediatorReadings(labelled).has('strain')).toBe(false);
    const frameless = gaugeGraph();
    delete frameless.nodes.find((n: Rec) => n.id === 'mrr').observed_state;
    expect(mediatorReadings(frameless).has('strain')).toBe(false);
  });
  it("brief3 FALLBACK (d5 (2)): an unreadable U on the lever's own link → the gauge, replacing that estimate", () => {
    expect(mediatorReadings(sizedParentGraph('£ over 2 years')).get('cost')).toEqual(
      { via: 'gauge', unit: '£/month', scale_frame: 200000, child: 'mrr', replaces: 'budget' });
  });
  it('brief3 FALLBACK MUTANT GUARD: another sized parent → no fallback', () => {
    const g = sizedParentGraph('£ over 2 years');
    g.nodes.push({ id: 'staff', kind: 'factor', label: 'Support staff', observed_state: { value: 0.5, raw_value: 10, cap: 20, unit: 'agents' } });
    g.edges.push({ ...structuredClone(edge(g, 'budget', 'cost')), from: 'staff' });
    expect(mediatorReadings(g).has('cost')).toBe(false);
  });
});

describe('THE WRITER: (C) sized in the parent\'s unit; (B) one end-to-end answer writes the gauge with it', () => {
  it("(C) the user sizes cost → MRR in £/month: stored per_source_change_unit = U, and the parent's estimate is untouched", () => {
    const g = sizedParentGraph();
    const parentBefore = JSON.stringify(edge(g, 'budget', 'cost'));
    const r = write(g, 'cost', 'mrr', { amount: -500, amount_unit: '£/month', per_source_change: 1000, per_source_change_unit: '£/month' },
      'every £1,000 a month of support cost loses about £500 a month of MRR');
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    if (r.kind !== 'mutated') return;
    const e = edge(r.mutatedGraph, 'cost', 'mrr');
    expect(e.provenance.magnitude).toBe('user_stated');
    expect(e.provenance.natural_effect.per_source_change_unit).toBe('£/month');
    expect(JSON.stringify(edge(r.mutatedGraph, 'budget', 'cost')), 'ROUND TRIP: the parent re-derives byte-equal').toBe(parentBefore);
    // ROUND TRIP: the raw end-to-end effect is the parent's × the answer's (250/1000 × −500/1000 = −0.125 £ per £).
    const b1 = edge(r.mutatedGraph, 'budget', 'cost').strength.mean as number;
    const b2 = e.strength.mean as number;
    expect(b1 * b2 * 200000 / 10000).toBeCloseTo((250 / 1000) * (-500 / 1000), 9);
  });
  it('(C) MUTANT GUARD: a corrected parent unit leaves the answered child re-asked, never silently re-read', () => {
    const g = sizedParentGraph();
    const r = write(g, 'cost', 'mrr', { amount: -500, amount_unit: '£/month', per_source_change: 1000, per_source_change_unit: '£/month' },
      'every £1,000 a month of support cost loses about £500 a month of MRR');
    if (r.kind !== 'mutated') throw new Error(JSON.stringify(r));
    const corrected = structuredClone(r.mutatedGraph) as Rec;
    edge(corrected, 'budget', 'cost').provenance.natural_effect.amount_unit = 'GBP/year';
    expect(linkEffectEndUnits(corrected, 'cost', 'mrr')!.source.own).toContain('GBP/year');
    expect(linkEffectEndUnits(corrected, 'cost', 'mrr')!.source.own).not.toContain('£/month');
  });
  it('(B) RED: one end-to-end answer sizes price → strain in MRR\'s units AND writes strain → MRR = 1 as the gauge', () => {
    const r = write(gaugeGraph(), 'price', 'strain', { ...E2E }, E2E_QUOTE);
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    if (r.kind !== 'mutated') return;
    const lever = edge(r.mutatedGraph, 'price', 'strain');
    expect(lever.provenance.magnitude).toBe('user_stated');
    expect(lever.provenance.natural_effect.amount_unit).toBe('£/month');
    expect(lever.strength.mean).toBeCloseTo(convertLinkEffect(-1200, 1, 200000, 100)!, 12);
    expect(lever.effect_direction, "the PATH's sign rides on the lever").toBe('negative');
    const gauge = edge(r.mutatedGraph, 'strain', 'mrr');
    expect(gauge.strength.mean).toBe(1);
    expect(gauge.provenance).toMatchObject({ magnitude: 'olumi_estimate', sized_by_identity: { op: 'gauge' } });
    expect(gauge.provenance).not.toHaveProperty('mean_projected');
    expect(gauge.provenance).not.toHaveProperty('natural_effect');
    expect(gauge).not.toHaveProperty('defaulted');
    // P5 CLEARS: no link on the path is unsized any more.
    expect(unsizedLeaderGoalPaths(r.mutatedGraph, ['o-raise'])).toEqual([]);
    // MC rows: the gauge is never the user's (MIXED), never a legacy "Olumi supplied" link.
    expect(linkSizing(gauge)).not.toBe('user');
    expect(legacyLeaderGoalLinks(r.mutatedGraph, ['o-raise'])).toEqual([]);
  });
  it('(B) CONTROL: before the answer the path withholds on both links', () => {
    expect(unsizedLeaderGoalPaths(gaugeGraph(), ['o-raise']).flatMap(p => p.links)).toEqual(
      [{ from: 'price', to: 'strain' }, { from: 'strain', to: 'mrr' }]);
  });
  it('(B) the PATH sign governs: a positive end-to-end statement against a negative path is a sign conflict', () => {
    const r = write(gaugeGraph(), 'price', 'strain', { ...E2E, amount: 1200 }, 'every £1 on the price adds about £1,200 a month of MRR');
    expect(r).toMatchObject({ kind: 'refused', reason: 'sign_conflict' });
  });
  it('(B) never asked apart: strain → MRR cannot be sized on its own (as a source, the gauge adds nothing)', () => {
    const r = applyLinkEffectEdit(approved({ persistedGraph: gaugeGraph(), from: 'strain', to: 'mrr',
      effect: { amount: -1200, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '£/month' }, quote: 'each £1 a month of strain loses £1,200 a month',
      expected: { graph_hash: computeAnalysisAffectingGraphHash(gaugeGraph() as never)!, edge_token: linkEffectEdgeToken(gaugeGraph(), 'strain', 'mrr')! } }));
    expect(r.kind).toBe('refused');
    // Both doors: the writer's end units give strain NO unit as a source, and the unit door never adopts one for it.
    expect(linkEffectEndUnits(gaugeGraph(), 'strain', 'mrr')!.source.own).toEqual([]);
    expect(linkEffectEndUnits(gaugeGraph(), 'price', 'strain')!.target.own, 'CONTROL: as the TARGET of the answer, it is measured').toContain('£/month');
  });
  it("brief3 FALLBACK: the answer REPLACES Olumi's estimate on the lever's link (its natural_effect is the user's)", () => {
    const r = write(sizedParentGraph('£ over 2 years'), 'budget', 'cost',
      { amount: -500, amount_unit: '£/month', per_source_change: 1000, per_source_change_unit: '£/month' },
      'every £1,000 a month of support budget loses about £500 a month of MRR');
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    if (r.kind !== 'mutated') return;
    const lever = edge(r.mutatedGraph, 'budget', 'cost');
    expect(lever.provenance.magnitude).toBe('user_stated');
    expect(lever.provenance.natural_effect.amount_unit, "Olumi's '£ over 2 years' estimate is gone").toBe('£/month');
    expect(edge(r.mutatedGraph, 'cost', 'mrr').provenance.sized_by_identity).toEqual({ op: 'gauge' });
  });
});

describe('THE WORDS: the card and the withhold ask', () => {
  const card = (graph: Rec, from: string, to: string, effect: Rec, quote: string, labels: { from: string; to: string }) =>
    linkEffectReadingOf({ operations: [{ op: 'set_link_effect', path: `${from}::${to}`, value: { from, to, effect, quote, edge_token: 't',
      ...((m) => m.length > 0 ? { mediator_readings: m } : {})(linkEffectMediatorReadings(graph, from, to)) } }] } as never, labels);
  it('(B) card: the record reaches MRR THROUGH the mediator, and says the gauge (Science 6006425419)', () => {
    const words = card(gaugeGraph(), 'price', 'strain', { ...E2E }, E2E_QUOTE, { from: 'Pro plan price', to: 'Support capacity strain' })!;
    expect(words).toContain('in "MRR" through "Support capacity strain"');
    expect(words).toContain('Olumi treats ‘Support capacity strain’ as part of how ‘Pro plan price’ moves ‘MRR’, so your answer sizes the whole path.');
  });
  it("(C) card: Olumi's measure of the mediator is named, to correct (Science 6006548763)", () => {
    const words = card(sizedParentGraph(), 'cost', 'mrr', { amount: -500, amount_unit: '£/month', per_source_change: 1000, per_source_change_unit: '£/month' },
      'every £1,000 a month of support cost loses about £500 a month of MRR', { from: 'Support cost', to: 'MRR' })!;
    expect(words).toContain('Olumi measures ‘Support cost’ in £/month, from its own estimate of the link from ‘Support budget’; correct that if it’s wrong.');
  });
  it('brief3 card: the replacement is disclosed (d5 6006685510 (2))', () => {
    const words = card(sizedParentGraph('£ over 2 years'), 'budget', 'cost', { amount: -500, amount_unit: '£/month', per_source_change: 1000, per_source_change_unit: '£/month' },
      'every £1,000 a month of support budget loses about £500 a month of MRR', { from: 'Support budget', to: 'Support cost' })!;
    expect(words).toContain('Your answer replaces Olumi’s own estimate for the link from ‘Support budget’ to ‘Support cost’.');
  });
  it('CONTROL: a link with no mediator keeps its card byte for byte (no mediator_readings)', () => {
    expect(linkEffectMediatorReadings(gaugeGraph(), 'price', 'mrr')).toEqual([]);
  });
  const W = (graph: Rec, links: { from: string; to: string }[], option: string) =>
    placeholderGoalWarning(graph, [{ option_id: option, links }], 'GOAL_FIGURES_PLACEHOLDER_PATH');
  it('(B) withhold: ONE end-to-end question, never the two links apart; neither is offered as a one-click', () => {
    const w = W(gaugeGraph(), [{ from: 'price', to: 'strain' }, { from: 'strain', to: 'mrr' }], 'o-raise');
    expect(w.message).toBe('This comparison turns on how much ‘Pro plan price’ changes ‘MRR’ through ‘Support capacity strain’, which nobody has set yet.'
      + ' Roughly how much would a £1 rise in ‘Pro plan price’ change ‘MRR’ that way, in £/month? A best guess and a range is fine.');
    expect(w.acceptable_links).toBeUndefined();
    expect(w.links).toHaveLength(2);
  });
  it('(B) MUTANT GUARD: a lever that already has a stated path is asked "on top of" it (never double-counted)', () => {
    const g = gaugeGraph();
    g.nodes.push({ id: 'subs', kind: 'factor', label: 'Subscribers', observed_state: { value: 0.5, raw_value: 5000, cap: 10000, unit: 'subscribers' } });
    g.edges.push({ from: 'price', to: 'subs', strength: { mean: -0.5, std: 0.1 }, effect_direction: 'negative',
      provenance: { source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: -50, amount_unit: 'subscribers', per_source_change: 1,
        per_source_change_unit: '£', strength_mean: -0.5, strength_mean_frame: 'edge_strength' } } }, placeholder('subs', 'mrr', 0.5));
    expect(W(g, [{ from: 'price', to: 'strain' }, { from: 'strain', to: 'mrr' }], 'o-raise').message).toContain('on top of the');
  });
  it('(C) withhold: asked in the unit Olumi measures the mediator in, the estimate named', () => {
    expect(W(sizedParentGraph(), [{ from: 'cost', to: 'mrr' }], 'o-spend').message).toContain(
      'Olumi measures ‘Support cost’ in £/month, from its own estimate of the link from ‘Support budget’; correct that if it’s wrong.');
  });
  it("(A) withhold: a goal with no frame is asked today's level first (the served P5 question)", () => {
    const g = gaugeGraph();
    const goal = g.nodes.find((n: Rec) => n.id === 'mrr');
    delete goal.observed_state;
    goal.goal_threshold_unit = '£/month';
    expect(W(g, [{ from: 'price', to: 'strain' }, { from: 'strain', to: 'mrr' }], 'o-raise').message).toMatch(/What's today's level of ‘MRR’, in £\/month\?$/);
  });
  it('CONTROL: a withhold with no mediator and a framed goal keeps its words byte for byte', () => {
    const g = gaugeGraph();
    g.nodes.find((n: Rec) => n.id === 'strain').observed_state = { value: 0.5, raw_value: 5, cap: 10, unit: 'tickets' };
    const w = W(g, [{ from: 'price', to: 'strain' }, { from: 'strain', to: 'mrr' }], 'o-raise');
    // The generic sentence over the warning's own goal-ordered links: exactly what staging says today.
    expect(w.message).toBe(unsizedLinkSentence(w.links.map(l => ({ ...l,
      from_label: g.nodes.find((n: Rec) => n.id === l.from).label, to_label: g.nodes.find((n: Rec) => n.id === l.to).label }))));
  });
});
