/** Real Agent route; all provider, orchestration and session operations are stubbed locally. */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { indexGoalWeightsNoteOf } from '../../goal-target/index-goal-weights-note.js';

type Json = Record<string, any>;
const READ = (JSON.parse(readFileSync(new URL('./fixtures/waveB5-t1b-3fce64f-readback-run1.json', import.meta.url), 'utf8')) as { j: Json }).j;
const SCENARIO = '7a5e4d3c-2b1a-4d0e-9f8a-7b6c5d4e3f2a';
const goalId = 'monthly_recurring_revenue';
const graph: Json = structuredClone(READ.graph);
const goal = graph.nodes.find((n: Json) => n.id === goalId);
delete goal.goal_threshold_unit;
delete goal.observed_state.unit;
graph.nodes.push({ id: 'A', kind: 'outcome', label: 'A' }, { id: 'B', kind: 'outcome', label: 'B' });
graph.edges = ['A', 'B'].map((from) => ({ from, to: goalId, provenance: { magnitude: 'olumi_estimate' } }));
const NOTE = "How much each of ‘A’ and ‘B’ counts towards ‘monthly recurring revenue’ is Olumi's assumption, not your stated priority. Set them to match what matters to you.";
let analysisResult: Json;
let outputs: Json[][] = [];
const rows = new Map<string, { id: string; turn_id: string; request_hash: string }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash
      ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});
const say = (text: string): Json[] => [{ type: 'message', content: [{ type: 'output_text', text }] }];
const run = (text: string): Json[][] => [[{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'Run analysis' }), call_id: 'c1' }], say(text)];

describe('index weights note through the Run reply route', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: outputs.shift() ?? say('Done.') }), { status: 200 })));
    vi.resetModules();
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'The analysis ran.', suggested_actions: [], insights: [], graph_hash: READ.graph_hash,
      blocks: [analysisResult], analysis_ready: READ.analysis_ready, analysis_state: READ.analysis_state,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph, graph_hash: READ.graph_hash, analysis_result: analysisResult,
      analysis_state: READ.analysis_state, analysis_ready: READ.analysis_ready,
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  beforeEach(() => {
    rows.clear();
    analysisResult = structuredClone(READ.analysis_result);
    const note = indexGoalWeightsNoteOf(graph, goalId);
    expect(note?.message).toBe(NOTE);
    analysisResult.enrichment.inference_warnings.push(note);
  });
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  let seq = 0;
  async function turn(script: Json[][], message = 'Run it'): Promise<Json> {
    outputs = script;
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message,
      turn_id: `9c3d4e5f-6a7b-4c8d-9e0f-${String(++seq).padStart(12, '0')}`,
    } });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as Json;
  }
  it('a turn that ran the analysis says the exact methods note once', async () => {
    const body = await turn(run('The analysis ran.'));
    expect(body._agent.tool_calls.map((t: Json) => t.name)).toContain('run_analysis');
    expect(body.assistant_text.split(NOTE)).toHaveLength(2);
  });
  it('when the Agent already said it, no duplicate is appended and the words survive unchanged', async () => {
    const body = await turn(run(`The analysis ran. ${NOTE}`));
    expect(body.assistant_text.split(NOTE)).toHaveLength(2);
  });
  it('a reply about a saved Run that ran no analysis owes no methods note', async () => {
    const body = await turn([say('Happy to help with the next step.')], 'Thanks');
    expect(body._agent.tool_calls.map((t: Json) => t.name)).not.toContain('run_analysis');
    expect(body.assistant_text).not.toContain(NOTE);
  });
  it('a Run without the warning says no index weights note', async () => {
    analysisResult.enrichment.inference_warnings = analysisResult.enrichment.inference_warnings.filter((w: Json) => w.code !== 'GOAL_INDEX_WEIGHTS_ASSUMED');
    const body = await turn(run('The analysis ran.'));
    expect(body.assistant_text).not.toContain(NOTE);
  });
});
