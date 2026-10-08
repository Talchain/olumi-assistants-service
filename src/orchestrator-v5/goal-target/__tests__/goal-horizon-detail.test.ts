import { describe, expect, it } from 'vitest';
import { goalHorizonWithholdDetail, goalHorizonSteadyWhyLine } from '../goal-horizon-detail.js';
import { goalChanceWithheldForAgent } from '../../agent-lane/goal-chance-withheld.js';
import { enforceAgentLaneLeaderClaimsAtWire, goalFigureCoHoldOf } from '../../agent-lane/withheld-leader-fail-closed.js';
import { WITHHELD_SEPARATION_UNAVAILABLE } from '../../compose/analysis-state-v1.js';

const goal = { id: 'mrr', kind: 'goal', label: 'MRR', goal_horizon_months: 9 };
const opening = "Your goal is for month 9, and this model only has today's numbers.";
const horizonWarning = { code: 'GOAL_FIGURES_HORIZON_NOT_TESTED', severity: 'warning', node_ids: ['mrr'],
  message: opening, say: opening, option_ids: ['raise', 'keep'] };

describe('Science §(o′)/(ad) typed horizon detail and existing narrator egress', () => {
  it('no typed accumulation operands means the sentence without invented slots', () => {
    expect(goalHorizonWithholdDetail({ nodes: [goal, { id: 'count', kind: 'factor', label: 'Subscribers' }] })).toBe(opening);
    expect(goalHorizonWithholdDetail({ nodes: [{ ...goal, goal_horizon_months: undefined }] })).toBeNull();
  });

  it('names only the missing positional accumulation operand', () => {
    const graph = { nodes: [
      { ...goal, nonlinear_identity: { operation: 'product', factor_ids: ['price', 'at_h'], stated_in_brief: true } },
      { id: 'at_h', kind: 'outcome', nonlinear_identity: { operation: 'accumulation', factor_ids: ['today', 'leave', 'sign_up'],
        horizon_months: 9, rate_scale: 0.01, stated_in_brief: true } },
      { id: 'today', kind: 'factor', label: 'Pro subscribers', observed_state: { raw_value: 300 } },
      { id: 'leave', kind: 'factor', label: 'Monthly leave share', observed_state: { raw_value: 2 } },
      { id: 'sign_up', kind: 'factor', label: 'Unrelated words do not assign this role' },
    ] };
    expect(goalHorizonWithholdDetail(graph)).toBe(`${opening} To work out month 9, Olumi needs how ‘Pro subscribers’ changes each month: how many sign up each month.`);
  });

  it('the steady Why sentence preserves the ruled words', () => {
    expect(goalHorizonSteadyWhyLine({ nodes: [goal] })).toBe('You said ‘MRR’ stays about where it is over 9 months unless you act, so this is its chance once each option is in effect.');
  });

  it('the Run-wide horizon detail overrides generic withhold wording and an identical-option reason', () => {
    const result = { type: 'analysis_result', enrichment: { inference_warnings: [
      { code: 'GOAL_FIGURES_OPTIONS_IDENTICAL', message: 'These options cannot be told apart.', option_ids: ['keep'] }, horizonWarning,
    ] } };
    expect(goalChanceWithheldForAgent(result, { nodes: [goal] })).toMatchObject({ withheld: true, say: opening });
    expect(goalChanceWithheldForAgent(result, { nodes: [goal] })?.option_ids).toBeUndefined();
  });

  it('the existing withheld leader owner removes the scripted narrator percentage and keeps the typed horizon detail', () => {
    const graph = { nodes: [goal, { id: 'raise', kind: 'option', label: 'Raise prices' }, { id: 'keep', kind: 'option', label: 'Keep pricing' }] };
    const result = { type: 'analysis_result', enrichment: { inference_warnings: [horizonWarning] } };
    expect(goalFigureCoHoldOf([result], graph)?.say).toBe(opening);
    const response = { assistant_text: 'Raise prices has about 46% chance of meeting your goal.', blocks: [result], suggested_actions: [],
      analysis_state: { run_state: { kind: 'complete_current' }, leader_claim: { permitted: false, withheld_reason: WITHHELD_SEPARATION_UNAVAILABLE } } };
    const out = enforceAgentLaneLeaderClaimsAtWire(response as never, { requestId: 'horizon-row', exitPath: 'agent_lane_v1',
      mayNameLeadingOption: false, separationEstablished: false, leaderClaimWithheldReason: WITHHELD_SEPARATION_UNAVAILABLE,
      graph, analysisReady: undefined, protectedGoalChanceSay: opening } as never).response.assistant_text;
    expect(out).toBe(opening);
    expect(out).not.toContain('%');
    expect(out).not.toContain('run the analysis');
  });
});
