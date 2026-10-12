/**
 * Recovery Batch C — the goal-chance licence says the ruled sentence for a CHANGE target, labels Olumi's starting value as
 * estimate_only, and, with several targets, makes the same-draw joint the headline or withholds it with its reason
 * (Batch 0 change-goal decision rulings 15–22; amendments 1–7; DL amendment 22:15Z). Hand-written figures throughout: the
 * licence never computes a chance, it decides what may be said about the Run's own.
 */
import { describe, expect, it } from 'vitest';

import { goalChanceLicenceForAgent, goalChanceLicenceOf, goalChancePointForAgent, nearestFiveGoalChancesForAgent, withGoalChanceLicence } from '../goal-chance-licence.js';
import { goalHorizonVerdict } from '../goal-horizon-verdict.js';
import { withholdForOpenTargetQuestion } from '../goal-chance-gate.js';
import { wireGoalConstraints } from '../../tools/handlers/run-analysis.js';
import { goalChanceNotesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';
import { projectCanonicalAnalysisCells } from '../../../routes/canonical-analysis-view.js';
import { withholdOptionLimitScores } from '../../../orchestrator/context/constraint-feasibility.js';

type Rec = Record<string, unknown>;

// ── Hiring: productivity, % change from today; +10 by month three ─────────────────────────────────────────────────────
const HIRING_BASIS = {
  quantity_frame: 'change', target_frame: 'change_abs', target_raw: 10, reference: 'today',
  denominator: 'today’s productivity (monthly development capacity)', period_months: 3, period_kind: 'at_end',
  effect_unit: '% of today’s productivity per added person, at month three', effects_at_period_end: true,
  also_required: ['code quality maintained', 'spend within £200,000'], source: 'olumi_reading',
};
const hiringGraph = (goal: Rec = {}, extra: Rec = {}): Rec => ({
  nodes: [
    { id: 'productivity', kind: 'goal', label: 'Productivity', quantity_frame: 'change', goal_threshold_frame: 'change_abs',
      goal_threshold_raw: 10, goal_threshold_unit: '%', goal_threshold_cap: 100, goal_threshold: 0.1, goal_direction: '>=',
      goal_horizon_months: 3, goal_target_basis: HIRING_BASIS, ...goal },
    { id: 'hire_a_tech_lead', kind: 'option', label: 'Hire a tech lead' },
    { id: 'hire_two_developers', kind: 'option', label: 'Hire two developers' },
    { id: 'carry_on', kind: 'option', label: 'Carry on with the current team', is_baseline: true },
    { id: 'cost', kind: 'factor', label: 'First-year hiring cost' },
  ],
  edges: [],
  goal_constraints: [{ constraint_id: 'agent-lane:cost:<=', node_id: 'cost', operator: '<=', value: 200000, unit: 'GBP', value_frame: 'level' }],
  ...extra,
});
const hiringRun = (): Rec => ({
  option_comparison: [
    { option_id: 'hire_a_tech_lead', probability_of_goal: 0.46 },
    { option_id: 'hire_two_developers', probability_of_goal: 0.31 },
    // ISL's paired status quo: its change is exactly 0 on every draw, so P(change ≥ 10) is exactly 0 — by assumption.
    { option_id: 'carry_on', probability_of_goal: 0 },
  ],
});
const hiringConstraints = (g: Rec) => ({ storedConstraints: g.goal_constraints, sentConstraints: wireGoalConstraints(g.goal_constraints) });

describe('hiring — a change of +10% from today has its ruled sentence (ruling 20) and its disclosures (amendments 1, 2, 4)', () => {
  it('RED: licensed per option, worded "productivity being at least 10% higher than today at three months"', () => {
    const g = hiringGraph();
    const l = goalChanceLicenceOf(hiringRun(), g, 'productivity', () => false, undefined, g, hiringConstraints(g));
    expect(l).not.toBeNull();
    expect(l!.pct_by_option).toEqual({ hire_a_tech_lead: 46, hire_two_developers: 31 });
    expect(l!.chance_words).toBe('chance of ‘Productivity’ being at least 10% higher than today at three months');
    expect(l!.target).toMatchObject({ comparator: 'at_least', value: 10, unit: '%', frame: 'change_abs' });
  });

  it('RED (amendment 1): the status quo is no change BY ASSUMPTION — never a figure or an interval — and the assumption is said', () => {
    const g = hiringGraph();
    const l = goalChanceLicenceOf(hiringRun(), g, 'productivity', () => false, undefined, g, hiringConstraints(g))!;
    expect(l.withheld_option_ids).toEqual(['carry_on']);
    expect(l.pct_by_option).not.toHaveProperty('carry_on');
    expect(l.status_quo).toEqual({ option_id: 'carry_on', line: 'Doing nothing: no change to ‘Productivity’ in this model, by assumption.' });
    expect(l.notes).toContain('This assumes carrying on as now leaves ‘Productivity’ unchanged through month three; each option is measured against that.');
  });

  it('RED (amendment 2, DL hiring decision): effects are their size at month three incl. recruitment and ramp-up, and added', () => {
    const g = hiringGraph();
    const l = goalChanceLicenceOf(hiringRun(), g, 'productivity', () => false, undefined, g, hiringConstraints(g))!;
    expect(l.notes).toContain('Each option’s effects are read as their size at month three, including recruitment and ramp-up '
      + '(% of today’s productivity per added person, at month three), and are added together: twice the change counts twice, '
      + 'with no diminishing returns, interactions or extra onboarding drag modelled.');
  });

  it('RED (amendment 4): "productivity only" — the £200,000 limit said once (typed), and code quality from the brief', () => {
    const g = hiringGraph();
    const l = goalChanceLicenceOf(hiringRun(), g, 'productivity', () => false, undefined, g, hiringConstraints(g))!;
    expect(l.notes).toContain('This chance covers ‘Productivity’ only. It does not include: ‘First-year hiring cost’ at most £200,000; code quality maintained.');
  });

  it('NEGATIVE (ruling 11): a change target with no stated basis is not licensed', () => {
    const g = hiringGraph({ goal_target_basis: undefined });
    expect(goalChanceLicenceOf(hiringRun(), g, 'productivity', () => false, undefined, g, hiringConstraints(g))).toBeNull();
  });

  it('NEGATIVE (ruling 12, amendment 2): effects NOT stated at month three → no "at three months" chance (never steady state)', () => {
    const g = hiringGraph({ goal_target_basis: { ...HIRING_BASIS, effects_at_period_end: false } });
    expect(goalChanceLicenceOf(hiringRun(), g, 'productivity', () => false, undefined, g, hiringConstraints(g))).toBeNull();
  });

  it('with no held month, the at-period-end basis itself is the horizon the chance states (and never "no horizon")', () => {
    expect(goalHorizonVerdict(hiringGraph({ goal_horizon_months: undefined }))).toBe('basis_at_h');
    expect(goalHorizonVerdict(hiringGraph({ goal_horizon_months: undefined, goal_target_basis: undefined }))).toBe('no_horizon');
  });

  it('NEGATIVE: a basis for a target since edited (stale key) is never applied', () => {
    const g = hiringGraph({ goal_threshold_raw: 12 });
    expect(goalChanceLicenceOf(hiringRun(), g, 'productivity', () => false, undefined, g, hiringConstraints(g))).toBeNull();
  });

  it('NEGATIVE (amendment 3): an open question withholds every option\'s chance with the question itself as the reason', () => {
    const q = 'Should “at least 10%” mean 10% more development capacity than today, or 10 more percentage points of time on development?';
    const g = hiringGraph({ goal_target_basis: { ...HIRING_BASIS, open_question: q } });
    expect(goalChanceLicenceOf(hiringRun(), g, 'productivity', () => false, undefined, g, hiringConstraints(g))).toBeNull();
    const held = withholdForOpenTargetQuestion(hiringRun(), g, 'productivity') as Rec;
    expect((held.option_comparison as Rec[]).every((r) => !('probability_of_goal' in r))).toBe(true);
    expect((held.inference_warnings as Rec[])[0]).toMatchObject({
      code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE', message: `Not shown. Your target can be read more than one way. ${q}`,
    });
  });

  it('the horizon (amendment 2): at-horizon effects at the held month license "at three months"; anything else withholds', () => {
    expect(goalHorizonVerdict(hiringGraph())).toBe('basis_at_h');
    // Steady state is never assumed: effects not stated at the period's end → withheld.
    expect(goalHorizonVerdict(hiringGraph({ goal_target_basis: { ...HIRING_BASIS, effects_at_period_end: false } }))).toBe('withhold');
    // A basis for another month than the held one → withheld.
    expect(goalHorizonVerdict(hiringGraph({ goal_target_basis: { ...HIRING_BASIS, period_months: 6 } }))).toBe('withhold');
    expect(goalHorizonVerdict(hiringGraph({ goal_target_basis: undefined }))).toBe('withhold');
  });
});

// ── estimate_only: a relative change on Olumi's starting value ───────────────────────────────────────────────────────────
const mrrGraph = (source: string): Rec => ({
  nodes: [
    { id: 'mrr', kind: 'goal', label: 'MRR', goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.1, goal_threshold: 0.1,
      goal_threshold_unit: 'GBP/month', goal_threshold_cap: 27500, goal_direction: '>=',
      observed_state: { value: 20000 / 27500, baseline: 20000 / 27500, unit: 'GBP/month', source, raw_value: 20000, cap: 27500 },
      goal_target_basis: { quantity_frame: 'level', target_frame: 'change_rel', target_raw: 0.1, reference: 'today',
        denominator: 'today’s MRR', period_months: 3, period_kind: 'at_end', effect_unit: 'GBP/month per change', effects_at_period_end: true,
        source: 'olumi_reading' } },
    { id: 'a', kind: 'option', label: 'Raise prices' },
    { id: 'b', kind: 'option', label: 'Add a tier' },
  ],
  edges: [],
});
const mrrRun = { option_comparison: [{ option_id: 'a', probability_of_goal: 0.5 }, { option_id: 'b', probability_of_goal: 0.25 }] };

describe('estimate_only (ruling 9; amendments 7 and 10)', () => {
  it('RED: on Olumi\'s £20,000 / month the chance is labelled a provisional estimate whose base uncertainty is excluded', () => {
    const g = mrrGraph('cee_inference');
    const l = goalChanceLicenceOf(mrrRun, g, 'mrr', () => false, undefined, g)!;
    expect(l.estimate_only).toEqual({ base: 20000, unit: 'GBP/month' });
    expect(l.provisional).toBe(true);
    expect(l.notes![0]).toBe('Provisional estimate using Olumi’s assumed starting value: £20,000 / month. That starting value’s own uncertainty is not included.');
    expect(l.chance_words).toBe('chance of ‘MRR’ being at least 10% higher than today at three months');
  });

  it('CONTROL (ruling 21): on the user\'s own level the base is said as theirs, and nothing is estimate_only', () => {
    const g = mrrGraph('brief_extraction');
    const l = goalChanceLicenceOf(mrrRun, g, 'mrr', () => false, undefined, g)!;
    expect(l.estimate_only).toBeUndefined();
    expect(l.notes![0]).toBe('Using £20,000 / month as today’s ‘MRR’.');
  });

  it('NEGATIVE: no starting value at all → no licence (a base is never guessed)', () => {
    const g = mrrGraph('cee_inference');
    (g.nodes as Rec[])[0]!.observed_state = undefined;
    expect(goalChanceLicenceOf(mrrRun, g, 'mrr', () => false, undefined, g)).toBeNull();
  });
});

// ── Marketing: conversion ABOVE 15% AND at least 20 new customers, over the first three months after launch ─────────────
const MARKETING_BASIS = { quantity_frame: 'level', target_frame: 'level', target_raw: 20, reference: 'launch', period_months: 3,
  period_kind: 'over_period', effect_unit: 'customers and percentage points over the first three months after launch',
  effects_at_period_end: true, source: 'olumi_reading' };
const marketingGraph = (rows?: Rec[]): Rec => ({
  nodes: [
    { id: 'new_customers', kind: 'goal', label: 'New customers', goal_threshold_frame: 'level', goal_threshold_raw: 20,
      goal_threshold_unit: 'customers', goal_threshold_cap: 25, goal_threshold: 0.8, goal_direction: '>=', goal_target_basis: MARKETING_BASIS },
    { id: 'conversion_rate', kind: 'factor', label: 'Conversion rate' },
    { id: 'annual_spend', kind: 'factor', label: 'Annual spend' },
    { id: 'hire_manager', kind: 'option', label: 'Hire a marketing manager' },
    { id: 'ai_plus_ads', kind: 'option', label: 'AI planning plus advertising' },
  ],
  edges: [],
  goal_constraints: rows ?? [
    { constraint_id: 'target:new_customers', node_id: 'new_customers', operator: '>=', value: 20, unit: 'customers', value_frame: 'level', role: 'goal_target' },
    { constraint_id: 'target:conversion_rate', node_id: 'conversion_rate', operator: '>=', operator_as_stated: '>', value: 15, unit: '%', value_frame: 'level', role: 'goal_target' },
  ],
});
const PRECISION = { n_informative: 10000, standard_error: 0.005 };
const marketingRun = (joint: Rec = {}): Rec => ({
  option_comparison: [
    { option_id: 'hire_manager', probability_of_goal: 0.6, probability_of_joint_goal: 0.35, probability_of_joint_goal_precision: PRECISION,
      constraint_probabilities: { 'target:new_customers': 0.6, 'target:conversion_rate': 0.42 },
      constraint_probabilities_precision: { 'target:new_customers': PRECISION, 'target:conversion_rate': PRECISION }, ...joint },
    { option_id: 'ai_plus_ads', probability_of_goal: 0.7, probability_of_joint_goal: 0.48, probability_of_joint_goal_precision: PRECISION,
      constraint_probabilities: { 'target:new_customers': 0.7, 'target:conversion_rate': 0.55 },
      constraint_probabilities_precision: { 'target:new_customers': PRECISION, 'target:conversion_rate': PRECISION }, ...joint },
  ],
});
const licenceFor = (run: Rec, g: Rec = marketingGraph(), sent?: unknown) => goalChanceLicenceOf(run, g, 'new_customers', () => false, undefined, g,
  { storedConstraints: g.goal_constraints, sentConstraints: sent ?? wireGoalConstraints(g.goal_constraints) });

describe('marketing — the same-draw joint is the headline, each target below (rulings 15–17, 22; amendment 5)', () => {
  it('RED: the headline quotes the JOINT (35%, 48%), worded with both targets and their period (amended ruling 22)', () => {
    const l = licenceFor(marketingRun())!;
    expect(l.pct_by_option).toEqual({ hire_manager: 35, ai_plus_ads: 48 });
    expect(l.chance_words).toBe('chance of ‘New customers’ being at least 20 customers and ‘Conversion rate’ being above 15% over the first three months after launch');
    expect(l.form).toBe('each');
    expect(l.targets?.joint.status).toBe('licensed');
  });

  it('RED: each target separately, with its own chance and label', () => {
    const l = licenceFor(marketingRun())!;
    expect(l.targets!.per_target).toEqual([
      expect.objectContaining({ constraint_id: 'target:new_customers', words: '‘New customers’ being at least 20 customers over the first three months after launch',
        pct_by_option: { hire_manager: 60, ai_plus_ads: 70 } }),
      expect.objectContaining({ constraint_id: 'target:conversion_rate', words: '‘Conversion rate’ being above 15% over the first three months after launch',
        pct_by_option: { hire_manager: 42, ai_plus_ads: 55 } }),
    ]);
  });

  it('RED (ruling 16): a limit the Run also sent is NAMED in the headline, with its own period kept apart', () => {
    const g = marketingGraph([...(marketingGraph().goal_constraints as Rec[]),
      { constraint_id: 'limit:spend', node_id: 'annual_spend', operator: '<=', value: 100000, unit: 'GBP', value_frame: 'level' }]);
    const l = licenceFor(marketingRun(), g)!;
    expect(l.chance_words).toBe('chance of ‘New customers’ being at least 20 customers and ‘Conversion rate’ being above 15% over the first three months after launch, '
      + 'while ‘Annual spend’ is at most £100,000');
  });

  it('NEGATIVE (rulings 14, 17): no joint precision → the joint is withheld with its reason; NO marginal product is ever quoted', () => {
    const l = licenceFor(marketingRun({ probability_of_joint_goal_precision: undefined }))!;
    expect(l.pct_by_option).toEqual({});
    expect(l.withheld_option_ids).toEqual(['hire_manager', 'ai_plus_ads']);
    expect(l.targets!.joint).toEqual({ status: 'withheld', reason: 'precision_missing',
      line: 'The chance of meeting both together isn’t calculated yet.',
      frechet_line: 'Meeting both is no more likely than the lower of the two chances.' });
    // 0.6 × 0.42 = 0.252 and 0.7 × 0.55 = 0.385 must never appear as a figure anywhere in the record.
    expect(JSON.stringify(l)).not.toMatch(/"(?:hire_manager|ai_plus_ads)":(?:25|39)\b/);
    // Each target is still said on its own.
    expect(l.targets!.per_target.map((t) => t.pct_by_option)).toEqual([{ hire_manager: 60, ai_plus_ads: 70 }, { hire_manager: 42, ai_plus_ads: 55 }]);
  });

  it('NEGATIVE (ruling 16): "above 15%" sent as ">=" (the old wire) → the joint is withheld, never called "above"', () => {
    const g = marketingGraph();
    const oldWire = (g.goal_constraints as Rec[]).map(({ operator_as_stated: _s, role: _r, ...row }) => row);
    const l = licenceFor(marketingRun(), g, oldWire)!;
    expect(l.targets!.joint).toMatchObject({ status: 'withheld', reason: 'strict_not_preserved' });
    expect(l.pct_by_option).toEqual({});
  });

  it('NEGATIVE: no joint figure returned at all → withheld ("isn\'t calculated yet")', () => {
    const l = licenceFor(marketingRun({ probability_of_joint_goal: undefined, probability_of_joint_goal_precision: undefined }))!;
    expect(l.targets!.joint).toMatchObject({ status: 'withheld', reason: 'not_returned' });
  });

  it('NEGATIVE (amendment 7): a target read against OLUMI\'s own starting value is not said, and the joint waits', () => {
    const g = marketingGraph();
    (g.nodes as Rec[]).find((n) => n.id === 'conversion_rate')!.observed_state = { value: 0.1, raw_value: 10, unit: '%', source: 'cee_inference' };
    const l = licenceFor(marketingRun(), g)!;
    expect(l.targets!.joint).toMatchObject({ status: 'withheld', reason: 'olumi_base' });
    expect(l.targets!.per_target.map((t) => t.constraint_id)).toEqual(['target:new_customers']);
    expect(l.pct_by_option).toEqual({});
  });

  it('CONTROL: a single target with no target rows is exactly today\'s licence (no targets block)', () => {
    const g = marketingGraph([]);
    const l = licenceFor(marketingRun(), g)!;
    expect(l.targets).toBeUndefined();
    expect(l.pct_by_option).toEqual({ hire_manager: 60, ai_plus_ads: 70 });
  });
});

describe('the stored licence is read back by the Agent, the chat and the screen in the same words', () => {
  it('Agent reader keeps the Batch C parts; the chat owes each target and the reasons; the screen cells quote the joint', () => {
    const g = marketingGraph();
    const env = withGoalChanceLicence(marketingRun({ probability_of_joint_goal_precision: undefined }), g, 'new_customers', () => false, undefined, g,
      { storedConstraints: g.goal_constraints, sentConstraints: wireGoalConstraints(g.goal_constraints) });
    const result = { type: 'analysis_result', enrichment: env };
    const forAgent = goalChanceLicenceForAgent(result)!;
    expect(forAgent.targets?.joint.status).toBe('withheld');
    expect(goalChanceNotesForAgent(result, g, true)).toEqual([
      'The chance of meeting both together isn’t calculated yet.',
      'Meeting both is no more likely than the lower of the two chances.',
      'On its own, the chance of ‘New customers’ being at least 20 customers over the first three months after launch, in this model: ‘Hire a marketing manager’ about 60%; ‘AI planning plus advertising’ about 70%.',
      'On its own, the chance of ‘Conversion rate’ being above 15% over the first three months after launch, in this model: ‘Hire a marketing manager’ about 42%; ‘AI planning plus advertising’ about 55%.',
      // Amendment 1, for every target the headline names.
      'This assumes carrying on as now leaves ‘New customers’ and ‘Conversion rate’ unchanged over that period; each option is measured against that.',
      'Each option’s effects are read as their size over the first three months after launch, including recruitment and ramp-up '
        + '(customers and percentage points over the first three months after launch), and are added together: twice the change counts twice, '
        + 'with no diminishing returns, interactions or extra onboarding drag modelled.',
    ]);
    const cells = projectCanonicalAnalysisCells(result as never, g);
    expect(cells.map((c) => [c.option_id, c.cell.kind, (c.cell as Rec).why])).toEqual([
      ['hire_manager', 'withheld', 'The chance of meeting both together isn’t calculated yet. Meeting both is no more likely than the lower of the two chances.'],
      ['ai_plus_ads', 'withheld', 'The chance of meeting both together isn’t calculated yet. Meeting both is no more likely than the lower of the two chances.'],
    ]);
  });

  it('⛔ the Agent is never handed one target\'s marginal as the goal chance when the headline is the joint (ruling 15)', () => {
    const g = marketingGraph();
    const env = withGoalChanceLicence(marketingRun(), g, 'new_customers', () => false, undefined, g,
      { storedConstraints: g.goal_constraints, sentConstraints: wireGoalConstraints(g.goal_constraints) });
    const result = { type: 'analysis_result', enrichment: env };
    const shown = nearestFiveGoalChancesForAgent(result);
    expect(Object.fromEntries(shown)).toEqual({ hire_manager: 0.35, ai_plus_ads: 0.48 });
    // The row's own probability_of_goal (0.6, new customers alone) is replaced by the displayed joint.
    expect(goalChancePointForAgent(0.6, 'about 35%', shown.get('hire_manager'))).toBe(0.35);
  });

  it('hiring on the screen: each option\'s face is the ruled sentence; the status quo reads "No change, by assumption"', () => {
    const g = hiringGraph();
    const env = withGoalChanceLicence(hiringRun(), g, 'productivity', () => false, undefined, g, hiringConstraints(g));
    const cells = projectCanonicalAnalysisCells({ type: 'analysis_result', enrichment: env } as never, g);
    const byId = Object.fromEntries(cells.map((c) => [c.option_id, c.cell as Rec]));
    expect(byId.hire_two_developers).toMatchObject({ kind: 'figure', display: 'about 31%',
      face: '‘Hire two developers’: about 31% chance of ‘Productivity’ being at least 10% higher than today at three months, in this model.' });
    expect(byId.carry_on).toMatchObject({ kind: 'withheld', face: 'No change, by assumption',
      why: 'Doing nothing: no change to ‘Productivity’ in this model, by assumption.' });
  });
});

// ── DL contract rulings from the independent check (12 Oct): precision names, no "±0", no interval on the status quo ──
describe('DL contract rulings (12 Oct): precision names follow PLoT\'s wire; never "±0"; no interval on the status quo', () => {
  it('RED (ruling 1): the joint\'s precision is read ONLY as `probability_of_joint_goal_precision` — no other name is a fallback', () => {
    const l = licenceFor(marketingRun({ probability_of_joint_goal_precision: undefined, joint_probability_precision: PRECISION }))!;
    expect(l.pct_by_option).toEqual({});
    expect(l.targets!.joint).toMatchObject({ status: 'withheld', reason: 'precision_missing' });
  });

  it('RED (ruling 1): a withheld per-option limit P takes its `constraint_results[].probability_precision` with it', () => {
    const env = { constraint_results: [
      { constraint_id: 'limit:spend', option_id: 'hire_manager', probability: 0.4, probability_precision: PRECISION },
      { constraint_id: 'limit:spend', option_id: 'ai_plus_ads', probability: 0.7, probability_precision: PRECISION },
    ] };
    const out = withholdOptionLimitScores(env, new Map([['limit:spend', new Set(['hire_manager'])]])) as Rec;
    expect(out.constraint_results).toEqual([
      { constraint_id: 'limit:spend', option_id: 'hire_manager' },
      { constraint_id: 'limit:spend', option_id: 'ai_plus_ads', probability: 0.7, probability_precision: PRECISION },
    ]);
  });

  it('ruling 2: a joint of exactly 1 (standard error 0) is said as an extreme with NO interval, and the disclosures stay', () => {
    const g = marketingGraph();
    const run = marketingRun({ probability_of_joint_goal: 1, probability_of_joint_goal_precision: { n_informative: 10000, standard_error: 0 } });
    const l = licenceFor(run, g)!;
    expect(l.targets!.joint.status).toBe('licensed');
    expect(l.pct_by_option).toEqual({ hire_manager: 100, ai_plus_ads: 100 });
    // Nothing an interval could be drawn from is carried on the licence: no standard error, no bounds, no "±".
    expect(JSON.stringify(l)).not.toMatch(/standard_error|interval|±/);
    expect(l.notes!.some((n) => n.startsWith('This assumes carrying on as now leaves'))).toBe(true);
    expect(l.notes!.some((n) => n.startsWith('Each option’s effects are read as their size'))).toBe(true);
    const env = withGoalChanceLicence(run, g, 'new_customers', () => false, undefined, g,
      { storedConstraints: g.goal_constraints, sentConstraints: wireGoalConstraints(g.goal_constraints) });
    const cells = projectCanonicalAnalysisCells({ type: 'analysis_result', enrichment: env } as never, g);
    for (const c of cells) expect(JSON.stringify(c.cell)).not.toMatch(/±/);
  });

  it('RED (ruling 3): the status-quo row carries no precision and no Monte Carlo interval; the other options keep theirs', () => {
    const g = hiringGraph();
    const wilson = (p: number, met: number) => ({ basis: 'simulation_precision', method: 'wilson_score', confidence_level: 0.95,
      n_informative: 10000, n_met: met, interval_lower: Math.max(0, p - 0.01), interval_upper: Math.min(1, p + 0.01) });
    const outcome = { mean: 0, std: 0, p10: 0, p50: 0, p90: 0 };
    const run = { option_comparison: [
      { option_id: 'hire_a_tech_lead', probability_of_goal: 0.46, probability_of_goal_precision: wilson(0.46, 4600), outcome: { mean: 9, std: 3, p10: 5, p50: 9, p90: 13 } },
      { option_id: 'hire_two_developers', probability_of_goal: 0.31, probability_of_goal_precision: wilson(0.31, 3100), outcome: { mean: 8, std: 4, p10: 3, p50: 8, p90: 13 } },
      { option_id: 'carry_on', probability_of_goal: 0, probability_of_goal_precision: wilson(0, 0), outcome,
        probability_of_joint_goal_precision: { n_informative: 10000, standard_error: 0 },
        constraint_probabilities_precision: { 'agent-lane:cost:<=': { n_informative: 10000, standard_error: 0 } } },
    ], constraint_results: [
      { constraint_id: 'agent-lane:cost:<=', option_id: 'carry_on', probability: 1, probability_precision: { n_informative: 10000, standard_error: 0 } },
      { constraint_id: 'agent-lane:cost:<=', option_id: 'hire_a_tech_lead', probability: 0.9, probability_precision: PRECISION },
    ] };
    const env = withGoalChanceLicence(run, g, 'productivity', () => false, undefined, g, hiringConstraints(g)) as Rec;
    const rows = Object.fromEntries((env.option_comparison as Rec[]).map((r) => [r.option_id, r]));
    for (const k of ['probability_of_goal_precision', 'probability_of_joint_goal_precision', 'constraint_probabilities_precision']) {
      expect(rows.carry_on, k).not.toHaveProperty(k);
    }
    // The status quo's outcome keeps its centre (no change) and loses its spread: never a Monte Carlo interval.
    expect(rows.carry_on.outcome).toEqual({ mean: 0, p50: 0 });
    expect((env.constraint_results as Rec[])[0]).toEqual({ constraint_id: 'agent-lane:cost:<=', option_id: 'carry_on', probability: 1 });
    // The compared options are untouched.
    expect(rows.hire_a_tech_lead).toEqual(run.option_comparison[0]);
    expect(rows.hire_two_developers).toEqual(run.option_comparison[1]);
    expect((env.constraint_results as Rec[])[1]).toEqual(run.constraint_results[1]);
    // CONTROL: a level goal with no status quo by assumption keeps every row as PLoT sent it.
    const level = hiringGraph({ quantity_frame: 'level', goal_threshold_frame: 'level', goal_target_basis: undefined });
    const kept = withGoalChanceLicence(run, level, 'productivity', () => false, undefined, level, hiringConstraints(level)) as Rec;
    expect(kept.option_comparison).toEqual(run.option_comparison);
  });
});
