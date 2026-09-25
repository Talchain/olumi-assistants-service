/**
 * ⛔ THE MEASURED WITHHELD-LEADER CLAUSE IS PINNED ON THE WIRE (#1866, independent review N1,
 * programme-docs #63 5824950255). Across three discriminating briefs it cut the withheld-leader
 * leak on the explicit Run from 24/36 to 1/36 (#63 5824225421); served, the residue it targets is a
 * paraphrase the wire gate passes ("The comparison favours higher modelled MRR for £59 …",
 * #63 5824724485). Deleting the clause, or restoring the old rule that let an EARLIER analysis
 * license a leader, passed every existing spec. These assertions bind to the instructions the
 * model is actually SENT — the explicit Run's one interpreting call and the Agent's own call —
 * never to the source text.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const SCENARIO = '5a1c7e2b-3d4f-4a6b-8c9d-0e1f2a3b4c5d';
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

/** The measured clause (#63 5823878422), as the model reads it. */
const CLAUSE_LEAD = 'When `leader_may_be_named` is false, the finding you lead with is why no option can be put forward — not which option the comparison favours.';
const CLAUSE_BAN = 'Do not say, even hedged or “on current assumptions”, that any option leads, is favoured, scores or comes out highest, strongest or best, is ahead, or wins in any share of runs; describe robustness and sensitivity without saying which option they favour.';
/** An earlier analysis never licenses a leader (fails closed). */
const EARLIER_FAILS_CLOSED = 'an earlier analysis read from get_canonical_state carries no such permission, so never name a leader from it';
/** The rule it replaced — an earlier analysis's own leader_claim licensed naming one. */
const EARLIER_LICENSED = 'for an earlier analysis read from get_canonical_state, only when `analysis.leader_claim.permitted` is true';

describe('the measured withheld-leader clause reaches the model on every reply-writing call', () => {
  let app: FastifyInstance;
  let modelBodies: Record<string, unknown>[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      modelBodies.push(body);
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'No option can be put forward yet.' }] }] }), { status: 200 });
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
      graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Velocity' }, { id: 'f', kind: 'factor', label: 'Capacity' }], edges: [{ from: 'f', to: 'g' }] },
      graph_hash: 'h1',
      analysis_state: { run_state: { kind: 'complete_current' }, leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } },
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { modelBodies = []; });

  it('RED: the explicit Run’s one interpreting call carries the clause, and an earlier analysis fails closed', async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' },
    } });
    expect(r.statusCode).toBe(200);
    expect(modelBodies, 'exactly one interpreting call').toHaveLength(1);
    expect(modelBodies[0]!['tool_choice']).toBe('none');
    const instructions = String(modelBodies[0]!['instructions']);
    expect(instructions).toContain(CLAUSE_LEAD);
    expect(instructions).toContain(CLAUSE_BAN);
    expect(instructions).toContain(EARLIER_FAILS_CLOSED);
    expect(instructions, 'the replaced rule let an earlier analysis license a leader').not.toContain(EARLIER_LICENSED);
  });

  it('RED: the Agent’s own call (words, not the Run chip) carries the same clause', async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'What does the model say so far?' } });
    expect(r.statusCode).toBe(200);
    const agentCall = modelBodies.find((b) => b['tool_choice'] !== 'none');
    expect(agentCall, 'the Agent made its own call').toBeDefined();
    const instructions = String(agentCall!['instructions']);
    expect(instructions).toContain(CLAUSE_LEAD);
    expect(instructions).toContain(CLAUSE_BAN);
    expect(instructions).not.toContain(EARLIER_LICENSED);
  });
});
