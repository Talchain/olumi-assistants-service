/**
 * RT-10 B′ (Codex r1 #2600): the direction-assumed sentence promises the "at most" goal-target correction ONLY when the
 * caller says that door opens (`goal_direction_correctable`); absent or false, the assumption is stated alone. Both
 * shapes are admitted at egress, and neither moves the headline's case, leader or shed.
 */
import { describe, expect, it } from 'vitest';
import {
  buildAnalysisResultHeadline, describeAnalysisHeadline, isAllowedRunAnalysisAssistantText,
  type AnalysisResultHeadlineInput,
} from '../analysis-result-headline.js';
import { goalDirectionCorrectableByTarget } from '../../tools/handlers/run-analysis.js';

const ASSUMPTION = 'In this model I’ve assumed a higher value is better for your goal';
const CORRECTION = ' If lower is better, set the goal’s target to ‘at most’ and re-run.';
const DIRECTION = { code: 'GOAL_DIRECTION_UNATTESTED', severity: 'info', message: 'No objective sense was stated for the goal node.' };
const THRESHOLD = { code: 'GOAL_THRESHOLD_NOT_CONVERTIBLE', severity: 'info', message: 'The goal threshold could not be converted.' };
const enrichment = (warnings: readonly Record<string, unknown>[], withAttainment: boolean) => ({
  option_comparison: [
    { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62, ...(withAttainment ? { probability_of_goal: 0.4 } : {}) },
    { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.38, ...(withAttainment ? { probability_of_goal: 0.3 } : {}) },
  ],
  inference_warnings: warnings,
});
const input = (e: Record<string, unknown>, correctable?: boolean): AnalysisResultHeadlineInput => ({
  enrichment: e, leading_option_id: 'opt_a', status_kind: 'ok',
  ...(correctable === undefined ? {} : { goal_direction_correctable: correctable }),
});

describe.each([
  ['DIRECTION alone, attainment present', enrichment([DIRECTION], true), `${ASSUMPTION}.`],
  ['both codes (the combined sentence)', enrichment([DIRECTION, THRESHOLD], false), `${ASSUMPTION}, and the model could not test whether any option reaches your goal.`],
])('%s', (_name, e, plainTail) => {
  it('correctable → the assumption AND the correction', () => {
    const text = buildAnalysisResultHeadline(input(e, true))!;
    expect(text.endsWith(`${plainTail}${CORRECTION}`)).toBe(true);
    expect(isAllowedRunAnalysisAssistantText(text)).toBe(true);
  });
  it.each([false, undefined])('not correctable (%s) → the assumption ALONE, still admitted', (flag) => {
    const text = buildAnalysisResultHeadline(input(e, flag))!;
    expect(text.endsWith(plainTail)).toBe(true);
    expect(text).not.toContain('at most');
    expect(isAllowedRunAnalysisAssistantText(text)).toBe(true);
  });
  it('the flag never moves the case, leader or shed', () => {
    const { text: _a, ...withFix } = describeAnalysisHeadline(input(e, true)) as Record<string, unknown>;
    const { text: _b, ...without } = describeAnalysisHeadline(input(e, false)) as Record<string, unknown>;
    expect(withFix).toEqual(without);
  });
});

describe('goalDirectionCorrectableByTarget — the door\'s own refusal (goal_target_edit: goal_is_a_change)', () => {
  const g = (fields: Record<string, unknown>, kind = 'goal') => ({ nodes: [{ id: 'goal', kind, label: 'Goal', ...fields }], edges: [] });
  it.each([
    ['no target figure', {}, true],
    ['a LEVEL target', { goal_threshold_frame: 'level', goal_threshold_raw: 2 }, true],
    ['change_rel', { goal_threshold_frame: 'change_rel', goal_threshold_raw: -0.2 }, false],
    ['change_abs', { goal_threshold_frame: 'change_abs', goal_threshold_raw: -5 }, false],
    ['delta', { goal_threshold_frame: 'delta', goal_threshold_raw: -5 }, false],
    ['a level target whose user stamp agrees', { goal_threshold_frame: 'level', goal_threshold_raw: 2, threshold_source: 'user', success_threshold: 2 }, true],
    ['a level target SHOWN at another figure (user stamp 3, held 2)', { goal_threshold_frame: 'level', goal_threshold_raw: 2, threshold_source: 'user', success_threshold: 3 }, false],
    ['a stamp with no held figure (the card holds whatever is set)', { threshold_source: 'user', success_threshold: 3 }, true],
  ])('%s → %s', (_name, fields, expected) => {
    expect(goalDirectionCorrectableByTarget(g(fields), 'goal')).toBe(expected);
  });
  it('not a goal, no such node, or an AMBIGUOUS id (the door refuses goal_ambiguous) → false', () => {
    expect(goalDirectionCorrectableByTarget(g({}, 'factor'), 'goal')).toBe(false);
    expect(goalDirectionCorrectableByTarget(g({}), 'missing')).toBe(false);
    const twice = g({});
    twice.nodes.push({ id: 'goal', kind: 'goal', label: 'Goal again' });
    expect(goalDirectionCorrectableByTarget(twice, 'goal')).toBe(false);
  });
});
