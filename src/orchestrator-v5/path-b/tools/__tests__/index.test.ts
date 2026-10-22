/**
 * PATH-B TOOL SEAM (C5): the adapters as the SDK's own function tools. Strict schemas the API accepts; one record per call
 * (the kit's row and the route's result); approval only on `apply_change`; a Run after an applied approval in the same turn
 * is refused. The change adapter is stubbed here (its own suite drives the real door).
 */
import { describe, expect, it, vi } from 'vitest';
import { RunContext, type FunctionTool, type Tool } from '@openai/agents';

vi.mock('../change-tools.js', async (original) => ({
  ...(await original<typeof import('../change-tools.js')>()),
  applyChange: vi.fn(async () => ({ status: 'ok', mutated: true, ran: false, data: { saved: true } })),
}));

import { pathBTools, type OnToolCall } from '../index.js';
import { NOTE_MAX } from '../note-on-item.js';
import { toolsFor } from '../../../agent-lane/runtime/agent-tools.js';
import { ProposalStore } from '../../../agent-lane/proposal.js';
import { read } from './fixtures.js';

const PROPOSAL = `prop_${'a'.repeat(32)}`;
const ctx = { scenario_id: 'scn_1', authenticated_user_id: 'user-a', turn_id: 'turn-1', verified_user_messages: [], user_turn_text: '' };
function setup(mode: 'core' | 'preview' = 'core', analyseAfterCommit?: () => Promise<{ run?: Record<string, unknown>; ready?: unknown }>) {
  const dispatch = vi.fn(async () => ({ status: 200, json: read() }));
  const runAnalysis = vi.fn(async () => ({ ok: true, mutated: false, ran: true }));
  const calls: Parameters<OnToolCall>[] = [];
  const tools = pathBTools({ dispatch, proposals: new ProposalStore(), runAnalysis, ...(analyseAfterCommit === undefined ? {} : { analyseAfterCommit }) },
    ctx, mode, (row, result) => { calls.push([row, result]); });
  return { dispatch, runAnalysis, calls, tools };
}
const named = (tools: Tool[], name: string): FunctionTool => tools.find((t) => t.name === name) as FunctionTool;

describe('the adapters as SDK function tools', () => {
  it('core: the seven tools, strict, with no string limits a strict schema cannot carry; only apply_change asks for approval', async () => {
    const { tools } = setup();
    expect(tools.map((t) => t.name)).toEqual(['read_canonical_context', 'build_model_from_brief', 'propose_change', 'apply_change', 'run_analysis', 'note_on_item', 'offer_public_research']);
    for (const t of tools as FunctionTool[]) {
      expect(t.type).toBe('function');
      expect(t.strict, t.name).toBe(true);
      expect(JSON.stringify(t.parameters), t.name).not.toMatch(/minLength|maxLength/);
      const asks = await t.needsApproval(new RunContext(), (t.name === 'apply_change' ? { proposal_id: PROPOSAL } : {}) as never, 'call_1');
      expect(asks, t.name).toBe(t.name === 'apply_change');
    }
  });

  it('note_on_item: its block rides the route result, so the route can ship it beside the reply; nothing is written', async () => {
    const { tools, calls } = setup();
    await named(tools, 'note_on_item').invoke(new RunContext(), JSON.stringify({ item_id: 'staff', note: 'Is one more assistant enough?' }));
    const [row, result] = calls[0]!;
    expect(row).toMatchObject({ name: 'note_on_item', ok: true, mutated: false });
    expect(result.ui_directive).toEqual({ type: 'ui_directive', verb: 'highlight',
      targets: [{ id: 'staff', label: 'Assistants on shift', kind: 'factor' }], note: 'Is one more assistant enough?', source: 'composer' });
    expect(result.note_basis, 'the model identity it was read on, for the route to bind').toBe('id_one');
  });

  it('CONTRAST: no other tool result carries a directive', async () => {
    const { tools, calls } = setup();
    await named(tools, 'read_canonical_context').invoke(new RunContext(), '{}');
    expect(calls[0]![1].ui_directive).toBeUndefined();
  });

  it('build_model_from_brief takes the brief and the complete model, strict (the construction-role arm was measured and removed, 21 Oct)', () => {
    const { tools } = setup();
    const build = named(tools, 'build_model_from_brief');
    expect(build.strict).toBe(true);
    expect(Object.keys((build.parameters as { properties: Record<string, unknown> }).properties)).toEqual(['brief', 'model']);
  });

  it('preview: the reader only', () => {
    expect(setup('preview').tools.map((t) => t.name)).toEqual(['read_canonical_context']);
  });

  it('each call is recorded once, after its outcome: the kit row and the route result', async () => {
    const { tools, calls } = setup();
    const out = JSON.parse(String(await named(tools, 'read_canonical_context').invoke(new RunContext(), '{}'))) as { status: string };
    expect(out.status).toBe('ok');
    expect(calls).toEqual([[{ name: 'read_canonical_context', args: {}, ok: true, mutated: false, outcome: 'ok', refusal: null, ran: null },
      { args: {}, ok: true, mutated: false, outcome: 'ok' }]]);
  });

  it.each([
    ['read_canonical_context', {}],
    ['build_model_from_brief', { brief: '', model: { aims: [], options: [], factors: [], links: [], risks: [], conditions: [], views: [], history: [] } }],
    ['apply_change', { proposal_id: PROPOSAL }],
    ['run_analysis', { reason: 'Run it.', effects_timing: null }],
  ])('%s records its SDK-parsed declaration on both carriers', async (name, args) => {
    const { tools, calls } = setup();
    await named(tools, name).invoke(new RunContext(), JSON.stringify(args));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toHaveProperty('args', args);
    expect(calls[0]?.[1]).toHaveProperty('args', args);
  });

  it('bounds and redacts propose_change args on both carriers without changing the declared tool input', async () => {
    const { tools, calls } = setup();
    const args = { public_label: 'Long label. '.repeat(50), basis: 'Bearer synthetic-credential-for-test',
      ops: Array.from({ length: 9 }, (_, i) => ({ op: 'set_factor_value', factor_id: `missing_${i}`, value: i,
        unit: 'people', stance: 'estimate', source: { origin: 'olumi', quote: null, named_source: null } })) };
    const original = structuredClone(args);
    const outcome = await named(tools, 'propose_change').invoke(new RunContext(), JSON.stringify(args));
    expect(outcome).toBe('{"status":"refused","reason":"not_a_factor","data":{"op":0}}');
    expect(args).toEqual(original);
    expect(calls).toHaveLength(1);
    for (const carrier of calls[0]!) {
      const recorded = (carrier as { args?: Record<string, unknown> }).args;
      expect(recorded).toEqual({ public_label: `${args.public_label.slice(0, 160)}…(+${args.public_label.length - 160})`,
        basis: '[redacted]', ops: [...args.ops.slice(0, 6), '…+3 more'] });
      expect(JSON.stringify(recorded).length).toBeLessThanOrEqual(1500);
      expect(JSON.stringify(carrier)).not.toContain('synthetic-credential-for-test');
    }
  });

  it('the schema the SDK sends carries every check it parses with (a dropped check would end the turn on a parse failure)', () => {
    for (const t of setup().tools as FunctionTool[]) expect(JSON.stringify(t.parameters), t.name).not.toMatch(/pattern|format/);
  });

  it('after an applied approval, a Run in the same turn is refused; the approved proposal\'s id is on its result', async () => {
    const { tools, calls, dispatch, runAnalysis } = setup();
    await named(tools, 'apply_change').invoke(new RunContext(), JSON.stringify({ proposal_id: PROPOSAL }));
    expect(calls[0]?.[1]).toEqual({ args: { proposal_id: PROPOSAL }, ok: true, mutated: true, proposal_id: PROPOSAL, outcome: 'ok' });
    const run = await named(tools, 'run_analysis').invoke(new RunContext(), JSON.stringify({ reason: 'Run it.', effects_timing: null }));
    expect(JSON.parse(String(run))).toEqual({ status: 'refused', reason: 'run_not_requested' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it('⭐ gap 4: a committed change carries the automatic Run\'s outcome in its own result, asked for once', async () => {
    const auto = vi.fn(async () => ({ run: { ok: true, mutated: false, ran: true, result: { headline: 'synthetic' },
      run_identity: { graph_hash_at_run: 'h_one', computed_at: '2026-10-19T10:00:00.000Z' } } }));
    const { tools, calls } = setup('core', auto);
    const out = JSON.parse(String(await named(tools, 'apply_change').invoke(new RunContext(), JSON.stringify({ proposal_id: PROPOSAL }))));
    expect(auto).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ status: 'ok', mutated: true, data: { saved: true,
      analysis: { status: 'ok', ran: true, data: { run_id: 'run_1', result: { headline: 'synthetic' } } } } });
    expect(calls[0]?.[0]).toMatchObject({ name: 'apply_change', mutated: true });
  });

  it('⭐ gap 4: a saved model whose readiness admits no Run says so in the same result, with its readiness', async () => {
    const { tools } = setup('core', vi.fn(async () => ({ ready: { status: 'blocked' } })));
    const out = JSON.parse(String(await named(tools, 'apply_change').invoke(new RunContext(), JSON.stringify({ proposal_id: PROPOSAL }))));
    expect(out.data.analysis).toEqual({ status: 'refused', reason: 'run_not_ready', data: { analysis_ready: { status: 'blocked' } } });
  });
});

/**
 * THE AIE'S WORDS, BYTE-EQUAL (prompt/AIE-PATH-B-FIVE-TOOL-DESCRIPTIONS-AND-STANCE-20261019-v1.json, sha256
 * e8b43291c16d8f460158aa75cc862982949fd916711aa832434bca95cd936993; stance: AIE-MULTIMODEL-SCOPE-AND-STANCE-REPLY-20261019-v1.json).
 * Copied from the packets, never from the source under test: a change to either side turns this RED.
 */
const AIE_DESCRIPTIONS: Record<string, string> = {
  read_canonical_context:
    'Read the current saved scenario view, its revision, recorded sources, analysis readiness and selected Run. Use the returned saved facts rather than old conversation claims. Check the Run’s revision and staleness before using it; missing source or context remains unknown.',
  build_model_from_brief:
    'Create and save Olumi’s provisional first Living Model from the user’s actual brief, supplied verbatim from their messages. Use only when there is no existing model to replace. Preserve the brief’s known sources, assumptions, conditions and disagreement; creating the model does not verify its claims. Report creation only from the tool’s confirmed outcome.',
  propose_change:
    'Prepare the complete requested change for review without changing the operative saved model. Preserve supplied values, signs, units, periods, conditions and retain, replace or retract intent. Declare each figure’s actual source using the available fields; keep unknown source unknown and assumptions distinct from current claims. Quote only actual supplied words; never invent a quote or a source, and never present Olumi’s estimate as the person’s or a party’s: on their item it is marked estimate_by olumi, and it never replaces or mixes with a figure they gave. If required meaning cannot be represented, report the specific unavailable capability rather than silently dropping part of the change or relabelling its source.',
  apply_change:
    'Commit the exact prepared change after the user approves that current proposal. Approval is permission to apply, not proof that a save succeeded or that its claims are verified. Use the operation’s own receipt and approved postimage readback. Distinguish an earlier completed save from a new write, honour stale or conflicting proposals, and report unknown outcomes without repeating a completed effect.',
  run_analysis:
    'Request a fresh scientific Run of the current saved model. Eligible committed changes and Undo use the existing automatic analysis and coaching path; do not issue a duplicate Run after them. Read actual readiness and the recorded Run, then explain only what its results support. Report refusal or unavailability honestly. Do not rerun analysis merely to retry an explanation.',
};
const AIE_STANCE = 'How this particular figure is put forward in its full source context, not whether it is true and not who authored it. hypothetical: a supposition, conditional scenario or what-if, including numbers embedded inside that assumed situation. target: a desired or required outcome or threshold, rather than an observed level. estimate: a tentative assessment, approximation or prediction offered as such, rather than an asserted current fact. stated_current: the speaker asserts an actual current or already observed level for this subject at the relevant time, outside a supposition, target or estimate. Read the whole proposition and its conditions: indicative wording inside a supposition does not make its embedded figure stated_current. Classify each figure by its own proposition; one statement\'s status must not transfer to a different quantity or subject. Preserve the original source, wording, sign, units, period and conditions. stated_current describes the assertion; it does not mean verified, accurate or adopted.';

describe('the AIE\'s signed words', () => {
  it('each tool\'s description is the AIE\'s, byte for byte, replacing the old text', () => {
    for (const t of (setup().tools as FunctionTool[]).filter((t) => t.name !== 'note_on_item' && t.name !== 'offer_public_research')) expect(t.description, t.name).toBe(AIE_DESCRIPTIONS[t.name]);
    expect(Object.keys(AIE_DESCRIPTIONS)).toHaveLength(5);
  });

  it('offer_public_research keeps the legacy tool\'s own words, byte for byte (#3558: ported, never reworded)', () => {
    const legacy = toolsFor('full').find((t) => t.name === 'offer_public_research');
    expect(legacy?.description).toBeTruthy();
    expect(named(setup().tools, 'offer_public_research').description).toBe(legacy!.description);
  });

  it('note_on_item (DL ruling 21 Oct): its description says it writes nothing, allows one note per turn, and never ranks an option', () => {
    const d = named(setup().tools, 'note_on_item').description;
    for (const part of ['it changes nothing in the model', 'At most one per turn', 'Never call an option best and never recommend one']) expect(d).toContain(part);
  });

  it('note_on_item (DL 22 Oct): a reply that asks one question about one item pins that question on the item', () => {
    const d = named(setup().tools, 'note_on_item').description;
    expect(d).toContain('When your reply asks the person one question about one item in the model, call this with that item’s id and the question, so it shows on that item; as the note, keep the same question in at most 140 characters, naming items by their label, never by id.')
    // The limit the model reads is the tool's own refusal limit (Codex AMEND on #3616): a longer or id-naming copy is refused.
    expect(d).toContain(`at most ${NOTE_MAX} characters`)
  });

  it('note_on_item (DL 22 Oct): a challenge to one named item is given as the note on it; none or several, the reply alone', () => {
    expect(named(setup().tools, 'note_on_item').description).toContain('When the person asks you to challenge one item they name, put your challenge to it as this note on that item; if they name no item or several, answer in your reply alone.');
  });

  it('propose_change carries the per-figure stance enum with the AIE\'s description, verbatim', () => {
    const params = JSON.stringify(named(setup().tools, 'propose_change').parameters);
    expect(params).toContain(JSON.stringify(AIE_STANCE));
    for (const v of ['stated_current', 'hypothetical', 'target', 'estimate']) expect(params).toContain(`"${v}"`);
  });
});
