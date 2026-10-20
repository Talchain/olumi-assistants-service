/** L22: SDK-parsed declarations survive the real B turn, with A's existing trace bounds. No live provider calls. */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { read } from './fixtures.js';

const conversations = new Map<string, string>();
const rows = new Map<string, Record<string, unknown>>();
const store = new Proxy({}, { get: (_t, key) => key === 'then' ? undefined
  : key === 'append' ? vi.fn(async (write: Record<string, unknown>) => {
    const row = { ...write, id: `row-${rows.size + 1}` }; rows.set(String(write.turn_id), row); return { id: row.id };
  })
  : key === 'readCommittedTurn' ? vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null)
  : key === 'readOpenAiConversationId' ? vi.fn(async (sid: string) => conversations.get(sid) ?? null)
  : key === 'claimOpenAiConversationId' ? vi.fn(async (sid: string, id: string) => { conversations.set(sid, id); return id; })
  : key === 'readMostRecentPendingActions' || key === 'readRecent' || key === 'readFactsFor' ? vi.fn(async () => [])
  : key === 'ensureScenarioExists' ? vi.fn(async () => ({ user_id: null })) : vi.fn(async () => null) });
vi.mock('../../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('L22: path B records the declared tool arguments without changing outcomes or replies', () => {
  let app: FastifyInstance;
  let step = 0;
  let declared: Record<string, unknown>;
  let toolOutput: string | undefined;
  const reply = 'That factor is not available in this model; please identify the factor you mean.';
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) return Response.json({ id: 'conv_trace', object: 'conversation' });
      const request = JSON.parse(String(init?.body ?? '{}')) as { input?: { type: string; call_id?: string; output?: string }[] };
      toolOutput = request.input?.find((i) => i.type === 'function_call_output' && i.call_id === 'declared')?.output ?? toolOutput;
      step += 1;
      const output = step === 1 ? [{ id: 'fc_read', type: 'function_call', status: 'completed', name: 'read_canonical_context', call_id: 'read', arguments: '{}' }]
        : step === 2 ? [{ id: 'fc_propose', type: 'function_call', status: 'completed', name: 'propose_change', call_id: 'declared', arguments: JSON.stringify(declared) }]
        : [{ id: 'msg_final', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: reply, annotations: [] }] }];
      return Response.json({ id: `resp_${step}`, object: 'response', model: 'gpt-scripted', status: 'completed', output,
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => read());
    await app.register(agentV1TurnRoute); await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it.each([
    ['Studio capacity', 9, 'Revenue was 2m as of 2026-09-01. Suppose studio capacity were 9 people.'],
    ['Workshop capacity', 17, 'Our deadline is 2026-11-01. Suppose workshop capacity were 17 people.'],
  ])('%s: exact declaration, original outcome and reply bytes', async (label, value, message) => {
    step = 0; toolOutput = undefined;
    declared = { public_label: label, basis: 'A provisional Olumi estimate.', ops: [{ op: 'set_factor_value', factor_id: 'missing_factor',
      value, unit: 'people', stance: 'estimate', source: { origin: 'olumi', quote: null, named_source: null } }] };
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers: { 'x-olumi-ai-mode': 'core' },
      payload: { kind: 'message', scenario_id: randomUUID(), turn_id: randomUUID(), message } });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    // These bytes are the lane-base behaviour, including the refusal; args must never change it.
    expect(toolOutput).toBe('{"status":"refused","reason":"not_a_factor","data":{"op":0}}');
    expect(body.assistant_text).toBe(reply);
    expect(body._agent.mutated).toBe(false);
    expect(body._agent.tool_calls.find((c: { name: string }) => c.name === 'propose_change').args).toEqual(declared);
    expect(body._agent.tool_calls.find((c: { name: string }) => c.name === 'read_canonical_context').args).toEqual({});
  });
});
