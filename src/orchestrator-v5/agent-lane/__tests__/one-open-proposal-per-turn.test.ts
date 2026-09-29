/**
 * ⛔ A TURN NEVER ASKS FOR APPROVAL WITHOUT ITS CONTROL (AI Conversation #70 5847130065 (a); DL `bf-20260926T113645Z`
 * turns[3]): `propose_model_change` + `propose_option_interventions` both returned ok in one turn, the reply said
 * "Approve both changes?", and `suggested_actions` was [] — `approvalChipsFor` offers a chip only for exactly ONE
 * proposal, and rightly: each proposal is bound to the revision it was made on, so approving one supersedes the other.
 *
 * THE RULE: a second proposing call in a turn that already has a proposal awaiting approval is refused
 * (`one_change_per_approval`) — nothing is stored — so the turn ends with ONE proposal and its chip. The refusal tells
 * the Agent to fold one operation into one proposal, or to say the second change is not proposed yet.
 *
 * Production-shaped: the real `runAgentTurn` executes the calls in order, and its `tool_calls` go to
 * `approvalChipsFor` exactly as the route passes them; the capabilities are backed by a real `ProposalStore`.
 */
import { describe, it, expect } from 'vitest';
import { runAgentTurn, type CallModel } from '../runtime/agent-loop.js';
import type { AgentCapabilities, AgentToolContext } from '../runtime/agent-tools.js';
import { ProposalStore, createProposal } from '../proposal.js';
import { approvalChipsFor, ONE_CHANGE_PER_APPROVAL } from '../approval-chips.js';

const ctx: AgentToolContext = { scenario_id: 'scn', authenticated_user_id: null, request_id: 'req' };

function world() {
  const store = new ProposalStore();
  let revision = 'H0';
  const propose = (label: string) => {
    const p = store.put(createProposal({
      scenario_id: ctx.scenario_id, user_id: null, base_graph_identity_hash: revision,
      operations: [{ op: 'add_edge', path: `${label}::goal`, value: { effect_direction: 'positive' } }],
      provenance: { authored_by: 'model_proposed' },
      validation: { admitted: true, loss_count: 0, refusals: [] },
      public_label: label,
    }));
    return { ok: true, mutated: false, proposal_id: p.proposal_id };
  };
  const caps = {
    proposeModelChange: async (_c: unknown, args: { from_label: string }) => propose(args.from_label),
    proposeOptionInterventions: async () => propose('level'),
    authoriseChange: async (_c: unknown, args: { proposal_id: string }) => {
      const d = store.authorise({ proposal_id: args.proposal_id, scenario_id: ctx.scenario_id, authenticated_user_id: null, current_graph_identity_hash: revision });
      if (d.status !== 'execute') return { ok: false, mutated: false, proposal_id: args.proposal_id, refusal: d.status };
      store.markApplied(args.proposal_id);
      revision = revision === 'H0' ? 'H1' : 'H2';
      return { ok: true, mutated: true, applied: true, proposal_id: args.proposal_id };
    },
  } as unknown as AgentCapabilities;
  return { store, caps, propose };
}

/** The model makes these calls in this order — `perHop` calls per hop — then answers. */
const scripted = (calls: readonly { name: string; args: Record<string, unknown> }[], perHop = 1): CallModel => {
  let at = 0;
  return async () => {
    const batch = calls.slice(at, at + perHop);
    at += perHop;
    if (batch.length === 0) return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Approve both changes?' }] }] } as never;
    return { output: batch.map((c, i) => ({ type: 'function_call', name: c.name, arguments: JSON.stringify(c.args), call_id: `call_${at}_${i}` })) } as never;
  };
};

const turn = (caps: AgentCapabilities, calls: readonly { name: string; args: Record<string, unknown> }[], perHop = 1) =>
  runAgentTurn({ instructions: 'i', message: 'Link B, and set the level to 54.', history: [], ctx, maxHops: 6, maxOutputTokens: 100 } as never, caps, scripted(calls, perHop));

const LINK = { name: 'propose_model_change', args: { from_label: 'B', to_label: 'goal', direction: 'positive', rationale: 'r' } };
const LEVEL = { name: 'propose_option_interventions', args: { interventions: [{ option_label: 'X', factor_label: 'F', value: 54, basis: 'the user' }] } };

describe('a turn ends with at most ONE proposal awaiting approval, so it always has its control', () => {
  it('RED (DL bf-20260926T113645Z turns[3] shape): a link, then a level → the level is refused, nothing stored, and the one proposal keeps its chip', async () => {
    const w = world();
    const r = await turn(w.caps, [LINK, LEVEL]);
    expect(r.tool_calls.map((c) => [c.name, c.ok, c.refusal ?? null])).toEqual([
      ['propose_model_change', true, null], ['propose_option_interventions', false, ONE_CHANGE_PER_APPROVAL],
    ]);
    expect(w.store.size()).toBe(1);
    const chips = approvalChipsFor(r.tool_calls);
    expect(chips.map((c) => c.id)).toContain(`agent-approve-proposal:${r.tool_calls[0]!.proposal_id}`);
    const refusal = r.tool_results[1] as { detail?: unknown };
    expect(String(refusal.detail)).toMatch(/ONE call/);
    expect(String(refusal.detail)).toMatch(/not proposed yet/);
  });

  it('RED: the same two calls in ONE hop (parallel tool calls) → the second is refused the same way', async () => {
    const w = world();
    const r = await turn(w.caps, [LINK, LEVEL], 2);
    expect(r.tool_calls.map((c) => c.ok)).toEqual([true, false]);
    expect(w.store.size()).toBe(1);
    expect(approvalChipsFor(r.tool_calls).length).toBeGreaterThan(0);
  });

  it('CONTRAST: approve A, THEN propose B in the same turn → B is the one open proposal and is NOT refused', async () => {
    const w = world();
    const a = w.propose('A').proposal_id;
    const r = await turn(w.caps, [{ name: 'authorise_change', args: { proposal_id: a } }, LINK]);
    expect(r.tool_calls.map((c) => [c.name, c.ok])).toEqual([['authorise_change', true], ['propose_model_change', true]]);
    expect(approvalChipsFor(r.tool_calls).map((c) => c.id)).toContain(`agent-approve-proposal:${r.tool_calls[1]!.proposal_id}`);
  });

  it('CONTRAST: a proposal left open by an EARLIER turn does not block this turn\'s one proposal', async () => {
    const w = world();
    w.propose('earlier');
    const r = await turn(w.caps, [LINK]);
    expect(r.tool_calls.map((c) => c.ok)).toEqual([true]);
  });
});
