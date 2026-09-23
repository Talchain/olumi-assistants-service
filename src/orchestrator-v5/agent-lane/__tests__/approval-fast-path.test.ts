/**
 * ⭐ FAST PATH 2 — APPROVAL IS DETERMINISTIC: typed proposal identity → authorise/apply
 * → receipt → authoritative reread, with ZERO model calls (RC #63 5803960423 /
 * 5803995225).
 *
 * MEASURED in Paul's staging test: "Use as starting assumptions" took ~29 s, 4 provider
 * calls and 3 tool hops, and the Agent also ran an analysis nobody asked for. The chip
 * already names exactly one proposal; the model has nothing to decide. So the chip
 * carries that proposal's identity in its own `id` (the UI echoes `chip.id` verbatim —
 * DecisionGuideAI `buildSuggestedActionChips` → `dispatchAction` → `buildChipMeta`), and
 * the route applies THAT proposal through the SAME `authorise_change` capability, with
 * every ownership/integrity/CAS check the Agent's own call would get.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const SCENARIO = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
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

describe('fast path 2: a typed approval chip applies its exact proposal with zero model calls', () => {
  let app: FastifyInstance;
  let modelCalls = 0;
  let edges: { from: string; to: string }[] = [];
  const commits: unknown[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      modelCalls += 1;
      if (modelCalls === 1) {
        return new Response(JSON.stringify({ output: [{
          type: 'function_call', name: 'propose_model_change', call_id: 'c1',
          arguments: JSON.stringify({ from_label: 'Team size', to_label: 'Velocity', direction: 'positive', rationale: 'More people ship more.' }),
        }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'This would connect Team size to Velocity. Approve it if that is right.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges },
      graph_hash: `h${edges.length}`,
    }));
    app.post('/orchestrate/v2/turn', async (req) => {
      const b = req.body as { kind?: string; event?: { from: string; to: string } };
      if (b.kind === 'system_event' && b.event) { edges = [...edges, { from: b.event.from, to: b.event.to }]; commits.push(b); }
      return { assistant_text: 'Added.' };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED: the offered approve chip carries the proposal’s identity in its id; the click applies it with 0 model calls', async () => {
    const t1 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Should team size drive velocity?' } });
    const b1 = t1.json() as { suggested_actions: { id: string; label: string; message: string }[]; _agent: { tool_calls: { name: string; proposal_id?: string }[] } };
    const proposalId = b1._agent.tool_calls.find((c) => c.name === 'propose_model_change')?.proposal_id;
    expect(proposalId, 'the control: a real proposal was made').toMatch(/^prop_/);
    const approve = b1.suggested_actions[0]!;
    expect(approve.id).toBe(`agent-approve-proposal:${proposalId}`);
    expect(approve.label + approve.message, 'the id never reaches text a user reads').not.toContain(proposalId!);

    const before = modelCalls;
    const t2 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: approve.message, source: 'chip', chip: { id: approve.id },
    } });
    expect(t2.statusCode).toBe(200);
    const b2 = t2.json() as { assistant_text: string; _agent: { tool_calls: { name: string; ok: boolean; proposal_id?: string }[] }; _provider_calls: unknown[]; _diagnostic_trace: { fast_path?: string } };
    expect(modelCalls - before, 'ZERO model calls on a typed approval').toBe(0);
    expect(b2._provider_calls).toEqual([]);
    expect(b2._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, proposal_id: proposalId })]);
    expect(b2._diagnostic_trace.fast_path).toBe('approve');
    expect(commits, 'the exact proposal was applied once').toHaveLength(1);
    expect(edges).toEqual([{ from: 'f1', to: 'o1' }]);
    expect(b2.assistant_text.length, 'Olumi states what was saved').toBeGreaterThan(0);
  });

  it('CONTRAST: the same words WITHOUT the typed chip still go to the Agent (no inference from text)', async () => {
    const before = modelCalls;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Yes, make that change.' } });
    expect(modelCalls - before).toBeGreaterThan(0);
    expect((r.json() as { _diagnostic_trace: { fast_path?: string } })._diagnostic_trace.fast_path).toBeUndefined();
  });

  it('a typed chip for a proposal this process no longer holds (a deploy) hands the turn to the Agent, never fails it', async () => {
    const before = modelCalls; const commitsBefore = commits.length;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Yes, use those.', source: 'chip', chip: { id: 'agent-approve-proposal:prop_0123456789abcdef0123456789abcdef' },
    } });
    expect(r.statusCode).toBe(200);
    expect(modelCalls - before, 'the Agent took the turn').toBeGreaterThan(0);
    expect((r.json() as { _diagnostic_trace: { fast_path?: string } })._diagnostic_trace.fast_path).toBeUndefined();
    expect(commits.length, 'nothing was applied').toBe(commitsBefore);
  });
});
