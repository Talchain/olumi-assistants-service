import { legacyDoorGraph } from './licence-test-graphs.js';
/**
 * T3 on the LIVE Agent route (real loop, model stubbed): a pre-mortem press runs RC's method turn. The scenario is R3's
 * SERVED D1 capture (#2465 `rc-served-signal-cases.json` A-Q-D1-BUILD: 2 own options, leader withheld), returned by the
 * graph read exactly as the route reads it back. Every row counts the model calls and reads what the model was sent.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { CANVAS_BAND_WORD, edgeBandFromMagnitude } from '../../format/edge-strength-bands.js';
import { asSent } from './helpers/as-sent.js';

const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; pending_actions?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) rows.set(k, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0, pending_actions: JSON.parse(JSON.stringify(w.pending_actions ?? [])) });
    return { id: rows.get(k)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

type Chip = { id: string; label: string; message: string; action_type?: string };
type Body = { assistant_text: string; suggested_actions: Chip[]; _agent: { tool_calls: { name: string; ok: boolean }[] } };
type Sent = { instructions: string; tools: { name: string }[]; input: unknown[]; model?: string; reasoning?: { effort?: string }; max_output_tokens?: number };

const SERVED = JSON.parse(readFileSync(new URL('../turn-context/__tests__/fixtures/rc-served-signal-cases.json', import.meta.url), 'utf8')) as { cases: { id: string; capture_sha_matches_case: boolean; body: Record<string, any> }[] };
// Science 393023 LICENCE (a)/(b), 7 Oct: std 0.125 → 0.1 on a clone preserves this independent claim; captured bytes stay unchanged.
const D1_SERVED = SERVED.cases.find((c) => c.id === 'A-Q-D1-BUILD')!;
const D1 = { ...D1_SERVED, body: { ...D1_SERVED.body, draft_graph: legacyDoorGraph(D1_SERVED.body.draft_graph) } };
const label = (id: string) => (D1.body.draft_graph.nodes as { id: string; label: string }[]).find((n) => n.id === id)!.label;
const q = (s: string) => `‘${s}’`;
const PLAN = 'ai_reporting_module_sprint';

/** Two grounded stories on D1's supplied links 2 and 1 (never item 0: its label carries a word PM-NO-PROB bans). */
const GOOD = [
  'Two ways this could go wrong, so you can watch for them early.',
  `1. It is a year later and the plan went badly because ${label('sprint_capacity_for_ai_reporting')} stayed thin, so ${label('ai_reporting_module_availability')} slipped. Watch for: a missed demo date. Mitigate: protect the sprint.`,
  `2. ${label('integration_step_bug_resolution')} was left undone and ${label('trial_profile_abandonment_rate')} kept rising. Watch for: trial sign-ups going quiet. Mitigate: fix the worst step first.`,
  'Outside the model: what could blindside this that none of these figures covers?',
].join('\n');
const BAD = 'This plan will fail. There is a 40% chance the sprint slips.';
/** A passing draft whose words trip the WRITE narrator (CODEX_CLI_OVERFLOW 5940698000 P1 #2, reproduced on D1's labels). */
const GOOD_ADDED = GOOD.replace(`stayed thin, so`, `was added too late, so`);

/** R3's served MRR draft (950177e): its stored identity reading is unconfirmed and writable, so an ordinary turn re-offers it. */
type G = { nodes: { id: string; kind: string }[]; edges: { from: string; to: string }[] };
const IDENTITY = (JSON.parse(readFileSync(new URL('./fixtures/served-identity-draft-950177e-20260930.json', import.meta.url), 'utf8')) as { graph: G }).graph;
const OPTION_IDS = new Set(IDENTITY.nodes.filter((x) => x.kind === 'option').map((x) => x.id));
const IDENTITY_NO_OPTIONS: G = { ...IDENTITY, nodes: IDENTITY.nodes.filter((x) => !OPTION_IDS.has(x.id)), edges: IDENTITY.edges.filter((e) => !OPTION_IDS.has(e.from) && !OPTION_IDS.has(e.to)) };

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `7a1e2d3c-4b5a-4e6d-9c7b-8a9f0e1d2c${String(n).padStart(2, '0')}`; };

describe('T3 method turn on the live Agent route (served D1)', () => {
  let app: FastifyInstance;
  let reply = GOOD;
  /** When set, the model's raw output items for the next call(s), instead of one message carrying `reply`. */
  let output: unknown[] | null = null;
  let failRead = false;
  /** When set, the graph read returns this model (no analysis) instead of D1. */
  let served: G | null = null;
  let sent: Sent[] = [];
  let planPickChipId: (id: string) => string;
  let MUTATION_TOOLS: readonly string[];
  let mt: typeof import('../method-turn/method-turn.js');
  let hashOf: (g: unknown) => string | null;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = asSent(JSON.parse(String(init?.body ?? '{}'))) as Sent;
      sent.push(body);
      return new Response(JSON.stringify({ output: output ?? [{ type: 'message', content: [{ type: 'output_text', text: reply }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const route = await import('../../../routes/agent-v1-turn.js');
    mt = await import('../method-turn/method-turn.js');
    ({ planPickChipId } = mt);
    hashOf = (await import('../../context/graph-hash.js')).computeAnalysisAffectingGraphHash as never;
    ({ MUTATION_TOOLS } = await import('../runtime/agent-tools.js'));
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (_req, res) => (failRead ? res.code(500).send({ error: 'read failed' }) : served !== null ? { graph: served, graph_hash: hashOf(served) } : {
      graph: D1.body.draft_graph,
      graph_hash: 'h-d1',
      analysis_ready: { status: 'ready', may_run: true },
      analysis_state: D1.body.analysis_state,
      analysis_result: D1.body.analysis_result,
      analysis_option_participation: D1.body.option_participation,
    }));
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [] }));
    await app.register(route.agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { reply = GOOD; output = null; failRead = false; served = null; sent = []; nextScenario(); });

  const press = async (id: string, message: string, turnId?: string): Promise<Body> => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message, source: 'chip', chip: { id },
      ...(turnId !== undefined ? { turn_id: turnId } : {}) } });
    expect(res.statusCode).toBe(200);
    return res.json() as Body;
  };
  const ask = async (message: string): Promise<Body> => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message } });
    expect(res.statusCode).toBe(200);
    return res.json() as Body;
  };
  const generic = () => press('agent-next-pre-mortem', 'Run a pre-mortem with me: imagine this decision went badly. What most plausibly went wrong?');
  const pick = (id = PLAN, turnId?: string) => press(planPickChipId(id), `Run a pre-mortem on ${q(label(id))}.`, turnId);
  /** The ordinary turn's instructions, read off the wire (the route does not export them). */
  const baseInstructions = async (): Promise<string> => {
    const keep = reply;
    reply = 'In the current model, the link matters.';
    await ask('What do you make of this?');
    reply = keep;
    const base = sent[sent.length - 1].instructions;
    sent = [];
    nextScenario();
    return base;
  };

  it('the capture is the served one', () => {
    expect(D1.capture_sha_matches_case).toBe(true);
    expect(D1.body.analysis_state.leader_claim.permitted).toBe(false);
  });

  it('ROW R1 RED (2 own options, leader withheld): the generic press runs a decision-level pre-mortem with ONE model call', async () => {
    reply = GOOD;
    const b = await generic();
    expect(sent).toHaveLength(1);
    expect(sent[0].instructions).toContain('Stress-test the whole decision.');
    expect(sent[0].instructions).not.toContain('The plan to stress-test is');
    expect(sent[0].tools).toEqual([]);
    expect(b.assistant_text).toBe(GOOD);
    expect(b._agent.tool_calls).toEqual([]);
    expect(b.suggested_actions.some(c => c.id.startsWith('agent-approve-proposal:'))).toBe(false);
    expect(b.suggested_actions.map(c => c.id)).toContain('agent-talk-it-through');
    expect(b.suggested_actions.some(c => c.id.startsWith('agent-premortem-plan:'))).toBe(false);
  });

  it('ROW R2: a pick runs ONE call; the directive rides in THIS turn\'s instructions, never the user\'s words; no proposing tool is offered', async () => {
    const base = await baseInstructions();
    expect(base, 'vacuity: an ordinary turn was sent').toContain('Olumi');
    await pick();
    expect(sent).toHaveLength(1);
    const call = sent[0];
    expect(call.instructions.startsWith(`${base}\n\nMETHOD TURN`)).toBe(true);
    expect(call.instructions).toContain('METHOD TURN');
    expect(call.instructions).toContain(`The plan to stress-test is ${q(label(PLAN))}.`);
    expect(JSON.stringify(call.input)).not.toContain('METHOD TURN');
    expect(call.tools, 'ONE call with NO tool (DL 5939415083 (2)): not even a read tool').toEqual([]);
    expect(MUTATION_TOOLS.length, 'vacuity: the catalogue has proposing tools to withhold').toBeGreaterThan(0);
  });

  it('ROW R3 PAIR: a passing draft is sent as written, with ONE card on its lowest-index story target + Talk it through, and no other method', async () => {
    const b = await pick();
    expect(b.assistant_text).toContain(GOOD.split('\n')[1]);
    expect(b.assistant_text).toContain('Outside the model:');
    const card = b._agent.tool_calls.filter((c) => c.name.startsWith('propose_'));
    expect(card).toEqual([{ name: 'propose_link_strengths', ok: true, mutated: false, proposal_id: expect.any(String) }].map((c) => expect.objectContaining(c)));
    const ids = b.suggested_actions.map((c) => c.id);
    expect(ids.some((id) => id.startsWith('agent-approve-proposal:'))).toBe(true);
    // The card says what its yes records (CODEX P1 #2): the stored proposal's own words — the link and its band.
    const approve = b.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:')) as Chip & { detail?: string };
    const mean = (D1.body.draft_graph.edges as { from: string; to: string; strength: { mean: number } }[])
      .find((e) => e.from === 'integration_step_bug_resolution' && e.to === 'trial_profile_abandonment_rate')!.strength.mean;
    const word = CANVAS_BAND_WORD[edgeBandFromMagnitude(Math.abs(mean))];
    expect(approve.detail).toContain(`"${label('integration_step_bug_resolution')}" \u2192 "${label('trial_profile_abandonment_rate')}" as ${word}`);
    expect(approve.detail).toContain('Olumi\u2019s estimate');
    expect(ids).toContain('agent-talk-it-through');
    expect(ids.filter((id) => id.startsWith('agent-next-'))).toEqual([]);
  });

  it('ROW R4 PAIR: a failing draft is NEVER sent: RC\'s fallback names the plan and the first item, with that item\'s card', async () => {
    reply = BAD;
    const b = await pick();
    expect(sent).toHaveLength(1);
    expect(b.assistant_text).not.toContain('40%');
    expect(b.assistant_text).toContain(`Imagine ${q(label(PLAN))} has gone badly. Start with how ${q(label('ai_reporting_module_availability'))} affects ${q(label('enterprise_prospect_signing_likelihood'))}: how would you notice it early, and what would you do?`);
    expect(b._agent.tool_calls.some((c) => c.name === 'propose_link_strengths' && c.ok)).toBe(true);
  });

  it('ROW R5: the replaced draft never reaches the next turn as Olumi\'s words; the fallback does', async () => {
    const base = await baseInstructions();
    reply = BAD;
    await pick();
    reply = 'Fine.';
    await ask('Tell me more.');
    const next = JSON.stringify(sent[1].input);
    expect(next).not.toContain('40% chance');
    expect(next).toContain('has gone badly');
    expect(sent[1].instructions, 'an ordinary turn carries no method directive').toBe(base);
  });

  it('ROW R6 CONTROL: an ordinary question on the same model is untouched (no directive, proposing tools offered)', async () => {
    reply = 'In the current model, the link matters.';
    await ask('What do you make of this?');
    expect(sent).toHaveLength(1);
    expect(sent[0].instructions).not.toContain('METHOD TURN');
    expect(sent[0].tools.map((t) => t.name)).toEqual(expect.arrayContaining(['propose_link_strengths', 'propose_new_risk']));
  });

  it('ROW R7 (round 2 (1)): a recognised press on a model the read could not return gets ONE "can\'t run" reply, with NO model call', async () => {
    failRead = true;
    const b = await generic();
    expect(sent, 'never an ordinary Agent turn').toHaveLength(0);
    expect(b.assistant_text.startsWith('I can\u2019t run the pre-mortem')).toBe(true);
    expect(b.suggested_actions.map((c) => c.id)).toEqual(['agent-talk-it-through']);
  });

  /** DL follow-up on #2480 (5941358217): the answer row records the LLM calls the turn MADE, read off the provider ledger. */
  const callsOnRow = (turnId: string): number => rows.get(`${SCENARIO}:${turnId}`)!.llm_calls_used;
  it('ROW R12 RED: a generic multi-option pre-mortem records the ONE model call it makes', async () => {
    const t = randomUUID();
    await press('agent-next-pre-mortem', 'Run a pre-mortem with me: imagine this decision went badly. What most plausibly went wrong?', t);
    expect(sent).toHaveLength(1);
    expect(callsOnRow(t)).toBe(1);
  });
  it('ROW R12 RED: the "can\'t run" reply (read failed) records 0 calls', async () => {
    failRead = true;
    const t = randomUUID();
    await press('agent-next-pre-mortem', 'Run a pre-mortem with me: imagine this decision went badly. What most plausibly went wrong?', t);
    expect(sent).toHaveLength(0);
    expect(callsOnRow(t)).toBe(0);
  });
  it('ROW R12 CONTROL: a pick records exactly the calls it made (1); an ordinary question records its own count', async () => {
    const t = randomUUID();
    await pick(PLAN, t);
    expect(callsOnRow(t)).toBe(sent.length);
    expect(sent).toHaveLength(1);
    sent = [];
    const t2 = randomUUID();
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'What do you make of this?', turn_id: t2 } });
    expect(res.statusCode).toBe(200);
    expect(sent.length, 'vacuity: the question called the model').toBeGreaterThan(0);
    expect(callsOnRow(t2)).toBe(sent.length);
  });
  it('ROW R8 (round 2 (2)): a model that answers with a tool call still makes exactly ONE call; nothing runs and the fallback is sent', async () => {
    output = [{ type: 'function_call', name: 'get_canonical_state', call_id: 'c1', arguments: '{}' }];
    const b = await pick();
    expect(sent, 'ONE model call, never a second hop').toHaveLength(1);
    expect(b._agent.tool_calls.filter((c) => c.name === 'get_canonical_state')).toEqual([]);
    expect(b.assistant_text).toContain('has gone badly');
  });

  it('ROW R9 PAIR (round 2 (2)): a multi-message draft never reaches the next turn; an EMPTY output never touches the earlier turn', async () => {
    reply = 'Earlier answer from Olumi.';
    await ask('What do you make of this?');
    output = [{ type: 'message', content: [{ type: 'output_text', text: 'Draft part one: it will fail.' }] },
      { type: 'message', content: [{ type: 'output_text', text: 'Draft part two, 40% chance.' }] }];
    await pick();
    output = [];
    await pick();
    output = null;
    reply = 'Fine.';
    await ask('Tell me more.');
    const next = JSON.stringify(sent[sent.length - 1].input);
    expect(next).not.toContain('Draft part one');
    expect(next).not.toContain('Draft part two');
    expect(next).toContain('Earlier answer from Olumi.');
    expect(next.match(/has gone badly/g)?.length, 'both method turns hold what was SENT').toBe(2);
  });
  /**
   * ⭐ ROUND 3 (DL 5940698000): A RECOGNISED METHOD TURN IS TERMINAL. After the check the route returns exactly the checked text
   * and the method's own cards; no downstream composer (identity re-offer, write narration, other proposals or chips) runs.
   */
  it('ROW R10 PAIR (round 3, P1 #1): on a model whose identity reading waits, the "can\'t run" reply and the decision pre-mortem carry NO identity card; CONTROL: an ordinary question there re-offers it', async () => {
    served = IDENTITY_NO_OPTIONS;
    const u = await generic();
    expect(sent, 'no model call').toHaveLength(0);
    expect(u.assistant_text.startsWith('I can\u2019t run the pre-mortem')).toBe(true);
    expect(u._agent.tool_calls.map((c) => c.name)).toEqual([]);
    expect(u.suggested_actions.map((c) => c.id)).toEqual(['agent-talk-it-through']);
    served = IDENTITY;
    nextScenario();
    const c = await generic();
    expect(sent).toHaveLength(1);
    expect(sent[0].instructions).toContain('Stress-test the whole decision.');
    expect(c.assistant_text).toContain('Imagine this decision has gone badly.'); // D1 draft is ungrounded on this model
    expect(c._agent.tool_calls.map((x) => x.name)).not.toContain('propose_identity');
    const ids = c.suggested_actions.map((x) => x.id);
    // W9c: decision stories carry no estimate approval, including after a draft rejection.
    expect(c._agent.tool_calls.map((x) => x.name), 'decision stories carry no approval or identity card').toEqual([]);
    expect(ids.some(id => id.startsWith('agent-premortem-plan:'))).toBe(false);
    expect(ids.at(-1)).toBe('agent-talk-it-through');
    expect(ids, 'the decision exercise offers Talk it through only').toEqual(['agent-talk-it-through']);
    nextScenario();
    reply = 'In the current model, the link matters.';
    const o = await ask('What do you make of this?');
    expect(o._agent.tool_calls.map((x) => x.name), 'vacuity: this model re-offers its waiting reading on an ordinary turn').toContain('propose_identity');
  });

  it('ROW R11 PAIR (round 3, P1 #2): the WIRE is the checked text byte-for-byte (a passing draft the write narrator would rewrite; the fallback), and the next turn\'s history and the answer row hold exactly the wire', async () => {
    const run = mt.planMethodTurn({ chipId: planPickChipId(PLAN), signalInputs: { offeredSpecific: [], graph: D1.body.draft_graph,
      analysisState: D1.body.analysis_state, analysisResult: D1.body.analysis_result, optionParticipation: D1.body.option_participation, leaderLicensed: false } });
    if (run?.kind !== 'run') throw new Error('expected a run');
    expect(mt.settleMethodTurn(run, GOOD_ADDED).reply, 'vacuity: the check passes this draft as written').toBe(GOOD_ADDED);
    for (const draft of [GOOD_ADDED, BAD]) {
      const checked = mt.settleMethodTurn(run, draft).reply;
      reply = draft;
      sent = [];
      nextScenario();
      const turnId = randomUUID();
      const b = await pick(PLAN, turnId);
      expect(b.assistant_text, 'the wire is the checked text').toBe(checked);
      reply = 'Fine.';
      await ask('Tell me more.');
      const said = (sent[1].input as { role?: string; content?: { text?: string }[] }[])
        .filter((it) => it.role === 'assistant').flatMap((it) => (it.content ?? []).map((x) => x.text));
      expect(said, 'history = wire').toEqual([b.assistant_text]);
      expect(rows.get(`${SCENARIO}:${turnId}`)?.assistant_message, 'answer row = wire').toBe(b.assistant_text);
    }
  });
  it('ROW R12 (M3 latency, RC T1 map item 5): the method call runs on the banked INTERPRET budget (Sol, effort low), never the coach\'s conversation budget; CONTROL: an ordinary question keeps it', async () => {
    const { budgetFor, interpretBudget } = await import('../model-budgets.js');
    const conversation = budgetFor('gpt-6.1-sol', 'conversation');
    const interpret = interpretBudget();
    expect(conversation.reasoning_effort, 'vacuity: the two banked budgets differ').not.toBe(interpret.reasoning_effort);
    reply = 'In the current model, the link matters.';
    await ask('What do you make of this?');
    expect(sent[0].reasoning?.effort, 'an ordinary turn on a built model: the conversation budget').toBe(conversation.reasoning_effort);
    sent = [];
    nextScenario();
    reply = GOOD;
    await pick();
    expect(sent).toHaveLength(1);
    expect(sent[0].model).toBe(interpret.model);
    expect(sent[0].reasoning?.effort).toBe(interpret.reasoning_effort);
    expect(sent[0].max_output_tokens).toBe(interpret.max_output_tokens);
  });
});

it('Science 393023: as-served D1 prospect/revenue is now an unsized guidance item', async () => {
  const { assembleGuidanceSignals } = await import('../turn-context/guidance-signals.js');
  const signals = assembleGuidanceSignals({ graph: D1_SERVED.body.draft_graph, request: 'turn', offeredSpecific: [], leaderLicensed: false });
  expect(signals['model.goal_path_links'].find(l => l.link_id === 'enterprise_prospect_signing_likelihood->quarterly_revenue')?.link_sizing).toBe('placeholder');
});
