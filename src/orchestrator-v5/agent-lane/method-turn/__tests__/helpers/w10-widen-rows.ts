import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  existingLevers, settleWidenTurn, widenGate, widenNotAdded, widenPassingArgs, widenTurnForReadback,
  WIDEN_PRESS_ID, type RunWidenTurn,
} from '../../widen-turn.js';
import { createAgentCapabilities, type InternalDispatch } from '../../../runtime/agent-capabilities.js';
import { ProposalStore } from '../../../proposal.js';
import type { AgentCapabilities, ToolResult } from '../../../runtime/agent-tools.js';
import { buildAddOptionsTransaction } from '../../../../routing/add-option-transaction.js';
import { gmHeldProposalRef } from '../../../../handlers/edit-graph-referee-gate.js';

type Args = Parameters<AgentCapabilities['proposeNewOption']>[1];
type Option = NonNullable<Args['options']>[number];
type Rec = Record<string, unknown>;
// Exact captured draft_graph: scenario 8636c040, turn 42f4f586, 7 Oct 2026.
const graph = JSON.parse(readFileSync(new URL('../fixtures/w10-scout-graph.json', import.meta.url), 'utf8')) as {
  nodes: Rec[]; edges: Rec[];
};
const turn = (): RunWidenTurn => {
  const t = widenTurnForReadback(WIDEN_PRESS_ID, { graph });
  assert.equal(t?.kind, 'run');
  return t as RunWidenTurn;
};
const level = (value: number, unit?: string) => ({ value, ...(unit === undefined ? {} : { unit }), estimate: true,
  basis: 'private basis text: never log this' });
const mix = (): Option => ({ label: 'Starter tier with smaller rise', acts_on: [
  { factor_label: 'Price change from today', direction: 'positive', level: level(5, '%') },
  { factor_label: 'Starter-tier availability', direction: 'positive', level: level(1) },
] });
const contradicting = (): Option => ({ label: 'Smaller price rise', acts_on: [
  { factor_label: 'Price change from today', direction: 'negative', level: level(5, '%') },
] });
const copy = (): Option => ({ label: 'Lift what we charge', acts_on: [mix().acts_on[0]!] });
const args = (...options: Option[]): Args => ({ options, rationale: 'private rationale text: never log this' });

/** Real capability + canonical transaction builder; only the transport's hold response is simulated.
 * This is door/transaction proof, below the real route, persistence and browser journey. */
async function propose(proposal: Args, model = turn()) {
  const snapshot = structuredClone(graph);
  const held: { operations: readonly { op: string; path: string; value?: unknown }[]; ref: string }[] = [];
  let sent = 0;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: snapshot, graph_hash: 'a'.repeat(64) } };
    assert.equal(path, '/orchestrate/v2/turn');
    sent += 1;
    const parameters = (body as { chip: { parameters: unknown } }).chip.parameters;
    const batch = buildAddOptionsTransaction(parameters, { nodes: snapshot.nodes as never, edges: snapshot.edges as never });
    assert.equal(batch.matched, true);
    if (!batch.matched) throw new Error('transaction refused');
    const first = batch.operations.find((o) => o.op === 'add_node' && (o.value as Rec)?.kind === 'option');
    assert.ok(first);
    const ref = gmHeldProposalRef('w10-scout', `node:${first.path}`);
    held.push({ ref, operations: batch.operations });
    return { status: 200, json: { suggested_actions: [{ id: ref, label: 'Approve', message: 'Yes, add the options.' }] } };
  };
  const door = createAgentCapabilities(dispatch, new ProposalStore());
  const gate = widenGate(model, proposal);
  const result: ToolResult = gate.ok
    ? widenNotAdded(await door.proposeNewOption({ scenario_id: 'w10-scout', authenticated_user_id: null,
      request_id: 'w10-probe', user_text: '' }, widenPassingArgs(gate, proposal)), gate, proposal)
    : { ok: false, mutated: false, refusal: 'widen_gate' };
  const settled = settleWidenTurn(model, { assistant_text: 'A model draft omitting all dropped options',
    tool_calls: [{ name: 'propose_new_option', ok: result.ok,
      ...(typeof result.proposal_id === 'string' ? { proposal_id: result.proposal_id } : {}) }], tool_results: [result] });
  assert.deepEqual(snapshot, graph, 'no graph writes before approval');
  return { gate, result, settled, held, sent };
}

export const w10Rows: Record<string, () => void | Promise<void>> = {
  'captured mix accepted (RED at base)': () => {
    const gate = widenGate(turn(), args(mix()));
    assert.equal(gate.ok, true);
    assert.deepEqual(gate.passing_indices, [0]);
  },
  'status quo has no moves and no changes directive': () => {
    const t = turn();
    assert.equal(t.sq, 'keep_pricing_as_is');
    assert.equal(existingLevers(t.graph, t.sq!, t.sq).size, 0);
    assert.ok(t.directive.includes('- ‘Keep pricing as is’\n'));
    assert.ok(!t.directive.includes('‘Keep pricing as is’: changes'));
  },
  'partial proposal gets ONE card with mix and dropped name (RED at base)': async () => {
    const { gate, result, settled, held, sent } = await propose(args(mix(), contradicting()));
    assert.equal(gate.ok, true);
    assert.equal(result.ok, true);
    assert.equal(settled.carded, true);
    assert.equal(sent, 1);
    assert.equal(held.length, 1);
    const options = held[0]!.operations.filter((o) => o.op === 'add_node' && (o.value as Rec)?.kind === 'option');
    assert.deepEqual(options.map((o) => (o.value as Rec).label), [mix().label]);
    assert.ok(settled.reply.includes(mix().label));
    assert.ok(settled.reply.includes(`Not in this change: ‘${contradicting().label}’`));
    assert.ok(settled.reply.includes('does not move in the direction it describes'));
    assert.ok(!settled.reply.includes('WD-S-DIRECTION'));
    assert.deepEqual((result.not_added as Rec[]).map((o) => o.option), [contradicting().label]);
  },
  'real option same-direction copy refused': () => {
    const gate = widenGate(turn(), args(copy()));
    assert.equal(gate.ok, false);
    assert.deepEqual(gate.per_option[0]!.failed, ['WD-S-DISTINCT']);
  },
  'status quo name refused': () => {
    const gate = widenGate(turn(), args({ ...mix(), label: ' KEEP pricing AS is ' }));
    assert.equal(gate.ok, false);
    assert.deepEqual(gate.per_option[0]!.failed, ['WD-NO-DUP']);
  },
  'all-fail keeps deterministic fallback, no card, no write': async () => {
    const { gate, settled, sent, held } = await propose(args(copy(), contradicting()));
    assert.equal(gate.ok, false);
    assert.equal(sent, 0);
    assert.equal(held.length, 0);
    assert.equal(settled.carded, false);
    assert.equal(settled.reply, 'What other way could you reach ‘monthly recurring revenue’? For example, a different lever, a smaller first step, or a mix of these options.');
    assert.deepEqual(settled.actions.map((a) => a.id), ['agent-talk-it-through']);
  },
  'four options refused even with a passing candidate; three kept as one card': async () => {
    const subscribers: Option = { label: 'Promote the starter tier', acts_on: [
      { factor_label: 'Starter subscribers', direction: 'positive', level: level(100, 'subscribers') },
    ] };
    const losses: Option = { label: 'Plan for customer losses', acts_on: [
      { factor_label: 'Price-driven customer losses', direction: 'positive', level: level(20, 'customers') },
    ] };
    const over = await propose(args(mix(), subscribers, losses, contradicting()));
    assert.equal(over.gate.ok, false);
    assert.equal(over.sent, 0);
    assert.ok(over.gate.per_option.every((o) => o.failed.includes('WD-COUNT')));
    const cap = await propose(args(mix(), subscribers, losses));
    assert.equal(cap.gate.ok, true);
    assert.equal(cap.sent, 1);
    assert.equal(cap.held.length, 1);
    assert.equal(cap.held[0]!.operations.filter((o) => o.op === 'add_node' && (o.value as Rec)?.kind === 'option').length, 3);
  },
  'per-option log projection contains IDs, directions, clauses and no labels': () => {
    const proposal = args(mix(), contradicting());
    const gate = widenGate(turn(), proposal);
    assert.deepEqual(gate.per_option, [
      { index: 0, factors: [
        { factor_id: 'price_change_from_today', stated_direction: 'positive', stored_direction: 'positive' },
        { factor_id: 'starter_tier_availability', stated_direction: 'positive', stored_direction: 'positive' },
      ], failed: [] },
      { index: 1, factors: [
        { factor_id: 'price_change_from_today', stated_direction: 'negative', stored_direction: 'positive' },
      ], failed: ['WD-S-DIRECTION'] },
    ]);
    const logged = JSON.stringify(gate.per_option);
    for (const secret of [mix().label, contradicting().label, ...graph.nodes.map((n) => String(n.label)),
      'private basis text', 'private rationale text']) assert.ok(!logged.includes(secret));
    const route = readFileSync(new URL('../../../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    assert.ok(route.includes('gate_options: widenGateResult?.per_option ?? []'));
  },
  'failed option before passing one cannot sink it': async () => {
    const p = args(contradicting(), mix());
    const { gate, settled, held } = await propose(p);
    assert.equal(gate.ok, true);
    assert.deepEqual(gate.passing_indices, [1]);
    assert.equal(settled.carded, true);
    assert.equal(held.length, 1);
  },
  'proposed copies and names still dropped': () => {
    const gate = widenGate(turn(), args(mix(), { ...mix(), label: 'Another starter and rise' }, mix()));
    assert.equal(gate.ok, true);
    assert.deepEqual(gate.passing_indices, [0]);
    assert.deepEqual(gate.per_option[1]!.failed, ['WD-S-DISTINCT']);
    assert.deepEqual(gate.per_option[2]!.failed, ['WD-NO-DUP', 'WD-S-DISTINCT']);
  },
  'door disclosures preserved when gate adds dropped options': () => {
    const p = args(mix(), contradicting());
    const gate = widenGate(turn(), p);
    const result = widenNotAdded({ ok: true, mutated: false,
      not_added: [{ option: 'Door twin', same_levels_as: 'Existing twin' }], not_added_note: 'Door note.' }, gate, p);
    assert.equal((result.not_added as Rec[]).length, 2);
    assert.deepEqual((result.not_added as Rec[])[0], { option: 'Door twin', same_levels_as: 'Existing twin' });
    assert.ok(String(result.not_added_note).includes('Door note.'));
  },
};
