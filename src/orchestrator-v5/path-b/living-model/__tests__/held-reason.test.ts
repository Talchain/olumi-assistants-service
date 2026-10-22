/**
 * DL held-reason ruling (23 Oct): a target the person stated, which the core holds for another reason, said "no target" in the
 * ONE gap (`goalTargetGapOf`). Each held reason now says its own question, from the ONE reading of the aim (`aim-reading.ts`),
 * which the mapper also uses to hold it; one generic face ("needs your answer"). No engine input or node changes.
 */
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { goalTargetGapOf } from '../../../goal-target/goal-target-gap.js';
import { projectCanonicalAnalysisCells } from '../../../../routes/canonical-analysis-view.js';
import { aimTargetReading } from '../aim-reading.js';
import { mapLivingModel } from '../mapper.js';

type Json = Record<string, any>;
const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
const on = (factor_id: string) => ({ factor_id, estimate_by: null, value: 1, low: null, high: null, unit: null, ...who('do it') });
const target = { low: null, high: null, baseline: null, current: null, current_source: null, current_unit: null, period_months: null, change_kind: null, source: null, by_when: null };
const model = (aimText: string, t: Json | null, aimSource: 'user' | 'olumi' | 'unverified' = 'user'): LivingModelT => ({
  aims: [{ id: 'goal', text: aimText, status: 'current', defined_as: null, source: aimSource, party: null, quote: aimSource === 'user' ? aimText : null, target: t as never }],
  options: [
    { status: 'feasible', id: 'carry_on', label: 'Carry on as now', developed_from: null, settings: [], ...who('or carry on') },
    { status: 'feasible', id: 'act', label: 'Act now', developed_from: null, settings: [on('effort')], ...who('act now') },
  ],
  factors: [{ estimate_by: null, kind: 'factor', limit: null, id: 'effort', label: 'Effort', value: 0, low: null, high: null, unit: null, defined_as: null, ...who('none today') }],
  links: [{ id: 'effort_goal', from: 'effort', to: 'goal', source: 'olumi', party: null, quote: null,
    effect: { estimate_by: null, form: 'range', value: 0.6, sd: null, low: 0.2, high: 1, unit: '%', sign: '+' } }],
  risks: [], conditions: [], views: [], history: [],
});
const stored = (m: LivingModelT): Json => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(m).graph, living_model: m })) as Json;
const legacy = (g: Json): Json => { const { living_model: _, ...rest } = g; return rest; };
const goalHeld = (m: LivingModelT): string | undefined => mapLivingModel(m).withheld.find((w) => w.id === 'goal')?.reason;

/** Each held reason, its model and the one question it asks (the DL-approved words). */
const CASES: Array<[string, LivingModelT, string]> = [
  ['exact_target_not_in_slice', model('Exactly 500 members', { ...target, quantity: 'Members', comparator: '=', value: 500, unit: 'members' }),
    'One gap: ‘Exactly 500 members’ aims for exactly 500 members. Would at least 500 members, or at most 500 members, count as meeting it?'],
  ['target_range_not_in_slice', model('Between 400 and 600 members', { ...target, quantity: 'Members', comparator: '>=', value: null, low: 400, high: 600, unit: 'members' }),
    'One gap: ‘Between 400 and 600 members’ aims for between 400 members and 600 members. Does meeting it mean reaching at least 400 members, staying at most 600 members, or both?'],
  ['change_kind_unknown', model('Raise conversion by 10%', { ...target, quantity: 'Conversion', comparator: 'increase', value: 10, unit: '%', current: 40, current_unit: '%' }),
    'One gap: ‘Raise conversion by 10%’ aims for 10% more conversion. Is that 10% of today’s level, or 10 percentage points?'],
  ['change_base_invalid', model('Grow sign-ups by 20%', { ...target, quantity: 'Sign-ups', comparator: 'increase', value: 20, unit: '%', change_kind: 'relative', current: 0, current_unit: 'sign-ups' }),
    'One gap: ‘Grow sign-ups by 20%’ is a 20% change, which needs a level today above zero. What is today’s level of sign-ups?'],
  ['current_unit_mismatch', model('At least £5,000 a month', { ...target, quantity: 'Revenue', comparator: '>=', value: 5000, unit: '£', current: 4, current_unit: 'k£' }),
    'One gap: ‘At least £5,000 a month’ has a target in £ but today’s level in k£. What is today’s level in £?'],
  ['change_base_not_theirs', model('Grow productivity by 10%', { ...target, quantity: 'Productivity', comparator: 'increase', value: 10, unit: '%', change_kind: 'relative', current: 40, current_unit: 'points' }, 'olumi'),
    'One gap: ‘Grow productivity by 10%’ is measured from today’s level of productivity, which Olumi estimated at 40 points. What is today’s level? If Olumi’s estimate is right, say so.'],
  ['target_not_theirs', model('Grow the community', { ...target, quantity: 'Active members', comparator: '>=', value: 500, unit: 'members', source: 'olumi' }),
    'One gap: Olumi suggested measuring ‘Grow the community’ as active members. What figure would count as meeting it?'],
];

describe('every held reason says its own words in the one gap, never "no target"', () => {
  it.each(CASES)('%s: the one question for what is missing', (reason, m, question) => {
    expect(goalHeld(m)).toBe(reason);
    expect(goalTargetGapOf(stored(m))).toEqual({ kind: 'goal_answer_missing', goal_id: 'goal', deadline_known: false, question });
    expect(question).not.toMatch(/no target/);
  });

  it.each(CASES)('ONE decision: the mapper holds %s exactly as the leaf reads the aim', (reason, m) => {
    expect(aimTargetReading(m.aims[0]!)).toBe(reason);
  });

  it('the Run cell: one generic face, and the question as its reason', () => {
    const [, m, question] = CASES[0]!;
    const block = { type: 'analysis_result', enrichment: { option_comparison: [{ option_id: 'carry_on' }, { option_id: 'act' }] } };
    for (const { cell } of projectCanonicalAnalysisCells(block as never, stored(m))) {
      expect(cell).toMatchObject({ kind: 'withheld', face: 'Not shown yet: needs your answer', why: question });
      expect((cell as Json).reasons[0]).toEqual({ code: 'goal_answer_missing', message: question });
    }
  });

  it('show, label, de-bias: a level from an unconfirmed source is never called Olumi\'s', () => {
    const m = model('Grow productivity by 10%', { ...target, quantity: 'Productivity', comparator: 'increase', value: 10, unit: '%', change_kind: 'relative', current: 40, current_unit: 'points' }, 'unverified');
    const q = goalTargetGapOf(stored(m))!.question;
    expect(q).toContain('given as 40 points from a source not yet confirmed');
    expect(q).not.toContain('Olumi');
  });

  it('the goal\'s figure is the person\'s to set: Olumi\'s suggested figure is never said (anchoring)', () => {
    expect(CASES.find(([r]) => r === 'target_not_theirs')![2]).not.toMatch(/500/);
  });

  it('a range with one end asks about that end', () => {
    const m = model('At least 400 members', { ...target, quantity: 'Members', comparator: '>=', value: null, low: 400, unit: 'members' });
    expect(goalTargetGapOf(stored(m))?.question).toBe('One gap: ‘At least 400 members’ gives 400 members as the low end of a range. Does meeting it mean reaching at least 400 members?');
  });

  it('a change whose units do not fit (not a %) asks for the change in today\'s level\'s unit', () => {
    const m = model('Add £2,000 of sessions', { ...target, quantity: 'Sessions', comparator: 'increase', value: 2000, unit: '£', change_kind: 'absolute', current: 30, current_unit: 'sessions' });
    expect(goalHeld(m)).toBe('change_kind_unknown');
    expect(goalTargetGapOf(stored(m))?.question).toBe('One gap: ‘Add £2,000 of sessions’ has a change in £ but today’s level in sessions. What is the change in sessions?');
  });

  it('Codex r1: "relative or points" is asked only when both units are %, and a unit question only when the units differ', () => {
    const generic = (label: string) => `One gap: ‘${label}’ has a target Olumi can’t read as stated yet. What exactly would count as meeting it?`;
    const points = model('Add 10 points of sessions', { ...target, quantity: 'Sessions', comparator: 'increase', value: 10, unit: '%', change_kind: 'points', current: 100, current_unit: 'sessions' });
    const sameUnit = model('Grow revenue by £10', { ...target, quantity: 'Revenue', comparator: 'increase', value: 10, unit: '£', change_kind: 'relative', current: 100, current_unit: '£' });
    for (const [label, m] of [['Add 10 points of sessions', points], ['Grow revenue by £10', sameUnit]] as const) {
      expect(goalHeld(m)).toBe('change_kind_unknown');
      expect(goalTargetGapOf(stored(m))).toMatchObject({ kind: 'goal_answer_missing', question: generic(label) });
    }
  });

  it('Codex r1: a range on a change is said as a change, never as the target level', () => {
    const both = model('Grow members', { ...target, quantity: 'Members', comparator: 'increase', value: null, low: 10, high: 20, unit: 'members', current: 100, current_unit: 'members' });
    expect(goalTargetGapOf(stored(both))?.question).toBe('One gap: ‘Grow members’ aims for a change of between 10 members and 20 members. Does meeting it mean a change of at least 10 members, at most 20 members, or both?');
    const low = model('Grow members', { ...target, quantity: 'Members', comparator: 'increase', value: null, low: 10, unit: 'members', current: 100, current_unit: 'members' });
    expect(goalTargetGapOf(stored(low))?.question).toBe('One gap: ‘Grow members’ gives a change of 10 members as the low end of a range. Does meeting it mean a change of at least 10 members?');
  });

  it('Codex r1: "exactly" says the figure exactly as written, never rounded', () => {
    const pounds = model('Exactly £1.23456', { ...target, quantity: 'Price', comparator: '=', value: 1.23456, unit: '£' });
    expect(goalTargetGapOf(stored(pounds))?.question).toContain('aims for exactly £1.23456.');
    const tiny = model('Exactly 0.00001%', { ...target, quantity: 'Error rate', comparator: '=', value: 0.00001, unit: '%' });
    expect(goalTargetGapOf(stored(tiny))?.question).toContain('aims for exactly 0.00001%.');
  });

  it('Codex r1: "exactly" with only a range asks the range question, never "no target"', () => {
    const m = model('Between 400 and 600 members', { ...target, quantity: 'Members', comparator: '=', value: null, low: 400, high: 600, unit: 'members' });
    expect(goalHeld(m)).toBe('exact_target_not_in_slice');
    expect(goalTargetGapOf(stored(m))?.question).toBe(CASES[1]![2]);
  });

  it('Codex r2: a figure past 20 decimal places is still said exactly', () => {
    const m = model('Exactly a trace', { ...target, quantity: 'Error rate', comparator: '=', value: 1e-21, unit: '%' });
    expect(goalTargetGapOf(stored(m))?.question).toContain('aims for exactly 1e-21%.');
  });

  it('Codex r2: today\'s level keeps its own (empty) unit, never the target\'s', () => {
    const m = model('Grow productivity by 10%', { ...target, quantity: 'Productivity', comparator: 'increase', value: 10, unit: '%', change_kind: 'relative', current: 40, current_unit: '' }, 'olumi');
    expect(goalTargetGapOf(stored(m))?.question).toContain('which Olumi estimated at 40.');
  });

  it('Codex r2: a change with no quantity named still asks for today\'s level, never "no target"', () => {
    const m = model('Grow by 10%', { ...target, quantity: '', comparator: 'increase', value: 10, unit: '%', change_kind: 'relative' });
    expect(goalTargetGapOf(stored(m))).toMatchObject({ kind: 'goal_level_missing',
      question: 'One gap: ‘Grow by 10%’ is a change from today’s level, which isn’t given yet. What is today’s level?' });
  });

  it('Codex r2 NEGATIVE: an "exactly" with no figure at all keeps the true "no target" words', () => {
    const m = model('Exactly right', { ...target, quantity: 'Members', comparator: '=', value: null, unit: 'members' });
    expect(goalHeld(m)).toBe('exact_target_not_in_slice');
    expect(goalTargetGapOf(stored(m))?.question).toBe('One gap: ‘Exactly right’ has no target or deadline yet. What would count as meeting it, and by when?');
  });

  it('NEGATIVE: no target figure keeps today\'s words; a legacy graph is byte-identical; #3631\'s today\'s-level ask is unchanged', () => {
    expect(goalTargetGapOf(stored(model('Grow the business', null)))?.kind).toBe('goal_target_missing');
    for (const [, m] of CASES) expect(goalTargetGapOf(legacy(stored(m)))?.kind ?? null).not.toBe('goal_answer_missing');
    const hiring = model('Increase productivity by at least 10%', { ...target, quantity: 'Productivity', comparator: 'increase', value: 10, unit: '%', change_kind: 'relative' });
    expect(goalTargetGapOf(stored(hiring))?.kind).toBe('goal_level_missing');
  });

  it('every question stays inside the 400-character carrier, whatever the label, quantity or unit (Codex r1: units too)', () => {
    for (const [, m] of CASES) {
      const long: LivingModelT = { ...m, aims: m.aims.map((a) => ({ ...a, text: 'L'.repeat(400), target: a.target === null ? null
        : { ...a.target, quantity: 'Q'.repeat(400), ...(a.target.unit === null ? {} : { unit: 'U'.repeat(400) }), ...(a.target.current_unit === null ? {} : { current_unit: 'C'.repeat(400) }) } })) };
      const q = goalTargetGapOf(stored(long))!;
      expect(q.kind).toBe('goal_answer_missing');
      expect(q.question.length).toBeLessThanOrEqual(400);
      // Bounded parts keep the reason's own question; the generic one is only for what has none.
      expect(q.question).not.toContain('can’t read as stated yet');
    }
  });
});
