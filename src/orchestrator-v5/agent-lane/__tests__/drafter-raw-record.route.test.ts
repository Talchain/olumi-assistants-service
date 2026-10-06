/**
 * ⭐ EVERY SERVED DRAFT KEEPS THE DRAFTER'S RAW ANSWER — exactly one record, in its own table (DL bench, 6 Oct).
 *
 * The bench replays every served draft with 0 LLM calls but only AFTER the drafter: the drafter's raw output was
 * stored for 0 of 77 served drafts, so construction could only be measured on a 9-draw proxy. The rule under test:
 * a served first brief writes ONE row to `cee_drafter_raw_responses`, bound to the scenario and to the construction's
 * operation id, carrying the text the provider returned byte-for-byte with the prompt/schema identity, model id and
 * build of the call that produced it — and NEVER a row in a table an older service's window counts.
 *
 * The real route, the real builder, the real drafter-raw store adapter; only the Supabase CLIENT is a recording
 * double (so the table name written is the adapter's own) and `fetch` is stubbed (0 LLM calls). Every expectation is
 * recomputed HERE from what the stubbed provider was SENT and RETURNED, with `node:crypto`, never from a helper.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { READY_GRAPH } from './fixtures/first-analysis-graphs.js';
import { GIT_COMMIT_SHA } from '../../../version.js';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

// ── The Supabase client double: records EVERY operation on EVERY table, so "nothing else was written" is measurable.
const supa = vi.hoisted(() => ({
  ops: [] as { table: string; op: string; payload?: unknown }[],
  mode: 'ok' as 'ok' | 'absent' | 'refused' | 'throws' | 'hangs',
  release: null as null | (() => void),
  clients: 0,
}));
vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const NO_DATA = { data: null, error: { code: 'FAKE', message: 'recording double: no data' }, count: null };
  const chain = (table: string, result: () => Promise<unknown>): unknown => new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => result().then(res, rej);
      return () => chain(table, result);
    },
  });
  const insertResult = (table: string): (() => Promise<unknown>) => {
    if (table !== 'cee_drafter_raw_responses') return async () => NO_DATA;
    if (supa.mode === 'absent') return async () => ({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.cee_drafter_raw_responses' in the schema cache" } });
    if (supa.mode === 'refused') return async () => ({ data: null, error: { code: '23503', message: 'insert or update violates foreign key constraint' } });
    if (supa.mode === 'hangs') return () => new Promise((res) => { supa.release = () => res({ data: null, error: null }); });
    return async () => ({ data: null, error: null });
  };
  const client = {
    from: (table: string) => new Proxy({}, {
      get(_t, prop) {
        const op = String(prop);
        return (payload?: unknown) => {
          if (op === 'insert' && supa.mode === 'throws' && table === 'cee_drafter_raw_responses') throw new Error('client exploded');
          supa.ops.push({ table, op, ...(payload !== undefined ? { payload: JSON.parse(JSON.stringify(payload)) } : {}) });
          return chain(table, op === 'insert' ? insertResult(table) : async () => NO_DATA);
        };
      },
    }),
    rpc: (name: string, args?: unknown) => {
      supa.ops.push({ table: `rpc:${name}`, op: 'rpc', payload: args });
      return chain(`rpc:${name}`, async () => NO_DATA);
    },
  };
  return { ...actual, createClient: () => { supa.clients += 1; return client; } };
});

// ── The product double (as `graph-ready-frame.test.ts`): per-scenario state behind the internal routes.
type RunArgs = { payload: { turn_id: string; scenario_id: string }; requestId: string; autoRun?: { draftTurnId: string } };
interface Scenario {
  registered: boolean; revision: number; facts: HandlerFact[];
  versions: { version_id: string; sequence: number; creation: { kind: string; mutation_id: string; source_turn_id: string } }[];
  registeredOps: string[];
}
const scenarios = new Map<string, Scenario>();
const st = (sid: string): Scenario => {
  let s = scenarios.get(sid);
  if (s === undefined) { s = { registered: false, revision: 0, versions: [], facts: [], registeredOps: [] }; scenarios.set(sid, s); }
  return s;
};
const hashOf = (s: Scenario) => `rev-${s.revision}`;

const { runStub } = vi.hoisted(() => ({ runStub: { impl: null as null | ((a: unknown) => Promise<unknown>) } }));
vi.mock('../../handlers/chip-click-dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, dispatchChipClickRunAnalysis: (a: unknown) => runStub.impl!(a) };
});
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, loadPriorFactsWithReadState: async (sid: string) => ({ status: 'ok', facts: [...st(sid).facts] }) };
});
/** The session store (the windowed tables' writer): every append is recorded, so a raw text there is visible. */
const appended: unknown[] = [];
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] }>();
const store = {
  /** T1 (a): the durable conversation read — no earlier turn, so a streamed first brief may be routed. */
  readRecent: vi.fn(async () => []),
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; pending_actions?: unknown[] }) => {
    appended.push(JSON.parse(JSON.stringify(w)));
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

const BRIEF = 'Should we hire a tech lead or two developers to lift delivery reliability?';
const candidate = {
  goal: { metric: 'Delivery reliability', operator: '>=', value: 90, unit: '%', horizon_months: 6, provenance: 'explicit' },
  constraints: [],
  options: [{ label: 'Hire a tech lead', provenance: 'explicit', interventions: [] }],
  factors: [{ label: 'Team capacity', role: 'controllable', baseline_known: true, baseline_value: 5, unit: 'people', provenance: 'explicit' }],
  risks: [], outcomes: [{ label: 'Delivery reliability', provenance: 'inferred' }],
  links: [{ from: 'Team capacity', to: 'Delivery reliability', direction: 'positive', provenance: 'inferred' }],
  unknowns: [],
};
/** Over the first-model limit (widened factors only): refused `model_too_large` after ONE retry (see graph-ready-frame). */
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
    risks: [], outcomes: [{ label: 'Velocity', provenance: 'inferred' }],
    links: [link('Delivery capacity', 'Velocity'), ...names.map((n) => link(n, 'Velocity'))],
    unknowns: [],
  };
}

/**
 * ⛔ THE SERVED TEXT IS DELIBERATELY NOT CANONICAL JSON (2-space indent, trailing newline), so a record that kept the
 * PARSED model re-serialised could never equal it — the discriminating half of mutant (a).
 */
let constructionText: (n: number) => string = () => `${JSON.stringify(candidate, null, 2)}\n`;
type Sent = Record<string, unknown> & { model?: string; instructions?: string; input?: string; max_output_tokens?: number; reasoning?: { effort?: string }; text?: { format?: { type?: string; name?: string; schema?: unknown } } };
/** C6-2's brief reading on a streamed first brief: exact spans of BRIEF, `build: true` → the host routes it (T1 (a)). */
const READING = JSON.stringify({ goal: 'lift delivery reliability', options: ['hire a tech lead', 'two developers'], limits: [], build: true });
let constructionSent: Sent[] = [];
let constructionServed: string[] = [];
let script: Array<Record<string, unknown>> = [];
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
let callSeq = 0;
const callTool = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${callSeq++}`, arguments: JSON.stringify(args) }] });

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Sent;
    if (body.text?.format?.name === 'brief_spans') {
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: READING }] }] }), { status: 200 });
    }
    if (body.text?.format?.type === 'json_schema') {
      const text = constructionText(constructionSent.length);
      constructionSent.push(body);
      constructionServed.push(text);
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }], status: 'completed', usage: { input_tokens: 11, output_tokens: 22 } }), { status: 200 });
    }
    const next = body['tool_choice'] === 'none' ? undefined : script.shift();
    return new Response(JSON.stringify(next ?? say('Here is where the model stands.')), { status: 200 });
  }));
}

type DrafterRaw = typeof import('../../drafter-raw/index.js');
let drafterRaw: DrafterRaw;
type RunWithStageStream = <T>(emit: (e: unknown) => void, fn: () => Promise<T>) => Promise<T>;
let runWithStageStream: RunWithStageStream;

async function buildApp(): Promise<FastifyInstance> {
  vi.resetModules();
  const { registrationTurnId } = await import('../../graph-registration/registration-identity.js');
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  // AFTER resetModules: the SAME module instance (its pending-write set, its cached store) the route uses.
  drafterRaw = await import('../../drafter-raw/index.js');
  ({ runWithStageStream } = (await import('../../../cee/unified-pipeline/stage-stream-context.js')) as unknown as { runWithStageStream: RunWithStageStream });
  const a = Fastify({ logger: false });
  a.post('/assist/v1/scenarios/:id/graph', async (req) => {
    const s = st((req.params as { id: string }).id);
    if (!s.registered) return { graph: { nodes: [], edges: [] }, graph_hash: 'empty' };
    return { graph: READY_GRAPH, graph_hash: hashOf(s), analysis_state: { run_state: { kind: 'never_run' }, leader_claim: { permitted: false, withheld_reason: 'no_analysis' } } };
  });
  a.post('/assist/v1/scenarios/:id/graph/register', async (req) => {
    const sid = (req.params as { id: string }).id;
    const s = st(sid);
    const b = req.body as { operation_id?: string };
    s.registeredOps.push(String(b.operation_id));
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
  return a;
}

function installRunStub() {
  runStub.impl = async (raw: unknown) => {
    const args = raw as RunArgs;
    const s = st(args.payload.scenario_id);
    s.facts.push({
      fact_type: 'run_analysis', fact_id: `f${s.facts.length}`, fact_version: 1, noop: false,
      result: { scenario_id: args.payload.scenario_id, graph_hash_at_run: hashOf(s), summary: 'x', enrichment: {} },
    } as unknown as HandlerFact);
    return {
      outcome: 'ok', commitPerformed: true, graph: null, mayNameLeadingOption: false, analysisReady: { status: 'ready' },
      response: { response_version: 2, assistant_text: 'Ran.', suggested_actions: [], insights: [], stage_indicator: 'analyse', blocks: [{ type: 'analysis_result', summary: 'x' }] },
    };
  };
}

type Body = { draft_graph?: { nodes: unknown[] }; _agent: { tool_calls: { name: string; ok: boolean; refusal?: string }[] } };
type CallRec = Record<string, unknown> & { raw_text: string };
type RawRow = Record<string, unknown> & { calls: CallRec[] };

/** Every table an older pinned service reads through a ROW WINDOW (supabase-store.ts readers; model-management; admin). */
const WINDOWED_TABLES = ['v5_conversation_turns', 'v5_handler_facts', 'model_versions', 'cee_draft_failures', 'cee_prompt_observations', 'scenarios', 'decision_records'];
const WRITE_OPS = new Set(['insert', 'upsert', 'update', 'delete', 'rpc']);
const rawRows = (): RawRow[] => supa.ops.filter((o) => o.table === 'cee_drafter_raw_responses' && o.op === 'insert').map((o) => o.payload as RawRow);

let n = 0;
let SID = '';
const nextScenario = () => { n += 1; SID = `5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b${String(n).padStart(2, '0')}`; };

describe('⭐ a served draft keeps the drafter’s raw answer — one record, its own table', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    installFetch();
    installRunStub();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    process.env.SUPABASE_URL = 'https://recording-double.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'recording-double-not-a-key';
    app = await buildApp();
  }, 120_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
  beforeEach(() => {
    nextScenario();
    script = []; constructionSent = []; constructionServed = []; supa.ops = []; supa.mode = 'ok'; supa.release = null; appended.length = 0;
    constructionText = () => `${JSON.stringify(candidate, null, 2)}\n`;
    drafterRaw.resetDrafterRawStoreForTests();
  });

  const turn = async (payload: Record<string, unknown>) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, ...payload } });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    return r.json() as Body;
  };
  const firstBrief = async (extra: Record<string, unknown> = {}) => {
    script = [callTool('build_model_from_brief', { brief: BRIEF })];
    const body = await turn({ message: BRIEF, ...extra });
    await drafterRaw.settleDrafterRawWritesForTests();
    return body;
  };

  it('RED: a served first brief persists EXACTLY ONE raw record, bound to the scenario, the operation the registration carried, and the version it became', async () => {
    const body = await firstBrief();
    expect(body._agent.tool_calls, 'control: the build committed on this turn').toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
    expect(constructionSent, 'control: one drafter call').toHaveLength(1);
    const recs = rawRows();
    expect(recs).toHaveLength(1);
    const r = recs[0]!;
    expect(r.scenario_id).toBe(SID);
    expect(st(SID).registeredOps, 'control: the registration was sent one operation id').toHaveLength(1);
    expect(r.operation_id, 'the SAME operation id the registration route received').toBe(st(SID).registeredOps[0]);
    expect(r.model_version_id, 'the version the registration returned').toBe(st(SID).versions[0]!.version_id);
    expect(r.outcome).toBe('registered');
    expect(r.calls).toHaveLength(1);
  });

  it('RED (served route, T1 hostFirstCall): a STREAMED first brief the host routes straight to the Constructor writes the same ONE record', async () => {
    script = [];
    const r = await runWithStageStream(() => {}, async () => await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, message: BRIEF } }));
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    await drafterRaw.settleDrafterRawWritesForTests();
    const body = r.json() as Body;
    expect(body._agent.tool_calls, 'control: the HOST made the build call (no scripted Agent call)').toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
    expect(constructionSent, 'control: one drafter call').toHaveLength(1);
    const recs = rawRows();
    expect(recs).toHaveLength(1);
    expect(recs[0]!.scenario_id).toBe(SID);
    expect(recs[0]!.operation_id).toBe(st(SID).registeredOps[0]);
    expect(recs[0]!.calls[0]!.raw_text === constructionServed[0], 'byte-identical').toBe(true);
  });

  it('RED: the record carries the raw text BYTE-IDENTICAL to what the provider returned, with the prompt hash, model id and build of that call', async () => {
    await firstBrief();
    const [r] = rawRows();
    const sent = constructionSent[0]!;
    const served = constructionServed[0]!;
    const c = r!.calls[0]!;
    expect(c.raw_text === served, 'raw_text === the served string (strict equality, not a parse)').toBe(true);
    expect(Buffer.from(c.raw_text, 'utf8').equals(Buffer.from(served, 'utf8'))).toBe(true);
    expect(c.raw_bytes).toBe(Buffer.byteLength(served, 'utf8'));
    expect(c.raw_truncated).toBe(false);
    expect(c.role).toBe('first');
    expect(c.model, 'the model id SENT').toBe(sent.model);
    expect(c.prompt_alias).toBe('agent.construct');
    expect(c.prompt_sha256, 'sha256 of the instructions SENT').toBe(sha(String(sent.instructions)));
    expect(c.schema_sha256, 'sha256 of the json_schema SENT').toBe(sha(JSON.stringify(sent.text?.format?.schema)));
    expect(c.input_sha256, 'sha256 of the input SENT').toBe(sha(String(sent.input)));
    expect(c.reasoning_effort).toBe(sent.reasoning?.effort ?? null);
    expect(c.max_output_tokens).toBe(sent.max_output_tokens);
    expect(r!.cee_build, 'the served build').toBe(GIT_COMMIT_SHA);
    expect(r!.brief_sha256).toBe(sha(BRIEF));
    expect(r!.brief_chars).toBe(BRIEF.length);
  });

  it('RED: the record holds no second copy of the brief, no call input and no key/header', async () => {
    await firstBrief();
    const [r] = rawRows();
    const all = JSON.stringify(r);
    expect(all.includes(BRIEF), 'the brief is persisted by the registration; only its hash here').toBe(false);
    expect(all.includes(String(constructionSent[0]!.input)), 'the call input is not kept').toBe(false);
    expect(all).not.toMatch(/recording-double-not-a-key|authorization|bearer/i);
    expect(all, 'control: the scan sees the record').toContain(sha(BRIEF));
  });

  it('RED (window): NO write lands in any table an older service’s window counts — and no raw text rides a session append', async () => {
    // A NAMED turn (as the UI always sends), so its answer row really is written through the session store.
    await firstBrief({ turn_id: '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a' });
    const writes = supa.ops.filter((o) => WRITE_OPS.has(o.op));
    expect(writes.map((o) => `${o.op}:${o.table}`), 'the ONLY write is the dedicated table').toEqual(['insert:cee_drafter_raw_responses']);
    expect(writes.filter((o) => WINDOWED_TABLES.includes(o.table))).toEqual([]);
    const served = constructionServed[0]!;
    expect(appended.length, 'control: the turn did commit through the session store').toBeGreaterThan(0);
    expect(appended.filter((a) => JSON.stringify(a).includes(JSON.stringify(served).slice(1, -1))), 'no session append carries the raw text').toEqual([]);
  });

  it('RED: a draft with a construction RETRY still writes ONE record, its two calls in order, each byte-identical to what was served', async () => {
    constructionText = () => `${JSON.stringify(oversized(), null, 2)}\n`;
    const body = await firstBrief();
    expect(body._agent.tool_calls, 'control: refused after the retry').toMatchObject([{ name: 'build_model_from_brief', ok: false, refusal: 'model_too_large' }]);
    expect(constructionSent, 'control: first + one retry').toHaveLength(2);
    const recs = rawRows();
    expect(recs).toHaveLength(1);
    expect(recs[0]!.outcome).toBe('refused');
    expect(recs[0]!.refusal).toBe('model_too_large');
    expect(recs[0]!.calls.map((c) => c.role)).toEqual(['first', 'retry']);
    recs[0]!.calls.forEach((c, i) => {
      expect(c.raw_text === constructionServed[i], `call ${i} byte-identical`).toBe(true);
      expect(c.prompt_sha256, `call ${i} prompt`).toBe(sha(String(constructionSent[i]!.instructions)));
    });
    expect(recs[0]!.calls[0]!.prompt_sha256, 'control: the retry sent different instructions').not.toBe(recs[0]!.calls[1]!.prompt_sha256);
  });

  it('RED: a raw answer over 200 KiB is stored capped, ending with the truncation marker', async () => {
    // Still a valid answer: JSON with trailing whitespace parses, so the draft itself commits.
    constructionText = () => `${JSON.stringify(candidate)}${' '.repeat(300 * 1024)}`;
    const body = await firstBrief();
    expect(body._agent.tool_calls, 'control: the oversized answer still built').toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
    const c = rawRows()[0]!.calls[0]!;
    const served = constructionServed[0]!;
    expect(c.raw_truncated).toBe(true);
    expect(c.raw_bytes).toBe(Buffer.byteLength(served, 'utf8'));
    expect(Buffer.byteLength(c.raw_text, 'utf8')).toBeLessThanOrEqual(200 * 1024);
    expect(c.raw_text).toMatch(/\n\[\[olumi:drafter_raw_truncated original_bytes=\d+ kept_bytes=\d+\]\]$/);
    const kept = c.raw_text.slice(0, c.raw_text.lastIndexOf('\n[[olumi:'));
    expect(served.startsWith(kept), 'what is kept is a prefix of what was served').toBe(true);
    expect(kept.length, 'control: most of the cap is kept').toBeGreaterThan(190 * 1024);
  });

  it.each([
    ['the table is absent (migration not applied)', 'absent'],
    ['the insert is refused', 'refused'],
    ['the client throws', 'throws'],
  ] as const)('GUARD: when %s, the draft still succeeds', async (_label, mode) => {
    supa.mode = mode;
    const body = await firstBrief();
    expect(body._agent.tool_calls).toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
    expect(body.draft_graph?.nodes.length, 'the model reached the user').toBeGreaterThan(0);
  });

  it('GUARD: a write that never answers does not hold the turn', async () => {
    supa.mode = 'hangs';
    script = [callTool('build_model_from_brief', { brief: BRIEF })];
    const body = await turn({ message: BRIEF });
    expect(body._agent.tool_calls).toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
    expect(rawRows(), 'control: the write was started').toHaveLength(1);
    supa.release?.();
    await drafterRaw.settleDrafterRawWritesForTests();
  });

  it('GUARD: with no Supabase credentials nothing is written and the draft succeeds', async () => {
    const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const body = await firstBrief();
      expect(body._agent.tool_calls).toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
      expect(rawRows()).toEqual([]);
    } finally {
      process.env.SUPABASE_URL = url; process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    }
  });

  it('CONTROL: a replayed construction (same brief, model already built) makes no drafter call and writes no second record', async () => {
    await firstBrief();
    expect(rawRows(), 'control: the first draft wrote its record').toHaveLength(1);
    supa.ops = []; constructionSent = [];
    const body = await firstBrief();
    expect(body._agent.tool_calls, 'control: the replay answered ok').toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
    expect(constructionSent, 'control: nothing was generated').toHaveLength(0);
    expect(rawRows()).toEqual([]);
  });

  it('CONTROL: a turn that drafts nothing writes nothing', async () => {
    script = [];
    await turn({ message: 'What does the model say so far?' });
    await drafterRaw.settleDrafterRawWritesForTests();
    expect(constructionSent, 'control: no drafter call').toHaveLength(0);
    expect(rawRows()).toEqual([]);
  });
});
