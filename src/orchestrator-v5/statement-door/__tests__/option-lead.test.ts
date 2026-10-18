/**
 * ⭐ M3c (AIE #94 6181933060; spike S8 route B): each option's own lead on the ONE statement door, and the reading at the target's
 * month it gives. Two briefs:
 *  · served hiring negative r4 (CEE e7f95dc6, turn 9, before Paul's timing answer): "The tech lead would lift productivity from
 *    month 2, and each developer from month 2." Every Run withheld the chance at month 3; the goal-wide forecast (M3b) could not
 *    read a per-option sentence;
 *  · a level-at-month brief (support response time at month 6), for L = M (the boundary) and a lead that is after M.
 * Rules: L ≤ M → in place at M; L > M → the option stays visible, its chance at M not part of the scored set; a straddling lead →
 * withheld (two conditional chances are not representable on today's engine); never the k law on a level at M.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyStatementRecordEdit } from '../../goal-target/cohort-forecast-write.js';
import { goalHorizonVerdict, withholdOptionsNotInPlaceAtPeriodEnd } from '../../goal-target/goal-horizon-verdict.js';
import { withGoalChanceLicence } from '../../goal-target/goal-chance-licence.js';
import { goalTargetBasisIn, optionTimingAtPeriodEnd, timingBasisNote, classifyOptionLead } from '../fields/goal-timing.js';
import { OPTION_LEAD_ROW } from '../fields/option-lead.js';
import { boundReading, readStatement } from '../read.js';
import { doorRowFor } from '../role-table.js';

type Rec = Record<string, any>;
const HIRING = (): Rec => JSON.parse(readFileSync(new URL('./fixtures/hiring-negative-r4-turn09.json', import.meta.url), 'utf8')).graph as Rec;
const SAID = 'The tech lead would lift productivity from month 2, and each developer from month 2.';
const goalOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'goal');
const kinds = (g: Rec): Record<string, string> => Object.fromEntries((optionTimingAtPeriodEnd(g, goalOf(g).id)?.options ?? []).map((o) => [o.option_id, o.kind]));

/** The door's whole path for one option: read and bind the words, prepare the write, and apply it (the press's writer). */
function record(g: Rec, id: string, label: string, quote: string, words: string): Rec {
  const subject = { kind: 'option' as const, id, field: 'lead' as const };
  const v = readStatement(g, subject, label, [{ quote, reading_words: words }], { now: quote } as never, {});
  if (v.kind !== 'read') throw new Error(`${id}: ${JSON.stringify(v)}`);
  const row = doorRowFor(subject, g)!;
  expect(row).toBe(OPTION_LEAD_ROW);
  const w = row.writer.approve(v.reading, g) as Rec;
  expect(w.member, JSON.stringify(w)).toBe('statement_record');
  const r = applyStatementRecordEdit(g, w.payload) as Rec;
  expect(r.kind).toBe('mutated');
  expect(row.writer.holds(w as never, r.mutatedGraph)).toBe(true);
  return r.mutatedGraph;
}
const withAll = (g: Rec, quote = SAID, devWords = 'each developer from month 2'): Rec => {
  let out = record(g, 'hire_a_tech_lead', 'Hire a Tech lead', quote, 'lift productivity from month 2');
  out = record(out, 'hire_two_developers', 'Hire two developers', quote, devWords);
  return record(out, 'hire_one_developer', 'Hire one developer', quote, devWords);
};

/** A Run's per-option rows as PLoT returns them: a goal chance, a win share and an outcome each. */
const envelope = (ids: readonly string[]): Rec => ({
  option_comparison: ids.map((id, i) => ({ option_id: id, probability_of_goal: 0.4 + i / 10, probability_of_goal_precision: { ci_low: 0.3, ci_high: 0.6 },
    win_probability: 1 / ids.length, outcome: { mean: 1 + i, p10: 0, p90: 2 } })),
  inference_warnings: [],
});
const row = (env: Rec, id: string): Rec => env.option_comparison.find((r: Rec) => r.option_id === id);

describe('M3c on served hiring negative r4: each option\'s own lead gives the chance at month 3', () => {
  it('PRECONDITION: no lead recorded → no reading at month 3 (the Run\'s static path, as served)', () => {
    const g = HIRING();
    expect(goalTargetBasisIn(g, goalOf(g))?.effects_at_period_end).toBe(false);
    expect(goalHorizonVerdict(g)).toBe('no_horizon');
    expect(kinds(g)).toEqual({ hire_a_tech_lead: 'unknown', hire_one_developer: 'unknown', hire_two_developers: 'unknown' });
  });

  it('RED: Paul\'s sentence binds each option by its OWN clause; all three are in place at month 3; the reading is at month 3 and says why', () => {
    const before = HIRING();
    const g = withAll(before);
    expect(kinds(g)).toEqual({ hire_a_tech_lead: 'in_place', hire_one_developer: 'in_place', hire_two_developers: 'in_place' });
    expect(goalTargetBasisIn(g, goalOf(g))?.effects_at_period_end).toBe(true);
    expect(goalHorizonVerdict(g)).toBe('basis_at_h');
    // The stored goal's own reading is unchanged: the reading at month 3 is the leads', never written onto the goal.
    expect(goalOf(g).goal_target_basis).toEqual(goalOf(before).goal_target_basis);
    expect(timingBasisNote(g, goalOf(g).id, goalTargetBasisIn(g, goalOf(g))!)).toBe(`Timing basis: you stated “${SAID}”. This calculation reads `
      + '‘Hire a Tech lead’ and ‘Hire two developers’ as fully in place by month two, counted from today as your target is, '
      + 'and so in place at month three from today. It assumes no further build-up after that point and holds everything else at today’s level; '
      + 'it does not model when the effects arrive.');
    // Recording a lead stales the stored Run (it decides what may be said); the Run's own figures stay in place.
    expect(computeAnalysisAffectingGraphHash(g as never)).not.toBe(computeAnalysisAffectingGraphHash(before as never));
    expect(withholdOptionsNotInPlaceAtPeriodEnd(envelope(['keep_current_team', 'hire_a_tech_lead', 'hire_two_developers']), g))
      .toEqual(envelope(['keep_current_team', 'hire_a_tech_lead', 'hire_two_developers']));
  });

  it('⭐ RED (the headline): no chance at month 3 is licensed before the leads; after, each option\'s chance is licensed with the timing basis first', () => {
    const run = (): Rec => ({ option_comparison: [
      { option_id: 'keep_current_team', probability_of_goal: 0, win_probability: 0.1, outcome: { mean: 0 } },
      { option_id: 'hire_a_tech_lead', probability_of_goal: 0.62, win_probability: 0.5, outcome: { mean: 0.11 } },
      { option_id: 'hire_two_developers', probability_of_goal: 0.41, win_probability: 0.4, outcome: { mean: 0.07 } }], inference_warnings: [] });
    const licensed = (g: Rec): Rec | undefined => ((withGoalChanceLicence(run(), g, 'productivity') as Rec).inference_warnings as Rec[])
      .find((w) => w.code === 'GOAL_CHANCE_LICENSED');
    expect(licensed(HIRING())).toBeUndefined();
    const l = licensed(withAll(HIRING()))!;
    expect(l.option_ids).toEqual(['keep_current_team', 'hire_a_tech_lead', 'hire_two_developers']);
    expect(l.notes[0]).toMatch(/^Timing basis: you stated “The tech lead would lift productivity from month 2, and each developer from month 2\.”\. This calculation reads ‘Hire a Tech lead’ and ‘Hire two developers’ as fully in place by month two/);
  });

  it('RED (L > M): the developers "not until month 4" → visible, their chance at month 3 not part of the scored set, no ranking; the tech lead keeps its chance', () => {
    const quote = 'The tech lead would lift productivity from month 2, but each developer not until month 4.';
    const g = withAll(HIRING(), quote, 'each developer not until month 4');
    expect(kinds(g)).toEqual({ hire_a_tech_lead: 'in_place', hire_one_developer: 'later', hire_two_developers: 'later' });
    expect(goalHorizonVerdict(g)).toBe('basis_at_h');
    const out = withholdOptionsNotInPlaceAtPeriodEnd(envelope(['keep_current_team', 'hire_a_tech_lead', 'hire_two_developers']), g) as Rec;
    expect(row(out, 'hire_a_tech_lead').probability_of_goal).toBe(0.5);
    expect(row(out, 'hire_two_developers')).not.toHaveProperty('probability_of_goal');
    // The option stays: its row and outcome are kept; only the claims against the target and every share go.
    expect(row(out, 'hire_two_developers').outcome).toEqual({ mean: 3, p10: 0, p90: 2 });
    for (const r of out.option_comparison) expect(r).not.toHaveProperty('win_probability');
    const w = out.inference_warnings.find((x: Rec) => x.code === 'GOAL_FIGURES_OPTION_NOT_IN_PLACE');
    // Only options this Run scored are named (Olumi's "Hire one developer" was left out of this Run).
    expect(w.option_ids).toEqual(['hire_two_developers']);
    expect(w.say).toBe('‘Hire two developers’ is not fully in place by month three from today on your forecast (not before month four), so its chance at that '
      + 'point is not part of this scored set. The options are not ranked against each other here, because that comparison would count an effect '
      + 'that is not yet in place.');
    expect(w.say).not.toMatch(/no change|same as|best|winner|recommend/i);
  });

  it('RED (straddle): "between month 2 and month 4" spans month 3 → that option\'s chance is withheld, never a guessed law', () => {
    const quote = 'The tech lead would lift productivity from month 2, and each developer somewhere between month 2 and month 4.';
    const g = withAll(HIRING(), quote, 'each developer somewhere between month 2 and month 4');
    expect(kinds(g)).toMatchObject({ hire_two_developers: 'straddles' });
    const w = (withholdOptionsNotInPlaceAtPeriodEnd(envelope(['hire_a_tech_lead', 'hire_two_developers']), g) as Rec).inference_warnings[0];
    expect(w.say).toContain('‘Hire two developers’ may or may not be fully in place by month three from today on your forecast (between month two and month four)');
  });

  it('CONTRAST: a clause about ANOTHER option never binds; a conditional forecast attests nothing; one option without a lead keeps the static path', () => {
    const g = HIRING();
    // The tech lead's clause, offered for the developers: it names the tech lead, so it is not about them.
    const wrong = readStatement(g, { kind: 'option', id: 'hire_two_developers', field: 'lead' }, 'Hire two developers',
      [{ quote: SAID, reading_words: 'lift productivity from month 2' }], { now: SAID } as never, {});
    // ⭐ GATE → LABEL (change 1): never bound as theirs: a labelled reading whose item is Olumi's reading (the binder binds it to neither).
    expect(wrong).toMatchObject({ kind: 'read', reading: { binding: {},
      statements: [{ checks: { words_found: true, figure_found: true, unit_found: true, subject_bound: false } }] } });
    expect(boundReading(wrong)).toBe(false);
    // Conditional: recorded as said, never in place.
    const cond = 'If we hire before November, the tech lead would lift productivity from month 2, and each developer from month 2.';
    const c = withAll(g, cond);
    expect(kinds(c)).toEqual({ hire_a_tech_lead: 'unknown', hire_one_developer: 'unknown', hire_two_developers: 'unknown' });
    expect(goalTargetBasisIn(c, goalOf(c))?.effects_at_period_end).toBe(false);
    // Only the tech lead's lead: the developers' are unknown, so nothing is read at month 3.
    const one = record(g, 'hire_a_tech_lead', 'Hire a Tech lead', SAID, 'lift productivity from month 2');
    expect(goalTargetBasisIn(one, goalOf(one))?.effects_at_period_end).toBe(false);
    expect(goalHorizonVerdict(one)).toBe('no_horizon');
  });

  it('CONTRAST (stale): an option\'s setting changed after its lead was recorded → the lead is stale, nothing is read at month 3', () => {
    const g = withAll(HIRING());
    const moved = structuredClone(g);
    const lead = moved.nodes.find((n: Rec) => n.id === 'hire_a_tech_lead');
    lead.interventions.tech_lead_headcount = { ...lead.interventions.tech_lead_headcount, value: 2 };
    expect(kinds(moved).hire_a_tech_lead).toBe('stale');
    expect(goalTargetBasisIn(moved, goalOf(moved))?.effects_at_period_end).toBe(false);
  });
});

/** A level target at month 6, two options with an effect on it, and carrying on as now. */
const SUPPORT = (): Rec => {
  const basis = { ...goalOf(HIRING()).goal_target_basis, target_raw: 4, target_frame: 'level', quantity_frame: 'level', period_months: 6,
    denominator: undefined, effect_unit: 'hours', also_required: [] };
  delete basis.denominator;
  const edge = (from: string, to: string): Rec => ({ from, to, strength: { mean: -0.4, std: 0.1 }, exists_probability: 0.8, effect_direction: 'negative', provenance: 'from_brief' });
  return {
    nodes: [
      { id: 'how_to_cut_response_time', kind: 'decision', label: 'How should we cut response time?' },
      { id: 'response_time', kind: 'goal', label: 'Response time', goal_threshold: 4, goal_threshold_raw: 4, goal_direction: '<=', goal_target_basis: basis },
      { id: 'carry_on_as_now', kind: 'option', label: 'Carry on as now', is_baseline: true, interventions: {} },
      { id: 'hire_a_support_lead', kind: 'option', label: 'Hire a support lead', interventions: { support_lead_headcount: { value: 1 } } },
      { id: 'buy_a_chatbot', kind: 'option', label: 'Buy a chatbot', interventions: { chatbot_coverage: { value: 1 } } },
      { id: 'support_lead_headcount', kind: 'factor', label: 'Support lead headcount' },
      { id: 'chatbot_coverage', kind: 'factor', label: 'Chatbot coverage' },
    ],
    edges: [edge('support_lead_headcount', 'response_time'), edge('chatbot_coverage', 'response_time')],
  };
};

describe('M3c on a level-at-month brief (response time at month 6): the boundary L = M, and a lead after M', () => {
  const SUPPORT_SAID = 'A support lead would be fully effective by month 6, but the chatbot wouldn’t be ready until month 8.';

  it('PRECONDITION: the brief\'s goal is a level read at the end of month 6, with two option effects', () => {
    const g = SUPPORT();
    expect(goalTargetBasisIn(g, goalOf(g))).toMatchObject({ period_months: 6, period_kind: 'at_end', effects_at_period_end: false });
    expect(kinds(g)).toEqual({ buy_a_chatbot: 'unknown', hire_a_support_lead: 'unknown' });
  });

  it('RED: "by month 6" is in place AT month 6 (L = M); "wouldn\'t be ready until month 8" is after it, withheld and visible', () => {
    let g = record(SUPPORT(), 'hire_a_support_lead', 'Hire a support lead', SUPPORT_SAID, 'fully effective by month 6');
    g = record(g, 'buy_a_chatbot', 'Buy a chatbot', SUPPORT_SAID, 'the chatbot wouldn’t be ready until month 8');
    expect(kinds(g)).toEqual({ buy_a_chatbot: 'later', hire_a_support_lead: 'in_place' });
    expect(goalHorizonVerdict(g)).toBe('basis_at_h');
    const out = withholdOptionsNotInPlaceAtPeriodEnd(envelope(['carry_on_as_now', 'hire_a_support_lead', 'buy_a_chatbot']), g) as Rec;
    expect(row(out, 'hire_a_support_lead').probability_of_goal).toBe(0.5);
    expect(row(out, 'buy_a_chatbot')).not.toHaveProperty('probability_of_goal');
    expect(out.inference_warnings[0].say).toContain('‘Buy a chatbot’ is not fully in place by month six from today on your forecast (not before month eight)');
  });

  it('the ONE rule, at the boundary and either side (never the k law)', () => {
    const at = (high?: number, low?: number) => classifyOptionLead({ ...(high !== undefined ? { high } : {}), ...(low !== undefined ? { low } : {}), stance: 'affirmed' }, 6);
    expect([at(6, 6), at(5), at(6), at(7, 7), at(undefined, 7), at(7, 5), at(undefined, 6)]).toEqual(['in_place', 'in_place', 'in_place', 'later', 'later', 'straddles', 'straddles']);
    expect(classifyOptionLead({ low: 6, low_exclusive: true, stance: 'denied' }, 6)).toBe('later');
    expect(classifyOptionLead({ high: 2, stance: 'conditional' }, 6)).toBe('unknown');
  });
});
