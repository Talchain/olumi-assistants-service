/**
 * ⛔ THE ONE-CALL REPLY NEVER DROPS A FIGURE THE USER WROTE.
 *
 * Served journey-A C3 (15 served turns replayed through the real route, 28 Sep): the user wrote "price sensitivity is
 * very high, and we've seen our churn increase by 15% when we made our last price increase. That was only £4." The model
 * sent the link-strength proposal with `whole_request: true` on 11/15, so the reply was composed from the result, and it
 * named the user's +15% / £4 on 4/15. `whole_request` is the model's word; the figures are the user's. The one-call path
 * now also needs every figure the user wrote (`findStatedAmounts`) to be carried by the call, outside quotes of their
 * words; otherwise the turn keeps its narrating call, for any model.
 */
import { describe, expect, it, vi } from 'vitest';
import { composeProposalReply, userFiguresTheCallLeaves } from '../proposal-reply.js';
import { runAgentTurn } from '../runtime/agent-loop.js';
import type { AgentCapabilities } from '../runtime/agent-tools.js';

/** The served C3 message, verbatim (pj-20260927T130748Z). */
const SERVED = "Talking to the team, our customers' price sensitivity is very high, and we've seen our churn increase by 15% when we made our last price increase. That was only £4.";
/** agent-capabilities.ts `proposeLinkStrength`, as in proposal-reply-one-call.test.ts. */
const LINK = {
  ok: true, mutated: false, proposal_id: 'prop_4f806dbf5ac981af36413822a2c810fd',
  public_label: 'Record "Price sensitivity" → "Monthly churn" as very strong, Olumi’s reading of your "very high" (0.85 on Olumi\'s 0–1 scale), as your own estimate',
  base_revision: 'a'.repeat(64),
  link: { from: 'Price sensitivity', to: 'Monthly churn', was: { band: 'weak' }, becomes: { band: 'very strong', strength: '0.85' } },
};
const ARGS = { from_label: 'Price sensitivity', to_label: 'Monthly churn', strength: 'very strong', from_words: "our customers' price sensitivity is very high", whole_request: true };

describe('the one-call reply never drops a figure the user wrote', () => {
  it('CONTROL: the same call on a message with no figure is answered from its result, as today', () => {
    expect(composeProposalReply('propose_link_strength', ARGS, LINK, "Talking to the team, our customers' price sensitivity is very high.")).not.toBeNull();
  });

  it('RED (served C3): +15% and £4 are not carried by the call → the narrating call runs', () => {
    expect(userFiguresTheCallLeaves(ARGS, SERVED)).toEqual(['15%', '£4']);
    expect(composeProposalReply('propose_link_strength', ARGS, LINK, SERVED)).toBeNull();
  });

  it('RED: a figure inside a QUOTE of the user is carried into no reply → still narrated', () => {
    const quoting = { ...ARGS, from_words: SERVED };
    expect(userFiguresTheCallLeaves(quoting, SERVED)).toEqual(['15%', '£4']);
    expect(composeProposalReply('propose_link_strength', quoting, LINK, SERVED)).toBeNull();
  });

  it('a figure the call carries is not left: as a number, a percent as its fraction, or its text', () => {
    expect(userFiguresTheCallLeaves({ levels: [{ factor: 'Pro plan price', value: 59, unit: 'GBP per month' }] }, 'Add an option at £59 per month.')).toEqual([]);
    expect(userFiguresTheCallLeaves({ value: 0.04, unit: 'fraction' }, 'Monthly churn is 4% today.')).toEqual([]);
    expect(userFiguresTheCallLeaves({ raw: '£59' }, 'Add an option at £59.')).toEqual([]);
    // One carried, one not: the one not carried is named.
    expect(userFiguresTheCallLeaves({ value: 59 }, 'Add an option at £59; last time churn rose 15%.')).toEqual(['15%']);
  });
});

describe('Codex CHANGES_REQUIRED on #2263: one carried value never stands for two written figures', () => {
  it('RED (the counterexample): { value: 4, unit: GBP } carries £4, never 4%', () => {
    expect(userFiguresTheCallLeaves({ value: 4, unit: 'GBP' }, 'Price rose £4 and churn rose 4%')).toEqual(['4%']);
  });
  it('RED: a bare 4 stands for ONE of £4 / 4%, never both', () => {
    expect(userFiguresTheCallLeaves({ value: 4 }, 'Price rose £4 and churn rose 4%')).toEqual(['4%']);
  });
  it('RED (kind, with enough values): two GBP-typed 4s carry £4, still never 4%', () => {
    expect(userFiguresTheCallLeaves({ levels: [{ value: 4, unit: 'GBP' }, { value: 4, unit: 'GBP' }] }, 'Price rose £4 and churn rose 4%')).toEqual(['4%']);
  });
  it('RED: a percent-typed 4 is not £4', () => {
    expect(userFiguresTheCallLeaves({ value: 4, unit: '%' }, 'Price rose £4.')).toEqual(['£4']);
  });
  it('CONTROL: distinct evidence for distinct figures carries both', () => {
    expect(userFiguresTheCallLeaves({ levels: [{ value: 4, unit: 'GBP' }, { value: 0.04, unit: 'fraction' }] }, 'Price rose £4 and churn rose 4%')).toEqual([]);
  });
  it('RED (currency identity, Codex CR #2): USD 4 never carries the user\u2019s £4; CONTROL: GBP 4 does', () => {
    expect(userFiguresTheCallLeaves({ value: 4, unit: 'USD' }, 'Price rose £4.')).toEqual(['£4']);
    expect(userFiguresTheCallLeaves({ value: 4, unit: 'EUR per month' }, 'Price rose £4.')).toEqual(['£4']);
    expect(userFiguresTheCallLeaves({ value: 4, unit: 'GBP per month' }, 'Price rose £4.')).toEqual([]);
  });
  it('RED (text evidence is one-to-one, Codex CR #2): one "£4" in a label carries ONE written £4, not two', () => {
    expect(userFiguresTheCallLeaves({ label: 'Raise by £4' }, 'Raise by £4, and again by £4 next year.')).toEqual(['£4']);
    expect(userFiguresTheCallLeaves({ label: 'Raise by £4, then £4 more' }, 'Raise by £4, and again by £4 next year.')).toEqual([]);
  });
  it('RED (whole figures only): "£45" in a label never carries a written "£4"', () => {
    expect(userFiguresTheCallLeaves({ label: 'The £45 plan' }, 'Raise it by £4.')).toEqual(['£4']);
  });
});

describe('the loop, with the real composer and the served message', () => {
  const call = { type: 'function_call', call_id: 'c1', name: 'propose_link_strength', arguments: JSON.stringify(ARGS) };
  const caps = { proposeLinkStrength: vi.fn(async () => LINK) } as unknown as AgentCapabilities;
  const base = { ctx: { scenario_id: 's', authenticated_user_id: 'u', request_id: 'r' }, history: [], message: SERVED, instructions: 'i', maxOutputTokens: 500 };

  it('RED (served C3): the second call narrates, and its words (with the user’s figures) are the reply', async () => {
    const callModel = vi.fn()
      .mockResolvedValueOnce({ output: [call] })
      .mockResolvedValueOnce({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Noted: churn rose 15% after a £4 rise.' }] }] });
    const r = await runAgentTurn({ ...base, composeReply: (t: string, a: unknown, res: unknown) => composeProposalReply(t, a, res, SERVED) } as never, caps, callModel as never);
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(r.assistant_text).toContain('15%');
  });

  it('CONTROL: no figure in the message → ONE model call, the composed reply', async () => {
    const plain = "Talking to the team, our customers' price sensitivity is very high.";
    const callModel = vi.fn(async () => ({ output: [call] }));
    const r = await runAgentTurn({ ...base, message: plain, composeReply: (t: string, a: unknown, res: unknown) => composeProposalReply(t, a, res, plain) } as never, caps, callModel as never);
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(r.assistant_text).toContain('Price sensitivity');
  });
});
