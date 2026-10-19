/**
 * ⭐ STATED CASES, NOT A MISSING LEVEL (AIE 10:54, 19 Oct, exact words; VERIFIER C6). A user who gives a factor's level as several
 * cases, each with its probability, is never asked "What is it today… treat it as zero": the draft schema cannot carry the
 * distribution yet, so the factor still blocks, but the ask names that limitation, offers no zero or mean, and claims no structured
 * support. A single missing level keeps today's ask. SYNTHETIC wording.
 */
import { describe, expect, it } from 'vitest';
import { resolveRunAdmission } from '../analysis-ready-core.js';
import { assessCanonicalAnalysisReadiness } from '../../../../orchestrator/tools/analysis-ready-helper.js';

type Rec = Record<string, unknown>;
const LABEL = 'Walk-in visits next week';
const TODAY_ASK = `What is "${LABEL}" today, before any option changes it? Without a current level the analysis would treat it as zero.`;
const CASES_ASK = (what: string): string => `You supplied a probability for each possible ‘${what}’. This calculation cannot yet use that `
  + 'distribution faithfully. We can still reason through your stated cases and what each would mean.';

const edge = (from: string, to: string): Rec => ({ from, to, strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' });
const option = (id: string, label: string, value: number, is_baseline = false): Rec => ({
  id, option_id: id, kind: 'option', label, interventions: { staff: { value, source: 'brief_extraction' } }, is_baseline,
});

/** A valued lever, a goal, and the factor with no level whose kept statements are `statements` (as construction keeps them). */
function graphWith(statements: readonly Rec[], field = 'level'): Rec {
  const options = [option('add_staff', 'Add a second assistant', 2 / 10), option('carry_on', 'Carry on as now', 1 / 10, true)];
  const nodes: Rec[] = [
    { id: 'decision', kind: 'decision', label: 'Staffing' },
    { id: 'goal', kind: 'goal', label: 'Serve every visitor on the day' },
    { id: 'staff', kind: 'factor', label: 'Assistants on shift', category: 'controllable',
      observed_state: { value: 1 / 10, raw_value: 1, unit: 'people', source: 'brief_extraction' } },
    { id: 'visits', kind: 'factor', label: LABEL, category: 'observable',
      ...(statements.length === 0 ? {} : { user_statements: [{ subject_key: `factor|visits|||${field}`, field, statements,
        recorded_at: '2026-10-19T09:00:00.000Z', attest: { recorded_by: 'construction' } }] }) },
    ...options,
  ];
  const edges = [...options.map((o) => edge('decision', String(o.id))), ...options.map((o) => edge(String(o.id), 'staff')),
    edge('staff', 'goal'), edge('visits', 'goal')];
  return { nodes, edges, options, goal_node_id: 'goal' };
}

const subject = { quantity: 'factor|walk-in visits next week|||level' };
/** One sentence that states three cases and a probability for each, kept three times as the brief's speaker-unknown words (C6's shape). */
const unboundCase = (quote: string): Rec => ({ speaker: 'unknown', quote, source: quote, subject, form: 'describes', reading: 'olumi' });
const pointCase = (quote: string, value: number, extra: Rec = {}): Rec => ({
  speaker: 'user', quote, source: quote, subject, form: 'point', low: value, high: value, unit: 'visits', reading: 'olumi', ...extra,
});
const visitsAsk = (g: Rec): string | undefined => assessCanonicalAnalysisReadiness(g).blockingIssues
  .find((i) => i.code === 'MISSING_FACTOR_LEVEL' && i.factor_id === 'visits')?.message;

describe('a level given as stated cases, each with its probability, is never asked for again (VERIFIER C6)', () => {
  const sentence = 'With no outreach we would see 30, 45 or 70 walk-in visits next week, at 20 percent, 60 percent and 20 percent.';

  it('C6\'s shape: the brief\'s words kept three times as speaker-unknown descriptions get the limitation words, and the Run still waits', () => {
    const g = graphWith([unboundCase(sentence), unboundCase(sentence), unboundCase(sentence)]);
    expect(visitsAsk(g)).toBe(CASES_ASK(LABEL));
    expect(resolveRunAdmission(g).willProceed).toBe(false);
  });

  it('three cases read as the user\'s points, with percentage signs, get the same words', () => {
    const q = 'Walk-ins next week: 30 (20%), 45 (60%) or 70 (20%).';
    expect(visitsAsk(graphWith([pointCase(q, 30), pointCase(q, 45), pointCase(q, 70)]))).toBe(CASES_ASK(LABEL));
  });

  it('the cases\' own period is named where the label does not say it', () => {
    const q = 'Callbacks could be 10, 20 or 40, at 25%, 50% and 25%.';
    const period = { period: 'per day' };
    expect(visitsAsk(graphWith([pointCase(q, 10, period), pointCase(q, 20, period), pointCase(q, 40, period)])))
      .toBe(CASES_ASK(`${LABEL} per day`));
  });

  it('the words carry no figure (never zero, never the cases\' mean of 47), and claim no saved support', () => {
    const ask = visitsAsk(graphWith([unboundCase(sentence), unboundCase(sentence), unboundCase(sentence)]))!;
    expect(ask).not.toMatch(/\d|\bzero\b|\baverage\b|\bsaved\b/i);
  });
});

describe('CONTROLS: anything short of stated cases with their probabilities keeps today\'s ask', () => {
  it.each([
    ['no statement at all', []],
    ['a single level', [pointCase('About 45 walk-ins next week.', 45)]],
    ['several cases with no probabilities', [pointCase('Maybe 30 or 45 walk-ins.', 30), pointCase('Maybe 30 or 45 walk-ins.', 45)]],
    ['probabilities that cover only part of the cases', [pointCase('30 (20%) or 45 (30%) walk-ins.', 30), pointCase('30 (20%) or 45 (30%) walk-ins.', 45)]],
    ['levels that are themselves percentages', [
      { ...pointCase('Return rate of 40% or 60%.', 40), unit: '%' }, { ...pointCase('Return rate of 40% or 60%.', 60), unit: '%' }]],
    ['one kept level with a confidence split is no set of cases', [pointCase('About 45 walk-ins: 90% sure, 10% not.', 45)]],
    ['levels for two different periods are not cases of one quantity', [
      pointCase('About 30 a day (50%) and 200 a week (50%).', 30, { period: 'per day' }),
      pointCase('About 30 a day (50%) and 200 a week (50%).', 200, { period: 'per week' })]],
  ] as const)('%s', (_case, statements) => {
    expect(visitsAsk(graphWith(statements as readonly Rec[]))).toBe(TODAY_ASK);
  });
  it('cases kept on another field (how strongly it drives the goal) are not its level', () => {
    const q = 'It could add 10, 20 or 40 visits, at 25%, 50% and 25%.';
    expect(visitsAsk(graphWith([pointCase(q, 10), pointCase(q, 20), pointCase(q, 40)], 'relation'))).toBe(TODAY_ASK);
  });
});
