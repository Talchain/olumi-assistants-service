/**
 * The brief's level that never reached a change goal (R3-B #72 5894575583; MG 5894657102). Shapes from the served
 * `7c23be87` draft and the saved corpus (18/44 change goals with no level: "costs" 11/12). 0 LLM.
 */
import { describe, expect, it } from 'vitest';

import { unplacedGoalLevel } from '../unplaced-goal-level.js';
import type { CandidateModel } from '../admit-model.js';

const CLOUD = 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £45k; we want to cut costs by 20% without more than 2 weeks of migration downtime risk.';

function draft(goal: Record<string, unknown> = {}, factors: Record<string, unknown>[] = []): CandidateModel {
  return {
    goal: {
      metric: 'costs', operator: '<=', target_stated: true, frame: 'change_rel', value: -20, unit: '£/month', horizon_months: null,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: null, scope: null, ...goal,
    },
    constraints: [],
    options: [],
    factors: [{ label: 'GCP workload share', role: 'controllable', baseline_known: false, baseline_value: null, unit: '%', provenance: 'inferred', plausible_max: 100 }, ...factors],
    risks: [], outcomes: [], links: [], unknowns: [],
  } as unknown as CandidateModel;
}

describe('unplacedGoalLevel', () => {
  it('RED (the saved "costs" shape): a change goal with no level, the brief\'s £45k on no node → that figure', () => {
    expect(unplacedGoalLevel(draft(), CLOUD, false)).toEqual({ value: 45000, written: '£45k' });
  });
  it('the served "Monthly cloud spend" shape, in GBP per month → the same figure', () => {
    expect(unplacedGoalLevel(draft({ metric: 'Monthly cloud spend', unit: 'GBP per month' }), CLOUD, false)).toEqual({ value: 45000, written: '£45k' });
  });
  it('the side-factor shape: a factor already holds the £45k → the figure, naming that factor', () => {
    const d = draft({}, [{ label: 'Current AWS monthly spend', role: 'observable', baseline_known: true, baseline_value: 45000, unit: '£/month', provenance: 'explicit' }]);
    expect(unplacedGoalLevel(d, CLOUD, false)).toEqual({ value: 45000, written: '£45k', carried_by: 'Current AWS monthly spend' });
  });
  it('a scaled goal unit ("£k/month"): the figure in the goal\'s own unit (45)', () => {
    expect(unplacedGoalLevel(draft({ unit: '£k/month' }), CLOUD, false)?.value).toBe(45);
  });
  it.each<[string, CandidateModel, string, boolean]>([
    ['a base was admitted', draft(), CLOUD, true],
    ['a LEVEL target, not a change', draft({ frame: 'level', value: 36000 }), CLOUD, false],
    ['the goal unit is not money ("%")', draft({ unit: '%' }), CLOUD, false],
    ['no amount in the goal\'s currency (a $ brief, a £ goal)', draft(), CLOUD.replace('£45k', '$45k'), false],
    ['TWO amounts in the goal\'s currency (a guess)', draft(), CLOUD.replace('Monthly spend is £45k', 'Monthly spend is £45k, of which £12k is storage'), false],
    ['the only £ amount is the change itself (change_abs "by £9k")', draft({ frame: 'change_abs', value: -9000 }), 'We spend a lot on cloud; we want to cut it by £9k a month.', false],
    ['no brief', draft(), '', false],
  ])('NULL: %s', (_why, d, brief, admitted) => {
    expect(unplacedGoalLevel(d, brief, admitted)).toBeNull();
  });
  it('CONTROL: change_abs with today\'s level beside the change → today\'s level, never the change', () => {
    expect(unplacedGoalLevel(draft({ frame: 'change_abs', value: -9000 }), 'Monthly spend is £45k; we want to cut it by £9k.', false)).toEqual({ value: 45000, written: '£45k' });
  });
});
