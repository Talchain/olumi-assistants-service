/**
 * ⭐ SLICE C1 — THE STATE THE SERVER HOLDS IS GIVEN, NOT FETCHED; A SUPERSEDED SNAPSHOT IS NOT KEPT.
 *
 * Measured on a served replay of Paul's own transcript (08bf9a1f, cee-staging 15e332b, 27 Sep): every ordinary
 * turn made TWO serial model calls, the first only to call `get_canonical_state` (~3 s), and every result stayed
 * in the history for 24 turns — input 7.4k tokens at turn 0, 62.7k by turn 19, ~55k of it old copies of the model.
 *
 * The loop already withheld the read tool for a fresh server packet, but never put the packet's state INTO the
 * request: with a packet the model would have had neither the tool nor the state. These rows pin that the two
 * move together, that the given state never enters the history, and that superseded snapshots are pruned.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runAgentTurn } from '../runtime/agent-loop.js';
import { issueContextPacket } from '../runtime/request-assembly.js';
import * as historyStore from '../history-store.js';

const SCENARIO = '11111111-1111-1111-1111-111111111111';
const USER = 'user-a';
const REV = 'b'.repeat(64);
const SECRET = 'server-secret';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: USER, request_id: 'req-1' };
const caps = {} as never;
const base = { ctx, history: [], message: 'What is influencing MRR?', instructions: 'be precise', maxOutputTokens: 256 };
const STATE = { ok: true, graph_revision: REV, entities: [{ id: 'monthly_churn', label: 'Monthly churn', kind: 'factor', value: 0.03 }] };
const expectation = { scenario_id: SCENARIO, authenticated_user_id: USER, graph_revision: REV, current_turn: 0, binding_secret: SECRET };
const packet = (revision = REV) =>
  issueContextPacket({ scenario_id: SCENARIO, authenticated_user_id: USER, graph_revision: revision, captured_at_turn: 0, state: STATE }, SECRET);

function captureModel() {
  const seen: { tools?: readonly unknown[]; input?: readonly unknown[] }[] = [];
  const callModel = vi.fn(async (req: { tools?: readonly unknown[]; input?: readonly unknown[] }) => {
    seen.push({ tools: req.tools, input: [...(req.input ?? [])] });
    return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Churn and new subscribers.' }] }] } as never;
  });
  return { seen, callModel: callModel as never };
}
const toolNames = (req: { tools?: readonly unknown[] }) => (req.tools ?? []).map((t) => (t as { name: string }).name);
const stateItems = (items: readonly unknown[] | undefined) => (items ?? []).filter((i) => {
  const c = (i as { content?: { text?: unknown }[] }).content;
  return Array.isArray(c) && c.some((x) => typeof x?.text === 'string' && /CURRENT MODEL STATE/.test(x.text));
});

describe('C1 — the turn state is given, not fetched', () => {
  it('RED: a fresh server packet → the request CARRIES the state (the entity ids) and does not offer get_canonical_state', async () => {
    const { seen, callModel } = captureModel();
    await runAgentTurn({ ...base, mode: 'full', canonicalContext: { packet: packet(), expectation } }, caps, callModel);
    expect(toolNames(seen[0]!)).not.toContain('get_canonical_state');
    const given = stateItems(seen[0]!.input);
    expect(given, JSON.stringify(seen[0]!.input)).toHaveLength(1);
    expect(JSON.stringify(given[0])).toContain('monthly_churn');
    // Given before the user's message, so the message is still the last thing the model reads.
    const input = seen[0]!.input!;
    expect(input.indexOf(given[0]!)).toBe(input.length - 2);
  });

  it('the given state never enters the history the turn hands on', async () => {
    const { callModel } = captureModel();
    const r = await runAgentTurn({ ...base, mode: 'full', canonicalContext: { packet: packet(), expectation } }, caps, callModel);
    expect(stateItems(r.items)).toEqual([]);
    expect(r.items.some((i) => (i as { role?: unknown }).role === 'user')).toBe(true);
  });

  it('CONTRAST: a stale packet (the revision moved) → the tool is offered and NO state is given — never one without the other', async () => {
    const { seen, callModel } = captureModel();
    await runAgentTurn({ ...base, mode: 'full', canonicalContext: { packet: packet('c'.repeat(64)), expectation } }, caps, callModel);
    expect(toolNames(seen[0]!)).toContain('get_canonical_state');
    expect(stateItems(seen[0]!.input)).toEqual([]);
  });

  it('CONTRAST: no packet at all → exactly as before (tool offered, nothing given)', async () => {
    const { seen, callModel } = captureModel();
    await runAgentTurn({ ...base, mode: 'full' }, caps, callModel);
    expect(toolNames(seen[0]!)).toContain('get_canonical_state');
    expect(stateItems(seen[0]!.input)).toEqual([]);
  });
});

/**
 * ⛔ THE GIVEN STATE IS THE MODEL AS THE TURN BEGAN — A LATER TOOL RESULT IN THE SAME TURN SUPERSEDES IT (C1 follow-up,
 * raised in the CEE #2112 review, 27 Sep).
 *
 * The state item stays in the input for EVERY hop of the turn (moving or removing it mid-turn would change the request
 * prefix and defeat prompt caching), while `get_canonical_state` stays withheld. On a first brief #2112 gives the EMPTY
 * model (`{empty:true, entities:[]}`); hop 1 builds it, hop 2 still reads "Describe the model from it" above an empty
 * model — so the Agent could tell the user "the model is empty" straight after building it. The fix is wording only:
 * the item says it is the START of the turn, and that a later tool result covering entities, a graph_revision, a
 * change or readiness is newer and supersedes it.
 */
describe('C1 follow-up — the given state is the turn’s START; a tool result later in the turn supersedes it', () => {
  const EMPTY_STATE = { ok: true, graph_revision: REV, empty: true, entities: [] };
  const emptyPacket = () =>
    issueContextPacket({ scenario_id: SCENARIO, authenticated_user_id: USER, graph_revision: REV, captured_at_turn: 0, state: EMPTY_STATE }, SECRET);
  const BUILT = { ok: true, mutated: true, graph_revision: 'c'.repeat(64), entities: [{ id: 'goal_x', label: 'Delivery reliability', kind: 'goal', value: null }] };
  const textOfItem = (item: unknown): string =>
    ((item as { content?: { text?: unknown }[] }).content ?? []).map((c) => c?.text).find((t): t is string => typeof t === 'string') ?? '';

  /** Hop 1 builds the model from the brief; hop 2 answers. Every request is captured as sent. */
  function scriptedBuildThenAnswer() {
    const seen: { tools?: readonly unknown[]; input?: readonly unknown[] }[] = [];
    const callModel = vi.fn(async (req: { tools?: readonly unknown[]; input?: readonly unknown[] }) => {
      seen.push({ tools: req.tools, input: [...(req.input ?? [])] });
      return (seen.length === 1
        ? { output: [{ type: 'function_call', name: 'build_model_from_brief', arguments: '{"brief":"Hire a tech lead or two developers?"}', call_id: 'c1' }] }
        : { output: [{ type: 'message', content: [{ type: 'output_text', text: 'I have built the model around delivery reliability.' }] }] }) as never;
    });
    const buildModelFromBrief = vi.fn(async () => BUILT);
    return { seen, callModel: callModel as never, caps: { buildModelFromBrief } as never, buildModelFromBrief };
  }

  it('RED: an empty model built in hop 1 → hop 2 still carries ONE unchanged state item (caching kept), it says a later result supersedes it, and the build output follows it', async () => {
    const { seen, callModel, caps, buildModelFromBrief } = scriptedBuildThenAnswer();
    const r = await runAgentTurn(
      { ...base, message: 'Should we hire a tech lead or two developers?', mode: 'full', canonicalContext: { packet: emptyPacket(), expectation } },
      caps, callModel,
    );
    // Controls: the turn really took two hops through the build, on a turn that was GIVEN the empty model.
    expect(buildModelFromBrief, 'control: the build tool was dispatched').toHaveBeenCalledTimes(1);
    expect(seen, 'control: two model calls').toHaveLength(2);
    expect(r.stopped_reason).toBe('answered');
    expect(toolNames(seen[0]!), 'control: the state was given, not offered as a tool').not.toContain('get_canonical_state');
    expect(JSON.stringify(stateItems(seen[0]!.input)), 'control: hop 1 was given the EMPTY model').toContain('\\"empty\\":true');

    const hop2 = seen[1]!.input!;
    const given = stateItems(hop2);
    expect(given, 'exactly one state item on hop 2').toHaveLength(1);
    // Caching kept: hop 2's request opens with hop 1's input, byte for byte — the item was neither moved nor removed.
    expect(JSON.stringify(hop2.slice(0, seen[0]!.input!.length))).toBe(JSON.stringify(seen[0]!.input));

    const text = textOfItem(given[0]);
    expect(text.startsWith('CURRENT MODEL STATE'), 'the item still opens with its marker').toBe(true);
    const wording = text.slice(0, text.indexOf('{'));
    expect(wording, 'says it is the model as the turn BEGAN').toMatch(/start of this turn/i);
    expect(wording, 'says a later tool result supersedes it').toContain('supersedes');
    expect(wording, 'says to describe the model from the latest').toContain('from the latest');
    for (const carrier of ['entities', 'graph_revision', 'change', 'readiness']) {
      expect(wording, `names what a later result can carry: ${carrier}`).toContain(carrier);
    }
    expect(wording, 'the old unconditional instruction is gone').not.toContain('Describe the model from it');

    // The build's output — the NEW model — sits AFTER the state item, so "the latest" is unambiguous.
    const buildOutput = hop2.findIndex((i) => (i as { type?: string; call_id?: string }).type === 'function_call_output' && (i as { call_id?: string }).call_id === 'c1');
    expect(buildOutput, 'the build output is in the hop-2 input').toBeGreaterThanOrEqual(0);
    expect(String((hop2[buildOutput] as { output?: unknown }).output)).toContain('goal_x');
    expect(buildOutput).toBeGreaterThan(hop2.indexOf(given[0]!));

    // And the turn still hands on no state item.
    expect(stateItems(r.items)).toEqual([]);
  });
});

describe('C1 — a superseded snapshot is not kept in the history', () => {
  const call = (id: string, name: string) => ({ type: 'function_call', call_id: id, name, arguments: '{}' });
  const out = (id: string, output: string) => ({ type: 'function_call_output', call_id: id, output });
  const BIG = 'x'.repeat(10_000);
  const items = [
    { role: 'user', content: [{ type: 'input_text', text: 'build it' }] },
    call('c1', 'get_canonical_state'), out('c1', BIG),
    call('c2', 'build_model_from_brief'), out('c2', BIG),
    { role: 'user', content: [{ type: 'input_text', text: 'run' }] },
    call('c3', 'run_analysis'), out('c3', `run-1${BIG}`),
    call('c4', 'propose_link_strength'), out('c4', '{"ok":true,"proposal_id":"prop_1"}'),
    { role: 'user', content: [{ type: 'input_text', text: 'run again' }] },
    call('c5', 'run_analysis'), out('c5', `run-2${BIG}`),
  ];

  it('RED: every state read and build result is stubbed, every run but the LATEST is stubbed; proposals are kept', () => {
    const prune = (historyStore as { pruneSupersededToolOutputs?: (i: readonly unknown[]) => unknown[] }).pruneSupersededToolOutputs;
    expect(prune, 'pruneSupersededToolOutputs is exported').toBeTypeOf('function');
    const pruned = prune!(items);
    const outputOf = (id: string) => (pruned.find((i) => (i as { type?: string; call_id?: string }).type === 'function_call_output' && (i as { call_id?: string }).call_id === id) as { output: string }).output;
    for (const id of ['c1', 'c2', 'c3']) expect(outputOf(id), id).toMatch(/superseded/);
    expect(outputOf('c5').startsWith('run-2')).toBe(true);
    expect(outputOf('c4')).toBe('{"ok":true,"proposal_id":"prop_1"}');
    expect(JSON.stringify(pruned).length).toBeLessThan(JSON.stringify(items).length / 2);
  });

  it('every output stays paired with its call (the next request stays valid input)', () => {
    const prune = (historyStore as { pruneSupersededToolOutputs?: (i: readonly unknown[]) => unknown[] }).pruneSupersededToolOutputs!;
    const pruned = prune(items);
    expect(pruned).toHaveLength(items.length);
    const callIds = new Set(pruned.filter((i) => (i as { type?: string }).type === 'function_call').map((i) => (i as { call_id: string }).call_id));
    for (const o of pruned.filter((i) => (i as { type?: string }).type === 'function_call_output')) expect(callIds.has((o as { call_id: string }).call_id)).toBe(true);
  });
});

describe('C1 follow-up — the route\u2019s own system prompt says the same as the given item', () => {
  it('RED: the Agent instructions line about CURRENT MODEL STATE says a later tool result in the turn supersedes it', () => {
    // AGENT_INSTRUCTIONS is module-private; the line is read from the route source, as the estate's scanner tests do.
    const src = readFileSync(fileURLToPath(new URL('../../../routes/agent-v1-turn.ts', import.meta.url)), 'utf8');
    const lines = src.split('\n').filter((l) => l.includes('Each turn opens with a CURRENT MODEL STATE input'));
    expect(lines, 'control: exactly one instructions line names the given state').toHaveLength(1);
    expect(lines[0]).toContain('supersedes it');
    expect(lines[0]).toContain('describe the model from the latest');
  });
});
