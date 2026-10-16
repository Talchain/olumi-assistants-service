/**
 * ⭐ ITEM 3 numerical use (AIE 16 Oct range contract; DL-3 lease of goal-chance-range.ts). Served G3 #5 (1a1a7907, structural
 * read of the Run turns): GOAL_FIGURES_PLACEHOLDER_PATH withheld every option's goal figures, but GOAL_CHANCE_RANGE showed the
 * food-waste option as "0%–78%", whose 78% is ISL's chance with the link PRESENT at Olumi's placeholder size, on a link the
 * user had stated a range for. A range resting on that placeholder is not shown; everything else is as before. SYNTHETIC.
 */
import { describe, expect, it } from 'vitest';
import { GOAL_CHANCE_RANGE, goalChanceRangeOf, withGoalChanceRange, type GoalChanceRangeInputs } from '../goal-chance-range.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH } from '../../../orchestrator/context/option-result-source.js';
import { userStatementRecord, withUserStatement, CONSTRUCTION_ATTEST } from '../../statement-door/statements.js';

type Json = Record<string, any>;
const A = 'food_waste', B = 'keep', FROM = 'coverage', TO = 'recycling';
const QUOTE = 'Our waste officer thinks weekly food collection could lift the rate by somewhere between 4 and 7 percentage points.';
const existenceRow = (patch: Json = {}): Json => ({
  kind: 'link_existence', quantity_id: `${FROM}->${TO}`, from: FROM, to: TO, status: 'resolved',
  spread: 0.4, p_goal_if_absent: 0.004, p_goal_if_present: 0.78, n_absent: 2000, n_present: 8000, ...patch,
});
const graph = (): Json => ({
  nodes: [
    { id: A, kind: 'option', interventions: { [FROM]: 1 } },
    { id: B, kind: 'option', interventions: { [FROM]: 0 } },
    { id: FROM, kind: 'factor', label: 'Food waste collection coverage', observed_state: { value: 0, baseline: 0, raw_value: 0, unit: '0/1', cap: 1 } },
    { id: TO, kind: 'goal', label: 'Household recycling rate', goal_direction: '>=', goal_threshold: 0.5,
      goal_threshold_raw: 50, goal_threshold_unit: '%', goal_threshold_frame: 'level',
      observed_state: { value: 0.42, baseline: 0.42, raw_value: 42, unit: '%', cap: 100 } },
  ],
  edges: [{ from: A, to: FROM, strength: { mean: 1, std: 0.01 } }, { from: B, to: FROM, strength: { mean: 1, std: 0.01 } },
    { from: FROM, to: TO, strength: { mean: 0.1, std: 0.05 }, provenance: { source: 'brief_extraction', magnitude: 'olumi_placeholder' }, defaulted: true }],
});
/** The user's range for the link, recorded as construction records it (the FROM node's statement record). */
const withStatedRange = (g: Json, form: 'range' | 'point' = 'range', to = TO): Json => {
  const subject = { kind: 'link' as const, id: FROM, to_id: to, field: 'effect' as const };
  // The shape construction verifies (`verifyStatements`): the user's sentence, Olumi's reading of it.
  const base = { speaker: 'user', reading: 'olumi', quote: QUOTE, source: QUOTE, subject: { quantity: `link|${FROM}|${to}||effect` }, unit: 'percentage points' };
  const st = form === 'range' ? { ...base, form, low: 4, high: 7 } : { ...base, form, low: 5, high: 5 };
  return withUserStatement(g as never, userStatementRecord(subject, [st as never], '2026-10-16T00:00:00.000Z', CONSTRUCTION_ATTEST), subject) as Json;
};
const inputs = (rows: Json[] = [existenceRow()]): GoalChanceRangeInputs => ({
  driversByOption: new Map([[A, { drivers: rows }]]),
  goalPaths: [{ option_id: A, links: [{ from: FROM, to: TO }] }], plotWithheld: false, goalId: TO,
});
const envelope = (): Json => ({ option_comparison: [{ option_id: A }, { option_id: B, probability_of_goal: 0.4 }],
  inference_warnings: [{ code: GOAL_FIGURES_PLACEHOLDER_PATH, severity: 'warning', message: 'Withheld.', option_ids: [A] }] });
const rangeRecord = (e: Json): Json | undefined => e.inference_warnings.find((w: Json) => w.code === GOAL_CHANCE_RANGE);

describe('a chance range never rests on Olumi\'s placeholder for a link the user stated a range for', () => {
  it('⭐ RED→GREEN (G3 #5 shape): no "0%–78%" range; the option\'s figures stay withheld with their reason', () => {
    const g = withStatedRange(graph());
    expect(goalChanceRangeOf(envelope(), g, A, inputs())).toBeNull();
    const out = withGoalChanceRange(envelope(), g, inputs());
    expect(rangeRecord(out)).toBeUndefined();
    expect(out.inference_warnings).toEqual([expect.objectContaining({ code: GOAL_FIGURES_PLACEHOLDER_PATH, option_ids: [A] })]);
    expect(out.option_comparison).toEqual(envelope().option_comparison);
  });
  it('CONTRAST: the same placeholder link with NO stated range keeps today\'s range (Ruling 1 unchanged)', () => {
    expect(goalChanceRangeOf(envelope(), graph(), A, inputs())).toMatchObject({ kind: 'link_existence', low_pct: 0, from: FROM, to: TO });
    expect(rangeRecord(withGoalChanceRange(envelope(), graph(), inputs()))).toMatchObject({ code: GOAL_CHANCE_RANGE, option_ids: [A] });
  });
  it('CONTRAST: a statement on the link that is not a range (a point) does not bar the range', () => {
    expect(goalChanceRangeOf(envelope(), withStatedRange(graph(), 'point'), A, inputs())).not.toBeNull();
  });
  it('CONTRAST: a range recorded for ANOTHER link from the same node does not bar this link\'s range (bound by identity)', () => {
    const g = graph();
    g.nodes.push({ id: 'other', kind: 'factor', label: 'Other' });
    g.edges.push({ from: FROM, to: 'other', strength: { mean: 0.2, std: 0.1 } });
    expect(goalChanceRangeOf(envelope(), withStatedRange(g, 'range', 'other'), A, inputs())).not.toBeNull();
  });
  it('CONTRAST: a strength row on the stated-range link is barred too (its "if high" end is the placeholder\'s as well)', () => {
    const strength = existenceRow({ kind: 'link_strength', p_goal_if_low: 0.1, p_goal_if_high: 0.6, n_low: 5000, n_high: 5000 });
    expect(goalChanceRangeOf(envelope(), graph(), A, inputs([strength]))).not.toBeNull();
    expect(goalChanceRangeOf(envelope(), withStatedRange(graph()), A, inputs([strength]))).toBeNull();
  });
});
