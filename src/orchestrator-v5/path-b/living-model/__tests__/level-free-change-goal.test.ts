/**
 * A RELATIVE CHANGE WITH NO LEVEL TODAY IS MEASURED AS THE CHANGE (DL 22 Oct, item 2; Batch 0 change-goal decision, rulings 2,
 * 6, 8 and 20). "+20% throughput", with every effect into the goal in % of today's level, is "% change from today" on its own
 * 0–100 scale, 0 today by definition, as the legacy lane measures hiring's "+10% productivity": no level is needed or made up.
 * SYNTHETIC wording; the real mapper, readiness, saved-graph projection and the licence's basis reader. Expectations are
 * hand-calculated in natural units.
 */
import { describe, expect, it } from 'vitest';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { assessCanonicalAnalysisReadiness } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { goalTargetBasisOf } from '../../../goal-target/goal-target-basis.js';
import { goalTargetGapOf } from '../../../goal-target/goal-target-gap.js';
import { projectCanonicalAnalysisCells } from '../../../../routes/canonical-analysis-view.js';
import { mapLivingModel } from '../mapper.js';

type Rec = Record<string, any>;
const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
type Target = NonNullable<LivingModelT['aims'][number]['target']>;
/** Throughput, +20% from today with no level today; line speed 10 an hour today, "Speed up" sets it to 12; each +1 an hour adds 1.5%. */
const model = (target: Partial<Target> = {}, linkUnit = '%'): LivingModelT => ({
  aims: [{ id: 'tp', text: 'Raise throughput by 20%', status: 'current', defined_as: null, ...who('raise throughput by 20%'),
    target: { quantity: 'Throughput', comparator: 'increase', value: 20, low: null, high: null, unit: '%', by_when: null, period_months: null, period_by: null, period_deadline: null, period_read_on: null,
      baseline: 'today', current: null, current_source: null, current_unit: null, change_kind: 'relative', source: null, ...target } }],
  options: [
    { status: 'feasible', id: 'keep', label: 'Keep', settings: [], developed_from: null, ...who('or keep as we are') },
    { status: 'feasible', id: 'faster', label: 'Speed up', developed_from: null, ...who('speed the line up to 12 an hour'),
      settings: [{ estimate_by: null, factor_id: 'speed', value: 12, low: null, high: null, unit: 'units per hour', ...who('speed the line up to 12 an hour') }] },
  ],
  factors: [{ id: 'speed', label: 'Line speed', kind: 'factor', estimate_by: null, value: 10, low: null, high: null, unit: 'units per hour', defined_as: null, limit: null,
    ...who('the line runs at 10 an hour') }],
  links: [{ id: 'speed_tp', from: 'speed', to: 'tp', ...who('each extra unit an hour adds about 1.5% to throughput'),
    effect: { estimate_by: null, form: 'normal', value: 1.5, sd: 0.3, low: null, high: null, unit: linkUnit, sign: '+' } }],
  risks: [], conditions: [], views: [], history: [],
});
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
const reasons = (m: LivingModelT) => mapLivingModel(m).withheld.map((w) => `${w.id}:${w.reason}`);
const stored = (m: LivingModelT): Rec => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(m).graph, living_model: m })) as Rec;

describe('a relative change with no level today is measured as the change, never held for a level', () => {
  it('the goal is "% change from today" on 0–100, with Olumi\'s reading beside it; no level is sent, nothing is held for one', () => {
    const { graph, withheld, assumed } = mapLivingModel(model());
    const goal = goalOf(graph);
    expect(goal).toMatchObject({ quantity_frame: 'change', goal_threshold_frame: 'change_abs', goal_threshold_raw: 20, goal_threshold_unit: '%',
      goal_threshold_cap: 100, goal_threshold: 0.2, goal_direction: '>=' });
    expect(goal.observed_state, 'no level today is sent or made up').toBeUndefined();
    expect(goal.goal_target_basis).toEqual({ source: 'olumi_reading', quantity_frame: 'change', target_frame: 'change_abs', target_raw: 20, reference: 'today',
      denominator: 'today\'s Throughput', period_kind: 'at_end', effect_unit: '% of today\'s Throughput', effects_at_period_end: false });
    expect(withheld).toEqual([]);
    expect(assumed.map((a) => a.text)).toEqual([
      'Carrying on as now leaves Throughput unchanged, so the change is measured from today\'s level, whatever it is.',
      'Every effect on Throughput is a % of today\'s level, and the effects add rather than compound.']);
    expect(assessCanonicalAnalysisReadiness({ ...graph, living_model: model() }).blockingIssues).toEqual([]);
  });

  it('NUMERICAL (by hand): "Speed up" (+2 an hour × 1.5% each) moves throughput by +3% of today, read on the goal\'s own scale', () => {
    const { graph } = mapLivingModel(model());
    const edge = (graph.edges as Rec[]).find((e) => e.id === 'speed_tp')!;
    const speed = (graph.nodes as Rec[]).find((n) => n.id === 'speed')!;
    const option = (graph.nodes as Rec[]).find((n) => n.id === 'faster')!;
    const fromCap = speed.observed_state.cap as number;
    // The engine's normalised change in line speed, times the edge, read back on the goal's 0–100 change scale.
    const moved = ((12 - 10) / fromCap) * edge.strength.mean * goalOf(graph).goal_threshold_cap;
    expect(moved).toBeCloseTo(3, 9);
    expect(edge.strength.std * goalOf(graph).goal_threshold_cap / fromCap).toBeCloseTo(0.3, 9);
    expect(edge.defaulted, 'sized from the stated figure, never a placeholder').toBeUndefined();
    expect(option.interventions.speed.raw_value, 'the option sets the line to 12 an hour').toBe(12);
  });

  it('a decrease: "cut by 15%" is a change of −15 or less', () => {
    const goal = goalOf(mapLivingModel(model({ comparator: 'decrease', value: 15 })).graph);
    expect(goal).toMatchObject({ goal_threshold_raw: -15, goal_threshold: -0.15, goal_direction: '<=', quantity_frame: 'change' });
    expect(goal.goal_target_basis.target_raw).toBe(-15);
  });

  it('a rise above 100% sits on the legacy lane\'s wider change scale (the same resolver), and the same effect reads back the same', () => {
    const { graph } = mapLivingModel(model({ value: 150 }));
    const goal = goalOf(graph);
    expect(goal).toMatchObject({ goal_threshold_raw: 150, goal_threshold_cap: 187.5, goal_threshold: 0.8, quantity_frame: 'change' });
    const edge = (graph.edges as Rec[]).find((e) => e.id === 'speed_tp')!;
    const fromCap = (graph.nodes as Rec[]).find((n) => n.id === 'speed')!.observed_state.cap as number;
    expect(((12 - 10) / fromCap) * edge.strength.mean * goal.goal_threshold_cap).toBeCloseTo(3, 9);
  });

  it('Codex r1 on #3666: a chance withheld for another reason says that reason, never "needs today\'s level" (no level is needed)', () => {
    const m = model();
    m.conditions = [{ text: 'only after the new belt is fitted', applies_to: ['speed_tp'], role: 'prerequisite', source: 'user', party: null, quote: 'only after the new belt is fitted' }];
    expect(reasons(m)).toContain('tp:chance_rests_on_withheld');
    const g = stored(m);
    expect(goalOf(g).quantity_frame, 'its frame stays when the threshold is withheld').toBe('change');
    expect(goalTargetGapOf(g)).toBeNull();
    const block = { type: 'analysis_result', enrichment: { option_comparison: [{ option_id: 'keep' }, { option_id: 'faster' }] } };
    const cells = projectCanonicalAnalysisCells(block as never, g);
    expect(cells.length).toBe(2);
    for (const { cell } of cells) expect(JSON.stringify(cell)).not.toMatch(/today\u2019s level|today's level/);
    // CONTRAST: the same withheld goal with an absolute effect still needs today's level, and asks for it.
    const absolute = model({}, 'units per week');
    absolute.conditions = m.conditions;
    expect(goalTargetGapOf(stored(absolute))?.kind).toBe('goal_level_missing');
  });

  it('a stated period goes with the reading, so the licence reads it; with none, the reading waits for the period (never guessed)', () => {
    const withPeriod = goalOf(mapLivingModel(model({ period_months: 6 })).graph);
    expect(withPeriod.goal_target_basis.period_months).toBe(6);
    expect(goalTargetBasisOf(withPeriod)).toMatchObject({ quantity_frame: 'change', target_frame: 'change_abs', period_months: 6, denominator: 'today\'s Throughput' });
    expect(goalTargetBasisOf(goalOf(mapLivingModel(model()).graph)), 'no period: absent until one is given').toBeUndefined();
  });

  it('the saved graph keeps every carrier (NodeV3 declares them; an undeclared key would be stripped)', () => {
    const m = model({ period_months: 6 });
    const saved = projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(m).graph, living_model: m })) as Rec;
    const goal = goalOf(saved);
    expect(goal).toMatchObject({ quantity_frame: 'change', goal_threshold_frame: 'change_abs', goal_threshold_raw: 20, goal_threshold_cap: 100 });
    expect(goalTargetBasisOf(goal)).toMatchObject({ period_months: 6 });
  });
});

describe('REFUSALS: the goal stays held for its level wherever the change cannot be read without one', () => {
  it('one absolute link into the goal: an absolute effect needs today\'s level, so the goal and the link are held as before', () => {
    const m = model({}, 'units per week');
    expect(reasons(m)).toEqual(expect.arrayContaining(['tp:goal_level_unknown', 'speed_tp:link_goal_level_unknown']));
    expect(goalOf(mapLivingModel(m).graph).quantity_frame).toBeUndefined();
    expect(goalOf(mapLivingModel(m).graph).goal_threshold).toBeUndefined();
  });

  it('a change whose kind was not declared is never picked (amendment 3): held as before', () => {
    expect(reasons(model({ change_kind: null }))).toContain('tp:goal_level_unknown');
    expect(goalOf(mapLivingModel(model({ change_kind: null })).graph).quantity_frame).toBeUndefined();
  });

  it('a change of no named quantity is never read here (nothing to say it of): held as before', () => {
    expect(reasons(model({ quantity: '' }))).toContain('tp:goal_level_unknown');
  });

  it('a quantity measured in % (points or % of today?) is never read here, however "%" is spelled: held as before', () => {
    for (const unit of ['%', 'percent', 'per cent', 'percentage points']) expect(reasons(model({ current_unit: unit })), unit).toContain('tp:goal_level_unknown');
  });

  it('Codex r1 on #3666: a stated reference other than today is never replaced by today: held as before', () => {
    expect(reasons(model({ baseline: 'last quarter' }))).toContain('tp:goal_level_unknown');
    expect(goalOf(mapLivingModel(model({ baseline: 'last quarter' })).graph).goal_target_basis).toBeUndefined();
    // CONTRAST: today in other words (the served hiring reference) is today.
    expect(goalOf(mapLivingModel(model({ baseline: 'Current throughput; level not yet supplied' })).graph).quantity_frame).toBe('change');
  });

  it('a cut of more than 100% is never read: held as before', () => {
    expect(reasons(model({ comparator: 'decrease', value: 150 }))).toContain('tp:goal_level_unknown');
  });

  it('CONTRAST: with today\'s level stated, the change is read on that level, exactly as before (no change frame)', () => {
    const m = model({ current: 400, current_unit: 'units per week', current_source: 'user' }, 'units per week');
    const goal = goalOf(mapLivingModel(m).graph);
    expect(goal.quantity_frame).toBeUndefined();
    expect(goal).toMatchObject({ goal_threshold_frame: 'level', goal_threshold_raw: 480 });
  });
});
