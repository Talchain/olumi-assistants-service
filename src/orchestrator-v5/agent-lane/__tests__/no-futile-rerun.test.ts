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

  it('RED (AI Quality 5847818424, served): says only what the code proves — levels the figure cannot take, not your limit — and no "fix the limit, run again"', () => {
    const s = agentNoLeaderSentence('constraint_verdict_withheld', SERVED.analysis_ready, limitCauseCodesOf(SERVED.blocks));
    expect(s).toContain('levels it cannot actually take');
    expect(s).toContain('not your limit');
    // R&C #2016 B1: the typed code names no estimate and no provenance.
    expect(s).not.toContain('Olumi’s own estimate');
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

  it('CO-HELD: the served (S) warning names the unsized link and removes the futile admission-only rerun', () => {
    const analysisReady = { analysis_admission: { permitted_analysis_mode: 'quantified_provisional', reasons: [{ field: 'permitted_analysis_mode', code: 'CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED' }] } };
    const graph = {
      nodes: [{ id: 'saving', label: 'Expected GCP-related monthly saving' }, { id: 'costs', label: 'Costs' }],
      edges: [{ from: 'saving', to: 'costs', provenance: { magnitude: 'olumi_placeholder' } }],
    };
    const blocks = [{ type: 'analysis_result', enrichment: { inference_warnings: [{
      code: 'GOAL_FIGURES_PLACEHOLDER_PATH', node_ids: ['saving', 'costs'], option_ids: ['switch'],
      message: 'Not shown. Give a figure for that link and Olumi will use it.',
    }] } }];
    const out = enforceAgentLaneLeaderClaimsAtWire(
      {
        assistant_text: 'Switch to GCP is the front-runner under these assumptions. The model has an unsized link.',
        blocks, suggested_actions: [],
        analysis_state: { leader_claim: { permitted: false, withheld_reason: 'separation_unavailable' } },
      } as unknown as OlumiResponse,
      { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'separation_unavailable', graph, analysisReady } as never,
    );
    expect(out.response.assistant_text).toContain('This comparison turns on the link from ‘Expected GCP-related monthly saving’ to ‘Costs’, whose strength isn\'t sized in the model yet.');
    expect(out.response.assistant_text).toContain('Set it to see how much it matters.');
    expect(out.response.assistant_text).toContain('Set it to see how much it matters.');
    expect(out.response.assistant_text).not.toContain('set one of them yourself, then run the analysis again');
    const again = enforceAgentLaneLeaderClaimsAtWire(out.response, {
      requestId: 't2', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'separation_unavailable', graph, analysisReady,
    } as never);
    expect(again.response.assistant_text).toBe(out.response.assistant_text);
  });

  it('CO-HELD: unread goal product does not prescribe a value-and-rerun loop', () => {
    const analysisReady = { analysis_admission: { permitted_analysis_mode: 'comparative_leader', reasons: [{ field: 'permitted_analysis_mode', code: 'READY_TO_COMPARE' }] } };
    const blocks = [{ type: 'analysis_result', enrichment: { inference_warnings: [{ code: 'GOAL_FIGURES_PRODUCT_NOT_READ' }] } }];
    const out = enforceAgentLaneLeaderClaimsAtWire(
      {
        assistant_text: 'Raise the price leads the options. The product has not been confirmed.', blocks, suggested_actions: [],
        analysis_state: { leader_claim: { permitted: false, withheld_reason: 'separation_unavailable' } },
      } as unknown as OlumiResponse,
      { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'separation_unavailable', graph: { nodes: [], edges: [] }, analysisReady } as never,
    );
    expect(out.response.assistant_text).toContain('Olumi has not read your goal as the product of your own figures');
    expect(out.response.assistant_text).not.toContain('set one of them yourself, then run the analysis again');
    expect(out.response.assistant_text).not.toContain('ask me to run the analysis');
    expect(agentNoLeaderSentence('separation_unavailable', analysisReady)).toContain('ask me to run the analysis');
  });

  it('keeps one complete closing across a second wire pass when a factor label contains ranking punctuation', () => {
    const analysisReady = { analysis_admission: { permitted_analysis_mode: 'quantified_provisional', reasons: [{ field: 'permitted_analysis_mode', code: 'CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED' }] } };
    const graph = { nodes: [
      { id: 'saving', kind: 'factor', label: 'A. Switch to GCP is the front-runner' },
      { id: 'costs', kind: 'goal', label: 'Costs' },
    ], edges: [{ from: 'saving', to: 'costs' }] };
    const blocks = [{ type: 'analysis_result', enrichment: { inference_warnings: [{
      code: 'GOAL_FIGURES_PLACEHOLDER_PATH', node_ids: ['saving', 'costs'],
      message: 'Give a figure for that link and Olumi will use it.',
    }] } }];
    const opts = { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false,
      leaderClaimWithheldReason: 'separation_unavailable', graph, analysisReady } as never;
    const first = enforceAgentLaneLeaderClaimsAtWire({
      assistant_text: 'Continue with AWS is the front-runner. Model caveats remain.', blocks, suggested_actions: [],
      analysis_state: { leader_claim: { permitted: false, withheld_reason: 'separation_unavailable' } },
    } as unknown as OlumiResponse, opts);
    expect(first.response.assistant_text).toContain('This comparison turns on the link from ‘A. Switch to GCP is the front-runner’ to ‘Costs’, whose strength isn\'t sized in the model yet. Set it to see how much it matters.');
    const second = enforceAgentLaneLeaderClaimsAtWire(first.response, opts);
    expect(second.response.assistant_text).toBe(first.response.assistant_text);
  });

  it('does not use an old Run’s goal-figure warning as the cause after a model edit', () => {
    const analysisReady = { analysis_admission: { permitted_analysis_mode: 'comparative_leader', reasons: [] } };
    const graph = { nodes: [{ id: 'saving', label: 'Saving' }, { id: 'costs', label: 'Costs' }], edges: [{ from: 'saving', to: 'costs' }] };
    for (const code of ['GOAL_FIGURES_PRODUCT_NOT_READ', 'GOAL_FIGURES_PLACEHOLDER_PATH']) {
      const blocks = [{ type: 'analysis_result', enrichment: { inference_warnings: [{ code, node_ids: ['saving', 'costs'], message: 'Give a figure for that link and Olumi will use it.' }] } }];
      const out = enforceAgentLaneLeaderClaimsAtWire({
        assistant_text: 'Switch to GCP is the front-runner. Model caveats remain.', blocks, suggested_actions: [],
        analysis_state: { leader_claim: { permitted: false, withheld_reason: 'analysis_out_of_date' } },
      } as unknown as OlumiResponse, {
        requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false,
        leaderClaimWithheldReason: 'analysis_out_of_date', graph, analysisReady,
      } as never);
      expect(out.response.assistant_text, code).toContain('worked out before your latest change');
      expect(out.response.assistant_text, code).toContain('run the analysis again');
      expect(out.response.assistant_text, code).not.toContain('Olumi has not sized how');
      expect(out.response.assistant_text, code).not.toContain('Olumi has not read your goal');
    }
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
    expect(text).toContain('levels it cannot actually take');
    expect(text).not.toMatch(FUTILE);
  });
});
