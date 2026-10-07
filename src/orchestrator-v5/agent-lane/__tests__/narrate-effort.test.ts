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
import { hopOnlyHeldProposals, NARRATE_LABEL_LINE, runAgentTurn, type ModelCallRequest } from '../runtime/agent-loop.js';
import type { AgentCapabilities } from '../runtime/agent-tools.js';
import { budgetFor, callEffortFor, conversationBudgetFor } from '../model-budgets.js';
import { conversationPromptAlias } from '../runtime/prompt-identity.js';

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
    // Narration only (Codex r1 P1): the lowered call may make no tool decision; its tools stay declared (same prefix).
    expect(second!.tool_choice).toBe('none');
    expect(second!.tools).toEqual(first!.tools);
    expect(first!.tool_choice).toBeUndefined();
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
    expect(second.tool_choice).toBeUndefined();
    expect(JSON.stringify(second.input)).not.toContain(NARRATE_LABEL_LINE);
  });
});

describe('conversationPromptAlias: a narrating call is still the converse prompt', () => {
  it('RED: tool_choice none + narrate → agent.converse (keeps the developer-breakpoint cache carrier)', () => {
    expect(conversationPromptAlias('none', 'narrate')).toBe('agent.converse');
  });
  it('CONTROL: the Run\'s interpreting call is still agent.interpret; an ordinary call agent.converse', () => {
    expect(conversationPromptAlias('none')).toBe('agent.interpret');
    expect(conversationPromptAlias(undefined)).toBe('agent.converse');
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
