/**
 * ⛔ THE UNCHECKED-LIMIT CLAUSE IS PINNED ON THE WIRE (AI Quality, programme-docs #63 5826106622).
 *
 * Once a run says a limit on a derived target "cannot be checked in this model yet" (CEE #1875, RC rulings
 * #63 5825683899 / 5825841734), the Agent must not close its reply on a step the user cannot take. Measured
 * on 8 served `e39f6e0` explicit-Run inputs carrying #1875's copy, n=2, blind OpenAI labeller: replies that
 * invite a step to make the limit checkable went 4/16 → 0/16 with this clause; 16/16 still said the limit
 * was unchecked. Contrast (a legitimate root repair in the same inputs): relays 4/16 → 2/16, other-fix
 * 3/16 → 4/16 — within noise. These assertions bind to the instructions the model is actually SENT — the
 * explicit Run's one interpreting call and the Agent's own call — never to the source text.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const SCENARIO = '6b2d8f3c-4e5a-4b7c-9d0e-1f2a3b4c5d6e';
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

/** The measured clause, as the model reads it. */
const CLAUSE =
  'When the run says a limit cannot be checked in this model yet, say so plainly and do not suggest any step, input or model change to make it checkable.';
/** The rule it follows — its placement is part of what was measured. */
const ANCHOR = 'When the result is fragile or a near tie, say that this uncertainty is itself the finding.';

describe('the unchecked-limit clause reaches the model on every reply-writing call', () => {
  let app: FastifyInstance;
  let modelBodies: Record<string, unknown>[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      modelBodies.push(body);
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'That limit cannot be checked in this model yet.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: 'h1',
      blocks: [{ type: 'analysis_result', data: { marker: 'the-run' } }], analysis_ready: { status: 'ready', options: [], blockers: [] },
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'g', kind: 'goal', label: 'MRR' }, { id: 'f', kind: 'factor', label: 'Monthly churn' }], edges: [{ from: 'f', to: 'g' }] },
      graph_hash: 'h1',
      analysis_state: { run_state: { kind: 'complete_current' }, leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } },
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { modelBodies = []; });

  it('RED: the explicit Run’s one interpreting call carries the clause, right after the fragile/near-tie rule', async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' },
    } });
    expect(r.statusCode).toBe(200);
    expect(modelBodies, 'exactly one interpreting call').toHaveLength(1);
    expect(modelBodies[0]!['tool_choice']).toBe('none');
    const instructions = String(modelBodies[0]!['instructions']);
    expect(instructions).toContain(`${ANCHOR} ${CLAUSE}`);
    expect(instructions.split(CLAUSE), 'stated once, not repeated').toHaveLength(2);
  });

  it('RED: the Agent’s own call (words, not the Run chip) carries the same clause', async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Why could the churn limit not be checked?' } });
    expect(r.statusCode).toBe(200);
    const agentCall = modelBodies.find((b) => b['tool_choice'] !== 'none');
    expect(agentCall, 'the Agent made its own call').toBeDefined();
    expect(String(agentCall!['instructions'])).toContain(`${ANCHOR} ${CLAUSE}`);
  });
});
