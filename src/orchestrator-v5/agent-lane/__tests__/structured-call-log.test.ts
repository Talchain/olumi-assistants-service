/**
 * ⭐ A8b (PAUL-TEST 5 Oct gap A8: "the agent-lane model id is never logged"). Every structured construction call writes
 * ONE server log line — provider, the model id SENT, purpose, prompt and schema identities, latency — and its ledger row
 * carries the same model id. Bound to the wire: every expected value is recomputed HERE from the body the stubbed
 * provider RECEIVED, never read from the helper under test. The key and the headers are never logged.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { constructionRecords, strictRecordsWire } from './records-wire-fixture.js';

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

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const SID = '44444444-4444-4444-8444-444444444444';
const BRIEF = 'Hire a tech lead for Delivery reliability.';
const KEY = 'sk-a8b-test-key-that-must-never-be-logged';

type Sent = { model?: string; instructions?: string; text?: { format?: { type?: string; schema?: unknown } } };

describe('A8b: the structured call is logged with its provider and model id, and its ledger row carries the model id', () => {
  let app: FastifyInstance;
  const sent: Sent[] = [];
  let conversation = 0;
  let logged: unknown[][] = [];
  let priorKey: string | undefined;

  beforeAll(async () => {
    priorKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = KEY;
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Sent;
      if (body.text?.format?.type === 'json_schema') {
        sent.push(body);
        return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(strictRecordsWire(constructionRecords())) }] }] }), { status: 200 });
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
    // The SAME module instance the route imports (after resetModules), so the spy sees the route's own calls.
    const { log } = await import('../../../utils/telemetry.js');
    const record = (...args: unknown[]) => { logged.push(args); };
    vi.spyOn(log, 'info').mockImplementation(record as never);
    vi.spyOn(log, 'warn').mockImplementation(record as never);
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    let registered: Record<string, unknown> | null = null;
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: registered ?? { nodes: [], edges: [] }, graph_hash: registered ? 'h1' : null }));
    app.post('/assist/v1/scenarios/:id/graph/register', async (req) => {
      registered = (req.body as { graph: Record<string, unknown> }).graph;
      return { registered: true, graph_hash: 'h1', model_version: { version_id: '00000000-0000-4000-8000-0000000000b8', version_number: 1 } };
    });
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [], next_cursor: null }));
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [] }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals(); vi.restoreAllMocks();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
  });

  it('one log line per structured call, bound to the body sent; the ledger row carries the same model id; no key, no headers', async () => {
    logged = [];
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, message: BRIEF } });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect(sent, 'control: exactly one structured construction call was sent').toHaveLength(1);
    const wire = sent[0]!;
    expect(typeof wire.model).toBe('string');

    const lines = logged.map((args) => args[0]).filter((o): o is Record<string, unknown> =>
      o !== null && typeof o === 'object' && (o as { event?: unknown }).event === 'agent_lane.structured_call');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      event: 'agent_lane.structured_call', provider: 'openai', model: wire.model, purpose: 'construction',
      prompt_alias: 'agent.construct', prompt_sha256: sha(wire.instructions ?? ''), schema_sha256: sha(JSON.stringify(wire.text!.format!.schema)),
      latency_ms: expect.any(Number), outcome: 'completed', output_chars: expect.any(Number),
    });
    expect(lines[0]!.latency_ms as number).toBeGreaterThanOrEqual(0);

    const rows = (res.json() as { _provider_calls: Array<Record<string, unknown>> })._provider_calls;
    const construction = rows.filter((r) => r.purpose === 'construction');
    expect(construction).toHaveLength(1);
    expect(construction[0]).toMatchObject({ provider: 'openai', model: wire.model, prompt_sha256: lines[0]!.prompt_sha256, schema_sha256: lines[0]!.schema_sha256 });

    // Never the key or the headers, on ANY log line this turn wrote.
    const everything = JSON.stringify(logged);
    expect(everything, 'contrast: the log capture saw the line').toContain('agent_lane.structured_call');
    expect(everything).not.toContain(KEY);
    expect(everything.toLowerCase()).not.toContain('bearer ');
    expect(Object.keys(lines[0]!)).not.toContain('headers');
  });
});
