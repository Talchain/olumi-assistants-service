/**
 * DL 23 Oct (Track 3 funding/hiring on cee 1d8f3c85): every Run cell said "‘<aim>’ has no target or deadline yet…", though
 * both aims carry deadlines and hiring carries its +10% target. The ONE "no target" gap (`goalTargetGapOf`) read only legacy
 * carriers, which a core goal the mapper holds does not have. DL ruling (a): on a core graph the gap reads the goal's own
 * aim (the living model is the single source of meaning, A2). Funding asks for the target only; hiring asks for today's
 * level, never "no target". A legacy graph's words, the mapper and every engine input are unchanged.
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
const on = (factor_id: string) => ({ factor_id, estimate_by: null, value: 1, low: null, high: null, unit: null, ...who('do it') });
const target = { low: null, high: null, baseline: null, current: null, current_source: null, current_unit: null, period_months: null, change_kind: null, source: null, by_when: null };
const model = (aimText: string, t: Json | null): LivingModelT => ({
  aims: [{ id: 'goal', text: aimText, status: 'current', defined_as: null, ...who(aimText), target: t as never }],
  options: [
    { status: 'feasible', id: 'carry_on', label: 'Carry on as now', developed_from: null, settings: [], ...who('or carry on') },
    { status: 'feasible', id: 'act', label: 'Act now', developed_from: null, settings: [on('effort')], ...who('act now') },
  ],
  factors: [{ estimate_by: null, kind: 'factor', limit: null, id: 'effort', label: 'Effort', value: 0, low: null, high: null, unit: null, defined_as: null, ...who('none today') }],
  links: [{ id: 'effort_goal', from: 'effort', to: 'goal', source: 'olumi', party: null, quote: null,
    effect: { estimate_by: null, form: 'range', value: 0.6, sd: null, low: 0.2, high: 1, unit: '%', sign: '+' } }],
  risks: [], conditions: [], views: [], history: [],
});
/** Track 3 funding: Olumi's suggested measure (£, no figure), with the person's own deadline in words. */
const funding = (byWhen: string | null) => model('Secure funding within the next 2 months',
  { ...target, quantity: 'Funding secured', comparator: '>=', value: null, unit: '£', by_when: byWhen, source: 'olumi' });
/** Track 3 hiring: the person's +10% relative change, with no level today (its served reference words). */
const hiring = (over: Json = {}) => model('Increase productivity by at least 10%', { ...target, quantity: 'Productivity', comparator: 'increase', value: 10,
  unit: '%', change_kind: 'relative', baseline: 'Current productivity; measurement and level not yet supplied', by_when: 'in the next three months', ...over });
const LEVEL_QUESTION = 'One gap: ‘Increase productivity by at least 10%’ is a change from today’s level of productivity, which isn’t given yet. What is today’s level of productivity?';
const stored = (m: LivingModelT): Json => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(m).graph, living_model: m })) as Json;
const legacy = (g: Json): Json => { const { living_model: _, ...rest } = g; return rest; };
const reasons = (m: LivingModelT) => mapLivingModel(m).withheld.map((w) => `${w.id}:${w.reason}`);

describe('the one gap asks only for what is missing: the target, or the level a change starts from', () => {
  it('Track 3 funding: no £ target but a deadline in words → the target only', () => {
    expect(goalTargetGapOf(stored(funding('within the next 2 months')))).toEqual({ kind: 'goal_target_missing', goal_id: 'goal', deadline_known: true,
      question: 'One gap: ‘Secure funding within the next 2 months’ has no target yet. What would count as meeting it?' });
  });

  it('funding: deadline words longer than the goal node can hold still count (read from the aim, never the node)', () => {
    expect(goalTargetGapOf(stored(funding('within the next two months, before our current cash reserves run out')))?.deadline_known).toBe(true);
  });

  it('Track 3 hiring (DL ruling (a)): the +10% is their target, so the gap asks for today\'s level, never "no target"', () => {
    expect(goalTargetGapOf(stored(hiring()))).toEqual({ kind: 'goal_level_missing', goal_id: 'goal', deadline_known: true, question: LEVEL_QUESTION });
  });

  it('hiring, in the Run cell: its face and its reason name today\'s level', () => {
    const block = { type: 'analysis_result', enrichment: { option_comparison: [{ option_id: 'carry_on' }, { option_id: 'act' }] } };
    const cells = projectCanonicalAnalysisCells(block as never, stored(hiring()));
    expect(cells.length).toBe(2);
    for (const { cell } of cells) {
      expect(cell).toMatchObject({ kind: 'withheld', face: 'Not shown yet: needs today’s level', why: LEVEL_QUESTION });
      expect((cell as Json).reasons[0]).toEqual({ code: 'goal_level_missing', message: LEVEL_QUESTION });
    }
  });

  it('SCOPE (narrowest reading): a target held for another reason keeps today\'s words; it is not this ruling\'s shape', () => {
    const exact = model('Exactly 500 members', { ...target, quantity: 'Members', comparator: '=', value: 500, unit: 'members' });
    expect(reasons(exact)).toContain('goal:exact_target_not_in_slice');
    expect(goalTargetGapOf(stored(exact))).toEqual(goalTargetGapOf(legacy(stored(exact))));
  });

  it('a level that exists but is not the person\'s (change_base_not_theirs) is never called "not given"', () => {
    const m = hiring({ current: 40, current_unit: 'points' });
    const unconfirmed: LivingModelT = { ...m, aims: m.aims.map((a) => ({ ...a, source: 'unverified' as const, quote: null })) };
    expect(reasons(unconfirmed)).toContain('goal:change_base_not_theirs');
    expect(goalTargetGapOf(stored(unconfirmed))?.kind).not.toBe('goal_level_missing');
  });

  it('Codex r3: only the CURRENT aim is read (a withdrawn aim with the goal\'s id is not)', () => {
    const g = stored(hiring());
    const withdrawn = { ...g, living_model: { ...g.living_model, aims: g.living_model.aims.map((a: Json) => ({ ...a, status: 'withdrawn' })) } };
    expect(goalTargetGapOf(withdrawn)?.kind).toBe('goal_target_missing');
  });

  it('Codex r2/r3: a proper quantity keeps its case, and long labels keep the question inside 400 characters', () => {
    expect(goalTargetGapOf(stored(hiring({ quantity: 'GitHub stars' })))?.question).toContain('today’s level of GitHub stars');
    const long = 'Weekly delivered sessions across every estate, school and partner venue we run, '.repeat(3).trim();
    const q = goalTargetGapOf(stored(model(long, { ...target, quantity: long, comparator: 'increase', value: 10, unit: '%', change_kind: 'relative' })))!.question;
    expect(q.length).toBeLessThanOrEqual(400);
    expect(q).toContain('What is today’s level of');
  });

  it('NEGATIVE: a legacy graph (no living model) gets byte-identical words', () => {
    expect(goalTargetGapOf(legacy(stored(hiring())))).toEqual({ kind: 'goal_target_missing', goal_id: 'goal', deadline_known: false,
      question: 'One gap: ‘Increase productivity by at least 10%’ has no target or deadline yet. What would count as meeting it, and by when?' });
  });

  it('NEGATIVE: a genuinely target-less core aim still asks for its target (and its deadline when none is given)', () => {
    expect(goalTargetGapOf(stored(funding(null)))?.question).toBe('One gap: ‘Secure funding within the next 2 months’ has no target or deadline yet. What would count as meeting it, and by when?');
    expect(goalTargetGapOf(stored(model('Grow the business', null)))?.kind).toBe('goal_target_missing');
  });

  it('NEGATIVE: Olumi\'s suggested change measure is not the person\'s target: the target is still asked for', () => {
    const suggested = model('Grow productivity', { ...target, quantity: 'Productivity', comparator: 'increase', value: 10, unit: '%', change_kind: 'relative', source: 'olumi' });
    expect(goalTargetGapOf(stored(suggested))?.kind).toBe('goal_target_missing');
  });

  it('NEGATIVE: with today\'s level given, hiring has a level target, so there is no gap', () => {
    expect(goalTargetGapOf(stored(hiring({ current: 40, current_unit: 'points' })))).toBeNull();
  });
});
