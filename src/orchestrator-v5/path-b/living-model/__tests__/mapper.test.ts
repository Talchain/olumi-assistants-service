import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { mapLivingModel } from '../mapper.js';
import { linkDefaultAssumptionsOf } from '../../../../cee/magnitude/link-default-assumptions.js';
import { KNOWN_ANSWER, OPTION_EFFECTS } from './fixtures.js';

type Rec = Record<string, any>;

const node = (g: { nodes: Record<string, unknown>[] }, id: string) => g.nodes.find((n) => n.id === id) as Record<string, any>;
/** Standard normal CDF (Abramowitz–Stegun 7.1.26), enough for a 1e-4 check. */
function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

describe('thin core mapper: living model → GraphV3', () => {
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
    // The stated law's spread is the person's; only the existence assumption is Olumi's, and the existing reader says so.
    expect(linkDefaultAssumptionsOf(link).map((r) => r.code)).toEqual(['DEFAULT_EXISTS_PROBABILITY']);
    // A linear Gaussian reading of the mapped graph reproduces the control's answers.
    const meetChance = (fTo: number) => {
      const mean = goal.observed_state.baseline + (fTo - 0.5) * link.strength.mean;
      const sd = Math.abs(fTo - 0.5) * link.strength.std;
      return sd === 0 ? (mean >= goal.goal_threshold ? 1 : 0) : 1 - phi((goal.goal_threshold - mean) / sd);
    };
    expect(meetChance(node(graph, 'push').interventions.f.value)).toBeCloseTo(0.1587, 3);
    expect(meetChance(node(graph, 'hold').interventions.f.value)).toBe(0);
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
    model.links[0]!.effect = { form: 'direction_only', value: null, low: null, high: null, sd: null, unit: null, sign: '+' };
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

  it('AIE 20 Oct: an ordinary range is kept but not read as a law; an unknown sign is never drawn positive; a point\'s σ is |β|/2', () => {
    const edge = (g: { edges: Record<string, unknown>[] }) => g.edges.find((e) => e.from === 'f' && e.to === 'g') as Record<string, any> | undefined;
    const range: LivingModelT = structuredClone(KNOWN_ANSWER);
    range.links[0]!.effect = { form: 'range', value: null, low: 33.55, high: 66.45, sd: null, unit: 'units', sign: '+' };
    const r = mapLivingModel(range);
    expect(r.withheld).toContainEqual({ id: 'f_g', reason: 'link_range_no_law' });
    expect(edge(r.graph)!.provenance.magnitude).toBe('olumi_placeholder');

    const unsigned: LivingModelT = structuredClone(KNOWN_ANSWER);
    unsigned.links[0]!.effect.sign = null;
    const u = mapLivingModel(unsigned);
    expect(u.withheld).toContainEqual({ id: 'f_g', reason: 'link_sign_unknown' });
    expect(edge(u.graph)).toBeUndefined();

    const point: LivingModelT = structuredClone(KNOWN_ANSWER);
    point.links[0]!.effect = { form: 'point', value: 50, low: null, high: null, sd: null, unit: 'units', sign: '-' };
    const p = edge(mapLivingModel(point).graph)!;
    expect(p).toMatchObject({ effect_direction: 'negative', provenance: { magnitude: 'user_stated' } });
    expect(p.strength.mean).toBeCloseTo(-0.4, 10);
    expect(p.strength.std).toBeCloseTo(0.2, 10);
    // Buddy R1: the default spread and the existence assumption reach the person through the existing ledger.
    expect(linkDefaultAssumptionsOf(p).map((r) => r.code)).toEqual(['CLAMP_STD_MINIMUM', 'DEFAULT_EXISTS_PROBABILITY']);
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
    offPath.factors.push({ id: 'h', label: 'h', value: 2, low: null, high: null, unit: null, source: 'user', party: null, quote: 'h is 2' });
    offPath.links.push({ id: 'f_h', from: 'f', to: 'h', source: 'olumi', party: null, quote: null,
      effect: { form: 'point', value: 1, low: null, high: null, sd: null, unit: null, sign: null } });
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

  it('CONTROL: a stated but not exact effect, or a level today that is not the person\'s, is an on/off factor per option, sized like any link', () => {
    const about: LivingModelT = structuredClone(OPTION_EFFECTS);
    about.links[0]!.effect.form = 'point';
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

  it('buddy R1 #3523: a prerequisite stated on an option\'s exact effect still withholds the chance after it is lowered to the sum', () => {
    const conditioned: LivingModelT = structuredClone(OPTION_EFFECTS);
    conditioned.conditions.push({ text: 'A adds this only after supplier approval', applies_to: ['a_w'], role: 'prerequisite', source: 'user', party: null, quote: 'only after supplier approval' });
    const c = mapLivingModel(conditioned);
    expect(c.withheld).toContainEqual({ id: 'w', reason: 'chance_rests_on_withheld' });
    expect((c.graph.nodes as Rec[]).find((n) => n.id === 'w')).not.toHaveProperty('goal_threshold');
    expect((mapLivingModel(OPTION_EFFECTS).graph.nodes as Rec[]).find((n) => n.id === 'w'), 'CONTRAST: unconditioned').toHaveProperty('goal_threshold');
  });

  it('served KA1 3254d202: an assumption on the path is said beside the chance; a prerequisite withholds it; the source never decides', () => {
    const withCondition = (role: 'assumption' | 'prerequisite', source: 'olumi' | 'user'): LivingModelT => {
      const m: LivingModelT = structuredClone(KNOWN_ANSWER);
      m.conditions.push({ text: 'Assuming the full effect arrives by the deadline', applies_to: ['f_g', 'g'], role, source, party: null, quote: null });
      return m;
    };
    const goal = (m: LivingModelT) => (mapLivingModel(m).graph.nodes as Rec[]).find((n) => n.id === 'g');
    for (const s of ['olumi', 'user'] as const) {
      expect(goal(withCondition('assumption', s)), `assumption, ${s}`).toMatchObject({ goal_threshold: 0.8 });
      expect(goal(withCondition('prerequisite', s)), `prerequisite, ${s}`).not.toHaveProperty('goal_threshold');
    }
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
  });

  it('a model saved before change goals reads the new target fields as null', () => {
    const saved = JSON.parse(JSON.stringify(KNOWN_ANSWER));
    delete saved.aims[0].target.current_unit;
    delete saved.aims[0].target.change_kind;
    expect(LivingModel.parse(saved).aims[0]!.target).toMatchObject({ current_unit: null, change_kind: null });
  });
});
