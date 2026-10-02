/** Native continuation across the actual proposal and approval paths; no real provider calls. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
const db = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  return { rows, store: {
    ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
    readRecent: vi.fn(async (sid: string, limit: number) => [...rows.values()].filter(r => r.scenario_id === sid).slice(-limit)),
    readCommittedTurn: vi.fn(async (sid: string, tid: string) => rows.get(`${sid}:${tid}`) ?? null),
    append: vi.fn(async (r: Record<string, unknown>) => {
      const key = `${r.scenario_id}:${r.turn_id}`;
      if (!rows.has(key)) rows.set(key, { ...r, user_message: r.userMessage ?? null, assistant_message: r.assistantMessage ?? null });
      return { id: String(r.turn_id) };
    }),
  } };
});
vi.mock('../../session/index.js', () => ({ getSessionStore: () => db.store }));
vi.mock('../../../orchestrator/user-identity.js', async original => ({
  ...(await original<Record<string, unknown>>()), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('native context trial: genuine proposal, approval, retry and follow-up', () => {
  let app: FastifyInstance;
  const sent: Record<string, unknown>[] = [];
  const commits: unknown[] = [];
  let edges: { from: string; to: string }[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      sent.push(JSON.parse(String(init?.body ?? '{}')));
      const output = sent.length === 1 ? [{ type: 'function_call', name: 'propose_model_change', call_id: 'native_proposal_1',
        arguments: JSON.stringify({ from_label: 'Team size', to_label: 'Velocity', direction: 'positive', strength: 'strong', rationale: 'The user stated this relationship.' }) }]
        : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'We can now examine this relationship.' }] }];
      return new Response(JSON.stringify({ id: `resp_approval_${sent.length}`, status: 'completed', output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    process.env.OLUMI_ENV = 'staging'; process.env.OPENAI_NATIVE_CONTEXT_TRIAL = 'isolated';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges },
      graph_hash: `h${edges.length}`,
    }));
    app.post('/orchestrate/v2/turn', async req => {
      const b = req.body as { kind?: string; event?: { from: string; to: string } };
      if (b.kind === 'system_event' && b.event) { edges = [...edges, { from: b.event.from, to: b.event.to }]; commits.push(b); }
      return { assistant_text: 'Added.' };
    });
    await app.register(agentV1TurnRoute); await app.ready();
  }, 120_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.OPENAI_NATIVE_CONTEXT_TRIAL; delete process.env.AGENT_LANE_ENABLED;
    delete process.env.AGENT_LANE_PREVIEW; delete process.env.OLUMI_ENV;
  });
  it('one approved change, no provider call on approval/retry, and one pending tool result on the next call', async () => {
    const sid = randomUUID();
    const send = (message: string, extra: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: '/agent/v1/turn',
      payload: { scenario_id: sid, kind: 'message', message, turn_id: randomUUID(), ...extra } });
    const proposed = await send('Team size strongly drives velocity, so connect them.');
    expect(proposed.statusCode, proposed.body).toBe(200);
    const body = proposed.json();
    const proposalId = body._agent.tool_calls.find((c: { name: string }) => c.name === 'propose_model_change')?.proposal_id;
    expect(proposalId).toMatch(/^prop_/);
    const chip = body.suggested_actions.find((c: { id: string }) => c.id === `agent-approve-proposal:${proposalId}`);
    expect(chip).toBeDefined(); expect(commits).toHaveLength(0);
    const before = sent.length; const tid = randomUUID();
    const approvalPayload = { turn_id: tid, source: 'chip', chip: { id: chip.id } };
    const approved = await send(chip.message, approvalPayload);
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()._diagnostic_trace.fast_path).toBe('approve');
    expect(approved.json()._agent.native_context.continuity).toBe('active');
    expect(sent).toHaveLength(before); expect(commits).toHaveLength(1);
    expect(edges).toEqual([{ from: 'f1', to: 'o1' }]);
    const replay = await send(chip.message, approvalPayload);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()._agent.replayed).toBe(true);
    expect(sent).toHaveLength(before); expect(commits).toHaveLength(1);
    const next = await send('What did we just approve?');
    expect(next.statusCode, next.body).toBe(200);
    expect(sent).toHaveLength(before + 1);
    const req = sent[before]!;
    expect(req.previous_response_id).toBe(`resp_approval_${before}`);
    const input = req.input as { type?: string; call_id?: string; role?: string; content?: unknown }[];
    // On the composed-reply path the proposal output was not sent before the reply reached the user.
    // It must now be delivered once, not omitted or re-executed.
    if (before === 1) expect(input.filter(i => i.type === 'function_call_output' && i.call_id === 'native_proposal_1')).toHaveLength(1);
    expect(input.some(i => i.type === 'function_call')).toBe(false);
    expect(JSON.stringify(input)).toContain(approved.json().assistant_text);
    expect(JSON.stringify(input)).toContain('CURRENT MODEL STATE');
    expect(commits).toHaveLength(1);
  });
});
