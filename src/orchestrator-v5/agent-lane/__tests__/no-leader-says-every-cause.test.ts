/**
 * R13 (DL #72 5871699334, Paul's production test 13:33Z): THE NO-LEADER SENTENCE NAMES EVERY CAUSE THAT HOLDS, and never
 * promises a fix another cause blocks.
 *
 * Served (export 64c5eccc, scenario 657e63ef): every estimate was still Olumi's, so the admission refused the
 * comparison, and the run's own separation was a near tie (gap 0.041, `leader_claim.separation: 'near_tie'`). The
 * reply said only the admission's cause: "set one of them yourself, then run the analysis again". That was futile,
 * because the near tie also held, and the next turn (estimates confirmed) was withheld again for exactly that.
 *
 * The rule pinned here:
 *   · when the run found a near tie AND another cause holds, the sentence says both, the near tie first (it is the
 *     engine's finding about this run), then the other cause;
 *   · its one next action is the near tie's, which no co-holding cause blocks, and it promises no rerun;
 *   · a single cause is said exactly as before (contrast rows).
 */
import { describe, it, expect } from 'vitest';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import {
  AGENT_NO_LEADER_SENTENCES,
  agentNoLeaderReason,
  agentNoLeaderSentence,
  enforceAgentLaneLeaderClaimsAtWire,
} from '../withheld-leader-fail-closed.js';
import { leaderStandingOf } from '../provisional-view.js';

const ALL_OLUMIS = {
  analysis_admission: {
    structurally_analysable: true,
    permitted_analysis_mode: 'quantified_provisional',
    reasons: [{ field: 'permitted_analysis_mode', code: 'CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED' }],
  },
};
const NEAR_TIE_WHY = 'the options came out too close together on this run to tell apart';
const NEAR_TIE_ACTION = 'tell me what matters most to you between them';
const ADMISSION_WHY = 'every estimate this comparison rests on is still Olumi’s, not yours';
const RERUN_PROMISE = /then run the analysis again|run the analysis again to|ask me to run the analysis/;

describe('R13 — every cause that holds, the near tie first, no futile rerun', () => {
  it('RED (Paul 13:33, served shape): an all-Olumi admission AND a near tie → both causes, near tie first, its action only', () => {
    const s = agentNoLeaderSentence('constraint_verdict_withheld', ALL_OLUMIS, [], undefined, undefined, 'near_tie');
    expect(s).toContain(NEAR_TIE_WHY);
    expect(s).toContain(ADMISSION_WHY);
    expect(s.indexOf(NEAR_TIE_WHY)).toBeLessThan(s.indexOf(ADMISSION_WHY));
    expect(s).toMatch(new RegExp(`; ${NEAR_TIE_ACTION}\\.$`));
    expect(s).not.toMatch(RERUN_PROMISE);
  });

  it('RED: the claim\'s own near-tie reason is not hidden by the admission either', () => {
    const s = agentNoLeaderSentence('options_do_not_separate', ALL_OLUMIS, [], undefined, undefined, 'near_tie');
    expect(s).toContain(NEAR_TIE_WHY);
    expect(s).toContain(ADMISSION_WHY);
    expect(s).not.toMatch(RERUN_PROMISE);
  });

  it('RED: a near tie beside a typed limit cause says both, near tie first', () => {
    const s = agentNoLeaderSentence('constraint_verdict_withheld', undefined, ['CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN'], undefined, undefined, 'near_tie');
    expect(s).toContain(NEAR_TIE_WHY);
    expect(s).toContain('levels it cannot actually take');
    expect(s.indexOf(NEAR_TIE_WHY)).toBeLessThan(s.indexOf('levels it cannot actually take'));
    expect(s).toMatch(new RegExp(`; ${NEAR_TIE_ACTION}\\.$`));
  });

  it('RED: the provisional view\'s `because` gives the same two causes (one wording, one producer)', () => {
    const standing = leaderStandingOf({
      analysisState: { run_state: { kind: 'complete_current' }, leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld', separation: 'near_tie' } },
      analysisReady: ALL_OLUMIS,
    });
    expect(standing.because).toBe(agentNoLeaderReason('constraint_verdict_withheld', ALL_OLUMIS, [], undefined, undefined, 'near_tie'));
    expect(standing.because).toContain(NEAR_TIE_WHY);
    expect(standing.because).toContain(ADMISSION_WHY);
  });

  it('RED at the wire: the enforcer reads `separation` off the response\'s own analysis_state', () => {
    const out = enforceAgentLaneLeaderClaimsAtWire(
      {
        assistant_text: 'The AI assistant is the front-runner here. Please confirm the link strengths.',
        blocks: [],
        suggested_actions: [],
        analysis_state: { run_state: { kind: 'complete_current' }, leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld', separation: 'near_tie' } },
      } as unknown as OlumiResponse,
      {
        requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld',
        graph: { nodes: [{ id: 'ai', kind: 'option', label: 'AI assistant' }], edges: [] }, analysisReady: ALL_OLUMIS,
      } as never,
    );
    const text = out.response.assistant_text;
    expect(text).toContain(NEAR_TIE_WHY);
    expect(text).toContain(ADMISSION_WHY);
    expect(text).not.toMatch(RERUN_PROMISE);
  });

  it('the composed sentence is one of the module\'s own (protected by identity, never re-dropped)', () => {
    const s = agentNoLeaderSentence('constraint_verdict_withheld', ALL_OLUMIS, [], undefined, undefined, 'near_tie');
    expect(AGENT_NO_LEADER_SENTENCES).toContain(s);
  });

  it('CONTRAST: a SEPARATED run keeps the admission\'s sentence exactly, next action included', () => {
    const s = agentNoLeaderSentence('constraint_verdict_withheld', ALL_OLUMIS, [], undefined, undefined, 'separated');
    expect(s).toBe(agentNoLeaderSentence('constraint_verdict_withheld', ALL_OLUMIS, []));
    expect(s).toContain('set one of them yourself, then run the analysis again');
  });

  it('CONTRAST: a near tie on its own is said exactly as before', () => {
    expect(agentNoLeaderSentence('options_do_not_separate', undefined, [], undefined, undefined, 'near_tie'))
      .toBe(agentNoLeaderSentence('options_do_not_separate', undefined, []));
  });
});
