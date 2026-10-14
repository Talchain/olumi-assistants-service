/** The exact typed answer reaches the real identity proposal door even when the Agent calls no tool. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { identityPartFiguresToIssue, identityReadingOf } from '../identity-card.js';
import { createProposal } from '../proposal.js';
import { proposalPendingAction } from '../durable-proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Graph = { nodes: Record<string, any>[]; edges: Record<string, unknown>[] };
const SID = '828d87ac-0000-4000-8000-00000000004b';
const raw: Graph = JSON.parse(readFileSync(new URL('../../system-events/__tests__/fixtures/b1-828d87ac-stored-graph.json', import.meta.url), 'utf8'));
// The served graph's failed Yes is already true; before that press, the same reading awaited confirmation.
const graph = structuredClone(raw);
graph.nodes.find(n => n.id === 'mrr')!.nonlinear_identity.stated_in_brief = false;
const node = (g: Graph, id: string) => g.nodes.find(n => n.id === id)!;
const answered = { graph, userText: 'We have 300 Pro subscribers', toolCalls: [], mutated: false, proposalOffered: false, pending: [] } as const;
const COUNT = { part_label: 'pro_paying_subscribers', value: 300, unit: 'Pro paying subscribers' };

describe('the pure typed answer decision on 828d87ac', () => {
  it('an exact count in THIS turn issues its one part; approximate or absent figures issue nothing', () => {
    expect(identityPartFiguresToIssue(answered)).toEqual({ parts: [COUNT] });
    expect(identityPartFiguresToIssue({ ...answered, userText: 'We have about 300 Pro subscribers' })).toBeUndefined();
    expect(identityPartFiguresToIssue({ ...answered, userText: 'We have 300-ish Pro subscribers' })).toBeUndefined();
    expect(identityPartFiguresToIssue({ ...answered, userText: 'We have Pro subscribers' })).toBeUndefined();
  });

  it('all missing parts must have one exact figure, with their stored units', () => {
    const both = structuredClone(graph);
    node(both, 'pro_plan_price').observed_state = { unit: '£ per Pro subscriber per month' };
    expect(identityPartFiguresToIssue({ ...answered, graph: both })).toBeUndefined();
    expect(identityPartFiguresToIssue({ ...answered, graph: both, userText: '300' })).toBeUndefined();
    expect(identityPartFiguresToIssue({ ...answered, graph: both, userText: 'Our Pro plan price is £49. We have 300 Pro subscribers.' }))
      .toEqual({ parts: [{ part_label: 'pro_plan_price', value: 49, unit: '£ per Pro subscriber per month' }, COUNT] });
  });

  it('a stored unit is threaded verbatim; it takes precedence over the label count', () => {
    const statedUnit = structuredClone(graph);
    node(statedUnit, 'pro_paying_subscribers').observed_state = { unit: ' Pro paying subscribers ' };
    expect(identityPartFiguresToIssue({ ...answered, graph: statedUnit })).toEqual({ parts: [{ ...COUNT, unit: ' Pro paying subscribers ' }] });
  });

  it.each([
    { userText: null }, { mutated: true }, { proposalOffered: true },
    { toolCalls: [{ name: 'propose_identity' }] }, { toolCalls: [{ name: 'authorise_change' }] },
    { userText: 'We have 0 Pro subscribers' }, { userText: 'We have 300 or 400 Pro subscribers' },
  ])('no issue when the typed answer has no licence: %j', over => {
    expect(identityPartFiguresToIssue({ ...answered, ...over })).toBeUndefined();
  });

  it('a held change blocks issuance; the identity card itself does not', () => {
    const held = (op: 'set_factor_value' | 'confirm_identity') => {
      const proposal = createProposal({ scenario_id: SID, user_id: null, base_graph_identity_hash: 'pin',
        operations: [{ op, path: op === 'confirm_identity' ? 'mrr' : 'pro_plan_price', value: {} }],
        provenance: { authored_by: 'model_proposed' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: op });
      return proposalPendingAction(proposal, { id: `agent-approve-proposal:${proposal.proposal_id}`, label: 'Yes', message: 'Yes.' },
        { scenario_id: SID, emitted_at_iso: new Date().toISOString() });
    };
    expect(identityPartFiguresToIssue({ ...answered, pending: [held('set_factor_value')] })).toBeUndefined();
    expect(identityPartFiguresToIssue({ ...answered, pending: [held('confirm_identity')] })).toEqual({ parts: [COUNT] });
  });

  it('the stored plural reading parser preserves distinct positive figures and refuses duplicates', () => {
    const proposal = createProposal({ scenario_id: SID, user_id: null, base_graph_identity_hash: 'pin',
      operations: [{ op: 'confirm_identity', path: 'mrr', value: { outcome_id: 'mrr', operation: 'product',
        factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], words: 'Olumi reads ‘MRR’ as price × subscribers. Is that how you work it out?',
        part_levels: [{ part_id: 'pro_plan_price', raw_value: 49, unit: 'GBP/month' }, { part_id: 'pro_paying_subscribers', raw_value: 300, unit: 'subscribers' }] } }],
      provenance: { authored_by: 'user_stated' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Reading' });
    expect(identityReadingOf(proposal)?.part_levels).toHaveLength(2);
    const bad = structuredClone(proposal);
    const value = bad.operations[0]!.value as { part_levels: { part_id: string }[] };
    value.part_levels[1]!.part_id = 'pro_plan_price';
    expect(identityReadingOf(bad)).toBeUndefined();
  });
});

const appends: Record<string, unknown>[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readMostRecentPendingActions: vi.fn(async () => []),
  append: vi.fn(async (w: Record<string, unknown>) => { appends.push(w); return { id: `answer-${appends.length}` }; }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('one real Agent turn on the stored 828d87ac graph', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    // Same local model seam as current-level-answer.route: the Agent answers without selecting any tool.
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      expect(String(url)).toMatch(/\/v1\/responses$/);
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'I’ve noted that figure.' }] }] }), { status: 200 });
    }));
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('no Agent tool call → route proposes once and offers “(300, your figure)” on the approve chip; no graph write', async () => {
    const before = structuredClone(graph);
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SID, agent_session_id: `identity-answer-${randomUUID()}`, message: answered.userText,
    } });
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json();
    expect(b._agent.tool_calls.filter((c: { name: string }) => c.name === 'propose_identity')).toHaveLength(1);
    expect(b.suggested_actions).toContainEqual(expect.objectContaining({ id: expect.stringContaining('agent-approve-proposal:'),
      label: "Yes, that's how", detail: expect.stringContaining('(300, your figure)'), message: expect.stringContaining('(300, your figure)') }));
    expect(appends.some(w => w.graph !== undefined)).toBe(false);
    expect(graph).toEqual(before);
  });
});
