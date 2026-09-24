/**
 * ⛔ THE CHIP MUST AGREE WITH THE STORE THAT WILL DECIDE THE CLICK (Codex #1806 5807933515).
 *
 * Production-shaped: the real `runAgentTurn` executes the model's calls in order, its recorded
 * `tool_calls` go to `approvalChipsFor` exactly as the route passes them, and the capabilities are
 * backed by a real `ProposalStore` whose `authorise` is the one a click reaches. A chip is correct
 * only when that store would execute the proposal it names.
 */
import { describe, it, expect } from 'vitest';
import { runAgentTurn, type CallModel } from '../runtime/agent-loop.js';
import type { AgentCapabilities, AgentToolContext } from '../runtime/agent-tools.js';
import { ProposalStore, createProposal } from '../proposal.js';
import { approvalChipsFor, typedApprovalOf } from '../approval-chips.js';

const ctx: AgentToolContext = { scenario_id: 'scn', authenticated_user_id: null, request_id: 'req' };

/** A model whose revision moves when an approved proposal is applied. */
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
  const decide = (proposalId: string) => store.authorise({
    proposal_id: proposalId, scenario_id: ctx.scenario_id, authenticated_user_id: null, current_graph_identity_hash: revision,
  });
  const caps = {
    proposeModelChange: async (_c: unknown, args: { from_label: string }) => propose(args.from_label),
    authoriseChange: async (_c: unknown, args: { proposal_id: string }) => {
      const d = decide(args.proposal_id);
      if (d.status !== 'execute') return { ok: false, mutated: false, proposal_id: args.proposal_id, refusal: d.status };
      store.markApplied(args.proposal_id);
      revision = revision === 'H0' ? 'H1' : 'H2';
      return { ok: true, mutated: true, applied: true, proposal_id: args.proposal_id };
    },
  } as unknown as AgentCapabilities;
  return { store, caps, propose, decide };
}

/** The model makes these calls, one per hop, in this order, then answers. */
const scripted = (calls: readonly { name: string; args: Record<string, unknown> }[]): CallModel => {
  let hop = 0;
  return async () => {
    const c = calls[hop];
    hop += 1;
    if (c === undefined) return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }] } as never;
    return { output: [{ type: 'function_call', name: c.name, arguments: JSON.stringify(c.args), call_id: `call_${hop}` }] } as never;
  };
};

const turn = (caps: AgentCapabilities, calls: readonly { name: string; args: Record<string, unknown> }[]) =>
  runAgentTurn({ instructions: 'i', message: 'Yes, make that change.', history: [], ctx, maxHops: 6, maxOutputTokens: 100 } as never, caps, scripted(calls));

const proposeB = { name: 'propose_model_change', args: { from_label: 'B', to_label: 'goal', direction: 'positive', rationale: 'r' } };

describe('the approve chip agrees with the store that decides the click', () => {
  it('RED: B proposed on H0, then A approved (H0→H1) → no chip, because the store refuses B as superseded', async () => {
    const w = world();
    const a = w.propose('A').proposal_id; // offered on an earlier turn, on H0
    const r = await turn(w.caps, [proposeB, { name: 'authorise_change', args: { proposal_id: a } }]);

    // Vacuity guards: the loop really ran both calls, in this order, and A really moved the model.
    expect(r.tool_calls.map((c) => [c.name, c.ok, c.mutated])).toEqual([
      ['propose_model_change', true, false], ['authorise_change', true, true],
    ]);
    const b = r.tool_calls[0]!.proposal_id!;
    expect(w.decide(b).status).toBe('superseded');

    expect(approvalChipsFor(r.tool_calls)).toEqual([]);
  });

  it('CONTRAST: A approved (H0→H1), THEN B proposed on H1 → B\'s typed chip, and the store would execute it', async () => {
    const w = world();
    const a = w.propose('A').proposal_id;
    const r = await turn(w.caps, [{ name: 'authorise_change', args: { proposal_id: a } }, proposeB]);

    expect(r.tool_calls.map((c) => [c.name, c.ok, c.mutated])).toEqual([
      ['authorise_change', true, true], ['propose_model_change', true, false],
    ]);
    const b = r.tool_calls[1]!.proposal_id!;
    const chips = approvalChipsFor(r.tool_calls);
    expect(chips.map((c) => c.id)).toEqual([`agent-approve-proposal:${b}`, 'agent-amend-proposal']);
    // The click is the typed, zero-call path, and it names a proposal the store will execute.
    expect(typedApprovalOf({ chip: { id: chips[0]!.id } })).toBe(b);
    expect(w.decide(b).status).toBe('execute');
  });

  it('CONTRAST: an authorisation whose identity is unknown → no chip', async () => {
    const w = world();
    const caps = { ...w.caps, authoriseChange: async () => ({ ok: true, mutated: true, applied: true }) } as unknown as AgentCapabilities;
    const r = await turn(caps, [{ name: 'authorise_change', args: { proposal_id: 'prop_000000' } }, proposeB]);
    expect(r.tool_calls.map((c) => c.name)).toEqual(['authorise_change', 'propose_model_change']);
    expect(approvalChipsFor(r.tool_calls)).toEqual([]);
  });
});
