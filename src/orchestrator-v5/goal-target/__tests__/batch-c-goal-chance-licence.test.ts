/**
 * Recovery Batch C — the goal-chance licence says the ruled sentence for a CHANGE target, labels Olumi's starting value as
 * estimate_only, and, with several targets, makes the same-draw joint the headline or withholds it with its reason
 * (Batch 0 change-goal decision rulings 15–22; amendments 1–7; DL amendment 22:15Z). Hand-written figures throughout: the
 * licence never computes a chance, it decides what may be said about the Run's own.
 */
import { describe, expect, it } from 'vitest';

import { goalChanceLicenceForAgent, goalChanceLicenceOf, goalChancePointForAgent, goalLevelIsOlumisEstimate, nearestFiveGoalChancesForAgent, sentGoalThresholdOf, UNVERIFIED_SOURCES_NOTE, withGoalChanceLicence, withholdForOlumiGoalLevel } from '../goal-chance-licence.js';
import { goalChanceFactsForAgent } from '../goal-chance-range-agent.js';
import { goalHorizonVerdict } from '../goal-horizon-verdict.js';
import { conditionsRefusedBasis, CONDITIONS_NOT_KEPT, targetChanceWords } from '../goal-target-basis.js';
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
// ⛔ CHANGED EXPECTATION (G / D2, AIE #94 6133027121): a change goal's status quo is read as paired only from what the PRODUCER
// scored — the goal CEE SENT for this Run (`sentRunPairsChange`), never the goal's own frame — so the Run's request rides here.
const hiringConstraints = (g: Rec) => ({ storedConstraints: g.goal_constraints, sentConstraints: wireGoalConstraints(g.goal_constraints),
  sentRun: { graph: g } });

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

  it('RED (amendment 4): "productivity only" — the £200,000 limit (typed), and every condition from the brief', () => {
    const g = hiringGraph();
    const l = goalChanceLicenceOf(hiringRun(), g, 'productivity', () => false, undefined, g, hiringConstraints(g))!;
    // Batch C re-scope (DL after independent check r2, BLOCKING 2): EVERY retained condition is said in its kept words — the
    // drafter's "spend within £200,000" is no longer matched away by the typed limit's figure (said beside it, not dropped).
    expect(l.notes).toContain('This chance covers ‘Productivity’ only. It does not include: ‘First-year hiring cost’ at most £200,000; '
      + 'code quality maintained; spend within £200,000.');
  });

  it('RED on 2ecbae5 (r2 BLOCKING 2): a condition that shares the typed limit\'s figure but says more is never matched away', () => {
    const g = hiringGraph({ goal_target_basis: { ...HIRING_BASIS, also_required: ['spend within £200,000 and no new contractors'] } });
    const l = goalChanceLicenceOf(hiringRun(), g, 'productivity', () => false, undefined, g, hiringConstraints(g))!;
    expect(l.notes).toContain('This chance covers ‘Productivity’ only. It does not include: ‘First-year hiring cost’ at most £200,000; '
      + 'spend within £200,000 and no new contractors.');
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

  it('NEGATIVE (amendment 3, unchanged): the ambiguity framing and its reason stay as they were (by identity)', () => {
    const q = 'Should “at least 10%” mean 10% more development capacity than today, or 10 more percentage points of time on development?';
    const g = hiringGraph({ goal_target_basis: { ...HIRING_BASIS, open_question: q } });
    const w = ((withholdForOpenTargetQuestion(hiringRun(), g, 'productivity') as Rec).inference_warnings as Rec[])
      .find((x) => x.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE')!;
    expect(w).toMatchObject({ message: `Not shown. Your target can be read more than one way. ${q}`, detail: { reason: 'target_reading_open' } });
  });

  // ⛔ RE-SCOPE 2 (R5-5 (a), DL ruling): admission's refusal for conditions rides the existing carrier as the AIE's sentence
  // (`CONDITIONS_NOT_KEPT`); the gate says it as a statement — never as a question the person could answer — and its reason wins
  // over the placeholder-path warning (nothing false beside it).
  it('RED on e58b8dbd: open_question = CONDITIONS_NOT_KEPT → "Not shown. Olumi cannot keep every additional condition intact in this analysis."', () => {
    expect(CONDITIONS_NOT_KEPT).toBe('Olumi cannot keep every additional condition intact in this analysis.');
    const g = hiringGraph({ goal_target_basis: { ...HIRING_BASIS, also_required: null, open_question: CONDITIONS_NOT_KEPT } });
    expect(goalChanceLicenceOf(hiringRun(), g, 'productivity', () => false, undefined, g, hiringConstraints(g))).toBeNull();
    const held = withholdForOpenTargetQuestion(hiringRun(), g, 'productivity') as Rec;
    expect((held.option_comparison as Rec[]).every((r) => !('probability_of_goal' in r))).toBe(true);
    const warnings = held.inference_warnings as Rec[];
    expect(warnings.filter((x) => x.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE')).toEqual([expect.objectContaining({
      message: 'Not shown. Olumi cannot keep every additional condition intact in this analysis.', detail: expect.objectContaining({ reason: 'conditions_not_kept' }) })]);
    expect(JSON.stringify(warnings)).not.toMatch(/read more than one way|\?/);
    expect(warnings.some((x) => x.code === 'GOAL_FIGURES_PLACEHOLDER_PATH')).toBe(false);
  });

  it('admission writes CONDITIONS_NOT_KEPT only for a refusal FOR CONDITIONS — never for any other refusal', () => {
    const args = { targetFrame: 'change_abs', targetRaw: 10, quantityFrame: 'change', horizonMonths: 3, drafted: { ...HIRING_BASIS } } as never;
    expect(conditionsRefusedBasis(args, { refused: 'conditions' })?.open_question).toBe(CONDITIONS_NOT_KEPT);
    expect(conditionsRefusedBasis(args, { refused: 'condition_text' })?.open_question).toBe(CONDITIONS_NOT_KEPT);
    for (const other of ['reference', 'denominator', 'period', 'period_conflict', 'effect_unit', 'frame'] as const) {
      expect(conditionsRefusedBasis(args, { refused: other }), other).toBeUndefined();
    }
    expect(conditionsRefusedBasis(args, { basis: {} })).toBeUndefined();
    // Never a subset: the kept reading carries no condition at all.
    expect(conditionsRefusedBasis(args, { refused: 'conditions' })?.also_required ?? null).toBeNull();
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
      observed_state: { value: 20000 / 27500, baseline: 20000 / 27500, unit: 'GBP/month', source, ...(source === 'brief_extraction' ? { extractionType: 'explicit' } : {}), raw_value: 20000, cap: 27500 },
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

  // RE-SCOPE 2 (DL AMEND item 2, position: the base of a RELATIVE change): `estimate_only` says Olumi's base, once — the census
  // never counts it a second time; an UNVERIFIED base is neither Olumi's estimate_only nor the person's: it is the note.
  it('RE-SCOPE 2: Olumi\'s change_rel base is said once (estimate_only) — never counted again, never the unverified note', () => {
    const l = goalChanceLicenceOf(mrrRun, mrrGraph('cee_inference'), 'mrr', () => false, undefined, mrrGraph('cee_inference'))! as unknown as Rec;
    expect(l).not.toHaveProperty('olumi_estimate_value_count');
    expect(unverifiedNotes(l)).toBe(0);
  });
  it('RE-SCOPE 2: an UNVERIFIED change_rel base → not estimate_only, the note said once', () => {
    const g = mrrGraph('something_else');
    const l = goalChanceLicenceOf(mrrRun, g, 'mrr', () => false, undefined, g)! as unknown as Rec;
    expect(l.estimate_only).toBeUndefined();
    expect(unverifiedNotes(l)).toBe(1);
    expect(l).not.toHaveProperty('olumi_estimate_value_count');
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
      observed_state: { value: 0, baseline: 0, raw_value: 0, cap: 100, unit: '%', source: 'brief_extraction', extractionType: 'explicit' } },
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

  it.each([
    ['the same 15% over a DISTINCT period', 'conversion above 15% again over the first twelve months'],
    ['another quantity quoting the same figure (15%)', 'a launch discount of no more than 15% in the first month'],
  ])('RED on 2ecbae5 (r2 BLOCKING 2): a retained condition is said beside the joint even when it shares a figure (%s)', (_name, condition) => {
    const g = marketingGraph();
    (g.nodes as Rec[])[0] = { ...(g.nodes as Rec[])[0], goal_target_basis: { ...MARKETING_BASIS, also_required: [condition] } };
    const l = licenceFor(marketingRun(), g)!;
    expect(l.targets!.joint.status).toBe('licensed');
    expect(l.notes).toContain(`This chance covers ‘New customers’ and ‘Conversion rate’ only. It does not include: ${condition}.`);
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
      observed_state: { value: 0.75, baseline: 0.75, raw_value: 75, cap: 100, unit: '%', source: 'brief_extraction', extractionType: 'explicit' }, ...over.goal },
    { id: 'devs', kind: 'factor', label: 'Developers', observed_state: over.factorOs ?? { value: 0.6, raw_value: 6, cap: 10, unit: 'people', source: 'brief_extraction', extractionType: 'explicit' } },
    { id: 'lead', kind: 'option', label: 'Hire a tech lead', interventions: { devs: over.setting ?? { value: 0.6, raw_value: 6, source: 'brief_extraction', extractionType: 'explicit', target_match: { node_id: 'devs' } } } },
    { id: 'two', kind: 'option', label: 'Hire two developers', interventions: { devs: { value: 0.8, raw_value: 8, source: 'brief_extraction', extractionType: 'explicit', target_match: { node_id: 'devs' } } } },
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
/**
 * D2 (DL ruling A, 12 Oct, recovery Batch D): the status quo is read in the frame the Run was scored in, from the field the
 * Run itself records (`sentGoalThresholdOf`, as run-analysis does); unknown stays unknown. On the wire the samples are
 * normalised (served capacity: 0.16 = 80/500; the 11 Oct Run recorded `goal_threshold`, frame 'delta'), so the status-quo
 * rows below are WIRE-SHAPED: 0.75 = 75/100. The raw rows above (75) were self-authored and never on the wire.
 */
const capacityWireRun = (): Rec => ({ option_comparison: [
  { option_id: 'lead', probability_of_goal: 0.46, probability_of_goal_precision: wilson(0.46, 4600), outcome: { mean: 0.84, std: 0.03, p10: 0.8, p50: 0.84, p90: 0.88 } },
  { option_id: 'two', probability_of_goal: 0.31, probability_of_goal_precision: wilson(0.31, 3100), outcome: { mean: 0.83, std: 0.03, p10: 0.79, p50: 0.83, p90: 0.87 } },
  { option_id: 'carry_on', probability_of_goal: 0, probability_of_goal_precision: wilson(0, 0), outcome: { mean: 0.75, std: 0, p10: 0.75, p50: 0.75, p90: 0.75 } },
] });
/** The status quo's typed zero-spread line (Science §(ab)(2)), its true reading when the frame is unknown. */
const ZERO_SPREAD_LINE = 'Falls short of 85% if today’s figures hold.';
/** The field this Run records for itself (run-analysis.ts: `sentGoalThresholdOf` beside `withGoalChanceLicence`). */
const recordedField = (run: Rec, g: Rec) => sentGoalThresholdOf(run, g, 'capacity', () => false);
const wireLicence = (g: Rec = capacityGraph(), run: Rec = capacityWireRun()) => goalChanceLicenceOf(run, g, 'capacity', () => false, recordedField(run, g), g, {});
const wireEnvelope = (run: Rec, g: Rec = capacityGraph()): Rec => withGoalChanceLicence(run, g, 'capacity', () => false, recordedField(run, g), g, {}) as Rec;

describe('independent check r1 — item 1: a percentage quantity changed by an absolute amount is said in POINTS', () => {
  // The discriminator is the goal's quantity frame (DL precision, 12 Oct): 'level' → points; 'change' → % of today; neither → not said.
  const CAPACITY_BASIS = { ...HIRING_BASIS, quantity_frame: 'level', denominator: 'today’s development capacity (75%)',
    effect_unit: 'percentage points of capacity per added person, at month three' };
  const capacityChange = (goal: Rec): Rec => hiringGraph({ label: 'Development capacity',
    observed_state: { value: 0.75, baseline: 0.75, raw_value: 75, cap: 100, unit: '%', source: 'brief_extraction', extractionType: 'explicit' }, ...goal });
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
    // D2: read in the Run's recorded frame (goal_threshold → today's normalised 0.75), on wire-shaped rows.
    expect(recordedField(capacityWireRun(), capacityGraph())).toEqual({ value: 0.85, field: 'goal_threshold', frame: 'delta' });
    const l = wireLicence()!;
    expect(l.pct_by_option).toEqual({ lead: 46, two: 31 });
    expect(l.withheld_option_ids).toEqual(['carry_on']);
    expect(l.status_quo).toEqual({ option_id: 'carry_on', line: 'Doing nothing: no change to ‘Development capacity’ in this model, by assumption.' });
    expect(l.notes).toContain('This assumes carrying on as now leaves ‘Development capacity’ unchanged; each option is measured against that.');
    // The option's sentence is exactly today's: "about N% chance of meeting your goal, in this model".
    expect(l.chance_words).toBeUndefined();
    const g = capacityGraph();
    const env = wireEnvelope(capacityWireRun(), g);
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
    // D2 (DL ruling A): with nothing licensed the Run records no field, so its frame is unknown and no "no change" is
    // claimed; the status quo keeps its TRUE zero-spread line (as served run 3's capacity status quo now does).
    const run = capacityWireRun();
    for (const row of (run.option_comparison as Rec[]).slice(0, 2)) delete row.probability_of_goal;
    const g = capacityGraph();
    expect(recordedField(run, g), 'nothing licensed: the Run records no field').toBeUndefined();
    const l = goalChanceLicenceOf(run, g, 'capacity', () => false, recordedField(run, g), g, {})!;
    expect(l).not.toBeNull();
    expect(l).toMatchObject({ message: '', pct_by_option: {}, withheld_option_ids: ['lead', 'two', 'carry_on'],
      withheld_reason_by_option: { carry_on: { reason: 'zero_spread', side: 'falls_short', line: ZERO_SPREAD_LINE } } });
    expect(l.status_quo).toBeUndefined();
    for (const key of ['leader_option_id', 'similar_option_ids', 'olumi_estimate_link_count', 'provisional']) {
      expect(l).not.toHaveProperty(key);
    }
    const env = wireEnvelope(run, g);
    const cells = Object.fromEntries(projectCanonicalAnalysisCells({ type: 'analysis_result', enrichment: env } as never, g).map((c) => [c.option_id, c.cell as Rec]));
    expect(cells.carry_on).toMatchObject({ kind: 'withheld', why: ZERO_SPREAD_LINE });
    expect(JSON.stringify(cells.carry_on)).not.toMatch(/by assumption|doesn’t match/);
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
    // CONTROL: the same status quo with no held month is amendment 1's (D2: wire-shaped, in the Run's recorded frame).
    expect(wireLicence()!.status_quo?.option_id).toBe('carry_on');
    expect(wireLicence()).not.toHaveProperty('withheld_reason_by_option');
  });

  it('RED: the level status quo row carries no precision and no Monte Carlo interval; the options keep theirs', () => {
    const g = capacityGraph();
    const env = wireEnvelope(capacityWireRun(), g);
    const rows = Object.fromEntries((env.option_comparison as Rec[]).map((r) => [r.option_id, r]));
    expect(rows.carry_on).not.toHaveProperty('probability_of_goal_precision');
    expect(rows.carry_on.outcome).toEqual({ mean: 0.75, p50: 0.75 });
    expect(rows.lead).toEqual((capacityWireRun().option_comparison as Rec[])[0]);
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

// ── RE-SCOPE 2 (R5-2; DL AMEND, AIE #94 6119326092 item 1): THREE provenance states — HUMAN only by positive attestation, AI
// ORIGIN only for a recognised AI source, anything else UNVERIFIED: never counted as Olumi's, never read as the person's, and
// never "zero estimates" — disclosed ONCE beside the result in the AIE's minimal existing-notes wording.
const UNVERIFIED = 'Provisional: this result uses inputs whose sources have not been verified.';
/** A read-only view of a licence record in assertions. */
type Loose = Record<string, any>;
const unverifiedNotes = (l: Rec | null): number => ((l?.notes as string[] | undefined) ?? []).filter((n) => n === UNVERIFIED).length;
describe('RE-SCOPE 2 (R5-2): an input whose source is unverified is disclosed once — never "zero estimates", never Olumi\'s', () => {
  const unverifiedFactor = (os: Rec): Rec => capacityGraph({ factorOs: os });
  it('the exported note is the AIE\'s minimal wording, by identity', () => {
    expect(UNVERIFIED_SOURCES_NOTE).toBe(UNVERIFIED);
  });
  it.each([
    ['no source at all', { value: 0.6, raw_value: 6, cap: 10, unit: 'people' }],
    ['user material the receipt gate could not verify', { value: 0.6, raw_value: 6, cap: 10, unit: 'people', source: 'brief_extraction', user_material_unverified: true }],
    ['an unrecognised source', { value: 0.6, raw_value: 6, cap: 10, unit: 'people', source: 'something_else' }],
  ])('RED on e58b8dbd: a starting value with %s on the goal path → licensed, the note said once, labelled provisional, no Olumi count', (_name, os) => {
    const g = unverifiedFactor(os);
    const l = capacityLicence(g)! as unknown as Loose;
    expect(Object.keys(l.pct_by_option)).toEqual(['lead', 'two']);
    expect(unverifiedNotes(l)).toBe(1);
    // LABEL, DON'T WITHHOLD (DL 12 Oct): shown, never unlabelled — provisional, the note saying what it rests on.
    expect(l.provisional).toBe(true);
    expect(l).not.toHaveProperty('olumi_estimate_value_count');
    // The screen's face is the ordinary one (no estimate words): the note, not a count, says it.
    const env = withGoalChanceLicence(capacityRun(), g, 'capacity', () => false, undefined, g, {});
    const result = { type: 'analysis_result', enrichment: env };
    expect(goalChanceCellFacesForAgent(result, g, true).get('lead')).toBe('‘Hire a tech lead’: about 46% chance of meeting your goal, in this model.');
    // The Agent's chat and the canonical view's `detail.notes` (`canonical-analysis-view.ts`, `facts.goal_chance_notes`) say it too.
    expect(goalChanceNotesForAgent(result, g, true).filter((n) => n === UNVERIFIED)).toHaveLength(1);
    expect(goalChanceFactsForAgent(result, g, true).goal_chance_notes).toEqual(l.notes);
  });
  it('RED on e58b8dbd: a SETTING with no source (not the event-by-date switch) → the note, on that option\'s Run; never Olumi\'s', () => {
    const l = capacityLicence(capacityGraph({ setting: { value: 0.6, raw_value: 6, target_match: { node_id: 'devs' } } }))! as unknown as Loose;
    expect(unverifiedNotes(l)).toBe(1);
    expect(l).not.toHaveProperty('olumi_estimate_settings_by_option');
    expect(l.provisional).toBe(true);
  });
  it('CONTROL: every input attested as the user\'s (`brief_extraction` + `explicit`, or the person\'s own stamps) → no note', () => {
    const l = capacityLicence()! as unknown as Loose;
    expect(unverifiedNotes(l)).toBe(0);
    expect(l.provisional).toBeUndefined();
  });
  // ⛔ RULED (DL 12 Oct, after the last check's BLOCKING 1: "my ruling 1 … was WRONG"): admission's own goal-level stamp —
  // `brief_extraction` with no extraction type, written at `admit-model.ts` `briefGoalObservedState` on the drafter's claim
  // alone — is the person's BY ITS STAMP ALONE. It is LABELLED (the note once, provisional), never withheld.
  it('RULED: admission\'s own type-less goal-level stamp → licensed, the note said once, provisional (labelled, never withheld)', () => {
    const typeless = { value: 0.75, baseline: 0.75, raw_value: 75, cap: 100, unit: '%', source: 'brief_extraction' };
    const l = capacityLicence(capacityGraph({ goal: { observed_state: typeless } }))! as unknown as Loose;
    expect(Object.keys(l.pct_by_option)).toEqual(['lead', 'two']);
    expect(unverifiedNotes(l)).toBe(1);
    expect(l.provisional).toBe(true);
    expect(l).not.toHaveProperty('olumi_estimate_value_count');
  });
  it('CONTROL: a recognised AI source is Olumi\'s (counted), never the unverified note', () => {
    const l = capacityLicence(unverifiedFactor({ value: 0.6, raw_value: 6, cap: 10, unit: 'people', source: 'cee_inference', extractionType: 'inferred' }))! as unknown as Loose;
    expect(l.olumi_estimate_value_count).toBe(1);
    expect(unverifiedNotes(l)).toBe(0);
  });
  // AIE R5 item 2: the existing stronger rule is kept for the scored goal's OWN level — admission never admits Olumi's own
  // estimate of it, so a level chance on Olumi's goal level is withheld, never relabelled provisional. Not a new human-only
  // rule: a goal level whose source is unverified is disclosed by the note, like any other input.
  it('RED on e58b8dbd: the scored goal\'s own LEVEL as Olumi\'s estimate → no chance licensed (refusal kept)', () => {
    const os = { value: 0.75, baseline: 0.75, raw_value: 75, cap: 100, unit: '%', source: 'cee_inference', extractionType: 'inferred' };
    expect(capacityLicence(capacityGraph({ goal: { observed_state: os } }))).toBeNull();
  });
  it('DL 12 Oct (KEEP (a)): that refusal is never silent — the Run says why and names the next step (confirm, or give today\'s level)', () => {
    const os = { value: 0.75, baseline: 0.75, raw_value: 75, cap: 100, unit: '%', source: 'cee_inference', extractionType: 'inferred' };
    const g = capacityGraph({ goal: { observed_state: os } });
    expect(goalLevelIsOlumisEstimate(g, 'capacity')).toBe(true);
    const out = withholdForOlumiGoalLevel(capacityRun(), g, 'capacity') as Rec;
    const w = (out.inference_warnings as Rec[]).filter((x) => x.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE');
    expect(w).toHaveLength(1);
    expect(w[0]!.detail).toEqual({ reason: 'goal_level_olumi_estimate' });
    expect(w[0]!.option_ids).toEqual(['lead', 'two', 'carry_on']);
    expect(w[0]!.message).toBe('Not shown. Today’s ‘Development capacity’ in this model is Olumi’s estimate, not a figure you gave, so no '
      + 'chance of reaching your target is shown. To see it, confirm Olumi’s estimate of today’s ‘Development capacity’, or tell me what it is today.');
    expect(w[0]!.say).toBe('To see it, confirm Olumi’s estimate of today’s ‘Development capacity’, or tell me what it is today.');
    // CONTRAST, same commit: the person's level (and an accepted estimate) → nothing withheld, the envelope untouched.
    for (const goalOs of [undefined, { ...os, source: 'user_assumption', extractionType: undefined, reviewed_by_user: { intent: 'confirm' } }]) {
      const h = goalOs === undefined ? capacityGraph() : capacityGraph({ goal: { observed_state: goalOs } });
      expect(goalLevelIsOlumisEstimate(h, 'capacity')).toBe(false);
      const env = capacityRun();
      expect(withholdForOlumiGoalLevel(env, h, 'capacity')).toBe(env);
      expect(capacityLicence(h)).not.toBeNull();
    }
  });
  it.each([
    ['no source', { source: undefined }],
    ['unverified user material', { user_material_unverified: true }],
  ])('RED on e58b8dbd: the scored goal\'s own LEVEL with %s → licensed, the note said once (never refused by a human-only rule)', (_name, over) => {
    const os = { value: 0.75, baseline: 0.75, raw_value: 75, cap: 100, unit: '%', source: 'brief_extraction', ...over };
    const l = capacityLicence(capacityGraph({ goal: { observed_state: os } }))! as unknown as Loose;
    expect(Object.keys(l.pct_by_option)).toEqual(['lead', 'two']);
    expect(unverifiedNotes(l)).toBe(1);
    expect(l).not.toHaveProperty('olumi_estimate_value_count');
  });
  it('CONTROL: an ACCEPTED Olumi estimate of the goal\'s level (`user_assumption` + a confirm review) keeps its existing reading', () => {
    const os = { value: 0.75, baseline: 0.75, raw_value: 75, cap: 100, unit: '%', source: 'user_assumption', reviewed_by_user: { intent: 'confirm' } };
    expect(capacityLicence(capacityGraph({ goal: { observed_state: os } }))).not.toBeNull();
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
/** D2: the same status-quo variants on wire-shaped rows, read in the Run's recorded frame. */
const capacityWireWith = (sq: Rec): Rec => {
  const run = capacityWireRun();
  (run.option_comparison as Rec[])[2] = { ...(run.option_comparison as Rec[])[2], ...sq };
  return run;
};
const cellsOf = (run: Rec, g: Rec): Record<string, Rec> => {
  // D2: the envelope as run-analysis writes it, with the field the Run records for itself.
  const env = wireEnvelope(run, g);
  return Object.fromEntries(projectCanonicalAnalysisCells({ type: 'analysis_result', enrichment: env } as never, g).map((c) => [c.option_id, c.cell as Rec]));
};

describe('AIE status-quo disposition — the same-draw reference is decided by the checked facts, and checked by the Run', () => {
  it.each([
    ['spreads (72%–80%)', { probability_of_goal: 0.1, outcome: { mean: 0.76, std: 0.03, p10: 0.72, p50: 0.76, p90: 0.8 } }],
    ['drifts to 78% with no spread', { outcome: { mean: 0.78, std: 0, p10: 0.78, p50: 0.78, p90: 0.78 } }],
    ['meets the target on some draws only', { probability_of_goal: 0.2 }],
  ])('RED (drift): an ordinary paired Run whose status quo %s is withheld with that reason — never a finding, never "no change"', (_name, sq) => {
    // D2: wire-shaped rows, read in the frame the Run records (goal_threshold → 0.75).
    const g = capacityGraph();
    const run = capacityWireWith(sq);
    expect(recordedField(run, g)?.field).toBe('goal_threshold');
    const l = goalChanceLicenceOf(run, g, 'capacity', () => false, recordedField(run, g), g, {})!;
    expect(l.pct_by_option).toEqual({ lead: 46, two: 31 });
    expect(l.withheld_option_ids).toEqual(['carry_on']);
    expect(l.withheld_reason_by_option).toEqual({ carry_on: { reason: 'reference_moved', line: MOVED('Development capacity') } });
    expect(l.status_quo).toBeUndefined();
    expect(JSON.stringify(l)).not.toMatch(/by assumption|carrying on as now leaves/);
    expect(cellsOf(run, g).carry_on).toEqual({ kind: 'withheld', face: 'Chance not shown yet', why: MOVED('Development capacity'),
      reasons: [{ code: 'reference_moved', message: MOVED('Development capacity') }] });
    // Read back by the Agent exactly as stored; a malformed one (with a side, or no line) speaks for nothing.
    const env = wireEnvelope(run, g);
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
    ['a goal an option SETS directly', (g: Rec) => { ((g.nodes as Rec[])[2]!.interventions as Rec).capacity = { value: 0.8, raw_value: 80, source: 'brief_extraction', extractionType: 'explicit' }; }],
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
    // D2: capacity on wire-shaped rows, in the Run's recorded frame; hiring's change quantity is 0 today by construction.
    expect(wireLicence()!.status_quo?.line).toBe('Doing nothing: no change to ‘Development capacity’ in this model, by assumption.');
    const g = hiringGraph();
    expect(goalChanceLicenceOf(hiringRun(), g, 'productivity', () => false, undefined, g, hiringConstraints(g))!.status_quo?.option_id).toBe('carry_on');
    // Hiring's status quo whose change is NOT 0 disagrees with its own reference: withheld with that reason.
    // ⛔ CHANGED EXPECTATION (G; DL ruling 12 Oct: the AIE's D2 exact equality IN THE RUN'S OWN RECORDED FRAME). A change goal is
    // scored as the PAIRED change, so the drift is read where the Run records it — its chance: a zero change cannot score 1
    // against "at least +10%", nor anything strictly between. The row's `outcome` is the goal's raw LEVEL samples (served run 4,
    // turns/07.json: std 0.188 beside an earned 0), another frame, and is no longer compared with the change's 0.
    for (const p of [1, 0.4]) {
      const drift = hiringRun();
      (drift.option_comparison as Rec[])[2]!.probability_of_goal = p;
      const l = goalChanceLicenceOf(drift, g, 'productivity', () => false, undefined, g, hiringConstraints(g))!;
      expect(l.withheld_reason_by_option?.carry_on, String(p)).toEqual({ reason: 'reference_moved', line: MOVED('Productivity') });
      expect(l.status_quo, String(p)).toBeUndefined();
    }
    const level = hiringRun();
    (level.option_comparison as Rec[])[2]!.outcome = { mean: 2, std: 1, p10: 1, p50: 2, p90: 3 };
    expect(goalChanceLicenceOf(level, g, 'productivity', () => false, undefined, g, hiringConstraints(g))!.status_quo?.option_id).toBe('carry_on');
  });
});

// AND: each condition keeps its own frame, population and timing — the primary goal never attests a secondary target.
const pairedPair = (conversion: Rec = { observed_state: { value: 0.1, raw_value: 10, cap: 100, unit: '%', source: 'brief_extraction', extractionType: 'explicit' } }): Rec => {
  const g = marketingGraph();
  const nodes = g.nodes as Rec[];
  Object.assign(nodes[0]!, { goal_target_basis: { ...MARKETING_BASIS, reference: 'today', period_kind: 'at_end' },
    observed_state: { value: 0.2, raw_value: 5, cap: 25, unit: 'customers', source: 'brief_extraction', extractionType: 'explicit' } });
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

// ── RE-SCOPE 2 (R5-3; AIE open 1, 6117911325 / 6118159163): the status quo's JOINT reads every condition the Run sent ──────
// `fromJoint` / the universal line read the actual joint's named targets AND limits; each marginal keeps its own target.
const SPEND_ROW = { constraint_id: 'limit:annual_spend', node_id: 'annual_spend', operator: '<=', value: 50000, unit: 'GBP', value_frame: 'level' };
/** Both targets on the same-draw reference, plus the included spend limit: anchored at £40,000 and reached from ‘Pricing’. */
const pairedWithLimit = (setDirectly: boolean): Rec => {
  const g = pairedPair();
  (g.goal_constraints as Rec[]).push({ ...SPEND_ROW });
  const nodes = g.nodes as Rec[];
  nodes.find((n) => n.id === 'annual_spend')!.observed_state = { value: 0.4, raw_value: 40000, cap: 100000, unit: 'GBP', source: 'brief_extraction', extractionType: 'explicit' };
  nodes.push({ id: 'pricing', kind: 'factor', label: 'Pricing', observed_state: { value: 0.3, raw_value: 30, cap: 100, unit: 'points', source: 'brief_extraction', extractionType: 'explicit' } });
  (g.edges as Rec[]).push({ from: 'pricing', to: 'annual_spend' });
  // An uncertain budget: the options set it directly, so carrying on's own spend is not established as unchanged.
  if (setDirectly) nodes.find((n) => n.id === 'hire_manager')!.interventions = { annual_spend: { value: 0.45, raw_value: 45000, source: 'brief_extraction', extractionType: 'explicit' } };
  return g;
};
const sqWith = (limitP: number, joint: number): Rec => withSqRow(marketingRun(), { probability_of_joint_goal: joint,
  constraint_probabilities: { 'target:new_customers': 0, 'target:conversion_rate': 0, 'limit:annual_spend': limitP } });

describe('RE-SCOPE 2 (R5-3): the status quo\'s joint reads every condition the Run sent — targets AND limits', () => {
  it('RED on e58b8dbd (fixed targets + an uncertain budget limit): the status quo keeps its varying joint; no universal "no change"', () => {
    const l = licenceFor(sqWith(0.4, 0), pairedWithLimit(true))!;
    expect(l.targets!.joint.status).toBe('licensed');
    // Its joint figure is the Run's own (the budget varies on carrying on): quoted, never withheld "by assumption".
    expect(l.pct_by_option).toEqual({ hire_manager: 35, ai_plus_ads: 48, carry_on: 0 });
    expect(l.status_quo).toBeUndefined();
    expect(l.withheld_option_ids ?? []).not.toContain('carry_on');
    // Each target's own marginal still keeps its own same-draw reference (no figure for the status quo there).
    for (const t of l.targets!.per_target) expect(t.pct_by_option).not.toHaveProperty('carry_on');
    expect(l.notes).toContain('This assumes carrying on as now leaves ‘New customers’ and ‘Conversion rate’ unchanged through month three; each option is measured against that.');
  });

  it('RED on e58b8dbd (limit-reference mismatch): a paired limit whose status-quo share disagrees with today — withheld from the joint, the limit named', () => {
    const l = licenceFor(sqWith(0.3, 0), pairedWithLimit(false))!;
    expect(l.targets!.joint.status).toBe('licensed');
    expect(l.status_quo).toBeUndefined();
    expect(l.withheld_option_ids).toContain('carry_on');
    expect(l.withheld_reason_by_option).toEqual({ carry_on: { reason: 'reference_moved', line: MOVED('Annual spend') } });
    expect(JSON.stringify(l)).not.toMatch(/Doing nothing: no change/);
  });

  it('RED on e58b8dbd: every condition — both targets and the paired limit — on the same-draw reference: the line names all three, no figure', () => {
    const l = licenceFor(sqWith(1, 0), pairedWithLimit(false))!;
    expect(l.status_quo).toEqual({ option_id: 'carry_on',
      line: 'Doing nothing: no change to ‘New customers’, ‘Conversion rate’ or ‘Annual spend’ in this model, by assumption.' });
    expect(Object.keys(l.pct_by_option)).toEqual(['hire_manager', 'ai_plus_ads']);
  });

  it('CONTROL (unchanged): with no limit sent, both targets on the same-draw reference — the line names both, as before', () => {
    const l = licenceFor(withSqRow(marketingRun(), { constraint_probabilities: { 'target:new_customers': 0, 'target:conversion_rate': 0 } }), pairedPair())!;
    expect(l.status_quo).toEqual({ option_id: 'carry_on', line: 'Doing nothing: no change to ‘New customers’ or ‘Conversion rate’ in this model, by assumption.' });
  });
});

// ── Re-scope (DL after independent check r2, BLOCKING 4): estimate attribution over EVERY target in the event ────────────
// The marketing joint rests on every input feeding ANY of its targets. Each target has its own lever: ‘Outreach’ feeds ‘New
// customers’ (Hire a marketing manager), ‘Ad quality’ feeds ‘Conversion rate’ (AI planning plus advertising). Every input is
// the user's except the ONE Olumi input under test, on ONE target's path.
type EstimateKind = 'link' | 'value' | 'setting' | 'target_value';
const USERS_LEVEL = (raw: number, unit: string): Rec => ({ value: raw / 100, raw_value: raw, cap: 100, unit, source: 'brief_extraction', extractionType: 'explicit' });
const OLUMIS_LEVEL = (raw: number, unit: string): Rec => ({ value: raw / 100, raw_value: raw, cap: 100, unit, source: 'cee_inference', extractionType: 'inferred' });
const USERS_LINK = { strength: { mean: 0.3, std: 0.05 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'user_specified', magnitude: 'user_stated' } };
const OLUMIS_LINK = { strength: { mean: 0.3, std: 0.05 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'ai_proposed', magnitude: 'olumi_estimate' } };
const LEVER = { new_customers: { lever: 'outreach', option: 'hire_manager' }, conversion_rate: { lever: 'ad_quality', option: 'ai_plus_ads' } } as const;
const marketingWithInputs = (estimate?: { readonly target: keyof typeof LEVER; readonly kind: EstimateKind }): Rec => {
  const g = marketingGraph();
  const olumi = (target: keyof typeof LEVER, kind: EstimateKind): boolean => estimate?.target === target && estimate.kind === kind;
  const nodes = g.nodes as Rec[];
  const conv = nodes.find((n) => n.id === 'conversion_rate')!;
  conv.observed_state = olumi('conversion_rate', 'target_value') ? OLUMIS_LEVEL(10, '%') : USERS_LEVEL(10, '%');
  for (const target of ['new_customers', 'conversion_rate'] as const) {
    const { lever, option } = LEVER[target];
    nodes.push({ id: lever, kind: 'factor', label: lever === 'outreach' ? 'Outreach' : 'Ad quality',
      observed_state: olumi(target, 'value') ? OLUMIS_LEVEL(40, 'points') : USERS_LEVEL(40, 'points') });
    nodes.find((n) => n.id === option)!.interventions = { [lever]: { value: 0.6, raw_value: 60,
      source: olumi(target, 'setting') ? 'cee_hypothesis' : 'brief_extraction', ...(olumi(target, 'setting') ? {} : { extractionType: 'explicit' }), target_match: { node_id: lever } } };
    (g.edges as Rec[]).push({ from: option, to: lever, strength: { mean: 1, std: 0 } },
      { from: lever, to: target, ...(olumi(target, 'link') ? OLUMIS_LINK : USERS_LINK) });
  }
  return g;
};
const JOINT_FACE = (option: 'hire_manager' | 'ai_plus_ads', inputs?: string): string =>
  `‘${option === 'hire_manager' ? 'Hire a marketing manager' : 'AI planning plus advertising'}’: about ${option === 'hire_manager' ? 35 : 48}% chance of `
  + '‘New customers’ being at least 20 customers and ‘Conversion rate’ being above 15% over the first three months after launch, in this model'
  + `${inputs === undefined ? '' : `, using Olumi's estimates for ${inputs} (see Check estimates)`}.`;

describe('RE-SCOPE 4 — the joint is provisional when an Olumi input feeds ANY target (one census over every target)', () => {
  it('CONTROL: every input the user\'s → the joint (35%, 48%) is not provisional, and its sentences carry no estimate words', () => {
    const g = marketingWithInputs();
    const l = licenceFor(marketingRun(), g)!;
    expect(l.targets!.joint.status).toBe('licensed');
    expect(l.pct_by_option).toEqual({ hire_manager: 35, ai_plus_ads: 48 });
    expect(l.provisional).toBeUndefined();
    expect(l).not.toHaveProperty('olumi_estimate_link_count');
    expect(l).not.toHaveProperty('olumi_estimate_value_count');
    expect(l).not.toHaveProperty('olumi_estimate_settings_by_option');
  });

  it('RED on 2ecbae5 (r2 BLOCKING 4, the checker\'s case): Olumi\'s baseline, setting and relationship feeding CONVERSION → the joint says so', () => {
    const g = marketingWithInputs();
    (g.nodes as Rec[]).find((n) => n.id === 'ad_quality')!.observed_state = OLUMIS_LEVEL(40, 'points');
    (g.nodes as Rec[]).find((n) => n.id === 'ai_plus_ads')!.interventions = { ad_quality: { value: 0.6, raw_value: 60, source: 'cee_hypothesis', target_match: { node_id: 'ad_quality' } } };
    (g.edges as Rec[]).find((e) => e.from === 'ad_quality' && e.to === 'conversion_rate')!.provenance = OLUMIS_LINK.provenance;
    const constraints = { storedConstraints: g.goal_constraints, sentConstraints: wireGoalConstraints(g.goal_constraints) };
    const l = licenceFor(marketingRun(), g)!;
    expect(l.pct_by_option).toEqual({ hire_manager: 35, ai_plus_ads: 48 });
    expect(l.provisional).toBe(true);
    expect(l).toMatchObject({ olumi_estimate_link_count: 1, olumi_estimate_value_count: 1, olumi_estimate_settings_by_option: { ai_plus_ads: 1 } });
    const env = withGoalChanceLicence(marketingRun(), g, 'new_customers', () => false, undefined, g, constraints);
    const faces = goalChanceCellFacesForAgent({ type: 'analysis_result', enrichment: env }, g, true);
    expect(faces.get('ai_plus_ads')).toBe(JOINT_FACE('ai_plus_ads', '1 starting value, 1 option setting and 1 relationship'));
    // The other option's result never carries ‘AI planning plus advertising’'s own setting.
    expect(faces.get('hire_manager')).toBe(JOINT_FACE('hire_manager', '1 starting value and 1 relationship'));
  });

  it('RED on 2ecbae5 (r2 BLOCKING 4): an option whose goal-alone chance is withheld still has ITS setting said on the quoted joint', () => {
    const g = marketingWithInputs({ target: 'conversion_rate', kind: 'setting' });
    const run = marketingRun();
    delete (run.option_comparison as Rec[]).find((r) => r.option_id === 'ai_plus_ads')!.probability_of_goal;
    const l = licenceFor(run, g)!;
    expect(l.targets!.joint.status).toBe('licensed');
    expect(l.pct_by_option).toEqual({ hire_manager: 35, ai_plus_ads: 48 });
    expect(l.provisional).toBe(true);
    expect(l.olumi_estimate_settings_by_option).toEqual({ ai_plus_ads: 1 });
  });

  // CENSUS: every target node in the licensed event is covered — for each target, each kind of Olumi input on its path alone.
  const cases: [keyof typeof LEVER, EstimateKind, Rec][] = [
    ['new_customers', 'link', { olumi_estimate_link_count: 1 }],
    ['new_customers', 'value', { olumi_estimate_value_count: 1 }],
    ['new_customers', 'setting', { olumi_estimate_settings_by_option: { hire_manager: 1 } }],
    ['conversion_rate', 'link', { olumi_estimate_link_count: 1 }],
    ['conversion_rate', 'value', { olumi_estimate_value_count: 1 }],
    ['conversion_rate', 'setting', { olumi_estimate_settings_by_option: { ai_plus_ads: 1 } }],
  ];
  it.each(cases)('CENSUS: an Olumi %s-path %s alone makes the joint provisional, counted once', (target, kind, counts) => {
    const g = marketingWithInputs({ target, kind });
    const l = licenceFor(marketingRun(), g)!;
    expect(l.targets!.joint.status).toBe('licensed');
    expect(l.provisional).toBe(true);
    expect({
      ...(l.olumi_estimate_link_count !== undefined ? { olumi_estimate_link_count: l.olumi_estimate_link_count } : {}),
      ...(l.olumi_estimate_value_count !== undefined ? { olumi_estimate_value_count: l.olumi_estimate_value_count } : {}),
      ...(l.olumi_estimate_settings_by_option !== undefined ? { olumi_estimate_settings_by_option: l.olumi_estimate_settings_by_option } : {}),
    }).toEqual(counts);
  });

  it('CONTROL: an Olumi level on a TARGET itself is never quoted at all — the joint is withheld for it (unchanged)', () => {
    const l = licenceFor(marketingRun(), marketingWithInputs({ target: 'conversion_rate', kind: 'target_value' }))!;
    expect(l.targets!.joint).toMatchObject({ status: 'withheld', reason: 'olumi_base' });
    expect(l.pct_by_option).toEqual({});
  });

  it('CENSUS: every target node of the licensed event is one the census covers (the joint\'s conditions, by identity)', () => {
    const g = marketingWithInputs();
    const l = licenceFor(marketingRun(), g)!;
    const targetNodes = l.targets!.conditions.filter((x) => x.role === 'target').map((x) => x.node_id).sort();
    expect(targetNodes).toEqual(['conversion_rate', 'new_customers']);
    for (const target of targetNodes) {
      const kinds = cases.filter(([t]) => t === target).map(([, k]) => k);
      expect(kinds, target).toEqual(expect.arrayContaining(['link', 'value', 'setting']));
    }
  });
});

// ── Re-scope check r1 (DL, BLOCKING 2): the census is EVERY node upstream of EVERY node of the event — targets AND included
// limits, by ANY path, not only the option-lever paths into the goal ─────────────────────────────────────────────────────
const SPEND_LIMIT = { constraint_id: 'limit:annual_spend', node_id: 'annual_spend', operator: '<=', value: 50000, unit: 'GBP', value_frame: 'level' };
/** Marketing with an INCLUDED limit (annual spend at most £50,000, sent with the Run), every input the user's. */
const marketingWithLimit = (): Rec => {
  const g = marketingWithInputs();
  (g.goal_constraints as Rec[]).push({ ...SPEND_LIMIT });
  (g.nodes as Rec[]).find((n) => n.id === 'annual_spend')!.observed_state = USERS_LEVEL(40, 'GBP');
  return g;
};
/** An outside factor (no option sets it) two hops upstream of `into`, its own level Olumi's or the user's, its links the user's. */
const withOutsideInput = (g: Rec, into: string, olumi: { readonly value?: boolean; readonly link?: boolean }): Rec => {
  (g.nodes as Rec[]).push({ id: 'season', kind: 'factor', label: 'Season', observed_state: olumi.value ? OLUMIS_LEVEL(30, 'points') : USERS_LEVEL(30, 'points') },
    { id: 'demand', kind: 'factor', label: 'Market demand', observed_state: USERS_LEVEL(50, 'points') });
  (g.edges as Rec[]).push({ from: 'season', to: 'demand', ...USERS_LINK }, { from: 'demand', to: into, ...(olumi.link ? OLUMIS_LINK : USERS_LINK) });
  return g;
};
const countsOf = (l: Rec): Rec => ({
  ...(l.olumi_estimate_link_count !== undefined ? { olumi_estimate_link_count: l.olumi_estimate_link_count } : {}),
  ...(l.olumi_estimate_value_count !== undefined ? { olumi_estimate_value_count: l.olumi_estimate_value_count } : {}),
  ...(l.olumi_estimate_settings_by_option !== undefined ? { olumi_estimate_settings_by_option: l.olumi_estimate_settings_by_option } : {}),
});

describe('RE-SCOPE r1 — every node upstream of every node of the event: targets, included limits, any path', () => {
  it('CONTROL: the included limit joins the joint\'s words; every input the user\'s → not provisional', () => {
    const l = licenceFor(marketingRun(), marketingWithLimit())!;
    expect(l.targets!.joint).toMatchObject({ status: 'licensed',
      words: '‘New customers’ being at least 20 customers and ‘Conversion rate’ being above 15% over the first three months after launch, while ‘Annual spend’ is at most £50,000' });
    expect(l.pct_by_option).toEqual({ hire_manager: 35, ai_plus_ads: 48 });
    expect(l.provisional).toBeUndefined();
    expect(countsOf(l as unknown as Rec)).toEqual({});
  });

  it('RED on 5145af8 (re-scope r1 BLOCKING 2a): an INCLUDED limit whose starting value and option setting are Olumi\'s → the joint says so', () => {
    const g = marketingWithLimit();
    (g.nodes as Rec[]).find((n) => n.id === 'annual_spend')!.observed_state = OLUMIS_LEVEL(40, 'GBP');
    const ads = (g.nodes as Rec[]).find((n) => n.id === 'ai_plus_ads')!;
    ads.interventions = { ...(ads.interventions as Rec), annual_spend: { value: 0.3, raw_value: 30, source: 'cee_hypothesis', target_match: { node_id: 'annual_spend' } } };
    const l = licenceFor(marketingRun(), g)!;
    expect(l.pct_by_option).toEqual({ hire_manager: 35, ai_plus_ads: 48 });
    expect(l.provisional).toBe(true);
    expect(countsOf(l as unknown as Rec)).toEqual({ olumi_estimate_value_count: 1, olumi_estimate_settings_by_option: { ai_plus_ads: 1 } });
  });

  it('RED on 5145af8 (re-scope r1 BLOCKING 2b): an outside input feeding conversion, on no option\'s path → the joint says so', () => {
    const l = licenceFor(marketingRun(), withOutsideInput(marketingWithLimit(), 'conversion_rate', { value: true, link: true }))!;
    expect(l.pct_by_option).toEqual({ hire_manager: 35, ai_plus_ads: 48 });
    expect(l.provisional).toBe(true);
    expect(countsOf(l as unknown as Rec)).toEqual({ olumi_estimate_link_count: 1, olumi_estimate_value_count: 1 });
  });

  // CENSUS: each node of the licensed event — the goal, the other target, the included limit — with ONE Olumi input two hops
  // upstream of it on no option's path, alone: provisional, counted once. Its CONTROL (the same input the user's) is not.
  const eventNodes = ['new_customers', 'conversion_rate', 'annual_spend'];
  it.each(eventNodes.flatMap((n) => [[n, 'value'], [n, 'link']] as const))('CENSUS: an Olumi %s-upstream %s on no option path makes the joint provisional', (into, kind) => {
    const l = licenceFor(marketingRun(), withOutsideInput(marketingWithLimit(), into, { [kind]: true }))!;
    expect(l.targets!.joint.status).toBe('licensed');
    expect(l.provisional).toBe(true);
    expect(countsOf(l as unknown as Rec)).toEqual(kind === 'value' ? { olumi_estimate_value_count: 1 } : { olumi_estimate_link_count: 1 });
    const control = licenceFor(marketingRun(), withOutsideInput(marketingWithLimit(), into, {}))!;
    expect(control.provisional).toBeUndefined();
  });

  it('CENSUS: the census rows cover every node of the licensed event (the joint\'s conditions and the goal, by identity)', () => {
    const l = licenceFor(marketingRun(), marketingWithLimit())!;
    expect([...new Set([l.goal_node_id, ...l.targets!.conditions.map((x) => x.node_id)])].sort()).toEqual([...eventNodes].sort());
  });

  it('RED on 5145af8 (re-scope r1 BLOCKING 2b): a goal-alone chance counts an outside input upstream of the goal, on no option path', () => {
    const l = capacityLicence(withOutsideInput(capacityGraph(), 'devs', { value: true }))!;
    expect(l.provisional).toBe(true);
    expect(countsOf(l as unknown as Rec)).toEqual({ olumi_estimate_value_count: 1 });
  });

  it('CONTROL: with no target row sent, a limit stays outside the goal-alone chance (amendment 4) — its inputs are not the chance\'s', () => {
    const outside = capacityGraph();
    (outside.nodes as Rec[]).push({ id: 'budget', kind: 'factor', label: 'Budget', observed_state: OLUMIS_LEVEL(40, 'GBP') });
    outside.goal_constraints = [{ constraint_id: 'limit:budget', node_id: 'budget', operator: '<=', value: 50, unit: 'GBP', value_frame: 'level' }];
    expect(capacityLicence(outside)!.provisional).toBeUndefined();
  });
});

describe('RE-SCOPE r1 (DL item 3): a SENT figure that is not the stored one is never described as what was analysed', () => {
  it('sent ">25%", stored ">15%" → the joint and that target\'s own chance wait, with the reason', () => {
    const g = marketingGraph();
    const sent = (wireGoalConstraints(g.goal_constraints) as Rec[]).map((r) => (r.constraint_id === 'target:conversion_rate' ? { ...r, value: 25 } : r));
    const l = licenceFor(marketingRun(), g, sent)!;
    expect(l.targets!.joint).toMatchObject({ status: 'withheld', reason: 'figure_not_preserved',
      line: 'The chance of meeting both together isn’t shown, and nor is the chance of ‘Conversion rate’ being above 15% on its own: '
        + 'this analysis did not use every stated target as specified.' });
    expect(l.targets!.per_target.map((t) => t.constraint_id)).toEqual(['target:new_customers']);
    expect(l.pct_by_option).toEqual({});
  });

  it('CONTROL: the same figure sent and stored → licensed as before', () => {
    expect(licenceFor(marketingRun(), marketingGraph())!.targets!.joint.status).toBe('licensed');
  });
});

describe('RE-SCOPE 2 (R5-4; AIE open 2): the sent figure agrees with the stored one EXACTLY — no unit-dependent tolerance', () => {
  const sentWith = (over: Rec): Rec[] => (wireGoalConstraints(marketingGraph().goal_constraints) as Rec[])
    .map((r) => (r.constraint_id === 'target:conversion_rate' ? { ...r, ...over } : r));
  it.each([
    ['15 + 1e-12 (inside the old 1e-9 × max(1, |v|) tolerance)', { value: 15 + 1e-12 }],
    ['15.000000001 (inside the old tolerance at 15)', { value: 15.000000001 }],
    ['the same figure in another unit (sent "percent", stored "%")', { unit: 'percent' }],
    ['the same figure in another frame (sent "change", stored "level")', { value_frame: 'change' }],
  ])('RED on e58b8dbd: sent %s is not the stored figure → the joint and that target wait, said', (_name, over) => {
    const l = licenceFor(marketingRun(), marketingGraph(), sentWith(over))!;
    expect(l.targets!.joint).toMatchObject({ status: 'withheld', reason: 'figure_not_preserved' });
    expect(l.targets!.per_target.map((t) => t.constraint_id)).toEqual(['target:new_customers']);
  });
  it('CONTROL: exactly the stored figure, unit and frame → licensed (the same Run as before)', () => {
    const l = licenceFor(marketingRun(), marketingGraph(), sentWith({ value: 15, unit: '%', value_frame: 'level' }))!;
    expect(l.targets!.joint.status).toBe('licensed');
  });
});

// ── RE-SCOPE 2 (DL ruling on marginals, (B); DL AMEND item 3 — EVENT SCOPE): each figure keeps the dependency set of the event
// it MEASURES. The joint rests on the union; the goal's own figure on the goal's upstream set alone; each target's own chance
// ("On its own, …") on its own condition's — and says so in ONE note when it rests on any Olumi estimate, in the points' count
// words, naming the options only where their counts differ. No new field: the licence's existing `notes` carry it (the UI's
// `goalChanceDetailLines` and the Agent's `goalChanceNotesForAgent` say notes verbatim, after the "On its own" lines).
const wordsOf = (l: Loose, id: string): string => (l.targets.per_target as Rec[]).find((t) => t.constraint_id === id)!.words as string;
const marginalNotes = (l: Loose): string[] => ((l.notes as string[] | undefined) ?? []).filter((n) => n.startsWith('On its own, the chance of '));
const MARGINAL = (words: string, counts: string): string => `On its own, the chance of ${words} rests on Olumi's estimates: ${counts}.`;
/** The goal's own figure on the same graph: the goal alone, no condition sent (its own dependency set). */
const goalAlone = (g: Rec): Loose => { const h = structuredClone(g); h.goal_constraints = []; return licenceFor(marketingRun(), h)! as unknown as Loose; };

describe('RE-SCOPE 2 (marginals, (B)): each target\'s own chance says what it rests on; the joint the union; the goal its own', () => {
  it('RED on e58b8dbd: an Olumi input feeding ONLY the second target → the joint provisional + THAT marginal\'s note; the goal\'s own figure unchanged', () => {
    const g = marketingWithInputs({ target: 'conversion_rate', kind: 'value' });
    const l = licenceFor(marketingRun(), g)! as unknown as Loose;
    expect(l.targets.joint.status).toBe('licensed');
    expect(l.provisional).toBe(true);
    expect(l.olumi_estimate_value_count).toBe(1);
    expect(marginalNotes(l)).toEqual([MARGINAL(wordsOf(l, 'target:conversion_rate'), '1 starting value')]);
    // The goal's own figure rests on the goal's own upstream set: ‘Ad quality’ is not on it.
    const alone = goalAlone(g);
    expect(Object.keys(alone.pct_by_option)).toEqual(['hire_manager', 'ai_plus_ads']);
    expect(alone.provisional).toBeUndefined();
    expect(alone).not.toHaveProperty('olumi_estimate_value_count');
    // The same words reach the Agent's chat and the canonical view's `detail.notes`, verbatim.
    const env = withGoalChanceLicence(marketingRun(), g, 'new_customers', () => false, undefined, g,
      { storedConstraints: g.goal_constraints, sentConstraints: wireGoalConstraints(g.goal_constraints) });
    const result = { type: 'analysis_result', enrichment: env };
    expect(goalChanceNotesForAgent(result, g, true)).toContain(MARGINAL(wordsOf(l, 'target:conversion_rate'), '1 starting value'));
    expect(goalChanceFactsForAgent(result, g, true).goal_chance_notes).toEqual(l.notes);
  });

  it('RED on e58b8dbd: an Olumi input feeding ONLY the goal → the goal alone AND the joint provisional; the goal\'s marginal note, none on the second target\'s', () => {
    const g = marketingWithInputs({ target: 'new_customers', kind: 'value' });
    const l = licenceFor(marketingRun(), g)! as unknown as Loose;
    expect(l.provisional).toBe(true);
    expect(l.olumi_estimate_value_count).toBe(1);
    expect(marginalNotes(l)).toEqual([MARGINAL(wordsOf(l, 'target:new_customers'), '1 starting value')]);
    const alone = goalAlone(g);
    expect(alone.provisional).toBe(true);
    expect(alone.olumi_estimate_value_count).toBe(1);
  });

  it('RED on e58b8dbd: an option\'s own Olumi setting on the second target\'s path → that marginal names THAT option (counts differ)', () => {
    const l = licenceFor(marketingRun(), marketingWithInputs({ target: 'conversion_rate', kind: 'setting' }))! as unknown as Loose;
    expect(marginalNotes(l)).toEqual([
      `On its own, the chance of ${wordsOf(l, 'target:conversion_rate')} rests on Olumi's estimates for ‘AI planning plus advertising’: 1 option setting.`,
    ]);
  });

  it('a SHARED input feeding both targets is counted once on the joint, and said on each marginal it feeds', () => {
    const g = marketingWithInputs();
    (g.nodes as Rec[]).push({ id: 'demand', kind: 'factor', label: 'Market demand', observed_state: OLUMIS_LEVEL(50, 'points') });
    (g.edges as Rec[]).push({ from: 'demand', to: 'new_customers', ...USERS_LINK }, { from: 'demand', to: 'conversion_rate', ...USERS_LINK });
    const l = licenceFor(marketingRun(), g)! as unknown as Loose;
    expect(l.olumi_estimate_value_count).toBe(1);
    expect(marginalNotes(l)).toEqual([
      MARGINAL(wordsOf(l, 'target:new_customers'), '1 starting value'),
      MARGINAL(wordsOf(l, 'target:conversion_rate'), '1 starting value'),
    ]);
  });

  it('CONTRAST: an Olumi input upstream of NO condition (downstream of the goal) → nothing said anywhere', () => {
    const g = marketingWithInputs();
    (g.nodes as Rec[]).push({ id: 'morale', kind: 'factor', label: 'Team morale', observed_state: OLUMIS_LEVEL(50, 'points') });
    (g.edges as Rec[]).push({ from: 'new_customers', to: 'morale', ...USERS_LINK });
    const l = licenceFor(marketingRun(), g)! as unknown as Loose;
    expect(l.provisional).toBeUndefined();
    expect(marginalNotes(l)).toEqual([]);
    expect(unverifiedNotes(l)).toBe(0);
  });

  it('a withheld joint still says what each marginal it keeps rests on', () => {
    const l = licenceFor(marketingRun({ probability_of_joint_goal_precision: undefined }), marketingWithInputs({ target: 'conversion_rate', kind: 'value' }))! as unknown as Loose;
    expect(l.targets.joint.status).toBe('withheld');
    expect(marginalNotes(l)).toEqual([MARGINAL(wordsOf(l, 'target:conversion_rate'), '1 starting value')]);
  });

  it('UNVERIFIED on the second target\'s path only → the note once on the joint; no estimate count, no marginal estimate note', () => {
    const g = marketingWithInputs();
    const { source: _s, extractionType: _e, ...bare } = (g.nodes as Rec[]).find((n) => n.id === 'ad_quality')!.observed_state as Rec;
    (g.nodes as Rec[]).find((n) => n.id === 'ad_quality')!.observed_state = bare;
    const l = licenceFor(marketingRun(), g)! as unknown as Loose;
    expect(l.targets.joint.status).toBe('licensed');
    expect(unverifiedNotes(l)).toBe(1);
    expect(l.provisional).toBe(true); // LABEL, DON'T WITHHOLD (DL 12 Oct)
    expect(marginalNotes(l)).toEqual([]);
    expect(unverifiedNotes(goalAlone(g))).toBe(0);
  });
});

// ── RE-SCOPE 2 R5-5 (b) (DL ruling 2): THE CLASS GUARD AT THE LICENCE — never a chance for a stated target the Run did not send
// a threshold for: single (no finite `goal_threshold` on the graph the Run scored, a cap that could not be resolved included),
// marginal and joint (a stored target row the Run did not send). Independent of the open-question carrier: a graph stored before
// this fix (a refused reading left NO basis, and no threshold) is guarded too.
describe('RE-SCOPE 2 R5-5 (b): no chance is licensed for a stated target the Run sent no threshold for', () => {
  it('RED on e58b8dbd (single): the goal states 85% but the Run sent no threshold → no licence', () => {
    const g = capacityGraph({ goal: { goal_threshold: undefined } });
    expect((g.nodes as Rec[])[0]).toMatchObject({ goal_threshold_raw: 85 });
    expect(capacityLicence(g)).toBeNull();
  });
  it('RED on e58b8dbd (single): a cap that could not be resolved (no cap, no threshold) → no licence', () => {
    expect(capacityLicence(capacityGraph({ goal: { goal_threshold: undefined, goal_threshold_cap: undefined } }))).toBeNull();
  });
  it('CONTROL (single): the same goal with its threshold sent (0.85) is licensed', () => {
    expect(Object.keys(capacityLicence()!.pct_by_option)).toEqual(['lead', 'two']);
  });
  // A target that is the goal's OWN limit row (no figure on the node, `statedGoalTargetOf`) is sent as that row.
  const ownRowGoal = (): Rec => {
    const g = capacityGraph({ goal: { goal_threshold_raw: undefined, goal_threshold: undefined } });
    g.goal_constraints = [{ constraint_id: 'capacity:>=', node_id: 'capacity', operator: '>=', value: 85, unit: '%', value_frame: 'level' }];
    return g;
  };
  const ownRowLicence = (sent: unknown) => {
    const g = ownRowGoal();
    return goalChanceLicenceOf(capacityRun(), g, 'capacity', () => false, undefined, g, { storedConstraints: g.goal_constraints, sentConstraints: sent });
  };
  it('RED on e58b8dbd (single, own-row target): the goal\'s own target row not in the Run\'s request → no licence', () => {
    expect(ownRowLicence([])).toBeNull();
  });
  it('CONTROL (single, own-row target): the row sent → licensed; no request known → read as before', () => {
    expect(ownRowLicence(wireGoalConstraints(ownRowGoal().goal_constraints))).not.toBeNull();
    expect(ownRowLicence(undefined)).not.toBeNull();
  });
  const sentWithout = (id: string): Rec[] => (wireGoalConstraints(marketingGraph().goal_constraints) as Rec[]).filter((r) => r.constraint_id !== id);
  it('RED on e58b8dbd (joint + marginal): a stored second target the Run did not send → the joint waits; that target has no chance of its own', () => {
    const l = licenceFor(marketingRun(), marketingGraph(), sentWithout('target:conversion_rate'))!;
    expect(l.targets!.joint).toMatchObject({ status: 'withheld', reason: 'figure_not_preserved' });
    expect(l.targets!.per_target.map((t) => t.constraint_id)).toEqual(['target:new_customers']);
    expect(l.pct_by_option).toEqual({});
  });
  it('the goal\'s own stored target row not sent → the joint waits with the figure reason — never called "stated as a change"', () => {
    const l = licenceFor(marketingRun(), marketingGraph(), sentWithout('target:new_customers'))!;
    expect(l.targets!.joint).toMatchObject({ status: 'withheld', reason: 'figure_not_preserved' });
    expect(JSON.stringify(l.targets)).not.toMatch(/stated as a change/);
    expect(l.targets!.per_target.map((t) => t.constraint_id)).toEqual(['target:conversion_rate']);
  });
});

// ── R5 meaning at the producer (DL 12 Oct): the licence target says its frame wherever Olumi's VALIDATED reading holds it ──
describe('R5 at the producer — the licence target carries the validated reading\'s frame; an unvalidated one stays frameless', () => {
  const CAPACITY_LEVEL_BASIS = { quantity_frame: 'level', target_frame: 'level', target_raw: 85, reference: 'today', period_months: 3,
    period_kind: 'at_end', effect_unit: 'percentage points of capacity per added person, at month three', effects_at_period_end: true,
    source: 'olumi_reading' };

  it('RED: a level target with its validated LEVEL reading (Paul\'s capacity level brief shape) carries frame \'level\'', () => {
    const l = capacityLicence(capacityGraph({ goal: { goal_target_basis: CAPACITY_LEVEL_BASIS } }));
    expect(l).not.toBeNull();
    expect(l!.goal_node_id).toBe('capacity');
    expect(l!.target).toEqual(expect.objectContaining({ comparator: 'at_least', value: 85, unit: '%', frame: 'level' }));
  });

  it('RED: the same, on a validated level reading whose effects are not read at period end (today\'s sentence) — still \'level\'', () => {
    const l = capacityLicence(capacityGraph({ goal: { goal_target_basis: { ...CAPACITY_LEVEL_BASIS, effects_at_period_end: false } } }));
    expect(l).not.toBeNull();
    expect(l!.target.frame).toBe('level');
  });

  it('CONTROL: a change target keeps its own frame (hiring, change_abs)', () => {
    const g = hiringGraph();
    const l = goalChanceLicenceOf(hiringRun(), g, 'productivity', () => false, undefined, g, hiringConstraints(g));
    expect(l!.target.frame).toBe('change_abs');
  });

  it('NEGATIVE: no validated reading (no stored basis) → frameless, never defaulted to \'level\'', () => {
    const l = capacityLicence();
    expect(l).not.toBeNull();
    expect(l!.target).not.toHaveProperty('frame');
  });

  it('NEGATIVE: a stale reading (the target moved since it was read) is not validated → frameless', () => {
    const l = capacityLicence(capacityGraph({ goal: { goal_target_basis: { ...CAPACITY_LEVEL_BASIS, target_raw: 80 } } }));
    expect(l).not.toBeNull();
    expect(l!.target).not.toHaveProperty('frame');
  });
});


describe('MA2 complete condition inventory when the primary target cannot be licensed', () => {
  const conditionGraph = () => {
    const g = marketingGraph();
    (g.nodes as Rec[]).push({ id: 'founder_time', kind: 'factor', label: 'Founder time' });
    (g.goal_constraints as Rec[]).push(
      { constraint_id: 'limit:budget', node_id: 'annual_spend', operator: '<=', value: 100000, unit: 'GBP/year', value_frame: 'level' },
      { constraint_id: 'limit:time', node_id: 'founder_time', operator: '<=', value: 25, unit: '%', value_frame: 'level' });
    return g;
  };
  it('keeps all four conditions and their actual refusals, with the launch window, through stored licence and screen notes', () => {
    const g = conditionGraph();
    // Independent numeric refusal: no primary threshold reached the engine. Stored target/basis remain intact.
    const scored = structuredClone(g);
    delete (scored.nodes as Rec[])[0]!.goal_threshold;
    const run = marketingRun({ probability_of_goal: undefined, probability_of_joint_goal: undefined, constraint_probabilities: {} });
    run.inference_warnings = [{ code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE', severity: 'warning', node_ids: ['new_customers'],
      option_ids: ['hire_manager', 'ai_plus_ads'], message: 'Not shown. The customer forecast has no supported scoring frame.' }];
    const sent = wireGoalConstraints(g.goal_constraints);
    const envelope = withGoalChanceLicence(run, scored, 'new_customers', undefined, undefined, g, {
      storedConstraints: g.goal_constraints, sentConstraints: sent, perLimit: [
        { constraint_id: 'limit:budget', state: 'unscored', reason: 'parts_links_placeholder' },
        { constraint_id: 'limit:time', state: 'unscored', reason: 'limit_rests_on_olumi_guess' },
      ] });
    const licence = goalChanceLicenceForAgent(JSON.parse(JSON.stringify({ enrichment: envelope })))!;
    expect(licence).toBeDefined();
    expect(licence.targets!.conditions.map((c) => [c.constraint_id, c.clause])).toEqual([
      ['target:new_customers', '‘New customers’ being at least 20 customers over the first three months after launch'],
      ['target:conversion_rate', '‘Conversion rate’ being above 15% over the first three months after launch'],
      ['limit:budget', '‘Annual spend’ is at most £100,000 / year'],
      ['limit:time', '‘Founder time’ is at most 25%'],
    ]);
    expect(licence.notes).toEqual([
      '‘New customers’ being at least 20 customers over the first three months after launch: Not shown. The customer forecast has no supported scoring frame.',
      '‘Annual spend’ is at most £100,000 / year: The contributing quantities have links whose sizes are not yet specified. Define those contributions or supply a forecast for this quantity.',
      '‘Founder time’ is at most 25%: The calculation still rests on Olumi’s estimated quantities. Review their basis and uncertainty; the limit or target itself is not a forecast.',
      '‘Conversion rate’ being above 15% over the first three months after launch: This Run did not return a usable chance for ‘Hire a marketing manager’ and ‘AI planning plus advertising’.',
    ]);
    expect(licence.targets!.joint).toEqual({ status: 'withheld', reason: 'condition_unscored',
      line: 'The chance of meeting all of them together isn’t shown: one or more conditions could not be evaluated. The condition notes explain why.' });
    expect(JSON.stringify(licence)).not.toMatch(/Run the analysis again|Run again/);
    const screen = goalChanceNotesForAgent({ type: 'analysis_result', enrichment: envelope }, g, true);
    expect(JSON.stringify(screen)).toContain('The customer forecast has no supported scoring frame.');
    expect(JSON.stringify(screen)).toContain('The calculation still rests on Olumi’s estimated quantities.');
  });
  it('a stored target missing from the request remains in the inventory and notes without a marginal', () => {
    const g = marketingGraph();
    const sent = (wireGoalConstraints(g.goal_constraints) as Rec[]).filter((r) => r.node_id !== 'conversion_rate');
    const licence = licenceFor(marketingRun(), g, sent)!;
    expect(licence.targets!.conditions.map((c) => c.constraint_id)).toEqual(['target:new_customers', 'target:conversion_rate']);
    expect(licence.targets!.per_target.map((t) => t.constraint_id)).toEqual(['target:new_customers']);
    expect(licence.notes).toContain('‘Conversion rate’ being above 15% over the first three months after launch: This Run did not test the stated target. Its quantity and scoring frame need to be resolved.');
    expect(licence.targets!.joint.status).toBe('withheld');
  });
});
