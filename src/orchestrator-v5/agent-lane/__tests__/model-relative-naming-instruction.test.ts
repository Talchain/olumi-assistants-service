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

describe('the model-relative naming rule', () => {
  it('B15: leads with goal chances and keeps the run share as supporting detail (exact pin)', () => {
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain("When the result gives options' chances of meeting the goal, lead with those chances as the rules below allow, and give any run share after them as supporting detail; never open with the share.");
  });

  it('names an option only in the one model-relative form, with or without its share of runs', () => {
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('when the rules above let you name a leading option, name it only as “In this model, N% of runs supported ‘X’”');
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('If the result gives no such share, make no claim about how runs fell: say what the result rests on instead.');
    // Codex r2: a lone option can be named with no share, so no plurality or share is ever asserted without one.
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).not.toContain('the most runs supported');
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('Never name an option as leading, ahead, favoured, on top or winning in other words, and never without “in this model”.');
  });

  it('N is glossed in positive words, and the recommend stem is banned even negated (DL 0df0e1, Acceptance rehearsal 2)', () => {
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('When you say what N means, say it as what it is: \u201cThat share is the part of this model\u2019s runs that supported it, not its chance of meeting your target.\u201d');
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('That form holds whichever way the goal points and when runs tie, so use it rather than saying the option scored highest or came out lowest.');
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('Never write recommend or recommendation in any form, not even to deny it.');
    // The served gloss this replaces must not be modelled by the rule itself.
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).not.toContain('not a recommendation');
  });

  it('N is the share of runs credited to the option, never its chance of reaching the goal (#35 keeps that meaning)', () => {
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('N the share of model runs credited to it, taken from the result; N is never its chance of reaching the goal.');
    expect(HOST_TOOL_CONTRACT).toContain('the per-option headline is its chance of meeting the goal, in this model, on current information');
  });

  it('never "fragile": says what the result rests on, and names an assumption only when sensitivity was measured', () => {
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('Never call a result, finding, option or link “fragile”: say what the result rests on instead');
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('such as the assumption its decision_sensitivity names when measured, and whose figure it is.');
  });

  it('keeps the provisional and limit conditions the host rules require, in the same sentence', () => {
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('Keep any provisional or limit condition the rules above require in that same sentence.');
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
