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
   * ⭐ RE-MEASURED once the kept run became its projection (AIQ #70 5859279825; the served run is WITHHELD, and no
   * readback is given here, so it is also marked unconfirmed): typed 30,899 → 11,832 characters (−61.7%), chip
   * 28,432 → 12,099 (−57.4%). The floors move up to sit under THAT measurement: keeping the smallest applied proposal
   * (the risk, +761 characters over its stub) takes typed to −59.2% and chip to −54.8%, and the smallest earlier
   * approval (+818) takes typed to −59.1% — each red.
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
      // The run is the latest: kept, as its projection — a withheld run, so without its win shares — and still stamped.
      const keptRun = JSON.parse(outputOf(pruned, 'call_run')) as { result: { computed_against_hash?: unknown }; claim_permissions: unknown };
      expect(keptRun.result.computed_against_hash, label).toBe((RUN_RESULT.result as { computed_against_hash: string }).computed_against_hash);
      expect(keptRun.claim_permissions, `${label}: an unconfirmed earlier Run cannot grant a current leader claim`).toBeUndefined();
      expect(outputOf(pruned, 'call_run'), label).not.toContain('win_probabilit');
    }
    // Pruning a pruned history changes nothing (the store re-prunes what it holds every turn).
    expect(prune(composerPruned)).toEqual(composerPruned);
    expect(prune(chip)).toEqual(chip);
  });
});

/**
 * ⭐ THE KEPT RUN IS A PROJECTION OF THE RUN, BY ITS OWN PERMISSION (AI Quality ruling, #70 5859279825 + 5859288025;
 * R&C's pinned key set). C1 keeps the LATEST run's output, and on the served A02 run its `result` is ~11.9 KB — 94% of
 * it `enrichment` (option_comparison 2.4K, robustness 2.4K, p_win_sensitivity 1.5K, decision_brief 1.1K, factor_evppi
 * 1.1K, inference_warnings 0.9K, edge_e_values 0.8K, flip_thresholds 0.6K) — riding in every request for 24 turns.
 * Only the KEPT copy is projected: the prune runs when the turn is STORED, so the Run turn's own input is unchanged.
 *   - PERMITTED (`claim_permissions.leader_may_be_named === true`): robustness, p_win_sensitivity, factor_evppi and
 *     edge_e_values leave `result.enrichment`; the comparison itself stays.
 *   - WITHHELD (anything else: fail closed): NOTHING that re-ranks — asserted on KEYS, at every depth.
 *   - BOTH: no constraint probabilities (until B5 per_limit lands), and a run the model has moved past says so.
 */
describe('the kept run is compacted by its own permission, and marked stale once the model moves', () => {
  type Readback = { scenarioId?: string; analysisState?: unknown; analysisResult?: unknown; analysisReady?: unknown; goalCertainty?: unknown };
  type Prune = (items: readonly unknown[], approvalsThisTurn?: readonly unknown[], readback?: Readback) => unknown[];
  const prune = (items: readonly unknown[], readback?: Readback) =>
    (historyStore as unknown as { pruneSupersededToolOutputs: Prune }).pruneSupersededToolOutputs(items, [], readback);
  const call = (id: string, name: string, args: unknown) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });
  const out = (id: string, result: unknown) => ({ type: 'function_call_output', call_id: id, output: JSON.stringify(result) });
  const user = (text: string) => ({ role: 'user', content: [{ type: 'input_text', text }] });
  const outputOf = (items: readonly unknown[], id: string) =>
    (items.find((i) => (i as { type?: string }).type === 'function_call_output' && (i as { call_id?: string }).call_id === id) as { output: string }).output;
  /** A Run, Olumi's reply, and the user's next message: the history the NEXT request carries. */
  const afterRun = (run: unknown) => [
    user('Run the analysis'), call('call_run', 'run_analysis', { reason: 'the user asked to run it' }), out('call_run', run),
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The analysis cannot put any price option forward yet.' }] },
    user('What would change that?'),
  ];
  const keptRun = (items: readonly unknown[]) => JSON.parse(outputOf(items, 'call_run')) as Record<string, any>;
  /** Every KEY in a value, at any depth. */
  const keysOf = (v: unknown): string[] => Array.isArray(v) ? v.flatMap(keysOf)
    : v !== null && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : [];
  /** R&C's pinned KEY set, verbatim; `decision_sensitivity` is the one matching key AIQ keeps. */
  const RC_KEYS = /confidence|near_tie|goal_fit|separation|alternative_winner|win_probabilit|sensitivity|evpi|enrichment/i;
  /** AIQ's new ruling keeps the recorded outcome range, including its mean, while dropping ranking and chances. */
  const AIQ_KEYS = ['gap', 'probability_of_goal', 'probability_of_joint_goal', 'all_limits_hold_probability', 'conditional_winners', 'flip_thresholds', 'run_delta'];
  const reRankingKeys = (v: unknown) => keysOf(v).filter((k) => (RC_KEYS.test(k) && k !== 'decision_sensitivity') || AIQ_KEYS.includes(k));
  const namesConstraintProbability = (k: string) => /constraint/i.test(k) && /probabilit/i.test(k);
  const RAW = RUN_RESULT.result as Record<string, any>;
  const STAMP = RAW.computed_against_hash as string;
  const PERMITTED_READBACK = {
    ...SERVED_READBACK,
    analysisState: {
      ...(SERVED_READBACK.analysisState as Record<string, unknown>),
      leader_claim: { permitted: true, separation: 'separated' },
    },
  };
  const selectedFor = (run: { claim_permissions?: { leader_may_be_named?: boolean } }) =>
    run.claim_permissions?.leader_may_be_named === true ? PERMITTED_READBACK : SERVED_READBACK;
  const HEAVY = ['robustness', 'p_win_sensitivity', 'factor_evppi', 'edge_e_values'];
  /** The Run chip's fast path keeps the post-run readback beside the run (agent-v1-turn.ts, FAST PATH 3). */
  const viaRunChip = <T extends object>(run: T) => ({ ...run, canonical_state: {
    analysis_state: SERVED_READBACK.analysisState, analysis_ready: SERVED_READBACK.analysisReady, run_delta_absence_reason: 'unrequested_run_in_pair',
  } });
  /** The model after an approved edit: the read route's verdict turns stale and it ships no result (scenario-graph-analysis-read.ts). */
  const EDITED: Readback = {
    analysisState: { ...(SERVED_READBACK.analysisState as object), run_state: { kind: 'complete_stale', computed_at: '2026-09-27T18:20:03.050Z', cause: 'graph_changed' }, requires_rerun: true },
    analysisResult: undefined,
  };

  it('RED (row 1): a WITHHELD served run, then a later turn — no re-ranking KEY at any depth; labels, levels, summary, decision_sensitivity and the withheld reason stay', () => {
    expect(RUN_RESULT.claim_permissions.leader_may_be_named, 'control: the served A02 run withheld its leader').toBe(false);
    // CONTRAST: the probe sees each family in the run as served, so an empty list below is not a blind probe.
    const raw = reRankingKeys(RUN_RESULT);
    // The run AS THE AGENT GETS IT (`analysisResultForAgent`): the limits-only joint is `all_limits_hold_probability`, and the
    // brief's `goal_fit` (the leader's joint) is already gone (DL 5888327580) — so those two are not families to probe for.
    for (const k of ['enrichment', 'win_probabilities', 'win_probability', 'confidence', 'near_tie', 'gap', 'alternative_winner_label',
      'probability_of_goal', 'all_limits_hold_probability', 'conditional_winners', 'flip_thresholds']) expect(raw, `control: the served run carries ${k}`).toContain(k);
    expect(keysOf(RUN_RESULT), 'control: the served run carries its measured outcome mean').toContain('mean');
    for (const k of ['goal_fit', 'probability_of_joint_goal']) expect(raw, `the Agent never gets ${k}`).not.toContain(k);
    expect(reRankingKeys(viaRunChip(RUN_RESULT)), 'control: the fast path’s readback carries the leader claim’s separation').toContain('separation');
    for (const [label, run] of [['the Agent’s own call', RUN_RESULT], ['the Run chip’s fast path', viaRunChip(RUN_RESULT)]] as const) {
      const kept = keptRun(prune(afterRun(run), SERVED_READBACK));
      expect(reRankingKeys(kept), label).toEqual([]);
      expect(kept.result.summary, label).toBe(RAW.summary);
      expect(kept.result.decision_sensitivity, label).toEqual(RAW.decision_sensitivity);
      expect(kept.result.inference_warnings, label).toEqual(RAW.enrichment.inference_warnings);
      expect(kept.result.computed_against_hash, `${label}: stamped with the hash it was computed against`).toBe(STAMP);
      expect(kept.result.option_comparison.map((o: { label: string }) => o.label), `${label}: each option's label`)
        .toEqual(RAW.enrichment.option_comparison.map((o: { label: string }) => o.label));
      expect(kept.result.option_comparison.map((o: { outcome: unknown }) => o.outcome), `${label}: each recorded outcome, in order`)
        .toEqual(RAW.enrichment.option_comparison.map((o: { outcome: unknown }) => o.outcome));
      expect(kept.options, `${label}: each option's label and levels`).toEqual(RUN_RESULT.options);
      expect(kept.claim_permissions, `${label}: the leader withheld, with its reason`).toEqual(RUN_RESULT.claim_permissions);
      expect(kept.claim_permissions.withheld_reason).toBe('nonlinear_identity_sign_unproven');
      expect(kept.what_is_missing, label).toBe(RUN_RESULT.what_is_missing);
      expect(kept.blockers, label).toEqual(RUN_RESULT.blockers);
    }
  });

  /**
   * ⭐ THE KEPT PROSE CARRIES NO PER-OPTION OUTCOME (AI Quality #70 5859537680 condition, measured safe on Paul's 3 served
   * withheld exports in 5859548979). The key filter cannot see a figure written INTO `summary` / `what_is_missing`, so
   * the served run's OWN per-option figures — each option's win probability and outcome mean/p50, in the forms a
   * sentence would print them — are bound here by identity, never by a word list.
   */
  it('PIN: a WITHHELD run’s kept summary and what_is_missing print none of the served run’s per-option outcome figures', () => {
    const printed = (x: number): string[] => {
      const r = Math.round(x);
      return [String(r), r.toLocaleString('en-GB'), `£${r.toLocaleString('en-GB')}`];
    };
    const figures = [
      ...Object.values(RAW.win_probabilities as Record<string, number>).flatMap((p) => [`${Math.round(p * 100)}%`, `${(p * 100).toFixed(1)}%`]),
      ...(RAW.enrichment.option_comparison as { outcome: { mean: number; p50: number } }[]).flatMap((o) => [...printed(o.outcome.mean), ...printed(o.outcome.p50)]),
    ];
    const figuresIn = (text: unknown): string[] => (typeof text === 'string' ? figures.filter((f) => text.includes(f)) : []);
    expect(figures.length, 'control: the served run has per-option figures to look for').toBeGreaterThanOrEqual(12);
    // CONTRAST: the probe catches a planted leader sentence in the served run's own figures, so an empty list below is not blind.
    const [leaderLabel, leaderP] = Object.entries(RAW.win_probabilities as Record<string, number>).sort((a, b) => b[1] - a[1])[0]!;
    expect(figuresIn(`${leaderLabel} leads, winning ${Math.round(leaderP * 100)}% of the time.`)).not.toEqual([]);
    for (const [label, run] of [['the Agent’s own call', RUN_RESULT], ['the Run chip’s fast path', viaRunChip(RUN_RESULT)]] as const) {
      const kept = keptRun(prune(afterRun(run), SERVED_READBACK));
      expect(kept.claim_permissions.leader_may_be_named, label).toBe(false);
      expect(figuresIn(kept.result.summary), `${label}: summary`).toEqual([]);
      expect(figuresIn(kept.what_is_missing), `${label}: what_is_missing`).toEqual([]);
    }
  });

  it('RED (row 2): a PERMITTED run keeps win_probabilities and option_comparison, and drops the four heavy fields', () => {
    expect(RUN_RESULT_PERMITTED.claim_permissions.leader_may_be_named, 'control: the permitted variant may name a leader').toBe(true);
    for (const k of HEAVY) expect(Object.keys(RAW.enrichment), `control: the served run carries ${k}`).toContain(k);
    const kept = keptRun(prune(afterRun(RUN_RESULT_PERMITTED), PERMITTED_READBACK));
    expect(kept.result.win_probabilities).toEqual(RAW.win_probabilities);
    expect(kept.result.enrichment.option_comparison.map((o: { label: string; win_probability: number; outcome: unknown }) => [o.label, o.win_probability, o.outcome]))
      .toEqual(RAW.enrichment.option_comparison.map((o: { label: string; win_probability: number; outcome: unknown }) => [o.label, o.win_probability, o.outcome]));
    for (const k of HEAVY) expect(Object.keys(kept.result.enrichment), k).not.toContain(k);
    for (const k of ['decision_brief', 'inference_warnings', 'flip_thresholds']) expect(kept.result.enrichment[k], k).toEqual(RAW.enrichment[k]);
    expect(kept.result.summary).toBe(RAW.summary);
    expect(kept.result.decision_sensitivity).toEqual(RAW.decision_sensitivity);
    expect(kept.result.computed_against_hash).toBe(STAMP);
    expect(kept.claim_permissions).toEqual(RUN_RESULT_PERMITTED.claim_permissions);
  });

  it('same-Run identity cannot preserve an earlier permitted leader after the selected permission changes', () => {
    const selected = keptRun(prune(afterRun(RUN_RESULT_PERMITTED), PERMITTED_READBACK));
    expect(selected.claim_permissions.leader_may_be_named).toBe(true);
    expect(selected.result.win_probabilities).toEqual(RAW.win_probabilities);

    const conflicted = keptRun(prune(afterRun(RUN_RESULT_PERMITTED), SERVED_READBACK));
    expect(conflicted.stale).toBe(true);
    expect(conflicted.stale_note).toMatch(/selected saved run does not confirm/);
    expect(conflicted.result).toEqual({ type: RAW.type, computed_against_hash: STAMP });
    expect(conflicted.claim_permissions).toBeUndefined();
    expect(conflicted.goal_certainty).toBeUndefined();
    expect(keysOf(conflicted)).not.toContain('leading_option_id');
    expect(keysOf(conflicted)).not.toContain('outcome');
  });

  it('same-Run identity cannot refill an outcome missing from the selected saved result', () => {
    const selectedResult = structuredClone(PERMITTED_READBACK.analysisResult) as Record<string, any>;
    const first = selectedResult.enrichment.option_comparison[0];
    const { outcome: _outcome, ...withoutOutcome } = first;
    selectedResult.enrichment.option_comparison[0] = withoutOutcome;
    expect(RAW.enrichment.option_comparison[0].outcome).toBeDefined();
    expect(selectedResult.enrichment.option_comparison[0].outcome).toBeUndefined();

    const conflicted = keptRun(prune(afterRun(RUN_RESULT_PERMITTED), { ...PERMITTED_READBACK, analysisResult: selectedResult }));
    expect(conflicted.stale).toBe(true);
    expect(conflicted.result).toEqual({ type: RAW.type, computed_against_hash: STAMP });
    expect(conflicted.claim_permissions).toBeUndefined();
    expect(keysOf(conflicted)).not.toContain('outcome');
    expect(keysOf(conflicted)).not.toContain('win_probability');
  });

  it('RED (row 3): a model edit after the run marks the kept run stale; the same history with no edit does not', () => {
    for (const run of [RUN_RESULT, RUN_RESULT_PERMITTED, viaRunChip(RUN_RESULT_PERMITTED)]) {
      const current = keptRun(prune(afterRun(run), selectedFor(run)));
      expect(current.stale, 'no edit: the readback selected this very run').toBeUndefined();
      expect(current.stale_note).toBeUndefined();
      const edited = keptRun(prune(afterRun(run), EDITED));
      expect(edited.stale, 'edited: the canonical run state is complete_stale').toBe(true);
      expect(edited.stale_note).toMatch(/changed since this run/);
      expect(edited.stale_note).toMatch(/not the current model/);
      // A LATER run of a different model is current, and this one is not it.
      const otherRun = keptRun(prune(afterRun(run), { ...SERVED_READBACK, analysisResult: { ...(SERVED_READBACK.analysisResult as object), computed_against_hash: 'f00dfeedf00dfeed' } }));
      expect(otherRun.stale, 'a current run of ANOTHER model').toBe(true);
      // Fail closed: a readback that could not be read, or none at all, cannot vouch for the run.
      for (const unknown of [undefined, { analysisState: undefined, analysisResult: undefined }]) {
        const k = keptRun(prune(afterRun(run), unknown));
        expect(k.stale, 'no readback: never presented as current').toBe(true);
        expect(k.stale_note).toMatch(/could not confirm/);
      }
      // Re-derived each turn, never sticky: stale after the edit, current again once the readback selects it again.
      expect(keptRun(prune(prune(afterRun(run), EDITED), selectedFor(run))).stale).toBeUndefined();
    }
  });

  it('a stale served Run, permitted or withheld, keeps identity and rerun note without old claims', () => {
    const current = keptRun(prune(afterRun(RUN_RESULT_PERMITTED), PERMITTED_READBACK));
    expect(current.claim_permissions.leader_may_be_named).toBe(true);
    expect(keysOf(current), 'control: the current permitted Run carries measured outcomes').toContain('outcome');
    expect(keysOf(current), 'unearned or unchecked exact goal chances are not current claims').not.toContain('probability_of_goal');

    for (const run of [RUN_RESULT_PERMITTED, RUN_RESULT]) {
      const once = prune(afterRun(run), EDITED);
      const stale = keptRun(once);
      expect(stale.stale).toBe(true);
      expect(stale.stale_note).toMatch(/Offer to run the analysis again/);
      expect(stale.run_identity).toEqual(run.run_identity);
      expect(stale.result).toEqual({ type: RAW.type, computed_against_hash: STAMP });
      expect(stale.claim_permissions).toBeUndefined();
      expect(stale.goal_certainty).toBeUndefined();
      expect(stale.goal_chance).toBeUndefined();
      expect(stale.canonical_state).toBeUndefined();
      expect(keysOf(stale)).not.toContain('leading_option_id');
      expect(keysOf(stale)).not.toContain('probability_of_goal');
      expect(keysOf(stale)).not.toContain('win_probability');
      expect(keysOf(stale)).not.toContain('outcome');
      expect(prune(once, EDITED)).toEqual(once);
    }
  });

  it('CONTROL (hash spaces): a current run whose readback wire graph_hash differs (a repaired-shape graph) is NOT stale — the canonical verdict decides', () => {
    // The read route's wire `graph_hash` is the RAW compare-and-set base; `computed_against_hash` is the CANONICAL
    // projection's (scenario-graph-analysis-read.ts CS-AN-2). They differ on a repaired-shape graph that has not moved.
    const repaired = { ...SERVED_READBACK, graphHash: '0123456789abcdef' };
    expect(repaired.graphHash, 'control: the wire hash differs from the stamp').not.toBe(STAMP);
    expect(keptRun(prune(afterRun(RUN_RESULT), repaired)).stale).toBeUndefined();
  });

  it('RED (row 4): constraint_probabilities is dropped from the kept run, whatever its permission', () => {
    expect(keysOf(RUN_RESULT_PERMITTED), 'control: the served run carries them').toContain('constraint_probabilities');
    for (const run of [RUN_RESULT, RUN_RESULT_PERMITTED, viaRunChip(RUN_RESULT_PERMITTED)]) {
      const kept = keptRun(prune(afterRun(run), selectedFor(run)));
      expect(keysOf(kept).filter(namesConstraintProbability)).toEqual([]);
    }
    // CONTRAST: the sibling per-option constraint fields stay on a permitted run — only the probabilities go.
    const permitted = keptRun(prune(afterRun(RUN_RESULT_PERMITTED), PERMITTED_READBACK));
    expect(permitted.result.enrichment.option_comparison[0].constraint_margins).toEqual(RAW.enrichment.option_comparison[0].constraint_margins);
  });

  it('pairing, idempotence and the latest-run-only rule hold for the projected run', () => {
    for (const run of [RUN_RESULT, RUN_RESULT_PERMITTED, viaRunChip(RUN_RESULT), viaRunChip(RUN_RESULT_PERMITTED)]) {
      for (const readback of [selectedFor(run), EDITED, undefined]) {
        const once = prune(afterRun(run), readback);
        expect(prune(once, readback), 'pruning twice changes nothing').toEqual(once);
        expect(outputOf(prune(once, readback), 'call_run')).toBe(outputOf(once, 'call_run'));
        expect(once).toHaveLength(afterRun(run).length);
        expect(once.filter((i) => (i as { type?: string }).type !== 'function_call_output')).toEqual(afterRun(run).filter((i) => (i as { type?: string }).type !== 'function_call_output'));
      }
    }
    // An EARLIER run is still a stub; the projection applies to the latest alone.
    const twice = [...afterRun(RUN_RESULT_PERMITTED), call('call_run2', 'run_analysis', { reason: 'again' }), out('call_run2', RUN_RESULT)];
    const pruned = prune(twice, SERVED_READBACK);
    expect(outputOf(pruned, 'call_run')).toBe(historyStore.SUPERSEDED_OUTPUT);
    expect(reRankingKeys(JSON.parse(outputOf(pruned, 'call_run2')))).toEqual([]);
  });

  /** The new outcome ranges cost bytes; the withheld projection still drops the large ranking carriers. */
  it('RED (row 5): the kept WITHHELD run is materially smaller than the full output', () => {
    const raw = Buffer.byteLength(outputOf(afterRun(RUN_RESULT), 'call_run'), 'utf8');
    const kept = Buffer.byteLength(outputOf(prune(afterRun(RUN_RESULT), SERVED_READBACK), 'call_run'), 'utf8');
    expect(kept, `withheld: ${raw} → ${kept} bytes`).toBeLessThan(raw * 0.5);
  });
});
