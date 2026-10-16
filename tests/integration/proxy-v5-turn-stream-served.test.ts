/**
 * The streamed-turn TRANSPORT guarantees, on the path the browser is actually SERVED:
 * `POST /proxy/v5/turn/stream` → `streamTurnAsStagedSse` → `app.inject('/agent/v1/turn')`
 * (deployment default `PROXY_V5_TARGET=agent`, no comparison-mode header).
 *
 * ── WHY THIS FILE EXISTS (#3283) ────────────────────────────────────────────
 * #3283 retired the free-text conversation shape on `/orchestrate/v2/turn`: it now answers 410
 * `conventional_conversation_retired` after admission. Three suites proved the streamed transport by
 * drafting a free-text brief through that conventional target, so every one of their draft rows went
 * red — not because the guarantees broke, but because the turn they rode no longer exists there.
 * The guarantees themselves belong to the shared transport (`streamed-turn-sse.ts`), and the browser
 * still reaches that transport on every streamed turn. So each row is MOVED here, onto the served
 * target, with the same assertion it made; nothing is deleted.
 *
 *   from proxy-v5-turn-stream.test.ts (3)  PS1 browser with no key gets a real streamed turn
 *                                          (its "the injected key authenticates the inner turn" half
 *                                          stays in that file on a kept shape — this bare app has no
 *                                          auth plugin, so a 200 here cannot prove the key), PS2, PS3
 *   from streamed-turn-sse.test.ts   (10)  S1–S10
 *   from streamed-turn-attack.test.ts (4)  A1–A4
 *   = 17 rows, one `it` each, titles kept.
 *
 * ── THE HARNESS ─────────────────────────────────────────────────────────────
 * The established agent-lane route harness (`agent-lane/__tests__/graph-ready-frame.test.ts`): the real
 * Agent route, real builder and real first-analysis runner, a scripted provider behind a stubbed `fetch`,
 * and doubles for the internal routes the Agent dispatches to. Two changes, both to make the commit
 * claims mean something:
 *   · the register double STORES the graph it was sent and the read double SERVES it back, so "the
 *     committed graph" is exactly what the Agent committed (that harness returns a fixed graph instead);
 *   · the scripted provider is a pure function of each request (no shared script queue), and every brief
 *     carries its own team name, which ends up in its option and factor labels. Concurrent lanes are
 *     therefore told apart by IDENTITY, not by counting frames.
 * The real proxy routes (`proxy-v5-turn-stream.ts`, `proxy-v5-turn.ts`) are mounted on the same app, so
 * every turn below goes through the browser ingress and the shared SSE writer exactly as served.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

const ORIGIN = 'https://staging--olumi.netlify.app';
const STREAM_URL = '/proxy/v5/turn/stream';
const BUFFERED_URL = '/proxy/v5/turn';
/** Captured before the provider stub replaces it: the real-socket rows still need a real client. */
const realFetch = globalThis.fetch;

// ── The internal routes' state, per scenario ────────────────────────────────
interface Scenario {
  registered: boolean;
  /** Exactly the graph the Agent sent to `/graph/register`. */
  graph: unknown;
  revision: number;
  versions: { version_id: string; sequence: number; creation: { kind: string; mutation_id: string; source_turn_id: string } }[];
  facts: HandlerFact[];
}
const scenarios = new Map<string, Scenario>();
const st = (sid: string): Scenario => {
  let s = scenarios.get(sid);
  if (s === undefined) {
    s = { registered: false, graph: null, revision: 0, versions: [], facts: [] };
    scenarios.set(sid, s);
  }
  return s;
};
/** Every graph read and every register, by scenario, in order. */
const reads: string[] = [];
const registers: string[] = [];
/** Every construction (model-building) provider call, by the team named in its brief. */
const constructions: string[] = [];

const { runStub } = vi.hoisted(() => ({ runStub: { impl: null as null | ((a: unknown) => Promise<unknown>) } }));
vi.mock('../../src/orchestrator-v5/handlers/chip-click-dispatch.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  dispatchChipClickRunAnalysis: (a: unknown) => runStub.impl!(a),
}));
vi.mock('../../src/orchestrator-v5/build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadPriorFactsWithReadState: async (sid: string) => ({ status: 'ok', facts: [...st(sid).facts] }),
}));

/** Durable answer rows by (scenario, turn): a same-turn_id retry takes the real replay path. */
const rows = new Map<string, { id: string }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  append: vi.fn(async (w: Record<string, unknown>) => {
    const k = `${String(w.scenario_id)}:${String(w.turn_id)}`;
    if (!rows.has(k)) {
      rows.set(k, {
        id: `row-${rows.size + 1}`,
        request_hash: w.request_hash,
        assistant_message: w.assistantMessage ?? null,
        user_message: w.userMessage ?? null,
        llm_calls_used: w.llm_calls_used ?? 0,
        pending_actions: JSON.parse(JSON.stringify(w.pending_actions ?? [])),
      } as { id: string });
    }
    return { id: rows.get(k)!.id };
  }),
};
vi.mock('../../src/orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSessionStore: () => store,
}));
vi.mock('../../src/orchestrator/user-identity.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveUserIdentity: async () => ({ mode: 'off' }),
}));

// ── The scripted provider: a pure function of each request ──────────────────
const TEAM_RE = /team ([A-Z][a-z]+)/;
const briefFor = (team: string) =>
  `Should we hire a tech lead or two developers to lift delivery reliability in team ${team}?`;
/** The labels a team's model carries; a frame or a commit is bound to its lane by these. */
const optionLabel = (team: string) => `Hire a tech lead for team ${team}`;
const factorLabel = (team: string) => `Team ${team} capacity`;
const candidateFor = (team: string) => ({
  goal: { metric: 'Delivery reliability', operator: '>=', value: 90, unit: '%', horizon_months: 6, provenance: 'explicit' },
  constraints: [],
  options: [{ label: optionLabel(team), provenance: 'explicit', interventions: [] }],
  factors: [{ label: factorLabel(team), role: 'controllable', baseline_known: true, baseline_value: 5, unit: 'people', provenance: 'explicit' }],
  risks: [],
  outcomes: [{ label: 'Delivery reliability', provenance: 'inferred' }],
  links: [{ from: factorLabel(team), to: 'Delivery reliability', direction: 'positive', provenance: 'inferred' }],
  unknowns: [],
});
/**
 * A measurable turn duration, so the real-socket flush boundary is a property of the route rather than of
 * how fast the scripted provider answers (the same reason the conventional suites delayed validation).
 */
const CONSTRUCTION_DELAY_MS = 60;
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });

/** The text of the LAST user message in a Responses-API input — the brief this turn was sent. */
function lastUserText(input: unknown): string {
  if (!Array.isArray(input)) return typeof input === 'string' ? input : '';
  for (let i = input.length - 1; i >= 0; i--) {
    const item = input[i] as { role?: unknown; content?: unknown };
    if (item?.role !== 'user') continue;
    if (typeof item.content === 'string') return item.content;
    if (Array.isArray(item.content)) return item.content.map((c) => String((c as { text?: unknown }).text ?? '')).join(' ');
  }
  return '';
}

let callSeq = 0;
function installProvider() {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
    if (String(url).startsWith('http://127.0.0.1')) return realFetch(url as string, init as Parameters<typeof fetch>[1]);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> & { text?: { format?: { type?: string } }; input?: unknown };
    const instructions = typeof body.instructions === 'string' ? body.instructions : '';
    // The brief reading: no reading, so it neither routes the turn nor adds a frame.
    if (instructions.startsWith('You copy words out of a decision brief')) {
      return json(say(JSON.stringify({ goal: null, limits: [], options: [], build: false })));
    }
    // Draft-time widening: nothing to add.
    if (instructions.includes('suggest risks they have not considered') || instructions.includes('METHOD TURN:')) {
      return json(say('{}'));
    }
    // Construction: this brief's own model.
    if (body.text?.format?.type === 'json_schema') {
      const team = TEAM_RE.exec(JSON.stringify(body.input ?? ''))?.[1] ?? 'Unnamed';
      constructions.push(team);
      await new Promise((r) => setTimeout(r, CONSTRUCTION_DELAY_MS));
      return json(say(JSON.stringify(candidateFor(team))));
    }
    // The conversation: build from this turn's brief, then answer once the tool has replied.
    const input = Array.isArray(body.input) ? (body.input as Array<{ type?: unknown }>) : [];
    if (body.tool_choice === 'none' || input[input.length - 1]?.type === 'function_call_output') {
      return json(say('Here is where the model stands.'));
    }
    const team = TEAM_RE.exec(lastUserText(body.input))?.[1] ?? 'Unnamed';
    return json({ output: [{ type: 'function_call', name: 'build_model_from_brief', call_id: `c${callSeq++}`, arguments: JSON.stringify({ brief: briefFor(team) }) }] });
  }));
}

/** The internal routes the Agent dispatches to, plus the real Agent route and the real browser proxies. */
async function buildApp(): Promise<FastifyInstance> {
  vi.resetModules();
  const { registrationTurnId } = await import('../../src/orchestrator-v5/graph-registration/registration-identity.js');
  const { agentV1TurnRoute } = await import('../../src/routes/agent-v1-turn.js');
  const { default: proxyV5TurnStreamRoute } = await import('../../src/routes/proxy-v5-turn-stream.js');
  const { proxyV5TurnRoute } = await import('../../src/routes/proxy-v5-turn.js');
  const a = Fastify({ logger: false });
  a.post('/assist/v1/scenarios/:id/graph', async (req) => {
    const sid = (req.params as { id: string }).id;
    reads.push(sid);
    const s = st(sid);
    if (!s.registered) return { graph: { nodes: [], edges: [] }, graph_hash: 'empty' };
    return {
      graph: JSON.parse(JSON.stringify(s.graph)),
      graph_hash: `rev-${s.revision}`,
      analysis_state: { run_state: { kind: 'never_run' }, leader_claim: { permitted: false, withheld_reason: 'no_analysis' } },
    };
  });
  a.post('/assist/v1/scenarios/:id/graph/register', async (req) => {
    const sid = (req.params as { id: string }).id;
    registers.push(sid);
    const s = st(sid);
    const b = req.body as { operation_id?: string; graph?: unknown };
    const turnId = registrationTurnId(sid, b.operation_id);
    const prior = s.versions.find((v) => v.creation.source_turn_id === turnId);
    s.registered = true;
    if (prior !== undefined) {
      return { registered: true, replayed: true, graph_hash: `rev-${s.revision}`, model_version: { version_id: prior.version_id, version_number: prior.sequence } };
    }
    s.graph = JSON.parse(JSON.stringify(b.graph));
    s.revision += 1;
    const v = { version_id: `00000000-0000-4000-8000-00000000000${s.versions.length + 1}`, sequence: s.versions.length + 1, creation: { kind: 'initial', mutation_id: 'm', source_turn_id: turnId } };
    s.versions.push(v);
    return { registered: true, graph_hash: `rev-${s.revision}`, model_version: { version_id: v.version_id, version_number: v.sequence } };
  });
  a.post('/assist/v1/scenarios/:id/versions', async (req) => ({ versions: [...st((req.params as { id: string }).id).versions].reverse(), next_cursor: null }));
  await a.register(agentV1TurnRoute);
  await proxyV5TurnStreamRoute(a);
  await proxyV5TurnRoute(a);
  await a.ready();
  return a;
}

// ── Frames and graphs ───────────────────────────────────────────────────────
interface StageFrame { stage: string; seq: number; status: string; [k: string]: unknown }
function parseStageFrames(body: string): StageFrame[] {
  const frames: StageFrame[] = [];
  for (const block of body.split('\n\n')) {
    if (!block.includes('event: stage')) continue;
    const line = block.split('\n').find((l) => l.startsWith('data: '));
    if (!line) continue;
    frames.push(JSON.parse(line.slice('data: '.length)) as StageFrame);
  }
  return frames;
}
interface GraphShape { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> }
function asGraphShape(value: unknown): GraphShape | null {
  if (!value || typeof value !== 'object') return null;
  const g = value as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(g.nodes)) return null;
  return { nodes: g.nodes as GraphShape['nodes'], edges: (Array.isArray(g.edges) ? g.edges : []) as GraphShape['edges'] };
}
/** Trap-13 control: two empty graphs compare equal and prove nothing. */
function expectUsableGraph(graph: GraphShape | null, label: string): GraphShape {
  expect(graph, `${label}: no graph found — the comparison would be vacuous`).not.toBeNull();
  expect(graph!.nodes.length, `${label}: zero nodes — the comparison would be vacuous`).toBeGreaterThan(0);
  expect(graph!.edges.length, `${label}: zero edges — the edge comparison would be vacuous`).toBeGreaterThan(0);
  return graph!;
}
const nodeIdentities = (g: GraphShape) => g.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind ?? n.type }));
/** Edges on this path carry no `id`; they are identified by their endpoints. */
const edgeIdentities = (g: GraphShape) => g.edges.map((e) => e.id ?? `${String(e.from)}->${String(e.to)}`);
const graphReadyFrames = (frames: StageFrame[]) => frames.filter((f) => f.stage === 'GRAPH_READY');
const completeOf = (frames: StageFrame[]) => frames.find((f) => f.stage === 'COMPLETE');
const committedGraph = (sid: string) => asGraphShape(st(sid).graph);
type AgentBody = { response_version?: unknown; draft_graph?: unknown; _agent?: { tool_calls: Array<{ name: string; ok: boolean; refusal?: string }> } };

let n = 0;
const nextScenarioId = () => `7c6e1a2b-3a4f-4e5d-8c6b-${(++n).toString(16).padStart(12, '0')}`;
let teamN = 0;
/** A fresh capitalised team name per lane: `Teama`, `Teamb`, … — never a prefix of another (fixed length per run). */
const nextTeam = () => `Team${String.fromCharCode(97 + (teamN % 26))}${String.fromCharCode(97 + Math.floor(teamN++ / 26) % 26)}`;
/** True when `serialised` carries `team`'s option label and no OTHER listed team's. */
function boundTo(serialised: string, team: string, others: readonly string[]): boolean {
  return serialised.includes(`"${optionLabel(team)}"`) && others.every((o) => o === team || !serialised.includes(`"${optionLabel(o)}"`));
}

const browserHeaders = { origin: ORIGIN, 'content-type': 'application/json' };
const turnPayload = (scenarioId: string, team: string, turnId: string = randomUUID()) => ({
  kind: 'message', turn_id: turnId, scenario_id: scenarioId, message: briefFor(team),
});

/** Process-survival instrumentation. */
const uncaught: unknown[] = [];
const unhandled: unknown[] = [];
const onUncaught = (e: unknown) => uncaught.push(e);
const onUnhandled = (e: unknown) => unhandled.push(e);

const ENV = {
  AGENT_LANE_ENABLED: 'true',
  AGENT_LANE_PREVIEW: 'false',
  BROWSER_PROXY_ENABLED: 'true',
  BROWSER_PROXY_ALLOWED_ORIGINS: ORIGIN,
  ASSIST_API_KEY: 'served-stream-suite-key',
  PROXY_V5_TARGET: 'agent',
} as const;

describe('POST /proxy/v5/turn/stream — the SERVED streamed turn (agent target)', () => {
  let app: FastifyInstance;
  let port = 0;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    process.on('uncaughtException', onUncaught);
    process.on('unhandledRejection', onUnhandled);
    for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
    installProvider();
    runStub.impl = async () => ({
      outcome: 'ok', commitPerformed: true, graph: null, mayNameLeadingOption: false, analysisReady: { status: 'ready' },
      response: { response_version: 2, assistant_text: 'Ran.', suggested_actions: [], insights: [], stage_indicator: 'analyse', blocks: [] },
    });
    app = await buildApp();
    await app.ready();
  }, 120_000);

  // Injectable served rows need no socket. Bind only for the three explicit socket witnesses.
  const ensureListening = async () => {
    if (port !== 0) return;
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as { port: number }).port;
  };

  afterAll(async () => {
    await app?.close();
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    process.off('uncaughtException', onUncaught);
    process.off('unhandledRejection', onUnhandled);
  });

  beforeEach(() => {
    reads.length = 0;
    registers.length = 0;
    constructions.length = 0;
    uncaught.length = 0;
    unhandled.length = 0;
  });

  const stream = (scenarioId: string, team: string, turnId?: string) =>
    app.inject({ method: 'POST', url: STREAM_URL, headers: browserHeaders, payload: turnPayload(scenarioId, team, turnId) });
  const buffered = (scenarioId: string, team: string) =>
    app.inject({ method: 'POST', url: BUFFERED_URL, headers: browserHeaders, payload: turnPayload(scenarioId, team) });

  // ═══════════════════════════════════════════════════════════════════════════
  // INGRESS (from proxy-v5-turn-stream.test.ts)
  // ═══════════════════════════════════════════════════════════════════════════

  it('is registered, and a browser with NO service key gets a real streamed turn', async () => {
    const res = await stream(nextScenarioId(), nextTeam());
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/event-stream');
    const frames = parseStageFrames(res.body);
    expect(frames[0].stage).toBe('DRAFTING');
    const complete = frames[frames.length - 1];
    expect(complete.stage).toBe('COMPLETE');
    expect(complete.status_code, JSON.stringify(complete.payload).slice(0, 300)).toBe(200);
    expect(frames.some((f) => f.stage === 'GRAPH_READY')).toBe(true);
    // Served BY THE AGENT LANE: the staging failure this target once had was a perfect answer from the
    // other engine (`streamed-turn-sse.ts`, STREAMED_TURN_INTERNAL_TARGET). The `_agent` sidecar is that lane's.
    expect((complete.payload as AgentBody)._agent, 'the streamed turn was not served by the Agent route').toBeDefined();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // COMMIT SEMANTICS (proxy-v5-turn-stream PS2/PS3, streamed-turn-sse S1–S3)
  // ═══════════════════════════════════════════════════════════════════════════

  it('a streamed draft COMMITS the graph to the scenario store', async () => {
    const sid = nextScenarioId();
    const team = nextTeam();
    const res = await stream(sid, team);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(registers.filter((s) => s === sid).length, 'streamed draft turn wrote no graph').toBeGreaterThan(0);
    const committed = expectUsableGraph(committedGraph(sid), 'committed graph');
    // Its OWN model: the commit is bound to this brief by label, not merely "some graph was stored".
    expect(JSON.stringify(committed)).toContain(`"${optionLabel(team)}"`);
  });

  it('a browser-streamed draft COMMITS, and the read-back path sees it', async () => {
    const sid = nextScenarioId();
    await stream(sid, nextTeam());
    const committed = expectUsableGraph(committedGraph(sid), 'browser-streamed commit');
    const before = JSON.stringify(st(sid).graph);

    // A second streamed first brief on the same scenario (a DIFFERENT brief, so this is not a replay)
    // must SEE the model and decline to draft over it.
    reads.length = 0;
    registers.length = 0;
    constructions.length = 0;
    const second = await stream(sid, nextTeam());
    expect(second.statusCode).toBe(200);
    const body = completeOf(parseStageFrames(second.body))!.payload as AgentBody;
    expect(reads.filter((s) => s === sid).length, 'the follow-up turn never read the scenario graph').toBeGreaterThan(0);
    expect(body._agent?.tool_calls, 'the follow-up turn did not see the committed graph').toMatchObject([
      { name: 'build_model_from_brief', ok: false, refusal: 'model_already_exists' },
    ]);
    expect(constructions, 'the follow-up turn re-drafted — it did not see the committed graph').toEqual([]);
    expect(registers.filter((s) => s === sid)).toEqual([]);
    expect(JSON.stringify(st(sid).graph)).toBe(before);
    expect(committed.nodes.length).toBeGreaterThan(0);
  });

  it('the READ-BACK path sees the streamed turn\'s graph — a later turn is not drafting into a void', async () => {
    const sid = nextScenarioId();
    await stream(sid, nextTeam());
    const persisted = expectUsableGraph(committedGraph(sid), 'persisted graph after streamed draft');

    // The later turn is the BUFFERED browser turn, as in the conventional original.
    reads.length = 0;
    registers.length = 0;
    constructions.length = 0;
    const second = await buffered(sid, nextTeam());
    expect(second.statusCode).toBe(200);
    expect(reads.filter((s) => s === sid).length, 'the follow-up turn never read the scenario graph').toBeGreaterThan(0);
    expect((second.json() as AgentBody)._agent?.tool_calls).toMatchObject([
      { name: 'build_model_from_brief', ok: false, refusal: 'model_already_exists' },
    ]);
    expect(constructions, 'the follow-up turn drafted again — it did not see the committed graph').toEqual([]);
    expect(registers.filter((s) => s === sid), 'the follow-up turn re-drafted — it did not see the committed graph').toEqual([]);
    expect(committedGraph(sid)!.nodes.length).toBe(persisted.nodes.length);
  });

  it('EQUIVALENCE — the streamed turn commits the same graph identity as the buffered turn', async () => {
    const team = nextTeam();
    const streamedScenario = nextScenarioId();
    const bufferedScenario = nextScenarioId();
    await stream(streamedScenario, team);
    await buffered(bufferedScenario, team);
    const s = expectUsableGraph(committedGraph(streamedScenario), 'streamed committed graph');
    const b = expectUsableGraph(committedGraph(bufferedScenario), 'buffered committed graph');
    expect(nodeIdentities(s)).toEqual(nodeIdentities(b));
    expect(edgeIdentities(s)).toEqual(edgeIdentities(b));
  });

  it('persists the GRAPH_READY frame\'s canonical graph, provenance and option identity', async () => {
    const sid = nextScenarioId();
    const res = await stream(sid, nextTeam());
    const frame = graphReadyFrames(parseStageFrames(res.body)).at(-1);
    expect(frame, 'no GRAPH_READY frame on the browser route').toBeDefined();
    const early = expectUsableGraph(asGraphShape(frame!.graph), 'GRAPH_READY graph');
    const committed = expectUsableGraph(committedGraph(sid), 'committed graph');
    // v3 carries options and the goal as NODES (the conventional v2 frame carried `options` and
    // `goal_node_id` beside them); the identity and provenance relation pinned is the same.
    const projection = (g: GraphShape) => ({
      nodes: g.nodes
        .map((node) => ({ id: node.id, label: node.label, kind: node.kind ?? node.type, provenance: node.provenance, is_baseline: node.is_baseline, interventions: node.interventions }))
        .sort((x, y) => String(x.id).localeCompare(String(y.id))),
      edges: g.edges
        .map((e) => ({ id: e.id, from: e.from, to: e.to }))
        .sort((x, y) => `${String(x.from)}>${String(x.to)}`.localeCompare(`${String(y.from)}>${String(y.to)}`)),
    });
    const options = (g: GraphShape) => g.nodes.filter((x) => x.kind === 'option');
    const goalId = (g: GraphShape) => g.nodes.find((x) => x.kind === 'goal')?.id;
    expect(options(early).length, 'GRAPH_READY carried no option').toBeGreaterThan(0);
    expect(options(committed).length, 'persisted options were lost').toBeGreaterThan(0);
    expect(typeof goalId(early), 'GRAPH_READY goal identity was lost').toBe('string');
    expect(typeof goalId(committed), 'persisted goal identity was lost').toBe('string');
    expect(early.nodes.every((x) => x.provenance !== undefined), 'control: provenance is present to compare').toBe(true);
    expect(projection(early)).toEqual(projection(committed));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CROSS-FRAME IDENTITY (streamed-turn-sse S4, S5)
  // ═══════════════════════════════════════════════════════════════════════════

  it('GRAPH_READY\'s node identity EQUALS the COMPLETE payload\'s — reconciliation by id is safe', async () => {
    const res = await stream(nextScenarioId(), nextTeam());
    const frames = parseStageFrames(res.body);
    const ready = graphReadyFrames(frames);
    const complete = completeOf(frames);
    expect(ready.length, 'no GRAPH_READY frame — the streamed turn emitted no staged graph').toBeGreaterThan(0);
    expect(complete, 'no COMPLETE frame').toBeDefined();
    // Both shapes read here and compared here. On this lane the LAST frame is the committed model and is
    // what COMPLETE applies (`agent-v1-turn.ts` C6-1/S3); nothing the canvas drew earlier may vanish.
    const terminal = expectUsableGraph(asGraphShape((complete!.payload as AgentBody).draft_graph), 'COMPLETE payload graph');
    const last = expectUsableGraph(asGraphShape(ready.at(-1)!.graph), 'last GRAPH_READY graph');
    expect(nodeIdentities(last)).toEqual(nodeIdentities(terminal));
    expect(edgeIdentities(last)).toEqual(edgeIdentities(terminal));
    const terminalIds = new Set(terminal.nodes.map((x) => x.id));
    for (const f of ready) {
      const drawn = expectUsableGraph(asGraphShape(f.graph), `GRAPH_READY seq ${f.seq}`);
      expect(drawn.nodes.filter((x) => !terminalIds.has(x.id)), `GRAPH_READY seq ${f.seq} drew a node COMPLETE dropped`).toEqual([]);
    }
  });

  it('the graph the client reconciles against is the graph that was COMMITTED', async () => {
    const sid = nextScenarioId();
    const res = await stream(sid, nextTeam());
    const frame = graphReadyFrames(parseStageFrames(res.body)).at(-1);
    expect(frame).toBeDefined();
    const early = expectUsableGraph(asGraphShape(frame!.graph), 'GRAPH_READY frame graph');
    const committed = expectUsableGraph(committedGraph(sid), 'committed graph');
    expect(nodeIdentities(early)).toEqual(nodeIdentities(committed));
    expect(edgeIdentities(early)).toEqual(edgeIdentities(committed));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FRAME SEQUENCE (streamed-turn-sse S6, S7)
  // ═══════════════════════════════════════════════════════════════════════════

  it('no pre-terminal frame may present as complete, and GRAPH_READY precedes COACHING_READY precedes COMPLETE', async () => {
    const frames = parseStageFrames((await stream(nextScenarioId(), nextTeam())).body);
    const stages = frames.map((f) => f.stage);
    for (const f of frames.slice(0, -1)) {
      expect(f.status, `${f.stage} presented as complete before the terminal frame`).toBe('in_progress');
    }
    expect(frames[frames.length - 1].status).toBe('complete');
    const iGraph = stages.indexOf('GRAPH_READY');
    const iCoaching = stages.indexOf('COACHING_READY');
    const iComplete = stages.indexOf('COMPLETE');
    expect(iGraph).toBeGreaterThan(-1);
    expect(iGraph).toBeLessThan(iComplete);
    if (iCoaching > -1) {
      expect(iGraph).toBeLessThan(iCoaching);
      expect(iCoaching).toBeLessThan(iComplete);
    }
    const elapsed = frames.map((f) => f.elapsed_ms).filter((v): v is number => typeof v === 'number');
    expect(elapsed.length, 'control: the frames carry their own clock').toBeGreaterThan(0);
    for (let i = 1; i < elapsed.length; i++) expect(elapsed[i]).toBeGreaterThanOrEqual(elapsed[i - 1]);
  });

  it('the terminal frame carries the turn\'s status_code and the turn body as payload', async () => {
    const complete = completeOf(parseStageFrames((await stream(nextScenarioId(), nextTeam())).body))!;
    expect(complete.status_code).toBe(200);
    expect(complete.payload).toBeTypeOf('object');
    expect((complete.payload as AgentBody).response_version).toBe(2);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CLAIM SAFETY (streamed-turn-sse S8)
  // ═══════════════════════════════════════════════════════════════════════════

  it('pre-terminal frames carry no claim-bearing keys — with a positive control on the terminal frame', async () => {
    const frames = parseStageFrames((await stream(nextScenarioId(), nextTeam())).body);
    const CLAIM_KEYS = ['coaching', 'causal_claims', 'assistant_text', 'insights', 'suggested_actions'];
    const deepKeys = (value: unknown, acc = new Set<string>()): Set<string> => {
      if (Array.isArray(value)) for (const v of value) deepKeys(v, acc);
      else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { acc.add(k); deepKeys(v, acc); }
      return acc;
    };
    expect(frames.length, 'control: there are pre-terminal frames to scan').toBeGreaterThan(1);
    for (const f of frames.slice(0, -1)) {
      const keys = deepKeys(f);
      for (const claimKey of CLAIM_KEYS) expect(keys.has(claimKey), `${f.stage} frame carried "${claimKey}"`).toBe(false);
    }
    expect(deepKeys(frames[frames.length - 1]).has('assistant_text')).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ADDITIVE GUARANTEE (streamed-turn-sse S9)
  // ═══════════════════════════════════════════════════════════════════════════

  it('the buffered turn emits no SSE and returns JSON', async () => {
    const res = await buffered(nextScenarioId(), nextTeam());
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).not.toContain('event: stage');
    expect(JSON.parse(res.body).response_version).toBe(2);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INCREMENTAL DELIVERY over a REAL SOCKET (streamed-turn-sse S10)
  // ═══════════════════════════════════════════════════════════════════════════

  it('the first frame reaches the client BEFORE the turn completes', async () => {
    await ensureListening();
    const res = await realFetch(`http://127.0.0.1:${port}${STREAM_URL}`, {
      method: 'POST',
      headers: { ...browserHeaders, accept: 'text/event-stream' },
      body: JSON.stringify(turnPayload(nextScenarioId(), nextTeam())),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const chunks: string[] = [];
    const stages: string[] = [];
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = dec.decode(value, { stream: true });
      chunks.push(text);
      buf += text;
      let i: number;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (!block.includes('event: stage')) continue;
        const line = block.split('\n').find((l) => l.startsWith('data: '));
        if (line) stages.push((JSON.parse(line.slice(6)) as StageFrame).stage);
      }
    }
    expect(stages.length).toBeGreaterThanOrEqual(2);
    expect(stages[0]).toBe('DRAFTING');
    expect(stages[stages.length - 1]).toBe('COMPLETE');
    expect(chunks.length, 'the whole stream arrived as ONE chunk — delivery is buffered, not staged').toBeGreaterThan(1);
    expect(chunks[0]).toContain('DRAFTING');
    expect(chunks[0], 'the terminal frame shared the first chunk with DRAFTING — nothing was delivered early').not.toContain('COMPLETE');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ATTACK BATTERY (streamed-turn-attack A1–A4)
  // ═══════════════════════════════════════════════════════════════════════════

  it('4 concurrent streamed turns x5 rounds: no frame crossing, each commits its own scenario', async () => {
    // The frame classes ONE lane emits alone are the expectation for every concurrent lane: a crossed
    // context would double a frame in one stream and drop it in another.
    const solo = parseStageFrames((await stream(nextScenarioId(), nextTeam())).body);
    const count = (frames: StageFrame[], s: string) => frames.filter((f) => f.stage === s).length;
    expect(count(solo, 'DRAFTING')).toBe(1);
    expect(count(solo, 'GRAPH_READY'), 'control: a lone lane streams its model').toBeGreaterThan(0);
    expect(count(solo, 'COMPLETE')).toBe(1);
    for (let round = 0; round < 5; round++) {
      const lanes = [0, 1, 2, 3].map(() => ({ scenarioId: nextScenarioId(), team: nextTeam() }));
      const teams = lanes.map((l) => l.team);
      const results = await Promise.all(lanes.map((lane, i) => new Promise<string>((resolve, reject) => {
        // Staggered so the turns genuinely overlap mid-flight.
        setTimeout(() => { stream(lane.scenarioId, lane.team).then((r) => resolve(r.body), reject); }, i * 15);
      })));
      for (let i = 0; i < lanes.length; i++) {
        const frames = parseStageFrames(results[i]);
        for (const s of ['DRAFTING', 'BRIEF_READ', 'GRAPH_READY', 'COACHING_READY', 'COMPLETE']) {
          expect(count(frames, s), `round ${round} lane ${i} ${s}`).toBe(count(solo, s));
        }
        expect(frames.map((f) => f.seq)).toEqual(frames.map((_, j) => j));
        const complete = completeOf(frames)!;
        expect(complete.status_code, `round ${round} lane ${i} status`).toBe(200);
        // BY IDENTITY: every model frame and the terminal body are this lane's own model, no other lane's.
        for (const f of graphReadyFrames(frames)) {
          expect(boundTo(JSON.stringify(f.graph), lanes[i].team, teams), `round ${round} lane ${i} GRAPH_READY crossed`).toBe(true);
        }
        expect(boundTo(JSON.stringify((complete.payload as AgentBody).draft_graph), lanes[i].team, teams), `round ${round} lane ${i} COMPLETE crossed`).toBe(true);
        // Its own commit landed, under its own scenario.
        expect(boundTo(JSON.stringify(st(lanes[i].scenarioId).graph), lanes[i].team, teams), `round ${round} lane ${i} commit missing or crossed`).toBe(true);
      }
    }
    expect(uncaught).toHaveLength(0);
    expect(unhandled).toHaveLength(0);
  }, 120_000);

  it('a buffered turn running concurrently with a streamed turn gets no SSE and both commit', async () => {
    for (let round = 0; round < 5; round++) {
      const sStream = nextScenarioId();
      const sBuf = nextScenarioId();
      const tStream = nextTeam();
      const tBuf = nextTeam();
      // Even rounds start the buffered turn 20 ms after the stream (the original order); odd rounds start it
      // 20 ms BEFORE, so the buffered turn reaches its model while the stream is still open — the window in
      // which a leaked stage emitter would put the buffered turn's model into the streamed turn's frames.
      const later = <T>(f: () => Promise<T>) => new Promise<T>((resolve, reject) => { setTimeout(() => { f().then(resolve, reject); }, 20); });
      const [streamed, buf] = round % 2 === 0
        ? await Promise.all([stream(sStream, tStream), later(() => buffered(sBuf, tBuf))])
        : await Promise.all([later(() => stream(sStream, tStream)), buffered(sBuf, tBuf)]);
      expect(buf.statusCode).toBe(200);
      expect(String(buf.headers['content-type'])).toContain('application/json');
      expect(buf.body).not.toContain('event: stage');
      const frames = graphReadyFrames(parseStageFrames(streamed.body));
      expect(frames.length, 'the streamed turn got no model frame').toBeGreaterThan(0);
      // The buffered turn's model never leaked into the streamed turn's frames.
      for (const f of frames) expect(boundTo(JSON.stringify(f.graph), tStream, [tStream, tBuf])).toBe(true);
      expect(boundTo(JSON.stringify(st(sStream).graph), tStream, [tStream, tBuf])).toBe(true);
      expect(boundTo(JSON.stringify(st(sBuf).graph), tBuf, [tStream, tBuf])).toBe(true);
    }
    expect(uncaught).toHaveLength(0);
    expect(unhandled).toHaveLength(0);
  }, 120_000);

  it('two real-socket streams in parallel each receive exactly their own frame set', async () => {
    await ensureListening();
    const run = async (scenarioId: string, team: string, delayMs: number) => {
      await new Promise((r) => setTimeout(r, delayMs));
      const res = await realFetch(`http://127.0.0.1:${port}${STREAM_URL}`, {
        method: 'POST',
        headers: { ...browserHeaders, accept: 'text/event-stream' },
        body: JSON.stringify(turnPayload(scenarioId, team)),
      });
      expect(res.status).toBe(200);
      return parseStageFrames(await res.text());
    };
    const a = { sid: nextScenarioId(), team: nextTeam() };
    const b = { sid: nextScenarioId(), team: nextTeam() };
    const teams = [a.team, b.team];
    const [framesA, framesB] = await Promise.all([run(a.sid, a.team, 0), run(b.sid, b.team, 25)]);
    for (const [lane, frames] of [[a, framesA], [b, framesB]] as const) {
      expect(graphReadyFrames(frames).length, lane.team).toBeGreaterThan(0);
      for (const f of graphReadyFrames(frames)) expect(boundTo(JSON.stringify(f.graph), lane.team, teams), `${lane.team} GRAPH_READY crossed`).toBe(true);
      expect(frames.filter((f) => f.stage === 'COMPLETE'), lane.team).toHaveLength(1);
      expect(frames.map((f) => f.seq)).toEqual(frames.map((_, j) => j));
      expect(boundTo(JSON.stringify(st(lane.sid).graph), lane.team, teams), `${lane.team} commit missing or crossed`).toBe(true);
    }
    expect(uncaught).toHaveLength(0);
    expect(unhandled).toHaveLength(0);
  }, 90_000);

  it('destroying the socket after the FIRST frame: turn still commits, server survives, next request fine', async () => {
    await ensureListening();
    const sid = nextScenarioId();
    const team = nextTeam();
    const turnId = randomUUID();
    const body = JSON.stringify(turnPayload(sid, team, turnId));
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: STREAM_URL, method: 'POST', headers: { ...browserHeaders, 'content-length': Buffer.byteLength(body) } },
        (res) => {
          res.on('data', () => {
            // First bytes seen (DRAFTING) — kill the connection mid-turn.
            res.destroy();
            req.destroy();
            resolve();
          });
          res.on('error', () => {});
        },
      );
      req.on('error', (e: NodeJS.ErrnoException) => { if (e.code !== 'ECONNRESET') reject(e); });
      req.end(body);
    });
    // The doctrine: the turn keeps running and COMMITS. Poll for the model AND the turn's own answer row,
    // so "committed" means the turn ran to its end, not merely that it got as far as the build.
    const deadline = Date.now() + 15_000;
    while ((!st(sid).registered || !rows.has(`${sid}:${turnId}`)) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(boundTo(JSON.stringify(st(sid).graph), team, [team]), 'disconnected turn never committed its model').toBe(true);
    expect(rows.has(`${sid}:${turnId}`), 'disconnected turn never recorded its answer — dropped mid-flight').toBe(true);
    // Let any late frame writes fire against the dead socket.
    await new Promise((r) => setTimeout(r, 500));
    const after = await realFetch(`http://127.0.0.1:${port}${STREAM_URL}`, {
      method: 'POST',
      headers: browserHeaders,
      body: JSON.stringify(turnPayload(nextScenarioId(), nextTeam())),
    });
    expect(after.status).toBe(200);
    expect(parseStageFrames(await after.text()).filter((f) => f.stage === 'COMPLETE')).toHaveLength(1);
    expect(uncaught, `uncaughtException fired: ${String(uncaught[0])}`).toHaveLength(0);
    expect(unhandled, `unhandledRejection fired: ${String(unhandled[0])}`).toHaveLength(0);
  }, 60_000);
});
