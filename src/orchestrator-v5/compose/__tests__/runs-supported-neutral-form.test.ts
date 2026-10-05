/**
 * ⭐ THE DIRECTION-NEUTRAL LEADER FORM IS A LEADER CLAIM TO EVERY GUARD (DL 0df0e1 #87 6002469285, Part B).
 *
 * Paul (20:2xZ): never "best / ahead / winner / recommend". Where a composer cannot see the Run's sent direction, it names
 * an option as "{N}% of runs supported {X}", "more runs would support {X} if …" or "the option most runs supported". A new
 * leader verb the guards cannot read would switch redaction off for it (`scored_highest`'s note), so the shared vocabulary
 * (`LEADER_CLAIM_PATTERNS` → `textNamesLeadingOption`) and the Agent lane's fail-closed classifier (`RANKING_PATTERNS`)
 * learn it in the same change. The catch rows carry no percentage and no other ranking word, so each RED needs this
 * pattern alone (mutant: delete `runs_supported` from either list).
 */
import { describe, it, expect } from 'vitest';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { textNamesLeadingOption } from '../leading-option-egress-guard.js';
import { enforceAgentLaneLeaderClaimsAtWire, rankingLabelContext, sentenceRanksOptions } from '../../agent-lane/withheld-leader-fail-closed.js';
import { LINK_COPY, renderLinkTippingPoints, afterFrame, IN_THIS_MODEL } from '../../agent-lane/method-turn/what-changes-turn.js';

const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }, { id: 'price', kind: 'factor', label: 'Price' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }] };
const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
const labels = rankingLabelContext(graph, analysisReady);

const WOULD = 'More runs would support ‘Raise Pro to £59 at release’ if price’s effect on monthly churn fell below about a quarter of what it is now.';
const STILL = 'Most runs would still support ‘Keep Pro at £49’ even if price’s average effect on monthly churn fell to zero.';
const CARD = 'On Olumi’s estimates, the option most runs supported is more likely than not to break your churn limit.';
const SHARE = 'In this model, 62% of runs supported ‘Raise Pro to £59 at release’ for MRR.';
const PLAIN = 'Monthly churn is currently assumed at 3%, against your limit of 4%.';

describe('the shared vocabulary (textNamesLeadingOption) reads the neutral form', () => {
  it.each([WOULD, STILL, CARD, SHARE])('RED: names a leading option: %s', (s) => { expect(textNamesLeadingOption(s)).toBe(true); });
  it('CONTROL: a sentence about a figure names none', () => { expect(textNamesLeadingOption(PLAIN)).toBe(false); });
});

describe('the Agent lane fail-closed classifier reads it', () => {
  it.each([WOULD, STILL, CARD])('RED: ranks options (no % and no other ranking word): %s', (s) => {
    expect(sentenceRanksOptions(s, labels)).toBe(true);
  });
  it('CONTROL: the figure sentence ranks nothing', () => { expect(sentenceRanksOptions(PLAIN, labels)).toBe(false); });

  const wire = (permitted: boolean, text: string) => enforceAgentLaneLeaderClaimsAtWire(
    { assistant_text: text, blocks: [], suggested_actions: [],
      analysis_state: { leader_claim: permitted ? { permitted: true } : { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
    permitted
      ? { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: true, graph, analysisReady }
      : { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady },
  ).response.assistant_text as string;

  it('CATCH TWIN (unlicensed use): on a withheld turn the neutral form is dropped, the figure sentence kept', () => {
    const out = wire(false, `In this model, ${afterFrame(WOULD)} ${PLAIN}`);
    expect(out).not.toMatch(/runs would support/i);
    expect(out).toContain(PLAIN);
  });
  it('licensed: the same reply passes the gate unchanged', () => {
    const text = `In this model, ${afterFrame(WOULD)} ${PLAIN}`;
    expect(wire(true, text)).toBe(text);
  });
});

describe('the composers emit only forms the guards read (derived from the real builder)', () => {
  it('every what-changes sentence is a leader claim to both guards, and says no banned word', () => {
    const links = [
      { from_id: 'price', to_id: 'churn', status: 'quoted', threshold: 0.064, current_mean: 0.25, to_option_id: 'raise' },
      { from_id: 'price', to_id: 'churn', status: 'quoted', threshold: 0.02, current_mean: 0.25, to_option_id: 'raise' },
      { from_id: 'churn', to_id: 'price', status: 'no_change', threshold: null, current_mean: 0.2, to_option_id: null },
    ];
    const out = renderLinkTippingPoints(links as never, {
      node: { price: 'Price', churn: 'Monthly churn' } as never, option: { keep: 'Keep Pro at £49', raise: 'Raise Pro to £59 at release' } as never, leaderId: 'keep',
    } as never);
    expect(out).toHaveLength(3);
    for (const s of out) {
      expect(textNamesLeadingOption(s), s).toBe(true);
      expect(sentenceRanksOptions(s, labels), s).toBe(true);
      expect(s).not.toMatch(/\b(?:ahead|best|lead|leads|winner|wins?)\b/);
    }
    expect(Object.values(LINK_COPY).every((c) => /^(?:More|Most) runs would/.test(c))).toBe(true);
  });
  it('the frame reads on in lower case: "In this model, more runs would support …"', () => {
    expect(`${IN_THIS_MODEL}${afterFrame(WOULD)}`).toMatch(/^In this model, more runs would support ‘/);
    expect(afterFrame('‘Keep Pro at £49’ is unchanged.')).toBe('‘Keep Pro at £49’ is unchanged.');
  });
});
