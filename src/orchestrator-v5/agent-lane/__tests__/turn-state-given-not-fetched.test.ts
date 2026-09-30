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
import { journeyItems, journeyTurns, RUN_RESULT, RUN_RESULT_PERMITTED, SERVED_READBACK } from './fixtures/a-journey-history.js';

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
    // AIQ #2118 F1: only an APPLIED change supersedes it; an unapproved proposal's preview never does.
    expect(wording, 'scoped to applied changes').toContain('APPLIED a change');
    expect(wording, 'a proposal preview never supersedes it').toContain('readiness_if_approved describes the model only IF the user approves, and never supersedes');
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

  it('every state read and build result is stubbed, every run but the LATEST is stubbed; proposals are kept', () => {
    const prune = (historyStore as { pruneSupersededToolOutputs?: (i: readonly unknown[]) => unknown[] }).pruneSupersededToolOutputs;
    expect(prune, 'pruneSupersededToolOutputs is exported').toBeTypeOf('function');
    const pruned = prune!(items);
    const outputOf = (id: string) => (pruned.find((i) => (i as { type?: string; call_id?: string }).type === 'function_call_output' && (i as { call_id?: string }).call_id === id) as { output: string }).output;
    for (const id of ['c1', 'c2', 'c3']) expect(outputOf(id), id).toMatch(/superseded/);
    expect(JSON.parse(outputOf('c5'))).toEqual({ note: historyStore.EARLIER_RUN_ATTEMPT_NOTE });
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
    expect(lines[0]).toContain('APPLIED a change');
    expect(lines[0]).toContain('readiness_if_approved describes the model only IF the user approves, and never supersedes');
  });
});

/**
 * ⭐ AN APPLIED PROPOSAL AND AN EARLIER APPROVAL ARE NOT KEPT EITHER (DL scoreboard PJ-C1, token half). Served run
 * `pj-20260927T181846Z` (CEE 523e18d, journey A): the first model call of each turn read 15.4k → 18.3k → 20.3k →
 * 21.3k → 22.8k input tokens across four propose → approve cycles, against a 15,000 cap. Every proposal's output
 * (230–990 tokens each, from the served per-call deltas) stayed for 24 turns after the change it described was applied
 * and was in the state given with each turn.
 *
 * ⛔ THE CHIP APPROVAL LEAVES NO RECORD IN THE HISTORY. All four approvals in journey A were chip clicks (`hops: 0`),
 * and the fast path appends only the chip's words and Olumi's status (agent-v1-turn.ts :1696–1751): no call, no
 * proposal id. So what a turn applied is ALSO taken from its own approval results (the route's `tool_results`) —
 * the row `chip-approval-prunes-its-proposal.test.ts` drives it through the route.
 */
describe('an applied proposal and an earlier approval are not kept in the history', () => {
  type Prune = (items: readonly unknown[], approvalsThisTurn?: readonly unknown[]) => unknown[];
  const prune = (items: readonly unknown[], approvals?: readonly unknown[]) =>
    (historyStore as unknown as { pruneSupersededToolOutputs: Prune }).pruneSupersededToolOutputs(items, approvals);
  const call = (id: string, name: string, args: unknown) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });
  const out = (id: string, result: unknown) => ({ type: 'function_call_output', call_id: id, output: JSON.stringify(result) });
  const user = (text: string) => ({ role: 'user', content: [{ type: 'input_text', text }] });
  const outputOf = (items: readonly unknown[], id: string) =>
    (items.find((i) => (i as { type?: string }).type === 'function_call_output' && (i as { call_id?: string }).call_id === id) as { output: string }).output;
  const applied = (proposal_id: string) => ({ ok: true, mutated: true, applied: true, proposal_id, receipts: [{ version: 3 }], follow_up: `Saved ${proposal_id} as version 3.` });
  const OPTION = { ok: true, mutated: false, proposal_id: 'prop_1', public_label: 'Add "Raise Pro to £59"', option: { label: 'Raise Pro to £59' }, note: 'Nothing has changed yet.' };
  const ASSUMPTIONS = { ok: true, mutated: false, proposal_id: 'prop_0', values: [{ factor: 'Monthly churn rate', value: 0.03 }], note: 'Nothing has changed yet.' };
  const LINK = { ok: true, mutated: false, proposal_id: 'prop_2', link: { from: 'Price sensitivity', to: 'Monthly churn rate', becomes: { band: 'very strong' } }, note: 'Nothing has changed yet.' };
  // prop_0 approved first, then prop_1 approved, then prop_2 proposed and still awaiting the user's yes.
  const items = [
    user('use those starting values'), call('a0', 'propose_assumptions', { values: [] }), out('a0', ASSUMPTIONS),
    user('yes'), call('z0', 'authorise_change', { proposal_id: 'prop_0' }), out('z0', applied('prop_0')),
    user('add the £59 option'), call('p1', 'propose_new_option', { options: [] }), out('p1', OPTION),
    user('yes'), call('z1', 'authorise_change', { proposal_id: 'prop_1' }), out('z1', applied('prop_1')),
    user('price sensitivity is very high'), call('p2', 'propose_link_strength', { strength: 'very strong' }), out('p2', LINK),
  ];

  it('RED: an applied proposal’s output is stubbed, a PENDING one is kept verbatim, and only the LATEST approval’s output is kept', () => {
    const pruned = prune(items);
    expect(outputOf(pruned, 'p1'), 'prop_1 was applied (z1)').toMatch(/superseded/);
    expect(outputOf(pruned, 'p1')).not.toContain('Raise Pro to £59');
    expect(outputOf(pruned, 'a0'), 'prop_0 was applied (z0)').toMatch(/superseded/);
    expect(outputOf(pruned, 'p2'), 'prop_2 awaits a yes: byte-identical').toBe(JSON.stringify(LINK));
    expect(outputOf(pruned, 'z1'), 'the latest approval is what "what did that change?" is about').toBe(JSON.stringify(applied('prop_1')));
    expect(outputOf(pruned, 'z0'), 'an earlier approval').toMatch(/superseded/);
    expect(outputOf(pruned, 'z0')).not.toContain('prop_0');
    // The calls themselves are untouched: the Agent still sees what it proposed and what it authorised.
    expect(pruned.filter((i) => (i as { type?: string }).type === 'function_call')).toEqual(items.filter((i) => (i as { type?: string }).type === 'function_call'));
  });

  it('RED: the chip path — no authorise_change in the history — resolves its proposal from the turn’s own approval result', () => {
    const chipTurn = [user('add the £59 option'), call('p1', 'propose_new_option', { options: [] }), out('p1', OPTION),
      user('Yes, add that option.'), { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Saved as version 3.' }] }];
    expect(outputOf(prune(chipTurn, [applied('prop_1')]), 'p1')).toMatch(/superseded/);
    // CONTRAST: the same history with no approval result — nothing in it says prop_1 was applied, so it is kept.
    expect(outputOf(prune(chipTurn), 'p1')).toBe(JSON.stringify(OPTION));
  });

  it('CONTROL (adversarial review F1): a SAME-ID proposal made AFTER its own applied approval is pending — kept verbatim', () => {
    // `gmh_` handles are hash(scenario, node key): add option X, the user deletes it on the canvas, asks again → the
    // Agent re-proposes with the SAME handle. Only an approval LATER than the output may stub it.
    const again = { ...OPTION, note: 'Re-proposed: nothing has changed yet.' };
    const hist = [
      user('add the £59 option'), call('p1', 'propose_new_option', { options: [] }), out('p1', OPTION),
      user('yes'), call('z1', 'authorise_change', { proposal_id: 'prop_1' }), out('z1', applied('prop_1')),
      user('I deleted it — add it again'), call('p3', 'propose_new_option', { options: [] }), out('p3', again),
    ];
    const pruned = prune(hist);
    expect(outputOf(pruned, 'p1'), 'the first proposal was applied by z1').toMatch(/superseded/);
    expect(outputOf(pruned, 'p3'), 'the re-proposal awaits a yes: byte-identical').toBe(JSON.stringify(again));
  });

  it('CONTROL: a proposal still awaiting a yes is byte-identical — never proposed, refused, or only part-applied', () => {
    const refused = { ok: false, mutated: false, applied: false, refusal: 'superseded', proposal_id: 'prop_1' };
    // ProposalStore.markApplied only when every level landed (agent-capabilities.ts :3139, :3704): part-landed stays outstanding.
    const partial = { ok: true, mutated: true, applied: true, proposal_id: 'prop_1', recorded_count: 1, requested_count: 2 };
    for (const [label, history] of [
      ['no approval at all', [user('add it'), call('p1', 'propose_new_option', {}), out('p1', OPTION)]],
      ['the approval was refused', [user('add it'), call('p1', 'propose_new_option', {}), out('p1', OPTION), user('yes'), call('z1', 'authorise_change', { proposal_id: 'prop_1' }), out('z1', refused)]],
      ['the approval landed only in part', [user('add it'), call('p1', 'propose_new_option', {}), out('p1', OPTION), user('yes'), call('z1', 'authorise_change', { proposal_id: 'prop_1' }), out('z1', partial)]],
      ['another proposal was applied', [user('add it'), call('p1', 'propose_new_option', {}), out('p1', OPTION), user('yes'), call('z1', 'authorise_change', { proposal_id: 'prop_9' }), out('z1', applied('prop_9'))]],
    ] as const) {
      expect(outputOf(prune(history), 'p1'), label).toBe(JSON.stringify(OPTION));
      expect(outputOf(prune(history, [refused, partial]), 'p1'), `${label} (+ unapplied results this turn)`).toBe(JSON.stringify(OPTION));
    }
  });

  /**
   * MEASURED on this fixture (the served A02 run, 14,865 bytes, is the latest and kept): typed approvals 30,899 → 22,893
   * bytes (−25.9%, ≈2.0k tokens at ~4 bytes a token), chip approvals 28,432 → 23,160 (−18.5%, ≈1.3k). ⚠ The 30% first
   * aimed for is NOT reached: the kept run is half of what is left. The floors below sit just under the measurement,
   * so keeping any one applied proposal or earlier approval turns this row red.
   * The retained Run is now a neutral time marker; the next turn receives analysis facts from current canonical state.
   */
  it('SIZE: a journey-A-shaped history (served run, 3 proposals, 3 approvals) shrinks ≥60% (typed) and ≥56% (chip); every call stays paired', () => {
    const paired = (h: readonly unknown[]) => {
      const calls = h.filter((i) => (i as { type?: string }).type === 'function_call').map((i) => (i as { call_id: string }).call_id);
      const outs = h.filter((i) => (i as { type?: string }).type === 'function_call_output').map((i) => (i as { call_id: string }).call_id);
      return calls.length > 0 && JSON.stringify([...calls].sort()) === JSON.stringify([...outs].sort());
    };
    // Composer approvals: the whole history pruned at once, as the store's next `set` does.
    const composer = journeyItems('composer');
    const composerPruned = prune(composer);
    // Chip approvals: turn by turn, each approval turn pruned with its own results, as the route does.
    let chip: unknown[] = [];
    for (const t of journeyTurns('chip')) chip = prune([...chip, ...t.items], t.approvals);
    const chipRaw = journeyItems('chip');
    for (const [label, raw, pruned, floor] of [['composer', composer, composerPruned, 0.6], ['chip', chipRaw, chip, 0.56]] as const) {
      const before = JSON.stringify(raw).length;
      const after = JSON.stringify(pruned).length;
      expect(after, `${label}: ${before} → ${after} bytes`).toBeLessThanOrEqual(before * (1 - floor));
      expect(pruned, label).toHaveLength(raw.length);
      expect(paired(pruned), `${label}: every call keeps its output`).toBe(true);
      // Messages are never touched.
      expect(pruned.filter((i) => (i as { type?: string }).type !== 'function_call_output'), label)
        .toEqual(raw.filter((i) => (i as { type?: string }).type !== 'function_call_output'));
      // The latest pair stays valid, but its output carries no retained analysis facts.
      expect(JSON.parse(outputOf(pruned, 'call_run')), label).toEqual({
        note: `Earlier analysis ran at ${RUN_RESULT.run_identity.computed_at}; see the current Run in CURRENT MODEL STATE.`,
      });
    }
    // Pruning a pruned history changes nothing (the store re-prunes what it holds every turn).
    expect(prune(composerPruned)).toEqual(composerPruned);
    expect(prune(chip)).toEqual(chip);
  });
});

/**
 * Retained history records that Run happened, while CURRENT MODEL STATE supplies its facts on the next turn.
 * The marker is deliberately independent of the saved result's permission and freshness.
 */
describe('the retained Run is a neutral marker', () => {
  const prune = (items: readonly unknown[], readback?: unknown) =>
    historyStore.pruneSupersededToolOutputs(items, [], readback);
  const call = (id: string) => ({ type: 'function_call', call_id: id, name: 'run_analysis', arguments: '{}' });
  const out = (id: string, result: unknown) => ({ type: 'function_call_output', call_id: id, output: JSON.stringify(result) });
  const outputOf = (items: readonly unknown[], id: string): string =>
    (items.find((i) => (i as { type?: string; call_id?: string }).type === 'function_call_output'
      && (i as { call_id?: string }).call_id === id) as { output: string }).output;
  const afterRun = (run: unknown) => [
    { role: 'user', content: [{ type: 'input_text', text: 'Run the analysis' }] },
    call('run-1'), out('run-1', run),
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I ran the analysis.' }] },
  ];
  const markerOf = (items: readonly unknown[], id = 'run-1') => JSON.parse(outputOf(items, id)) as Record<string, unknown>;
  const datedNote = `Earlier analysis ran at ${RUN_RESULT.run_identity.computed_at}; see the current Run in CURRENT MODEL STATE.`;
  const staleReadback = {
    ...SERVED_READBACK,
    analysisState: { ...(SERVED_READBACK.analysisState as object), run_state: { kind: 'complete_stale' }, requires_rerun: true },
    analysisResult: undefined,
  };

  it('latest permitted and withheld Runs retain only the same marker, whether current, stale, or unconfirmed', () => {
    expect(RUN_RESULT.claim_permissions.leader_may_be_named).toBe(false);
    expect(RUN_RESULT_PERMITTED.claim_permissions.leader_may_be_named).toBe(true);
    for (const run of [RUN_RESULT, RUN_RESULT_PERMITTED]) {
      for (const readback of [SERVED_READBACK, staleReadback, undefined]) {
        const retained = prune(afterRun(run), readback);
        expect(markerOf(retained)).toEqual({ note: datedNote });
        expect(outputOf(retained, 'run-1')).not.toContain('win_probabilit');
        expect(outputOf(retained, 'run-1')).not.toContain('claim_permissions');
        expect(outputOf(retained, 'run-1')).not.toContain('computed_against_hash');
      }
    }
  });

  it('only a successful Run with a valid recorded timestamp gets a dated marker', () => {
    const identity = RUN_RESULT.run_identity;
    for (const attempted of [
      { ...RUN_RESULT, ran: false },
      { ...RUN_RESULT, ran: undefined },
    ]) expect(markerOf(prune(afterRun(attempted)))).toEqual({ note: historyStore.EARLIER_RUN_ATTEMPT_NOTE });
    for (const undated of [
      { ...RUN_RESULT, run_identity: undefined },
      { ...RUN_RESULT, run_identity: { ...identity, computed_at: 'not-a-time' } },
    ]) expect(markerOf(prune(afterRun(undated)))).toEqual({ note: historyStore.EARLIER_RUN_NOTE });
    expect(markerOf(prune(afterRun(RUN_RESULT)))).toEqual({ note: datedNote });
  });

  it('re-pruning an old marker strips stray facts and is idempotent', () => {
    const old = { note: datedNote, claim_permissions: RUN_RESULT_PERMITTED.claim_permissions, result: RUN_RESULT.result };
    const once = prune(afterRun(old), staleReadback);
    expect(markerOf(once)).toEqual({ note: datedNote });
    expect(prune(once, SERVED_READBACK)).toEqual(once);
    const current = prune(afterRun(RUN_RESULT_PERMITTED), SERVED_READBACK);
    expect(prune(current, staleReadback)).toEqual(current);
  });

  it('keeps each call/output pair; an earlier Run is superseded and only the latest gets the marker', () => {
    const first = afterRun(RUN_RESULT_PERMITTED);
    const history = [...first, call('run-2'), out('run-2', RUN_RESULT)];
    const retained = prune(history, SERVED_READBACK);
    expect(retained).toHaveLength(history.length);
    expect(outputOf(retained, 'run-1')).toBe(historyStore.SUPERSEDED_OUTPUT);
    expect(markerOf(retained, 'run-2')).toEqual({ note: datedNote });
    expect(retained.filter((i) => (i as { type?: string }).type !== 'function_call_output'))
      .toEqual(history.filter((i) => (i as { type?: string }).type !== 'function_call_output'));
    const calls = retained.filter((i) => (i as { type?: string }).type === 'function_call')
      .map((i) => (i as { call_id: string }).call_id);
    const outputs = retained.filter((i) => (i as { type?: string }).type === 'function_call_output')
      .map((i) => (i as { call_id: string }).call_id);
    expect(outputs).toEqual(calls);
    expect(prune(retained, staleReadback)).toEqual(retained);
  });
});
