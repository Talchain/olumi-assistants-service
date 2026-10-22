/**
 * ONE ITEM THE ENGINE CANNOT TAKE NEVER REFUSES THE WHOLE RUN (DL 22 Oct). Three served refusals, each fixed where the
 * meaning was lost; SYNTHETIC wording, the real mapper and readiness:
 *  · MISSING_FACTOR_LEVEL (test agent's Q1 run): a factor with no level that nothing leads into and no option sets, linked
 *    into the goal's path, refused every option. Its node stays on the canvas (named, no level, never 0); its links are held.
 *  · OPTION_NO_FACTOR_EDGES (Lenses' 591b918e): two options read as "at today's levels", so none was the status quo and
 *    "keep things as they are" went out with no edges. The one that sets nothing is the status quo.
 *  · IDENTITY_FRAME_MISSING (Lenses' 591b918e): a stated defined quantity with no level had no frame. It is framed by its
 *    parts (`scale_frame`, the most they can make), never given a level.
 */
import { describe, expect, it } from 'vitest';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { assessCanonicalAnalysisReadiness } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import { mapLivingModel } from '../mapper.js';
import { applyExplicitEdit } from '../edit.js';
import { KNOWN_ANSWER } from './fixtures.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';

type Rec = Record<string, any>;
const bare = (id: string, label: string): LivingModelT['factors'][number] =>
  ({ id, label, kind: 'factor', estimate_by: null, value: null, low: null, high: null, unit: null, defined_as: null, limit: null,
    source: 'user', party: null, quote: `${label} is a worry` });
const unsized = (id: string, from: string, to: string): LivingModelT['links'][number] =>
  ({ id, from, to, source: 'user', party: null, quote: `${from} affects ${to}`,
    effect: { estimate_by: null, form: 'direction_only', value: null, sd: null, low: null, high: null, unit: null, sign: '-' } });
/** KNOWN_ANSWER (goal g, factor f at 0.5, push sets f to 1) plus "z", unmeasured, leading into f. */
const withUnmeasured = (): LivingModelT => {
  const m = structuredClone(KNOWN_ANSWER);
  m.factors.push(bare('z', 'Local hiring difficulty'));
  m.links.push(unsized('z_f', 'z', 'f'));
  return m;
};
const readiness = (m: LivingModelT) => {
  const mapped = mapLivingModel(m);
  return { mapped, ready: assessCanonicalAnalysisReadiness({ ...mapped.graph, living_model: m }) };
};
const levelGaps = (r: ReturnType<typeof assessCanonicalAnalysisReadiness>) =>
  r.blockingIssues.filter((i) => i.code === 'MISSING_FACTOR_LEVEL').map((i) => i.factor_id);

describe('a factor with no level, that nothing leads into and nothing else uses, keeps its node and has its links held', () => {
  it('its node stays on the canvas with no level, its link is held and named, and the Run is no longer refused for it', () => {
    const { mapped, ready } = readiness(withUnmeasured());
    const z = (mapped.graph.nodes as Rec[]).find((n) => n.id === 'z');
    expect(z, 'kept on the canvas, set aside from the calculation').toMatchObject({ kind: 'factor', label: 'Local hiring difficulty', analysis_participation: 'retained_excluded' });
    expect(z!.observed_state, 'no level, so never read as 0').toBeUndefined();
    expect((mapped.graph.edges as Rec[]).some((e) => e.from === 'z' || e.to === 'z')).toBe(false);
    expect(mapped.withheld).toEqual(expect.arrayContaining([{ id: 'z', reason: 'factor_level_unknown' }, { id: 'z_f', reason: 'link_endpoint_unknown' }]));
    expect(levelGaps(ready)).toEqual([]);
    expect(ready.blockingIssues.map((i) => i.code), 'neither a level gap nor an orphan: the Run is not refused').toEqual([]);
    // What it would have fed is still said: the goal's chance rests on a link left out, so it is withheld, never a guess.
    expect(mapped.withheld).toContainEqual({ id: 'g', reason: 'chance_rests_on_withheld' });
  });

  it('CONTROL: the same model with z given a level today sends z and its link, and nothing is held for it', () => {
    const m = withUnmeasured();
    m.factors[1] = { ...m.factors[1]!, value: 3, unit: 'vacancies' };
    const { mapped } = readiness(m);
    expect((mapped.graph.nodes as Rec[]).find((n) => n.id === 'z')).toMatchObject({ observed_state: { raw_value: 3 } });
    expect(mapped.withheld.filter((w) => w.id === 'z' || w.id === 'z_f')).toEqual([]);
  });

  it('CONTRAST: an unmeasured factor an option sets, or one something leads into, still sends its links as before', () => {
    const set = withUnmeasured();
    set.options = set.options.map((o) => (o.id === 'push' ? { ...o, settings: [...o.settings,
      { factor_id: 'z', estimate_by: null, value: 2, low: null, high: null, unit: null, source: 'user' as const, party: null, quote: 'push f to 1' }] } : o));
    const linkSent = (m: LivingModelT) => (readiness(m).mapped.graph.edges as Rec[]).some((e) => e.from === 'z' && e.to === 'f');
    expect(linkSent(set), 'an option sets it: its link is still sent').toBe(true);
    const fed = withUnmeasured();
    fed.factors.push({ ...bare('y', 'Regional labour supply'), value: 4, unit: 'people' });
    fed.links.push(unsized('y_z', 'y', 'z'));
    expect(linkSent(fed), 'something leads into it: its link is still sent').toBe(true);
  });
});

describe('the status quo needs no setting', () => {
  /** KNOWN_ANSWER plus "trial", which sets f to its level today (0.5): two options now read as at today's levels. */
  const withTrial = (): LivingModelT => {
    const m = structuredClone(KNOWN_ANSWER);
    m.options.push({ status: 'feasible', id: 'trial', label: 'Trial', developed_from: null, source: 'user', party: null, quote: 'or a trial',
      settings: [{ estimate_by: null, factor_id: 'f', value: 0.5, low: null, high: null, unit: null, source: 'user', party: null, quote: 'f is at 0.5' }] });
    return m;
  };
  it('the option that sets nothing is the status quo, so it is sent with today\'s levels and the Run is not refused', () => {
    const { mapped, ready } = readiness(withTrial());
    const nodes = mapped.graph.nodes as Rec[];
    expect(nodes.find((n) => n.id === 'hold')).toMatchObject({ is_baseline: true, interventions: { f: { raw_value: 0.5 } } });
    expect(nodes.find((n) => n.id === 'trial')!.is_baseline).toBeUndefined();
    expect((mapped.graph.edges as Rec[]).some((e) => e.from === 'hold' && e.to === 'f')).toBe(true);
    expect(ready.blockingIssues.map((i) => i.code)).not.toContain('OPTION_NO_FACTOR_EDGES');
  });
  it('Lenses\' repro (served 2609dd6a, the real canvas door dispatch.ts uses): an edit putting f at push\'s own level keeps the status quo\'s settings and edges', () => {
    const edited = applyExplicitEdit(KNOWN_ANSWER, { kind: 'factor_value_edit', target_id: 'f', value: 1, raw_value: 1, field: 'value' } as never, 'g');
    expect('model' in edited, JSON.stringify(edited)).toBe(true);
    const model = (edited as { model: LivingModelT }).model;
    expect(model.factors.find((f) => f.id === 'f'), 'the person\'s edit is saved').toMatchObject({ value: 1, source: 'user' });
    const g = mapLivingModel(model, { goal: 'g' }).graph;
    const nodes = g.nodes as Rec[];
    expect(nodes.find((n) => n.id === 'hold')).toMatchObject({ is_baseline: true, interventions: { f: { raw_value: 1 } } });
    expect((g.edges as Rec[]).some((e) => e.from === 'hold' && e.to === 'f')).toBe(true);
    expect(nodes.find((n) => n.id === 'push')).toMatchObject({ interventions: { f: { raw_value: 1 } } });
    // CONTRAST (green before and after): an edit to 0.7 leaves one option at today's level, the status quo at 0.7.
    const other = applyExplicitEdit(KNOWN_ANSWER, { kind: 'factor_value_edit', target_id: 'f', value: 0.7, raw_value: 0.7, field: 'value' } as never, 'g') as { model: LivingModelT };
    expect((mapLivingModel(other.model, { goal: 'g' }).graph.nodes as Rec[]).find((n) => n.id === 'hold'))
      .toMatchObject({ is_baseline: true, interventions: { f: { raw_value: 0.7 } } });
  });
  it('CONTRAST: two options that set nothing still name no status quo (the rule never guesses between them)', () => {
    const m = withTrial();
    m.options.push({ status: 'feasible', id: 'wait', label: 'Wait', settings: [], developed_from: null, source: 'user', party: null, quote: 'or we wait' });
    expect((readiness(m).mapped.graph.nodes as Rec[]).some((n) => n.is_baseline === true)).toBe(false);
  });
});

describe('a stated defined quantity with no level is framed by its parts, never given a level', () => {
  const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
  const level = (id: string, value: number | null, unit: string, defined_as: LivingModelT['factors'][number]['defined_as'] = null): LivingModelT['factors'][number] =>
    ({ id, label: id, kind: 'factor', estimate_by: null, value, low: null, high: null, unit, defined_as, limit: null, ...who(`${id} is ${value}`) });
  const exact = (id: string, from: string, value: number): LivingModelT['links'][number] =>
    ({ id, from, to: 'net', ...who(`${from} counts ${value > 0 ? 'towards' : 'against'} net`),
      effect: { estimate_by: null, form: 'exact', value, sd: null, low: null, high: null, unit: '£ per week', sign: value > 0 ? '+' : '-' } });
  const model = (revenueLevel: number | null = null): LivingModelT => ({
    aims: [{ id: 'net', text: 'Net above £1,500 a week', status: 'current', defined_as: null, ...who('net above 1500 a week; it is 1200 now'),
      target: { quantity: 'net', comparator: '>=', value: 1500, low: null, high: null, unit: '£ per week', by_when: null, period_months: null, period_by: null, period_read_on: null, baseline: 'today',
        current: 1200, current_source: null, current_unit: null, change_kind: null, source: null } }],
    options: [
      { status: 'feasible', id: 'keep', label: 'Keep', settings: [], developed_from: null, ...who('or keep') },
      { status: 'feasible', id: 'raise', label: 'Raise', developed_from: null, ...who('raise the price to 13'),
        settings: [{ estimate_by: null, factor_id: 'unit_price', value: 13, low: null, high: null, unit: '£ per item', ...who('raise the price to 13') }] },
    ],
    factors: [level('items', 100, 'items per week'), level('unit_price', 12, '£ per item'), level('costs', 1000, '£ per week'),
      level('revenue', revenueLevel, '£ per week', { op: 'product', of: ['items', 'unit_price'], ...who('revenue is items times unit price') })],
    links: [exact('revenue_net', 'revenue', 1), exact('costs_net', 'costs', -1)],
    risks: [], conditions: [], views: [], history: [],
  });
  it('it is framed as it would be with its level stated (on the goal\'s frame here), carried as scale_frame; no level is sent; the Run is not refused', () => {
    const { mapped, ready } = readiness(model());
    const nodes = mapped.graph.nodes as Rec[];
    const revenue = nodes.find((n) => n.id === 'revenue')!;
    expect(revenue).toMatchObject({ nonlinear_identity: { operation: 'product', factor_ids: ['items', 'unit_price'] } });
    // The same frame as the stated-level CONTRAST below: the levels its parts make (1,200 today, 1,300 raised) sit on the goal's frame.
    expect(revenue.scale_frame).toBe(((readiness(model(1200)).mapped.graph.nodes as Rec[]).find((n) => n.id === 'revenue')!.observed_state as Rec).cap);
    // Codex on #3664: the link of 1 into the goal reaches the engine as 1, never above it (PLoT clamps a coefficient above 1).
    expect((mapped.graph.edges as Rec[]).find((e) => e.from === 'revenue' && e.to === 'net')!.strength.mean).toBe(1);
    expect(revenue.observed_state, 'a frame only, never a level').toBeUndefined();
    expect(ready.blockingIssues.map((i) => i.code)).not.toContain('IDENTITY_FRAME_MISSING');
    // The saved graph the Run sends keeps it (NodeV3 declares `scale_frame`; an undeclared key would be stripped).
    const saved = projectCorePostimageForPersistence(GraphV3.parse({ ...mapped.graph, living_model: model() })) as Rec;
    expect((saved.nodes as Rec[]).find((n) => n.id === 'revenue')!.scale_frame).toBe(revenue.scale_frame);
  });
  it('Codex\'s probe (a sum, both parts on the goal\'s frame): a link of 1 into the goal reaches the engine as 1, so raising a part by £1 adds £1', () => {
    const m = model();
    m.factors = [level('a', 700, '£ per week'), level('b', 500, '£ per week'),
      level('q', null, '£ per week', { op: 'sum', of: ['a', 'b'], ...who('q is a plus b') })];
    m.options[1] = { ...m.options[1]!, settings: [{ estimate_by: null, factor_id: 'b', value: 501, low: null, high: null, unit: '£ per week', ...who('raise b to 501') }] };
    m.links = [{ id: 'q_net', from: 'q', to: 'net', ...who('q adds to net'),
      effect: { estimate_by: null, form: 'normal', value: 1, sd: 0.1, low: null, high: null, unit: '£ per week', sign: '+' } }];
    const { mapped } = readiness(m);
    const nodes = mapped.graph.nodes as Rec[];
    const capOf = (id: string) => (nodes.find((n) => n.id === id)!.observed_state as Rec).cap as number;
    const q = nodes.find((n) => n.id === 'q')!;
    expect(typeof q.scale_frame).toBe('number');
    expect(q.scale_frame).toBe(nodes.find((n) => n.id === 'net')!.goal_threshold_cap);
    expect(q.scale_frame, 'never the sum of its parts\' frames').not.toBe(capOf('a') + capOf('b'));
    expect((mapped.graph.edges as Rec[]).find((e) => e.id === 'q_net')!.strength.mean).toBe(1);
  });
  it('CONTRAST: a defined quantity with its own stated level keeps its own frame, with no scale_frame', () => {
    const revenue = (readiness(model(1200)).mapped.graph.nodes as Rec[]).find((n) => n.id === 'revenue')!;
    expect(revenue.scale_frame).toBeUndefined();
    expect(revenue.observed_state).toMatchObject({ raw_value: 1200 });
  });
});

