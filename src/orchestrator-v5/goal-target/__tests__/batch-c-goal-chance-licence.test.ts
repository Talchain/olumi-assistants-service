/**
 * Recovery Batch C — the goal-chance licence says the ruled sentence for a CHANGE target, labels Olumi's starting value as
 * estimate_only, and, with several targets, makes the same-draw joint the headline or withholds it with its reason
 * (Batch 0 change-goal decision rulings 15–22; amendments 1–7; DL amendment 22:15Z). Hand-written figures throughout: the
 * licence never computes a chance, it decides what may be said about the Run's own.
 */
import { describe, expect, it } from 'vitest';

import { goalChanceLicenceForAgent, goalChanceLicenceOf, goalChancePointForAgent, nearestFiveGoalChancesForAgent, withGoalChanceLicence } from '../goal-chance-licence.js';
import { goalHorizonVerdict } from '../goal-horizon-verdict.js';
import { targetChanceWords } from '../goal-target-basis.js';
import { withholdForOpenTargetQuestion } from '../goal-chance-gate.js';
import { wireGoalConstraints } from '../../tools/handlers/run-analysis.js';
import { goalChanceCellFacesForAgent, goalChanceNotesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';
import { withEstimateGoalPointsAtEgress } from '../../agent-lane/goal-chance-estimate-egress.js';
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
      line: 'The chance of meeting both together isn’t shown: this run did not say how precise it is. Run the analysis again to get it with its precision.', // Batch C: ruling 17 (independent check r1 item 7)
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
      'The chance of meeting both together isn’t shown: this run did not say how precise it is. Run the analysis again to get it with its precision.', // Batch C: ruling 17 (independent check r1 item 7)
      'Meeting both is no more likely than the lower of the two chances.',
      'On its own, the chance of ‘New customers’ being at least 20 customers over the first three months after launch, in this model: ‘Hire a marketing manager’ about 60%; ‘AI planning plus advertising’ about 70%.',
      'On its own, the chance of ‘Conversion rate’ being above 15% over the first three months after launch, in this model: ‘Hire a marketing manager’ about 42%; ‘AI planning plus advertising’ about 55%.',
      // Batch C: AIE status-quo disposition (12 Oct) — marketing is read from launch with no level today and no status quo:
      // no condition's reference is the same-draw one, so no "carrying on leaves … unchanged" is said of it.
      'Each option’s effects are read as their size over the first three months after launch, including recruitment and ramp-up '
        + '(customers and percentage points over the first three months after launch), and are added together: twice the change counts twice, '
        + 'with no diminishing returns, interactions or extra onboarding drag modelled.',
    ]);
    const cells = projectCanonicalAnalysisCells(result as never, g);
    expect(cells.map((c) => [c.option_id, c.cell.kind, (c.cell as Rec).why])).toEqual([
      ['hire_manager', 'withheld', 'The chance of meeting both together isn’t shown: this run did not say how precise it is. Run the analysis again to get it with its precision. Meeting both is no more likely than the lower of the two chances.'], // Batch C: ruling 17 (independent check r1 item 7)
      ['ai_plus_ads', 'withheld', 'The chance of meeting both together isn’t shown: this run did not say how precise it is. Run the analysis again to get it with its precision. Meeting both is no more likely than the lower of the two chances.'],
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
    // Batch C: AIE status-quo disposition (12 Oct) — read from launch, no status quo: no assumption is claimed of it.
    expect(l.notes!.some((n) => n.startsWith('This assumes carrying on as now leaves'))).toBe(false);
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
    // Batch C: amendment 1 (independent check r1 item 3) — a LEVEL goal's status quo is by assumption too, where the Run held
    // it at today's level (every draw at the goal's stated current level, 0 here): its row loses its precision and spread
    // exactly as above, and the compared options keep theirs.
    // Batch C: B2 beside amendment 1 (CI 6e3bce10) — no held month here: a held month the Run did not carry keeps B2's
    // "needs month-by-month changes" instead (its own row in item 3 below).
    // Batch C: AIE status-quo disposition (12 Oct) — the same-draw reference needs the goal REACHED through a link (not a root).
    const level = hiringGraph({ quantity_frame: 'level', goal_threshold_frame: 'level', goal_target_basis: undefined, goal_horizon_months: undefined,
      observed_state: { value: 0, baseline: 0, raw_value: 0, cap: 100, unit: '%', source: 'brief_extraction' } },
      { edges: [{ from: 'cost', to: 'productivity', strength: { mean: 0.1, std: 0.05 } }] });
    const kept = withGoalChanceLicence(run, level, 'productivity', () => false, undefined, level, hiringConstraints(level)) as Rec;
    const keptRows = Object.fromEntries((kept.option_comparison as Rec[]).map((r) => [r.option_id, r]));
    expect(keptRows.carry_on).not.toHaveProperty('probability_of_goal_precision');
    expect(keptRows.carry_on.outcome).toEqual({ mean: 0, p50: 0 });
    expect(keptRows.hire_a_tech_lead).toEqual(run.option_comparison[0]);
    expect(keptRows.hire_two_developers).toEqual(run.option_comparison[1]);
    // CONTROL: a level status quo the Run MOVED (its draws centre away from today's level) is the Run's finding, not an
    // assumption — "no change" would be false of it — so every row stays as PLoT sent it.
    const moved = { ...run, option_comparison: run.option_comparison.map((r) => (r.option_id === 'carry_on'
      ? { ...r, outcome: { mean: 4, std: 0, p10: 4, p50: 4, p90: 4 } } : r)) };
    const asSent = withGoalChanceLicence(moved, level, 'productivity', () => false, undefined, level, hiringConstraints(level)) as Rec;
    expect(asSent.option_comparison).toEqual(moved.option_comparison);
    // CONTROL: a goal with no status quo option at all keeps every row as PLoT sent it.
    const noSq = { ...level, nodes: (level.nodes as Rec[]).map((n) => (n.id === 'carry_on' ? { ...n, is_baseline: false } : n)) };
    const untouched = withGoalChanceLicence(run, noSq, 'productivity', () => false, undefined, noSq, hiringConstraints(noSq)) as Rec;
    expect(untouched.option_comparison).toEqual(run.option_comparison);
  });
});

// ── AIE C drafter clause 3 (12 Oct): each secondary target keeps its own frame; what the joint cannot support is refused
//    honestly and named, never forced into a level or silently left out of a "both" headline ───────────────────────────
describe('AIE clause 3: a target the joint cannot support is kept, named and refused honestly — never forced or dropped', () => {
  it('RED: a secondary target stated as a CHANGE keeps its frame; the joint is withheld naming it, and only level targets get a figure', () => {
    const g = marketingGraph([
      { constraint_id: 'target:new_customers', node_id: 'new_customers', operator: '>=', value: 20, unit: 'customers', value_frame: 'level', role: 'goal_target' },
      { constraint_id: 'target:conversion_rate', node_id: 'conversion_rate', operator: '>=', value: 5, unit: '%', value_frame: 'change_abs', role: 'goal_target' },
    ]);
    const l = licenceFor(marketingRun(), g)!;
    expect(l.pct_by_option).toEqual({});
    expect(l.targets!.joint).toEqual({ status: 'withheld', reason: 'target_not_supported',
      line: 'The chance of meeting both together isn’t shown: ‘Conversion rate’ is stated as a change, which can’t yet be combined with the other targets in this analysis.' });
    // The level target is still said on its own; the change target is given no figure (its scoring is not supported here).
    expect(l.targets!.per_target.map((t) => t.constraint_id)).toEqual(['target:new_customers']);
    expect(JSON.stringify(l.targets)).not.toMatch(/Meeting both is no more likely/);
  });

  it('RED: with a third target unsupported, no bound over "the two chances" is said (it would leave the third out)', () => {
    const g = marketingGraph([...(marketingGraph().goal_constraints as Rec[]),
      { constraint_id: 'target:repeat_rate', node_id: 'annual_spend', operator: '>=', value: 5, unit: '%', value_frame: 'change_rel', role: 'goal_target' }]);
    const l = licenceFor(marketingRun(), g)!;
    expect(l.targets!.joint).toMatchObject({ status: 'withheld', reason: 'target_not_supported' });
    expect((l.targets!.joint as Rec).line).toMatch(/^The chance of meeting all of them together isn’t shown: ‘Annual spend’ is stated as a change/);
    expect(l.targets!.per_target).toHaveLength(2);
    expect(l.targets!.joint).not.toHaveProperty('frechet_line');
  });

  it('RED: a CHANGE goal beside a level secondary target — the joint never claims "both" without the goal; the goal keeps its own chance', () => {
    const g = hiringGraph({}, { goal_constraints: [
      { constraint_id: 'agent-lane:cost:<=', node_id: 'cost', operator: '<=', value: 200000, unit: 'GBP', value_frame: 'level' },
      { constraint_id: 'target:quality', node_id: 'quality', operator: '>=', value: 80, unit: 'score', value_frame: 'level', role: 'goal_target' },
    ] });
    (g.nodes as Rec[]).push({ id: 'quality', kind: 'factor', label: 'Code quality score' });
    const run = { option_comparison: (hiringRun().option_comparison as Rec[]).map((r) => ({ ...r,
      probability_of_joint_goal: 0.2, probability_of_joint_goal_precision: PRECISION,
      constraint_probabilities: { 'target:quality': 0.7, 'agent-lane:cost:<=': 0.9 },
      constraint_probabilities_precision: { 'target:quality': PRECISION, 'agent-lane:cost:<=': PRECISION } })) };
    const l = goalChanceLicenceOf(run, g, 'productivity', () => false, undefined, g, hiringConstraints(g))!;
    expect(l.pct_by_option).toEqual({});
    expect(l.targets!.joint).toMatchObject({ status: 'withheld', reason: 'target_not_supported' });
    expect((l.targets!.joint as Rec).line).toContain('‘Productivity’ is stated as a change');
    // The goal's own licensed chance is still said, as its own target, beside the level target's.
    expect(l.targets!.per_target.map((t) => [t.words, t.pct_by_option])).toEqual([
      ['‘Productivity’ being at least 10% higher than today at three months', { hire_a_tech_lead: 46, hire_two_developers: 31 }],
      // Batch C: AIE status-quo disposition item 4 (12 Oct) — the goal's unchanged reference never attests ‘Code quality
      // score’ (no level today, no link reaching it): the status quo's own 70% for it is the Run's, shown like any option's.
      ['‘Code quality score’ being at least 80 score at three months', { hire_a_tech_lead: 70, hire_two_developers: 70, carry_on: 70 }],
    ]);
  });

  it('RED: a condition the drafter retained in also_required (a distinct period) is disclosed beside the joint — never claimed', () => {
    const g = marketingGraph();
    (g.nodes as Rec[])[0] = { ...(g.nodes as Rec[])[0], goal_target_basis: { ...MARKETING_BASIS, also_required: ['repeat purchases from 30% of them within six months'] } };
    const l = licenceFor(marketingRun(), g)!;
    expect(l.targets!.joint.status).toBe('licensed');
    expect(l.notes).toContain('This chance covers ‘New customers’ and ‘Conversion rate’ only. It does not include: repeat purchases from 30% of them within six months.');
  });

  it('CONTROL: the supported marketing AND (both level, same period) is unchanged — licensed, no "covers only" note', () => {
    const l = licenceFor(marketingRun())!;
    expect(l.targets!.joint.status).toBe('licensed');
    expect((l.notes ?? []).some((n) => n.startsWith('This chance covers'))).toBe(false);
  });
});

// ── Independent check round 1 (Codex, CHECK-C-cee-r1.md; DL 12 Oct): items 1, 3, 4, 6, 7 ─────────────────────────────
// A capacity-like LEVEL goal: development capacity 75% today, target at least 85% at three months; links sized by the user.
const capacityGraph = (over: { factorOs?: Rec; setting?: Rec; goal?: Rec } = {}): Rec => ({
  nodes: [
    { id: 'capacity', kind: 'goal', label: 'Development capacity', goal_threshold_frame: 'level', goal_threshold_raw: 85,
      goal_threshold_unit: '%', goal_threshold_cap: 100, goal_threshold: 0.85, goal_direction: '>=',
      observed_state: { value: 0.75, baseline: 0.75, raw_value: 75, cap: 100, unit: '%', source: 'brief_extraction' }, ...over.goal },
    { id: 'devs', kind: 'factor', label: 'Developers', observed_state: over.factorOs ?? { value: 0.6, raw_value: 6, cap: 10, unit: 'people', source: 'brief_extraction', extractionType: 'explicit' } },
    { id: 'lead', kind: 'option', label: 'Hire a tech lead', interventions: { devs: over.setting ?? { value: 0.6, raw_value: 6, source: 'brief_extraction', target_match: { node_id: 'devs' } } } },
    { id: 'two', kind: 'option', label: 'Hire two developers', interventions: { devs: { value: 0.8, raw_value: 8, source: 'brief_extraction', target_match: { node_id: 'devs' } } } },
    { id: 'carry_on', kind: 'option', label: 'Carry on as now', is_baseline: true, interventions: {} },
  ],
  edges: [
    { from: 'lead', to: 'devs', strength: { mean: 1, std: 0 } }, { from: 'two', to: 'devs', strength: { mean: 1, std: 0 } },
    { from: 'devs', to: 'capacity', strength: { mean: 0.3, std: 0.05 }, exists_probability: 1, effect_direction: 'positive',
      provenance: { source: 'user_specified', magnitude: 'user_stated' } },
  ],
  goal_constraints: [],
});
const wilson = (p: number, met: number): Rec => ({ basis: 'simulation_precision', method: 'wilson_score', confidence_level: 0.95,
  n_informative: 10000, n_met: met, interval_lower: Math.max(0, p - 0.01), interval_upper: Math.min(1, p + 0.01) });
const capacityRun = (): Rec => ({ option_comparison: [
  { option_id: 'lead', probability_of_goal: 0.46, probability_of_goal_precision: wilson(0.46, 4600), outcome: { mean: 84, std: 3, p10: 80, p50: 84, p90: 88 } },
  { option_id: 'two', probability_of_goal: 0.31, probability_of_goal_precision: wilson(0.31, 3100), outcome: { mean: 83, std: 3, p10: 79, p50: 83, p90: 87 } },
  { option_id: 'carry_on', probability_of_goal: 0, probability_of_goal_precision: wilson(0, 0), outcome: { mean: 75, std: 0, p10: 75, p50: 75, p90: 75 } },
] });
const capacityLicence = (g: Rec = capacityGraph()) => goalChanceLicenceOf(capacityRun(), g, 'capacity', () => false, undefined, g, {});

describe('independent check r1 — item 1: a percentage quantity changed by an absolute amount is said in POINTS', () => {
  // The discriminator is the goal's quantity frame (DL precision, 12 Oct): 'level' → points; 'change' → % of today; neither → not said.
  const CAPACITY_BASIS = { ...HIRING_BASIS, quantity_frame: 'level', denominator: 'today’s development capacity (75%)',
    effect_unit: 'percentage points of capacity per added person, at month three' };
  const capacityChange = (goal: Rec): Rec => hiringGraph({ label: 'Development capacity',
    observed_state: { value: 0.75, baseline: 0.75, raw_value: 75, cap: 100, unit: '%', source: 'brief_extraction' }, ...goal });
  const wordsOf = (g: Rec) => goalChanceLicenceOf(hiringRun(), g, 'productivity', () => false, undefined, g, hiringConstraints(g))!;

  it('RED (level, as admission stores it): no frame on the node, Olumi\'s validated reading "level" — "10 percentage points higher" (75% → 85%, never 82.5%)', () => {
    const l = wordsOf(capacityChange({ quantity_frame: undefined, goal_target_basis: CAPACITY_BASIS }));
    expect(l.chance_words).toBe('chance of ‘Development capacity’ being at least 10 percentage points higher than today at three months');
  });

  it('RED (level, stated on the node): quantity frame "level" — the same points sentence', () => {
    const l = wordsOf(capacityChange({ quantity_frame: 'level', goal_target_basis: CAPACITY_BASIS }));
    expect(l.chance_words).toBe('chance of ‘Development capacity’ being at least 10 percentage points higher than today at three months');
  });

  it('CONTROL (change): a quantity measured AS a % change of today (hiring\'s productivity) keeps "10% higher than today", unchanged', () => {
    const g = hiringGraph();
    expect(wordsOf(g).chance_words).toBe('chance of ‘Productivity’ being at least 10% higher than today at three months');
  });

  it('NEITHER: no frame on the node and no validated reading — never a default: the chance is withheld (ruling 11), and the words are never formed', () => {
    expect(goalChanceLicenceOf(hiringRun(), capacityChange({ quantity_frame: undefined, goal_target_basis: undefined }), 'productivity', () => false)).toBeNull();
    const args = { label: 'Development capacity', frame: 'change_abs' as const, comparator: '>=', value: 10, unit: '%' };
    expect(targetChanceWords({ ...args, quantityFrame: undefined })).toBeUndefined();
    expect(targetChanceWords({ ...args, quantityFrame: 'level' })).toBe('‘Development capacity’ being at least 10 percentage points higher than today');
    expect(targetChanceWords({ ...args, quantityFrame: 'change' })).toBe('‘Development capacity’ being at least 10% higher than today');
  });
});

describe('independent check r1 — item 3: the status quo is "no change, by assumption" for LEVEL targets too (amendment 1)', () => {
  it('RED: a level target\'s status quo is never a figure — its line is said, and the options keep their chances and words', () => {
    const l = capacityLicence()!;
    expect(l.pct_by_option).toEqual({ lead: 46, two: 31 });
    expect(l.withheld_option_ids).toEqual(['carry_on']);
    expect(l.status_quo).toEqual({ option_id: 'carry_on', line: 'Doing nothing: no change to ‘Development capacity’ in this model, by assumption.' });
    expect(l.notes).toContain('This assumes carrying on as now leaves ‘Development capacity’ unchanged; each option is measured against that.');
    // The option's sentence is exactly today's: "about N% chance of meeting your goal, in this model".
    expect(l.chance_words).toBeUndefined();
    const g = capacityGraph();
    const env = withGoalChanceLicence(capacityRun(), g, 'capacity', () => false, undefined, g, {});
    const faces = goalChanceCellFacesForAgent({ type: 'analysis_result', enrichment: env }, g, true);
    expect(faces.get('lead')).toBe('‘Hire a tech lead’: about 46% chance of meeting your goal, in this model.');
    const cells = Object.fromEntries(projectCanonicalAnalysisCells({ type: 'analysis_result', enrichment: env } as never, g).map((c) => [c.option_id, c.cell as Rec]));
    expect(cells.carry_on).toMatchObject({ kind: 'withheld', face: 'No change, by assumption',
      why: 'Doing nothing: no change to ‘Development capacity’ in this model, by assumption.' });
  });

  it('CONTROL: a level status quo whose draws SPREAD was not held unchanged — no "no change" line or assumption is said of it', () => {
    const run = capacityRun();
    (run.option_comparison as Rec[])[2]!.outcome = { mean: 76, std: 3, p10: 72, p50: 76, p90: 80 };
    const g = capacityGraph();
    const l = goalChanceLicenceOf(run, g, 'capacity', () => false, undefined, g, {})!;
    expect(l.status_quo).toBeUndefined();
    expect(JSON.stringify(l)).not.toMatch(/by assumption|carrying on as now leaves/);
  });

  it('RED (CI 6e3bce10): with no other option licensed, the status quo\'s own line still reaches the screen — the licence is never dropped', () => {
    // Before item 3 this row carried its zero-spread reason; dropping the whole licence left the cell empty.
    const run = capacityRun();
    for (const row of (run.option_comparison as Rec[]).slice(0, 2)) delete row.probability_of_goal;
    const g = capacityGraph();
    const l = goalChanceLicenceOf(run, g, 'capacity', () => false, undefined, g, {})!;
    expect(l).not.toBeNull();
    expect(l).toMatchObject({ message: '', pct_by_option: {}, withheld_option_ids: ['lead', 'two', 'carry_on'],
      status_quo: { option_id: 'carry_on', line: 'Doing nothing: no change to ‘Development capacity’ in this model, by assumption.' } });
    for (const key of ['leader_option_id', 'similar_option_ids', 'olumi_estimate_link_count', 'provisional', 'withheld_reason_by_option']) {
      expect(l).not.toHaveProperty(key);
    }
    const env = withGoalChanceLicence(run, g, 'capacity', () => false, undefined, g, {});
    const cells = Object.fromEntries(projectCanonicalAnalysisCells({ type: 'analysis_result', enrichment: env } as never, g).map((c) => [c.option_id, c.cell as Rec]));
    expect(cells.carry_on).toMatchObject({ kind: 'withheld', face: 'No change, by assumption',
      why: 'Doing nothing: no change to ‘Development capacity’ in this model, by assumption.' });
    // NEGATIVE: a status-quo figure already withheld upstream (an untested horizon strips every option's) said nothing before,
    // so no status-quo-only record is added for it (goal-horizon-verdict.route "a stored triple does not unlock…").
    const stripped = structuredClone(run);
    delete (stripped.option_comparison as Rec[])[2]!.probability_of_goal;
    expect(goalChanceLicenceOf(stripped, g, 'capacity', () => false, undefined, g, {})).toBeNull();
    // Batch C: AIE status-quo disposition (12 Oct) — a status quo whose draws spread on this same-draw reference is a
    // disagreement, withheld with that reason (the record carries it), never a finding and never "no change".
    (run.option_comparison as Rec[])[2]!.outcome = { mean: 76, std: 3, p10: 72, p50: 76, p90: 80 };
    const spread = goalChanceLicenceOf(run, g, 'capacity', () => false, undefined, g, {})!;
    expect(spread.status_quo).toBeUndefined();
    expect(spread.withheld_reason_by_option?.carry_on?.reason).toBe('reference_moved');
  });

  it('B2 beside amendment 1: at a held month the Run did not carry, the status quo keeps "needs month-by-month changes"', () => {
    const g = capacityGraph({ goal: { goal_horizon_months: 9 } });
    expect(goalHorizonVerdict(g, capacityRun())).toBe('withhold');
    const l = goalChanceLicenceOf(capacityRun(), g, 'capacity', () => false, undefined, g, {})!;
    expect(l.withheld_reason_by_option).toEqual({ carry_on: { reason: 'zero_spread', side: 'falls_short', line: 'Not shown yet: needs month-by-month changes' } });
    expect(l.status_quo).toBeUndefined();
    expect(JSON.stringify(l)).not.toMatch(/by assumption/);
    // CONTROL: the same status quo with no held month is amendment 1's.
    expect(capacityLicence()!.status_quo?.option_id).toBe('carry_on');
    expect(capacityLicence()).not.toHaveProperty('withheld_reason_by_option');
  });

  it('RED: the level status quo row carries no precision and no Monte Carlo interval; the options keep theirs', () => {
    const g = capacityGraph();
    const env = withGoalChanceLicence(capacityRun(), g, 'capacity', () => false, undefined, g, {}) as Rec;
    const rows = Object.fromEntries((env.option_comparison as Rec[]).map((r) => [r.option_id, r]));
    expect(rows.carry_on).not.toHaveProperty('probability_of_goal_precision');
    expect(rows.carry_on.outcome).toEqual({ mean: 75, p50: 75 });
    expect(rows.lead).toEqual((capacityRun().option_comparison as Rec[])[0]);
  });
});

describe('independent check r1 — item 4: a stated ">" not sent strictly withholds the MARGINAL too', () => {
  it('RED: "above 15%" sent as ">=" → no marginal is labelled "above 15%"; the other target keeps its own chance', () => {
    const g = marketingGraph();
    const oldWire = (g.goal_constraints as Rec[]).map(({ operator_as_stated: _s, role: _r, ...row }) => row);
    const l = licenceFor(marketingRun(), g, oldWire)!;
    expect(l.targets!.per_target.map((t) => t.constraint_id)).toEqual(['target:new_customers']);
    expect(JSON.stringify(l.targets!.per_target)).not.toMatch(/above 15%/);
    // The withheld marginal is SAID, beside the joint, never silently missing.
    expect(l.targets!.joint).toMatchObject({ status: 'withheld', reason: 'strict_not_preserved',
      line: 'The chance of meeting both together isn’t shown, and nor is the chance of ‘Conversion rate’ being above 15% on its own: '
        + 'the comparison the analysis used is not the one you stated.' });
  });
});

describe('independent check r1 — item 6: provisional from EVERY Olumi input (amendment 7)', () => {
  it('RED: an Olumi starting value on the goal path (links all the user\'s) makes the chance provisional and says so', () => {
    const g = capacityGraph({ factorOs: { value: 0.6, raw_value: 6, cap: 10, unit: 'people', source: 'cee_inference', extractionType: 'inferred' } });
    const l = capacityLicence(g)!;
    expect(l.provisional).toBe(true);
    const env = withGoalChanceLicence(capacityRun(), g, 'capacity', () => false, undefined, g, {});
    expect(goalChanceCellFacesForAgent({ type: 'analysis_result', enrichment: env }, g, true).get('lead'))
      .toBe('‘Hire a tech lead’: about 46% chance of meeting your goal, in this model, using Olumi\'s estimates for 1 starting value (see Check estimates).');
  });

  it('RED: with no Olumi relationship at all, an Olumi starting value still relabels the narrator\'s bare chance at egress', () => {
    const g = capacityGraph({ factorOs: { value: 0.6, raw_value: 6, cap: 10, unit: 'people', source: 'cee_inference', extractionType: 'inferred' } });
    const result = { type: 'analysis_result', enrichment: withGoalChanceLicence(capacityRun(), g, 'capacity', () => false, undefined, g, {}) };
    const bare = '‘Hire a tech lead’: about 46% chance of meeting your goal, in this model.';
    const text = withEstimateGoalPointsAtEgress({ assistant_text: bare }, { analysisResult: result, graph: g, current: true }).assistant_text;
    expect(text).toContain('‘Hire a tech lead’: about 46% chance of meeting your goal, in this model, using Olumi\'s estimates for 1 starting value (see Check estimates).');
  });

  it('RED: an Olumi option setting on the goal path makes the chance provisional and says so — on THAT option only', () => {
    const g = capacityGraph({ setting: { value: 0.6, raw_value: 6, source: 'cee_hypothesis', target_match: { node_id: 'devs' } } });
    const l = capacityLicence(g)!;
    expect(l.provisional).toBe(true);
    expect(l.olumi_estimate_settings_by_option).toEqual({ lead: 1 });
    const env = withGoalChanceLicence(capacityRun(), g, 'capacity', () => false, undefined, g, {});
    const faces = goalChanceCellFacesForAgent({ type: 'analysis_result', enrichment: env }, g, true);
    expect(faces.get('lead'))
      .toBe('‘Hire a tech lead’: about 46% chance of meeting your goal, in this model, using Olumi\'s estimates for 1 option setting (see Check estimates).');
    // ‘Hire two developers’ sets its own level from the brief: another option's Olumi setting is never said on its result.
    expect(faces.get('two')).toBe('‘Hire two developers’: about 31% chance of meeting your goal, in this model.');
  });

  it('CONTROL: every input the user\'s → not provisional, and the sentence is unchanged', () => {
    expect(capacityLicence()!.provisional).toBeUndefined();
  });
});

describe('independent check r1 — item 7: a withheld joint says truly why, with a next step', () => {
  it('a joint figure without its precision is not "not calculated": it says what is missing and what to do', () => {
    const l = licenceFor(marketingRun({ probability_of_joint_goal_precision: undefined }))!;
    expect((l.targets!.joint as Rec).line).toBe('The chance of meeting both together isn’t shown: this run did not say how precise it is. Run the analysis again to get it with its precision.');
  });
  it('no joint figure at all: "not calculated yet", with the next step', () => {
    const l = licenceFor(marketingRun({ probability_of_joint_goal: undefined, probability_of_joint_goal_precision: undefined }))!;
    expect((l.targets!.joint as Rec).line).toBe('The chance of meeting both together isn’t calculated yet. Run the analysis again to get it.');
  });
});

// ── AIE status-quo disposition (12 Oct, #94 6117119450; PL 6117155350): amendment 1 is PARTIAL by design ────────────────
// The checked facts decide how carrying on is read — never the Run row's summary statistics. Contrasts, written by hand:
// ordinary anchored capacity (75% today, reached from ‘Developers’) and hiring's change quantity are the same-draw reference;
// a root goal, a goal an option sets directly and a goal read from a launch are not established; a rates forecast is
// carrying on's own projection; an ordinary paired Run whose status quo drifts or spreads is withheld until checked.
const MOVED = (label: string): string => `Not shown: this run’s result for carrying on as now doesn’t match ‘${label}’ as it stands today in the model, so it needs checking first.`;
const capacityWith = (sq: Rec): Rec => {
  const run = capacityRun();
  (run.option_comparison as Rec[])[2] = { ...(run.option_comparison as Rec[])[2], ...sq };
  return run;
};
const cellsOf = (run: Rec, g: Rec): Record<string, Rec> => {
  const env = withGoalChanceLicence(run, g, 'capacity', () => false, undefined, g, {});
  return Object.fromEntries(projectCanonicalAnalysisCells({ type: 'analysis_result', enrichment: env } as never, g).map((c) => [c.option_id, c.cell as Rec]));
};

describe('AIE status-quo disposition — the same-draw reference is decided by the checked facts, and checked by the Run', () => {
  it.each([
    ['spreads (72%–80%)', { probability_of_goal: 0.1, outcome: { mean: 76, std: 3, p10: 72, p50: 76, p90: 80 } }],
    ['drifts to 78% with no spread', { outcome: { mean: 78, std: 0, p10: 78, p50: 78, p90: 78 } }],
    ['meets the target on some draws only', { probability_of_goal: 0.2 }],
  ])('RED (drift): an ordinary paired Run whose status quo %s is withheld with that reason — never a finding, never "no change"', (_name, sq) => {
    const g = capacityGraph();
    const run = capacityWith(sq);
    const l = goalChanceLicenceOf(run, g, 'capacity', () => false, undefined, g, {})!;
    expect(l.pct_by_option).toEqual({ lead: 46, two: 31 });
    expect(l.withheld_option_ids).toEqual(['carry_on']);
    expect(l.withheld_reason_by_option).toEqual({ carry_on: { reason: 'reference_moved', line: MOVED('Development capacity') } });
    expect(l.status_quo).toBeUndefined();
    expect(JSON.stringify(l)).not.toMatch(/by assumption|carrying on as now leaves/);
    expect(cellsOf(run, g).carry_on).toEqual({ kind: 'withheld', face: 'Chance not shown yet', why: MOVED('Development capacity'),
      reasons: [{ code: 'reference_moved', message: MOVED('Development capacity') }] });
    // Read back by the Agent exactly as stored; a malformed one (with a side, or no line) speaks for nothing.
    const env = withGoalChanceLicence(run, g, 'capacity', () => false, undefined, g, {}) as Rec;
    expect(goalChanceLicenceForAgent({ enrichment: env })?.withheld_reason_by_option).toEqual(l.withheld_reason_by_option);
    for (const bad of [{ reason: 'reference_moved', side: 'falls_short', line: MOVED('x') }, { reason: 'reference_moved', line: '' }]) {
      const record = { ...structuredClone(l), withheld_reason_by_option: { carry_on: bad } };
      expect(goalChanceLicenceForAgent({ inference_warnings: [record] })).not.toHaveProperty('withheld_reason_by_option');
    }
  });

  it.each([
    ['std 3 with p10 = p90 = 75 at the reference 75 (independent check r2 BLOCKING 3)', { mean: 75, std: 3, p10: 75, p50: 75, p90: 75 }],
    ['any positive std, however small', { mean: 75, std: 1e-12, p10: 75, p50: 75, p90: 75 }],
    ['a decile away from the reference, the centre on it', { mean: 75, std: 0, p10: 74, p50: 75, p90: 75 }],
  ])('RED on 2ecbae5 (re-scope 3): never "no change" from summary statistics — %s is a spread, withheld as reference_moved', (_name, outcome) => {
    const g = capacityGraph();
    const run = capacityWith({ outcome });
    const l = goalChanceLicenceOf(run, g, 'capacity', () => false, undefined, g, {})!;
    expect(l.status_quo).toBeUndefined();
    expect(JSON.stringify(l)).not.toMatch(/by assumption|carrying on as now leaves/);
    expect(l.withheld_reason_by_option).toEqual({ carry_on: { reason: 'reference_moved', line: MOVED('Development capacity') } });
    // Its uncertainty is never removed: the row stays exactly as the Run sent it.
    const env = withGoalChanceLicence(run, g, 'capacity', () => false, undefined, g, {}) as Rec;
    expect((env.option_comparison as Rec[])[2]).toEqual((run.option_comparison as Rec[])[2]);
  });

  it.each([
    ['a ROOT goal (no link reaches it)', (g: Rec) => { g.edges = (g.edges as Rec[]).filter((e) => e.to !== 'capacity'); }],
    ['a goal an option SETS directly', (g: Rec) => { ((g.nodes as Rec[])[2]!.interventions as Rec).capacity = { value: 0.8, raw_value: 80, source: 'brief_extraction' }; }],
    ['a goal read from a LAUNCH, not today', (g: Rec) => { (g.nodes as Rec[])[0]!.goal_target_basis = { quantity_frame: 'level', target_frame: 'level', target_raw: 85,
      reference: 'launch', period_months: 3, period_kind: 'at_end', effect_unit: 'percentage points', effects_at_period_end: true, source: 'olumi_reading' }; }],
    ['a held month the Run did not carry', (g: Rec) => { (g.nodes as Rec[])[0]!.goal_horizon_months = 9; }],
  ])('RED (authority unknown): %s — a status quo at today\'s level with no spread claims NO assumption (summary statistics are never the proof)', (_name, mutate) => {
    const g = capacityGraph();
    mutate(g);
    const l = goalChanceLicenceOf(capacityRun(), g, 'capacity', () => false, undefined, g, {})!;
    expect(l.status_quo).toBeUndefined();
    expect(JSON.stringify(l)).not.toMatch(/by assumption|carrying on as now leaves/);
    // The status quo is the Run's own row, exactly as before amendment 1: an unearned exact 0 at zero spread keeps its typed reason.
    expect(l.withheld_reason_by_option?.carry_on?.reason).toBe('zero_spread');
    const env = withGoalChanceLicence(capacityRun(), g, 'capacity', () => false, undefined, g, {}) as Rec;
    expect((env.option_comparison as Rec[])[2]).toEqual((capacityRun().option_comparison as Rec[])[2]);
  });

  it('RED (projection): a rates forecast keeps carrying on\'s own projection with its real uncertainty — labelled, never "no change"', () => {
    const g = capacityGraph({ goal: { nonlinear_identity: { operation: 'accumulation', factor_ids: ['devs'] } } });
    expect(goalHorizonVerdict(g, {})).toBe('no_horizon');
    const run = capacityWith({ probability_of_goal: 0.12, probability_of_goal_precision: wilson(0.12, 1200), outcome: { mean: 79, std: 4, p10: 74, p50: 79, p90: 84 } });
    const l = goalChanceLicenceOf(run, g, 'capacity', () => false, undefined, g, {})!;
    expect(l.pct_by_option).toEqual({ lead: 46, two: 31, carry_on: 12 });
    expect(l.status_quo).toBeUndefined();
    expect(l.notes).toEqual(['‘Carry on as now’ is this model’s projection for carrying on as now, with its own uncertainty — not an assumption that nothing changes.']);
    expect(JSON.stringify(l)).not.toMatch(/by assumption|carrying on as now leaves|reference_moved/);
    const env = withGoalChanceLicence(run, g, 'capacity', () => false, undefined, g, {}) as Rec;
    expect((env.option_comparison as Rec[])[2]).toEqual((run.option_comparison as Rec[])[2]); // its precision and spread stay
    // The same forecast whose status quo happens to sit at today with no spread is STILL not "by assumption".
    const flat = goalChanceLicenceOf(capacityRun(), g, 'capacity', () => false, undefined, g, {})!;
    expect(flat.status_quo).toBeUndefined();
    expect(JSON.stringify(flat)).not.toMatch(/by assumption/);
  });

  it('RED (projection, real horizon): a Run whose evaluated carrier computed the held month keeps carrying on\'s varying forecast', () => {
    // The stored-horizon shape (stored-goal-chance-horizon-read): the goal is price × stock at month 12, the stock an evaluated
    // accumulation carrier (ISL's per_draw_baseline path) — a status quo whose month-12 level varies is a forecast, not "no change".
    const g = capacityGraph({ goal: { goal_horizon_months: 12,
      nonlinear_identity: { operation: 'product', factor_ids: ['price', 'stock_at_h'], stated_in_brief: true } } });
    (g.nodes as Rec[]).push(
      { id: 'stock_at_h', kind: 'factor', label: 'Stock at month 12', nonlinear_identity: {
        operation: 'accumulation', factor_ids: ['today', 'leave', 'adds'], horizon_months: 12, rate_scale: 0.01, stated_in_brief: true } },
      ...['price', 'today', 'leave', 'adds'].map((id) => ({ id, kind: 'factor', label: id, observed_state: { value: 0.5, raw_value: 1, source: 'user_confirmed' } })));
    const run = capacityWith({ probability_of_goal: 0.12, probability_of_goal_precision: wilson(0.12, 1200), outcome: { mean: 79, std: 4, p10: 74, p50: 79, p90: 84 } });
    run.identity_evaluations = (g.nodes as Rec[]).filter((n) => n.nonlinear_identity).map((n) => ({ node_id: n.id, evaluated: true, ...(n.nonlinear_identity as Rec) }));
    expect(goalHorizonVerdict(g, run)).toBe('computed_at_h');
    const l = goalChanceLicenceOf(run, g, 'capacity', () => false, undefined, g, {})!;
    expect(l.pct_by_option).toMatchObject({ carry_on: 12 });
    expect(l.status_quo).toBeUndefined();
    expect(l.notes).toContain('‘Carry on as now’ is this model’s projection for carrying on as now, with its own uncertainty — not an assumption that nothing changes.');
    expect(JSON.stringify(l)).not.toMatch(/by assumption|carrying on as now leaves|reference_moved/);
    // CONTROL: the same graph with the carrier NOT evaluated is a held month the Run did not carry — no claim either way.
    const uncarried = { ...run, identity_evaluations: [] };
    expect(goalHorizonVerdict(g, uncarried)).toBe('withhold');
    const u = goalChanceLicenceOf(uncarried, g, 'capacity', () => false, undefined, g, {})!;
    expect(JSON.stringify(u)).not.toMatch(/by assumption|projection for carrying on|reference_moved/);
  });

  it('CONTROL (assumed): ordinary anchored capacity and hiring\'s change quantity keep the assumption line, with no interval', () => {
    expect(capacityLicence()!.status_quo?.line).toBe('Doing nothing: no change to ‘Development capacity’ in this model, by assumption.');
    const g = hiringGraph();
    expect(goalChanceLicenceOf(hiringRun(), g, 'productivity', () => false, undefined, g, hiringConstraints(g))!.status_quo?.option_id).toBe('carry_on');
    // Hiring's status quo whose change is NOT 0 disagrees with its own reference: withheld with that reason.
    const drift = hiringRun();
    (drift.option_comparison as Rec[])[2]!.outcome = { mean: 2, std: 1, p10: 1, p50: 2, p90: 3 };
    const l = goalChanceLicenceOf(drift, g, 'productivity', () => false, undefined, g, hiringConstraints(g))!;
    expect(l.withheld_reason_by_option?.carry_on).toEqual({ reason: 'reference_moved', line: MOVED('Productivity') });
    expect(l.status_quo).toBeUndefined();
  });
});

// AND: each condition keeps its own frame, population and timing — the primary goal never attests a secondary target.
const pairedPair = (conversion: Rec = { observed_state: { value: 0.1, raw_value: 10, cap: 100, unit: '%', source: 'brief_extraction' } }): Rec => {
  const g = marketingGraph();
  const nodes = g.nodes as Rec[];
  Object.assign(nodes[0]!, { goal_target_basis: { ...MARKETING_BASIS, reference: 'today', period_kind: 'at_end' },
    observed_state: { value: 0.2, raw_value: 5, cap: 25, unit: 'customers', source: 'brief_extraction' } });
  Object.assign(nodes[1]!, conversion);
  nodes.push({ id: 'carry_on', kind: 'option', label: 'Carry on as now', is_baseline: true });
  g.edges = [{ from: 'annual_spend', to: 'new_customers' }, { from: 'annual_spend', to: 'conversion_rate' }];
  return g;
};
const withSqRow = (run: Rec, sq: Rec): Rec => ({ option_comparison: [...(run.option_comparison as Rec[]), { option_id: 'carry_on',
  probability_of_goal: 0, probability_of_joint_goal: 0, probability_of_joint_goal_precision: PRECISION, ...sq }] });

describe('AIE status-quo disposition — AND: the joint and its marginals keep each condition\'s OWN reference', () => {
  it('RED: marketing (read from launch, no level today) — no universal "no change", no assumption note; the status quo keeps its figures', () => {
    const g = marketingGraph();
    (g.nodes as Rec[]).push({ id: 'carry_on', kind: 'option', label: 'Carry on as now', is_baseline: true });
    const run = withSqRow(marketingRun(), { probability_of_goal: 0.3, probability_of_joint_goal: 0.12,
      constraint_probabilities: { 'target:new_customers': 0.3, 'target:conversion_rate': 0.25 },
      constraint_probabilities_precision: { 'target:new_customers': PRECISION, 'target:conversion_rate': PRECISION } });
    const l = licenceFor(run, g)!;
    expect(l.targets!.joint.status).toBe('licensed');
    expect(l.status_quo).toBeUndefined();
    expect(JSON.stringify(l)).not.toMatch(/by assumption|carrying on as now leaves/);
    expect(l.pct_by_option).toEqual({ hire_manager: 35, ai_plus_ads: 48, carry_on: 12 });
    expect(l.targets!.per_target.find((t) => t.constraint_id === 'target:new_customers')!.pct_by_option).toEqual({ hire_manager: 60, ai_plus_ads: 70, carry_on: 30 });
  });

  it('CONTROL: both targets on the same-draw reference (anchored, reached, from today) — the line names both; no figure for the status quo', () => {
    const g = pairedPair();
    const run = withSqRow(marketingRun(), { constraint_probabilities: { 'target:new_customers': 0, 'target:conversion_rate': 0 } });
    const l = licenceFor(run, g)!;
    expect(l.status_quo).toEqual({ option_id: 'carry_on', line: 'Doing nothing: no change to ‘New customers’ or ‘Conversion rate’ in this model, by assumption.' });
    expect(l.notes).toContain('This assumes carrying on as now leaves ‘New customers’ and ‘Conversion rate’ unchanged through month three; each option is measured against that.');
    expect(Object.keys(l.pct_by_option)).toEqual(['hire_manager', 'ai_plus_ads']);
    for (const t of l.targets!.per_target) expect(t.pct_by_option).not.toHaveProperty('carry_on');
  });

  it('RED: the goal on the same-draw reference but ‘Conversion rate’ not anchored — the assumption names the goal only; the status quo keeps its joint and conversion figures', () => {
    const g = pairedPair({});
    const run = withSqRow(marketingRun(), { probability_of_joint_goal: 0, constraint_probabilities: { 'target:new_customers': 0, 'target:conversion_rate': 0.25 } });
    const l = licenceFor(run, g)!;
    expect(l.status_quo).toBeUndefined();
    expect(l.notes).toContain('This assumes carrying on as now leaves ‘New customers’ unchanged through month three; each option is measured against that.');
    expect(JSON.stringify(l.notes)).not.toMatch(/‘Conversion rate’ unchanged/);
    expect(l.pct_by_option).toHaveProperty('carry_on');
    const per = Object.fromEntries(l.targets!.per_target.map((t) => [t.constraint_id, t.pct_by_option]));
    expect(per['target:new_customers']).not.toHaveProperty('carry_on');
    expect(per['target:conversion_rate']).toMatchObject({ carry_on: 25 });
  });

  it('RED (drift): both on the same-draw reference but the status quo\'s conversion share is 25% — withheld with that reason, never relabelled', () => {
    const g = pairedPair();
    const run = withSqRow(marketingRun(), { constraint_probabilities: { 'target:new_customers': 0, 'target:conversion_rate': 0.25 } });
    const l = licenceFor(run, g)!;
    expect(l.status_quo).toBeUndefined();
    expect(l.withheld_option_ids).toContain('carry_on');
    expect(l.withheld_reason_by_option).toEqual({ carry_on: { reason: 'reference_moved', line: MOVED('Conversion rate') } });
    for (const t of l.targets!.per_target) expect(t.pct_by_option).not.toHaveProperty('carry_on');
  });
});
