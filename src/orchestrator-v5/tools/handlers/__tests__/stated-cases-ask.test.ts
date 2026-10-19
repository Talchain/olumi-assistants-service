/**
 * ⭐ RECORDED CASES, NOT A MISSING LEVEL (AIE 11:54Z, packet AIE-RECORDED-CASE-LIMITATION-AND-LIVE-GOAL-RECOVERY-SCOPE-20261019-v1, exact
 * words; VERIFIER C6). A user who gave a factor's level as several cases is never asked "What is it today… treat it as zero". Each
 * statement counts only at its own evidence strength: the user's distinct bound figures are "different cases"; one sentence read as
 * several unbound level readings (C6) is "the recorded information". No probability is read from the words (Codex R1 on #3451: quote-wide
 * percentages, duplicate levels and near-100 totals claimed a distribution), so the probability-for-each-case words are never served
 * until a distribution has a carrier. An ordinary missing level keeps today's ask. The Run still waits. SYNTHETIC wording.
 */
import { describe, expect, it } from 'vitest';
import { resolveRunAdmission } from '../analysis-ready-core.js';
import { assessCanonicalAnalysisReadiness } from '../../../../orchestrator/tools/analysis-ready-helper.js';

type Rec = Record<string, unknown>;
const LABEL = 'Walk-in visits next week';
const TODAY_ASK = `What is "${LABEL}" today, before any option changes it? Without a current level the analysis would treat it as zero.`;
const CASES = (what: string): string => `You supplied different cases for ‘${what}’. This calculation cannot yet use them together faithfully. `
  + 'We can still reason through each case and what it would mean.';
const RECORDED = (what: string): string => `This calculation cannot yet use the recorded information about ‘${what}’ faithfully. `
  + 'We can still reason through that information and what it would mean.';

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
/** The brief's words, kept verbatim because the quote check could not bind them as one statement (C6's shape). */
const unbound = (quote: string): Rec => ({ speaker: 'unknown', quote, source: quote, subject, form: 'describes', reading: 'olumi' });
const point = (quote: string, value: number, extra: Rec = {}): Rec => ({
  speaker: 'user', quote, source: quote, subject, form: 'point', low: value, high: value, unit: 'visits', reading: 'olumi', ...extra,
});
const points = (quote: string, values: readonly number[], extra: Rec = {}): Rec[] => values.map((v) => point(quote, v, extra));
const visitsAsk = (g: Rec): string | undefined => assessCanonicalAnalysisReadiness(g).blockingIssues
  .find((i) => i.code === 'MISSING_FACTOR_LEVEL' && i.factor_id === 'visits')?.message;
const C6_LIKE = 'With no outreach we would see 30 walk-in visits next week with probability 20 percent, 45 with probability 60 percent, or 70 '
  + 'with probability 20 percent.';

describe('several cases for one quantity are never asked for again, each at its own evidence strength (VERIFIER C6)', () => {
  it('C6\'s shape: one sentence kept as three unbound level readings is the recorded information, and the Run still waits', () => {
    const g = graphWith([unbound(C6_LIKE), unbound(C6_LIKE), unbound(C6_LIKE)]);
    expect(visitsAsk(g)).toBe(RECORDED(LABEL));
    expect(resolveRunAdmission(g).willProceed).toBe(false);
  });

  it('three distinct figures of the user\'s own are their different cases, never a distribution read from the percentages', () => {
    expect(visitsAsk(graphWith(points('Walk-ins next week: 30 (20%), 45 (60%) or 70 (20%).', [30, 45, 70])))).toBe(CASES(LABEL));
  });

  it('the cases\' own period is named where the label does not say it', () => {
    expect(visitsAsk(graphWith(points('Callbacks could be 10, 20 or 40, at 25%, 50% and 25%.', [10, 20, 40], { period: 'per day' }))))
      .toBe(CASES(`${LABEL} per day`));
  });

  it('the words carry no figure (never zero, never the cases\' mean of 47), and claim no saved support', () => {
    for (const ask of [visitsAsk(graphWith([unbound(C6_LIKE), unbound(C6_LIKE)]))!, visitsAsk(graphWith(points('30 or 45.', [30, 45])))!]) {
      expect(ask).not.toMatch(/\d|\bzero\b|\baverage\b|\bsaved\b/i);
    }
  });
});

describe('every other shape: the words say only what the kept statements support', () => {
  it.each([
    ['no statement at all: an ordinary missing level', [], TODAY_ASK],
    ['a single level', [point('About 45 walk-ins next week.', 45)], TODAY_ASK],
    ['several cases with no probabilities (AIE 11:54Z: their different cases)', points('Maybe 30 or 45 walk-ins.', [30, 45]), CASES(LABEL)],
    ['probabilities that cover only part of the cases', points('30 (20%) or 45 (30%) walk-ins.', [30, 45]), CASES(LABEL)],
    ['levels that are themselves percentages', points('Return rate of 40% or 60%.', [40, 60], { unit: '%' }), CASES(LABEL)],
    ['one kept level with a confidence split is no set of cases', [point('About 45 walk-ins: 90% sure, 10% not.', 45)], TODAY_ASK],
    ['levels for two different periods are not cases of one quantity', [
      point('About 30 a day (50%) and 200 a week (50%).', 30, { period: 'per day' }),
      point('About 30 a day (50%) and 200 a week (50%).', 200, { period: 'per week' })], TODAY_ASK],
    // Codex R1 probes (held-out shapes): never the probability-for-each-case words.
    ['Codex R1: another quantity\'s percentages in the same sentence', points('We expect 30 or 45 walk-in visits next week; online conversion is 20% or 80%.', [30, 45]), CASES(LABEL)],
    ['Codex R1: one level repeated is no set of cases', points('45 walk-ins (25%), 45 (50%) or 45 (25%).', [45, 45, 45]), TODAY_ASK],
    ['Codex R1: a case with no probability', points('30 walk-ins (20%), 45 (80%) or 70.', [30, 45, 70]), CASES(LABEL)],
    ['Codex R1: probabilities that total 99%', points('30 walk-ins (20%), 45 (60%) or 70 (19%).', [30, 45, 70]), CASES(LABEL)],
    ['Codex R1: probabilities that total 101%', points('30 walk-ins (20%), 45 (60%) or 70 (21%).', [30, 45, 70]), CASES(LABEL)],
    // An ordinary missing level with words about it is still asked for (AIE 11:54Z: the fallback is never for every missing baseline).
    ['one unbound reading of the brief\'s words', [unbound('Walk-ins have been patchy lately.')], TODAY_ASK],
    ['two different unbound sentences about the quantity', [unbound('Walk-ins have been patchy lately.'), unbound('Walk-ins dipped after the move.')], TODAY_ASK],
  ] as const)('%s', (_case, statements, expected) => {
    const ask = visitsAsk(graphWith(statements as readonly Rec[]));
    expect(ask).toBe(expected);
    expect(ask).not.toMatch(/probability/i);
  });

  it('cases kept on another field (how strongly it drives the goal) are not its level', () => {
    expect(visitsAsk(graphWith(points('It could add 10, 20 or 40 visits.', [10, 20, 40]), 'relation'))).toBe(TODAY_ASK);
  });
});
