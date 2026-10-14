/**
 * ⭐ MARKETING TURN 02: THE REVISED-DRAFT CARD REACHES PAUL (served witness on 00a51f7d, run
 * 2026-10-14T012658Z-marketing-post2998, turns/02.json; JUDGE-marketing-post2998-codex.md items 1 and 5). Paul typed "…a
 * conversion rate of over 15% and secure 20 new customers within the first 3 months." `propose_goal_target` prepared ONE
 * revised-draft card holding both targets. But `holds_this_target` (exact-label binding) read "new customers" as NOT on
 * ‘New customers in first 3 months’, so the note said "NOT in the revised draft" and the AI withdrew the card. The turn's
 * reused draft then returned the withdrawn id as offered: no card reached him, and nothing was saved.
 *
 * Same served inputs and real path as MA3 (`ma3-revised-draft-unit-respelling.test.ts`: the served base and the served drafter
 * text for turn 02): `propose_goal_target` → the gates → C's construction (prepare-only) → the card → `authorise_change` →
 * `/graph/register` with compare-and-set → a cold read of the stored bytes. The calls are MA3's (the served args are not captured).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { approvalChipsFor, proposalsAwaitingApproval } from '../approval-chips.js';
import { runAgentTurn, type CallModel } from '../runtime/agent-loop.js';
import { wireGoalConstraints } from '../../tools/handlers/run-analysis.js';
import { ProposalStore } from '../proposal.js';
import { constructionOperationId, type CallStructuredModel } from '../runtime/build-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

// The drafter-raw recorder writes its own table; it is a recorder, not logic, so it passes the build straight through.
vi.mock('../../drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_ctx: unknown, _brief: unknown, _op: unknown, call: unknown,
    build: (drafter: unknown) => Promise<unknown>) => build(call),
}));

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/marketing-2992-served-base-04658ebe.json', import.meta.url), 'utf8')) as {
  scenario_id: string; brief_text: string; graph_hash: string; graph: Rec; l20: { turn_id: string; message: string };
};
const RAW = readFileSync(new URL('./fixtures/marketing-2992-drafter-raw-f81dfd89.json', import.meta.url), 'utf8');
const SID = FX.scenario_id;
const L20 = FX.l20.message;

/** The in-memory store: the read route, the register route's compare-and-set and replay rules, and the committed ledger. */
function server(graph0: Rec = FX.graph) {
  let graph: Rec = structuredClone(graph0);
  const commits: string[] = [];
  const ledger = { write_turn_ids: [registrationTurnId(SID, constructionOperationId(SID, FX.brief_text))],
    user_message_turn_ids: ['brief-turn'], first_user_message: FX.brief_text.trim(), complete: true };
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SID}/graph`) {
      return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never), brief_text: FX.brief_text,
        graph_identity_hash: computeGraphIdentityHash(graph as never) } };
    }
    if (path === `/assist/v1/scenarios/${SID}/graph/register`) {
      const b = body as { graph: Rec; expected_graph_hash?: unknown; expected_graph_identity_hash?: unknown; operation_id?: string };
      const stored = GraphV3.parse(b.graph) as Rec;
      if (b.expected_graph_hash !== computeAnalysisAffectingGraphHash(graph as never)
        || b.expected_graph_identity_hash !== computeGraphIdentityHash(graph as never)!.value) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      graph = stored;
      const turn = registrationTurnId(SID, b.operation_id);
      commits.push(turn);
      ledger.write_turn_ids.push(turn);
      return { status: 200, json: { registered: true, graph_identity_hash: computeGraphIdentityHash(stored as never) } };
    }
    return { status: 404, json: {} };
  };
  return { dispatch, commits, graph: () => graph, readCommittedTurnLedger: async () => structuredClone(ledger),
    /** A turn's answer row lands (its user message), as the route commits it before the next turn's press. */
    said: (turnId: string) => { ledger.user_message_turn_ids.push(turnId); } };
}

function lane(s: ReturnType<typeof server>, raw: string = RAW) {
  let drafted = 0;
  const proposals = new ProposalStore();
  const call = (async () => { drafted += 1; return { text: raw }; }) as unknown as CallStructuredModel;
  const caps = createAgentCapabilities(s.dispatch, proposals, call, 'full', undefined, {
    readCommittedTurnLedger: s.readCommittedTurnLedger, readStatedObjections: async () => [],
  });
  return { caps, proposals, drafts: () => drafted };
}

const turn = { scenario_id: SID, authenticated_user_id: null, request_id: 'req-l20', turn_id: FX.l20.turn_id,
  user_turn_text: L20, user_text: `${FX.brief_text}\n${L20}` };
const conversion = { constraint_type: 'at_least', value: 15, unit: '%', measures: 'conversion rate', rationale: L20 };
const customers = { constraint_type: 'at_least', value: 20, unit: 'customers', measures: 'new customers', rationale: L20 };
const pressed = (proposalId: string) => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'req-approve',
  turn_id: 'approve-turn-0001', user_turn_text: '', user_text: `${FX.brief_text}\n${L20}`, typed_approval_of: proposalId });



const heldTargets = (graph: Rec) => (graph.goal_constraints as Rec[]).filter((r) => r.role === 'goal_target')
  .map((r) => [r.node_id, r.operator_as_stated ?? r.operator, r.value, r.unit]);
const BOTH = [['conversion_rate', '>', 15, '%'], ['new_customers_in_first_3_months', '>=', 20, 'customers']];
// The AIE's exact texts (packet 281e8b3d): the 'unknown' note and the residual for a figure no card target carries.
const UNKNOWN_NOTE = /The requested target could not be verified against the card’s complete meaning\. Do not say it is included or excluded\./;
const NO_TUPLE = (figure: string) => `The host did not find a matching target entry for ${figure} in this card. Do not claim that the requested target is absent`;
const targetRows = (graph: Rec) => (graph.goal_constraints as Rec[]).filter((r) => r.role === 'goal_target');
/** A scripted model: each call in order, each withdrawal naming the last proposal id a tool returned (Codex CHECK-3020 probe). */
type Call = { name: string; args: (last: string | undefined) => Record<string, unknown> };
const scripted = (calls: Call[]): CallModel => {
  let at = 0; let last: string | undefined;
  return (async (req: Rec) => {
    for (const item of req.input ?? []) {
      if (item.type === 'function_call_output') { const id = JSON.parse(item.output).proposal_id; if (typeof id === 'string') last = id; }
    }
    const c = calls[at++];
    return c ? { output: [{ type: 'function_call', name: c.name, arguments: JSON.stringify(c.args(last)), call_id: `wire_${at}` }] }
      : { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Check the revised draft.' }] }] };
  }) as unknown as CallModel;
};

describe('marketing turn 02: an unverifiable card target is unknown, never "not in it", and the card reaches the user', () => {
  it('⭐ RED→GREEN: both target calls → ONE card awaiting approval (customers UNKNOWN, never "NOT in") → approve → the cold read holds both', async () => {
    const s = server();
    const { caps } = lane(s);
    const a = await caps.proposeGoalTarget!(turn as never, conversion as never) as Rec;
    const b = await caps.proposeGoalTarget!(turn as never, customers as never) as Rec;
    expect(b.proposal_id).toBe(a.proposal_id);
    expect([a.revised_draft?.holds_this_target, b.revised_draft?.holds_this_target]).toEqual([true, 'unknown']);
    expect(String(b.note)).toMatch(UNKNOWN_NOTE);
    expect(String(b.note)).not.toMatch(/NOT in the revised draft/);
    expect(String(a.public_label)).toContain('‘New customers in first 3 months’ at least 20 customers');
    // The two calls' OWN results, as the loop records them (Codex CHECK-3020: never a fabricated summary).
    expect([...proposalsAwaitingApproval([a, b].map((r) => ({ name: 'propose_goal_target', ok: r.ok === true, mutated: r.mutated === true,
      proposal_id: String(r.proposal_id) }))).keys()]).toEqual([a.proposal_id]);
    s.said(FX.l20.turn_id);
    const applied = await caps.authoriseChange!(pressed(String(a.proposal_id)) as never, { proposal_id: a.proposal_id } as never) as Rec;
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, mutated: true });
    expect(heldTargets(structuredClone(s.graph()))).toEqual(expect.arrayContaining(BOTH));
    // ⭐ #3020 r2 (DL (a)): approving the drafter's reading of the goal is not authorship: both targets are stored `inferred`,
    // never `explicit`. ⛔ EXPECTATION CHANGED (old: the drafter's `explicit` was stored as the user's).
    expect(targetRows(s.graph()).map((r) => [r.node_id, r.provenance])).toEqual(expect.arrayContaining([
      ['conversion_rate', 'inferred'], ['new_customers_in_first_3_months', 'inferred']]));
    // The AND goal still holds BOTH targets, and the Run receives them exactly as before: only `provenance` differs, which
    // neither PLoT nor ISL computes on (PR body: their staging reads, with contrasts).
    const wire = (rows: Rec[]) => (wireGoalConstraints(rows) as Rec[]).map(({ provenance: _p, ...rest }) => rest);
    expect(wire(targetRows(s.graph()))).toEqual(wire(targetRows(s.graph()).map((r) => ({ ...r, provenance: 'explicit' }))));
    expect(targetRows(s.graph())).toHaveLength(2);
  });

  it('⭐ RED→GREEN: a card withdrawn this turn is re-issued under a FRESH id, never returned dead (the served propose → withdraw → propose)', async () => {
    const s = server();
    const { caps, proposals } = lane(s);
    const a = await caps.proposeGoalTarget!(turn as never, customers as never) as Rec;
    expect(await caps.withdrawProposal!(turn as never, { proposal_id: a.proposal_id } as never)).toMatchObject({ ok: true, withdrawn: true });
    const again = await caps.proposeGoalTarget!(turn as never, customers as never) as Rec;
    // ⛔ EXPECTATION CHANGED (Codex CHECK-3020-45e7c1e3 item 1; old: refused `withdrawn`, leaving no card at all).
    expect(again, JSON.stringify(again)).toMatchObject({ ok: true, mutated: false, revised_draft: { holds_this_target: 'unknown' } });
    expect(again.proposal_id).not.toBe(a.proposal_id);
    expect(again.public_label).toBe(a.public_label);
    expect(proposals.get(String(a.proposal_id)), 'the withdrawn card stays withdrawn').toBeUndefined();
    expect(proposals.get(String(again.proposal_id))!.base_graph_identity_hash, 'bound to the current revision')
      .toBe(computeAnalysisAffectingGraphHash(s.graph() as never));
  });

  it('⭐ RED→GREEN (Codex CHECK-3020 wire probe): propose → withdraw → propose → withdraw → propose through the real loop ends in ONE live card; pressing it saves both targets and the period', async () => {
    const s = server();
    const { caps, proposals } = lane(s);
    const out = await runAgentTurn({ instructions: 'i', message: L20, history: [], ctx: turn, maxHops: 8, maxOutputTokens: 100 } as never, caps,
      scripted([{ name: 'propose_goal_target', args: () => conversion }, { name: 'withdraw_proposal', args: (id) => ({ proposal_id: id }) },
        { name: 'propose_goal_target', args: () => customers }, { name: 'withdraw_proposal', args: (id) => ({ proposal_id: id }) },
        { name: 'propose_goal_target', args: () => customers }]));
    expect(out.tool_calls.map((c) => [c.name, c.ok])).toEqual([['propose_goal_target', true], ['withdraw_proposal', true],
      ['propose_goal_target', true], ['withdraw_proposal', true], ['propose_goal_target', true]]);
    const live = [...proposalsAwaitingApproval(out.tool_calls).keys()];
    expect(live).toHaveLength(1);
    expect(live[0]).toBe(out.tool_calls[4]!.proposal_id);
    expect(new Set(out.tool_calls.filter((c) => c.name === 'propose_goal_target').map((c) => c.proposal_id)).size, 'three ids').toBe(3);
    expect(proposals.outstanding(SID, null).map((p) => p.proposal_id), 'ONE stored card').toEqual(live);
    expect(approvalChipsFor(out.tool_calls).map((c) => c.id)).toContain(`agent-approve-proposal:${live[0]}`);
    s.said(FX.l20.turn_id);
    const applied = await caps.authoriseChange!(pressed(live[0]!) as never, { proposal_id: live[0] } as never) as Rec;
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, mutated: true });
    const cold = (await s.dispatch(`/assist/v1/scenarios/${SID}/graph`, {})).json.graph as Rec;
    expect(heldTargets(cold)).toEqual(expect.arrayContaining(BOTH));
    // The period Paul gave ("within the first 3 months") is read back with the targets: on the goal, as stated.
    expect((cold.nodes as Rec[]).find((n) => n.kind === 'goal')).toMatchObject({ goal_deadline_as_stated: '3 months' });
    expect(s.commits, 'one write').toHaveLength(1);
  });

  it('a card gone from the store WITHOUT a withdrawal is this turn’s own preparation: offered again, same id', async () => {
    const { caps, proposals } = lane(server());
    const a = await caps.proposeGoalTarget!(turn as never, conversion as never) as Rec;
    proposals.discard(String(a.proposal_id));
    const again = await caps.proposeGoalTarget!(turn as never, conversion as never) as Rec;
    expect(again).toMatchObject({ ok: true, proposal_id: a.proposal_id, revised_draft: { holds_this_target: true } });
    expect(proposals.get(String(a.proposal_id))).toBeDefined();
  });

  it('NEGATIVE: a figure no card target carries stays NOT held (25 customers)', async () => {
    const { caps } = lane(server());
    const b = await caps.proposeGoalTarget!({ ...turn, user_turn_text: L20.replace('20 new', '25 new') } as never,
      { ...customers, value: 25 } as never) as Rec;
    // Codex CHECK-3020: the specific branch is required (the card is offered; no card target carries 25 customers).
    expect(b, JSON.stringify(b)).toMatchObject({ ok: true, revised_draft: { holds_this_target: false } });
    expect(String(b.note)).toContain(NO_TUPLE('25 customers'));
    expect(String(b.note)).not.toMatch(/NOT in the revised draft/);
  });

  it('NEGATIVE: the card’s same-figure target on ANOTHER quantity is never "held" (relabelled ‘Partner sign-ups’): unknown', async () => {
    const s = server();
    const { caps } = lane(s, RAW.split('New customers in first 3 months').join('Partner sign-ups'));
    const b = await caps.proposeGoalTarget!(turn as never, customers as never) as Rec;
    expect(b, JSON.stringify(b)).toMatchObject({ ok: true, revised_draft: { holds_this_target: 'unknown' } });
    // ⭐ #3020 r2 (Codex CHECK-3020 item 2): approved, Paul's "20 new customers" is NEVER stored as the user's own target on
    // another entity: `inferred`, with his typed goal kept as the source on the operation.
    s.said(FX.l20.turn_id);
    expect(await caps.authoriseChange!(pressed(String(b.proposal_id)) as never, { proposal_id: b.proposal_id } as never)).toMatchObject({ ok: true, mutated: true });
    const row = targetRows(s.graph()).find((r) => r.node_id === 'partner_sign_ups');
    expect(row, JSON.stringify(targetRows(s.graph()))).toBeDefined();
    expect(row!.provenance).toBe('inferred');
    // The rows the earlier draft held keep their own origin (carried limits are never re-stamped).
    const before = new Map((FX.graph.goal_constraints as Rec[]).filter((r) => r.role !== 'goal_target').map((r) => [r.constraint_id, r.provenance]));
    for (const r of (s.graph().goal_constraints as Rec[]).filter((x) => before.has(x.constraint_id))) expect(r.provenance, r.constraint_id).toBe(before.get(r.constraint_id));
  });
});
