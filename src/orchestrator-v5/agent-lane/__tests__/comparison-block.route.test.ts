/**
 * "Ask about this comparison", the input half, through the LIVE route (`comparison-block.ts`; lease #85 5949274551). An
 * ORDINARY typed turn ("Why did the result change?"), the model stubbed, the graph read = a SERVED cold read
 * (`fixtures/comparison`). What the model is sent is the proof: the read's pair reaches it as ONE `comparison` block in the
 * CURRENT MODEL STATE, in Olumi's own code line; a read with no pair sends none.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rerunPlanForGraph } from '../rerun-explanation.js';

type Read = { json: { graph: { nodes: unknown[] }; graph_hash: string; current_read: { run_delta?: unknown } } };
const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/comparison/${name}.json`, import.meta.url), 'utf8')) as Read;
const C2_PARTIAL = read('c2-partial');
const C1_PARTIAL = read('c1-partial');
const NO_PAIR = read('stale-no-pair');
const SCENARIO = '3c9b1e2d-4f5a-4b6c-8d7e-9f0a1b2c3dc2';

type Row = Record<string, unknown>;
const rows: Row[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_scenario: string, id: string) => {
    const r = rows.find((x) => x.turn_id === id);
    return r === undefined ? null : { id: String(r.turn_id), request_hash: r.request_hash, assistant_message: r.assistantMessage ?? null,
      user_message: r.userMessage ?? null, llm_calls_used: r.llm_calls_used ?? 0, pending_actions: r.pending_actions ?? [] };
  }),
  append: vi.fn(async (row: Row) => { rows.push({ ...row }); return { id: String(row.turn_id) }; }),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

/** Every string anywhere in a decoded request (the state item is JSON text inside an input item). */
const textsOf = (v: unknown): string[] => typeof v === 'string' ? [v]
  : Array.isArray(v) ? v.flatMap(textsOf) : v !== null && typeof v === 'object' ? Object.values(v).flatMap(textsOf) : [];

let served: Read = C2_PARTIAL;
const requests: string[] = [];
/** Scripted model outputs, in order (default: one plain answer); `onCall(n)` runs before the n-th model call is answered. */
let outputs: unknown[][] = [];
let onCall: (n: number) => void = () => undefined;

describe('"Ask about this comparison" on the live route: the model is sent the read\'s pair', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      requests.push(typeof init?.body === 'string' ? init.body : '');
      onCall(requests.length);
      const output = outputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'The comparison rests on that change.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => served.json);
    // The run turn: C1 PARTIAL's own Run, result and pair (the canonical read then selects the same pair until another writer).
    const runJ = C1_PARTIAL.json as unknown as Record<string, unknown>;
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [],
      graph_hash: runJ.graph_hash, blocks: [runJ.analysis_result], analysis_state: runJ.analysis_state, analysis_ready: { status: 'ready' },
      run_delta: (runJ.current_read as { run_delta: unknown }).run_delta }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => { rows.length = 0; requests.length = 0; served = C2_PARTIAL; outputs = []; onCall = () => undefined; });

  const ask = () => app.inject({ method: 'POST', url: '/agent/v1/turn',
    payload: { scenario_id: SCENARIO, turn_id: randomUUID(), message: 'Why did the result change?' } });

  it('IDENTITY: the model\'s request carries the comparison block with the plan\'s own code line', async () => {
    const res = await ask();
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect(requests.length, 'the model really answered').toBeGreaterThan(0);
    const codeLine = rerunPlanForGraph(C2_PARTIAL.json.current_read.run_delta, C2_PARTIAL.json.graph, false)!.codeLine;
    expect(codeLine, 'the control: the served pair names its change').toContain('Split Sprint Capacity');
    // The state item travels as JSON text inside the request: decode it, then read the block by its own fields.
    const decoded = textsOf(JSON.parse(requests[0]!)).join('\n');
    expect(decoded).toContain(JSON.stringify({ what_changed: codeLine, cause_licensed: false }).slice(1, -1));
  });

  it('CONTROL: a stale read with no pair sends no comparison block', async () => {
    served = NO_PAIR;
    const res = await ask();
    expect(res.statusCode).toBe(200);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.some((r) => r.includes('what_changed')), 'no comparison block').toBe(false);
  });

  it('RACE (Codex buddy P2): the Agent runs an analysis, another writer\'s Run lands during the narrating call → the reply is bound to the NEWER Run', async () => {
    served = C1_PARTIAL;
    outputs = [
      [{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'the user asked to rerun' }), call_id: 'r1' }],
      [{ type: 'message', content: [{ type: 'output_text', text: 'Done: the analysis ran again.' }] }],
    ];
    // The second model call is the narration after the Run: by then another writer's Run is the canonical read's.
    onCall = (n) => { if (n === 2) served = C2_PARTIAL; };
    expect(C1_PARTIAL.json.graph_hash, 'the control: two different reads').not.toBe(C2_PARTIAL.json.graph_hash);
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn',
      payload: { scenario_id: SCENARIO, turn_id: randomUUID(), message: 'Run it again and tell me what changed.' } });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect(outputs, 'the model ran the analysis and answered').toEqual([]);
    // The Run's own tool output (not the turn-start state) carries the block of ITS pair.
    const runOutput = (JSON.parse(requests[1]!) as { input: { type?: string; output?: string }[] }).input
      .find((i) => i.type === 'function_call_output')?.output ?? '';
    expect(runOutput, 'the Run handed the model ITS pair').toContain('"what_changed"');
    expect((res.json() as { graph_hash?: string }).graph_hash).toBe(C2_PARTIAL.json.graph_hash);
  });
});
