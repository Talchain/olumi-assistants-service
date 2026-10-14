/**
 * ⭐ A CHIP PROMPT IS PROSE THE USER SENDS AS THEIR OWN — THE WITHHELD GATE MUST SEE IT (DL 0df0e1 6010662486; WORDING
 * c6 lease #87 6010674597; found by 7b's Codex r1 on #2654).
 *
 * The calibration card (`phase3-blocks.ts`, `calibration_prompt`) copies the model's question VERBATIM into both `body`
 * and `action_prompt`, and `compose.ts` keeps that card on a withheld turn (only `strengthen` is leader-presuming).
 * `body` was scanned; `action_prompt` was not. So the enforcer could rewrite `body` while the chip still carried
 * "{X} leads by about 35 points…", which the user would then send as their own next message.
 *
 * Now `action_prompt` is a scanned prose field. On a withheld turn a claim in it OMITS THE CHIP (`action_prompt` with
 * its `action_label` / `action_intent`, which render together or not at all), never a rewritten prompt put in the
 * user's mouth. It does so in the SAME call that rewrites `body`, so the two can never diverge.
 */
import { describe, expect, it } from 'vitest';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { enforceLeadingOptionClaimsAtWire } from '../leading-option-wire-enforcement.js';
import { findLeaderClaims } from '../leading-option-egress-guard.js';

const LEADER = 'Hire Marketing Manager';
const CLAIM_Q = `${LEADER} leads by about 35 percentage points. What evidence would make you switch?`;
const CLEAN_Q = 'What evidence would change your view on Capacity?';

const ROSTER_GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Customer growth' },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    { id: 'opt_hire', kind: 'option', label: LEADER },
    { id: 'opt_hold', kind: 'option', label: 'Hold' },
  ],
  edges: [],
};
const OPTS = { requestId: 'req-action-prompt', exitPath: 'edit_graph' as const, graph: ROSTER_GRAPH };

const card = (body: string, prompt: string): Record<string, unknown> => ({
  type: 'coaching',
  coaching_kind: 'calibration_prompt',
  title: 'Test your thinking',
  body,
  action_intent: 'explain_result',
  action_label: 'Ask about this',
  action_prompt: prompt,
});
const envelope = (block: Record<string, unknown>): OlumiResponse =>
  ({
    response_version: 2,
    assistant_text: 'Here is the analysis.',
    blocks: [block],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'analyse',
  }) as unknown as OlumiResponse;
const enforce = (block: Record<string, unknown>, mayNameLeadingOption: boolean) =>
  enforceLeadingOptionClaimsAtWire(envelope(block), { ...OPTS, mayNameLeadingOption });
const blockOf = (r: OlumiResponse): Record<string, unknown> => (r.blocks as unknown as Array<Record<string, unknown>>)[0]!;

describe('withheld: a leader claim in action_prompt omits the chip', () => {
  it('the calibration card, served shape (same question in body and action_prompt): body rewritten AND chip omitted in ONE call', () => {
    const { response, changed } = enforce(card(CLAIM_Q, CLAIM_Q), false);
    const b = blockOf(response);
    expect(changed).toBe(true);
    // body: the existing projection removes the designation.
    expect(String(b.body)).not.toContain(LEADER);
    // action_prompt: omitted with its chip, never left divergent from body.
    expect(b).not.toHaveProperty('action_prompt');
    expect(b).not.toHaveProperty('action_label');
    expect(b).not.toHaveProperty('action_intent');
    // The card itself stays (title, kind): only the leader-carrying chip goes.
    expect([b.type, b.coaching_kind, b.title]).toEqual(['coaching', 'calibration_prompt', 'Test your thinking']);
  });
  it('a divergent producer (clean body, claim only in action_prompt) still loses the chip', () => {
    const b = blockOf(enforce(card(CLEAN_Q, CLAIM_Q), false).response);
    expect(b.body).toBe(CLEAN_Q);
    expect(b).not.toHaveProperty('action_prompt');
    expect(b).not.toHaveProperty('action_label');
  });
  it('SAME TURN (DL): no output ever has a clean body beside a claim-bearing action_prompt', () => {
    for (const [body, prompt] of [[CLAIM_Q, CLAIM_Q], [CLEAN_Q, CLAIM_Q], [CLAIM_Q, CLEAN_Q]] as const) {
      const b = blockOf(enforce(card(body, prompt), false).response);
      expect(typeof b.action_prompt === 'string' && String(b.action_prompt).includes(LEADER) && !String(b.body).includes(LEADER)).toBe(false);
    }
  });
});

describe('controls: nothing else moves', () => {
  it('withheld, a chip prompt with NO claim ships byte for byte', () => {
    const input = envelope(card(CLEAN_Q, CLEAN_Q));
    const { response, changed } = enforceLeadingOptionClaimsAtWire(input, { ...OPTS, mayNameLeadingOption: false });
    expect(changed).toBe(false);
    expect(response).toBe(input);
  });
  it('withheld, a prompt that NAMES an option with an input, not a result, ships byte for byte (Codex #2660 r1)', () => {
    const prompt = 'While discussing Hold, we ended up with the highest-cost assumption for the sensitivity test.';
    const input = envelope(card(CLEAN_Q, prompt));
    const { response, changed } = enforceLeadingOptionClaimsAtWire(input, { ...OPTS, mayNameLeadingOption: false });
    expect(changed).toBe(false);
    expect(response).toBe(input);
  });
  it.each(['Hold ended up with the highest MRR.', 'Hold delivered the lowest-churn outcome.', 'Hold gave the highest-margin result.'])(
    'CONTROL: a RESULT still omits the chip (Codex #2660 r2) — %s',
    (prompt) => {
      const b = blockOf(enforce(card(CLEAN_Q, prompt), false).response);
      expect(b).not.toHaveProperty('action_prompt');
    },
  );
  it('LICENSED: the same claim-bearing card ships byte for byte', () => {
    const input = envelope(card(CLAIM_Q, CLAIM_Q));
    const { response, changed } = enforceLeadingOptionClaimsAtWire(input, { ...OPTS, mayNameLeadingOption: true });
    expect(changed).toBe(false);
    expect(response).toBe(input);
  });
});

describe('the alarm sees action_prompt', () => {
  it('a claim ONLY in action_prompt is a hit, at that path', () => {
    const hits = findLeaderClaims(envelope(card(CLEAN_Q, CLAIM_Q)));
    expect(hits.some((h) => JSON.stringify(h).includes('action_prompt'))).toBe(true);
  });
});
