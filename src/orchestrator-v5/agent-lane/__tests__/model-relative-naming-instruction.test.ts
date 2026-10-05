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
  it('names an option only in the one model-relative form, with or without its share of runs', () => {
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('when the rules above let you name a leading option, name it only as “In this model, ‘X’ scored highest in N% of runs”');
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('If the result gives no such share, say “In this model, ‘X’ scored highest”.');
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('Never name an option as leading, ahead, favoured, on top or winning in other words, and never without “in this model”.');
  });

  it('N is the share of runs it scored highest in, never its chance of reaching the goal (#35 keeps that meaning)', () => {
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('N the share of model runs in which it scored highest, taken from the result; N is never its chance of reaching the goal.');
    expect(HOST_TOOL_CONTRACT).toContain('reaches the target in about N% of model runs');
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
    expect(src).toContain("'{{MODE_AND_AUTHORITY}}', [MUTATION_INSTRUCTION, HOST_TOOL_CONTRACT, REPLY_LENGTH_INSTRUCTION, MODEL_RELATIVE_NAMING_INSTRUCTION].join(' ')");
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
  const NAMED = 'In this model, ‘Raise Pro to £59 at release’ scored highest in 71% of runs.';
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
    expect(out).not.toContain('scored highest');
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
