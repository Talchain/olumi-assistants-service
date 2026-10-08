/**
 * ⭐ P44 S1 — THE CALL AFTER A HELD PROPOSAL ONLY SAYS WHAT THE RESULT HOLDS, at the banked `narrate` effort, and quotes
 * the change's exact label (DL 58e392 GO + label ruling, 7 Oct).
 *
 * Measured on the SERVED narration bytes (prompt 8c743f05, tools ae038f5f; staging turn f1c55ab0 #5): Sol high median 6.7 s,
 * low + `NARRATE_LABEL_LINE` median 4.1 s, truth rows 4/4 including the exact quoted label (low without the line: 0/2).
 * The rules under test:
 *   - ONLY a hop whose every call held a proposal (`ok`, not `mutated`, a `proposal_id`) tags the NEXT call `narrate`;
 *   - a refused, applied, id-less or non-proposing call keeps today's call, untagged and unchanged;
 *   - the label line rides at the END of that call's input and never enters the history handed on;
 *   - the route sends the model's banked `narrate` effort, and only for a model that has one.
 */
import { describe, expect, it, vi } from 'vitest';
import { hopOnlyHeldProposals, NARRATE_LABEL_LINE, runAgentTurn, type AgentTurnResult, type ModelCallRequest } from '../runtime/agent-loop.js';
import type { AgentCapabilities } from '../runtime/agent-tools.js';
import { budgetFor, callEffortFor, conversationBudgetFor } from '../model-budgets.js';
import { approvalChipsFor, NOT_ON_NARRATION, proposalsAwaitingApproval } from '../approval-chips.js';
import { narrateWriteOutcome } from '../write-outcome.js';

/** agent-capabilities.ts `proposeNewRisk`, held (its success shape). */
const HELD = {
  ok: true, mutated: false, proposal_id: 'gmh_687a918980a5',
  public_label: 'Add the risk "Onboarding new hires takes longer than expected"',
  held_message: 'Yes, add the risk "Onboarding new hires takes longer than expected"',
  base_revision: 'a'.repeat(64),
  risk: { label: 'Onboarding new hires takes longer than expected', threatens: ['Incremental platform delivery capacity (lowers it)'], driven_by: [], how_strongly: 'not known yet' },
  note: 'Nothing has changed yet. …',
};
const REFUSED = { ok: false, mutated: false, refusal: 'not_prepared', detail: 'Olumi could not prepare that as one change.' };

describe('hopOnlyHeldProposals', () => {
  it('RED: a lone held proposal → true', () => {
    expect(hopOnlyHeldProposals([{ name: 'propose_new_risk' }], [HELD as never])).toBe(true);
  });
  it('CONTROL: refused, applied, id-less, non-proposing, empty or mixed → false', () => {
    expect(hopOnlyHeldProposals([{ name: 'propose_new_risk' }], [REFUSED as never])).toBe(false);
    expect(hopOnlyHeldProposals([{ name: 'propose_new_risk' }], [{ ...HELD, mutated: true } as never])).toBe(false);
    expect(hopOnlyHeldProposals([{ name: 'propose_new_risk' }], [{ ...HELD, proposal_id: '' } as never])).toBe(false);
    expect(hopOnlyHeldProposals([{ name: 'get_canonical_state' }], [{ ok: true, mutated: false, proposal_id: 'x' } as never])).toBe(false);
    expect(hopOnlyHeldProposals([], [])).toBe(false);
    expect(hopOnlyHeldProposals([{ name: 'propose_new_risk' }, { name: 'propose_new_risk' }], [HELD as never, REFUSED as never])).toBe(false);
  });
});

describe('the loop: the narrating call is tagged and carries the label line', () => {
  const call = { type: 'function_call', call_id: 'c1', name: 'propose_new_risk', arguments: JSON.stringify({ label: 'Onboarding new hires takes longer than expected', affects: [{ target_label: 'G', direction: 'negative' }], rationale: 'r', whole_request: false }) };
  const base = { ctx: { scenario_id: 's', authenticated_user_id: 'u', request_id: 'r' }, history: [], message: 'Add a risk.', instructions: 'i', maxOutputTokens: 500 };
  const answer = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Shall I add it?' }] }] };
  const lastText = (req: ModelCallRequest): string => JSON.stringify(req.input.at(-1));

  it('RED: held → call 2 is narrate, ends with the label line; call 1 is not; history never keeps the line', async () => {
    const caps = { proposeNewRisk: vi.fn(async () => HELD) } as unknown as AgentCapabilities;
    const callModel = vi.fn().mockResolvedValueOnce({ output: [call] }).mockResolvedValueOnce(answer);
    const r = await runAgentTurn({ ...base, composeReply: () => null } as never, caps, callModel as never);
    expect(callModel).toHaveBeenCalledTimes(2);
    const [first, second] = callModel.mock.calls.map((c) => c[0] as ModelCallRequest);
    expect(first!.reasoning_role).toBeUndefined();
    expect(lastText(first!)).not.toContain(NARRATE_LABEL_LINE);
    expect(second!.reasoning_role).toBe('narrate');
    expect(lastText(second!)).toContain(NARRATE_LABEL_LINE);
    expect(JSON.stringify(r.items)).not.toContain(NARRATE_LABEL_LINE);
    expect(r.assistant_text).toBe('Shall I add it?');
  });

  it('CONTROL: refused → call 2 untagged, no label line (today\'s call)', async () => {
    const caps = { proposeNewRisk: vi.fn(async () => REFUSED) } as unknown as AgentCapabilities;
    const callModel = vi.fn().mockResolvedValueOnce({ output: [call] }).mockResolvedValueOnce(answer);
    await runAgentTurn({ ...base, composeReply: () => null } as never, caps, callModel as never);
    const second = callModel.mock.calls[1]![0] as ModelCallRequest;
    expect(second.reasoning_role).toBeUndefined();
    expect(JSON.stringify(second.input)).not.toContain(NARRATE_LABEL_LINE);
  });
});

describe('the narrating call may withdraw, never approve (Codex r1 P1 / r2 P2; DL ruling B)', () => {
  const call = { type: 'function_call', call_id: 'c1', name: 'propose_new_risk', arguments: JSON.stringify({ label: 'R', affects: [{ target_label: 'G', direction: 'negative' }], rationale: 'r', whole_request: false }) };
  const base = { ctx: { scenario_id: 's', authenticated_user_id: 'u', request_id: 'r' }, history: [], message: 'Add a risk.', instructions: 'i', maxOutputTokens: 500 };
  const answer = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Shall I add it?' }] }] };
  const fc = (name: string, args: unknown, id: string) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });

  // ⛔ A LIVE APPROVAL CARD NEVER ASKS FOR A RETRY (Codex #2781 r3 / DL 6049608420, P2).
  it('RED P2: a narration-only refusal says awaiting approval and keeps the exact held proposal card', async () => {
    const authoriseChange = vi.fn(async () => ({ ok: true, mutated: true }));
    const caps = { proposeNewRisk: vi.fn(async () => HELD), authoriseChange } as unknown as AgentCapabilities;
    const callModel = vi.fn()
      .mockResolvedValueOnce({ output: [call] })
      .mockResolvedValueOnce({ output: [fc('authorise_change', { proposal_id: HELD.proposal_id }, 'c2')] })
      .mockResolvedValueOnce(answer);
    const r = await runAgentTurn(base as never, caps, callModel as never);
    const held = r.tool_results[0]!;
    expect(held.proposal_id).toBe(HELD.proposal_id);
    expect(approvalChipsFor(r.tool_calls).find((c) => c.id === `agent-approve-proposal:${held.proposal_id}`)).toBeDefined();
    expect(authoriseChange).not.toHaveBeenCalled();
    const status = narrateWriteOutcome(r.assistant_text, r.tool_calls, r.tool_results).status;
    expect(status).toContain('approval');
    expect(status).not.toMatch(/Not saved|try again/i);
  });

  // ⛔ ...AND NEVER POINTS AT A CARD THAT IS GONE (Codex #2781 r4 P2): refused on the narrating call, then withdrawn.
  it('RED P2 withdrawn: refused then withdrawn → no approve card and no "waiting for your approval"', async () => {
    const withdrawProposal = vi.fn(async () => ({ ok: true, mutated: false, proposal_id: HELD.proposal_id }));
    const caps = { proposeNewRisk: vi.fn(async () => HELD), withdrawProposal } as unknown as AgentCapabilities;
    const callModel = vi.fn()
      .mockResolvedValueOnce({ output: [call] })
      .mockResolvedValueOnce({ output: [fc('authorise_change', { proposal_id: HELD.proposal_id }, 'c2')] })
      .mockResolvedValueOnce({ output: [fc('withdraw_proposal', { proposal_id: HELD.proposal_id }, 'c3')] })
      .mockResolvedValueOnce(answer);
    const r = await runAgentTurn({ ...base, composeReply: () => null } as never, caps, callModel as never);
    expect(r.tool_calls.map((c) => [c.name, c.refusal ?? null])).toEqual([['propose_new_risk', null], ['authorise_change', NOT_ON_NARRATION], ['withdraw_proposal', null]]);
    expect(approvalChipsFor(r.tool_calls).find((c) => c.id === `agent-approve-proposal:${HELD.proposal_id}`)).toBeUndefined();
    const status = narrateWriteOutcome(r.assistant_text, r.tool_calls, r.tool_results).status;
    expect(status).toBeNull();
  });

  // ⛔ THE LINE SPEAKS FOR ITS OWN CHANGE ONLY (Codex #2781 r5 P2): an earlier approval this turn DID save, so no turn-wide
  // "nothing has been changed" / "nothing was approved" beside it.
  it('RED P2 earlier save: approved A, held B, narrating authorise(B) refused → no turn-wide negative claim', async () => {
    const authoriseChange = vi.fn(async () => ({ ok: true, mutated: true, proposal_id: 'gmh_earlier_a', receipts: [{ version: 2 }] }));
    const withdrawProposal = vi.fn(async () => ({ ok: true, mutated: false, proposal_id: HELD.proposal_id }));
    const caps = { proposeNewRisk: vi.fn(async () => HELD), authoriseChange, withdrawProposal } as unknown as AgentCapabilities;
    for (const withdraw of [false, true]) {
      const callModel = vi.fn()
        .mockResolvedValueOnce({ output: [fc('authorise_change', { proposal_id: 'gmh_earlier_a' }, 'c0')] })
        .mockResolvedValueOnce({ output: [call] })
        .mockResolvedValueOnce({ output: [fc('authorise_change', { proposal_id: HELD.proposal_id }, 'c2')] });
      if (withdraw) callModel.mockResolvedValueOnce({ output: [fc('withdraw_proposal', { proposal_id: HELD.proposal_id }, 'c3')] });
      callModel.mockResolvedValueOnce(answer);
      const r = await runAgentTurn({ ...base, composeReply: () => null } as never, caps, callModel as never);
      expect(r.tool_calls.map((c) => [c.name, c.refusal ?? null]).slice(0, 3)).toEqual([['authorise_change', null], ['propose_new_risk', null], ['authorise_change', NOT_ON_NARRATION]]);
      const status = narrateWriteOutcome(r.assistant_text, r.tool_calls, r.tool_results).status ?? '';
      expect(status).toMatch(/saved/i);
      expect(status).not.toMatch(/nothing (has been|was) (approved or )?changed/i);
      expect(status.includes('waiting for your approval')).toBe(!withdraw);
    }
  });

  it('RED: authorise_change on the narrating call is refused before dispatch, and the held change keeps its approve card', async () => {
    const authoriseChange = vi.fn(async () => ({ ok: true, mutated: true }));
    const caps = { proposeNewRisk: vi.fn(async () => HELD), authoriseChange } as unknown as AgentCapabilities;
    const callModel = vi.fn()
      .mockResolvedValueOnce({ output: [call] })
      .mockResolvedValueOnce({ output: [fc('authorise_change', { proposal_id: HELD.proposal_id }, 'c2')] })
      .mockResolvedValueOnce(answer);
    const r = await runAgentTurn({ ...base, composeReply: () => null } as never, caps, callModel as never);
    expect(authoriseChange).not.toHaveBeenCalled();
    expect(r.tool_calls.map((c) => [c.name, c.ok, c.refusal ?? null])).toEqual([['propose_new_risk', true, null], ['authorise_change', false, NOT_ON_NARRATION]]);
    expect(r.mutated).toBe(false);
    expect(approvalChipsFor(r.tool_calls).map((c) => c.id)).toContain(`agent-approve-proposal:${HELD.proposal_id}`);
    expect([...proposalsAwaitingApproval(r.tool_calls).keys()]).toEqual([HELD.proposal_id]);
  });

  it('CONTROL: withdraw_proposal on the narrating call is dispatched (correction stays possible)', async () => {
    const withdrawProposal = vi.fn(async () => ({ ok: true, mutated: false, proposal_id: HELD.proposal_id }));
    const caps = { proposeNewRisk: vi.fn(async () => HELD), withdrawProposal } as unknown as AgentCapabilities;
    const callModel = vi.fn()
      .mockResolvedValueOnce({ output: [call] })
      .mockResolvedValueOnce({ output: [fc('withdraw_proposal', { proposal_id: HELD.proposal_id }, 'c2')] })
      .mockResolvedValueOnce(answer);
    const r = await runAgentTurn({ ...base, composeReply: () => null } as never, caps, callModel as never);
    expect(withdrawProposal).toHaveBeenCalledTimes(1);
    // The hop after a withdraw is not narration: the budget's own effort, no label line.
    const third = callModel.mock.calls[2]![0] as ModelCallRequest;
    expect(third.reasoning_role).toBeUndefined();
    expect(r.tool_calls.map((c) => c.name)).toEqual(['propose_new_risk', 'withdraw_proposal']);
  });

  it('CONTROL: on the narrating call, approving an EARLIER turn\'s proposal (not one this turn held) is dispatched', async () => {
    // approval-chip-order.test.ts: B is proposed and held, then the next hop approves A, which the user said yes to.
    const authoriseChange = vi.fn(async () => ({ ok: true, mutated: true, proposal_id: 'gmh_earlier' }));
    const caps = { proposeNewRisk: vi.fn(async () => HELD), authoriseChange } as unknown as AgentCapabilities;
    const callModel = vi.fn()
      .mockResolvedValueOnce({ output: [call] })
      .mockResolvedValueOnce({ output: [fc('authorise_change', { proposal_id: 'gmh_earlier' }, 'c2')] })
      .mockResolvedValueOnce(answer);
    const r = await runAgentTurn({ ...base, composeReply: () => null } as never, caps, callModel as never);
    expect((callModel.mock.calls[1]![0] as ModelCallRequest).reasoning_role).toBe('narrate');
    expect(authoriseChange).toHaveBeenCalledTimes(1);
    expect(r.tool_calls.map((c) => [c.name, c.ok, c.refusal ?? null])).toEqual([['propose_new_risk', true, null], ['authorise_change', true, null]]);
  });

  it('CONTROL: authorise_change on an ordinary (non-narrating) call is still dispatched', async () => {
    const authoriseChange = vi.fn(async () => ({ ok: true, mutated: true }));
    const caps = { authoriseChange } as unknown as AgentCapabilities;
    const callModel = vi.fn()
      .mockResolvedValueOnce({ output: [fc('authorise_change', { proposal_id: 'gmh_earlier' }, 'c1')] })
      .mockResolvedValueOnce(answer);
    await runAgentTurn({ ...base, message: 'Yes, approve it.', composeReply: () => null } as never, caps, callModel as never);
    expect(authoriseChange).toHaveBeenCalledTimes(1);
  });
});

/**
 * ⛔ A NARRATION FAILURE NEVER LOSES A HELD CHANGE (Codex #2781 r3 / DL 6049608420, P1).
 * The provider cannot undo a successful hold; the answer and approve card keep that result's exact identity.
 */
describe('narration recovery from the known held result', () => {
  const args = { label: 'Onboarding new hires takes longer than expected', affects: [{ target_label: 'G', direction: 'negative' }], rationale: 'r', whole_request: false };
  const call = { type: 'function_call', call_id: 'c1', name: 'propose_new_risk', arguments: JSON.stringify(args) };
  const base = { ctx: { scenario_id: 's', authenticated_user_id: 'u', request_id: 'r' }, history: [], message: 'Add a risk.', instructions: 'i', maxOutputTokens: 500 };
  const recovered = (r: AgentTurnResult, held = HELD) => {
    expect(r.stopped_reason).toBe('answered');
    expect(r.assistant_text.trim()).not.toBe('');
    expect(r.tool_calls).toEqual([{ name: 'propose_new_risk', ok: true, mutated: false, proposal_id: held.proposal_id }]);
    expect(r.tool_results).toEqual([held]);
    expect(r.mutated).toBe(false);
    expect(approvalChipsFor(r.tool_calls).find((c) => c.id === `agent-approve-proposal:${r.tool_results[0]!.proposal_id}`)?.id)
      .toBe(`agent-approve-proposal:${held.proposal_id}`);
    expect(r.items.at(-1)).toEqual({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: r.assistant_text }] });
    expect(JSON.stringify(r.items)).not.toContain(NARRATE_LABEL_LINE);
    expect(r.timing).toMatchObject({ provider_calls: 2, tool_calls: 1, hops: 1 });
  };

  it.each([
    ['error', new Error('openai_500')],
    ['timeout', Object.assign(new Error('deadline exceeded'), { name: 'AbortError' })],
  ])('RED P1 %s: a rejected narrating call answers from the held label and preserves its approve card', async (_kind, error) => {
    let wallTime = 0;
    const caps = { proposeNewRisk: vi.fn(async () => { wallTime += 20; return HELD; }) } as unknown as AgentCapabilities;
    const callModel = vi.fn()
      .mockImplementationOnce(async () => { wallTime += 10; return { output: [call] }; })
      .mockImplementationOnce(async () => { wallTime += 30; throw error; });
    const r = await runAgentTurn({ ...base, now: () => wallTime } as never, caps, callModel as never);
    recovered(r);
    expect(r.assistant_text).toBe(`I have prepared this change: ${HELD.public_label}. Nothing is changed until you approve it.`);
    expect(r.timing).toMatchObject({ total_ms: 60, provider_ms: 40, tool_ms: 20, overhead_ms: 0 });
  });

  it('RED P1 composeReply: recovery composes from the held call name, parsed arguments and exact result', async () => {
    const caps = { proposeNewRisk: vi.fn(async () => HELD) } as unknown as AgentCapabilities;
    // Keep the existing one-call compose branch: defer there so the failed narration reaches recovery.
    const composeReply = vi.fn().mockReturnValueOnce(null).mockReturnValue('COMPOSED');
    const callModel = vi.fn().mockResolvedValueOnce({ output: [call] }).mockRejectedValueOnce(new Error('openai_500'));
    const r = await runAgentTurn({ ...base, composeReply } as never, caps, callModel as never);
    recovered(r);
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(r.assistant_text).toBe('COMPOSED');
    expect(composeReply).toHaveBeenCalledTimes(2);
    expect(composeReply).toHaveBeenLastCalledWith('propose_new_risk', args, HELD);
  });

  it('RED P1 previous hop: recovery composes from the held proposal after an earlier read', async () => {
    const read = { ok: true, mutated: false };
    const held = { ...HELD, proposal_id: 'gmh_previous_hop', public_label: 'Add the risk "Delivery is delayed"' };
    const heldArgs = { ...args, label: 'Delivery is delayed' };
    const caps = { getCanonicalState: vi.fn(async () => read), proposeNewRisk: vi.fn(async () => held) } as unknown as AgentCapabilities;
    const composeReply = vi.fn().mockReturnValueOnce(null).mockReturnValue('COMPOSED');
    const callModel = vi.fn()
      .mockResolvedValueOnce({ output: [{ type: 'function_call', call_id: 'read', name: 'get_canonical_state', arguments: '{}' }] })
      .mockResolvedValueOnce({ output: [{ ...call, call_id: 'hold', arguments: JSON.stringify(heldArgs) }] })
      .mockRejectedValueOnce(new Error('openai_500'));
    const r = await runAgentTurn({ ...base, composeReply } as never, caps, callModel as never);
    expect(r.stopped_reason).toBe('answered');
    expect(r.assistant_text).toBe('COMPOSED');
    expect(composeReply).toHaveBeenLastCalledWith('propose_new_risk', heldArgs, held);
    expect(r.tool_results).toEqual([read, held]);
    expect(r.tool_calls).toHaveLength(2);
    expect(approvalChipsFor(r.tool_calls).find((c) => c.id === `agent-approve-proposal:${held.proposal_id}`)).toBeDefined();
  });

  it.each([
    ['envelope', { status: 'incomplete', incomplete_reason: 'max_output_tokens', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Unfinished' }] }] }],
    ['message', { output: [{ type: 'message', status: 'incomplete', content: [{ type: 'output_text', text: 'Unfinished' }] }] }],
    ['tool call', { status: 'incomplete', incomplete_reason: 'max_output_tokens', output: [{ type: 'function_call', call_id: 'c2', name: 'authorise_change', arguments: JSON.stringify({ proposal_id: HELD.proposal_id }) }] }],
  ])('RED P1 incomplete %s: recovery keeps the held result and excludes all partial output', async (_kind, incomplete) => {
    const authoriseChange = vi.fn();
    const caps = { proposeNewRisk: vi.fn(async () => HELD), authoriseChange } as unknown as AgentCapabilities;
    const callModel = vi.fn().mockResolvedValueOnce({ output: [call] }).mockResolvedValueOnce(incomplete);
    const r = await runAgentTurn(base as never, caps, callModel as never);
    recovered(r);
    expect(r.assistant_text).toContain(HELD.public_label);
    expect(JSON.stringify(r.items)).not.toContain('Unfinished');
    expect(authoriseChange).not.toHaveBeenCalled();
    expect(callModel).toHaveBeenCalledTimes(2);
  });

  it('RED P1 no label: a blank compose result falls back to the deterministic review sentence', async () => {
    const held = { ...HELD, public_label: '   ' };
    const caps = { proposeNewRisk: vi.fn(async () => held) } as unknown as AgentCapabilities;
    const composeReply = vi.fn(() => '   ');
    const callModel = vi.fn().mockResolvedValueOnce({ output: [call] }).mockRejectedValueOnce(new Error('openai_500'));
    const r = await runAgentTurn({ ...base, composeReply } as never, caps, callModel as never);
    recovered(r, held);
    expect(r.assistant_text).toBe('I have prepared a change for you to review. Nothing is changed until you approve it.');
  });

  it('CONTROL: a model error on call 1 still rejects with the original error', async () => {
    const error = new Error('openai_500');
    const callModel = vi.fn().mockRejectedValueOnce(error);
    await expect(runAgentTurn(base as never, {} as AgentCapabilities, callModel as never)).rejects.toBe(error);
  });

  it('CONTROL: a model error after a refused hop still rejects with the original error', async () => {
    const error = new Error('openai_500');
    const caps = { proposeNewRisk: vi.fn(async () => REFUSED) } as unknown as AgentCapabilities;
    const callModel = vi.fn().mockResolvedValueOnce({ output: [call] }).mockRejectedValueOnce(error);
    await expect(runAgentTurn(base as never, caps, callModel as never)).rejects.toBe(error);
  });

  it('CONTROL: a composed first-call reply still answers without making a narrating call', async () => {
    const caps = { proposeNewRisk: vi.fn(async () => HELD) } as unknown as AgentCapabilities;
    const composeReply = vi.fn(() => 'COMPOSED');
    const callModel = vi.fn().mockResolvedValueOnce({ output: [call] });
    const r = await runAgentTurn({ ...base, composeReply } as never, caps, callModel as never);
    expect(r.assistant_text).toBe('COMPOSED');
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(composeReply).toHaveBeenCalledExactlyOnceWith('propose_new_risk', args, HELD);
  });
});

describe('callEffortFor: the effort the route sends', () => {
  it('RED: Sol conversation (high) narrating → its banked narrate effort, low', () => {
    expect(callEffortFor(budgetFor('gpt-6.1-sol', 'conversation'), { reasoning_role: 'narrate' })).toBe('low');
  });
  it('CONTROL: not narrating → the budget\'s own effort; a model with no narrate entry is never changed', () => {
    expect(callEffortFor(budgetFor('gpt-6.1-sol', 'conversation'), {})).toBe('high');
    expect(callEffortFor(conversationBudgetFor(true), { reasoning_role: 'narrate' })).toBe(conversationBudgetFor(true).reasoning_effort);
    expect(callEffortFor(budgetFor('gpt-5.6-sol', 'conversation'), { reasoning_role: 'narrate' })).toBeUndefined();
  });
});
