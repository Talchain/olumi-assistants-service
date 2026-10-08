/**
 * GOAL-REACH build 3b: GOAL_THRESHOLD_NOT_CONVERTIBLE's carried reason → Science §(g)'s words.
 * Every PLoT body here is CAPTURED from PLoT's real /v2/run route (PLoT #444 carrier, ISL stubbed), never hand-written:
 * fixtures/plot-threshold-444/*.json, provenance in each file's `_capture`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isOlumiSideThreshold, thresholdReasonOf, THRESHOLD_REASONS } from '../../compose/claim-safety-cage.js';
import { goalNotCheckedLine, THRESHOLD_REST_STANDS } from '../break-even.js';
import { goalLevelAskOf } from '../current-level-answer.js';
import { readMoneyTotal } from '../same-unit.js';
import { sayFigure } from '../say-figure.js';

type Rec = Record<string, any>;
const DIR = new URL('./fixtures/plot-threshold-444/', import.meta.url);
const body = (name: string): Rec => JSON.parse(readFileSync(new URL(`${name}.json`, DIR), 'utf8')) as Rec;
const result = (name: string): Rec => ({ enrichment: body(name) });
const goal = (extra: Rec = {}): Rec => ({ id: 'mrr', kind: 'goal', label: 'MRR', goal_threshold_raw: 20000, goal_threshold_unit: '£/month', ...extra });
const graphOf = (g: Rec = goal(), more: Rec[] = []) => ({ nodes: [g, ...more], edges: [] });
const pctGoal = goal({ goal_threshold_raw: 0.15, goal_threshold_unit: '%', goal_threshold_frame: 'change_rel' });
const pinning = { id: 'opt_set', kind: 'option', label: 'Fix MRR', interventions: { mrr: 25000 } };
const S = (sentence: string) => sentence + THRESHOLD_REST_STANDS;

// Science §(g) table, AIQ final, verbatim with {goal}=MRR, {option}=Fix MRR, {X}=15.
const WORDS: Record<string, string> = {
  missing_goal_baseline: "Olumi can't show each option's chance of reaching your MRR target yet: the model doesn't have MRR's current level to measure from.",
  root_goal__root_value_source: "Olumi can't show the chance of reaching your MRR target: nothing in the model is linked to MRR, and it has no current level, so the options have nothing to move.",
  root_goal__root_intercept: "Olumi can't show the chance of reaching your MRR target: nothing in the model is linked to MRR, and the way Olumi built it doesn't let today's level be compared with the target. That's a limit of how Olumi built the model, not something you entered.",
  goal_pinned_by_intervention: "Olumi can't show the chance of reaching your MRR target: ‘Fix MRR’ sets MRR directly, so its result would be the setting itself, not something the model worked out.",
  goal_values_outside_normalised_domain: "Olumi can't show the chance of reaching your MRR target reliably: the target sits outside the range Olumi set up for MRR in this model. That's a limit of how Olumi built the model, not of your figures.",
  non_finite_conversion_input: "Olumi can't show the chance of reaching your MRR target in this Run because of a fault on Olumi's side.",
  goal_node_missing: "Olumi can't show the chance of reaching your MRR target in this Run because of a fault on Olumi's side.",
  epsilon_breaks_status_quo_reference: "Olumi can't show the chance of reaching your MRR target: random variation Olumi added to the model can't be separated from the options' own effect. That's a limit of how Olumi built the model, not something you entered.",
  auto_scaled_noise_breaks_status_quo_reference: "Olumi can't show the chance of reaching your MRR target: random variation Olumi added to the model can't be separated from the options' own effect. That's a limit of how Olumi built the model, not something you entered.",
  change_rel_raw_range_missing: "Olumi can't show the chance of a 15% change in MRR: the model doesn't carry the range it needs to measure a percentage change of MRR. That's a limit of how Olumi set up the goal.",
  change_rel_base_zero: "Olumi can't show the chance of a 15% change in MRR: its current level is zero, and a percentage of zero is still zero. A target stated as an amount would work.",
  unknown: "Olumi can't show each option's chance of reaching your MRR target in this Run.",
};
const graphFor = (name: string) => name.startsWith('change_rel') ? graphOf(pctGoal)
  : name === 'goal_pinned_by_intervention' ? graphOf(goal(), [pinning]) : graphOf();

describe('GOAL-REACH 3b — the carried reason (captured PLoT bodies)', () => {
  it('the captured population is complete: one body per ISL reason, both root forms, absent and novel reasons', () => {
    const names = readdirSync(DIR).map(f => f.replace(/\.json$/, '')).sort();
    expect(names).toEqual([...THRESHOLD_REASONS.filter(r => r !== 'unknown'), 'root_goal__root_value_source', 'root_goal__root_intercept',
      'absent_reason', 'novel_reason'].sort());
  });

  it.each(THRESHOLD_REASONS.filter(r => r !== 'unknown'))('%s is read through as itself', reason => {
    expect(thresholdReasonOf(body(reason))?.reason).toBe(reason);
  });

  it('root forms come through; the bare root_goal has an unknown form; non-root reasons carry no form', () => {
    expect(thresholdReasonOf(body('root_goal__root_value_source'))).toEqual({ reason: 'root_goal', root_case: 'root_value_source' });
    expect(thresholdReasonOf(body('root_goal__root_intercept'))).toEqual({ reason: 'root_goal', root_case: 'root_intercept' });
    expect(thresholdReasonOf(body('root_goal'))).toEqual({ reason: 'root_goal', root_case: 'unknown' });
    expect(thresholdReasonOf(body('missing_goal_baseline'))?.root_case).toBeNull();
  });

  it("PLoT's fallback and a novel ISL value both read 'unknown'; a pre-#444 warning (no detail) and no code read null", () => {
    expect(thresholdReasonOf(body('absent_reason'))?.reason).toBe('unknown');
    expect(thresholdReasonOf(body('novel_reason'))?.reason).toBe('unknown');
    const pre = body('missing_goal_baseline');
    for (const w of pre.inference_warnings) if (w.code === 'GOAL_THRESHOLD_NOT_CONVERTIBLE') delete w.detail;
    expect(thresholdReasonOf(pre)).toBeNull();
    expect(thresholdReasonOf({ inference_warnings: [] })).toBeNull();
    expect(thresholdReasonOf(undefined)).toBeNull();
  });
});

describe('GOAL-REACH 3b — Science §(g) words, one sentence per reason', () => {
  it.each(Object.keys(WORDS).filter(k => k !== 'unknown'))('%s → its exact sentence', name => {
    expect(goalNotCheckedLine(graphFor(name), result(name))).toBe(S(WORDS[name]!));
  });

  it("'unknown' (absent or novel) → the unknown sentence; a bare root_goal (form unknown) → the unknown sentence", () => {
    for (const name of ['absent_reason', 'novel_reason', 'root_goal']) expect(goalNotCheckedLine(graphOf(), result(name))).toBe(S(WORDS.unknown!));
  });

  it('a slot the model cannot fill falls back to the unknown sentence, never a guess', () => {
    // Pinned, but no option (or two options) sets the goal.
    expect(goalNotCheckedLine(graphOf(), result('goal_pinned_by_intervention'))).toBe(S(WORDS.unknown!));
    expect(goalNotCheckedLine(graphOf(goal(), [pinning, { ...pinning, id: 'opt_2', label: 'Also fix' }]), result('goal_pinned_by_intervention'))).toBe(S(WORDS.unknown!));
    // A %-change reason on a goal not framed as a % change.
    expect(goalNotCheckedLine(graphOf(), result('change_rel_base_zero'))).toBe(S(WORDS.unknown!));
  });

  it('REGRESSION: no reason but missing_goal_baseline says the old "no current … figure" cause or "where the goal stands today"', () => {
    for (const name of Object.keys(WORDS).filter(k => k !== 'missing_goal_baseline' && k !== 'unknown')) {
      const line = goalNotCheckedLine(graphFor(name), result(name))!;
      // The old sentences' own phrases (Science's root sentence legitimately says "it has no current level").
      expect(line).not.toMatch(/no current \S+ figure|not checked yet|stands today|was not checked/);
    }
  });

  // The only word change from the staging control is the plain-unit reader's money rendering (DL workstream A).
  it('CONTROL: a pre-#444 payload (code, no reason) keeps the cause and says its target in plain units', () => {
    const moneyUnit = readMoneyTotal(goal().goal_threshold_unit, '');
    expect(moneyUnit, 'the unchecked-target producer reads a plain money total').toEqual({ code: 'GBP', period: 'month' });
    expect(sayFigure(20000, `${moneyUnit!.code} a ${moneyUnit!.period}`)).toBe('£20,000 a month');
    const pre = result('missing_goal_baseline');
    for (const w of pre.enrichment.inference_warnings) if (w.code === 'GOAL_THRESHOLD_NOT_CONVERTIBLE') delete w.detail;
    expect(goalNotCheckedLine(graphOf(), pre)).toBe('Your MRR target of £20,000 a month is not checked yet: the model has no current MRR figure to measure it against.');
  });

  it('Science carve-out: the Olumi-side set is exactly the no-user-action reasons', () => {
    const side = (reason: string, root_case: any = null) => isOlumiSideThreshold({ reason: reason as never, root_case });
    expect(THRESHOLD_REASONS.filter(r => side(r, r === 'root_goal' ? 'root_value_source' : null)).sort()).toEqual([
      'auto_scaled_noise_breaks_status_quo_reference', 'change_rel_raw_range_missing', 'epsilon_breaks_status_quo_reference',
      'goal_node_missing', 'goal_values_outside_normalised_domain', 'non_finite_conversion_input', 'unknown'].sort());
    expect(side('root_goal', 'root_intercept')).toBe(true);
    expect(side('root_goal', 'unknown')).toBe(true);
  });

  it('Codex r1 P2-6: a goal whose target is not a stated amount stays null with a carried reason, as staging does', () => {
    const normalisedOnly = { id: 'mrr', kind: 'goal', label: 'MRR', goal_threshold: 0.8 };
    expect(goalNotCheckedLine(graphOf(normalisedOnly), result('missing_goal_baseline'))).toBeNull();
  });
});

describe('GOAL-REACH 3b — the current-level ask is only offered when its answer can force the card', () => {
  it('RED: a stated target amount + missing_goal_baseline → the ask, in the goal\'s unit', () => {
    expect(goalLevelAskOf(graphOf(), result('missing_goal_baseline'))?.question).toBe(
      'To show each option\'s chance of reaching your MRR target, I first need today\u2019s level of \u2018MRR\u2019. What is it, in £/month?');
  });
  it('Codex r1 P1-4: no anchored target (only a normalised one) → no ask (the answer path could not read its unit)', () => {
    expect(goalLevelAskOf(graphOf({ id: 'mrr', kind: 'goal', label: 'MRR', goal_threshold: 0.8, goal_threshold_unit: '£/month' }), result('missing_goal_baseline'))).toBeNull();
  });
  it('Codex r1 P2-5: a question over the pending ask\'s 400 characters → no ask; CONTROL: a long-but-fitting label still asks', () => {
    expect(goalLevelAskOf(graphOf(goal({ label: 'M'.repeat(166) })), result('missing_goal_baseline'))).toBeNull();
    expect(goalLevelAskOf(graphOf(goal({ label: 'M'.repeat(120) })), result('missing_goal_baseline'))?.question.length).toBeLessThanOrEqual(400);
  });
  it('Codex r2 P2: an empty or over-long unit → no ask (the pending ask would reject it)', () => {
    expect(goalLevelAskOf(graphOf(goal({ goal_threshold_unit: ' ' })), result('missing_goal_baseline'))).toBeNull();
    expect(goalLevelAskOf(graphOf(goal({ goal_threshold_unit: 'x'.repeat(65) })), result('missing_goal_baseline'))).toBeNull();
  });
  it('an Olumi-side reason, or a goal that already has a stated level, asks nothing', () => {
    expect(goalLevelAskOf(graphOf(), result('goal_values_outside_normalised_domain'))).toBeNull();
    expect(goalLevelAskOf(graphOf(goal({ observed_state: { raw_value: 14700, unit: '£/month' } })), result('missing_goal_baseline'))).toBeNull();
  });
});
