/**
 * ⭐ PJ-C1 LATENCY: A PROPOSAL TURN'S REPLY FROM THE TOOL'S OWN RESULT — ONE MODEL CALL, NOT TWO.
 * Proposal: Runtime #70 5859918872. Words: AI Conversation 5859933281 (GO, 4 conditions). DL GO 5859943722.
 *
 * Measured (X3 192916Z/193756Z/194514Z, CEE cd489f1): one converse call ≈ 1.3 s + 11.5 ms per output token; 19 of 41
 * message turns were propose → reply (two calls, 6–17 s), and the second call only narrates what the tool returned.
 * The rules under test:
 *   - ONLY a single `propose_new_option` / `propose_link_strength` returning ok + proposal_id, as the turn's only call,
 *     with no "?" in the user's message, is answered from the result; everything else keeps today's second call;
 *   - the reply is "I've prepared this change: <consent subject>." + one line per TYPED disclosure through AIC's
 *     templates + "Approve this change?" / "Approve these N changes?" — never the tool-facing prose (`note`, `reason`);
 *   - a result key outside the tool's allowlist (a disclosure kind with no template) falls back.
 */
import { describe, expect, it, vi } from 'vitest';
import { composeProposalReply } from '../proposal-reply.js';
import { runAgentTurn } from '../runtime/agent-loop.js';
import { AGENT_TOOLS, type AgentCapabilities } from '../runtime/agent-tools.js';
import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';

/** The producer's own shape (agent-capabilities.ts `proposeNewOption`, one option, held): #2141's consent subject. */
const E07 = {
  ok: true, mutated: false, proposal_id: 'gmh_96353050be8c',
  public_label: 'Approve 5 changes',
  held_message: "Yes, add option 'Hire one senior and two juniors', with 'New senior engineers hired' at 1 engineer and 'New junior engineers hired' at 2 engineers, link 'Decision: ship the new platform' to 'Hire one senior and two juniors', link 'Hire one senior and two juniors' to 'New senior engineers hired' and link 'Hire one senior and two juniors' to 'New junior engineers hired'.",
  held_detail: "Add option 'Hire one senior and two juniors'…",
  base_revision: 'a'.repeat(64),
  option: { label: 'Hire one senior and two juniors', linked_from: 'Decision: ship the new platform', acts_on: ['New senior engineers hired', 'New junior engineers hired', 'Annual salary spend'] },
  levels: [
    { factor: 'New senior engineers hired', value: 1, unit: 'engineers', stated_by: 'user' },
    { factor: 'New junior engineers hired', value: 2, unit: 'engineers', stated_by: 'user' },
    { factor: 'Annual salary spend', value: null, still_needed: true },
  ],
  levels_not_set: [{ option: 'Hire one senior and two juniors', factor: 'Annual salary spend', value: 250000, reason: 'The model has no range for Annual salary spend to read 250000 against… propose_option_interventions…' }],
  note: 'Nothing has changed yet. Show the user the option … call authorise_change with this proposal_id once they agree.',
};
const SPLIT = {
  ...E07, proposal_id: 'gmh_579c166c035b', public_label: 'Approve 4 changes',
  held_message: "Yes, add option 'Split it 50/50', with 'Incremental feature investment' at £15,000 (Olumi’s estimate) and 'Incremental advertising spend' at £15,000 (Olumi’s estimate), link 'Decision' to 'Split it 50/50' and link 'Split it 50/50' to 'Incremental feature investment'.",
  option: { label: 'Split it 50/50', linked_from: 'Decision', acts_on: ['Incremental feature investment', 'Incremental advertising spend'] },
  levels: [
    { factor: 'Incremental feature investment', value: 15000, unit: 'GBP', stated_by: 'olumi_estimate', basis: 'half of your £30,000 budget' },
    { factor: 'Incremental advertising spend', value: 15000, unit: 'GBP', stated_by: 'olumi_estimate', basis: 'half of your £30,000 budget' },
  ],
  levels_not_set: undefined,
};
const GRANDFATHER = {
  ...E07, proposal_id: 'gmh_2ec2e716e07c', public_label: 'Approve 7 changes',
  held_message: "Yes, add option '£59 for new Pro customers; grandfather existing customers', with 'Pro plan price' at 59 GBP per month and 'Existing customers grandfathered' on, add factor 'Existing customers grandfathered' and link 'Decision: MRR' to '£59 for new Pro customers; grandfather existing customers'.",
  option: { label: '£59 for new Pro customers; grandfather existing customers', linked_from: 'Decision: MRR', acts_on: ['Pro plan price', 'Existing customers grandfathered'] },
  levels: [{ factor: 'Pro plan price', value: 59, unit: 'GBP per month', stated_by: 'user' }],
  levels_not_set: undefined,
  new_factors: [{ label: 'Existing customers grandfathered', changes: ['Monthly churn (lowers it)'], how_strongly: 'Olumi’s estimate, for the user to correct', kind: 'switch', today: 'off — …', under_the_option: 'on' }],
  new_factors_note: 'These factors are switches: …',
};
/** agent-capabilities.ts `proposeLinkStrength`, a reading of the user's own words (slice C3). */
const LINK = {
  ok: true, mutated: false, proposal_id: 'prop_4f806dbf5ac981af36413822a2c810fd',
  public_label: 'Record "Price sensitivity" → "Monthly churn rate" as very strong, Olumi’s reading of your "very high" (0.85 on Olumi\'s 0–1 scale), as your own estimate',
  base_revision: 'a'.repeat(64),
  link: { from: 'Price sensitivity', to: 'Monthly churn rate', was: { band: 'weak' }, becomes: { band: 'very strong', strength: '0.85' } },
  interpretation: { field: 'strength', from_words: 'very high', reading: 'very strong', shown_as: 'Record as very strong (your "very high")' },
  note: 'This is your reading of the user’s own words …',
};
/** The model's typed word that the call is the whole request. */
const WHOLE = { whole_request: true };
/** E07 with no refused figure: the shape that IS composed, so each fallback row below tests its own rule. */
const LONE = (): Record<string, unknown> => Object.fromEntries(Object.entries({ ...E07, levels_not_set: undefined }).filter(([, v]) => v !== undefined));
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const TOOL_NAMES = AGENT_TOOLS.map((t) => t.name);
/** AIC condition 4: no tool name, no snake_case identifier, no forbidden phrase; every figure is the tool's own. */
function guard(reply: string, result: unknown): void {
  for (const n of TOOL_NAMES) expect(reply, n).not.toContain(n);
  expect(reply).not.toMatch(/\b[a-z]+(?:_[a-z0-9]+)+\b/);
  expect(findForbiddenPhraseHit(reply)).toBeNull();
  const source = JSON.stringify(result).replace(/,(?=\d{3}\b)/g, '');
  for (const n of reply.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) expect(source, `figure ${n}`).toContain(n.replace(/,/g, ''));
}

describe('the composed reply says exactly what the tool returned, in AIC’s words', () => {
  it('FALLBACK (E07 as served): a figure the tool REFUSED to set keeps the second call — its reason is the user’s', () => {
    expect(composeProposalReply('propose_new_option', WHOLE, E07, 'We could also consider one senior and two juniors.')).toBeNull();
  });

  it('RED (E07, no salary figure sent): the consent subject, the level not set, and the chip’s count', () => {
    const r = composeProposalReply('propose_new_option', WHOLE, clean({ ...E07, levels_not_set: undefined }), 'We could also consider one senior and two juniors.');
    expect(r).toBe([
      `I’ve prepared this change: ${E07.held_message.replace(/^Yes, /, '').replace(/\.$/, '')}.`,
      'It doesn’t set a level for ‘Annual salary spend’ yet. Tell me the figure and I’ll set it.',
      'Approve these 5 changes?',
    ].join('\n\n'));
    guard(r!, clean({ ...E07, levels_not_set: undefined }));
  });

  it('RED (C08): Olumi’s levels say so, with their basis, for the user to correct', () => {
    const r = composeProposalReply('propose_new_option', { ...WHOLE, options: [{ label: 'Split it 50/50' }] }, clean(SPLIT), 'Let’s split it 50/50 at this stage.');
    expect(r).toContain('‘Incremental feature investment’ is set to £15,000, Olumi’s estimate (half of your £30,000 budget), for you to correct.');
    expect(r).toContain('‘Incremental advertising spend’ is set to £15,000, Olumi’s estimate (half of your £30,000 budget), for you to correct.');
    expect(r!.endsWith('Approve these 4 changes?')).toBe(true);
    guard(r!, SPLIT);
  });

  it('RED (A grandfather): a new switch is off today and on under the option, Olumi’s reading', () => {
    const r = composeProposalReply('propose_new_option', { ...WHOLE, options: [{ label: '£59 for new Pro customers; grandfather existing customers' }] }, clean(GRANDFATHER), 'Let’s add the grandfathering of existing customers: "£59 for new Pro customers; grandfather existing customers".');
    expect(r).toContain('‘Existing customers grandfathered’ is off today and on under this option. That is Olumi’s reading, for you to correct.');
    guard(r!, GRANDFATHER);
  });

  it('RED (A very-high): a link strength read from the user’s words is its consent label, one change', () => {
    const r = composeProposalReply('propose_link_strength', WHOLE, LINK, 'Our customers’ price sensitivity is very high.');
    expect(r).toBe(`I’ve prepared this change: record "Price sensitivity" → "Monthly churn rate" as very strong, Olumi’s reading of your "very high" (0.85 on Olumi's 0–1 scale), as your own estimate.\n\nApprove this change?`);
    guard(r!, LINK);
  });

  it('FALLBACK: without the model’s typed word that this call is the WHOLE request, the second call runs', () => {
    const lone = clean({ ...E07, levels_not_set: undefined });
    expect(composeProposalReply('propose_new_option', {}, lone, 'Add it.')).toBeNull();
    expect(composeProposalReply('propose_new_option', { whole_request: false }, lone, 'Add it.')).toBeNull();
    expect(composeProposalReply('propose_new_option', { whole_request: 'true' }, lone, 'Add it.')).toBeNull();
    expect(composeProposalReply('propose_new_option', WHOLE, lone, 'Add it.'), 'control').not.toBeNull();
  });

  it('FALLBACK (AIC 3): a question in the user’s message keeps the second call — served A08', () => {
    expect(composeProposalReply('propose_new_option', WHOLE, LONE(), 'Why can’t you just add the risk we’ve been discussing?')).toBeNull();
    expect(composeProposalReply('propose_new_option', WHOLE, LONE(), 'Add it.'), 'control: the same result without the question is composed').not.toBeNull();
  });

  it('FALLBACK (AIC 2): a disclosure kind with no template keeps the second call', () => {
    expect(composeProposalReply('propose_new_option', WHOLE, { ...LONE(), not_added: [{ option: 'X', same_levels_as: 'Y' }], not_added_note: '…' }, 'Add X.')).toBeNull();
    expect(composeProposalReply('propose_new_option', WHOLE, { ...clean(GRANDFATHER), new_factors: [{ ...GRANDFATHER.new_factors[0], kind: undefined, current_value: null }] }, 'Add it.')).toBeNull();
    expect(composeProposalReply('propose_new_option', WHOLE, { ...LONE(), something_new: true }, 'Add it.')).toBeNull();
    expect(composeProposalReply('propose_new_risk', WHOLE, { ok: true, mutated: false, proposal_id: 'gmh_x', public_label: 'Approve 2 changes', risk: {} }, 'Add the risk.')).toBeNull();
  });

  it('FALLBACK: a refused, applied or id-less result keeps the second call', () => {
    expect(composeProposalReply('propose_new_option', WHOLE, { ok: false, mutated: false, refusal: 'switch_level_not_on' }, 'Add it.')).toBeNull();
    expect(composeProposalReply('propose_new_option', WHOLE, { ...LONE(), mutated: true }, 'Add it.')).toBeNull();
    expect(composeProposalReply('propose_new_option', WHOLE, { ...LONE(), proposal_id: undefined }, 'Add it.')).toBeNull();
    expect(composeProposalReply('propose_new_option', WHOLE, { ...LONE(), held_message: '' }, 'Add it.')).toBeNull();
  });
});

describe('the loop: a composed reply ends the turn with ONE model call', () => {
  const call = { type: 'function_call', call_id: 'c1', name: 'propose_new_option', arguments: JSON.stringify({ label: 'X', rationale: 'r', whole_request: true }) };
  const caps = { proposeNewOption: vi.fn(async () => E07) } as unknown as AgentCapabilities;
  const base = { ctx: { scenario_id: 's', authenticated_user_id: 'u', request_id: 'r' }, history: [], message: 'Add it.', instructions: 'i', maxOutputTokens: 500 };

  it('RED: composed → exactly one model call; the reply is the composed text and it is in the history', async () => {
    const callModel = vi.fn(async () => ({ output: [call] }));
    const composeReply = vi.fn(() => 'COMPOSED');
    const r = await runAgentTurn({ ...base, composeReply } as never, caps, callModel as never);
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(composeReply).toHaveBeenCalledWith('propose_new_option', { label: 'X', rationale: 'r', whole_request: true }, E07);
    expect(r.assistant_text).toBe('COMPOSED');
    expect(r.stopped_reason).toBe('answered');
    expect(JSON.stringify(r.items.at(-1))).toContain('COMPOSED');
    expect(r.tool_calls).toEqual([expect.objectContaining({ name: 'propose_new_option', ok: true, proposal_id: E07.proposal_id })]);
  });

  it('CONTROL: nothing composed → the second call narrates, as today', async () => {
    const callModel = vi.fn()
      .mockResolvedValueOnce({ output: [call] })
      .mockResolvedValueOnce({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Narrated.' }] }] });
    const r = await runAgentTurn({ ...base, composeReply: () => null } as never, caps, callModel as never);
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(r.assistant_text).toBe('Narrated.');
  });

  it('CONTROL: two calls in the hop → never composed, whatever the composer says', async () => {
    const two = { output: [call, { ...call, call_id: 'c2' }] };
    const callModel = vi.fn()
      .mockResolvedValueOnce(two)
      .mockResolvedValueOnce({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Narrated.' }] }] });
    const composeReply = vi.fn(() => 'COMPOSED');
    const r = await runAgentTurn({ ...base, composeReply } as never, caps, callModel as never);
    expect(composeReply).not.toHaveBeenCalled();
    expect(r.assistant_text).toBe('Narrated.');
  });
});
