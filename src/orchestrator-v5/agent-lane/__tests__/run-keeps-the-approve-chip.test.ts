/**
 * ⛔ PRESSING RUN MUST NOT DELETE THE WAY TO APPROVE WHAT IS STILL WAITING.
 *
 * MEASURED on served `4fd2703` (Technical Architecture, #63 5808759682, scenario `1a847853`): a fresh
 * brief offered the approve chip AND "Run analysis" (#1792). Pressing Run produced an honest, fragile,
 * provisional answer — and `suggested_actions: []`, because a Run turn's chips were derived from that
 * turn's own tool calls, and `run_analysis` carries no proposal. The approve chip that would ground the
 * provisional answer was gone; the same click that invited the user removed the way to improve it.
 *
 * A Run changes no graph, so the proposal it followed is exactly as valid as before. The Run turn now
 * carries forward the approve chip last offered for this scenario — only while that proposal is the ONE
 * still awaiting a yes AND the store would execute it on the current revision.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const SCENARIO = '5a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4c';
/** Records committed answer rows by (scenario, turn), so a same-turn_id retry takes the REAL replay path. */
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; pending_actions?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) rows.set(k, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0, pending_actions: JSON.parse(JSON.stringify(w.pending_actions ?? [])) });
    return { id: rows.get(k)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

let hash: string | undefined = 'h1';
let modelCalls = 0;
let agentCalls = 0;

describe('a Run turn keeps the approve chip for the proposal still awaiting a yes', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      modelCalls += 1;
      if (body['tool_choice'] === 'none') {
        return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'On this provisional run, Team size matters most.' }] }] }), { status: 200 });
      }
      agentCalls += 1;
      if (agentCalls === 1) {
        return new Response(JSON.stringify({ output: [{
          type: 'function_call', name: 'propose_model_change', call_id: 'c1',
          arguments: JSON.stringify({ from_label: 'Team size', to_label: 'Velocity', direction: 'positive', rationale: 'More people ship more.' }),
        }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'This would connect Team size to Velocity.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: hash,
      blocks: [{ type: 'analysis_result', data: { marker: 'the-run' } }], analysis_ready: { status: 'ready', options: [], blockers: [] } }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges: [] },
      ...(hash !== undefined ? { graph_hash: hash } : {}),
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  type Body = { suggested_actions: { id: string; label: string }[]; _diagnostic_trace: { fast_path?: string }; _agent: { tool_calls: { name: string; proposal_id?: string }[] } };
  const ask = (sid = SCENARIO) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: sid, message: 'Should team size drive velocity?' } });
  const run = (turnId?: string, sid = SCENARIO) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    kind: 'message', scenario_id: sid, message: 'Run analysis.', source: 'chip', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' },
    ...(turnId !== undefined ? { turn_id: turnId } : {}),
  } });

  it('RED: propose, then press Run → the Run turn still offers that proposal’s approve chip, and the amend chip', async () => {
    const first = (await ask()).json() as Body;
    const proposalId = first._agent.tool_calls.find((c) => c.name === 'propose_model_change')?.proposal_id;
    expect(proposalId, 'the control: a proposal really is awaiting a yes').toMatch(/^prop_/);
    expect(first.suggested_actions.map((a) => a.id)).toContain(`agent-approve-proposal:${proposalId}`);

    const r = await run();
    expect(r.statusCode).toBe(200);
    const b = r.json() as Body;
    expect(b._diagnostic_trace.fast_path, 'the control: fast path 3 ran').toBe('run');
    expect(b.suggested_actions.map((a) => [a.id, a.label])).toEqual([
      [`agent-approve-proposal:${proposalId}`, 'Make this change'],
      ['agent-amend-proposal', 'Change something first'],
    ]);
  });

  it('CONTRAST: the model changed since it was proposed → the Run turn offers no stale approve chip', async () => {
    hash = 'h2';
    const b = (await run()).json() as Body;
    expect(b._diagnostic_trace.fast_path).toBe('run');
    expect(b.suggested_actions.some((a) => a.id.startsWith('agent-approve-proposal:'))).toBe(false);
  });

  /**
   * ⛔ A REPLAY USES THE SAME PREDICATE (Codex #1807 5810816841): replaying the same Run turn after the
   * model moved re-offered the approve chip on id membership alone. Same turn_id, same body, no model call.
   */
  it('REPLAY, model unchanged → the same approve and amend chips, and no model call', async () => {
    hash = 'h3';
    agentCalls = 0;
    const first = (await ask('6a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a01')).json() as Body;
    const proposalId = first._agent.tool_calls.find((c) => c.name === 'propose_model_change')?.proposal_id;
    agentCalls = 0;
    const T = '2b1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a01';
    const S = '6a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a01';
    const once = (await run(T, S)).json() as Body;
    expect(once.suggested_actions.map((a) => a.id)).toEqual([`agent-approve-proposal:${proposalId}`, 'agent-amend-proposal']);
    const before = modelCalls;
    const again = (await run(T, S)).json() as Body & { _agent: { replayed?: boolean } };
    expect(again._agent.replayed, 'the control: this took the replay path').toBe(true);
    expect(modelCalls - before, 'no model call on replay').toBe(0);
    expect(again.suggested_actions.map((a) => a.id)).toEqual([`agent-approve-proposal:${proposalId}`, 'agent-amend-proposal']);
  });

  it('RED: REPLAY after the model moved → neither approve nor amend', async () => {
    hash = 'h4';
    agentCalls = 0;
    await ask('6a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a02');
    agentCalls = 0;
    const T = '2b1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a02';
    const S = '6a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a02';
    const once = (await run(T, S)).json() as Body;
    expect(once.suggested_actions.some((a) => a.id.startsWith('agent-approve-proposal:')), 'the control: offered at h4').toBe(true);
    hash = 'h5';
    const again = (await run(T, S)).json() as Body & { _agent: { replayed?: boolean } };
    expect(again._agent.replayed).toBe(true);
    expect(again.suggested_actions.filter((a) => a.id.startsWith('agent-approve-proposal:') || a.id === 'agent-amend-proposal')).toEqual([]);
  });

  it('REPLAY with no readable revision → no approval chip (fails closed)', async () => {
    hash = 'h6';
    agentCalls = 0;
    await ask('6a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a03');
    agentCalls = 0;
    const T = '2b1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a03';
    const S = '6a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a03';
    await run(T, S);
    hash = undefined;
    const again = (await run(T, S)).json() as Body;
    expect(again.suggested_actions.some((a) => a.id.startsWith('agent-approve-proposal:'))).toBe(false);
  });
});
