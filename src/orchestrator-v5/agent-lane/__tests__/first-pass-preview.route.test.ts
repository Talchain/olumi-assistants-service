/** O3: guarded first-pass preview through the real /agent/v1/turn route, with scripted providers only. */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { READY_GRAPH } from './fixtures/first-analysis-graphs.js';
import { withoutNewReferenceMarker } from './fixtures/one-form-levels.js';
import type { PipelineStageEvent } from '../../../cee/unified-pipeline/types.js';

type RunArgs = { payload: { turn_id: string; scenario_id: string }; requestId: string; autoRun?: { draftTurnId: string } };
interface Scenario {
  graph?: unknown;
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
type Step = { at: 'model' } | { at: 'construction' } | { at: 'widen' } | { at: 'run' } | { at: 'frame'; kind: PipelineStageEvent['kind'] };
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

type Rec = Record<string, any>;
const cases = [
  { name: 'delivery', brief: 'We have 5 people today. Hire a tech lead to take team capacity to 6 people and reach delivery reliability of 90% in 6 months.',
    goal: 'Delivery reliability', unit: '%', target: 90, factor: 'Team capacity', factorUnit: 'people', baseline: 5, level: 6, option: 'Hire a tech lead' },
  { name: 'capacity', brief: 'We have 2 specialists today. Hire a specialist to take support capacity to 3 specialists and resolve 100 tickets per week in 6 months.',
    goal: 'Resolved tickets', unit: 'tickets/week', target: 100, factor: 'Support capacity', factorUnit: 'specialists', baseline: 2, level: 3, option: 'Hire a specialist' },
];
function candidate(c = cases[0]!, repaired = false): Rec {
  return {
    goal: { metric: c.goal, operator: '>=', value: c.target, unit: c.unit, horizon_months: 6, provenance: 'explicit' },
    constraints: [],
    options: [{ label: c.option, provenance: 'explicit', changes: [c.factor], interventions: repaired
      ? [{ factor_label: c.factor, value: c.level, value_kind: 'absolute', unit: c.factorUnit, provenance: 'explicit' }] : [] }],
    factors: [{ label: c.factor, role: 'controllable', baseline_known: true, baseline_value: c.baseline,
      unit: c.factorUnit, provenance: 'explicit' }], risks: [],
    outcomes: [{ label: c.goal, provenance: 'inferred' }],
    links: [{ from: c.factor, to: c.goal, direction: 'positive', provenance: 'inferred' }], unknowns: [],
  };
}
function oversized(): Rec {
  const out = candidate();
  for (let i = 0; i < 35; i += 1) {
    const label = `Secondary factor ${i}`;
    out.factors.push({ label, role: 'observable', baseline_known: false, baseline_value: null,
      unit: null, provenance: 'ai_proposed', plausible_max: 100 });
    out.links.push({ from: label, to: cases[0]!.goal, direction: 'positive', provenance: 'inferred' });
  }
  return out;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}
let scripted: Rec[] = [];
let constructionCalls = 0;
let repairHold: Promise<void> | undefined;
let repairEntered = deferred();
let delays: number[] = [];
let activeBrief = cases[0]!.brief;
let widenRisk = false;
let wideningCalls = 0;
function riskReply(input: string): Rec {
  const graph = (JSON.parse(input) as { graph: { nodes: Rec[]; edges: Rec[] } }).graph;
  const goal = graph.nodes.find((n) => n.kind === 'goal')!;
  const option = graph.nodes.find((n) => n.kind === 'option' && n.is_baseline !== true
    && graph.edges.some((e) => e.from === n.id))!;
  const factor = graph.edges.find((e) => e.from === option.id)!.to as string;
  return { risk_suggestions: [{ label: 'Onboarding takes longer', category: 'timing', mechanism: 'relies_on',
    hits_id: option.id, through_id: factor, through_direction: 'positive', affects_id: goal.id, direction: 'negative',
    restates_id: null, relies_on: 'the additional hire reaching full pace quickly', watch_for: 'delivery stays flat' }] };
}
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Rec;
    const instructions = typeof body.instructions === 'string' ? body.instructions : '';
    if (body.text?.format?.name === 'brief_spans') return new Response(JSON.stringify(say('{}')), { status: 200 });
    if (instructions.includes('suggest risks they have not considered') || instructions.includes('METHOD TURN:')) {
      steps.push({ at: 'widen' }); wideningCalls += 1;
      const reply = instructions.includes('suggest risks')
        ? widenRisk ? riskReply(String(body.input)) : { risk_suggestions: [] } : { options: [] };
      return new Response(JSON.stringify(say(JSON.stringify(reply))), { status: 200 });
    }
    if (body.text?.format?.type === 'json_schema') {
      const index = constructionCalls++;
      steps.push({ at: 'construction' });
      if (index === 1) { repairEntered.resolve(); await repairHold; }
      if (delays[index] !== undefined) await new Promise((r) => setTimeout(r, delays[index]));
      return new Response(JSON.stringify(say(JSON.stringify(scripted[Math.min(index, scripted.length - 1)]))), { status: 200 });
    }
    steps.push({ at: 'model' });
    if (constructionCalls === 0) return new Response(JSON.stringify({ output: [{ type: 'function_call',
      name: 'build_model_from_brief', call_id: 'o3-build', arguments: JSON.stringify({ brief: activeBrief }) }] }), { status: 200 });
    return new Response(JSON.stringify(say('Here is where the model stands.')), { status: 200 });
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
      graph: s.graph ?? READY_GRAPH,
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
    const b = req.body as { operation_id?: string; graph?: unknown };
    s.graph = b.graph;
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

let n = 0;
let SID = '';
const nextScenario = () => { n += 1; SID = `7c6e1a2b-3a4f-4e5d-8c6b-7a8f9e0d1c${String(n).padStart(2, '0')}`; };

// Captured from unmodified ca0714a8 with Date fixed at 2026-10-16T12:00:00Z; provider responses below were identical.
const baselinePath = new URL('./fixtures/o3-first-pass-preview.base.json', import.meta.url);
const wideningBaselinePath = new URL('./fixtures/o3-first-pass-widening.base.json', import.meta.url);
type Snapshot = { graph: unknown; reply: unknown; frames: PipelineStageEvent[] };

describe('O3 accepted first-pass preview', () => {
  let app: FastifyInstance;
  let runWithStageStream: RunWithStageStream;
  beforeAll(async () => {
    installFetch(); installRunStub();
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    ({ app, runWithStageStream } = await buildApp());
  }, 120_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => {
    nextScenario(); steps = []; constructionCalls = 0; repairHold = undefined; repairEntered = deferred(); delays = [];
    widenRisk = false; wideningCalls = 0;
    activeBrief = cases[0]!.brief; scripted = [candidate(), candidate(cases[0], true)];
  });
  const streamed = (frames: PipelineStageEvent[]) => runWithStageStream((ev) => {
    frames.push(ev); steps.push({ at: 'frame', kind: ev.kind });
  }, async () => {
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn',
      payload: { kind: 'message', scenario_id: SID, message: activeBrief } });
    expect(response.statusCode, response.body.slice(0, 300)).toBe(200);
    return response.json() as Body & { assistant_text?: string };
  });
  const graphs = (frames: PipelineStageEvent[]) => frames.filter((f): f is GraphReady => f.kind === 'GRAPH_READY');
  const snapshot = (body: { assistant_text?: string }, frames: PipelineStageEvent[]): Snapshot =>
    ({ graph: st(SID).graph, reply: body.assistant_text, frames });

  it.each(cases)('RED→GREEN $name: GRAPH_READY precedes the held repair', async (c) => {
    activeBrief = c.brief; scripted = [candidate(c), candidate(c, true)];
    const release = deferred(); repairHold = release.promise;
    const frames: PipelineStageEvent[] = [];
    const pending = streamed(frames);
    await repairEntered.promise;
    const beforeRelease = [...graphs(frames)];
    release.resolve();
    const body = await pending;
    expect(constructionCalls, 'control: first pass and repair both ran').toBe(2);
    expect(beforeRelease, 'accepted first pass reaches canvas while repair is still held').toHaveLength(1);
    const firstGraph = beforeRelease[0]!.graph as { nodes: { label?: string }[] };
    expect(firstGraph.nodes.some((n) => n.label === c.option)).toBe(true);
    expect(graphs(frames)).toHaveLength(3); // first pass, existing post-repair preview, registered graph
    expect(JSON.stringify(beforeRelease[0]!.graph)).not.toBe(JSON.stringify(graphs(frames).at(-1)!.graph));
    expect(body._agent.tool_calls).toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
  });

  it('negative: an oversized first pass is never previewed, even while repair is held', async () => {
    scripted = [oversized(), oversized()];
    const release = deferred(); repairHold = release.promise;
    const frames: PipelineStageEvent[] = [];
    const pending = streamed(frames);
    await repairEntered.promise;
    const beforeRelease = [...graphs(frames)];
    release.resolve();
    const body = await pending;
    expect(beforeRelease).toEqual([]);
    expect(graphs(frames)).toEqual([]);
    expect(st(SID).registered).toBe(false);
    expect(body._agent.tool_calls).toMatchObject([{ name: 'build_model_from_brief', ok: false, refusal: 'model_too_large' }]);
  });

  it.each(cases)('content $name: final registered graph and reply are byte-identical to base', async (c) => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
    try {
      activeBrief = c.brief; scripted = [candidate(c), candidate(c, true)];
      const frames: PipelineStageEvent[] = [];
      const body = await streamed(frames);
      expect(constructionCalls).toBe(2);
      const actual = snapshot(body, frames);
      {
        const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, Snapshot>;
        // A (18 Oct): the recording predates the disclosure on Olumi's ranges (`withoutNewReferenceMarker`).
        expect(JSON.stringify(withoutNewReferenceMarker(actual.graph, baseline[c.name]!.graph))).toBe(JSON.stringify(baseline[c.name]!.graph));
        expect(actual.reply).toBe(baseline[c.name]!.reply);
      }
    } finally { vi.useRealTimers(); }
  });

  it.each(cases)('no-repair $name: exactly the same frames, registered graph and reply as base', async (c) => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
    try {
      activeBrief = c.brief; scripted = [candidate(c, true)];
      const frames: PipelineStageEvent[] = [];
      const body = await streamed(frames);
      expect(constructionCalls).toBe(1);
      const actual = snapshot(body, frames);
      {
        const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, Snapshot>;
        expect(JSON.stringify(withoutNewReferenceMarker(actual, baseline[`${c.name}-no-repair`]))).toBe(JSON.stringify(baseline[`${c.name}-no-repair`]));
      }
    } finally { vi.useRealTimers(); }
  });

  it.each(cases)('widening $name: real additions preserve base registered graph and reply bytes', async (c) => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
    try {
      activeBrief = c.brief; scripted = [candidate(c), candidate(c, true)]; widenRisk = true;
      const frames: PipelineStageEvent[] = [];
      const body = await streamed(frames);
      expect(wideningCalls).toBeGreaterThan(0);
      const graph = st(SID).graph as { nodes: Rec[] };
      const risk = graph.nodes.find((n) => n.label === 'Onboarding takes longer');
      expect(risk).toMatchObject({ kind: 'risk', proposed_by: 'olumi', analysis_participation: 'retained_excluded',
        draft_widening: { provenance: 'ai_suggested_widen' } });
      expect(body._agent.tool_calls).toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
      const actual = snapshot(body, frames);
      const baseline = JSON.parse(readFileSync(wideningBaselinePath, 'utf8')) as Record<string, Snapshot>;
      expect(JSON.stringify(actual.graph)).toBe(JSON.stringify(baseline[c.name]!.graph));
      expect(actual.reply).toBe(baseline[c.name]!.reply);
    } finally { vi.useRealTimers(); }
  });

  it.each(cases)('FINAL recovery $name: no refused preview; real widening still reaches the base final outcome', async (c) => {
    // Fault injection at the FINAL boundary: reject a graph until the real widener adds its risk.
    // All construction, widening, admission and reply code stays real. This proves refusal timing,
    // without claiming a naturally invalid production graph can be repaired by an addition.
    const { GraphV3 } = await import('../../../schemas/cee-v3.js');
    const parse = GraphV3.safeParse.bind(GraphV3);
    const invalid = parse({ nodes: 'not an array', edges: [] });
    expect(invalid.success).toBe(false);
    let rejected = 0;
    const gate = vi.spyOn(GraphV3, 'safeParse').mockImplementation((value, ...args) => {
      const graph = value as { nodes?: Rec[] } | null;
      if (Array.isArray(graph?.nodes) && graph.nodes.some((n) => n.kind === 'goal')
        && !graph.nodes.some((n) => n.draft_widening?.provenance === 'ai_suggested_widen')) {
        rejected += 1;
        return invalid;
      }
      return parse(value, ...args);
    });
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
    try {
      activeBrief = c.brief; scripted = [candidate(c), candidate(c, true)]; widenRisk = true;
      const release = deferred(); repairHold = release.promise;
      const frames: PipelineStageEvent[] = [];
      const pending = streamed(frames);
      await repairEntered.promise;
      const beforeRelease = [...graphs(frames)];
      release.resolve();
      const body = await pending;
      expect(rejected, 'control: FINAL refused the un-widened graph').toBeGreaterThan(0);
      expect(beforeRelease).toEqual([]);
      expect(wideningCalls, 'FINAL must not prevent the existing widening work').toBeGreaterThan(0);
      expect(graphs(frames), 'only the finally registered, widened graph reaches the canvas').toHaveLength(1);
      expect(st(SID).registered).toBe(true);
      expect(body._agent.tool_calls).toMatchObject([{ name: 'build_model_from_brief', ok: true }]);
      const baseline = JSON.parse(readFileSync(wideningBaselinePath, 'utf8')) as Record<string, Snapshot>;
      const actual = snapshot(body, frames);
      expect(JSON.stringify(actual.graph)).toBe(JSON.stringify(baseline[c.name]!.graph));
      expect(actual.reply).toBe(baseline[c.name]!.reply);
    } finally { gate.mockRestore(); vi.useRealTimers(); }
  });

  it('offline founder durations at 1:100: report existing GRAPH_READY and provider duration fields', async () => {
    delays = [414.29, 176.97];
    const frames: PipelineStageEvent[] = [];
    const body = await streamed(frames);
    expect(constructionCalls).toBe(2);
    const measurements = { ratio: '1:100', first_graph_ready_ms: graphs(frames)[0]!.elapsed_ms,
      graph_ready_ms: graphs(frames).map((f) => f.elapsed_ms),
      provider_calls: (body as Rec)._provider_calls.map((c: Rec) => ({ purpose: c.purpose, duration_ms: c.duration_ms })) };
    process.stdout.write(`O3_MEASUREMENT ${JSON.stringify(measurements)}\n`);
  });

});
