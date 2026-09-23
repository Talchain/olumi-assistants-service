/**
 * ⛔ THE ROUTE MUST INJECT A WORKING READER, OR THE CAPABILITY SHIPS DARK (#1731 review M10).
 *
 * `createAgentCapabilities` takes the method gate's reader as an optional argument and
 * the tool REFUSES without it. So removing the route's wiring leaves every unit spec
 * green while the tool refuses on every production turn. These tests drive the REAL
 * `/agent/v1/turn` route, with only the session store and the provider doubled, and
 * read what the Agent is actually handed: the tool's output as it is posted back to
 * the provider, and the instruction the provider is given.
 *
 * The store double's reader returns the served `run_analysis` fact hydrated the way
 * `readScenarioRunAnalysisFactsFor` does (payload + its `noop` column, strict-parsed).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { HandlerFactSchema } from '@talchain/schemas/orchestrator';
import { SessionReadError } from '../../session/store.js';
import { APPLICABLE_METHOD_FACT_WINDOW } from '../runtime/applicable-method.js';

const SERVED = HandlerFactSchema.parse({
  ...(JSON.parse(readFileSync(new URL('./fixtures/served-run-analysis-fact.json', import.meta.url), 'utf8')) as Record<string, unknown>),
  noop: false,
});

let readFails = false;
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readScenarioRunAnalysisFactsFor: vi.fn(async (_sid: string, _limit: number) => {
    if (readFails) throw new SessionReadError('Scenario analysis-fact query failed', { code: 'analysis_fact_query_failed' });
    return { facts: [{ fact: SERVED, fact_row_id: 'row-1', fact_created_at: '2026-09-23T09:03:00.000Z' }], total_count: 1 };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

/** The provider: call 1 asks for the method gate, call 2 answers. Every request body is kept. */
const sent: { instructions?: string; input?: { type?: string; call_id?: string; output?: string }[] }[] = [];
const fakeFetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
  sent.push(JSON.parse(String(init?.body ?? '{}')));
  const output = sent.length === 1
    ? [{ type: 'function_call', name: 'get_applicable_method', arguments: JSON.stringify({ reason: 'after the analysis' }), call_id: 'call_m1' }]
    : [{ type: 'message', content: [{ type: 'output_text', text: 'Here is a way to test that result.' }] }];
  return new Response(JSON.stringify({ output }), { status: 200 });
});

const SID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

async function freshApp(): Promise<FastifyInstance> {
  vi.resetModules();
  process.env.AGENT_LANE_ENABLED = 'true';
  process.env.AGENT_LANE_PREVIEW = 'false';
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false });
  app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [], edges: [] }, graph_hash: 'h1' }));
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}
const say = (app: FastifyInstance, message: string) =>
  app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, message } });
const agentOf = (r: { json: () => unknown }) => (r.json() as { _agent?: { tool_calls?: unknown[] } })._agent ?? {};
/** The tool's output exactly as the route posted it back to the provider. */
const toolOutput = (): Record<string, unknown> => {
  const item = (sent[1]?.input ?? []).find((i) => i.type === 'function_call_output' && i.call_id === 'call_m1');
  expect(item, 'the tool output was posted back to the provider').toBeDefined();
  return JSON.parse(String(item!.output)) as Record<string, unknown>;
};

describe('the route wires the method gate to the store', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    sent.length = 0; readFails = false;
    store.readScenarioRunAnalysisFactsFor.mockClear();
    vi.stubGlobal('fetch', fakeFetch);
    app = await freshApp();
  }, 60_000);
  afterEach(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED (M10): the Agent’s get_applicable_method reaches the store’s scenario-scoped reader and returns the gate’s method', async () => {
    const r = await say(app, 'What does that analysis tell me?');
    expect(r.statusCode).toBe(200);
    expect(sent).toHaveLength(2);
    expect(store.readScenarioRunAnalysisFactsFor).toHaveBeenCalledTimes(1);
    expect(store.readScenarioRunAnalysisFactsFor).toHaveBeenCalledWith(SID, APPLICABLE_METHOD_FACT_WINDOW);
    expect(agentOf(r).tool_calls).toEqual([{ name: 'get_applicable_method', ok: true, mutated: false }]);
    const out = toolOutput();
    expect(out.ok).toBe(true);
    expect((out.method as { id?: string }).id).toBe('pre_mortem');
  });

  it('RED (B2): a store read that throws → the turn still answers 200, and the tool refused', async () => {
    readFails = true;
    const r = await say(app, 'What does that analysis tell me?');
    expect(r.statusCode).toBe(200);
    expect(agentOf(r).tool_calls).toEqual([{ name: 'get_applicable_method', ok: false, mutated: false, refusal: 'method_gate_unavailable' }]);
    expect(toolOutput()).toEqual({ ok: false, mutated: false, refusal: 'method_gate_unavailable' });
  });

  it('RED (B3): the instruction opens with ONE question from the exercise and keeps closing questions for the end', async () => {
    await say(app, 'What does that analysis tell me?');
    const instructions = String(sent[0]?.instructions);
    expect(instructions).toContain('call get_applicable_method');
    expect(instructions).toMatch(/open the exercise with ONE question of your own for the user to answer, drawn from the exercise its reason describes/);
    expect(instructions).toMatch(/Use its closing_questions only at the end/);
    expect(instructions).toMatch(/never ask the user to endorse a recommendation/);
    expect(instructions).not.toMatch(/FIRST step/);
  });
});
