/**
 * ⭐ FA1 (Acceptance e7 #87; Science d5 ruling, 6 Oct): a level-less node with no unit, whose ONE goal-path out-link is a
 * definitional part → total (±1 per 1, one unit at both ends), is measured in that total's unit. The served FA1 withhold
 * turned on support cost → "MRR lost to support strain" → MRR: (C) could not ask the link because the risk had no unit, so
 * the words said "Set it" while CEE typed no `first_ask` and the writer refused a £/month answer (`unit_mismatch`).
 * ONE reader (`mediatorReadings`) serves the ask and the writer; the card says the reading for approval. Rows bind by id.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { convertLinkEffect } from '../../../cee/magnitude/link-effect.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectMediatorReadings, linkEffectReadingToken,
  type ApplyLinkEffectEditParams } from '../../system-events/link-effect-edit.js';
import { prepareLinkEffectUnitReadings } from '../../system-events/link-effect-unit-reading.js';
import { linkEffectReadingOf } from '../approval-chips.js';
import { linkEffectRefusalWords } from '../runtime/agent-capabilities.js';
import { unsizedLeaderGoalPaths, placeholderGoalWarning } from '../goal-certainty.js';
import { mediatorReadings } from '../mediator-reading.js';

type Rec = Record<string, any>;
const CODE = 'GOAL_FIGURES_PLACEHOLDER_PATH';
const placeholder = (from: string, to: string, mean: number): Rec => ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 0.9,
  effect_direction: mean < 0 ? 'negative' : 'positive', defaulted: true, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } });

/** budget (£/month) → cost (no unit; Olumi sized the link in £/month) → lost (risk, no unit, no level) → MRR, lost → MRR −1 per 1. */
function partGraph(): Rec {
  const beta = convertLinkEffect(250, 1000, 5000, 10000)!;
  const part = convertLinkEffect(-1, 1, 200000, 30000)!;
  return {
    goal_node_id: 'mrr',
    nodes: [
      { id: 'mrr', kind: 'goal', label: 'MRR', observed_state: { value: 0.5, raw_value: 100000, cap: 200000, unit: '£/month', source: 'user_override' } },
      { id: 'budget', kind: 'factor', label: 'Support budget', observed_state: { value: 0.5, raw_value: 5000, cap: 10000, unit: '£/month', source: 'user_override' } },
      { id: 'cost', kind: 'factor', label: 'Support cost', scale_frame: 5000 },
      { id: 'lost', kind: 'risk', label: 'MRR lost to support strain', scale_frame: 30000 },
      { id: 'o-spend', kind: 'option', label: 'Spend more', interventions: { budget: { value: 0.6, raw_value: 6000 } } },
    ],
    edges: [
      { from: 'budget', to: 'cost', strength: { mean: beta, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive',
        provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: { amount: 250, amount_unit: '£/month',
          per_source_change: 1000, per_source_change_unit: '£/month', strength_mean: beta, strength_mean_frame: 'edge_strength' } } },
      placeholder('cost', 'lost', 0.4),
      { from: 'lost', to: 'mrr', strength: { mean: part, std: 0.05 }, exists_probability: 0.8, effect_direction: 'negative', defaulted: true,
        provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', definitional: true, natural_effect: { amount: -1, amount_unit: '£/month',
          per_source_change: 1, per_source_change_unit: '£/month', strength_mean: part, strength_mean_frame: 'edge_strength' } } },
    ],
  };
}
const edge = (g: unknown, from: string, to: string): Rec => (g as Rec).edges.find((e: Rec) => e.from === from && e.to === to);
/** d5's mutant: the SAME ±1 figure, no longer definitional. */
const notDefinitional = (g: Rec, from = 'lost', to = 'mrr'): Rec => { const c = structuredClone(g); delete edge(c, from, to).provenance.definitional; return c; };

const approved = (p: Omit<ApplyLinkEffectEditParams, 'reading_token'>): ApplyLinkEffectEditParams => ({ ...p, reading_token: linkEffectReadingToken(p) });
function write(graph: Rec, from: string, to: string, effect: ApplyLinkEffectEditParams['effect'], quote: string) {
  const prepared = prepareLinkEffectUnitReadings(graph, from, to, effect, quote);
  return applyLinkEffectEdit(approved({ persistedGraph: graph, from, to, effect, quote, unit_readings: prepared.unit_readings,
    expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: linkEffectEdgeToken(graph, from, to)! } }));
}
const ANSWER = { amount: 300, amount_unit: '£/month', per_source_change: 1000, per_source_change_unit: '£/month' } as const;
const ANSWER_QUOTE = 'every £1,000 a month of support cost loses about £300 a month of MRR';

describe('THE ONE READER: a definitional part takes its total\'s unit', () => {
  it('lost → MRR is definitional −1 per 1 in £/month → `lost` reads £/month; `cost` keeps its (C) reading', () => {
    const r = mediatorReadings(partGraph());
    expect(r.get('lost')).toEqual({ via: 'definitional_part', unit: '£/month', child: 'mrr' });
    expect(r.get('cost')).toEqual({ via: 'sized_parents', unit: '£/month', child: 'lost', parents: ['budget'] });
  });
  it('⛔ MUTANT GUARD (d5): never from a non-definitional link, even at the same ±1 per 1', () => {
    expect(mediatorReadings(notDefinitional(partGraph())).get('lost')).toBeUndefined();
  });
  it.each([
    ['a definitional link that is not ±1 per 1', (g: Rec) => { edge(g, 'lost', 'mrr').provenance.natural_effect.amount = -2; }],
    ['different units at its two ends', (g: Rec) => { edge(g, 'lost', 'mrr').provenance.natural_effect.per_source_change_unit = '£/year'; }],
    // The ONE predicate is exact on the definition's own unit (the UI mirrors it with no unit grammar): two spellings of one
    // unit are not a drafted definition.
    ['two spellings of one unit at its two ends', (g: Rec) => { edge(g, 'lost', 'mrr').provenance.natural_effect.per_source_change_unit = 'GBP/month'; }],
    ['a total with no unit of its own', (g: Rec) => { delete g.nodes.find((n: Rec) => n.id === 'mrr').observed_state.unit; }],
    ['a total measured in another unit', (g: Rec) => { g.nodes.find((n: Rec) => n.id === 'mrr').observed_state.unit = 'customers'; }],
    ['a second out-link on the goal path', (g: Rec) => { g.edges.push(placeholder('lost', 'cost', 0.2)); }],
    ['a part that holds its own level', (g: Rec) => { g.nodes.find((n: Rec) => n.id === 'lost').observed_state = { value: 0.1, raw_value: 3000, cap: 30000, source: 'user_override' }; }],
    ['a unit-bearing label that does not fit', (g: Rec) => { g.nodes.find((n: Rec) => n.id === 'lost').label = 'Lost hours per week'; }],
    // ⛔ Codex r1 P1: with no frame the writer cannot convert an answer (`unconvertible`), so no reading and no ask.
    ['a part with no frame of its own', (g: Rec) => { delete g.nodes.find((n: Rec) => n.id === 'lost').scale_frame; }],
    // ⛔ DL / Codex r1 #2653: ONE current-definitional-carrier predicate. A band or strength edit keeps the flag but moves
    // the size, so the link is no longer a definition: no part reading, whether its natural effect is kept or dropped.
    ['a BAND-EDITED definitional link (flag and stale natural effect kept)', (g: Rec) => { edge(g, 'lost', 'mrr').strength = { mean: -0.3, std: 0.075 }; }],
    ['a BAND-EDITED definitional link (natural effect dropped)', (g: Rec) => { edge(g, 'lost', 'mrr').strength = { mean: -0.3, std: 0.075 }; delete edge(g, 'lost', 'mrr').provenance.natural_effect; }],
  ])('no reading: %s', (_name, mutate) => {
    const g = partGraph();
    mutate(g);
    expect(mediatorReadings(g).get('lost')).toBeUndefined();
  });
});

describe('THE ASK (production: the gauge question gated off)', () => {
  const warn = (g: Rec) => placeholderGoalWarning(g, [{ option_id: 'o-spend', links: [{ from: 'cost', to: 'lost' }] }], CODE);
  it('(C) now reaches a definitional part: the words ask in £/month, and `first_ask` types that link', () => {
    const w = warn(partGraph());
    expect(w.first_ask).toEqual({ kind: 'link', from: 'cost', to: 'lost' });
    expect(w.message).toContain('Roughly how much does each £1 / month of ‘Support cost’ change ‘MRR lost to support strain’, in £/month?');
    expect(w.message).toContain('Olumi measures ‘Support cost’ in £/month, from its own estimate of the link from ‘Support budget’; correct that if it’s wrong.');
  });
  it('PRECONDITION (the served FA1 behaviour): not definitional → the plain "Set it" words, no `first_ask`, nothing offered', () => {
    const w = warn(notDefinitional(partGraph()));
    expect(w.message).toContain('Set it to see how much it matters.');
    expect(w).not.toHaveProperty('first_ask');
    expect(w).not.toHaveProperty('acceptable_links');
  });
});

describe('SERVED FA1 (e7, guest T1b draft 46d37fb7, CEE d619668a)', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/fa1-served-graph.json', import.meta.url), 'utf8')) as Rec;
  const FROM = 'monthly_starter_support_cost';
  const TO = 'mrr_lost_to_starter_support_strain';
  const paths = () => unsizedLeaderGoalPaths(fx.graph, ['raise_prices_10', 'launch_starter_tier', 'keep_pricing_as_it_is']);
  it('PRECONDITION: the served paths, and with the part not definitional the served words byte for byte', () => {
    expect(paths().flatMap((p) => p.links)).toEqual(fx.placeholder_warning.links);
    const served = placeholderGoalWarning(notDefinitional(fx.graph, TO, 'monthly_recurring_revenue'), paths(), CODE);
    expect(served.message).toBe(fx.placeholder_warning.message);
    expect(served).not.toHaveProperty('first_ask');
  });
  it('⛔ BAND-EDITED twin of the served link (flag kept, size moved) → no part reading, the served words stand', () => {
    const g = structuredClone(fx.graph);
    edge(g, TO, 'monthly_recurring_revenue').strength = { mean: -0.3, std: 0.075 };
    expect(mediatorReadings(g).get(TO)).toBeUndefined();
    expect(placeholderGoalWarning(g, paths(), CODE).message).toBe(fx.placeholder_warning.message);
  });
  it('AS SERVED: the risk reads £/month off its definitional link into MRR → (C) words + `first_ask` on the served link', () => {
    expect(mediatorReadings(fx.graph).get(TO)).toEqual({ via: 'definitional_part', unit: '£/month', child: 'monthly_recurring_revenue' });
    const w = placeholderGoalWarning(fx.graph, paths(), CODE);
    expect(w.first_ask).toEqual({ kind: 'link', from: FROM, to: TO });
    // The (C) grammar compacts long labels to keep the 400-character carrier (whole sentences kept, never cut).
    expect(w.message).toContain('Roughly how much does each £1 / month of ‘Monthly starter support…’ change ‘MRR lost to starter sup…’, in £/month?');
    expect(w.message).not.toContain('Set it to see how much it matters.');
  });
  it('⛔ Codex r1 P1: the served graph with the risk\'s frame removed asks nothing it cannot write (served words, no first_ask)', () => {
    const g = structuredClone(fx.graph);
    delete g.nodes.find((n: Rec) => n.id === TO).scale_frame;
    const w = placeholderGoalWarning(g, unsizedLeaderGoalPaths(g, ['raise_prices_10', 'launch_starter_tier', 'keep_pricing_as_it_is']), CODE);
    expect(w).not.toHaveProperty('first_ask');
    expect(w.message).toBe(fx.placeholder_warning.message);
  });
  it('the answer the ask invites is WRITTEN on the served graph (it was refused unit_mismatch)', () => {
    const r = write(fx.graph, FROM, TO, ANSWER, 'every £1,000 a month of starter support cost loses about £300 a month of MRR');
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    const refused = write(notDefinitional(fx.graph, TO, 'monthly_recurring_revenue'), FROM, TO, ANSWER, 'every £1,000 a month of starter support cost loses about £300 a month of MRR');
    expect(refused.kind, 'PRECONDITION: the served writer refused it').not.toBe('mutated');
  });
});

describe('THE WRITER: the answer the (C) ask invites', () => {
  it('cost → lost in £/month is written as the user\'s size, and the definitional link is untouched', () => {
    const g = partGraph();
    const partBefore = JSON.stringify(edge(g, 'lost', 'mrr'));
    const r = write(g, 'cost', 'lost', ANSWER, ANSWER_QUOTE);
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    if (r.kind !== 'mutated') return;
    const e = edge(r.mutatedGraph, 'cost', 'lost');
    expect(e.provenance.magnitude).toBe('user_stated');
    expect(e.provenance.natural_effect).toMatchObject({ amount: 300, amount_unit: '£/month', per_source_change: 1000, per_source_change_unit: '£/month' });
    expect(JSON.stringify(edge(r.mutatedGraph, 'lost', 'mrr'))).toBe(partBefore);
    // OUTCOME: the path that withheld is sized; nothing on it is unsized any more.
    expect(unsizedLeaderGoalPaths(r.mutatedGraph, ['o-spend'])).toEqual([]);
    expect(unsizedLeaderGoalPaths(g, ['o-spend']).flatMap((p) => p.links), 'CONTROL: before the answer it withheld').toEqual([{ from: 'cost', to: 'lost' }]);
  });
  it('READER (agent-capabilities refusal words): a refused answer names the part\'s unit, so the Agent can ask in it', () => {
    const say = (g: Rec) => linkEffectRefusalWords('unit_mismatch', g, { id: 'cost', label: 'Support cost' }, { id: 'lost', label: 'MRR lost to support strain' },
      { amount_unit: 'customers', per_source_change_unit: '£/month' });
    expect(say(partGraph())).toContain('"MRR lost to support strain" is measured in £/month');
    // CONTROL: no part reading → the end has no unit, so the words send the user to the band control instead.
    expect(say(notDefinitional(partGraph()))).toContain('has no unit or scale in this model yet');
  });
  it('⛔ MUTANT GUARD (d5): with the out-link not definitional, the same answer is refused', () => {
    const r = write(notDefinitional(partGraph()), 'cost', 'lost', ANSWER, ANSWER_QUOTE);
    expect(r.kind).not.toBe('mutated');
  });
});

describe('THE CARD: the reading is said for approval (d5 words)', () => {
  const card = (g: Rec) => linkEffectReadingOf({ operations: [{ op: 'set_link_effect', path: 'cost::lost', value: { from: 'cost', to: 'lost',
    effect: ANSWER, quote: ANSWER_QUOTE, edge_token: 't',
    ...((m) => m.length > 0 ? { mediator_readings: m } : {})(linkEffectMediatorReadings(g, 'cost', 'lost')) } }] } as never,
  { from: 'Support cost', to: 'MRR lost to support strain' });
  it('names the part reading AND the (C) source reading', () => {
    const words = card(partGraph())!;
    expect(words).toContain('Olumi treats ‘MRR lost to support strain’ as part of ‘MRR’, so it’s measured in £/month; correct that if it’s wrong.');
    expect(words).toContain('Olumi measures ‘Support cost’ in £/month, from its own estimate of the link from ‘Support budget’; correct that if it’s wrong.');
  });
  // ⛔ Codex r1 P1: an answer the door WRITES never loses its card. Each spelling goes through the real writer AND the card.
  it.each(['GBP/month', '£ per month', '£/months', '£/MONTH'])('the writer takes "%s" for £/month, and so does the card', (unit) => {
    const g = partGraph();
    const effect = { ...ANSWER, amount_unit: unit, per_source_change_unit: unit };
    expect(write(g, 'cost', 'lost', effect, ANSWER_QUOTE).kind).toBe('mutated');
    const words = linkEffectReadingOf({ operations: [{ op: 'set_link_effect', path: 'cost::lost', value: { from: 'cost', to: 'lost', effect,
      quote: ANSWER_QUOTE, edge_token: 't', mediator_readings: linkEffectMediatorReadings(g, 'cost', 'lost') } }] } as never,
    { from: 'Support cost', to: 'MRR lost to support strain' });
    expect(words).toContain('so it’s measured in £/month');
    expect(words).toContain('Olumi measures ‘Support cost’ in £/month');
  });
  it.each([
    ['sized_parents', 'from'], ['definitional_part', 'to'], ['gauge', 'to'],
  ] as const)('CLASS (%s): a synonym of the reading meets it; another quantity never does', (via, end) => {
    const card = (stated: string, reading: string) => linkEffectReadingOf({ operations: [{ op: 'set_link_effect', path: 'a::b', value: { from: 'a', to: 'b',
      effect: { amount: 5, amount_unit: end === 'to' ? stated : '£/month', per_source_change: 1, per_source_change_unit: end === 'from' ? stated : '£/month' },
      quote: 'q', edge_token: 't', mediator_readings: [{ node_id: end === 'from' ? 'a' : 'b', via, unit: reading, other_label: 'Other' }] } }] } as never,
    { from: 'A', to: 'B' });
    expect(card('GBP/month', '£/month')).toBeDefined();
    expect(card('customers', '£/month')).toBeUndefined();
    expect(card('£', '%')).toBeUndefined();
  });
  it('DL P2: sizing the part → total link itself names the part reading once (the writer reads the part in £/month)', () => {
    const g = partGraph();
    const effect = { amount: -1, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '£/month' };
    expect(write(g, 'lost', 'mrr', effect, 'each £1 a month lost to support strain is £1 a month of MRR lost').kind).toBe('mutated');
    const words = linkEffectReadingOf({ operations: [{ op: 'set_link_effect', path: 'lost::mrr', value: { from: 'lost', to: 'mrr', effect,
      quote: 'q', edge_token: 't', mediator_readings: linkEffectMediatorReadings(g, 'lost', 'mrr') } }] } as never,
    { from: 'MRR lost to support strain', to: 'MRR' })!;
    expect(words.split('as part of ‘MRR’, so it’s measured in £/month').length - 1).toBe(1);
  });
  it('CONTROL: not definitional → no part reading on the card', () => {
    expect(linkEffectMediatorReadings(notDefinitional(partGraph()), 'cost', 'lost').map((m) => m.via)).toEqual(['sized_parents']);
  });
});
