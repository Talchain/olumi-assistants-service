import { explainRun, explanationContext } from './fixtures/run-explanation-follow-up.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { repairedOptionNameRead } from './fixtures/repaired-option-name.js';

const SCENARIO = '7d18dd9a-5929-4b6e-8ca4-462a11489257';
const HASH = 'aaaacccc00001111';
const HUMAN_LABEL = 'Raise Pro plan price from £49 to £59';
const graph = { nodes: [
  { id: 'goal', kind: 'goal', label: 'MRR' },
  { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { cap: 200, unit: '£ per subscriber per month', value: 0.245, raw_value: 49 } },
  { id: 'raise', kind: 'option', label: HUMAN_LABEL, interventions: { price: { value: 0.3, raw_value: 60, unit: '£ per subscriber per month' } } },
], edges: [] };
const result = { type: 'analysis_result', computed_against_hash: HASH, leading_option_id: 'raise', summary: 'Synthetic result',
  enrichment: { option_comparison: [{ option_id: 'raise', option_label: HUMAN_LABEL, win_probability: 0.99 }] } };
const state = { run_state: { kind: 'complete_current', computed_at: '2026-09-30T09:00:00.000Z', graph_hash_at_run: HASH },
  leader_claim: { permitted: true, separation: 'separated' } };
const writes: string[] = [];
const modelRequests: unknown[] = [];
const latestRunContext = (): Record<string, unknown> | undefined => {
  return explanationContext((modelRequests.at(-1) as { input?: unknown } | undefined)?.input);
};
let modelText = `${HUMAN_LABEL} (set to £60/month): 99% in this model.`;
let readBody: Record<string, unknown> = { graph, graph_hash: HASH, analysis_result: result,
  analysis_state: state, analysis_ready: { status: 'ready', options: [], blockers: [] } };
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
        { type: 'message', content: [{ type: 'output_text', text: modelText }] },
      ] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [],
      graph_hash: readBody.graph_hash, blocks: [readBody.analysis_result], analysis_ready: readBody.analysis_ready, analysis_state: readBody.analysis_state }));
    app.post('/assist/v1/scenarios/:id/graph', async () => readBody);
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('gives the model the current Run display name and persists its typed-context reply, without renaming facts', async () => {
    const r = await explainRun(app, SCENARIO, await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Run analysis.', source: 'chip_click',
      chip: { action_type: 'run_analysis' }, turn_id: '4382b44d-7672-4c9d-9f2b-2b76a2662328',
    } }));
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    const body = r.json() as { assistant_text: string; blocks: { enrichment?: { option_comparison?: { option_label: string }[] } }[] };
    expect(body.assistant_text, JSON.stringify(r.json())).toContain(`${HUMAN_LABEL} (set to £60/month): 99%`);
    expect(JSON.stringify(modelRequests)).toContain('option_display_names');
    expect(JSON.stringify(modelRequests)).toContain(`${HUMAN_LABEL} (set to £60/month)`);
    expect(writes.at(-1)).toContain(`${HUMAN_LABEL} (set to £60/month): 99%`);
    expect(body.blocks[0]?.enrichment?.option_comparison?.[0]?.option_label).toBe(HUMAN_LABEL);
    expect(graph.nodes[2]!.label).toBe(HUMAN_LABEL);
  });

  it('gives the interpreter the current Run name despite repaired-shape raw CAS and canonical Run hash divergence', async () => {
    const repaired = repairedOptionNameRead();
    const before = modelRequests.length;
    readBody = { graph: repaired.graph, graph_hash: repaired.graphHash, analysis_result: repaired.result,
      analysis_state: repaired.state, analysis_ready: { status: 'ready', options: [], blockers: [] } };
    modelText = 'Spend £110,000 (set to £120,000): current model result.';
    try {
      expect(repaired.graphHash).not.toBe(repaired.runHash);
      const r = await explainRun(app, SCENARIO, await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
        kind: 'message', scenario_id: SCENARIO, message: 'Run analysis.', source: 'chip_click',
        chip: { action_type: 'run_analysis' }, turn_id: '4382b44d-7672-4c9d-9f2b-2b76a2662340',
      } }));
      expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
      expect(modelRequests.length).toBeGreaterThan(before);
      expect(latestRunContext()?.canonical_state).toMatchObject({
        option_display_names: ['Spend £110,000 (set to £120,000)'],
      });
      expect((r.json() as { assistant_text: string }).assistant_text).toContain(modelText);
      expect((readBody.analysis_result as typeof repaired.result).enrichment.option_comparison[0]!.option_label).toBe('Spend £110,000');
    } finally {
      readBody = { graph, graph_hash: HASH, analysis_result: result, analysis_state: state,
        analysis_ready: { status: 'ready', options: [], blockers: [] } };
      modelText = `${HUMAN_LABEL} (set to £60/month): 99% in this model.`;
    }
  });

  it.each(['complete_stale', 'unknown_degraded'])('%s repaired-shape read withholds the interpreter display name', async (kind) => {
    const repaired = repairedOptionNameRead();
    const before = modelRequests.length;
    readBody = { graph: repaired.graph, graph_hash: repaired.graphHash, analysis_result: repaired.result,
      analysis_state: { run_state: { kind, graph_hash_at_run: repaired.runHash } },
      analysis_ready: { status: 'ready', options: [], blockers: [] } };
    modelText = 'The last Run cannot describe this model.';
    try {
      const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
        kind: 'message', scenario_id: SCENARIO, message: 'Run analysis.', source: 'chip_click',
        chip: { action_type: 'run_analysis' }, turn_id: `4382b44d-7672-4c9d-9f2b-2b76a266${kind === 'complete_stale' ? '2341' : '2342'}`,
      } });
      expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
      expect(modelRequests).toHaveLength(before);
      expect(r.json().suggested_actions.some((c: { id: string }) => c.id.startsWith('agent-explain-run:'))).toBe(false);
    } finally {
      readBody = { graph, graph_hash: HASH, analysis_result: result, analysis_state: state,
        analysis_ready: { status: 'ready', options: [], blockers: [] } };
      modelText = `${HUMAN_LABEL} (set to £60/month): 99% in this model.`;
    }
  });

  const historicalClaims = [
    `Earlier runs: ${HUMAN_LABEL}: 20% of simulations.`,
    `Before your edit, ${HUMAN_LABEL}: 20% of simulations.`,
    `In Run 1, ${HUMAN_LABEL}: 20% of simulations.`,
    `Earlier, ${HUMAN_LABEL}: 20% of simulations. Now it is higher.`,
    `### Earlier run\n\n- ${HUMAN_LABEL}: 20% of simulations.`,
    `Last time, ${HUMAN_LABEL} led.`,
    `The first run gave ${HUMAN_LABEL}: 20% of simulations.`,
    `At the old price, ${HUMAN_LABEL}: 20% of simulations.`,
    `The earlier two runs gave ${HUMAN_LABEL}: 20% of simulations.`,
  ];
  for (const [index, historical] of historicalClaims.entries()) {
    it(`leaves K${index + 1} historical result wording untouched despite a current Run`, async () => {
      modelText = historical;
      try {
        const r = await explainRun(app, SCENARIO, await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
          kind: 'message', scenario_id: SCENARIO, message: 'Run and compare with the earlier result.', source: 'chip_click',
          chip: { action_type: 'run_analysis' }, turn_id: `4382b44d-7672-4c9d-9f2b-2b76a266${String(2330 + index).padStart(4, '0')}`,
        } }));
        expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
        const body = r.json() as { assistant_text: string };
        expect(body.assistant_text).toContain(historical);
        expect(body.assistant_text).not.toContain('(set to £60/month)');
        expect(writes.at(-1)).toContain(historical);
        expect(writes.at(-1)).not.toContain('(set to £60/month)');
      } finally {
        modelText = `${HUMAN_LABEL} (set to £60/month): 99% in this model.`;
      }
    });
  }

  it('does not bind the edited level to the earlier Run on a stale follow-up', async () => {
    state.run_state.kind = 'complete_stale';
    modelText = `In the earlier analysis, ${HUMAN_LABEL}: 99%.`;
    const priorRequests = modelRequests.length;
    try {
      const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
        kind: 'message', scenario_id: SCENARIO, message: 'What did the last analysis say?',
        turn_id: '4382b44d-7672-4c9d-9f2b-2b76a2662329',
      } });
      expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
      const body = r.json() as { assistant_text: string };
      expect(body.assistant_text).not.toContain('(set to £60/month)');
      expect(JSON.stringify(modelRequests.slice(priorRequests))).not.toContain('(set to £60/month)');
      expect(writes.at(-1)).not.toContain('(set to £60/month)');
    } finally {
      state.run_state.kind = 'complete_current';
      modelText = `${HUMAN_LABEL} (set to £60/month): 99% in this model.`;
    }
  });
});
