/**
 * ⛔ A CHANGE THE AGENT DISOWNS IS NEVER LEFT OFFERED (P2 of the A16 defect; DL #72 5863691992, Runtime claim 5863711801).
 *
 * Served `137d3a5` (DL run `pj-20260928T044420Z`, A16): the Agent prepared a link change, then told the user "do not
 * approve that proposal", and the same reply still carried its approve button. The harness approved it. A reply
 * cannot take a button away: the button is offered by the turn's own tool calls (`proposalsAwaitingApproval`).
 *
 * The rule is typed, never a phrase list over the reply. `withdraw_proposal` removes a change THIS turn proposed and
 * the user has not yet seen, before the reply. A withdrawn change is not offered, not stored, not carried to the next
 * turn, and does not block a corrected proposal in the same turn. A change an EARLIER turn showed the user is not
 * withdrawn here: the user has seen it, and it stays theirs to approve or decline.
 *
 * Production-shaped: the real `runAgentTurn` runs the calls in order through the real `dispatchTool`, against the real
 * capabilities and a real `ProposalStore`. Its `tool_calls` go to `approvalChipsFor` exactly as the route passes them.
 */
import { describe, it, expect } from 'vitest';
import { runAgentTurn, type CallModel } from '../runtime/agent-loop.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { AGENT_TOOLS, toolsFor } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipsFor, proposalsAwaitingApproval, ONE_CHANGE_PER_APPROVAL } from '../approval-chips.js';

const SCENARIO = '550e8400-e29b-41d4-a716-4466554400d1';
const RISK = 'Competitors undercut price or discount AI features';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r' };

function world() {
  const graph = {
    nodes: [
      { id: 'dec', kind: 'decision', label: 'Price decision' },
      { id: 'risk_competitors', kind: 'risk', label: RISK },
      { id: 'mrr', kind: 'goal', label: 'MRR' },
    ],
    edges: [{ from: 'risk_competitors', to: 'mrr', strength: { mean: -0.5, std: 0.125 }, exists_probability: 1, effect_direction: 'negative', provenance: { source: 'cee_hypothesis' }, defaulted: true }],
  };
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h1' } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  const proposals = new ProposalStore();
  return { caps: createAgentCapabilities(d, proposals), proposals };
}

type Call = { name: string; args: (lastProposalId: string | undefined) => Record<string, unknown> };
/** The model makes these calls in order, one per hop, then answers. Each call may name the last proposal id it was given. */
const scripted = (calls: readonly Call[], reply: string): CallModel => {
  let at = 0;
  let last: string | undefined;
  return async (req) => {
    for (const item of (req as unknown as { input?: unknown[] }).input ?? []) {
      const o = item as { type?: string; output?: string };
      if (o.type !== 'function_call_output' || typeof o.output !== 'string') continue;
      const id = (JSON.parse(o.output) as { proposal_id?: unknown }).proposal_id;
      if (typeof id === 'string') last = id;
    }
    const c = calls[at];
    at += 1;
    if (c === undefined) return { output: [{ type: 'message', content: [{ type: 'output_text', text: reply }] }] } as never;
    return { output: [{ type: 'function_call', name: c.name, arguments: JSON.stringify(c.args(last)), call_id: `call_${at}` }] } as never;
  };
};
const turn = (w: ReturnType<typeof world>, message: string, calls: readonly Call[], reply = 'Done.') =>
  runAgentTurn({ instructions: 'i', message, history: [], ctx: { ...ctx, user_text: message, user_turn_text: message }, maxHops: 6, maxOutputTokens: 100 } as never, w.caps, scripted(calls, reply));

const A16 = 'Get on and update it to very strong. And the potential churn increase';
const LINK: Call = { name: 'propose_link_strength', args: () => ({ from_label: RISK, to_label: 'MRR', strength: 'very strong', rationale: A16 }) };
const WITHDRAW_LAST: Call = { name: 'withdraw_proposal', args: (id) => ({ proposal_id: id }) };

describe('⛔ withdraw_proposal: a change the Agent disowns this turn is never offered', () => {
  it('the tool is offered in full mode and withheld in the read-only preview', () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toContain('withdraw_proposal');
    expect(toolsFor('preview').map((t) => t.name)).not.toContain('withdraw_proposal');
  });

  it('⭐ RED (served A16 shape): propose, then withdraw, then reply → NO approve button, nothing left awaiting approval', async () => {
    const w = world();
    const r = await turn(w, A16, [LINK, WITHDRAW_LAST], 'I have not changed that link: I proposed the wrong one and withdrew it.');
    expect(r.tool_calls.map((c) => [c.name, c.ok, c.refusal ?? null])).toEqual([['propose_link_strength', true, null], ['withdraw_proposal', true, null]]);
    expect(approvalChipsFor(r.tool_calls)).toEqual([]);
    expect(proposalsAwaitingApproval(r.tool_calls).size).toBe(0);
    // Not stored, so not carried to the next turn and not listed as awaiting the user's yes.
    expect(w.proposals.outstanding(SCENARIO, null)).toEqual([]);
  });

  it('CONTROL: the same proposal NOT withdrawn keeps its approve button and stays awaiting approval', async () => {
    const w = world();
    const r = await turn(w, A16, [LINK], 'Shall I record it?');
    const id = r.tool_calls[0]!.proposal_id!;
    expect(approvalChipsFor(r.tool_calls).map((c) => c.id)).toContain(`agent-approve-proposal:${id}`);
    expect(w.proposals.outstanding(SCENARIO, null).map((p) => p.proposal_id)).toEqual([id]);
  });

  it('RED: a withdrawn change does not block the corrected one — propose, withdraw, propose again → the NEW one is offered', async () => {
    const w = world();
    const said = 'Update it to very strong. Actually no, strong is enough.';
    const r = await turn(w, said, [LINK, WITHDRAW_LAST, { name: 'propose_link_strength', args: () => ({ from_label: RISK, to_label: 'MRR', strength: 'strong', rationale: said }) }]);
    expect(r.tool_calls.map((c) => [c.name, c.ok, c.refusal ?? null])).toEqual([
      ['propose_link_strength', true, null], ['withdraw_proposal', true, null], ['propose_link_strength', true, null],
    ]);
    expect(r.tool_calls.map((c) => c.refusal)).not.toContain(ONE_CHANGE_PER_APPROVAL);
    const [first, , second] = r.tool_calls;
    expect(approvalChipsFor(r.tool_calls).map((c) => c.id)).toContain(`agent-approve-proposal:${second!.proposal_id}`);
    expect(w.proposals.outstanding(SCENARIO, null).map((p) => p.proposal_id)).toEqual([second!.proposal_id]);
    expect(first!.proposal_id).not.toBe(second!.proposal_id);
  });

  it('RED: a change an EARLIER turn showed the user is not withdrawn here — refused, and it stays awaiting their answer', async () => {
    const w = world();
    const earlier = await turn(w, A16, [LINK], 'Shall I record it?');
    const id = earlier.tool_calls[0]!.proposal_id!;
    const r = await turn(w, 'Hmm, not sure.', [{ name: 'withdraw_proposal', args: () => ({ proposal_id: id }) }]);
    expect(r.tool_calls.map((c) => [c.name, c.ok, c.refusal ?? null])).toEqual([['withdraw_proposal', false, 'not_proposed_this_turn']]);
    expect(String((r.tool_results[0] as { detail?: unknown }).detail)).toMatch(/Nothing was withdrawn/);
    expect(w.proposals.outstanding(SCENARIO, null).map((p) => p.proposal_id)).toEqual([id]);
  });

  it('RED: an id nobody proposed is refused and changes nothing', async () => {
    const w = world();
    const r = await turn(w, A16, [LINK, { name: 'withdraw_proposal', args: () => ({ proposal_id: 'f'.repeat(32) }) }]);
    expect(r.tool_calls.map((c) => [c.name, c.ok, c.refusal ?? null])).toEqual([['propose_link_strength', true, null], ['withdraw_proposal', false, 'not_proposed_this_turn']]);
    expect(approvalChipsFor(r.tool_calls).length).toBeGreaterThan(0);
    expect(w.proposals.outstanding(SCENARIO, null)).toHaveLength(1);
  });

  it('the rule itself: an ok withdraw_proposal removes exactly its own id from what awaits approval (a failed one removes nothing)', () => {
    const calls = [
      { name: 'propose_link_strength', ok: true, mutated: false, proposal_id: 'a' },
      { name: 'withdraw_proposal', ok: false, mutated: false, proposal_id: 'a' },
    ];
    expect([...proposalsAwaitingApproval(calls).keys()]).toEqual(['a']);
    expect([...proposalsAwaitingApproval([calls[0]!, { ...calls[1]!, ok: true }]).keys()]).toEqual([]);
    expect([...proposalsAwaitingApproval([calls[0]!, { ...calls[1]!, ok: true, proposal_id: 'b' }]).keys()]).toEqual(['a']);
  });
});
