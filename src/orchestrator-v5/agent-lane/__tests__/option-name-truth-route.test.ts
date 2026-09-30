import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const SCENARIO = '7d18dd9a-5929-4b6e-8ca4-462a11489257';
const HASH = 'aaaacccc00001111';
const graph = { nodes: [
  { id: 'goal', kind: 'goal', label: 'MRR' },
  { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { cap: 200, unit: '£ per subscriber per month', value: 0.245, raw_value: 49 } },
  { id: 'raise', kind: 'option', label: 'Raise to £59', interventions: { price: { value: 0.3, raw_value: 60, unit: '£ per subscriber per month' } } },
], edges: [] };
const result = { type: 'analysis_result', computed_against_hash: HASH, leading_option_id: 'raise', summary: 'Synthetic result',
  enrichment: { option_comparison: [{ option_id: 'raise', option_label: 'Raise to £59', win_probability: 0.99 }] } };
const state = { run_state: { kind: 'complete_current', computed_at: '2026-09-30T09:00:00.000Z', graph_hash_at_run: HASH },
  leader_claim: { permitted: true, separation: 'separated' } };
const writes: string[] = [];
const modelRequests: unknown[] = [];
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null }>();
const store = { ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string }) => {
    const row = { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null };
    rows.set(w.turn_id, row);
    if (w.assistantMessage !== undefined) writes.push(w.assistantMessage);
    return { id: row.id };
  }) };
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

describe('Agent Run result names a changed option level without renaming the graph', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      modelRequests.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ output: [
        { type: 'message', content: [{ type: 'output_text', text: 'Raise to £59: 99% in this model.' }] },
      ] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [],
      graph_hash: HASH, blocks: [result], analysis_ready: { status: 'ready', options: [], blockers: [] }, analysis_state: state }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph, graph_hash: HASH, analysis_result: result,
      analysis_state: state, analysis_ready: { status: 'ready', options: [], blockers: [] } }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('qualifies the actual reply before durable answer write; Run fact and graph keep the raw label', async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Run analysis.', source: 'chip_click',
      chip: { action_type: 'run_analysis' }, turn_id: '4382b44d-7672-4c9d-9f2b-2b76a2662328',
    } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    const body = r.json() as { assistant_text: string; blocks: { enrichment?: { option_comparison?: { option_label: string }[] } }[] };
    expect(body.assistant_text).toContain('Raise to £59 (set to £60/month): 99%');
    expect(JSON.stringify(modelRequests)).toContain('Raise to £59 (set to £60/month)');
    expect(writes.at(-1)).toContain('Raise to £59 (set to £60/month): 99%');
    expect(body.blocks[0]?.enrichment?.option_comparison?.[0]?.option_label).toBe('Raise to £59');
    expect(graph.nodes[2]!.label).toBe('Raise to £59');
  });
});
