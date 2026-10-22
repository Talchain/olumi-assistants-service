/**
 * DL 23 Oct (Track 3 funding/hiring on cee 1d8f3c85): every Run cell said "‘<aim>’ has no target or deadline yet…", though
 * both aims carry deadlines and hiring carries its +10% target. The ONE "no target" gap (`goalTargetGapOf`) read only legacy
 * carriers. Funding: the mapper keeps the person's deadline words on the held goal, and the gap counts them, so it asks for
 * the target only. Hiring (DL ruling (a)): on a core graph the gap reads the aim's own target, so a change target with no
 * level today asks for that level, never "no target". No engine input or other node field changes.
 */
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { goalTargetGapOf } from '../../../goal-target/goal-target-gap.js';
import { projectCanonicalAnalysisCells } from '../../../../routes/canonical-analysis-view.js';
import { mapLivingModel } from '../mapper.js';

type Json = Record<string, any>;
const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
const on = (factor_id: string) => ({ factor_id, estimate_by: null, value: 1, low: null, high: null, unit: null, ...who('pitch to two funds') });
const target = { low: null, high: null, baseline: null, current: null, current_source: null, current_unit: null, period_months: null, change_kind: null, source: null };
const model = (aimText: string, t: Json | null): LivingModelT => ({
  aims: [{ id: 'goal', text: aimText, status: 'current', defined_as: null, ...who(aimText), target: t as never }],
  options: [
    { status: 'feasible', id: 'carry_on', label: 'Carry on as now', developed_from: null, settings: [], ...who('or carry on') },
    { status: 'feasible', id: 'pitch', label: 'Pitch to two funds', developed_from: null, settings: [on('pitching')], ...who('pitch to two funds') },
  ],
  factors: [{ estimate_by: null, kind: 'factor', limit: null, id: 'pitching', label: 'Funds pitched', value: 0, low: null, high: null, unit: null, defined_as: null, ...who('none pitched yet') }],
  links: [{ id: 'pitch_goal', from: 'pitching', to: 'goal', source: 'olumi', party: null, quote: null,
    effect: { estimate_by: null, form: 'range', value: 20000, sd: null, low: 5000, high: 50000, unit: '£', sign: '+' } }],
  risks: [], conditions: [], views: [], history: [],
});
/** Track 3 funding: Olumi's suggested measure (£, no figure), with the person's own deadline in words. */
const funding = (byWhen: string | null) => model('Secure funding within the next 2 months',
  { ...target, quantity: 'Funding secured', comparator: '>=', value: null, unit: '£', by_when: byWhen, period_months: byWhen === null ? null : 2, source: 'olumi' });
/** Track 3 hiring: the person's +10% relative change, with no level today unless given. */
const hiring = (current: number | null = null) => model('Increase productivity by at least 10%',
  { ...target, quantity: 'Productivity', comparator: 'increase', value: 10, unit: '%', change_kind: 'relative', current, current_unit: current === null ? null : 'points',
    by_when: 'in the next three months', period_months: 3 });
const LEVEL_QUESTION = 'One gap: \u2018Increase productivity by at least 10%\u2019 is a change from today\u2019s level of productivity, which isn\u2019t given yet. What is today\u2019s level of productivity?';
const stored = (m: LivingModelT): Json => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(m).graph, living_model: m })) as Json;
const goalOf = (g: Json): Json => (g.nodes as Json[]).find((n) => n.kind === 'goal')!;

describe('the one gap asks only for what is missing: the target, or today\'s level', () => {
  it('Track 3 funding: no £ target but a deadline in words → the gap asks for the target only', () => {
    const g = stored(funding('within the next 2 months'));
    expect(goalOf(g).goal_deadline_as_stated).toBe('within the next 2 months');
    expect(goalTargetGapOf(g)).toEqual({ kind: 'goal_target_missing', goal_id: 'goal', deadline_known: true,
      question: 'One gap: ‘Secure funding within the next 2 months’ has no target yet. What would count as meeting it?' });
  });

  it('Track 3 hiring (DL ruling (a)): the +10% is their target, so the gap asks for today\'s level, never "no target"', () => {
    const gap = goalTargetGapOf(stored(hiring()));
    expect(gap).toEqual({ kind: 'goal_level_missing', goal_id: 'goal', deadline_known: true, question: LEVEL_QUESTION });
    expect(gap!.question).not.toMatch(/no target/);
  });

  it('hiring, in the Run cell: its face and its reason name today\'s level', () => {
    const block = { type: 'analysis_result', enrichment: { option_comparison: [{ option_id: 'carry_on' }, { option_id: 'pitch' }] } };
    const cells = projectCanonicalAnalysisCells(block as never, stored(hiring()));
    expect(cells.length).toBe(2);
    for (const { cell } of cells) {
      expect(cell).toMatchObject({ kind: 'withheld', face: 'Not shown yet: needs today\u2019s level', why: LEVEL_QUESTION });
      expect((cell as Json).reasons[0]).toEqual({ code: 'goal_level_missing', message: LEVEL_QUESTION });
    }
  });

  it('NEGATIVE: a legacy graph (no living model) gets the target words, as before this reader change', () => {
    const { living_model: _, ...legacy } = stored(hiring());
    expect(goalTargetGapOf(legacy)).toEqual({ kind: 'goal_target_missing', goal_id: 'goal', deadline_known: true,
      question: 'One gap: \u2018Increase productivity by at least 10%\u2019 has no target yet. What would count as meeting it?' });
  });

  it('NEGATIVE: Olumi\'s suggested change measure is not the person\'s target: the target is still asked for', () => {
    const suggested = model('Grow productivity', { ...target, quantity: 'Productivity', comparator: 'increase', value: 10, unit: '%', change_kind: 'relative', by_when: null, source: 'olumi' });
    expect(goalTargetGapOf(stored(suggested))?.kind).toBe('goal_target_missing');
  });

  it('NEGATIVE: with today\'s level given, hiring has a level target, so there is no gap', () => {
    expect(goalTargetGapOf(stored(hiring(40)))).toBeNull();
  });

  it('words only: the held goal gains no date, month, target, direction or frame (no verdict or engine input moves)', () => {
    const { goal_deadline_as_stated: words, ...rest } = goalOf(stored(funding('by 31 March 2027')));
    expect(words).toBe('by 31 March 2027');
    expect(rest).toEqual(goalOf(stored(funding(null))));
  });

  it('NEGATIVE: a genuinely target-less core aim with no deadline still asks for its target and its deadline', () => {
    const g = stored(funding(null));
    expect(goalOf(g)).not.toHaveProperty('goal_deadline_as_stated');
    expect(goalTargetGapOf(g)?.question).toBe('One gap: ‘Secure funding within the next 2 months’ has no target or deadline yet. What would count as meeting it, and by when?');
  });

  it('NEGATIVE: an aim with no target at all keeps exactly today\'s goal node (nothing written)', () => {
    expect(goalOf(stored(model('Grow the business', null)))).toEqual({ id: 'goal', kind: 'goal', label: 'Grow the business', source_quote: 'Grow the business' });
  });

  it('the reader: deadline words count; blank words do not', () => {
    const graph = (words: string) => ({ nodes: [{ id: 'g', kind: 'goal', label: 'Goal', goal_deadline_as_stated: words }] });
    expect(goalTargetGapOf(graph('by Q3'))?.deadline_known).toBe(true);
    expect(goalTargetGapOf(graph('   '))?.deadline_known).toBe(false);
  });
});
