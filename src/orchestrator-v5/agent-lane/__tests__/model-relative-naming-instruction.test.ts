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

describe('AIE 363 Run result instruction', () => {
  it('leads with licensed goal chances or withholding and forbids a share headline', () => {
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain("Run result replies: lead with the selected Run's licensed goal-chance or withholding lines.");
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('Do not state a share of model runs or name a leader from that share in a result reply');
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('Never substitute a relative ranking for an unavailable goal chance.');
  });
  it('keeps recommendation, source, scope, timing and sensitivity negatives', () => {
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('Never write recommend or recommendation, including negated forms.');
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('Never call a result, option or link fragile.');
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('unscored conditions and provisional, timing and source qualifications');
    expect(HOST_TOOL_CONTRACT).toContain('Never call an option the winner, the best option or the recommended one.');
    expect(SELECTED_COACH_V02_TEMPLATE).toContain('Preserve meaningful disagreement.');
    expect(SELECTED_COACH_V02_TEMPLATE).toContain('Missing is unknown, not zero.');
    expect(SELECTED_COACH_V02_TEMPLATE).toContain('Never invent evidence, measurements, permissions, completed actions');
  });
});

describe('the rule’s own sentence through the served wire gates (post-check rows)', () => {
  const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }] };
  const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
  const labels = rankingLabelContext(graph, analysisReady);
  const NAMED = 'In this model, 71% of runs supported ‘Raise Pro to £59 at release’.';
  const RESTS_ON = 'In this model, the result rests on Monthly churn, Olumi’s estimate.';
  const reply = `${NAMED} ${RESTS_ON}`;
  const wire = (permitted: boolean) => enforceLeaderLicenceAtFinalEgress(
    { assistant_text: reply, blocks: [], suggested_actions: [] },
    { requestId: 't', exitPath: 'test', licence: permitted ? 'permitted' : 'withheld',
      mayNameLeadingOption: permitted, graph, analysisReady },
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
