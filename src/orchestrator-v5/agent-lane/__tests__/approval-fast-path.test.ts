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
/** Records committed rows by turn_id, so the claim/replay path is the REAL one. */
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number }) => {
    if (!rows.has(w.turn_id)) rows.set(w.turn_id, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0 });
    return { id: rows.get(w.turn_id)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

describe('fast path 2: a typed approval chip applies its exact proposal with zero model calls', () => {
  let app: FastifyInstance;
  let modelCalls = 0;
  let proposeNext = true;
  let proposals = 0;
  const modelCallsReset = () => { proposeNext = true; };
  let edges: { from: string; to: string }[] = [];
  const commits: unknown[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      modelCalls += 1;
      if (proposeNext) {
        proposeNext = false;
        proposals += 1;
        // Each proposal is a DIFFERENT link, so the second is a genuinely distinct B.
        const from = proposals === 1 ? 'Team size' : 'Morale';
        return new Response(JSON.stringify({ output: [{
          type: 'function_call', name: 'propose_model_change', call_id: `c${proposals}`,
          arguments: JSON.stringify({ from_label: from, to_label: 'Velocity', direction: 'positive', rationale: 'It moves velocity.' }),
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
      graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'f2', kind: 'factor', label: 'Morale' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges },
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

  it('CONTROL (Codex 1): the chip names A, A is gone, B is outstanding: no write to B, no model call, no analysis', async () => {
    // Make B outstanding: a fresh proposal the model offers now.
    modelCallsReset();
    const tb = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Should team size drive velocity?' } });
    const bId = (tb.json() as { _agent: { tool_calls: { name: string; proposal_id?: string }[] } })._agent.tool_calls.find((c) => c.name === 'propose_model_change')?.proposal_id;
    expect(bId, 'the control: B really is outstanding').toMatch(/^prop_/);
    const before = modelCalls; const commitsBefore = commits.length;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Yes, use those.', source: 'chip', chip: { id: 'agent-approve-proposal:prop_0123456789abcdef0123456789abcdef' },
    } });
    expect(r.statusCode).toBe(200);
    const b = r.json() as { assistant_text: string; _agent: { tool_calls: { name: string; ok: boolean; refusal?: string }[] }; _provider_calls: unknown[]; _diagnostic_trace: { fast_path?: string } };
    expect(modelCalls - before, 'no model call').toBe(0);
    expect(b._provider_calls).toEqual([]);
    expect(commits.length, 'B was NOT applied').toBe(commitsBefore);
    expect(b._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: false, refusal: 'unknown_proposal' })]);
    expect(b._diagnostic_trace.fast_path).toBe('approve');
    expect(b.assistant_text).toMatch(/I no longer hold that proposal, so nothing was applied just now/);
  });

  it('CONTROL (Codex 2): one turn_id + the same words for A then B is refused as a different request; the exact A retry replays', async () => {
    const turnId = '11111111-2222-4333-8444-555555555555';
    const send = (chipId: string) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, turn_id: turnId, message: 'Yes, use those.', source: 'chip', chip: { id: chipId },
    } });
    const a = await send('agent-approve-proposal:prop_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(a.statusCode).toBe(200);
    const retry = await send('agent-approve-proposal:prop_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(retry.statusCode, 'the exact A retry replays').toBe(200);
    expect(retry.json().assistant_text).toBe(a.json().assistant_text);
    const b = await send('agent-approve-proposal:prop_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(b.statusCode, 'B under A\u2019s turn_id is a DIFFERENT request').toBe(409);
    expect(b.json().error).toBe('TURN_ID_REUSED');
  });
});
