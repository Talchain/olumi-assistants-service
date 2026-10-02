/**
 * ⭐ C6-2 — "READING YOUR DECISION": a streamed first brief gets a `BRIEF_READ` frame with the user's OWN goal and
 * options a few seconds in (AIQ ruling #70 5858767026; X5 first-brief latency).
 *
 * The rules under test, on the real route over the #2109 product double (`graph-ready-frame.test.ts`, harness copied):
 *   · only a STREAMED turn on a KNOWN-EMPTY model starts the one reading call; a buffered turn and a populated model
 *     make no call at all;
 *   · every span in the frame is an exact substring of the user's MESSAGE (a paraphrase never reaches the wire);
 *   · the frame is emitted before GRAPH_READY or not at all, and never once the turn has ended;
 *   · the reading never delays or fails the turn, and never reaches the COMPLETE body or the Agent;
 *   · the call is on the turn's OpenAI-only ledger as `purpose: brief_reading`, `prompt_alias: agent.read_brief`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { READY_GRAPH } from './fixtures/first-analysis-graphs.js';
import type { PipelineStageEvent } from '../../../cee/unified-pipeline/types.js';
import { PREWARM_OUTPUT_TOKENS } from '../runtime/agent-loop.js';
import { BRIEF_ROUTE_WAIT_MS } from '../brief-reading.js';

type RunArgs = { payload: { turn_id: string; scenario_id: string }; requestId: string; autoRun?: { draftTurnId: string } };
interface Scenario {
  registered: boolean;
  revision: number;
  versions: { version_id: string; sequence: number; creation: { kind: string; mutation_id: string; source_turn_id: string } }[];
  facts: HandlerFact[];
  runs: number;
}
const scenarios = new Map<string, Scenario>();
const st = (sid: string): Scenario => {
  let s = scenarios.get(sid);
  if (s === undefined) {
    s = { registered: false, revision: 0, versions: [], facts: [], runs: 0 };
    scenarios.set(sid, s);
  }
  return s;
};
const hashOf = (s: Scenario) => `rev-${s.revision}`;

/**
 * ONE ordered record of what happened on the turn: every conversation call, the construction call, the first
 * analysis's dispatch, and every stage frame. Order in this array is order in time (all in one process).
 */
type Step = { at: 'model' } | { at: 'prewarm' } | { at: 'construction' } | { at: 'reading' } | { at: 'run' } | { at: 'frame'; kind: PipelineStageEvent['kind'] };
let steps: Step[] = [];
/** T1: every conversation call's sent body (the prewarm included), in order, and every construction call's. */
type SentBody = { instructions?: string; input?: unknown[]; tools?: { name: string }[]; max_output_tokens?: number };
let conversationBodies: SentBody[] = [];
let constructionBodies: Record<string, unknown>[] = [];
/** The prewarm's output cap (`PREWARM_OUTPUT_TOKENS`): the stub tells it apart by that alone, as the ledger does. */
const PREWARM_CAP = 16;

const { runStub } = vi.hoisted(() => ({ runStub: { impl: null as null | ((a: unknown) => Promise<unknown>) } }));
vi.mock('../../handlers/chip-click-dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, dispatchChipClickRunAnalysis: (a: unknown) => runStub.impl!(a) };
});
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, loadPriorFactsWithReadState: async (sid: string) => ({ status: 'ok', facts: [...st(sid).facts] }) };
});

/** Durable answer rows by (scenario, turn): a same-turn_id retry takes the REAL replay path. */
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] }>();
/** T1 (a): the durable conversation read (`readRecent`): answers with no earlier turn, or fails. */
let durableRead: 'none' | 'fail' = 'none';
const store = {
  readRecent: vi.fn(async () => { if (durableRead === 'fail') throw new Error('read failed'); return []; }),
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

const BRIEF = 'We need to reach £100k MRR within 6 months with a £20k budget, while keeping monthly churn under 4%. Should we develop new features and increase our Pro plan price from £49 to £59 per month in the next release, or invest in additional advertising?';
const candidate = {
  goal: { metric: 'Delivery reliability', operator: '>=', value: 90, unit: '%', horizon_months: 6, provenance: 'explicit' },
  constraints: [],
  options: [{ label: 'Hire a tech lead', provenance: 'explicit', interventions: [] }],
  factors: [{ label: 'Team capacity', role: 'controllable', baseline_known: true, baseline_value: 5, unit: 'people', provenance: 'explicit' }],
  risks: [], outcomes: [{ label: 'Delivery reliability', provenance: 'inferred' }],
  links: [{ from: 'Team capacity', to: 'Delivery reliability', direction: 'positive', provenance: 'inferred' }],
  unknowns: [],
};
/** A first model far over the first-model limit, made of widened factors only — refused `model_too_large` (see rebuild-after-too-large.test.ts). */
function oversized() {
  const names = Array.from({ length: 35 }, (_, i) => `Secondary factor ${i}`);
  const factor = (label: string, provenance = 'ai_proposed') => ({ label, role: 'observable', baseline_known: false, baseline_value: null, unit: null, provenance, plausible_max: 100 });
  const link = (from: string, to: string) => ({ from, to, direction: 'positive', provenance: 'inferred' });
  return {
    goal: { metric: 'Velocity', operator: '>=', value: 20, unit: 'points', horizon_months: 6, provenance: 'explicit' },
    constraints: [],
    options: [
      { label: 'Hire a tech lead', provenance: 'explicit', changes: ['Delivery capacity'], interventions: [] },
      { label: 'Hire two developers', provenance: 'explicit', changes: ['Delivery capacity'], interventions: [] },
    ],
    factors: [factor('Delivery capacity', 'inferred'), ...names.map((n) => factor(n))],
    risks: [],
    outcomes: [{ label: 'Velocity', provenance: 'inferred' }],
    links: [link('Delivery capacity', 'Velocity'), ...names.map((n) => link(n, 'Velocity'))],
    unknowns: [],
  };
}
let constructionReturns: 'ready' | 'oversized' = 'ready';

let script: Array<Record<string, unknown>> = [];
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
let callSeq = 0;
const callTool = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${callSeq++}`, arguments: JSON.stringify(args) }] });

/** C6-2: what the brief-reading call answers, and an optional hold so a test decides WHEN it answers. */
let readingReply: { status: number; text: string } = { status: 200, text: '{}' };
let readingHold: Promise<void> | null = null;
let readingCalls = 0;
function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> & { text?: { format?: { type?: string; name?: string } } };
    if (body.text?.format?.name === 'brief_spans') {
      readingCalls += 1;
      steps.push({ at: 'reading' });
      if (readingHold !== null) await readingHold;
      if (readingReply.status !== 200) return new Response('{"error":"x"}', { status: readingReply.status });
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: readingReply.text }] }] }), { status: 200 });
    }
    if (body.text?.format?.type === 'json_schema') {
      steps.push({ at: 'construction' });
      constructionBodies.push(body);
      const out = constructionReturns === 'oversized' ? oversized() : candidate;
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(out) }] }] }), { status: 200 });
    }
    conversationBodies.push(body as SentBody);
    // T1 (b): the cache prewarm is answered and never read; it never takes the scripted reply a real hop is owed.
    if (body['max_output_tokens'] === PREWARM_CAP) { steps.push({ at: 'prewarm' }); return new Response(JSON.stringify(say('')), { status: 200 }); }
    steps.push({ at: 'model' });
    const next = body['tool_choice'] === 'none' ? undefined : script.shift();
    return new Response(JSON.stringify(next ?? say('Here is where the model stands.')), { status: 200 });
  }));
}

type RunWithStageStream = <T>(emit: (e: PipelineStageEvent) => void, fn: () => Promise<T>) => Promise<T>;

/** The product double: the internal routes the Agent dispatches to, per scenario. */
async function buildApp(): Promise<{ app: FastifyInstance; runWithStageStream: RunWithStageStream }> {
  vi.resetModules();
  const { registrationTurnId } = await import('../../graph-registration/registration-identity.js');
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  // Imported AFTER resetModules, so it is the SAME module instance (the same AsyncLocalStorage) the route reads.
  const { runWithStageStream } = await import('../../../cee/unified-pipeline/stage-stream-context.js');
  const a = Fastify({ logger: false });
  a.post('/assist/v1/scenarios/:id/graph', async (req) => {
    const s = st((req.params as { id: string }).id);
    if (!s.registered) return { graph: { nodes: [], edges: [] }, graph_hash: 'empty' };
    const H = hashOf(s);
    const ran = s.facts.some((f) => (f.result as { graph_hash_at_run?: unknown }).graph_hash_at_run === H);
    return {
      graph: READY_GRAPH,
      graph_hash: H,
      analysis_state: ran
        ? { run_state: { kind: 'complete_current', computed_at: '2026-09-27T18:00:00.000Z' }, leader_claim: { permitted: false, withheld_reason: 'auto_initiated' }, usable_for_prose: true, usable_for_chips: true }
        : { run_state: { kind: 'never_run' }, leader_claim: { permitted: false, withheld_reason: 'no_analysis' } },
      ...(ran ? { analysis_result: { type: 'analysis_result', summary: 'A provisional first pass.', computed_against_hash: H } } : {}),
    };
  });
  a.post('/assist/v1/scenarios/:id/graph/register', async (req) => {
    const sid = (req.params as { id: string }).id;
    const s = st(sid);
    const b = req.body as { operation_id?: string };
    const turnId = registrationTurnId(sid, b.operation_id);
    const prior = s.versions.find((v) => v.creation.source_turn_id === turnId);
    s.registered = true;
    if (prior !== undefined) return { registered: true, replayed: true, graph_hash: hashOf(s), model_version: { version_id: prior.version_id, version_number: prior.sequence } };
    s.revision += 1;
    const v = { version_id: `00000000-0000-4000-8000-00000000000${s.versions.length + 1}`, sequence: s.versions.length + 1, creation: { kind: 'initial', mutation_id: 'm', source_turn_id: turnId } };
    s.versions.push(v);
    return { registered: true, graph_hash: hashOf(s), model_version: { version_id: v.version_id, version_number: v.sequence } };
  });
  a.post('/assist/v1/scenarios/:id/versions', async (req) => ({ versions: [...st((req.params as { id: string }).id).versions].reverse(), next_cursor: null }));
  a.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [] }));
  await a.register(agentV1TurnRoute);
  await a.ready();
  return { app: a, runWithStageStream: runWithStageStream as RunWithStageStream };
}

/** The first analysis's one dispatch: recorded in the ordered log, and persisted as the real dispatcher would. */
function installRunStub() {
  runStub.impl = async (raw: unknown) => {
    const args = raw as RunArgs;
    steps.push({ at: 'run' });
    const s = st(args.payload.scenario_id);
    s.runs += 1;
    s.facts.push({
      fact_type: 'run_analysis', fact_id: `f${s.facts.length}`, fact_version: 1, noop: false,
      result: { scenario_id: args.payload.scenario_id, graph_hash_at_run: hashOf(s), summary: 'x', enrichment: args.autoRun !== undefined ? { run_provenance: { initiated_by: 'auto_post_draft', provisional: true, draft_turn_id: args.autoRun.draftTurnId } } : {} },
    } as unknown as HandlerFact);
    return {
      outcome: 'ok', commitPerformed: true, graph: null, mayNameLeadingOption: false, analysisReady: { status: 'ready' },
      response: { response_version: 2, assistant_text: 'Ran.', suggested_actions: [], insights: [], stage_indicator: 'analyse', blocks: [{ type: 'analysis_result', summary: 'the run’s own copy' }] },
    };
  };
}

type Body = {
  draft_graph?: { nodes: { id: string }[]; edges: { id?: string; from: string; to: string }[] };
  _diagnostic_trace: { first_analysis?: Record<string, unknown> };
  _agent: { replayed?: boolean; tool_calls: { name: string; ok: boolean; refusal?: string; replayed?: boolean }[] };
};

/** Every key at any depth. */
const deepKeys = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); deepKeys(x, out); }
  return out;
};

let n = 0;
let SID = '';
const nextScenario = () => { n += 1; SID = `7c6e1a2b-3a4f-4e5d-8c6b-7a8f9e0d1c${String(n).padStart(2, '0')}`; };

type BriefRead = Extract<PipelineStageEvent, { kind: 'BRIEF_READ' }>;
const GOAL = 'reach £100k MRR within 6 months';
const OPTIONS = ['develop new features and increase our Pro plan price from £49 to £59 per month in the next release', 'invest in additional advertising'];
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };

describe('C6-2: a streamed first brief gets the user\'s own goal and options before the model', () => {
  let app: FastifyInstance;
  let runWithStageStream: RunWithStageStream;
  beforeAll(async () => {
    installFetch();
    installRunStub();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    ({ app, runWithStageStream } = await buildApp());
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    nextScenario();
    script = []; steps = []; constructionReturns = 'ready'; conversationBodies = []; constructionBodies = []; durableRead = 'none';
    readingReply = { status: 200, text: JSON.stringify({ goal: GOAL, options: OPTIONS, build: true }) };
    readingHold = null; readingCalls = 0;
  });

  type TurnBody = Body & { _provider_calls?: { provider: string; purpose: string; prompt_alias?: string }[] };
  const streamed = async (payload: Record<string, unknown>) => {
    const frames: PipelineStageEvent[] = [];
    const r = await runWithStageStream(
      (ev) => { frames.push(ev); steps.push({ at: 'frame', kind: ev.kind }); },
      async () => await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, ...payload } }),
    );
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    return { body: r.json() as TurnBody, frames, briefRead: () => frames.filter((f): f is BriefRead => f.kind === 'BRIEF_READ') };
  };
  /**
   * T1 (a): a reading that names a goal or an option routes the brief straight to the Constructor, so the model is
   * never asked to call the build (`routed`); without one the model still decides, and is scripted to build.
   */
  const firstBrief = (opts: { routed?: boolean } = {}) => {
    script = opts.routed === false ? [callTool('build_model_from_brief', { brief: BRIEF })] : [];
    return streamed({ message: BRIEF });
  };

  it('RED: exactly ONE BRIEF_READ, BEFORE GRAPH_READY, carrying the user\'s goal and options verbatim', async () => {
    const { body, frames, briefRead } = await firstBrief();
    expect(body._agent.tool_calls, 'control: the build committed on this turn').toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
    expect(briefRead(), 'exactly one frame').toHaveLength(1);
    const f = briefRead()[0]!;
    expect(f.goal).toBe(GOAL);
    expect(f.options).toEqual(OPTIONS);
    for (const s of [f.goal!, ...f.options]) expect(BRIEF.includes(s), s).toBe(true);
    expect(typeof f.elapsed_ms).toBe('number');
    const kinds = frames.map((x) => x.kind);
    expect(kinds.indexOf('BRIEF_READ'), 'before the model').toBeLessThan(kinds.indexOf('GRAPH_READY'));
  });

  it('v2: the frame carries the limits the user set, in their words; an uncued span never becomes one', async () => {
    readingReply = { status: 200, text: JSON.stringify({ goal: GOAL, options: OPTIONS, limits: ['£20k budget', 'monthly churn under 4%', 'within 6 months'], build: true }) };
    const { briefRead } = await firstBrief();
    expect(briefRead()).toHaveLength(1);
    expect(briefRead()[0]!.limits).toEqual(['£20k budget', 'monthly churn under 4%']);
  });

  it('RED: the call is on the turn\'s OpenAI-only ledger, as brief_reading under its own prompt alias', async () => {
    const { body } = await firstBrief();
    const rows = (body._provider_calls ?? []).filter((c) => c.purpose === 'brief_reading');
    expect(rows).toEqual([expect.objectContaining({ provider: 'openai', purpose: 'brief_reading', prompt_alias: 'agent.read_brief' })]);
  });

  it('a span that is NOT in the user\'s message never reaches the wire; nothing verbatim → no frame at all', async () => {
    readingReply = { status: 200, text: JSON.stringify({ goal: 'reach £100,000 MRR in six months', options: ['invest in additional advertising', 'Carry on as now'], build: true }) };
    const a = await firstBrief();
    expect(a.briefRead()).toEqual([expect.objectContaining({ goal: null, options: ['invest in additional advertising'] })]);
    nextScenario(); steps = [];
    readingReply = { status: 200, text: JSON.stringify({ goal: 'grow revenue', options: ['Carry on as now'] }) };
    const b = await firstBrief({ routed: false });
    expect(readingCalls, 'control: the reading ran both times').toBe(2);
    expect(b.briefRead()).toEqual([]);
  });

  it('CONTRAST: a BUFFERED first brief makes no reading call at all (no stream, no frame, body untouched)', async () => {
    script = [callTool('build_model_from_brief', { brief: BRIEF })];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, message: BRIEF } });
    expect(r.statusCode).toBe(200);
    expect((r.json() as Body)._agent.tool_calls, 'control: it built').toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
    expect(readingCalls).toBe(0);
  });

  it('CONTRAST: a streamed turn on a POPULATED model makes no reading call', async () => {
    await firstBrief();
    expect(readingCalls, 'control: the first brief read').toBe(1);
    steps = [];
    const { frames } = await streamed({ message: 'What drives MRR most?' });
    expect(readingCalls, 'no second call').toBe(1);
    expect(frames.some((f) => f.kind === 'BRIEF_READ')).toBe(false);
  });

  it('the model supersedes the reading: an answer that lands after GRAPH_READY is never emitted', async () => {
    let release!: () => void;
    readingHold = new Promise<void>((r) => { release = r; });
    script = [callTool('build_model_from_brief', { brief: BRIEF })];
    const frames: PipelineStageEvent[] = [];
    const turn = runWithStageStream(
      (ev) => {
        frames.push(ev);
        if (ev.kind === 'GRAPH_READY') release(); // the reading answers only once the model is on screen
      },
      async () => await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, message: BRIEF } }),
    );
    const r = await turn;
    await flush();
    expect(r.statusCode).toBe(200);
    expect(frames.some((f) => f.kind === 'GRAPH_READY'), 'control: the model streamed').toBe(true);
    expect(frames.some((f) => f.kind === 'BRIEF_READ')).toBe(false);
  });

  it('RED: never after the turn — an answer that lands once the turn has ended emits nothing, and the turn waited for it at most BRIEF_ROUTE_WAIT_MS', async () => {
    let release!: () => void;
    readingHold = new Promise<void>((r) => { release = r; });
    // No build this turn (the Agent just answers), so no GRAPH_READY can be the reason nothing is emitted.
    script = [];
    const frames: PipelineStageEvent[] = [];
    const r = await runWithStageStream(
      (ev) => { frames.push(ev); },
      async () => await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, message: BRIEF } }),
    );
    expect(r.statusCode, 'the turn completed while the reading was still pending').toBe(200);
    expect(readingCalls, 'control: the reading had started').toBe(1);
    expect(frames.some((f) => f.kind === 'GRAPH_READY'), 'control: no model this turn').toBe(false);
    release();
    await flush();
    expect(frames.filter((f) => f.kind === 'BRIEF_READ')).toEqual([]);
  });

  it('a failing reading call costs nothing: the turn completes and builds, with no frame', async () => {
    readingReply = { status: 500, text: '' };
    const { body, briefRead } = await firstBrief({ routed: false });
    expect(body._agent.tool_calls).toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
    expect(readingCalls).toBe(1);
    expect(briefRead()).toEqual([]);
  });

  it('display-only: the reading reaches neither the COMPLETE body nor any model call\'s input', async () => {
    readingReply = { status: 200, text: JSON.stringify({ goal: GOAL, options: ['invest in additional advertising'], build: true }) };
    const { body, briefRead } = await firstBrief();
    expect(briefRead(), 'control: the frame was emitted').toHaveLength(1);
    expect(deepKeys(body).some((k) => /brief_read|BRIEF_READ/i.test(k))).toBe(false);
    expect(JSON.stringify(body)).not.toContain('BRIEF_READ');
  });
  /**
   * ⭐ T1 (a)+(b) (DL 5942371176 / 5942473027; lease 5942431674). A known-empty model, the conversation's first user
   * message, no chip, no method press, and a reading that names a goal or an option: the host makes the build call
   * itself, so no model call decides it; the call it replaced is still sent, capped and unawaited, only to warm the
   * provider's cache for the one call that answers, and is on the ledger as `prewarm`. Anything else: today's path.
   * STREAMED ONLY (DL CR on #2496): routing reuses the display reading the stream already makes, so it adds no provider
   * call; a buffered turn starts no reading at all. So every routing row below is streamed (`turn`).
   */
  describe('T1: a first brief goes straight to the Constructor; the call it replaced only warms the cache', () => {
    const atOf = () => steps.filter((x) => x.at !== 'frame').map((x) => x.at);
    const turn = async (payload: Record<string, unknown>) => (await streamed(payload)).body;
    const buffered = async (payload: Record<string, unknown>) => {
      const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, ...payload } });
      expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
      return r.json() as TurnBody;
    };
    const prewarms = () => conversationBodies.filter((b) => b.max_output_tokens === PREWARM_OUTPUT_TOKENS);
    const answering = () => conversationBodies.filter((b) => b.max_output_tokens !== PREWARM_OUTPUT_TOKENS);
    /** Today's path: the turn's first conversation call is a real one that decides, and nothing is prewarmed. */
    const todaysPath = (why: string) => {
      expect(prewarms(), `${why}: no prewarm`).toEqual([]);
      const at = atOf().filter((a) => a !== 'reading');
      expect(at[0], `${why}: a model call decides first`).toBe('model');
    };

    it('RED: streamed — no model call before the build; ONE answering call; the prewarm and every call on the ledger and in llm_calls_used', async () => {
      const turnId = '11111111-2222-4333-8444-555555555501';
      script = [];
      const { body } = await streamed({ message: BRIEF, turn_id: turnId });
      expect(body._agent.tool_calls, 'control: the build committed').toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
      const at = atOf();
      expect(at.indexOf('construction'), JSON.stringify(at)).toBeGreaterThan(-1);
      expect(at.slice(0, at.indexOf('construction')).filter((a) => a === 'model'), 'no model call decided the build').toEqual([]);
      expect(at.filter((a) => a === 'model'), 'one call answers').toHaveLength(1);
      expect(at.filter((a) => a === 'prewarm')).toHaveLength(1);
      const purposes = (body._provider_calls ?? []).map((c) => c.purpose);
      expect(purposes.filter((p) => p === 'prewarm'), JSON.stringify(purposes)).toHaveLength(1);
      expect(purposes.filter((p) => p === 'conversation')).toHaveLength(1);
      expect(purposes.filter((p) => p === 'brief_reading')).toHaveLength(1);
      expect(rows.get(`${SID}:${turnId}`)?.llm_calls_used, 'no hidden call').toBe(purposes.length);
    });

    it('CONTRAST (DL CR on #2496): a BUFFERED first brief starts NO reading — zero added calls, today\'s path', async () => {
      script = [callTool('build_model_from_brief', { brief: BRIEF })];
      const body = await buffered({ message: BRIEF });
      expect(body._agent.tool_calls, 'control: it built').toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
      expect(readingCalls).toBe(0);
      expect((body._provider_calls ?? []).map((c) => c.purpose), 'no reading, no prewarm').toEqual(['conversation', 'construction', 'conversation']);
      todaysPath('buffered');
    });

    it('RED: the prewarm IS the answering call\'s prefix (same instructions, tools, leading items); then the host\'s call with the user\'s words verbatim', async () => {
      await turn({ message: BRIEF });
      const [pre] = prewarms();
      const [ans] = answering();
      expect(pre, 'control: a prewarm was sent').toBeDefined();
      expect(ans!.instructions).toBe(pre!.instructions);
      expect(ans!.tools).toEqual(pre!.tools);
      expect(ans!.input!.slice(0, pre!.input!.length)).toEqual(pre!.input);
      const call = ans!.input![pre!.input!.length] as { type?: string; name?: string; call_id?: string; arguments?: string };
      expect(call).toMatchObject({ type: 'function_call', name: 'build_model_from_brief' });
      expect(JSON.parse(call.arguments!)).toEqual({ brief: BRIEF });
      expect(call.call_id).toMatch(/^host_first_call_[0-9a-f-]{36}$/);
    });

    it('CONTRAST: a first message that names no goal and no option (a question with only a limit) → today\'s path, even with `build: true`', async () => {
      readingReply = { status: 200, text: JSON.stringify({ goal: null, options: [], limits: ['monthly churn under 4%'], build: true }) };
      script = [say('Happy to help — what are you deciding?')];
      const body = await turn({ message: 'Can we keep monthly churn under 4%?' });
      expect(readingCalls, 'control: the reading ran and found a span').toBe(1);
      expect(body._agent.tool_calls).toEqual([]);
      todaysPath('limit only');
    });

    it('CONTRAST (Codex pre-review P1): the user asks to hold off — a goal span with `build: false` → today\'s path, nothing built', async () => {
      const msg = 'We want to reach £100k MRR within 6 months. Do not create a model yet; just challenge that goal.';
      readingReply = { status: 200, text: JSON.stringify({ goal: 'reach £100k MRR within 6 months', options: [], limits: [], build: false }) };
      script = [say('Before we model it: what makes six months the right horizon?')];
      const body = await turn({ message: msg });
      expect(readingCalls, 'control: the reading ran and kept the goal').toBe(1);
      expect(body._agent.tool_calls).toEqual([]);
      expect(atOf()).not.toContain('construction');
      todaysPath('hold off');
    });

    it('CONTRAST: a failed reading → today\'s path', async () => {
      readingReply = { status: 500, text: '' };
      script = [callTool('build_model_from_brief', { brief: BRIEF })];
      const body = await turn({ message: BRIEF });
      expect(body._agent.tool_calls).toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
      todaysPath('failed reading');
    });

    it('CONTRAST: a reading slower than BRIEF_ROUTE_WAIT_MS → today\'s path, unchanged; the wait is capped', async () => {
      let release!: () => void;
      readingHold = new Promise<void>((r) => { release = r; });
      script = [callTool('build_model_from_brief', { brief: BRIEF })];
      const t0 = Date.now();
      const body = await turn({ message: BRIEF });
      const waited = Date.now() - t0;
      release();
      await flush();
      expect(body._agent.tool_calls).toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
      todaysPath('slow reading');
      expect(waited, 'it waited for the reading, up to the cap').toBeGreaterThanOrEqual(BRIEF_ROUTE_WAIT_MS - 50);
      expect(waited, 'and no longer').toBeLessThan(BRIEF_ROUTE_WAIT_MS + 5_000);
    }, 20_000);

    it('CONTRAST (Codex pre-review): earlier words that could not be read → today\'s path (the follow-up is never built alone)', async () => {
      durableRead = 'fail';
      script = [callTool('build_model_from_brief', { brief: BRIEF })];
      const body = await turn({ message: BRIEF });
      expect(store.readRecent, 'control: the durable read was attempted').toHaveBeenCalled();
      expect(body._agent.tool_calls).toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
      todaysPath('durable read failed');
    });

    it('CONTRAST (Codex pre-review): not typed by the user — a chip source with no chip object, a retry → not routed, today\'s path', async () => {
      script = [say('Noted.')];
      await turn({ message: BRIEF, source: 'chip_click' });
      expect(readingCalls, 'control: the display reading ran and named options').toBe(1);
      todaysPath('chip source');
      nextScenario(); steps = []; conversationBodies = [];
      script = [say('Noted.')];
      await turn({ message: BRIEF, source: 'retry' });
      todaysPath('retry');
    });

    it('CONTRAST: a chip press on an empty model → not routed, today\'s path', async () => {
      script = [say('Noted.')];
      await turn({ message: BRIEF, source: 'chip', chip: { id: 'agent-next-what-would-change' } });
      todaysPath('chip');
    });

    it('CONTRAST: a brief that is NOT the first message → not routed, today\'s path (only the Agent can combine earlier words)', async () => {
      readingReply = { status: 200, text: JSON.stringify({ goal: null, options: [], limits: ['monthly churn under 4%'] }) };
      script = [say('What are you deciding?')];
      await turn({ message: 'Can we keep monthly churn under 4%?' });
      expect(readingCalls, 'control: turn 1 read').toBe(1);
      steps = []; conversationBodies = [];
      readingReply = { status: 200, text: JSON.stringify({ goal: GOAL, options: OPTIONS, build: true }) };
      script = [callTool('build_model_from_brief', { brief: BRIEF })];
      const body = await turn({ message: BRIEF });
      expect(body._agent.tool_calls, 'control: still an empty model, it built').toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
      expect(readingCalls, 'control: the display reading ran on turn 2 too').toBe(2);
      todaysPath('second message');
    });

    it('CONTRAST: a populated model → no reading, today\'s path', async () => {
      await turn({ message: BRIEF });
      expect(readingCalls).toBe(1);
      steps = []; conversationBodies = [];
      script = [say('Advertising and price both feed MRR.')];
      await turn({ message: BRIEF });
      expect(readingCalls).toBe(1);
      todaysPath('populated');
    });
  });
});
