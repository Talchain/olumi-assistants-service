/**
 * ⭐ THE RUN-RESULT REPLY RULE, REPLACED WHOLE BY THE AIE'S EXACT TEXT (#94 6133633297, 12 Oct; DL producers re-scope).
 * The replaced value told the model to name a leader "only as 'In this model, N% of runs supported X'" and to give the run
 * share after the goal chances; the AIE's text replaces that positive command rather than stacking a conflicting ban. It
 * is APPENDED to the served Agent instructions as before, so the v0.2 template and every host rule are unchanged (the
 * served-bytes rows are in `selected-coach-wiring.test.ts`: the rule is in what the real route SENT on both aliases).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { HOST_TOOL_CONTRACT, SELECTED_COACH_V02_TEMPLATE } from '../coach-route-v0_2.js';
import { MODEL_RELATIVE_NAMING_INSTRUCTION, REPLY_LENGTH_INSTRUCTION } from '../../../routes/agent-v1-turn.js';
import { enforceAgentLaneLeaderClaimsAtWire, rankingLabelContext, sentenceRanksOptions } from '../withheld-leader-fail-closed.js';
import { enforceLeaderLicenceAtFinalEgress } from '../leader-final-egress.js';

/** The AIE's text, copied byte for byte from #94 6133633297 (the spec this constant must equal). */
const AIE_RUN_RESULT_REPLY_RULE =
  'Run result replies: lead with the selected Run\'s licensed goal-chance or withholding lines. '
  + 'Retain their target scope, unscored conditions and provisional, timing and source qualifications. '
  + 'Do not state a share of model runs or name a leader from that share in a result reply, even when a comparative leader-naming permission is present. '
  + 'Never substitute a relative ranking for an unavailable goal chance. '
  + 'The separate goal-chance licence governs any comparison of goal chances. '
  + 'In dedicated comparative reasoning only, you may report a permitted share recorded for the selected Run, using the approved credit label and qualifier; never turn it into a recommendation or the chance of the whole goal. '
  + 'Explain the supported implication or useful next action, and what the result rests on, using measured sensitivity and the figure\'s source when available. '
  + 'Never write recommend or recommendation, including negated forms. '
  + 'Never call a result, option or link fragile.';

describe('the run-result reply rule', () => {
  it('is the AIE\'s exact text, byte for byte', () => {
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toBe(AIE_RUN_RESULT_REPLY_RULE);
  });

  it('replaces the positive leader command and the share-after-chances instruction (no stacked ban)', () => {
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).not.toContain('name it only as');
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).not.toContain('runs supported');
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).not.toContain('give any run share after them');
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).not.toContain('the most runs supported');
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('Do not state a share of model runs or name a leader from that share in a result reply');
  });

  it('the recommend stem stays banned even negated, and the rule models no negated gloss', () => {
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('Never write recommend or recommendation, including negated forms.');
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).not.toContain('not a recommendation');
  });

  it('the per-option headline stays the chance of meeting the goal (#35 keeps that meaning)', () => {
    expect(HOST_TOOL_CONTRACT).toContain('the per-option headline is its chance of meeting the goal, in this model, on current information');
  });

  it('never "fragile"', () => {
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('Never call a result, option or link fragile.');
  });

  it('is APPENDED after the reply-length sentence in the route source: no swap, the template and every host rule unchanged', () => {
    const src = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    // Re-pinned for D3 step 2 (DL 0df0e1 ruling C, 6 Oct): the goal-chance ranking rule is appended AFTER this one.
    // Re-pinned for S-A (lane COPY-SHAPE, 7 Oct): the one reply-shape sentence sits between the length sentence and this rule.
    expect(src).toContain("[MUTATION_INSTRUCTION, HOST_TOOL_CONTRACT, REPLY_LENGTH_INSTRUCTION, REPLY_SHAPE_INSTRUCTION, MODEL_RELATIVE_NAMING_INSTRUCTION, GOAL_CHANCE_RANKING_INSTRUCTION].join(' ')");
    expect(SELECTED_COACH_V02_TEMPLATE.split('{{MODE_AND_AUTHORITY}}')).toHaveLength(2);
    expect(SELECTED_COACH_V02_TEMPLATE).not.toContain(MODEL_RELATIVE_NAMING_INSTRUCTION);
    expect(HOST_TOOL_CONTRACT).not.toContain(MODEL_RELATIVE_NAMING_INSTRUCTION);
    expect(REPLY_LENGTH_INSTRUCTION).not.toContain(MODEL_RELATIVE_NAMING_INSTRUCTION);
    // It restates no host rule: #34's licence sentence stays the only place the permission is granted.
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).not.toContain('leader_may_be_named');
  });

  it('carries no dash a user could see quoted back and no figure', () => {
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).not.toMatch(/[‒-―]/);
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).not.toMatch(/\d/);
  });
});

// The replaced rule's own sentence form ("In this model, N% of runs supported X") is no longer requested, but raw model
// prose can still say it: the served wire gates keep dropping it on a withheld turn.
describe('a share-naming sentence (the replaced rule\'s form) through the served wire gates (post-check rows)', () => {
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

  it('CATCH TWIN FIRST: on a withheld turn the share-naming form is a ranking, and the wire gate drops it', () => {
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
