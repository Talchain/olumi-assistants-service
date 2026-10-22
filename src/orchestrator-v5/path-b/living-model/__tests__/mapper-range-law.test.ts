import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { linkDefaultAssumptionsOf } from '../../../../cee/magnitude/link-default-assumptions.js';
import { withGoalChanceLicence } from '../../../goal-target/goal-chance-licence.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER, OPTION_EFFECTS } from './fixtures.js';

type Rec = Record<string, any>;
const disclosure = (low: number, high: number, who = 'You gave a range') => `${who}, ${low} to ${high}, and no most likely value. The calculation centres on the middle, ${(low + high) / 2}, with a spread matching the range's width; this is Olumi's assumption, and a most likely value would replace it.`;
const edgeOf = (graph: { edges: Rec[] }, from = 'f') => graph.edges.find(e => e.from === from)!;
const digest = (model: LivingModelT) => createHash('sha256').update(JSON.stringify(mapLivingModel(model))).digest('hex');

function cafe(): LivingModelT {
  const model = structuredClone(OPTION_EFFECTS);
  const unit = 'coffees per week';
  Object.assign(model.aims[0]!, { text: 'Weekly café sales', quote: 'At least 480 coffees per week; today 420' });
  Object.assign(model.aims[0]!.target!, { quantity: unit, unit, value: 480, current: 420 });
  for (const [i, [low, high]] of [[50, 90], [20, 40]].entries()) {
    const link = model.links[i]!;
    link.quote = `Option ${i ? 'B' : 'A'} adds ${low} to ${high} ${unit}`;
    Object.assign(link.effect, { form: 'range', value: null, low, high, unit });
  }
  return model;
}

describe('DL range law: a declared range never costs the chance', () => {
  it.each(['user', 'party'] as const)('café: both chances are licensed provisionally, each original range and disclosure survive the stored graph (%s)', source => {
    const model = cafe();
    for (const [i, link] of model.links.entries()) Object.assign(link, { source, party: source === 'party' ? ['Finance', 'Operations'][i] : null });
    const before = structuredClone(model);
    expect(LivingModel.safeParse(model).success).toBe(true);
    const mapped = mapLivingModel(model);
    expect(mapped.withheld).toEqual([]);
    const graph = projectCorePostimageForPersistence(GraphV3.parse({ ...mapped.graph, living_model: model })) as Rec;
    expect(graph.living_model).toEqual(before);
    expect(model).toEqual(before);
    const options = graph.nodes.filter((n: Rec) => n.kind === 'option');
    // Synthetic engine response: this row tests licensing, not an ISL Monte Carlo run.
    const envelope = { option_comparison: options.map((o: Rec, i: number) => ({ option_id: o.id, probability_of_goal: i ? 0.02 : 0.80 })), inference_warnings: [] };
    const sentRun = { graph, goal_node_id: 'w', options: options.map((o: Rec) => ({ option_id: o.id, interventions: o.interventions })) };
    const result = withGoalChanceLicence(envelope, graph, 'w', undefined, undefined, graph, { sentRun }) as Rec;
    const licence = result.inference_warnings.find((w: Rec) => w.code === 'GOAL_CHANCE_LICENSED');
    expect(licence).toBeDefined();
    expect(Object.keys(licence.pct_by_option).sort()).toEqual(['a', 'b']);
    expect(licence.provisional).toBe(true);
    expect(licence.default_assumptions.coefficient_distribution).toBe('unbounded_normal');
    expect(licence.default_assumptions.status).toBe('Illustrative calculation — uses untested Olumi assumptions.');
    expect(licence.default_assumptions.links).toHaveLength(2);
    expect(licence.notes.filter((n: string) => n === licence.default_assumptions.status)).toEqual([licence.default_assumptions.status]);
    for (const [i, from] of ['a__on', 'b__on'].entries()) {
      const edge = edgeOf(graph as { edges: Rec[] }, from);
      const range = before.links[i]!.effect;
      const loss = linkDefaultAssumptionsOf(edge);
      expect(loss).toEqual([{ code: 'CLAMP_STD_MINIMUM', layer: 'cee', field_path: `edges[${from}::w].strength.std`, before: null,
        after: edge.strength.std, severity: 'info', reason: disclosure(range.low!, range.high!, source === 'user' ? 'You gave a range' : `${before.links[i]!.party}’s range`) }]);
      expect(edge.exists_probability).toBe(1);
      expect(edge.provenance.source).toBe('cee_hypothesis');
      expect(edge.provenance.magnitude).toBe('olumi_estimate');
      expect(edge.provenance.natural_effect.amount).toBe(i ? 30 : 70);
      expect(edge.provenance.natural_effect.stated_range).toBeUndefined();
      expect(licence.default_assumptions.links.filter((l: Rec) => l.from === from)).toEqual([{ from, to: 'w', loss }]);
    }
  });

  it('number + author class: a second factor brief retains signed uniform moments across scales and sources', () => {
    for (const [low, high, sign] of [[50, 90, '+'], [-90, -50, '-'], [20, 40, '-'], [-10, 50, '+']] as const) {
      for (const target of [100, 200]) for (const source of ['user', 'party', 'olumi', 'unverified'] as const) for (const party of source === 'party' ? ['Finance', null] : [null]) {
        const model = structuredClone(KNOWN_ANSWER);
        model.aims[0]!.target!.value = target;
        Object.assign(model.aims[0]!, { text: `Reach ${target} units`, quote: `we need at least ${target} units; today we are at 70` });
        const link = model.links[0]!;
        Object.assign(link, { source, party, quote: source === 'user' || source === 'party' ? `Each +1 changes units by ${low} to ${high}` : null });
        Object.assign(link.effect, { form: 'range', value: null, sd: null, low, high, sign });
        const before = structuredClone(model);
        const mapped = mapLivingModel(model);
        expect(mapped.withheld).toEqual([]);
        const edge = edgeOf(mapped.graph);
        const goal = mapped.graph.nodes.find(n => n.id === 'g') as Rec;
        const factor = mapped.graph.nodes.find(n => n.id === 'f') as Rec;
        const ratio = factor.observed_state.cap / goal.goal_threshold_cap;
        expect(edge.strength.mean).toBeCloseTo((sign === '-' ? -1 : 1) * Math.abs((low + high) / 2) * ratio, 12);
        expect(edge.strength.std).toBeCloseTo((high - low) / Math.sqrt(12) * ratio, 12);
        expect(edge.strength.std).toBeGreaterThan(0);
        expect(edge.effect_direction).toBe(sign === '-' ? 'negative' : 'positive');
        expect(edge.provenance.magnitude).toBe('olumi_estimate');
        expect(edge.provenance.source).toBe('cee_hypothesis');
        expect(edge.provenance.natural_effect).toEqual({ amount: (sign === '-' ? -1 : 1) * Math.abs((low + high) / 2), amount_unit: 'units',
          per_source_change: 1, per_source_change_unit: '', strength_mean: edge.strength.mean, strength_mean_frame: 'edge_strength' });
        expect(edge.exists_probability).toBe(source === 'user' || source === 'party' ? 1 : 0.8);
        const reason = linkDefaultAssumptionsOf(edge).find(r => r.code === 'CLAMP_STD_MINIMUM')!.reason;
        expect(reason).toBe(disclosure(low, high, source === 'user' ? 'You gave a range'
          : source === 'party' ? party === null ? 'The stated range' : `${party}’s range`
            : source === 'olumi' ? "The calculation uses Olumi's estimated range" : 'The calculation uses the given (its source is not confirmed) range'));
        expect(model).toEqual(before);
      }
    }
  });

  it('negative: neither another link nor a changed sent spread borrows the range disclosure; edits do not credit the centre to the person', () => {
    const model = cafe();
    model.links[0]!.quote = 'Option A adds 50 to 90 coffees per week; revenue was 2m as of 2026-09-01';
    const graph = mapLivingModel(model).graph;
    const a = edgeOf(graph, 'a__on'), b = edgeOf(graph, 'b__on');
    expect(linkDefaultAssumptionsOf(a, b)).toEqual([]);
    expect(linkDefaultAssumptionsOf(a, { ...a, strength: { ...a.strength, std: a.strength.std * 2 } })).toEqual([]);
    expect(linkDefaultAssumptionsOf(a)[0]!.reason).toBe(disclosure(50, 90));
    expect(linkDefaultAssumptionsOf(b)[0]!.reason).toBe(disclosure(20, 40));
    const edited = structuredClone(KNOWN_ANSWER);
    edited.links[0]!.quote = null; // Existing edited-link marker: user source with no quote.
    Object.assign(edited.links[0]!.effect, { form: 'range', value: null, low: 50, high: 90, sd: null });
    for (const estimate_by of [null, 'olumi'] as const) {
      edited.links[0]!.effect.estimate_by = estimate_by;
      const edge = edgeOf(mapLivingModel(edited).graph);
      expect(edge.provenance.source).toBe('cee_hypothesis');
      expect(edge.provenance.magnitude).toBe('olumi_estimate');
      expect(edge.exists_probability).toBe(1);
      expect(linkDefaultAssumptionsOf(edge)[0]!.reason).toBe(estimate_by === null ? disclosure(50, 90)
        : disclosure(50, 90, "The calculation uses Olumi's estimated range"));
    }
  });

  it.each([
    ['factor', -30, 10, '+', 'a87a49fb13f95187db2703a4836fd871741c7a92ce4dd641319b4949d0c3a406'],
    ['factor', -10, 30, '-', 'd2c03cc8f2335d8686a0555ce42278d75dc749e508fa5164516dfe9af7a6ced9'],
    ['café', -30, 10, '+', '2b0706c714524b0c8a0e0e81261c8dbd1e32d5b97dd82bc2d3c5fc8363a98aad'],
    ['café', -10, 30, '-', 'c2a1d9875427e2da82e97bc1e39e0b47128829026b3c6cd3d056e045d414b3d3'],
  ] as const)('conflicting zero-crossing range stays held and byte-identical to base: %s %s..%s %s', (shape, low, high, sign, baseHash) => {
    const model = shape === 'factor' ? structuredClone(KNOWN_ANSWER) : cafe();
    if (shape === 'café') model.links[1]!.effect.value = 30; // Independent centred link stays sized on base too.
    Object.assign(model.links[0]!.effect, { form: 'range', value: null, low, high, sign, sd: null });
    const mapped = mapLivingModel(model);
    expect(digest(model)).toBe(baseHash);
    expect(mapped.withheld).toContainEqual({ id: model.links[0]!.id, reason: 'link_range_no_law' });
    const edge = edgeOf(mapped.graph, shape === 'factor' ? 'f' : 'a__on');
    expect(edge.provenance.magnitude).toBe('olumi_placeholder');
    expect(linkDefaultAssumptionsOf(edge)).toEqual([]);
    model.aims[0]!.target!.value = null;
    const frameless = mapLivingModel(model);
    expect(frameless.withheld.filter(w => w.id === model.links[0]!.id)).toEqual([{ id: model.links[0]!.id, reason: 'link_range_no_law' }]);
  });

  it('a range cannot supply a missing goal frame, unsigned direction, incompatible unit or invalid bounds', () => {
    const base = structuredClone(KNOWN_ANSWER);
    Object.assign(base.links[0]!.effect, { form: 'range', value: null, low: 50, high: 90, sd: null });
    for (const [low, high] of [[null, 90], [50, null], [90, 50], [50, 50]]) {
      const model = structuredClone(base);
      Object.assign(model.links[0]!.effect, { low, high });
      const mapped = mapLivingModel(model);
      expect(mapped.withheld).toContainEqual({ id: 'f_g', reason: 'link_range_no_law' });
      expect(edgeOf(mapped.graph).provenance.magnitude).toBe('olumi_placeholder');
    }
    const unit = structuredClone(base);
    unit.links[0]!.effect.unit = 'parcels';
    expect(mapLivingModel(unit).withheld).toContainEqual({ id: 'f_g', reason: 'link_unit_mismatch' });
    expect(edgeOf(mapLivingModel(unit).graph).provenance.magnitude).toBe('olumi_placeholder');
    const unsigned = structuredClone(base);
    unsigned.links[0]!.effect.sign = null;
    expect(mapLivingModel(unsigned).withheld).toContainEqual({ id: 'f_g', reason: 'link_sign_unknown' });
    expect(edgeOf(mapLivingModel(unsigned).graph)).toBeUndefined();
    base.aims[0]!.target!.value = null;
    expect(mapLivingModel(base).withheld).toContainEqual({ id: 'f_g', reason: 'link_goal_target_unknown' });
    expect(edgeOf(mapLivingModel(base).graph).provenance.magnitude).toBe('olumi_placeholder');
  });

  it('unchanged forms are byte-identical to staging 381977c0 (captured before the source edit)', () => {
    const hashes = {
      centred: 'e79f5874239d8bc7f8137e44ee5c3085466a66939e698b02a21b71659bcdaeac',
      point: '825eef192f93a170648d595dd39af763e59f93eb69ca20e3daacfbb6fa740a77',
      point_sd: '4dc6086fc4d18d979d52630fe21b016df9247af55aa89fc846fd1b78cf91d7df',
      normal: '3ed816f64be7d890505b824337ff9e4168b674e9a6bd4f9818e81522266e179f',
      exact: '712e1ea87991a1a73c7a9e6b4b453ec1b0a8567a9a693f31b0170aa8ebcfffa3',
    } as const;
    for (const form of Object.keys(hashes) as (keyof typeof hashes)[]) {
      const model = structuredClone(KNOWN_ANSWER);
      Object.assign(model.links[0]!.effect, { form: form === 'centred' ? 'range' : form === 'point_sd' ? 'point' : form,
        sd: form === 'normal' || form === 'point_sd' ? 10 : null, low: form === 'centred' ? 30 : null, high: form === 'centred' ? 70 : null });
      expect(digest(model), form).toBe(hashes[form]);
    }
    expect(digest(OPTION_EFFECTS)).toBe('23dc353b4b24e4b0a30c3a8641c9e033e72a5759d4c189cf8d0ea9c81c306fed');
  });
});
