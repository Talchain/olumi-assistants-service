import { describe, expect, it } from 'vitest';
import { GraphV3, InterventionV3 } from '../../../../schemas/cee-v3.js';
import { LivingAim, LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { readGoalRecord } from '../../../goal-target/goal-record.js';
import { mapLivingModel } from '../mapper.js';
import { linkDefaultAssumptionsOf } from '../../../../cee/magnitude/link-default-assumptions.js';
import { goalChanceEstimateCounts } from '../../../agent-lane/goal-chance-estimate-attribution.js';
import { KNOWN_ANSWER, OPTION_EFFECTS } from './fixtures.js';
import { RunInputLinkSchema } from '@talchain/schemas/orchestrator';
import { effectEnd } from '../../../agent-lane/rerun-explanation.js';

type Rec = Record<string, any>;

const node = (g: { nodes: Record<string, unknown>[] }, id: string) => g.nodes.find((n) => n.id === id) as Record<string, any>;
/** Standard normal CDF (Abramowitz–Stegun 7.1.26), enough for a 1e-4 check. */
function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

describe('thin core mapper: living model → GraphV3', () => {
  it('Track 3 Q2 s1 (0/8; buddy AMEND): Olumi\'s suggested measure is labelled as Olumi\'s, carries no figure, and a figure on it is never read as the person\'s target', () => {
    const aim = KNOWN_ANSWER.aims[0]!;
    const withTarget = (target: Rec): LivingModelT => ({ ...KNOWN_ANSWER, aims: [{ ...aim, target: { ...aim.target!, ...target } }] });
    // Invariance: a target whose measure the person named (source null) maps exactly as before the field existed.
    expect(mapLivingModel(withTarget({ source: null }))).toEqual(mapLivingModel(KNOWN_ANSWER));
    // A suggested measure with no figure maps exactly like the person's own measure with no figure: held, asked, never a threshold.
    const noFigure = { value: null, low: null, high: null, current: null };
    const suggested = mapLivingModel(withTarget({ ...noFigure, source: 'olumi' }));
    expect(suggested).toEqual(mapLivingModel(withTarget({ ...noFigure, source: null })));
    expect(suggested.withheld).toContainEqual({ id: 'g', reason: 'no_level_target' });
    // A figure on Olumi's measure is held by name: never the target the person stated.
    const figured = mapLivingModel(withTarget({ source: 'olumi' }));
    expect(figured.withheld).toContainEqual({ id: 'g', reason: 'target_not_theirs' });
    expect(node(figured.graph, 'g').goal_threshold_raw).toBeUndefined();
    // CONTRAST: the same figure under the person's own measure is their target (the known answer).
    expect(node(mapLivingModel(withTarget({ source: null })).graph, 'g').goal_threshold_raw).toBe(100);
    // A model saved before the field reads null.
    const { source: _s, ...before } = { ...aim.target!, source: null };
    expect(LivingModel.parse({ ...KNOWN_ANSWER, aims: [{ ...aim, target: before }] }).aims[0]!.target!.source).toBeNull();
  });

  it('the known-answer control maps to push ≈ Φ(−1) = 0.1587 and hold = 0 on the engine\'s own scale', () => {
    expect(LivingModel.safeParse(KNOWN_ANSWER).success).toBe(true);
    const { graph, withheld } = mapLivingModel(KNOWN_ANSWER);
    expect(withheld).toEqual([]);
    const goal = node(graph, 'g');
    expect(goal).toMatchObject({ kind: 'goal', goal_direction: '>=', goal_threshold_raw: 100, goal_threshold_cap: 125, goal_threshold: 0.8, goal_threshold_frame: 'level' });
    expect(goal.observed_state).toMatchObject({ value: 0.56, baseline: 0.56, raw_value: 70, cap: 125, source: 'brief_extraction' });
    expect(node(graph, 'f').observed_state).toMatchObject({ value: 0.5, raw_value: 0.5, cap: 1 });
    expect(node(graph, 'hold')).toMatchObject({ is_baseline: true, interventions: { f: { value: 0.5, raw_value: 0.5 } } });
    expect(node(graph, 'push').interventions.f).toMatchObject({ value: 1, raw_value: 1 });
    const link = graph.edges.find((e) => e.from === 'f' && e.to === 'g') as Record<string, any>;
    expect(link.strength.mean).toBeCloseTo(0.4, 10);
    expect(link.strength.std).toBeCloseTo(0.08, 4);
    expect(link.provenance).toMatchObject({ source: 'brief_extraction', magnitude: 'user_stated' });
    // The stated law is the person's, its existence included (Science, 21 Oct): no Olumi default, so no "Illustrative" label.
    expect(linkDefaultAssumptionsOf(link)).toEqual([]);
    // A linear Gaussian reading of the mapped graph reproduces the control's answers.
    const meetChance = (fTo: number) => {
      const mean = goal.observed_state.baseline + (fTo - 0.5) * link.strength.mean;
      const sd = Math.abs(fTo - 0.5) * link.strength.std;
      return sd === 0 ? (mean >= goal.goal_threshold ? 1 : 0) : 1 - phi((goal.goal_threshold - mean) / sd);
    };
    expect(meetChance(node(graph, 'push').interventions.f.value)).toBeCloseTo(0.1587, 3);
    expect(meetChance(node(graph, 'hold').interventions.f.value)).toBe(0);
  });

  it('⭐ RED→GREEN (A5 served 37b5fc4b): the person\'s mean and SD with no shape stated keep THEIR SD, under Olumi\'s disclosed bell-shape assumption', () => {
    // Saved on served: form point, value 50, sd 10 ("50 on average, standard deviation 10"; no distribution named). The SD was
    // replaced by half the effect (25), so push read 35% instead of the Normal-conditional 15.87%.
    const edge = (g: { edges: Record<string, unknown>[] }) => g.edges.find((e) => e.from === 'f' && e.to === 'g') as Record<string, any> | undefined;
    const meanSd: LivingModelT = structuredClone(KNOWN_ANSWER);
    meanSd.links[0]!.effect = { ...meanSd.links[0]!.effect, form: 'point' };
    const { graph } = mapLivingModel(meanSd);
    const goal = node(graph, 'g');
    const link = edge(graph)!;
    expect(link.strength.mean).toBeCloseTo(0.4, 10);
    expect(link.strength.std).toBeCloseTo(0.08, 10);
    expect(link.provenance).toMatchObject({ source: 'brief_extraction', magnitude: 'user_stated' });
    const z = (goal.goal_threshold - (goal.observed_state.baseline + 0.5 * link.strength.mean)) / (0.5 * link.strength.std);
    expect(1 - phi(z)).toBeCloseTo(0.1587, 3);
    // Whose is what: the SD is the person's; the bell shape is Olumi's assumption, said; never "Nobody stated how uncertain".
    const said = linkDefaultAssumptionsOf(link).find((r) => r.code === 'CLAMP_STD_MINIMUM')!.reason;
    expect(said).toContain('the stated standard deviation, 10');
    expect(said).toContain('Olumi assumes a bell shape (Normal)');
    expect(said).not.toContain('Nobody stated how uncertain');
    // ⛔ Codex r1 #3606: an SD whose source is unconfirmed is never Olumi's; Olumi's own estimate says so.
    const sdSaid = (m: LivingModelT) => linkDefaultAssumptionsOf(edge(mapLivingModel(m).graph)!).find((r) => r.code === 'CLAMP_STD_MINIMUM')!.reason;
    const unconfirmed: LivingModelT = structuredClone(meanSd);
    unconfirmed.links[0] = { ...unconfirmed.links[0]!, source: 'unverified', quote: null };
    expect(sdSaid(unconfirmed)).toContain('the given (its source is not confirmed) standard deviation, 10');
    expect(sdSaid(unconfirmed)).not.toContain('Olumi\'s estimated');
    const olumis: LivingModelT = structuredClone(meanSd);
    olumis.links[0]!.effect.estimate_by = 'olumi';
    expect(sdSaid(olumis)).toContain('Olumi\'s estimated standard deviation, 10');
    // CONTRAST: the same point with no SD keeps Olumi's illustrative half-effect spread, and says so.
    meanSd.links[0]!.effect.sd = null;
    const bare = edge(mapLivingModel(meanSd).graph)!;
    expect(bare.strength.std).toBeCloseTo(0.2, 10);
    expect(linkDefaultAssumptionsOf(bare).find((r) => r.code === 'CLAMP_STD_MINIMUM')!.reason).toContain('Nobody stated how uncertain');
  });

  it('the stored graph keeps the living model through a GraphV3 re-parse (never stripped)', () => {
    const { graph } = mapLivingModel(KNOWN_ANSWER);
    const parsed = GraphV3.safeParse({ ...graph, living_model: KNOWN_ANSWER });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.living_model).toEqual(KNOWN_ANSWER);
    // Contrast: a key the schema does not declare is stripped, so the declaration is what keeps it.
    const stray = GraphV3.safeParse({ ...graph, not_declared: { a: 1 } });
    expect(stray.success && 'not_declared' in stray.data).toBe(false);
  });

  it('unknown is never 0: an unstated level, a change target and an unsized link are withheld or placeholder, each with its reason', () => {
    const model: LivingModelT = structuredClone(KNOWN_ANSWER);
    model.factors[0]!.value = null;
    model.links[0]!.effect = { estimate_by: null, form: 'direction_only', value: null, low: null, high: null, sd: null, unit: null, sign: '+' };
    const { graph, withheld } = mapLivingModel(model);
    expect(withheld).toContainEqual({ id: 'f', reason: 'factor_level_unknown' });
    expect(node(graph, 'f').observed_state).toBeUndefined();
    const link = graph.edges.find((e) => e.from === 'f' && e.to === 'g') as Record<string, any>;
    expect(link.provenance.magnitude).toBe('olumi_placeholder');

    const joint: LivingModelT = structuredClone(KNOWN_ANSWER);
    joint.aims.push({ ...structuredClone(KNOWN_ANSWER.aims[0]!), id: 'g2', text: 'Keep cost under 40' });
    expect(mapLivingModel(joint).withheld).toEqual([{ id: 'g2', reason: 'aim_not_in_slice' }]);

    const change: LivingModelT = structuredClone(KNOWN_ANSWER);
    change.aims[0]!.target = { ...change.aims[0]!.target!, comparator: 'increase', value: 30, current: null };
    expect(mapLivingModel(change).withheld, 'a change with no level today: never read from 0').toContainEqual({ id: 'g', reason: 'goal_level_unknown' });
  });

  it('DL 22 Oct (marketing on 68ca54f0-b): a count not yet started is 0 today by its own definition, so its threshold is carried; one that began earlier is asked', () => {
    const count: LivingModelT = structuredClone(KNOWN_ANSWER);
    count.aims[0] = { ...count.aims[0]!, text: 'Win 30 sign-ups', quote: 'win 30 sign-ups in the first six weeks after opening',
      target: { ...count.aims[0]!.target!, quantity: 'sign-ups', unit: 'sign-ups', value: 30, baseline: null, current: 0 } };
    count.links[0]!.effect = { ...count.links[0]!.effect, unit: 'sign-ups', value: 10, sd: 2 };
    const read = mapLivingModel(count);
    expect(read.withheld).toEqual([]);
    expect(node(read.graph, 'g')).toMatchObject({ goal_threshold: expect.any(Number), goal_threshold_raw: 30 });
    expect(readGoalRecord(read.graph, 'g')?.target, 'the licence reads the target').toMatchObject({ raw: 30, comparator: '>=' });
    // CONTRAST: a count that began earlier ("sign-ups this year") has no level today until the person gives it: held, so asked.
    const earlier = { ...count, aims: [{ ...count.aims[0]!, quote: 'win 30 sign-ups this year', target: { ...count.aims[0]!.target!, current: null } }] };
    expect(mapLivingModel(earlier).withheld).toContainEqual({ id: 'g', reason: 'goal_level_unknown' });
    const current = LivingAim.shape.target.unwrap().shape.current.description ?? '';
    expect(current).toContain('A count that has not started yet (sign-ups in the first six weeks after opening, orders next quarter) is 0 today by its own definition: set 0, '
      + 'say why in plain words on the change\'s public_label ("0 today: it counts from opening"), and never ask for it. A count that began earlier is not 0: ask for it.');
  });

  it('DL 22 Oct: an ordinary range uses Olumi\'s assumed law; an unknown sign is never drawn positive; a point\'s σ is |β|/2', () => {
    const edge = (g: { edges: Record<string, unknown>[] }) => g.edges.find((e) => e.from === 'f' && e.to === 'g') as Record<string, any> | undefined;
    const range: LivingModelT = structuredClone(KNOWN_ANSWER);
    range.links[0]!.effect = { estimate_by: null, form: 'range', value: null, low: 33.55, high: 66.45, sd: null, unit: 'units', sign: '+' };
    const r = mapLivingModel(range);
    expect(r.withheld).toEqual([]);
    expect(edge(r.graph)!.provenance.magnitude).toBe('olumi_estimate');

    // An effect in another unit than its target (another numerator, or another driver denominator) never sizes the link.
    for (const unit of ['parcels', 'units per machine']) {
      const other: LivingModelT = structuredClone(KNOWN_ANSWER);
      other.links[0]!.effect.unit = unit;
      const o = mapLivingModel(other);
      expect(o.withheld, unit).toContainEqual({ id: 'f_g', reason: 'link_unit_mismatch' });
      expect(edge(o.graph)!.provenance.magnitude, unit).toBe('olumi_placeholder');
    }
    expect(edge(mapLivingModel(KNOWN_ANSWER).graph)!.provenance.magnitude, 'contrast: the target\'s own unit sizes it').toBe('user_stated');

    const unsigned: LivingModelT = structuredClone(KNOWN_ANSWER);
    unsigned.links[0]!.effect.sign = null;
    const u = mapLivingModel(unsigned);
    expect(u.withheld).toContainEqual({ id: 'f_g', reason: 'link_sign_unknown' });
    expect(edge(u.graph)).toBeUndefined();

    const point: LivingModelT = structuredClone(KNOWN_ANSWER);
    point.links[0]!.effect = { estimate_by: null, form: 'point', value: 50, low: null, high: null, sd: null, unit: 'units', sign: '-' };
    const p = edge(mapLivingModel(point).graph)!;
    expect(p).toMatchObject({ effect_direction: 'negative', provenance: { magnitude: 'user_stated' } });
    expect(p.strength.mean).toBeCloseTo(-0.4, 10);
    expect(p.strength.std).toBeCloseTo(0.2, 10);
    // Buddy R1: Olumi's default spread reaches the person through the existing ledger (so the result stays illustrative). The
    // link's existence is the person's stated claim, not a default (Science, 21 Oct).
    expect(linkDefaultAssumptionsOf(p).map((r) => r.code)).toEqual(['CLAMP_STD_MINIMUM']);
  });

  it('Compare C1 21 Oct: an option\'s own sized effect is said per \'switch\', so the Run-input contract keeps its natural size (an edit can be named)', () => {
    const pointed: LivingModelT = structuredClone(OPTION_EFFECTS);
    for (const l of pointed.links) l.effect = { ...l.effect, form: 'point' };
    const { graph } = mapLivingModel(pointed);
    const ne = (from: string) => (graph.edges.find((e) => e.from === from && e.to === 'w') as Record<string, any>).provenance.natural_effect;
    expect(ne('a__on')).toMatchObject({ amount: 30, amount_unit: 'widgets per hour', per_source_change: 1, per_source_change_unit: 'switch' });
    const four = (n: Rec) => ({ amount: n.amount, amount_unit: n.amount_unit, per_source_change: n.per_source_change, per_source_change_unit: n.per_source_change_unit });
    expect(RunInputLinkSchema.shape.natural_effect.safeParse(four(ne('b__on'))).success).toBe(true);
    // CONTROL: a factor with its own unit keeps that unit, never 'switch'.
    const { graph: g2 } = mapLivingModel(KNOWN_ANSWER);
    expect((g2.edges.find((e) => e.from === 'f' && e.to === 'g') as Record<string, any>).provenance.natural_effect.per_source_change_unit).not.toBe('switch');
    // Codex #3556 R1: a person's own factor whose id merely LOOKS like a switch (`a__on`, option `a`, a level 0.5 → 1) is
    // not one: no switch was made, so its effect is never said "per switch".
    const look = JSON.parse(JSON.stringify(KNOWN_ANSWER).replaceAll('"push"', '"a"').replaceAll('"f"', '"a__on"').replaceAll('"f_g"', '"a__on_g"')) as LivingModelT;
    expect(LivingModel.safeParse(look).success).toBe(true);
    const lookEdge = mapLivingModel(look).graph.edges.find((e) => e.from === 'a__on' && e.to === 'g') as Record<string, any>;
    expect(lookEdge.provenance.natural_effect.per_source_change_unit).not.toBe('switch');
  });

  it('Codex #3556 R1: the re-run line says an option\'s own effect without "per 1 switch"; any other source keeps its "per"', () => {
    expect(effectEnd({ raw: 30, unit: 'orders a week', per: { amount: 1, unit: 'switch' } })).toBe('30 orders a week');
    expect(effectEnd({ raw: 49, unit: 'GBP', per: { amount: 1, unit: 'subscriber' } })).toBe('49 GBP per 1 subscriber');
  });

  it('Lenses 20 Oct (capacity): the person\'s own figure inside their range sizes the link as their point; the range is kept and said', () => {
    const edge = (g: { edges: Record<string, unknown>[] }) => g.edges.find((e) => e.from === 'f' && e.to === 'g') as Record<string, any>;
    const centred: LivingModelT = structuredClone(KNOWN_ANSWER);
    centred.links[0]!.effect = { estimate_by: null, form: 'range', value: 50, low: 30, high: 70, sd: null, unit: 'units', sign: '+' };
    const c = mapLivingModel(centred);
    expect(c.withheld.filter((w) => w.id === 'f_g')).toEqual([]);
    expect(edge(c.graph)).toMatchObject({ provenance: { magnitude: 'user_stated', natural_effect: { amount: 50, amount_unit: 'units' } } });
    expect(edge(c.graph).strength.mean).toBeCloseTo(0.4, 10);
    expect(edge(c.graph).strength.std).toBeCloseTo(0.2, 10);
    expect(linkDefaultAssumptionsOf(edge(c.graph)).find((r) => r.code === 'CLAMP_STD_MINIMUM')!.reason).toContain('30 to 70');
    // DL 22 Oct: no central figure uses Olumi's assumed law; a contradictory central figure stays held.
    for (const value of [null, 80, 30]) {
      const m: LivingModelT = structuredClone(centred);
      m.links[0]!.effect.value = value;
      const r = mapLivingModel(m);
      expect(r.withheld.filter(w => w.id === 'f_g'), String(value)).toEqual(value === null ? [] : [{ id: 'f_g', reason: 'link_range_no_law' }]);
      expect(edge(r.graph).provenance.magnitude, String(value)).toBe(value === null ? 'olumi_estimate' : 'olumi_placeholder');
    }
  });

  it('R1 20 Oct: the goal is always drawn; "exactly N" and an undeclared % change on a % quantity keep it with no threshold, so no chance', () => {
    for (const comparator of ['=', 'increase'] as const) {
      const m: LivingModelT = structuredClone(KNOWN_ANSWER);
      // "+3%" on a rate that is itself a percentage reads two ways (amendment 3): never picked.
      m.aims[0]!.target = { ...m.aims[0]!.target!, comparator, ...(comparator === 'increase' ? { value: 3, unit: '%', current_unit: '%', current: 12 } : {}) };
      const out = mapLivingModel(m);
      expect(out.withheld).toContainEqual({ id: 'g', reason: comparator === '=' ? 'exact_target_not_in_slice' : 'change_kind_unknown' });
      expect(node(out.graph, 'g')).toMatchObject({ kind: 'goal', label: 'Reach 100 units' });
      expect(node(out.graph, 'g')).not.toHaveProperty('goal_threshold');
      expect(node(out.graph, 'g')).not.toHaveProperty('goal_direction');
    }
  });

  it('R1 20 Oct: anything left out of the engine graph on the goal\'s path withholds the chance; off the path it does not', () => {
    const unsigned: LivingModelT = structuredClone(KNOWN_ANSWER);
    unsigned.links[0]!.effect.sign = null;
    const u = mapLivingModel(unsigned);
    expect(u.withheld).toContainEqual({ id: 'g', reason: 'chance_rests_on_withheld' });
    expect(node(u.graph, 'g')).not.toHaveProperty('goal_threshold');
    expect(node(u.graph, 'g').observed_state, 'the goal\'s level stays a fact').toMatchObject({ raw_value: 70 });

    const offPath: LivingModelT = structuredClone(KNOWN_ANSWER);
    offPath.factors.push({ id: 'h', label: 'h', kind: 'factor', estimate_by: null, value: 2, low: null, high: null, unit: null, defined_as: null, limit: null, source: 'user', party: null, quote: 'h is 2' });
    offPath.links.push({ id: 'f_h', from: 'f', to: 'h', source: 'olumi', party: null, quote: null,
      effect: { estimate_by: null, form: 'point', value: 1, low: null, high: null, sd: null, unit: null, sign: null } });
    const o = mapLivingModel(offPath);
    expect(o.withheld).toContainEqual({ id: 'f_h', reason: 'link_sign_unknown' });
    expect(node(o.graph, 'g')).toMatchObject({ goal_threshold: 0.8 });

    const setting: LivingModelT = structuredClone(KNOWN_ANSWER);
    setting.options[1]!.settings[0]!.unit = 'kg';
    setting.factors[0]!.unit = 'units';
    const st = mapLivingModel(setting);
    expect(st.withheld).toContainEqual({ id: 'push:f', reason: 'setting_not_convertible' });
    expect(st.withheld).toContainEqual({ id: 'g', reason: 'chance_rests_on_withheld' });
  });

  it('R1 6b148af5: the saved goal is kept when aims are reordered; a condition on its path withholds the chance', () => {
    const two: LivingModelT = structuredClone(KNOWN_ANSWER);
    two.aims.push({ ...structuredClone(KNOWN_ANSWER.aims[0]!), id: 'g2', text: 'Reach 200 units', target: { ...KNOWN_ANSWER.aims[0]!.target!, value: 200 } });
    two.links.push({ ...structuredClone(KNOWN_ANSWER.links[0]!), id: 'f_g2', to: 'g2' });
    const reversed: LivingModelT = { ...structuredClone(two), aims: [...structuredClone(two).aims].reverse() };
    const thresholdOn = (m: ReturnType<typeof mapLivingModel>) => m.graph.nodes.find((n) => n.goal_threshold !== undefined)?.id;
    expect(thresholdOn(mapLivingModel(reversed, { goal: 'g' }))).toBe('g');
    expect(thresholdOn(mapLivingModel(reversed)), 'CONTRAST: without the saved goal, order decides').toBe('g2');

    const conditioned: LivingModelT = structuredClone(KNOWN_ANSWER);
    conditioned.conditions.push({ text: 'The f→g effect requires supplier approval, which remains unresolved', applies_to: ['f_g'], role: 'prerequisite',
      source: 'user', party: null, quote: 'Supplier approval remains unresolved' });
    const c = mapLivingModel(conditioned);
    expect(c.withheld).toContainEqual({ id: 'g', reason: 'chance_rests_on_withheld' });
    expect(node(c.graph, 'g')).not.toHaveProperty('goal_threshold');
    const offPath: LivingModelT = structuredClone(KNOWN_ANSWER);
    offPath.conditions.push({ text: 'Only if the room is free', applies_to: ['elsewhere'], role: 'prerequisite', source: 'user', party: null, quote: null });
    expect(node(mapLivingModel(offPath).graph, 'g')).toMatchObject({ goal_threshold: 0.8 });
  });

  it("DL 22 Oct: Olumi's centred and bare link ranges stay Olumi's; a bare factor level stays held", () => {
    const edge = (g: { edges: Record<string, unknown>[] }) => g.edges.find((e) => e.from === 'f' && e.to === 'g') as Record<string, any>;
    const olumi: LivingModelT = structuredClone(KNOWN_ANSWER);
    olumi.factors[0] = { ...olumi.factors[0]!, value: 0.5, low: 0.3, high: 0.7, source: 'olumi', quote: null };
    olumi.links[0] = { ...olumi.links[0]!, source: 'olumi', quote: null, effect: { estimate_by: null, form: 'range', value: 50, low: 30, high: 70, sd: null, unit: 'units', sign: '+' } };
    const r = mapLivingModel(olumi);
    expect(r.withheld.filter((w) => w.id === 'f' || w.id === 'f_g')).toEqual([]);
    expect(node(r.graph, 'f').observed_state).toMatchObject({ raw_value: 0.5, source: 'cee_inference' });
    expect(edge(r.graph).provenance).toMatchObject({ source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: { amount: 50, amount_unit: 'units' } });
    const said = linkDefaultAssumptionsOf(edge(r.graph)).find((x) => x.code === 'CLAMP_STD_MINIMUM')!.reason;
    expect(said).toContain("Olumi's estimated 50");
    expect(said).toContain("Olumi's range, 30 to 70");
    expect(said).not.toContain('stated');
    // CONTROL: the link's range supplies its moments, but never invents a current level for the factor.
    const bare: LivingModelT = structuredClone(olumi);
    bare.factors[0]!.value = null;
    bare.links[0]!.effect.value = null;
    const b = mapLivingModel(bare);
    expect(b.withheld).toContainEqual({ id: 'f', reason: 'level_range_not_in_slice' });
    expect(edge(b.graph).provenance.magnitude).toBe('olumi_estimate');
  });

  it('attribution is a label: an unverified figure gets no stamp, Olumi\'s gets its own, a user\'s is the brief\'s', () => {
    const model: LivingModelT = structuredClone(KNOWN_ANSWER);
    model.factors[0]!.source = 'unverified';
    model.links[0]!.source = 'olumi';
    const { graph } = mapLivingModel(model);
    expect(node(graph, 'f').observed_state.source).toBeUndefined();
    const link = graph.edges.find((e) => e.from === 'f' && e.to === 'g') as Record<string, any>;
    expect(link.provenance).toMatchObject({ source: 'cee_hypothesis', magnitude: 'olumi_estimate' });
    expect(link.exists_probability).toBe(0.8);
  });

  it('an option\'s own exact effect on the goal is worked out exactly: goal = its level today + the option\'s change, nothing drawn', () => {
    const { graph, withheld } = mapLivingModel(OPTION_EFFECTS);
    const n = (id: string) => (graph.nodes as Rec[]).find((x) => x.id === id)!;
    expect(withheld.filter((w) => w.id !== 'options')).toEqual([]);
    expect(n('w')).toMatchObject({ goal_threshold_raw: 60, nonlinear_identity: { operation: 'sum', factor_ids: ['w_today', 'w__change'], stated_in_brief: false } });
    expect(n('w_today').observed_state).toEqual(n('w').observed_state);
    expect(n('w__change')).toMatchObject({ category: 'controllable', observed_state: { raw_value: 0, cap: n('w').goal_threshold_cap } });
    expect(n('a').interventions.w__change).toMatchObject({ raw_value: 30, source: 'brief_extraction' });
    expect(n('b').interventions.w__change).toMatchObject({ raw_value: 19.9 });
    for (const part of ['w_today', 'w__change']) {
      expect((graph.edges as Rec[]).find((e) => e.from === part && e.to === 'w')).toMatchObject({ strength: { mean: 1 }, exists_probability: 1, provenance: { definitional: true } });
    }
    expect((graph.edges as Rec[]).some((e) => (e.from === 'a' || e.from === 'b') && e.to === 'w'), 'no option→goal edge reaches the engine').toBe(false);
  });

  it('R2 P04: an exact change BELOW today is a part of the sum too, signed on the goal\'s cap (PLoT #454); nothing is drawn or withheld', () => {
    const lower: LivingModelT = structuredClone(OPTION_EFFECTS);
    lower.aims[0]!.target = { ...lower.aims[0]!.target!, comparator: '<=', value: 20 };
    lower.links = lower.links.map((l) => ({ ...l, effect: { ...l.effect, sign: '-' as const } }));
    const m = mapLivingModel(lower);
    const n = (id: string) => node(m.graph, id);
    expect(n('w')).toMatchObject({ goal_direction: '<=', goal_threshold_raw: 20, nonlinear_identity: { operation: 'sum', factor_ids: ['w_today', 'w__change'] } });
    const cap = n('w').goal_threshold_cap;
    expect(n('w__change')).toMatchObject({ quantity_frame: 'change', observed_state: { raw_value: 0, cap } });
    // 40 − 30 = 10 (meets ≤ 20) and 40 − 19.9 = 20.1 (falls short): each option's change is its own signed figure.
    expect(n('a').interventions.w__change).toMatchObject({ raw_value: -30 });
    expect(n('a').interventions.w__change.value).toBeCloseTo(-30 / cap, 12);
    expect(n('b').interventions.w__change).toMatchObject({ raw_value: -19.9 });
    expect(m.withheld).toEqual([]);
    expect(m.graph.edges.some((e) => String(e.from).endsWith('__on') && e.to === 'w'), 'no drawn option link reaches the goal').toBe(false);
    // CONTROL: the same exact changes upward still form the exact sum, positive.
    expect(node(mapLivingModel(OPTION_EFFECTS).graph, 'a').interventions.w__change).toMatchObject({ raw_value: 30 });
  });

  it('CONTROL: a stated but not exact effect, or a level today that is not the person\'s, is an on/off factor per option, sized like any link', () => {
    const about: LivingModelT = structuredClone(OPTION_EFFECTS);
    for (const l of about.links) l.effect.form = 'point';
    const { graph } = mapLivingModel(about);
    const n = (id: string) => (graph.nodes as Rec[]).find((x) => x.id === id)!;
    expect(n('w').nonlinear_identity).toBeUndefined();
    expect(n('a').interventions.a__on).toMatchObject({ value: 1 });
    const cap = n('w').goal_threshold_cap as number;
    const edge = (graph.edges as Rec[]).find((e) => e.from === 'a__on' && e.to === 'w')!;
    expect(edge.strength.mean).toBeCloseTo(30 / cap, 10);
    expect(edge.strength.std).toBeCloseTo(15 / cap, 10);
    const olumis: LivingModelT = structuredClone(OPTION_EFFECTS);
    olumis.aims[0] = { ...olumis.aims[0]!, source: 'olumi', quote: null };
    expect((mapLivingModel(olumis).graph.nodes as Rec[]).find((x) => x.id === 'w')!.nonlinear_identity).toBeUndefined();
  });

  it('R2 P01/P07 (46d30e6e): with no option at today\'s levels, every option is still emitted and nothing is reported withheld', () => {
    const m = mapLivingModel(OPTION_EFFECTS);
    const options = (m.graph.nodes as Rec[]).filter((n) => n.kind === 'option');
    expect(options.map((o) => o.id)).toEqual(['a', 'b']);
    expect(options.some((o) => o.is_baseline === true)).toBe(false);
    expect(m.withheld.filter((w) => w.id === 'options')).toEqual([]);
  });

  it('Paul 21 Oct (f46a14e3): an option\'s effect on a FACTOR reaches the engine through its switch, so the option drives that factor', () => {
    const viaFactor: LivingModelT = structuredClone(OPTION_EFFECTS);
    viaFactor.factors = [{ estimate_by: null, kind: 'factor', limit: null, id: 'k', label: 'Customer understanding', value: null, low: null, high: null, unit: null, defined_as: null, source: 'olumi', party: null, quote: null }];
    viaFactor.options.push({ id: 'c', label: 'Carry on as now', settings: [], status: 'feasible', developed_from: null, source: 'olumi', party: null, quote: null });
    viaFactor.links = [
      { id: 'a_k', from: 'a', to: 'k', source: 'olumi', party: null, quote: null, effect: { estimate_by: null, form: 'direction_only', value: null, sd: null, low: null, high: null, unit: null, sign: '+' } },
      { id: 'b_k', from: 'b', to: 'k', source: 'olumi', party: null, quote: null, effect: { estimate_by: null, form: 'direction_only', value: null, sd: null, low: null, high: null, unit: null, sign: '-' } },
      { id: 'k_w', from: 'k', to: 'w', source: 'olumi', party: null, quote: null, effect: { estimate_by: null, form: 'direction_only', value: null, sd: null, low: null, high: null, unit: null, sign: '+' } },
    ];
    const m = mapLivingModel(viaFactor);
    const n = (id: string) => (m.graph.nodes as Rec[]).find((x) => x.id === id)!;
    expect(n('a').interventions.a__on).toMatchObject({ value: 1 });
    expect(n('b').interventions.b__on).toMatchObject({ value: 1 });
    expect(n('c')).toMatchObject({ is_baseline: true, interventions: { a__on: { value: 0 }, b__on: { value: 0 } } });
    const edge = (from: string, to: string) => (m.graph.edges as Rec[]).find((e) => e.from === from && e.to === to);
    expect(edge('a__on', 'k')).toMatchObject({ effect_direction: 'positive' });
    expect(edge('b__on', 'k')).toMatchObject({ effect_direction: 'negative' });
    expect(edge('k', 'w')).toBeDefined();
    expect(m.withheld.filter((w) => w.reason === 'link_endpoint_unknown')).toEqual([]);
    expect(m.withheld.some((w) => w.id === 'options'), 'one status quo').toBe(false);
  });

  it('buddy R1 #3523: a prerequisite stated on an option\'s exact effect still withholds the chance after it is lowered to the sum', () => {
    const conditioned: LivingModelT = structuredClone(OPTION_EFFECTS);
    conditioned.conditions.push({ text: 'A adds this only after supplier approval', applies_to: ['a_w'], role: 'prerequisite', source: 'user', party: null, quote: 'only after supplier approval' });
    const c = mapLivingModel(conditioned);
    expect(c.withheld).toContainEqual({ id: 'w', reason: 'chance_rests_on_withheld' });
    expect((c.graph.nodes as Rec[]).find((n) => n.id === 'w')).not.toHaveProperty('goal_threshold');
    expect((mapLivingModel(OPTION_EFFECTS).graph.nodes as Rec[]).find((n) => n.id === 'w'), 'CONTRAST: unconditioned').toHaveProperty('goal_threshold');
  });

  it('AIE 17:59: an applied assumption carries a conditional chance and a challenge sits beside it; an unresolved prerequisite withholds; the source never decides', () => {
    const withCondition = (role: 'challenge' | 'assumption' | 'prerequisite', source: 'olumi' | 'user', on = ['f_g', 'g']): LivingModelT => {
      const m: LivingModelT = structuredClone(KNOWN_ANSWER);
      m.conditions.push({ text: 'Assuming the trial effect is fully realised by the end of the quarter', applies_to: on, role, source, party: null, quote: null });
      return m;
    };
    const goal = (m: LivingModelT) => (mapLivingModel(m).graph.nodes as Rec[]).find((n) => n.id === 'g');
    for (const s of ['olumi', 'user'] as const) {
      expect(goal(withCondition('assumption', s)), `assumption, ${s}`).toMatchObject({ goal_threshold: 0.8 });
      expect(goal(withCondition('challenge', s)), `challenge, ${s}`).toMatchObject({ goal_threshold: 0.8 });
      expect(goal(withCondition('prerequisite', s)), `prerequisite, ${s}`).not.toHaveProperty('goal_threshold');
    }
    // A prerequisite on an option reaches the goal through what the option sets.
    expect(goal(withCondition('prerequisite', 'user', ['push'])), 'prerequisite on an option').not.toHaveProperty('goal_threshold');
    expect(goal(withCondition('prerequisite', 'user', ['elsewhere'])), 'CONTROL: off the path').toMatchObject({ goal_threshold: 0.8 });
  });

  it('AIE 17:59 point 4: an exact effect on a drawn link keeps its content but its chance is withheld; the exact sum stays the exact route', () => {
    const m: LivingModelT = structuredClone(KNOWN_ANSWER);
    m.links[0]!.effect = { estimate_by: null, form: 'exact', value: 60, sd: null, low: null, high: null, unit: 'units', sign: '+' };
    const out = mapLivingModel(m);
    expect(out.withheld).toContainEqual({ id: 'f_g', reason: 'exact_not_drawable' });
    expect((out.graph.nodes as Rec[]).find((n) => n.id === 'g')).not.toHaveProperty('goal_threshold');
    expect(m.links[0]!.effect.value, 'the exact content is kept').toBe(60);
    expect((mapLivingModel(OPTION_EFFECTS).graph.nodes as Rec[]).find((n) => n.id === 'w'), 'CONTROL: the exact sum').toHaveProperty('goal_threshold');
  });

  it('a model saved before roles were declared reads each condition as a prerequisite (it withheld then, and still does)', () => {
    const saved = JSON.parse(JSON.stringify(KNOWN_ANSWER));
    saved.conditions = [{ text: 'Supplier approval', applies_to: ['f_g'], source: 'user', party: null, quote: null }];
    const parsed = LivingModel.parse(saved);
    expect(parsed.conditions[0]!.role).toBe('prerequisite');
    expect((mapLivingModel(parsed).graph.nodes as Rec[]).find((n) => n.id === 'g')).not.toHaveProperty('goal_threshold');
  });

  it('a change goal is read on today\'s level: absolute B + C, relative B × (1 + r), points on a percentage; never from an unknown or zero base', () => {
    const target = (t: Partial<NonNullable<LivingModelT['aims'][number]['target']>>) => {
      const m: LivingModelT = structuredClone(KNOWN_ANSWER);
      m.aims[0]!.target = { ...m.aims[0]!.target!, ...t };
      return mapLivingModel(m);
    };
    const goal = (out: ReturnType<typeof mapLivingModel>) => (out.graph.nodes as Rec[]).find((n) => n.id === 'g')!;
    // +30 units from 70 → at least 100: the known-answer control's own target, so the same graph.
    expect(goal(target({ comparator: 'increase', value: 30 }))).toMatchObject({ goal_direction: '>=', goal_threshold_raw: 100, goal_threshold: 0.8 });
    expect(goal(target({ comparator: 'increase', value: 30 })).observed_state).toMatchObject({ raw_value: 70 });
    // +10% of 70 → at least 77, read in units (the level's own unit), not in %.
    const rel = goal(target({ comparator: 'increase', value: 10, unit: '%', current_unit: 'units' }));
    expect(rel.goal_threshold_raw).toBeCloseTo(77, 10);
    expect(rel.goal_threshold_unit).toBe('units');
    // Cut by 20 units from 70 → no more than 50.
    expect(goal(target({ comparator: 'decrease', value: 20 }))).toMatchObject({ goal_direction: '<=', goal_threshold_raw: 50 });
    // +3 points on a 12% rate, declared → at least 15%.
    expect(goal(target({ comparator: 'increase', value: 3, unit: '%', current_unit: '%', current: 12, change_kind: 'points' }))).toMatchObject({ goal_threshold_raw: 15 });
    expect(target({ comparator: 'increase', value: 10, unit: '%', current_unit: 'units', current: 0 }).withheld).toContainEqual({ id: 'g', reason: 'change_base_invalid' });
    expect(target({ comparator: 'increase', value: 10, unit: 'hours', current_unit: 'units' }).withheld, 'a change in another unit').toContainEqual({ id: 'g', reason: 'change_kind_unknown' });
    // Buddy R1 on #3525: a declared unit is never dropped or relabelled.
    expect(target({ comparator: 'increase', value: 3, change_kind: 'points', unit: 'hours', current_unit: '%', current: 12 }).withheld, 'points in hours')
      .toContainEqual({ id: 'g', reason: 'change_kind_unknown' });
    expect(target({ comparator: '>=', value: 80, unit: '%', current_unit: 'seats', current: 40 }).withheld, 'a level target over today in another unit')
      .toContainEqual({ id: 'g', reason: 'current_unit_mismatch' });
    expect(goal(target({ comparator: '>=', value: 80, unit: '%', current_unit: 'seats', current: 40 }))).not.toHaveProperty('goal_threshold');
    expect(goal(target({ comparator: '>=', value: 100, current_unit: 'units' })), 'CONTROL: the same unit declared').toMatchObject({ goal_threshold_raw: 100 });
  });

  it('Science 21 Oct: a stated effect asserts its link exists (no Olumi default); Olumi\'s own link, or one stated under an assumption, keeps it', () => {
    const existenceDefaults = (m: LivingModelT) => {
      const e = mapLivingModel(m).graph.edges.find((x) => x.from === 'f' && x.to === 'g') as Record<string, any>;
      return linkDefaultAssumptionsOf(e).map((r) => r.code);
    };
    const withLink = (link: Partial<LivingModelT['links'][number]>, conditions: LivingModelT['conditions'] = []): LivingModelT => {
      const m: LivingModelT = structuredClone(KNOWN_ANSWER);
      m.links[0] = { ...m.links[0]!, ...link };
      m.conditions = conditions;
      return m;
    };
    expect(existenceDefaults(KNOWN_ANSWER)).toEqual([]);
    expect(existenceDefaults(withLink({ source: 'party', party: 'Sam' }))).toEqual([]);
    expect(existenceDefaults(withLink({ source: 'olumi', quote: null }))).toEqual(['DEFAULT_EXISTS_PROBABILITY']);
    const on = (role: 'assumption' | 'challenge') => [{ text: 'if the trial effect holds at scale', applies_to: ['f_g'], role, source: 'user' as const, party: null, quote: null }];
    expect(existenceDefaults(withLink({}, on('assumption')))).toEqual(['DEFAULT_EXISTS_PROBABILITY']);
    // A challenge is said beside the result and never changes the calculation or its labels.
    expect(existenceDefaults(withLink({}, on('challenge')))).toEqual([]);
  });

  it('KA1 21 Oct: the person\'s own option setting is attested as theirs, so the chance never says "could not confirm where some figures came from"', () => {
    const census = (m: LivingModelT) => goalChanceEstimateCounts(mapLivingModel(m).graph, ['push', 'hold'], 'g');
    expect(node(mapLivingModel(KNOWN_ANSWER).graph, 'push').interventions.f).toMatchObject({ source: 'brief_extraction', extractionType: 'explicit' });
    expect(census(KNOWN_ANSWER)).toMatchObject({ unverifiedSettingsByOption: {}, unverifiedValues: 0, unverifiedLinks: 0, unread: false });
    // CONTROLS: Olumi's setting is Olumi's estimate (never attested), and an unverified one stays unverified.
    const whose = (source: 'olumi' | 'unverified') => {
      const m: LivingModelT = structuredClone(KNOWN_ANSWER);
      m.options[1]!.settings[0] = { ...m.options[1]!.settings[0]!, source, quote: null };
      return m;
    };
    expect(node(mapLivingModel(whose('olumi')).graph, 'push').interventions.f).not.toHaveProperty('extractionType');
    expect(census(whose('unverified')).unverifiedSettingsByOption).toEqual({ push: 1 });
  });

  it('⭐ RED→GREEN (Lenses read-only A/B, 21 Oct): each setting carries the intervention contract\'s own word for its author, never "Source not recorded"', () => {
    const setting = (patch: Partial<LivingModelT['options'][number]['settings'][number]>) => {
      const m: LivingModelT = structuredClone(KNOWN_ANSWER);
      m.options[1]!.settings[0] = { ...m.options[1]!.settings[0]!, ...patch };
      return node(mapLivingModel(m).graph, 'push').interventions.f as Rec;
    };
    // The UI reads these words only (DGAI valueProvenance INTERVENTION_SOURCE_CLASSES), and so does the contract.
    const cases: readonly [Partial<LivingModelT['options'][number]['settings'][number]>, string][] = [
      [{}, 'brief_extraction'],
      [{ quote: null }, 'user_specified'],
      [{ source: 'olumi', quote: null }, 'cee_hypothesis'],
      [{ estimate_by: 'olumi' }, 'cee_hypothesis'],
    ];
    for (const [patch, word] of cases) {
      const cell = setting(patch);
      expect(cell.source, JSON.stringify(patch)).toBe(word);
      expect(InterventionV3.safeParse(cell).success, JSON.stringify(patch)).toBe(true);
    }
    // CONTROL: an unconfirmed source stays unknown, never given a word.
    expect(setting({ source: 'unverified', quote: null })).not.toHaveProperty('source');
  });

  it('a model saved before change goals reads the new target fields as null', () => {
    const saved = JSON.parse(JSON.stringify(KNOWN_ANSWER));
    delete saved.aims[0].target.current_unit;
    delete saved.aims[0].target.change_kind;
    expect(LivingModel.parse(saved).aims[0]!.target).toMatchObject({ current_unit: null, change_kind: null, source: null });
  });

  it('science check 5bbceeec, point 6: a ceiling below today keeps today on its frame; Olumi\'s base is not used for a change; the from-today premise is said', () => {
    const target = (t: Partial<NonNullable<LivingModelT['aims'][number]['target']>>, aim: Partial<LivingModelT['aims'][number]> = {}) => {
      const m: LivingModelT = structuredClone(KNOWN_ANSWER);
      m.aims[0] = { ...m.aims[0]!, ...aim, target: { ...m.aims[0]!.target!, ...t } };
      return mapLivingModel(m);
    };
    const goal = (out: ReturnType<typeof mapLivingModel>) => (out.graph.nodes as Rec[]).find((n) => n.id === 'g')!;
    // Cut by 20 from 70 → no more than 50, with today (70) admitted on the goal's level frame.
    const cut = target({ comparator: 'decrease', value: 20 });
    expect(goal(cut)).toMatchObject({ goal_threshold_raw: 50, goal_threshold_cap_provenance: 'level_frame', observed_state: { raw_value: 70 } });
    expect(cut.withheld.filter((w) => w.id === 'g')).toEqual([]);
    expect(cut.assumed).toEqual([{ id: 'g', text: "Carrying on as now leaves units at today's 70 units; the change is measured from that." }]);
    // A level ceiling below today (no more than 60, today 180): the same frame keeps today on its scale.
    expect(goal(target({ comparator: '<=', value: 60, current: 180 }))).toMatchObject({ goal_threshold_raw: 60, observed_state: { raw_value: 180 } });
    // A change on Olumi's base: withheld, never computed as a plain level target.
    const olumis = target({ comparator: 'increase', value: 10, unit: '%', current_unit: 'units' }, { source: 'olumi', quote: null });
    expect(olumis.withheld).toContainEqual({ id: 'g', reason: 'change_base_not_theirs' });
    expect(goal(olumis)).not.toHaveProperty('goal_threshold');
    // CONTROL: a level target says no from-today premise.
    expect(mapLivingModel(KNOWN_ANSWER).assumed).toEqual([]);
  });

  it('Science 21 Oct, "stay within": a level that already meets its floor or ceiling is a goal, on their own level and words, scored at the end', () => {
    const target = (t: Partial<NonNullable<LivingModelT['aims'][number]['target']>>, aim: Partial<LivingModelT['aims'][number]> = {}) => {
      const m: LivingModelT = structuredClone(KNOWN_ANSWER);
      m.aims[0] = { ...m.aims[0]!, ...aim, target: { ...m.aims[0]!.target!, ...t } };
      return mapLivingModel(m);
    };
    const goal = (out: ReturnType<typeof mapLivingModel>) => (out.graph.nodes as Rec[]).find((n) => n.id === 'g')!;
    // A floor today already clears ("keep … at or above 50", today 70): admitted, with the end-of-horizon reading said beside it.
    const floor = target({ comparator: '>=', value: 50, by_when: 'next quarter' }, { quote: 'keep units at or above 50; today we are at 70' });
    expect(floor.withheld.filter((w) => w.id === 'g')).toEqual([]);
    expect(goal(floor)).toMatchObject({ goal_direction: '>=', goal_threshold_raw: 50, observed_state: { raw_value: 70 } });
    expect(floor.assumed).toEqual([{ id: 'g', text: 'Keep units at or above 50 units (today 70 units). The chance is for its level at the end of next quarter, not along the way.' }]);
    // Money is said as the person writes it (Track 2, F2 on 27bdb81c read "12000 £ (today 16000 £)"): one figure rule.
    expect(target({ comparator: '>=', value: 12000, current: 16000, unit: '£' }, { quote: 'keep monthly profit at least £12,000; today £16,000' }).assumed.map((a) => a.text))
      .toEqual(['Keep units at or above £12,000 (today £16,000). The chance is for its level at the end of the period, not along the way.']);
    // A horizon already said as an end ("the end of the quarter") is not doubled (Track 3, KA2 on 50ecd29a).
    for (const by_when of ['the end of the quarter', 'end of the quarter', 'by the end of the quarter']) {
      expect(target({ comparator: '>=', value: 50, by_when }, { quote: 'keep units at or above 50; today we are at 70' }).assumed[0]!.text, by_when)
        .toBe('Keep units at or above 50 units (today 70 units). The chance is for its level at the end of the quarter, not along the way.');
    }
    // A ceiling today already sits under ("at most 90", today 70): the same, read as a ceiling.
    const ceiling = target({ comparator: '<=', value: 90 }, { quote: 'at most 90 units; today we are at 70' });
    expect(goal(ceiling)).toMatchObject({ goal_direction: '<=', goal_threshold_raw: 90, observed_state: { raw_value: 70 } });
    expect(ceiling.assumed.map((a) => a.text)).toEqual(['Keep units at or below 90 units (today 70 units). The chance is for its level at the end of the period, not along the way.']);
    // Olumi's estimate of today is asked for, never used (condition 1); the person's own canvas edit of today is theirs.
    const olumis = target({ comparator: '>=', value: 50 }, { source: 'olumi', quote: null });
    expect(olumis.withheld).toContainEqual({ id: 'g', reason: 'stay_within_base_not_theirs' });
    expect(goal(olumis)).not.toHaveProperty('observed_state');
    expect(target({ comparator: '>=', value: 50, current_source: 'user' }, { source: 'olumi', quote: null }).withheld.filter((w) => w.id === 'g'))
      .toContainEqual({ id: 'g', reason: 'stay_within_unconfirmed' });
    // No cue in their words → Olumi asks once; a cue for the other direction is no cue (the comparator may be misread).
    for (const quote of ['units should be 50 or more; today we are at 70', 'at most 50 units; today we are at 70']) {
      const asked = target({ comparator: '>=', value: 50 }, { quote });
      expect(asked.withheld, quote).toContainEqual({ id: 'g', reason: 'stay_within_unconfirmed' });
      expect(asked.assumed, quote).toEqual([]);
    }
    // Today exactly at the floor already meets it (codex #3540 R1): the same conditions, never a silent admission.
    expect(target({ comparator: '>=', value: 70 }, { quote: 'reach 70 units; today 70' }).withheld).toContainEqual({ id: 'g', reason: 'stay_within_unconfirmed' });
    expect(target({ comparator: '>=', value: 70 }, { quote: 'keep units at least 70; today 70' }).assumed.map((a) => a.text))
      .toEqual(['Keep units at or above 70 units (today 70 units). The chance is for its level at the end of the period, not along the way.']);
    // CONTROLS: a ceiling below today and a floor above today are ordinary reach goals, unchanged.
    for (const [t, quote] of [[{ comparator: '<=', value: 60, current: 180 }, 'no more than 60 units; today 180'], [{ comparator: '>=', value: 100 }, 'we need at least 100 units; today we are at 70']] as const) {
      const out = target(t, { quote });
      expect(out.withheld.filter((w) => w.id === 'g'), quote).toEqual([]);
      expect(out.assumed, quote).toEqual([]);
    }
  });
});

describe('per-figure authorship (estimate_by, 21 Oct): Olumi\'s estimate of a wholly missing figure on another\'s item', () => {
  it('INVARIANCE FIRST: estimate_by null on every figure maps to the same engine graph as a model saved before the field', () => {
    const before = structuredClone(KNOWN_ANSWER) as any;
    for (const f of before.factors) delete f.estimate_by;
    for (const l of before.links) delete l.effect.estimate_by;
    for (const o of before.options) for (const s of o.settings) delete s.estimate_by;
    const withField = structuredClone(KNOWN_ANSWER) as any;
    for (const f of withField.factors) f.estimate_by = null;
    for (const l of withField.links) l.effect.estimate_by = null;
    for (const o of withField.options) for (const s of o.settings) s.estimate_by = null;
    const a = mapLivingModel(before as LivingModelT); const b = mapLivingModel(withField as LivingModelT);
    expect(JSON.stringify({ n: b.graph.nodes, e: b.graph.edges, w: b.withheld })).toBe(JSON.stringify({ n: a.graph.nodes, e: a.graph.edges, w: a.withheld }));
  });

  it("the person's factor and link keep their source; only the figure Olumi estimated reads as Olumi's (cee_inference / olumi_estimate)", () => {
    const m: LivingModelT = structuredClone(KNOWN_ANSWER);
    m.factors[0] = { ...m.factors[0]!, value: 0.5, low: 0.3, high: 0.7, estimate_by: 'olumi' };
    m.links[0] = { ...m.links[0]!, effect: { form: 'range', value: 50, low: 30, high: 70, sd: null, unit: 'units', sign: '+', estimate_by: 'olumi' } };
    const r = mapLivingModel(m);
    expect(m.factors[0]!.source).toBe('user');
    expect(node(r.graph, 'f').observed_state).toMatchObject({ raw_value: 0.5, source: 'cee_inference' });
    const edge = r.graph.edges.find((e) => e.from === 'f' && e.to === 'g') as Record<string, any>;
    expect(edge.provenance).toMatchObject({ source: 'cee_hypothesis', magnitude: 'olumi_estimate' });
    expect(edge.exists_probability, "the link's existence stays the person's claim").toBe(1);
    // CONTRAST: the same figures with no estimate_by are the person's own.
    const theirs = mapLivingModel(structuredClone({ ...m, factors: [{ ...m.factors[0]!, estimate_by: null }],
      links: [{ ...m.links[0]!, effect: { ...m.links[0]!.effect, estimate_by: null } }] }));
    expect(node(theirs.graph, 'f').observed_state.source).toBe('brief_extraction');
    expect((theirs.graph.edges.find((e) => e.from === 'f') as Record<string, any>).provenance.magnitude).toBe('user_stated');
  });
});
