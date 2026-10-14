/**
 * S2e THROUGH THE ROUTE (Wave B3, 7 Oct, CEE 7addf05): the live provisional view never denies the driver the screen shows.
 *
 * The final egress (`withoutDriverAbsenceClaimsAtEgress`) ran BEFORE `_agent` and its provisional view were attached, so
 * the view's reasoning never reached it: unseen b3-2 shipped "…so investigation priority is not established." beside a
 * range line. The REAL agent route, a scripted OpenAI `fetch` (no provider is contacted), and the SERVED b3-2 readback
 * (`waveB3-unseen2-7addf05-readback-run1.json`, keys untouched: its range record, graph and withheld-leader state).
 * Harness copied from `provisional-view-route.test.ts`.
 */
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

type Json = Record<string, any>;
const READ = (JSON.parse(readFileSync(new URL('./fixtures/waveB3-unseen2-7addf05-readback-run1.json', import.meta.url), 'utf8')) as { j: Json }).j;
/** The b3-2 Run 1 provisional view's reasoning, verbatim as served (CEE 7addf05, `agent.interpret`). */
const SERVED_REASONING = 'That relationship remains unsized, so the stated £1,500/month salesperson cost alone cannot establish the effect on your profit goal. The run has not measured which assumption most affects the comparison, so investigation priority is not established.';
const CLEAN_REASONING = 'That relationship remains unsized, so the stated £1,500/month salesperson cost alone cannot establish the effect on your profit goal.';
const VIEW = {
  view: 'Before comparing, size how strongly running a fourth shop changes its monthly operating profit.',
  reasoning: SERVED_REASONING,
  confirm_step: 'Tell me roughly how much monthly profit the fourth shop would add, and I can propose it.',
};
const SCENARIO = '6f4e3d2c-1b0a-4c9d-8e7f-6a5b4c3d2e1f';
let analysisResult: Json = READ.analysis_result;

const rows = new Map<string, { id: string; turn_id: string; request_hash: string }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
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

let callModelOutputs: Record<string, unknown>[][] = [];
type Body = { assistant_text: string; _agent: { tool_calls: { name: string; ok: boolean }[]; provisional_view?: { reasoning?: string }; replayed?: boolean } };

describe('S2e: the live provisional view loses a driver denial beside a range line', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const req = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if ((req['tool_choice'] as { name?: unknown } | undefined)?.name === 'give_provisional_view') {
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'give_provisional_view', arguments: JSON.stringify(VIEW), call_id: 'forced' }] }), { status: 200 });
      }
      const output = callModelOutputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ok', suggested_actions: [], insights: [], graph_hash: READ.graph_hash,
      blocks: [analysisResult], analysis_ready: READ.analysis_ready, analysis_state: READ.analysis_state,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => withCanonicalAnalysisView({
      graph: READ.graph, graph_hash: READ.graph_hash, analysis_result: analysisResult, analysis_state: READ.analysis_state,
      analysis_ready: READ.analysis_ready,
    }, SCENARIO));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); analysisResult = JSON.parse(JSON.stringify(READ.analysis_result)); });

  let seq = 0;
  const runWithView = async (): Promise<Body> => {
    seq += 1;
    callModelOutputs = [
      [{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'c1' }],
      [{ type: 'function_call', name: 'give_provisional_view', arguments: JSON.stringify(VIEW), call_id: 'c2' }],
      [{ type: 'message', content: [{ type: 'output_text', text: 'The analysis cannot put an option forward yet.' }] }],
    ];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Which should we do?', turn_id: `8b2c3d4e-5f60-4a7b-8c9d-${String(seq).padStart(12, '0')}`,
    } });
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json() as Body;
    expect(b._agent.replayed).not.toBe(true);
    expect(b._agent.tool_calls.map((c) => c.name)).toContain('give_provisional_view');
    return b;
  };

  it('fixture control: the served readback carries a range record and withholds the leader on a current Run', () => {
    expect(READ.analysis_result.enrichment.inference_warnings.map((w: Json) => w.code)).toContain('GOAL_CHANCE_RANGE');
    expect(READ.analysis_state.leader_claim.permitted).toBe(false);
    expect(READ.analysis_state.run_state.kind).toBe('complete_current');
  });

  it('RED at base: the view is shown with only its denial clause removed', async () => {
    const b = await runWithView();
    expect(b._agent.provisional_view, JSON.stringify(b._agent)).toBeDefined();
    expect(b._agent.provisional_view!.reasoning).toBe(CLEAN_REASONING);
  });

  it('CONTRAST: the same live turn with no range record ships the reasoning unchanged', async () => {
    analysisResult.enrichment.inference_warnings = analysisResult.enrichment.inference_warnings.filter((w: Json) => w.code !== 'GOAL_CHANCE_RANGE');
    const b = await runWithView();
    expect(b._agent.provisional_view!.reasoning).toBe(SERVED_REASONING);
  });
});
