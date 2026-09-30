import { describe, expect, it } from 'vitest';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_PRODUCT_NOT_READ } from '../../../orchestrator/context/option-result-source.js';
import { withDisclosures } from '../disclosure.js';
import { goalChanceLineOwed, goalChanceSayFromThisTurn, goalChanceWithheldForAgent } from '../goal-chance-withheld.js';
import { enforceAgentLaneLeaderClaimsAtWire } from '../withheld-leader-fail-closed.js';

const warning = {
  code: GOAL_FIGURES_PRODUCT_NOT_READ,
  message: 'Not shown. Olumi has not read ‘MRR’ as ‘Pro plan price’ × ‘Pro paying subscribers’ (£49 × 1,500 = £73,500, close to your £75,000), so this run can’t say how likely any option is to reach the goal, what it would reach, or which option does best.',
  node_ids: ['mrr', 'price', 'subscribers'],
  option_ids: ['raise', 'keep'],
};
const block = { type: 'analysis_result', enrichment: { inference_warnings: [warning] } };
const say = goalChanceWithheldForAgent(block)!.say;
const runWithheld = { ran: true, goal_chance: goalChanceWithheldForAgent(block) };
const analysisReady = { analysis_admission: { permitted_analysis_mode: 'comparative_leader', reasons: [] } };
const graph = { nodes: [
  { id: 'raise', kind: 'option', label: 'Raise to £59' },
  { id: 'keep', kind: 'option', label: 'Keep £49' },
  { id: 'mrr', kind: 'goal', label: 'MRR' },
], edges: [] };
type WireOpts = Parameters<typeof enforceAgentLaneLeaderClaimsAtWire>[1];
const opts = { requestId: 'goal-say', exitPath: 'agent_lane_v1', mayNameLeadingOption: false,
  leaderClaimWithheldReason: 'separation_unavailable', graph, analysisReady, protectedGoalChanceSay: say } as unknown as WireOpts;
const response = (assistant_text: string, runKind = 'complete_current'): OlumiResponse => ({
  assistant_text, blocks: [block], suggested_actions: [],
  analysis_state: { run_state: { kind: runKind }, leader_claim: { permitted: false, withheld_reason: 'separation_unavailable' } },
} as unknown as OlumiResponse);

describe('the run’s own withheld goal explanation at the Agent wire', () => {
  it('keeps the exact standalone say including its £49 × 1,500 detail, while dropping a model-written leader', () => {
    const modelText = 'The model is provisional. Raise to £59 does best.';
    const owed = goalChanceLineOwed([runWithheld], modelText);
    const out = enforceAgentLaneLeaderClaimsAtWire(
      response(withDisclosures(modelText, owed === null ? [] : [owed])),
      { ...opts, protectedGoalChanceSay: goalChanceSayFromThisTurn([runWithheld]) },
    );
    expect(out.response.assistant_text).toContain(say);
    expect(out.response.assistant_text.split(say)).toHaveLength(2);
    expect(out.response.assistant_text).not.toContain('Raise to £59 does best');
    const again = enforceAgentLaneLeaderClaimsAtWire(out.response, opts);
    expect(again.response.assistant_text).toBe(out.response.assistant_text);
  });

  it('does not protect model ranking text merely because a Run warning exists', () => {
    const out = enforceAgentLaneLeaderClaimsAtWire(response('Raise to £59 does best. The run has missing figures.'), opts);
    expect(out.response.assistant_text).not.toContain('Raise to £59 does best');
    expect(out.response.assistant_text).not.toContain(say);
  });

  it.each([
    ['inline', `The run finished. ${say}`],
    ['restyled', say.replace('‘MRR’', '**MRR**')],
  ])('restores the typed say once after an %s Agent copy was filtered', (_, modelText) => {
    const out = enforceAgentLaneLeaderClaimsAtWire(response(`${modelText}\n\nRaise to £59 does best.`), opts);
    expect(out.response.assistant_text.split(say)).toHaveLength(2);
    expect(out.response.assistant_text).not.toContain('Raise to £59 does best');
    const again = enforceAgentLaneLeaderClaimsAtWire(out.response, opts);
    expect(again.response.assistant_text).toBe(out.response.assistant_text);
  });

  it('does not protect an old Run’s say after the read says the result is stale', () => {
    const out = enforceAgentLaneLeaderClaimsAtWire(response(`Raise to £59 does best.\n\n${say}`, 'complete_stale'), opts);
    expect(out.response.assistant_text).not.toContain(say);
  });

  it('does not protect a superseded Run’s sentence when the final current readback has a different cause', () => {
    const changed = { ...response(`${say}\n\nRaise to £59 does best.`),
      blocks: [{ type: 'analysis_result', enrichment: { inference_warnings: [
        { ...warning, message: 'Not shown. A different goal link was not evaluated.' },
      ] } }] } as unknown as OlumiResponse;
    const out = enforceAgentLaneLeaderClaimsAtWire(changed, opts);
    expect(out.response.assistant_text).not.toContain(say);
  });

  it('uses the typed sentence as context to remove a following bare win-share split', () => {
    const placeholder = { type: 'analysis_result', enrichment: { inference_warnings: [{
      code: GOAL_FIGURES_PLACEHOLDER_PATH,
      message: 'Not shown. This run can’t say how likely Raise to £59 and Keep £49 are to reach the goal, or which option does best. Give a figure for that link and Olumi will use it.',
      option_ids: ['raise', 'keep'], node_ids: ['mrr'],
    }] } };
    const typed = goalChanceWithheldForAgent(placeholder)!.say;
    const out = enforceAgentLaneLeaderClaimsAtWire(
      { ...response(`${typed}\n\nThe results were 71% and 29%.`), blocks: [placeholder] } as unknown as OlumiResponse,
      { ...opts, protectedGoalChanceSay: typed },
    );
    expect(out.response.assistant_text).toContain(typed);
    expect(out.response.assistant_text.split(typed)).toHaveLength(2);
    expect(out.response.assistant_text).not.toContain('71%');
    expect(out.response.assistant_text).not.toContain('29%');
    const inline = enforceAgentLaneLeaderClaimsAtWire(
      { ...response(`The run finished. ${typed}`), blocks: [placeholder] } as unknown as OlumiResponse,
      { ...opts, protectedGoalChanceSay: typed },
    );
    expect(inline.response.assistant_text.split(typed)).toHaveLength(2);
    expect(inline.response.assistant_text.match(/Give a figure for that link/g)).toHaveLength(1);
  });

  it('does not replay a prior Run’s sentence on a cold follow-up or after a later Run without that warning', () => {
    expect(goalChanceSayFromThisTurn([])).toBeNull();
    expect(goalChanceSayFromThisTurn([runWithheld, { ran: true }])).toBeNull();
    const out = enforceAgentLaneLeaderClaimsAtWire(response('Raise to £59 does best.'),
      { ...opts, protectedGoalChanceSay: goalChanceSayFromThisTurn([]) });
    expect(out.response.assistant_text).not.toContain(say);
  });

  it('grants the typed-line exemption once when the reply repeats it', () => {
    const out = enforceAgentLaneLeaderClaimsAtWire(response(`${say}\n\n${say}`), opts);
    expect(out.response.assistant_text.split(say)).toHaveLength(2);
  });
});
