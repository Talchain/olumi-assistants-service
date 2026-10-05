/**
 * ⭐ A8a (PAUL-TEST 5 Oct gap A8): THE RECORDS BUILD SAYS WHERE IT IS. ~13.7 s of a 20.7 s served draft was opaque, with
 * zero progress frames. `buildModelFromRecords` now emits exactly one typed event per compile stage, in order —
 * parsed → compiled → validated → registered — and a refusal emits only the stage it happened at, failed.
 *
 * The route row drives the REAL stream writer (`streamTurnAsStagedSse`, the one `/proxy/v5/turn/stream` uses) around the
 * REAL agent route and the real records builder; only the provider and the graph store are doubles. Frames are parsed
 * from the SSE bytes, bound by stage name, order, status and `seq`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DraftRecordSet } from '../../../cee/draft/records/grammar.js';
import type { CompileStageEvent } from '../../../cee/unified-pipeline/types.js';
import { buildModelFromRecords } from '../runtime/build-model-from-records.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { constructionRecords, oversizedConstructionRecords, strictRecordsWire } from './records-wire-fixture.js';

const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const SID = '33333333-3333-4333-8333-333333333333';
const BRIEF = 'Hire a tech lead for Delivery reliability.';
const VERSION = { version_id: '00000000-0000-4000-8000-0000000000a8', version_number: 1 };

async function stagesOf(records: unknown, opts: { populated?: boolean } = {}) {
  const events: CompileStageEvent[] = [];
  const writes: Record<string, unknown>[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { writes.push(body as Record<string, unknown>); return { status: 200, json: { model_version: VERSION } }; }
    return { status: 200, json: { graph: { nodes: opts.populated ? [{ id: 'human' }] : [], edges: [] } } };
  };
  const result = await buildModelFromRecords(SID, BRIEF, dispatch, async () => ({ text: JSON.stringify(records) }),
    undefined, (e) => { events.push(e); });
  return { events, writes, result };
}

describe('A8a: one typed event per compile stage, in order', () => {
  it('success: parsed → compiled → validated → registered, each ok, carrying the counts of THIS build', async () => {
    const records: DraftRecordSet = constructionRecords();
    const { events, writes, result } = await stagesOf(strictRecordsWire(records));
    expect(result).toMatchObject({ ok: true, mutated: true });
    expect(events.map((e) => `${e.stage}:${e.status}`)).toEqual(['parsed:ok', 'compiled:ok', 'validated:ok', 'registered:ok']);
    const sent = writes[0]!.graph as { nodes: unknown[]; edges: unknown[] };
    expect(events[0]).toEqual({ stage: 'parsed', status: 'ok', stated_items: records.stated_items.length, claims: records.claims.length });
    expect(events[1]).toMatchObject({ stage: 'compiled', status: 'ok', nodes: sent.nodes.length, edges: sent.edges.length });
    expect(events[2]).toEqual({ stage: 'validated', status: 'ok', within_compact_limits: true });
    expect(events[3]).toEqual({ stage: 'registered', status: 'ok', replayed: false, model_version: VERSION });
  });

  it('a seam refusal emits ONLY parsed:failed, with the seam\'s own reason', async () => {
    const legacy = { goal: { label: 'Delivery reliability' }, factors: [], options: [{ label: 'Keep going' }], links: [] };
    const { events, writes, result } = await stagesOf(legacy);
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'construction_failed' });
    expect(writes).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ stage: 'parsed', status: 'failed', refusal: 'construction_failed' });
    expect(['not_a_record_set', 'graph_shaped_response']).toContain((events[0] as { reason?: string }).reason);
  });

  it('an oversized draft emits parsed and compiled, then validated:failed model_too_large, and nothing after', async () => {
    const { events, writes } = await stagesOf(strictRecordsWire(oversizedConstructionRecords()));
    expect(writes).toHaveLength(0);
    expect(events.map((e) => `${e.stage}:${e.status}`)).toEqual(['parsed:ok', 'compiled:ok', 'validated:failed']);
    expect(events[2]).toEqual({ stage: 'validated', status: 'failed', refusal: 'model_too_large' });
  });

  it('a model added mid-build emits registered:failed model_already_exists, after validated:ok', async () => {
    const { events, writes } = await stagesOf(strictRecordsWire(constructionRecords()), { populated: true });
    expect(writes).toHaveLength(0);
    expect(events.map((e) => `${e.stage}:${e.status}`)).toEqual(['parsed:ok', 'compiled:ok', 'validated:ok', 'registered:failed']);
    expect(events[3]).toEqual({ stage: 'registered', status: 'failed', refusal: 'model_already_exists', reason: 'populated_before_write' });
  });
});

describe('A8a: the stages reach the stream through the REAL stream writer, and the construction trace', () => {
  let app: FastifyInstance;
  let conversation = 0;
  let registered: Record<string, unknown> | null = null;

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { text?: { format?: { type?: string } }; tool_choice?: unknown };
      if (body.text?.format?.type === 'json_schema') {
        return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(strictRecordsWire(constructionRecords())) }] }] }), { status: 200 });
      }
      conversation += 1;
      if (conversation === 1) {
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'build_model_from_brief', call_id: 'b1', arguments: JSON.stringify({ brief: BRIEF }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Here is where the model stands.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { streamTurnAsStagedSse } = await import('../../../routes/streamed-turn-sse.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: registered ?? { nodes: [], edges: [] }, graph_hash: registered ? 'h1' : null }));
    app.post('/assist/v1/scenarios/:id/graph/register', async (req) => {
      registered = (req.body as { graph: Record<string, unknown> }).graph;
      return { registered: true, graph_hash: 'h1', model_version: VERSION };
    });
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [], next_cursor: null }));
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [] }));
    // The SAME writer `/proxy/v5/turn/stream` calls, pointed at the agent lane.
    app.post('/test/turn/stream', async (req, reply) => {
      await streamTurnAsStagedSse({
        app, reply, requestId: 'a8a-stream', internalHeaders: { 'content-type': 'application/json' },
        payload: JSON.stringify(req.body), featureVersion: 'test', endpoint: '/test/turn/stream', internalTarget: '/agent/v1/turn',
      });
      return reply;
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('PROGRESS frames (phase compile) carry the four stages in order, before GRAPH_READY; COMPLETE\'s trace holds the same', async () => {
    const res = await app.inject({ method: 'POST', url: '/test/turn/stream', payload: { kind: 'message', scenario_id: SID, message: BRIEF } });
    expect(res.statusCode).toBe(200);
    const frames = res.body.split('\n\n')
      .map((block) => block.split('\n').find((line) => line.startsWith('data: ')))
      .filter((line): line is string => line !== undefined)
      .map((line) => JSON.parse(line.slice('data: '.length)) as { stage: string; seq: number; phase?: string; labels?: unknown[]; compile?: CompileStageEvent; payload?: Record<string, unknown> });
    const seqs = frames.map((f) => f.seq);
    expect(seqs, 'monotonic seq').toEqual([...seqs].sort((a, b) => a - b));
    const compile = frames.filter((f) => f.stage === 'PROGRESS' && f.phase === 'compile');
    expect(compile.map((f) => `${f.compile!.stage}:${f.compile!.status}`)).toEqual(['parsed:ok', 'compiled:ok', 'validated:ok', 'registered:ok']);
    expect(compile.every((f) => Array.isArray(f.labels) && f.labels.length === 0)).toBe(true);
    expect(compile[3]!.compile).toEqual({ stage: 'registered', status: 'ok', replayed: false, model_version: VERSION });
    const graphReadyAt = frames.findIndex((f) => f.stage === 'GRAPH_READY');
    expect(graphReadyAt, 'control: the model streamed').toBeGreaterThan(-1);
    expect(frames.indexOf(compile[3]!)).toBeLessThan(graphReadyAt);
    const complete = frames.find((f) => f.stage === 'COMPLETE')!;
    const trace = (complete.payload as { _diagnostic_trace?: { construction?: { retried?: boolean; compile_stages?: Array<CompileStageEvent & { elapsed_ms: number }> } } })._diagnostic_trace;
    expect(trace?.construction?.retried).toBe(false);
    expect(trace?.construction?.compile_stages?.map(({ elapsed_ms: _ms, ...e }) => e)).toEqual(compile.map((f) => f.compile));
    expect(trace!.construction!.compile_stages!.every((e) => typeof e.elapsed_ms === 'number')).toBe(true);
    // Diagnostic only: no compile stage on anything the user or the model reads in COMPLETE.
    const { _diagnostic_trace: _t, ...rest } = complete.payload as Record<string, unknown>;
    expect(JSON.stringify(rest)).not.toContain('compile_stages');
  });
});
