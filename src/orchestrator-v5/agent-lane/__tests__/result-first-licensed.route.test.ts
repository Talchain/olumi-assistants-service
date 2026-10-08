/**
 * AI HARNESS (#2455 takeover, CR 5933064821) — the two-request Run never hands the model an unlicensed run. Request 2
 * reads the selected run through PR-L1's licensed view (item 3); request 1's run reaches the next Agent turn only as
 * the history time marker (item 2 withdrawn: the history write already prunes it). Fixture: Paul's served 09:48Z Run block (1 Oct, scenario 96c6f5f4), whose
 * PLoT warning named the withheld leader beside "the leading option's draws".
 */
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRunExplanationChip, RUN_EXPLANATION_MESSAGE } from '../run-explanation.js';
import { explanationContext } from './fixtures/run-explanation-follow-up.js';

const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-withheld-leader-0948Z.json', import.meta.url), 'utf8')) as {
  analysis_state: Record<string, unknown>;
  block: Record<string, unknown>;
};
const SCENARIO = '7b0e4c2a-1d3f-4e5a-9b6c-8d7e6f5a4b3c';
const HASH = String(SERVED.block.computed_against_hash);
const LEAK = "the leading option's draws";
const GRAPH = { nodes: [{ id: 'g', kind: 'goal', label: 'MRR' }, { id: 'ai_reporting_sprint', kind: 'option', label: 'AI Reporting Sprint' }, { id: 'signup_fix_sprint', kind: 'option', label: 'Signup Fix Sprint' }], edges: [] };
const READY = { status: 'ready', analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } };
const DELTA = { leader: { current_leading_option_id: 'ai_reporting_sprint', prior_leading_option_id: 'signup_fix_sprint' }, rows: [] };
const PERMITTED = { ...SERVED.analysis_state, leader_claim: { permitted: true } };

let state: Record<string, unknown> = SERVED.analysis_state;
const rows: Record<string, unknown>[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_scenario: string, id: string) => rows.find((r) => r.turn_id === id) ?? null),
  append: vi.fn(async (row: Record<string, unknown>) => { rows.push({ ...row, id: row.turn_id }); return { id: String(row.turn_id) }; }),
  readRecent: vi.fn(async () => [...rows].reverse()),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('the two-request Run reads the licensed run on both requests (live route)', () => {
  let app: FastifyInstance;
  let modelBodies: Record<string, unknown>[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      modelBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'The result depends on the assumptions in your model.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [],
      graph_hash: HASH, blocks: [SERVED.block], analysis_state: state, analysis_ready: READY }));
    app.post('/assist/v1/scenarios/:id/graph', async () => withCanonicalAnalysisView({ graph: GRAPH, graph_hash: HASH, analysis_ready: READY,
      analysis_state: state, analysis_result: SERVED.block, current_read: { run_delta: DELTA } }, SCENARIO));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => { state = SERVED.analysis_state; rows.length = 0; modelBodies = []; });

  const run = () => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    turn_id: randomUUID(), scenario_id: SCENARIO, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' },
  } });
  type First = { suggested_actions: { id: string }[]; _agent: { session_id: string } };
  const explain = (first: First) => {
    const chip = first.suggested_actions.find((c) => isRunExplanationChip(c.id));
    expect(chip, JSON.stringify(first.suggested_actions)).toBeDefined();
    return app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { turn_id: randomUUID(), scenario_id: SCENARIO,
      agent_session_id: first._agent.session_id, message: RUN_EXPLANATION_MESSAGE, chip: { id: chip!.id } } });
  };

  it("RED (item 3): request 2's interpreter input is the licensed run — no producer prose, no leader ids, codes kept", async () => {
    // Precondition: the selected block the reader returns carries the leak.
    expect(JSON.stringify(SERVED.block)).toContain(LEAK);
    const first = await run();
    expect(first.statusCode, first.body).toBe(200);
    expect(modelBodies).toHaveLength(0);
    const second = await explain(first.json() as First);
    expect(second.statusCode, second.body).toBe(200);
    expect(modelBodies).toHaveLength(1);
    const ctx = explanationContext(modelBodies[0]!.input);
    expect(ctx, JSON.stringify(modelBodies[0]!.input)).toBeDefined();
    const seen = JSON.stringify(ctx);
    expect(seen).not.toContain(LEAK);
    expect(seen).not.toContain('leading option');
    expect(seen).not.toMatch(/"message":/);
    expect(seen).toContain('CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN');
    expect((ctx as { claim_permissions: { leader_may_be_named: boolean } }).claim_permissions.leader_may_be_named).toBe(false);
    expect((ctx as { canonical_state: { run_delta: unknown } }).canonical_state.run_delta)
      .toEqual({ leader: { current_leading_option_id: null, prior_leading_option_id: null }, rows: [] });
  });

  it('GUARD (CR item 2 withdrawn): request 1\'s run reaches the next Agent turn only as the history time marker', async () => {
    // The ONLY reader of the fast path's items is the history write, which prunes every retained Run output to a time
    // marker (`pruneSupersededToolOutputs`, `runHistoryMarker`). This pins that the result-first path does not bypass it.
    const first = await run();
    expect(first.statusCode, first.body).toBe(200);
    const next = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { turn_id: randomUUID(), scenario_id: SCENARIO,
      agent_session_id: (first.json() as First)._agent.session_id, message: 'What should I look at next?' } });
    expect(next.statusCode, next.body).toBe(200);
    const outputs = modelBodies.flatMap((b) => (Array.isArray(b.input) ? b.input : []) as { type?: string; call_id?: string; output?: string }[])
      .filter((i) => i.type === 'function_call_output' && typeof i.call_id === 'string' && i.call_id.startsWith('fast_run_'));
    // Positive control: request 1's run pair IS in the next turn's provider input.
    expect(outputs.length).toBeGreaterThan(0);
    for (const o of outputs) {
      expect(JSON.parse(o.output!)).toEqual({ note: 'Earlier analysis ran at 2026-10-01T09:48:47.190Z; see the current Run in CURRENT MODEL STATE.' });
    }
  });

  it('CONTROL: on a run the model may name a leader on, request 2 reads the run as the reader selected it', async () => {
    state = PERMITTED;
    const second = await explain((await run()).json() as First);
    expect(second.statusCode, second.body).toBe(200);
    const ctx = explanationContext(modelBodies[0]!.input) as { claim_permissions: { leader_may_be_named: boolean }; canonical_state: { run_delta: unknown } };
    expect(ctx.claim_permissions.leader_may_be_named).toBe(true);
    expect(JSON.stringify(ctx)).toContain(LEAK);
    expect(ctx.canonical_state.run_delta).toEqual(DELTA);
  });
});
