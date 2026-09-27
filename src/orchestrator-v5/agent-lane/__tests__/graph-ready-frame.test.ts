/**
 * ⭐ C6-1: THE CANVAS DRAWS THE FIRST MODEL WHEN IT IS REGISTERED, NOT AT THE END OF THE TURN.
 *
 * Measured (DL C6 design, 25 served first briefs, 27 Sep 2026): the first brief takes 79 s median on the
 * agent lane, and about 15 s of that comes AFTER the model is saved (the post-register reads, the automatic
 * first analysis, and the Agent's closing calls). The browser sends that turn to `/proxy/v5/turn/stream`
 * (UI `streamedDraftEligible`), and the UI already draws a `GRAPH_READY` frame onto the canvas the moment it
 * arrives — but the only producer of that frame was the v2 engine's draft tool, so on the agent lane the canvas
 * stayed empty until COMPLETE.
 *
 * The rule under test: when THIS request's construction COMMITS and is confirmed from state, the route emits
 * exactly ONE `GRAPH_READY` frame carrying that read-back graph, through the same projection COMPLETE's
 * `draft_graph` uses — before the first analysis runs and before the Agent's reply is written. Never on a
 * refusal, never on a replay, and never outside a streamed turn (the buffered routes see no stream context).
 *
 * The real route, the real builder, the real first-analysis runner, over the stateful product double of
 * `first-analysis-route.test.ts`. The stream is the SAME ambient context `/proxy/v5/turn/stream` installs
 * (`runWithStageStream` around `app.inject`), so what these frames are is what the SSE writer would send.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { READY_GRAPH } from './fixtures/first-analysis-graphs.js';
import type { PipelineStageEvent } from '../../../cee/unified-pipeline/types.js';

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
type Step = { at: 'model' } | { at: 'construction' } | { at: 'run' } | { at: 'frame'; kind: PipelineStageEvent['kind'] };
let steps: Step[] = [];

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

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> & { text?: { format?: { type?: string } } };
    if (body.text?.format?.type === 'json_schema') {
      steps.push({ at: 'construction' });
      const out = constructionReturns === 'oversized' ? oversized() : candidate;
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(out) }] }] }), { status: 200 });
    }
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
type GraphReady = Extract<PipelineStageEvent, { kind: 'GRAPH_READY' }>;

const nodeIds = (g: { nodes?: unknown[] } | undefined) => new Set((g?.nodes ?? []).map((n) => String((n as { id?: unknown }).id)));
/** Edge identity: its `id` when it has one, else its endpoints — the pair the UI's drift check reconciles by. */
const edgeIds = (g: { edges?: unknown[] } | undefined) => new Set((g?.edges ?? []).map((e) => {
  const x = e as { id?: unknown; from?: unknown; to?: unknown };
  return typeof x.id === 'string' ? x.id : `${String(x.from)}->${String(x.to)}`;
}));
/** Every key at any depth. */
const deepKeys = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); deepKeys(x, out); }
  return out;
};

let n = 0;
let SID = '';
const nextScenario = () => { n += 1; SID = `7c6e1a2b-3a4f-4e5d-8c6b-7a8f9e0d1c${String(n).padStart(2, '0')}`; };

describe('C6-1: the agent lane streams GRAPH_READY when the first model is registered', () => {
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
    script = []; steps = []; constructionReturns = 'ready';
  });

  /** A turn inside the SAME ambient context `/proxy/v5/turn/stream` installs; frames are also logged in order. */
  const streamed = async (payload: Record<string, unknown>) => {
    const frames: PipelineStageEvent[] = [];
    const r = await runWithStageStream(
      (ev) => { frames.push(ev); steps.push({ at: 'frame', kind: ev.kind }); },
      async () => await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, ...payload } }),
    );
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    return { body: r.json() as Body, frames, graphReady: frames.filter((f): f is GraphReady => f.kind === 'GRAPH_READY') };
  };
  const buffered = async (payload: Record<string, unknown>) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, ...payload } });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    return r.json() as Body;
  };
  const firstBrief = (extra: Record<string, unknown> = {}) => {
    script = [callTool('build_model_from_brief', { brief: BRIEF })];
    return streamed({ message: BRIEF, ...extra });
  };

  it('RED: a first brief that commits a model → exactly ONE GRAPH_READY, schema v3, carrying the committed graph', async () => {
    const { body, graphReady } = await firstBrief();
    expect(body._agent.tool_calls, 'control: the build committed on this turn').toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
    expect(body.draft_graph?.nodes.length, 'control: COMPLETE carries the model').toBeGreaterThan(0);
    expect(graphReady, 'exactly one frame').toHaveLength(1);
    expect(graphReady[0]!.schema_version).toBe('v3');
    expect(typeof graphReady[0]!.elapsed_ms).toBe('number');
  });

  it('RED: its node and edge identities are EXACTLY COMPLETE’s draft_graph (zero drift) and the stored model’s', async () => {
    const { body, graphReady } = await firstBrief();
    const g = graphReady[0]?.graph as { nodes?: unknown[]; edges?: unknown[] } | undefined;
    expect([...nodeIds(g)].sort()).toEqual([...nodeIds(body.draft_graph)].sort());
    expect([...edgeIds(g)].sort()).toEqual([...edgeIds(body.draft_graph)].sort());
    // Bound by identity to what the product stored — not merely "equal to COMPLETE".
    expect([...nodeIds(g)].sort()).toEqual(READY_GRAPH.nodes.map((x) => x.id).sort());
    expect(edgeIds(g).size).toBe(READY_GRAPH.edges.length);
    // The same wire projection COMPLETE uses (buildAppliedGraphWireField): counts travel with the lists.
    expect(g).toMatchObject({ node_count: READY_GRAPH.nodes.length, edge_count: READY_GRAPH.edges.length });
  });

  it('RED: it arrives BEFORE the first analysis is dispatched and BEFORE the Agent’s closing conversation call', async () => {
    const { body } = await firstBrief();
    expect(body._diagnostic_trace.first_analysis, 'control: the first analysis ran on this turn').toMatchObject({ ran: true });
    const at = (p: (s: Step) => boolean) => steps.findIndex(p);
    const frame = at((s) => s.at === 'frame' && s.kind === 'GRAPH_READY');
    const construction = at((s) => s.at === 'construction');
    const run = at((s) => s.at === 'run');
    const lastModel = steps.map((s) => s.at).lastIndexOf('model');
    expect(frame, JSON.stringify(steps)).toBeGreaterThan(-1);
    expect(construction, 'control: construction ran').toBeGreaterThan(-1);
    expect(run, 'control: the first analysis was dispatched').toBeGreaterThan(-1);
    expect(frame, 'after the model was built').toBeGreaterThan(construction);
    expect(frame, 'before the first analysis').toBeLessThan(run);
    expect(frame, 'before the Agent’s closing call').toBeLessThan(lastModel);
  });

  it('RED: the frame carries structure only — no analysis, leader, claim or run field at any depth', async () => {
    const { graphReady } = await firstBrief();
    expect(graphReady, 'control: there is a frame to scan').toHaveLength(1);
    expect(Object.keys(graphReady[0]!).sort()).toEqual(['elapsed_ms', 'graph', 'kind', 'schema_version']);
    const keys = deepKeys(graphReady[0]);
    const forbidden = keys.filter((k) => /^(analysis_ready|analysis_result|analysis_state|claim_permissions|run_turn_id|blocks|first_analysis)$/.test(k) || /^leader/i.test(k));
    expect(forbidden).toEqual([]);
    expect(keys, 'control: the scan sees the graph').toContain('nodes');
  });

  it('RED: a build refused as too large → ZERO frames', async () => {
    constructionReturns = 'oversized';
    const { body, frames } = await firstBrief();
    expect(body._agent.tool_calls, 'control: refused on this turn').toMatchObject([{ name: 'build_model_from_brief', ok: false, refusal: 'model_too_large' }]);
    expect(frames.filter((f) => f.kind === 'GRAPH_READY')).toEqual([]);
  });

  it('RED: a build over a model that already exists → ZERO frames', async () => {
    await firstBrief();
    script = [callTool('build_model_from_brief', { brief: 'Should we outsource delivery instead?' })];
    const { body, frames } = await streamed({ message: 'Should we outsource delivery instead?' });
    expect(body._agent.tool_calls, 'control: refused on this turn').toMatchObject([{ name: 'build_model_from_brief', ok: false, refusal: 'model_already_exists' }]);
    expect(frames.filter((f) => f.kind === 'GRAPH_READY')).toEqual([]);
  });

  it('RED: a replayed construction (the same brief on a new turn) → ZERO frames, and no second analysis', async () => {
    await firstBrief();
    expect(st(SID).runs, 'control: the first turn ran its analysis').toBe(1);
    steps = [];
    const { body, frames } = await firstBrief();
    expect(body._agent.tool_calls, 'control: the tool answered ok').toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
    // The replay arm, proven from the product side: no second construction call, still ONE stored version.
    expect(steps.filter((s) => s.at === 'construction'), 'control: nothing was generated twice').toEqual([]);
    expect(st(SID).versions, 'control: nothing was registered twice').toHaveLength(1);
    expect(frames.filter((f) => f.kind === 'GRAPH_READY')).toEqual([]);
    expect(st(SID).runs).toBe(1);
  });

  it('RED: a retry of the SAME turn_id (the route’s replay) → ZERO frames', async () => {
    const T = '0f1e2d3c-4b5a-4968-8776-6554433221c6';
    const first = await firstBrief({ turn_id: T });
    expect(first.graphReady, 'control: the original turn streamed its frame').toHaveLength(1);
    script = [];
    const again = await streamed({ message: BRIEF, turn_id: T });
    expect(again.body._agent.replayed, 'control: the real replay path').toBe(true);
    expect(again.frames.filter((f) => f.kind === 'GRAPH_READY')).toEqual([]);
  });

  it('RED (X5, DESIGN Q3): a turn that ran a construction carries its retry trace on `_diagnostic_trace`, and only there', async () => {
    const { body } = await firstBrief();
    const trace = (body as unknown as { _diagnostic_trace: { construction?: { retried: boolean } } })._diagnostic_trace;
    expect(trace.construction, 'the construction trace is on the diagnostic trace').toBeDefined();
    expect(typeof trace.construction!.retried).toBe('boolean');
    // Diagnostic only: nothing the model or the user reads carries it.
    const { _diagnostic_trace: _t, ...rest } = body as unknown as Record<string, unknown>;
    expect(JSON.stringify(rest)).not.toContain('"retried"');
  });

  it('CONTRAST: the buffered turn (no stream context) is the same COMPLETE body — no key added or removed', async () => {
    const s = await firstBrief();
    expect(s.graphReady, 'control: the streamed turn emitted').toHaveLength(1);
    nextScenario();
    script = [callTool('build_model_from_brief', { brief: BRIEF })];
    const b = await buffered({ message: BRIEF });
    expect(Object.keys(b).sort()).toEqual(Object.keys(s.body).sort());
    expect([...nodeIds(b.draft_graph)].sort()).toEqual([...nodeIds(s.body.draft_graph)].sort());
    expect(b._agent.tool_calls.map((c) => c.name)).toEqual(s.body._agent.tool_calls.map((c) => c.name));
  });
});
