/**
 * ⭐ AN OPTION IS NAMED ONLY IN THIS MODEL, AND NEVER "FRAGILE" (WORDING BATCH; DL 0df0e1 lease, 5 Oct; Acceptance #87
 * 5996853005). The rule is APPENDED to the served Agent instructions, so the v0.2 template and every host rule are unchanged
 * (the served-bytes rows are in `selected-coach-wiring.test.ts`: the rule is in what the real route SENT on both aliases).
 * It grants nothing: on a withheld turn the rule's own sentence form is still a ranking the wire gate drops.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { HOST_TOOL_CONTRACT, SELECTED_COACH_V02_TEMPLATE } from '../coach-route-v0_2.js';
import { MODEL_RELATIVE_NAMING_INSTRUCTION, REPLY_LENGTH_INSTRUCTION } from '../../../routes/agent-v1-turn.js';
import { enforceAgentLaneLeaderClaimsAtWire, rankingLabelContext, sentenceRanksOptions } from '../withheld-leader-fail-closed.js';
import { enforceLeaderLicenceAtFinalEgress } from '../leader-final-egress.js';

/**
 * ⛔ CHANGED EXPECTATION (prompt P13, AIE one-pass packet SHA 94ad9c8f…): the "N% of runs supported X" naming form is retired.
 * A result reply leads with the licensed goal-chance or withholding lines and states no share of runs; a permitted share is
 * for dedicated comparative reasoning only. The AIE placed these words inside HOST_TOOL_CONTRACT's whole replaced entry, so
 * the constant is no longer joined a second time (the SENT-once row is in `selected-coach-wiring.test.ts`).
 */
const P13 = 'Run result replies: lead with the selected Run\'s licensed goal-chance or withholding lines. Retain their target scope, unscored conditions and provisional, timing and source qualifications. Do not state a share of model runs or name a leader from that share in a result reply, even when a comparative leader-naming permission is present. Never substitute a relative ranking for an unavailable goal chance. The separate goal-chance licence governs any comparison of goal chances. Explain the supported implication or useful next action, and what the result rests on, using measured sensitivity and the figure\'s source when available. Never write recommend or recommendation, including negated forms. Never call a result, option or link fragile.';

describe('the result-reply rule (P13)', () => {
  it('is exactly the packet\'s P13 text', () => {
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toBe(P13);
  });

  it('retires the run-share naming form and its gloss', () => {
    for (const retired of ['N% of runs supported', 'name it only as', 'That share is the part of this model', 'never open with the share']) {
      expect(MODEL_RELATIVE_NAMING_INSTRUCTION).not.toContain(retired);
      expect(HOST_TOOL_CONTRACT).not.toContain(retired);
    }
  });

  it('keeps the bans: no share or leader in a result reply, no ranking for a missing chance, no recommend stem, never fragile', () => {
    expect(P13).toContain('Do not state a share of model runs or name a leader from that share in a result reply, even when a comparative leader-naming permission is present.');
    expect(P13).toContain('Never substitute a relative ranking for an unavailable goal chance.');
    expect(P13).toContain('Never write recommend or recommendation, including negated forms.');
    expect(P13).toContain('Never call a result, option or link fragile.');
  });

  it('is sent once, inside the host contract, and no longer joined after the reply-length sentence', () => {
    const src = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(src).toContain("[MUTATION_INSTRUCTION, HOST_TOOL_CONTRACT, REPLY_LENGTH_INSTRUCTION, REPLY_SHAPE_INSTRUCTION, GOAL_CHANCE_RANKING_INSTRUCTION].join(' ')");
    expect(HOST_TOOL_CONTRACT.split(P13)).toHaveLength(2);
    expect(SELECTED_COACH_V02_TEMPLATE).not.toContain(P13);
    expect(REPLY_LENGTH_INSTRUCTION).not.toContain(P13);
    // ⛔ CHANGED EXPECTATION (Paul 21 Oct, no win share): it grants nothing, and no leader may be named from a share of runs.
    expect(P13).not.toContain('leader_may_be_named');
    expect(HOST_TOOL_CONTRACT).toContain('Never name a leader from a share of runs.');
    expect(HOST_TOOL_CONTRACT).not.toContain('A computed comparative leader may be named');
  });

  it('carries no dash a user could see quoted back and no figure', () => {
    expect(P13).not.toMatch(/[‒-―]/);
    expect(P13).not.toMatch(/\d/);
  });
});

describe('the rule’s own sentence through the served wire gates (post-check rows)', () => {
  const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }] };
  const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
  const labels = rankingLabelContext(graph, analysisReady);
  const NAMED = 'In this model, 71% of runs supported ‘Raise Pro to £59 at release’.';
  const RESTS_ON = 'In this model, the result rests on Monthly churn, Olumi’s estimate.';
  const reply = `${NAMED} ${RESTS_ON}`;
  const wire = (permitted: boolean) => enforceAgentLaneLeaderClaimsAtWire(
    { assistant_text: reply, blocks: [], suggested_actions: [],
      analysis_state: { leader_claim: permitted ? { permitted: true } : { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
    permitted
      ? { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: true, graph, analysisReady }
      : { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady },
  ).response.assistant_text as string;

  it('CATCH TWIN FIRST: on a withheld turn the rule’s sentence form is a ranking, and the wire gate drops it', () => {
    expect(sentenceRanksOptions(NAMED, labels)).toBe(true);
    const out = wire(false);
    expect(out).not.toContain('runs supported');
    expect(out).not.toContain('71%');
  });

  it('CONTROL: the "rests on" sentence ranks nothing and survives the withheld turn byte-identical', () => {
    expect(sentenceRanksOptions(RESTS_ON, labels)).toBe(false);
    expect(wire(false)).toContain(RESTS_ON);
  });

  it('on a permitted turn the reply passes the wire gate unchanged', () => {
    expect(wire(true)).toBe(reply);
  });

  it('on a permitted licence the final egress returns the body untouched', () => {
    const body = { assistant_text: reply, blocks: [], suggested_actions: [] };
    const out = enforceLeaderLicenceAtFinalEgress(body, { requestId: 't', exitPath: 'agent_lane_v1_final', mayNameLeadingOption: true, graph, analysisReady, licence: 'permitted' });
    expect(out.response).toBe(body);
    expect(out.proseEdited).toBe(false);
  });
});
