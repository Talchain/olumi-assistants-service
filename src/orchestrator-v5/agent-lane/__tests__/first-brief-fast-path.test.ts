/**
 * ⭐ FAST PATH 1 — A FRESH BRIEF GOES STRAIGHT TO THE CONSTRUCTOR: ONE provider call
 * (RC #63 5803960423 / 5803995225). Paul's staging test: the first turn took ~59 s,
 * 5 provider calls and 3 tool hops. The product's own rule makes an empty model plus a
 * message the brief (DecisionGuideAI `streamedDraftEligible`), so the Agent's
 * read-decide-build-narrate hops have nothing to decide.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const SCENARIO = '7a2d3c4b-5e6f-4a7b-8c9d-0e1f2a3b4c5e';
const BRIEF = 'Should I hire a tech lead or two developers to increase velocity?';
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

const factor = (label: string, provenance = 'inferred') => ({ label, role: 'observable', baseline_known: false, baseline_value: null, unit: null, provenance, plausible_max: 100 });
const CANDIDATE = {
  goal: { metric: 'Velocity', operator: '>=', value: 20, unit: 'points', horizon_months: 6, provenance: 'explicit' },
  constraints: [],
  options: [
    { label: 'Hire a tech lead', provenance: 'explicit', changes: ['Delivery capacity'], interventions: [] },
    { label: 'Hire two developers', provenance: 'explicit', changes: ['Delivery capacity'], interventions: [] },
  ],
  factors: [factor('Delivery capacity')],
  risks: [], outcomes: [],
  links: [{ from: 'Delivery capacity', to: 'Velocity', direction: 'positive', provenance: 'inferred' }],
  unknowns: [],
};

describe('fast path 1: an empty scenario plus a brief is built with ONE provider call', () => {
  let app: FastifyInstance;
  let structuredCalls = 0; let conversationCalls = 0;
  let graph: { nodes: unknown[]; edges: unknown[] } = { nodes: [], edges: [] };
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = String(init?.body ?? '');
      if (body.includes('json_schema')) {
        structuredCalls += 1;
        return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(CANDIDATE) }] }] }), { status: 200 });
      }
      conversationCalls += 1;
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Tell me more about the decision.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/versions', async (_req, reply) => reply.code(404).send({ error: 'none' }));
    app.post('/assist/v1/scenarios/:id/graph/register', async (req) => {
      graph = (req.body as { graph: typeof graph }).graph;
      return { registered: true, graph_hash: 'h-built' };
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph, graph_hash: graph.nodes.length ? 'h-built' : 'h0' }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { structuredCalls = 0; conversationCalls = 0; });

  it('RED: the model is built and returned with exactly ONE provider call (the constructor), no Agent hops', async () => {
    graph = { nodes: [], edges: [] };
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: BRIEF } });
    expect(r.statusCode).toBe(200);
    const b = r.json() as { assistant_text: string; draft_graph?: { node_count?: number }; suggested_actions: { id: string }[]; _diagnostic_trace: { fast_path?: string }; _agent: { tool_calls: { name: string; ok: boolean }[] }; _provider_calls: { purpose?: string }[] };
    expect(structuredCalls, 'one constructor call').toBe(1);
    expect(conversationCalls, 'no Agent conversation call').toBe(0);
    expect(b._diagnostic_trace.fast_path).toBe('first_brief');
    expect(b._agent.tool_calls).toEqual([expect.objectContaining({ name: 'build_model_from_brief', ok: true })]);
    expect(b._provider_calls.map((c) => c.purpose)).toEqual(['construction']);
    expect(b.draft_graph?.node_count, 'the registered model is on the wire for the canvas').toBeGreaterThan(0);
    expect(b.assistant_text, 'Olumi says what was saved').toMatch(/saved/i);
    expect(b.suggested_actions.map((a) => a.id)).toEqual(['agent-suggest-starting-point']);
  });

  it('CONTRAST: a scenario that already has a model keeps the Agent (never rebuilt over)', async () => {
    graph = { nodes: [{ id: 'g', kind: 'goal', label: 'Velocity' }], edges: [] };
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: BRIEF } });
    expect(conversationCalls).toBeGreaterThan(0);
    expect(structuredCalls).toBe(0);
    expect((r.json() as { _diagnostic_trace: { fast_path?: string } })._diagnostic_trace.fast_path).toBeUndefined();
  });

  it('CONTRAST: a very short message on an empty scenario keeps the Agent', async () => {
    graph = { nodes: [], edges: [] };
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Hi there' } });
    expect(conversationCalls).toBeGreaterThan(0);
    expect((r.json() as { _diagnostic_trace: { fast_path?: string } })._diagnostic_trace.fast_path).toBeUndefined();
  });
});
