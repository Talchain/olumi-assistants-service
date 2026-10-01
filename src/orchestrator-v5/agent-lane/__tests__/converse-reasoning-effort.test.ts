/**
 * Selected coach request configuration: #78 5915316114 and DL #75 5916003868.
 * Populated-model conversation uses Sol/high/3400; the Run's interpretation uses the interpret role, Sol/low/3400 (2a).
 * This supersedes PJ-C1 batch 5's Terra/low conversation setting; authoritative
 * empty-model turns retain Terra/low, covered by selected-coach-wiring.test.ts.
 * Construction keeps its separate Terra/medium budget. These captured requests
 * prove configuration only, not served quality, latency or joined acceptance.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const store = vi.hoisted(() => ({
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'synthetic-answer-row' })),
}));
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

type Body = Record<string, unknown>;
const GRAPH = {
  nodes: [{ id: 'g', kind: 'goal', label: 'Velocity' }, { id: 'f', kind: 'factor', label: 'Capacity' }],
  edges: [{ from: 'f', to: 'g' }],
};
const STATE = { run_state: { kind: 'complete_current' }, leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } };

describe('selected coach: populated conversation and Run use high; construction keeps its own', () => {
  let app: FastifyInstance;
  let modelBodies: Body[] = [];

  beforeAll(async () => {
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
      if (String(url) !== 'https://api.openai.com/v1/responses') throw new Error(`Unexpected mocked fetch target: ${String(url)}`);
      modelBodies.push(JSON.parse(String(init?.body ?? '{}')) as Body);
      const envelope = {
        id: 'resp_synthetic', status: 'completed', incomplete_details: null,
        output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Capacity drives it.' }] }],
      };
      return new Response(JSON.stringify(envelope), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    vi.resetModules();
    const route = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'Done.', suggested_actions: [], insights: [], graph_hash: 'h1', analysis_state: STATE,
      blocks: [{ type: 'analysis_result', data: { marker: 'synthetic' } }], analysis_ready: { status: 'ready', options: [], blockers: [] },
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: GRAPH, graph_hash: 'h1', analysis_state: STATE }));
    await app.register(route.agentV1TurnRoute);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  beforeEach(() => { modelBodies = []; });

  it('⭐ RED: a populated turn’s conversation call uses selected Sol/high/3400', async () => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: randomUUID(), message: 'What drives the result most?' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(modelBodies.length).toBeGreaterThan(0);
    for (const b of modelBodies) {
      expect(b.model).toBe('gpt-6.1-sol');
      expect(b.reasoning, JSON.stringify(b.reasoning)).toEqual({ effort: 'high' });
      expect(b.max_output_tokens).toBe(3400);
    }
  });

  it('⭐ RED (AI HARNESS 2a): the Run button’s one interpreting call (tool_choice none) uses the interpret role — Sol/LOW/3400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/agent/v1/turn',
      payload: { kind: 'message', scenario_id: randomUUID(), message: 'Run the analysis please', source: 'chip_click', chip: { action_type: 'run_analysis' } },
    });
    expect(res.statusCode, res.body).toBe(200);
    const interpreting = modelBodies.filter((b) => b.tool_choice === 'none');
    expect(interpreting.length, 'the typed Run made its interpreting call').toBe(1);
    expect(interpreting[0]!.model).toBe('gpt-6.1-sol');
    // Measured on Paul's frozen Run turn: high median 38.3 s vs low 9.4 s, truth content equal (`model-budgets.ts`).
    expect(interpreting[0]!.reasoning).toEqual({ effort: 'low' });
    // The deadline is a request option, never a body field.
    expect(interpreting[0]).not.toHaveProperty('deadline_ms');
    expect(interpreting[0]!.max_output_tokens).toBe(3400);
  });

  it('CONTROL: construction keeps its own measured effort (medium); only the conversation budget changed', async () => {
    const { budgetFor } = await import('../model-budgets.js');
    expect(budgetFor('gpt-5.6-terra', 'whole').reasoning_effort).toBe('medium');
    expect(budgetFor('gpt-5.6-terra', 'conversation').reasoning_effort).toBe('low');
  });
});
