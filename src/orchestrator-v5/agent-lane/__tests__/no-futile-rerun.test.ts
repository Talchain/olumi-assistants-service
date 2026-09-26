/**
 * ⛔ NEVER A FUTILE "FIX YOUR LIMIT, THEN RUN AGAIN" (DL #70 5847835872). Two served instances, one class:
 *   - AI Quality 5847818424 (Paul's churn brief, CEE 626b4cc): the limit is scored and PLoT returns
 *     CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN — the model's own AI→churn size, not the user's limit — yet the reply ended
 *     "tell me whether that limit is right as it stands, then run the analysis again". Fixture: that run's block verbatim.
 *   - R&C 5847390325: a level limit on a factor every option sets is refused upstream; same closing; a rerun loops.
 * Keyed on TYPED codes (`decision_brief.warnings[].code`), never on prose.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { agentNoLeaderSentence, enforceAgentLaneLeaderClaimsAtWire, limitCauseCodesOf } from '../withheld-leader-fail-closed.js';

const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-churn-limit-out-of-domain-626b4cc.json', import.meta.url), 'utf8')) as {
  analysis_ready: unknown; analysis_state: unknown; blocks: unknown[];
};
const FUTILE = /tell me whether that limit is right|then run the analysis again/;

describe('the no-leader sentence never asks for a rerun that cannot help', () => {
  it('PRECONDITION: the served run carries the typed out-of-domain cause', () => {
    expect(limitCauseCodesOf(SERVED.blocks)).toContain('CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN');
  });

  it('RED (AI Quality 5847818424, served): the cause is the model’s own estimate → named, and no "fix the limit, run again"', () => {
    const s = agentNoLeaderSentence('constraint_verdict_withheld', SERVED.analysis_ready, limitCauseCodesOf(SERVED.blocks));
    expect(s).toContain('Olumi’s own estimate of an effect in your model');
    expect(s).toContain('not your limit');
    expect(s).not.toMatch(FUTILE);
    expect(s).not.toContain('CONSTRAINT_');
  });

  it('RED (R&C 5847390325 shape): no typed cause → neither "is the limit right" nor "run again"; says a rerun will not change it', () => {
    const s = agentNoLeaderSentence('constraint_verdict_withheld', undefined, []);
    expect(s).not.toMatch(FUTILE);
    expect(s).toContain('running the analysis again as it stands will not change that');
  });

  it('CONTROL: a reason the USER can change keeps its next action (setting one of the estimates, then running again)', () => {
    const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'quantified_provisional', reasons: [{ field: 'permitted_analysis_mode', code: 'CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED' }] } };
    expect(agentNoLeaderSentence('constraint_verdict_withheld', analysisReady, ['CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN'])).toContain('set one of them yourself, then run the analysis again');
  });

  it('RED at the wire: the enforcer reads the typed cause from the response’s own blocks', () => {
    const out = enforceAgentLaneLeaderClaimsAtWire(
      {
        assistant_text: 'Keeping £49 is the front-runner under these assumptions. The churn limit could not be tested.',
        blocks: SERVED.blocks, suggested_actions: [],
        analysis_state: { leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } },
      } as unknown as OlumiResponse,
      { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph: { nodes: [], edges: [] }, analysisReady: SERVED.analysis_ready } as never,
    );
    const text = out.response.assistant_text;
    expect(text).toContain('Olumi’s own estimate of an effect in your model');
    expect(text).not.toMatch(FUTILE);
  });
});
