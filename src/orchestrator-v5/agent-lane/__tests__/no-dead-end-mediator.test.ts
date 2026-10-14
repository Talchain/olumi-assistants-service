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
import { linkEffectConsent, linkEffectRefusalWords } from '../runtime/agent-capabilities.js';
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
  it('(C) MUTANT GUARD: M with TWO children on the goal path takes no unit (one child only)', () => {
    const g = sizedParentGraph();
    g.nodes.push({ id: 'churn', kind: 'factor', label: 'Churn', observed_state: { value: 0.05, raw_value: 5, cap: 100, unit: '%' } });
    g.edges.push(placeholder('cost', 'churn', 0.2), placeholder('churn', 'mrr', -0.5));
    expect(mediatorReadings(g).has('cost')).toBe(false);
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

  // Science 393023 LICENCE ruling 3, re-derived: strain→MRR user_specified + mean_projected, no magnitude/defaulted,
  // is nobody's size: no gauge/no answerable ask → the existing gauge reading. A real user-sized mean remains held.
  it('R7 RED: a user-drawn projected onward link permits the gauge without claiming its size is the user\'s', () => {
    const g = gaugeGraph();
    const onward = edge(g, 'strain', 'mrr');
    onward.strength = { mean: -0.5, std: 0.125 };
    onward.provenance = { source: 'user_specified', mean_projected: true };
    delete onward.defaulted;
    expect(onward).toMatchObject({ from: 'strain', to: 'mrr', strength: { mean: -0.5, std: 0.125 } });
    expect(linkSizing(onward)).toBe('placeholder');
    expect(mediatorReadings(g).get('strain')).toEqual({ via: 'gauge', unit: '£/month', scale_frame: 200000, child: 'mrr' });
    const userSized = structuredClone(g);
    delete edge(userSized, 'strain', 'mrr').provenance.mean_projected;
    expect(linkSizing(edge(userSized, 'strain', 'mrr'))).toBe('user');
    expect(mediatorReadings(userSized).has('strain'), 'CONTROL: a true user size is never gauged').toBe(false);
  });

  // Science 393023 LICENCE ruling 3, re-derived: a parent source user_specified outranks an old olumi_estimate tag.
  // "Olumi measures Support cost ... from its own estimate" / sized_parents → no Olumi parent-unit claim.
  it('R7 RED: a genuinely user-sized parent is never read as an Olumi estimate by its older magnitude tag', () => {
    const userSized = sizedParentGraph();
    edge(userSized, 'budget', 'cost').provenance.source = 'user_specified';
    expect(linkSizing(edge(userSized, 'budget', 'cost'))).toBe('user');
    expect(mediatorReadings(userSized).get('cost')?.via).not.toBe('sized_parents');
    expect(mediatorReadings(sizedParentGraph()).get('cost'), 'CONTROL: an actual Olumi-sized parent still supplies its unit')
      .toEqual({ via: 'sized_parents', unit: '£/month', child: 'mrr', parents: ['budget'] });
  });

  // Science 393023 LICENCE ruling 3, re-derived: a stored gauge with mean_projected beside olumi_estimate is still
  // a placeholder: "intact stored gauge" → no gauge reading. The unchanged exact ±1 control remains valid.
  it('R7 RED: a projected stored gauge cannot claim it has an intact Olumi-sized onward link', () => {
    const g = gaugeGraph();
    const onward = edge(g, 'strain', 'mrr');
    onward.strength.mean = -1;
    onward.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_estimate', sized_by_identity: { op: 'gauge' } };
    delete onward.defaulted;
    expect(mediatorReadings(g).get('strain'), 'CONTROL: the actual stored gauge remains intact').toMatchObject({ via: 'gauge', stored: true });
    onward.provenance.mean_projected = true;
    expect(linkSizing(onward)).toBe('placeholder');
    expect(mediatorReadings(g).has('strain')).toBe(false);
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
  it('(B) RED: one end-to-end answer sizes price → strain in MRR\'s units AND writes strain → MRR = ±1 as the gauge', () => {
    const r = write(gaugeGraph(), 'price', 'strain', { ...E2E }, E2E_QUOTE);
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    if (r.kind !== 'mutated') return;
    const lever = edge(r.mutatedGraph, 'price', 'strain');
    expect(lever.provenance.magnitude).toBe('user_stated');
    expect(lever.provenance.natural_effect.amount_unit).toBe('£/month');
    // M keeps its orientation (MC: ±1): strain → MRR stays negative, so E = −£1,200 is +£1,200 of strain (in MRR's units).
    expect(lever.provenance.natural_effect.amount).toBe(1200);
    expect(lever.strength.mean).toBeCloseTo(convertLinkEffect(1200, 1, 200000, 100)!, 12);
    expect(lever.effect_direction, "the lever keeps its own sign").toBe('positive');
    const gauge = edge(r.mutatedGraph, 'strain', 'mrr');
    expect(gauge.strength.mean).toBe(-1);
    expect(gauge.effect_direction).toBe('negative');
    // END TO END: Δ MRR / Δ price = β(lever) × g × frame(MRR) / frame(price) = the user's −£1,200 per £1.
    expect(lever.strength.mean * gauge.strength.mean * 200000 / 100).toBeCloseTo(-1200, 6);
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
  it('⛔ P0 GUARD: a gauge never overwrites a figure the user already gave M → child (no reading, nothing written)', () => {
    const g = gaugeGraph();
    Object.assign(edge(g, 'strain', 'mrr'), { strength: { mean: -0.4, std: 0.1 }, provenance: { source: 'user_specified', magnitude: 'user_stated',
      natural_effect: { amount: -100, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: 'points', strength_mean: -0.4, strength_mean_frame: 'edge_strength' } } });
    expect(mediatorReadings(g).has('strain')).toBe(false);
    const before = JSON.stringify(edge(g, 'strain', 'mrr'));
    const r = applyLinkEffectEdit(approved({ persistedGraph: g, from: 'price', to: 'strain', effect: { ...E2E }, quote: E2E_QUOTE,
      expected: { graph_hash: computeAnalysisAffectingGraphHash(g as never)!, edge_token: linkEffectEdgeToken(g, 'price', 'strain')! } }));
    expect(r.kind).toBe('refused');
    expect(JSON.stringify(edge(g, 'strain', 'mrr'))).toBe(before);
  });
  it.each([
    ['a definitional child link', (e: Rec) => { e.provenance.definitional = true; }],
    ["Olumi's sized estimate on the child link", (e: Rec) => { e.provenance.magnitude = 'olumi_estimate'; }],
    ['a bidirected child link (a shared cause, not a path)', (e: Rec) => { e.edge_type = 'bidirected'; }],
  ])('(B) CONTRAST: %s is never gauged', (_why, mutate) => {
    const g = gaugeGraph();
    mutate(edge(g, 'strain', 'mrr'));
    expect(mediatorReadings(g).has('strain')).toBe(false);
  });
  it.each([
    ['another parent into M', (g: Rec) => { g.nodes.push({ id: 'staff', kind: 'factor', label: 'Support staff' }); g.edges.push(placeholder('staff', 'strain', -0.2)); }],
    ['an off-path child of M', (g: Rec) => { g.nodes.push({ id: 'wellbeing', kind: 'outcome', label: 'Staff wellbeing' }); g.edges.push(placeholder('strain', 'wellbeing', -0.2)); }],
    ['M an operand of the child\'s identity', (g: Rec) => { g.nodes.find((n: Rec) => n.id === 'mrr').nonlinear_identity = { operation: 'product', factor_ids: ['strain', 'price'], stated_in_brief: true }; }],
  ])("⛔ (B) CHAIN ONLY (Codex r1 P1): %s → no gauge (rescaling M would move another path), nothing written", (_why, add) => {
    const g = gaugeGraph();
    add(g);
    expect(mediatorReadings(g).has('strain')).toBe(false);
    const before = JSON.stringify(g.edges);
    const r = applyLinkEffectEdit(approved({ persistedGraph: g, from: 'price', to: 'strain', effect: { ...E2E }, quote: E2E_QUOTE,
      expected: { graph_hash: computeAnalysisAffectingGraphHash(g as never)!, edge_token: linkEffectEdgeToken(g, 'price', 'strain')! } }));
    expect(r.kind).toBe('refused');
    expect(JSON.stringify(g.edges)).toBe(before);
  });
  it('(B) CONSENT reads the writer\'s ONE statement rule (Codex r1 P1): the path\'s sign, so no reversal for an agreeing answer', () => {
    expect(linkEffectConsent(gaugeGraph(), 'price', 'strain', E2E)).toEqual({});
    const reversal = linkEffectConsent(gaugeGraph(), 'price', 'strain', { ...E2E, amount: 1200 });
    expect(reversal).toEqual({ reversal: { from: 'positive', to: 'negative' } });
    // The disclosed reversal is the path's: the lever flips, the gauge keeps its sign, and the user's +£1,200 is the path.
    const g = gaugeGraph();
    const effect = { ...E2E, amount: 1200 };
    const r = applyLinkEffectEdit(approved({ persistedGraph: g, from: 'price', to: 'strain', effect, quote: 'every £1 on the price adds about £1,200 a month of MRR',
      ...reversal, expected: { graph_hash: computeAnalysisAffectingGraphHash(g as never)!, edge_token: linkEffectEdgeToken(g, 'price', 'strain')! } }));
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    if (r.kind !== 'mutated') return;
    expect(edge(r.mutatedGraph, 'price', 'strain').strength.mean * edge(r.mutatedGraph, 'strain', 'mrr').strength.mean * 200000 / 100).toBeCloseTo(1200, 6);
  });
  it('(B) a STORED gauge keeps its sign and its card (Codex r1 P2): a later answer is the path again', () => {
    const first = write(gaugeGraph(), 'price', 'strain', { ...E2E }, E2E_QUOTE);
    if (first.kind !== 'mutated') throw new Error(JSON.stringify(first));
    expect(mediatorReadings(first.mutatedGraph).get('strain')).toMatchObject({ via: 'gauge', stored: true });
    expect(linkEffectMediatorReadings(first.mutatedGraph, 'price', 'strain')).toEqual(
      [{ node_id: 'strain', via: 'gauge', unit: '£/month', other_label: 'MRR' }]);
    const again = write(first.mutatedGraph as Rec, 'price', 'strain', { ...E2E, amount: -600 }, 'every £1 on the price loses us about £600 a month of MRR through support strain');
    expect(again.kind, JSON.stringify(again)).toBe('mutated');
    if (again.kind !== 'mutated') return;
    expect(edge(again.mutatedGraph, 'price', 'strain').strength.mean * edge(again.mutatedGraph, 'strain', 'mrr').strength.mean * 200000 / 100).toBeCloseTo(-600, 6);
  });
  it.each([
    ['the user edited the gauge link (a band edit keeps the marker)', (g: Rec) => {
      Object.assign(edge(g, 'strain', 'mrr'), { strength: { mean: -0.4, std: 0.1 } });
      edge(g, 'strain', 'mrr').provenance = { ...edge(g, 'strain', 'mrr').provenance, source: 'user_specified' };
    }],
    ['a second parent was added to M later', (g: Rec) => {
      g.nodes.push({ id: 'staff', kind: 'factor', label: 'Support staff' }); g.edges.push(placeholder('staff', 'strain', 0.2));
    }],
  ])('⛔ (B) STORED GAUGE BROKEN (Codex r2 P1): %s → no reading; a re-answer is refused and writes nothing', (_why, breakIt) => {
    const first = write(gaugeGraph(), 'price', 'strain', { ...E2E }, E2E_QUOTE);
    if (first.kind !== 'mutated') throw new Error(JSON.stringify(first));
    const g = structuredClone(first.mutatedGraph) as Rec;
    breakIt(g);
    expect(mediatorReadings(g).has('strain')).toBe(false);
    const before = JSON.stringify(g.edges);
    const r = applyLinkEffectEdit(approved({ persistedGraph: g, from: 'price', to: 'strain', effect: { ...E2E, amount: -600 }, quote: E2E_QUOTE,
      expected: { graph_hash: computeAnalysisAffectingGraphHash(g as never)!, edge_token: linkEffectEdgeToken(g, 'price', 'strain')! } }));
    expect(r.kind).toBe('refused');
    expect(JSON.stringify(g.edges)).toBe(before);
  });
  it('(B) CONTROL: an INTACT stored gauge is never rewritten by a re-answer (only the lever moves)', () => {
    const first = write(gaugeGraph(), 'price', 'strain', { ...E2E }, E2E_QUOTE);
    if (first.kind !== 'mutated') throw new Error(JSON.stringify(first));
    const gaugeBefore = JSON.stringify(edge(first.mutatedGraph, 'strain', 'mrr'));
    const again = write(first.mutatedGraph as Rec, 'price', 'strain', { ...E2E, amount: -600 }, E2E_QUOTE);
    if (again.kind !== 'mutated') throw new Error(JSON.stringify(again));
    expect(JSON.stringify(edge(again.mutatedGraph, 'strain', 'mrr'))).toBe(gaugeBefore);
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
  it("(C) refusal words name the mediator's derived unit, so the Agent can ask for the figure in it", () => {
    const words = linkEffectRefusalWords('unit_mismatch', sizedParentGraph(), { id: 'cost', label: 'Support cost' }, { id: 'mrr', label: 'MRR' },
      { amount_unit: '£/month', per_source_change_unit: 'cafés' });
    expect(words).toContain('"Support cost" in £/month');
    expect(linkEffectRefusalWords('unit_mismatch', gaugeGraph(), { id: 'strain', label: 'Support capacity strain' }, { id: 'mrr', label: 'MRR' },
      { amount_unit: '£/month', per_source_change_unit: 'cafés' }), 'CONTROL: a gauge is never a source unit').not.toContain('"Support capacity strain" in £/month');
  });
  // RT-18 (cut 5): production gates the (B) ask off; these rows keep its words tested for cut 6 (`gaugeAsk: true`).
  const W = (graph: Rec, links: { from: string; to: string }[], option: string) =>
    placeholderGoalWarning(graph, [{ option_id: option, links }], 'GOAL_FIGURES_PLACEHOLDER_PATH', false, { gaugeAsk: true });
  it('(B) withhold: ONE end-to-end question, never the two links apart; neither is offered as a one-click', () => {
    const w = W(gaugeGraph(), [{ from: 'price', to: 'strain' }, { from: 'strain', to: 'mrr' }], 'o-raise');
    expect(w.message).toBe('This comparison turns on how much ‘Pro plan price’ changes ‘MRR’ through ‘Support capacity strain’, which isn\'t sized in the model yet.'
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
    expect(W(g, [{ from: 'price', to: 'strain' }, { from: 'strain', to: 'mrr' }], 'o-raise').message).toContain('on top of its effect through \u2018Subscribers\u2019 that you already gave');
  });
  it('(B) "on top of" quotes a figure only in the ASKED quantity, and never an off-path link (Codex r1 P2)', () => {
    const same = gaugeGraph();
    same.nodes.push({ id: 'arpu', kind: 'factor', label: 'Upsell revenue' });
    same.edges.push({ from: 'price', to: 'arpu', strength: { mean: 0.2, std: 0.1 }, effect_direction: 'positive',
      provenance: { source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: 300, amount_unit: '£/month', per_source_change: 1,
        per_source_change_unit: '£', strength_mean: 0.2, strength_mean_frame: 'edge_strength' } } }, placeholder('arpu', 'mrr', 0.5));
    expect(W(same, [{ from: 'price', to: 'strain' }, { from: 'strain', to: 'mrr' }], 'o-raise').message).toContain('on top of the £300 / month per £1 you already gave');
    const offPath = gaugeGraph();
    offPath.nodes.push({ id: 'research', kind: 'factor', label: 'Research time' });
    offPath.edges.push({ from: 'price', to: 'research', strength: { mean: 0.2, std: 0.1 }, effect_direction: 'positive',
      provenance: { source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: 2, amount_unit: 'hours', per_source_change: 10,
        per_source_change_unit: '£', strength_mean: 0.2, strength_mean_frame: 'edge_strength' } } });
    expect(W(offPath, [{ from: 'price', to: 'strain' }, { from: 'strain', to: 'mrr' }], 'o-raise').message).not.toContain('on top of');
  });
  it('(B) long labels compact at WORD BOUNDARIES (S-A label rule, D-04); the question is never dropped (Codex r1 P2: the message came back empty)', () => {
    const g = gaugeGraph();
    g.nodes.find((n: Rec) => n.id === 'price').label = 'Enterprise onboarding and implementation consulting fee for new accounts';
    g.nodes.find((n: Rec) => n.id === 'strain').label = 'Annual security audit gross profit from enterprise contracts and renewals';
    g.nodes.find((n: Rec) => n.id === 'mrr').label = 'Annual recurring revenue for enterprise subscription accounts and partners';
    const m = W(g, [{ from: 'price', to: 'strain' }, { from: 'strain', to: 'mrr' }], 'o-raise').message;
    expect(m.length).toBeGreaterThan(0);
    expect(m.length).toBeLessThanOrEqual(400);
    // Never mid-word: every shortened label is a whole-word prefix of its full label.
    const full = ['price', 'strain', 'mrr'].map((id) => g.nodes.find((n: Rec) => n.id === id).label as string);
    for (const [, shown] of m.matchAll(/‘([^’]*)…’/g)) {
      const prefix = shown!.trimEnd();
      expect(full.some((l) => l.startsWith(prefix) && (l.length === prefix.length || /\s/.test(l.charAt(prefix.length)))), prefix).toBe(true);
    }
    expect(m).toContain(' through ');
    expect(m).toContain('A best guess and a range is fine.');
  });
  it('(C) withhold: asked in the unit Olumi measures the mediator in, the estimate named', () => {
    expect(W(sizedParentGraph(), [{ from: 'cost', to: 'mrr' }], 'o-spend').message).toContain(
      'Olumi measures ‘Support cost’ in £/month, from its own estimate of the link from ‘Support budget’; correct that if it’s wrong.');
  });
  it('⛔ (C) never asks a GUESSED link out of a node the user\'s limit watches (AIQ 5903604206): the generic words stand', () => {
    const g = sizedParentGraph();
    g.goal_constraints = [{ node_id: 'cost', operator: '<=', value: 9000, unit: '£/month', value_frame: 'level' }];
    const w = W(g, [{ from: 'cost', to: 'mrr' }], 'o-spend');
    expect(w.message).not.toContain('Olumi measures');
    expect(w.message).toBe(unsizedLinkSentence(w.links.map(l => ({ ...l,
      from_label: g.nodes.find((n: Rec) => n.id === l.from).label, to_label: g.nodes.find((n: Rec) => n.id === l.to).label }))));
  });
  it('the asked step is singular ("each 1 week", never "1 weeks")', () => {
    const g = sizedParentGraph('weeks');
    expect(W(g, [{ from: 'cost', to: 'mrr' }], 'o-spend').message).toContain('Roughly how much does each 1 week of');
  });
  it("(A) withhold: a goal with no frame is asked today's level first, with d5's bridge (#87 6007354826)", () => {
    const g = gaugeGraph();
    const goal = g.nodes.find((n: Rec) => n.id === 'mrr');
    delete goal.observed_state;
    goal.goal_threshold_unit = '£/month';
    expect(W(g, [{ from: 'price', to: 'strain' }, { from: 'strain', to: 'mrr' }], 'o-raise').message).toMatch(/whose strengths aren't sized in the model yet\. To size them, I first need today’s level of ‘MRR’\. What is it, in £\/month\?$/);
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
