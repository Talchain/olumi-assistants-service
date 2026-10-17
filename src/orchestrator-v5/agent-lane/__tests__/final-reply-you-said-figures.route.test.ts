import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Rec = Record<string, any>;
const rows = new Map<string, Rec>();
let lateText = '';
let stale = false;
let licensed = true;
let pendingUnavailable = false;
let receipted = false;
let deliveredAsk = false;
let offeredProposal: Rec | undefined;
let appendUnavailable = false;
let unsafeBar = false;
let reserveBar = false;
let heldStatements = true;
const receipt = { version: 2, version_id: 'saved-v2', mutation_id: 'mutation-v2', source_turn_id: 'approved-turn' };
const store = {
  ensureScenarioExists: async () => ({ user_id: null }),
  readCommittedTurn: async (_scenario: string, id: string) => rows.get(id) ?? null,
  readMostRecentPendingActions: async (_scenario: string, options?: Rec) => {
    if (pendingUnavailable && options?.onLatestRowId) throw new Error('pending unavailable');
    return [];
  },
  append: vi.fn(async (write: Rec, options?: Rec) => {
    if (appendUnavailable && options?.prepare) throw new Error('answer append unavailable');
    const previous = rows.get(write.turn_id);
    if (previous) return { id: previous.id, replayedPriorTurn: true };
    if (options?.prepare) write = { ...write, ...options.prepare(write, { finalPending: write.pending_actions ?? [], prospectiveGuidance: null }) };
    rows.set(write.turn_id, { ...write, id: `row-${rows.size}`, assistant_message: write.assistantMessage,
      user_message: write.userMessage, run_narration: write.run_narration });
    return { id: `row-${rows.size}` };
  }),
  readRecent: async () => [], readFactsFor: async () => [], readAnalysisInvalidatedAt: async () => null,
  releaseTurnClaim: async (_scenario: string, id: string) => { rows.delete(id); },
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async original => ({
  ...await original<Rec>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
vi.mock('../runtime/agent-loop.js', async original => ({
  ...await original<Rec>(), runAgentTurn: async () => ({
    assistant_text: 'Let us examine the assumptions.', items: [], mutated: false, hops: 0,
    stopped_reason: 'answered', reply_author: 'host',
    tool_calls: offeredProposal ? [{ name: offeredProposal.operations[0]?.op === 'set_limit' ? 'propose_limit_change' : 'propose_assumptions', ok: true, mutated: false, proposal_id: offeredProposal.proposal_id }] : receipted ? [{ name: 'authorise_change', ok: true, mutated: false }] : [],
    tool_results: offeredProposal ? [{ ok: true, proposal_id: offeredProposal.proposal_id, public_label: offeredProposal.public_label }] : receipted ? [{ ok: true, already_applied: true, receipts: [receipt] }] : [],
    timing: { total_ms: 1, provider_ms: 0, tool_ms: 0, overhead_ms: 1, tool_provider_ms: 0, provider_calls: 0, tool_calls: 0, hops: 0 },
  }),
}));
// A late host producer supplies synthetic prose after the existing upstream guards.
vi.mock('../reply/compose-reply.js', async original => {
  const actual = await original<Rec>();
  return { ...actual, composeReplyShape: (input: Rec) => ({ ...actual.composeReplyShape(input), text: lateText || input.text, shape: null }) };
});
vi.mock('../actions/rank.js', async original => {
  const actual = await original<Rec>();
  return { ...actual, actionBarOf: (...args: unknown[]) => {
    const bar = actual.actionBarOf(...args);
    return unsafeBar ? { ...bar, more: [{ ...bar.standard[0], label: 'You should choose Option A.' }] } : reserveBar ? { ...bar, more: [{ ...bar.standard[0], label: 'Use £150,000', detail: 'You said you\'d keep £50,000 back. Use £150,000 instead?' }] } : bar;
  } };
});
const SID = '7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const graph = { nodes: [{ id: 'goal', kind: 'goal', label: 'Revenue' },
  { id: 'a', kind: 'option', label: 'Option A' }, { id: 'b', kind: 'option', label: 'Option B' }, { id: 'factor', kind: 'factor', label: 'Retention', unit: '%' },
  ...[['reserve', 'Reserve', 50000], ['budget', 'Budget', 200000]].map(([id, label, value]) => ({ id, kind: 'factor', label, unit: 'GBP',
    user_statements: [{ subject_key: `factor|${id}|||level`, field: 'level', recorded_at: '2026-10-17T20:00:00Z', statements: [{
      speaker: 'user', quote: 'Our budget is £200,000 a year and we hold back £50,000 of it.',
      source: 'Our budget is £200,000 a year and we hold back £50,000 of it.', subject: { quantity: 'level', node_id: id },
      form: 'point', low: value, high: value, unit: 'GBP', reading: 'olumi',
    }] }] }))], edges: [] };
const licence = { code: 'GOAL_CHANCE_LICENSED', form: 'each', option_ids: ['a', 'b'], pct_by_option: { a: 67, b: 40 },
  goal_node_id: 'goal', goal_label: 'Revenue', option_labels_by_option: { a: 'Option A', b: 'Option B' },
  target: { comparator: 'at_least', value: 20000, unit: 'GBP/month' } };
const safe = 'Consider which assumption needs evidence next.';
const question = 'What is today’s Revenue level?';
const answer = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

describe('B4 final reply boundary through the real Agent route', () => {
  let app: FastifyInstance;
  let route: typeof import('../../../routes/agent-v1-turn.js');
  let isFinalised: typeof import('../../response-finaliser.js').isFinalisedV5Response;
  const regenerate = vi.fn(async (_request: Rec) => answer(safe));
  beforeAll(async () => {
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    route = await import('../../../routes/agent-v1-turn.js');
    isFinalised = (await import('../../response-finaliser.js')).isFinalisedV5Response;
  });
  beforeEach(async () => {
    rows.clear(); lateText = ''; stale = false; licensed = true; pendingUnavailable = false; receipted = false; deliveredAsk = false; offeredProposal = undefined; appendUnavailable = false; unsafeBar = false; reserveBar = false; heldStatements = true;
    regenerate.mockReset().mockImplementation(async () => answer(safe)); store.append.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('provider calls prohibited'); }));
    app = Fastify({ logger: false });
    app.addHook('preSerialization', async (request, reply, payload) => {
      if (request.url === '/agent/v1/turn' && reply.statusCode === 200) expect(isFinalised(payload), 'the checked envelope reaches serialization by identity').toBe(true);
      return payload;
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: heldStatements ? graph : { ...graph, nodes: graph.nodes.map(node => ({ ...node, user_statements: [] })) }, graph_hash: 'graph-1',
      analysis_result: { type: 'analysis_result', computed_against_hash: 'graph-1', enrichment: { inference_warnings: [
        ...(licensed ? [licence] : []), ...(deliveredAsk ? [{ code: 'GOAL_FIGURES_WITHHELD', first_ask: { kind: 'goal_level', node_id: 'goal', question } }] : []),
      ] } },
      analysis_ready: { status: 'ready', may_run: true, analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } },
      analysis_state: { contradictions: [], run_state: { kind: stale ? 'complete_stale' : 'complete_current', computed_at: '2026-10-17T13:00:00Z' },
        leader_claim: { permitted: true, separation: 'separated' } },
    }));
    await app.register(route.agentV1TurnRoute, { finalReplyRegenerate: regenerate as never });
    await app.ready();
  });
  afterAll(() => { delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  afterEach(async () => {
    if (offeredProposal) (await import('../held-approval-offers.js')).agentProposals.discard(offeredProposal.proposal_id);
    await app.close(); vi.unstubAllGlobals();
  });
  const turn = (id = randomUUID(), message = 'Discuss uncertainty.') => app.inject({ method: 'POST', url: '/agent/v1/turn',
    payload: { kind: 'message', scenario_id: SID, agent_session_id: randomUUID(), message, turn_id: id } });

  const reserveMessage = 'Our budget is £200,000 a year and we hold back £50,000 of it.';
  const reserveDetail = 'You said you\'d keep £50,000 back. Use £150,000 instead?';
  it('(b) row 1: the verified reserve paraphrase keeps its exact bytes without regeneration', async () => {
    lateText = `Your yearly budget limit would be £200,000. ${reserveDetail}`; licensed = false;
    const response = await turn(randomUUID(), reserveMessage);
    expect(response.statusCode, response.body).toBe(200);
    expect(regenerate).not.toHaveBeenCalled();
    expect(response.json().assistant_text).toBe(lateText);
  });
  it('(b) row 2: a control carrying the verified reserve paraphrase is preserved', async () => {
    lateText = safe; licensed = false; heldStatements = false;
    const { createProposal } = await import('../proposal.js');
    const { agentProposals } = await import('../held-approval-offers.js');
    offeredProposal = agentProposals.put(createProposal({ scenario_id: SID, user_id: null, base_graph_identity_hash: 'graph-1',
      operations: [{ op: 'set_limit', path: 'budget', value: { node_id: 'budget', operator: '<=', raw_value: 200000, unit: 'GBP',
        source_quote: reserveMessage, reserve: { amount: 50000, alternative: 150000, label: 'Use £150,000',
          message: 'Use £150,000 instead.', detail: reserveDetail } } }],
      provenance: { authored_by: 'model_proposed', basis: reserveMessage },
      validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Your yearly budget limit would be £200,000.',
    }));
    const response = await turn(randomUUID(), reserveMessage);
    expect(response.statusCode, response.body).toBe(200);
    expect(regenerate).not.toHaveBeenCalled();
    expect(response.json().assistant_text).toBe(safe);
    expect(response.json().suggested_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `agent-approve-proposal:${offeredProposal!.proposal_id}`, detail: offeredProposal!.public_label }),
      { id: `agent-approve-proposal:${offeredProposal!.proposal_id}:reserve`, label: 'Use £150,000', message: 'Use £150,000 instead.', detail: reserveDetail },
    ]));
  });
  it('(b) row 0 contrast: a verbatim user sentence after you said passes without regeneration', async () => {
    lateText = `You said: ${reserveMessage}`; licensed = false;
    const response = await turn(randomUUID(), reserveMessage);
    expect(response.statusCode, response.body).toBe(200);
    expect(regenerate).not.toHaveBeenCalled();
    expect(response.json().assistant_text).toBe(lateText);
  });
  it('(b) row 3 contrast: same control without the reserve detail keeps the bar', async () => {
    reserveBar = false; lateText = safe; licensed = false;
    const response = await turn(randomUUID(), reserveMessage);
    expect(regenerate).not.toHaveBeenCalled();
    expect(response.json().action_bar).toBeDefined();
  });
  it.each([
    'You said you would keep £60,000 back.',
    'You said you would keep €50,000 back.',
    'You said you would keep -£50,000 back.',
    'You said Retention was £50,000.',
    'You said you would keep £60,000 back, while the budget was £50,000.',
  ])('an unverified value/unit/sign/identity cannot borrow another figure: %s', async bad => {
    lateText = bad; licensed = false;
    const response = await turn(randomUUID(), reserveMessage);
    expect(response.statusCode, response.body).toBe(200);
    expect(regenerate).toHaveBeenCalledOnce();
    expect(response.json().assistant_text).toBe(safe);
  });

});
