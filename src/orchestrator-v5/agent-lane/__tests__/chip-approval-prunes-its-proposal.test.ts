/**
 * ⭐ THE APPROVE CHIP'S OWN RECORD RESOLVES ITS PROPOSAL IN THE HISTORY (DL scoreboard PJ-C1, token half).
 *
 * Served run `pj-20260927T181846Z` (CEE 523e18d): all four approvals in journey A were chip clicks (`hops: 0`, no model
 * call), and each proposal's output then rode in every later request — first-call input 15.4k → 22.8k tokens over
 * ten turns against a 15,000 cap. The fast path appends ONLY the chip's words and Olumi's status to the history
 * (agent-v1-turn.ts :1696–1751): no authorise_change call, no proposal id. So `pruneSupersededToolOutputs` reading
 * the history alone could never see this approval; the route hands it the turn's own approval results.
 *
 * Driven through the REAL route: propose (one model call) → chip approve (zero) → a typed question, whose request
 * is captured at the provider boundary. CONTROL: a proposal nobody approved rides verbatim into the next request.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const APPROVED = '7a2c4e1f-3b5d-4c6e-8f10-2a4b6c8d0e1f';
const PENDING = '8b3d5f20-4c6e-4d7f-9a21-3b5c7d9e1f20';
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

// A link is proposed only with the band the user typed THIS turn (#70 5845493088).
const TYPED_BAND = 'Team size strongly drives velocity, so connect them.';

type Item = { type?: string; call_id?: string; output?: string };

describe('the approve chip resolves its proposal in the history the next request carries', () => {
  let app: FastifyInstance;
  /** What the provider was sent, request by request. */
  const requests: { input: Item[] }[] = [];
  /** The next model outputs, in order; an empty queue answers in words. */
  const script: unknown[][] = [];
  /** Each scenario's own links: the approved one must not make the control's link already exist. */
  const edges = new Map<string, { from: string; to: string }[]>();
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      requests.push({ input: (JSON.parse(String(init?.body ?? '{}')) as { input?: Item[] }).input ?? [] });
      const output = script.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'This would connect Team size to Velocity.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const held = edges.get((req.params as { id: string }).id) ?? [];
      return { graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges: held }, graph_hash: `h${held.length}` };
    });
    app.post('/orchestrate/v2/turn', async (req) => {
      const b = req.body as { kind?: string; scenario_id?: string; event?: { from: string; to: string } };
      if (b.kind === 'system_event' && b.event) edges.set(String(b.scenario_id), [...(edges.get(String(b.scenario_id)) ?? []), { from: b.event.from, to: b.event.to }]);
      return { assistant_text: 'Added.' };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
    // The route module's first import can take over a minute on a loaded machine.
  }, 300_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  const turn = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', ...payload } });
  const propose = async (scenario_id: string, callId: string) => {
    script.push([{
      type: 'function_call', name: 'propose_model_change', call_id: callId,
      arguments: JSON.stringify({ from_label: 'Team size', to_label: 'Velocity', direction: 'positive', strength: 'strong', rationale: 'It moves velocity.' }),
    }]);
    const r = await turn({ scenario_id, message: TYPED_BAND });
    const b = r.json() as { suggested_actions: { id: string; message: string }[]; _agent: { tool_calls: { name: string; proposal_id?: string }[] } };
    const proposalId = b._agent.tool_calls.find((c) => c.name === 'propose_model_change')?.proposal_id;
    expect(proposalId, 'the control: a real proposal was made').toMatch(/^prop_/);
    return { proposalId: proposalId!, approve: b.suggested_actions.find((a) => a.id === `agent-approve-proposal:${proposalId}`)! };
  };
  /** The output the NEXT request carries for this call, and whether its call is still beside it. */
  const carried = (callId: string) => {
    const input = requests[requests.length - 1]!.input;
    const output = input.find((i) => i.type === 'function_call_output' && i.call_id === callId)?.output;
    const paired = input.some((i) => i.type === 'function_call' && i.call_id === callId);
    return { output, paired };
  };

  // ⭐ PJ-C1 tokens (`dropSupersededPairs`): the stubbed pair then leaves the history, call and output together.
  it('RED: after a chip approval the next request carries neither the proposal’s call nor its output — only the words', async () => {
    const { proposalId, approve } = await propose(APPROVED, 'c_link');
    expect(approve, 'the approve chip was offered').toBeDefined();
    const sent = requests.length;
    const clicked = await turn({ scenario_id: APPROVED, message: approve.message, source: 'chip', chip: { id: approve.id } });
    const b = clicked.json() as { _agent: { tool_calls: { name: string; ok: boolean; proposal_id?: string }[] }; _diagnostic_trace: { fast_path?: string } };
    expect(requests.length - sent, 'ZERO model calls on the click').toBe(0);
    expect(b._diagnostic_trace.fast_path).toBe('approve');
    expect(b._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, proposal_id: proposalId })]);

    await turn({ scenario_id: APPROVED, message: 'What did that change?' });
    const { output, paired } = carried('c_link');
    expect(paired, 'the applied proposal’s call is not carried').toBe(false);
    expect(output, 'nor its output (valid input: no output without its call)').toBeUndefined();
    const input = requests[requests.length - 1]!.input as Array<{ role?: string; content?: Array<{ text?: string }> }>;
    const words = JSON.stringify(input.filter((i) => i.role === 'user'));
    expect(words, 'the conversation’s words stay').toContain(TYPED_BAND);
    expect(JSON.stringify(input)).not.toContain(proposalId);
  });

  it('CONTROL: a proposal nobody approved is carried verbatim into the next request', async () => {
    const { proposalId } = await propose(PENDING, 'c_pending');
    await turn({ scenario_id: PENDING, message: 'Tell me more before I decide.' });
    const { output, paired } = carried('c_pending');
    expect(paired).toBe(true);
    const kept = JSON.parse(String(output)) as { ok?: unknown; proposal_id?: unknown; superseded?: unknown };
    expect(kept.proposal_id, 'the pending proposal keeps its id and content').toBe(proposalId);
    expect(kept.ok).toBe(true);
    expect(kept.superseded).toBeUndefined();
  });
});
