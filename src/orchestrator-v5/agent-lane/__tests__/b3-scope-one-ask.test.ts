import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { goalScopeCheck, reconciliationPending, scopeQuestion } from '../goal-scope.js';
import { textAtRest } from '../decision-input-ask.js';
import { withoutProposalIds } from '../display-ids.js';
import { GoalScopeSchema } from '../../../schemas/goal-scope.js';

// Actual route composition and durable answer; the successful construction result is
// supplied offline. This does not attest a draft, computation or served persistence.
const scripted = vi.hoisted(() => ({ text: '', pending: undefined as unknown, rows: [] as Record<string, unknown>[] }));
vi.mock('../runtime/agent-loop.js', async original => ({
  ...await original<Record<string, unknown>>(),
  runAgentTurn: vi.fn(async () => ({ assistant_text: scripted.text, items: [],
    tool_calls: [{ name: 'build_model_from_brief', ok: true, mutated: true }],
    tool_results: [{ ok: true, mutated: true, ...(scripted.pending ? { pending_action: scripted.pending } : {}) }],
    mutated: true, hops: 1, stopped_reason: 'answered', timing: {},
  })),
}));
vi.mock('../../session/index.js', () => ({ getSessionStore: () => ({
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readRecent: vi.fn(async () => []),
  readCommittedTurn: vi.fn(async (_sid: string, tid: string) => scripted.rows.find(row => row.turn_id === tid) ?? null),
  readMostRecentPendingActions: vi.fn(async () => []),
  append: vi.fn(async (row: Record<string, unknown>) => { scripted.rows.push({ ...row, assistant_message: row.assistantMessage ?? null }); return { id: String(scripted.rows.length) }; }),
}) }));
vi.mock('../../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

const SID = 'eb0799d4-b732-4079-a617-0ae78c5a192a';
const QUESTION = 'Does quarterly revenue mean the pilot alone or the whole business?';
const OBJECTIVE = 'What should this model help you explore?';
describe('B3 one-ask ownership with the retained construction scope issue', () => {
  let app: FastifyInstance;
  const defaultNodes = () => [{ id: 'revenue', kind: 'goal', label: 'Quarterly revenue', provenance: 'ai_inferred', goal_threshold_raw: 100, threshold_source: 'user' }, { id: 'pilot', kind: 'option', label: 'Pilot' }];
  let nodes: Record<string, unknown>[] = defaultNodes();
  beforeAll(async () => {
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes, edges: [] },
      graph_hash: 'h0', analysis_ready: { status: 'blocked', may_run: false },
    }));
    await app.register(agentV1TurnRoute); await app.ready();
  }, 120000);
  afterAll(async () => { await app.close(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { scripted.rows = []; scripted.text = 'The model is a sketch to challenge.'; scripted.pending = undefined; nodes = defaultNodes(); });
  const turn = async () => {
    const turnId = randomUUID();
    const payload = { kind: 'message', scenario_id: SID, turn_id: turnId, message: 'Explore our next quarter.' };
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
    expect(response.statusCode, response.body.slice(0, 1000)).toBe(200);
    const body = response.json() as { assistant_text: string };
    const row = scripted.rows.find(r => r.turn_id === turnId)!;
    expect(row.assistantMessage).toBe(body.assistant_text);
    const replay = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().assistant_text).toBe(body.assistant_text);
    return { text: body.assistant_text, row };
  };
  it.each(['statement', 'visible', 'hidden'])('RED: the fresh scope ask owns the successful build once (%s)', async placement => {
    const pending = reconciliationPending(SID, { kind: 'reconcile_goal_scope', goal_id: 'revenue', goal_label: 'Quarterly revenue',
      declared_scope: { modelled: 'the pilot alone', alternative: 'the whole business', stated_in_brief: false }, expected: 'scope', question: QUESTION, operands: [], derivations: [] });
    scripted.pending = pending;
    if (placement === 'visible') scripted.text += ` ${QUESTION}`;
    if (placement === 'hidden') scripted.text += ` Questions this model does not answer yet: ${QUESTION}`;
    const { text, row } = await turn();
    expect(textAtRest(text)).toContain(QUESTION);
    expect(text.split(QUESTION)).toHaveLength(2);
    expect(textAtRest(text).match(/\?/g)).toHaveLength(1);
    expect(text).not.toContain(OBJECTIVE);
    expect(row.pending_actions).toEqual([pending]);
  });
  it('CONTROL: the same inferred successful build without a scope issue still offers the objective', async () => {
    const { text, row } = await turn();
    expect(textAtRest(text)).toContain(OBJECTIVE);
    expect(textAtRest(text).match(/\?/g)).toHaveLength(1);
    expect(row.pending_actions ?? []).toEqual([]);
  });

  it.each([
    { label: 'Quarterly revenue', otherId: false },
    { label: 'Quarterly revenue prop_deadbeef', otherId: false },
    { label: 'Quarterly revenue prop_deadbeef', otherId: true },
  ])('raw hidden objective RED/control: one visible offer with durable/replay parity (%j)', async ({ label, otherId }) => {
    nodes[0]!.label = label;
    const raw = `I used "${label}" as a provisional objective. What should this model help you explore?`;
    if (otherId) scripted.text += ' Inspect prop_abcdef.';
    scripted.text += ` Questions this model does not answer yet: ${raw}`;
    const { text, row } = await turn();
    expect(text).not.toMatch(/prop_[0-9a-f]+/);
    expect(text.match(/provisional objective/g)).toHaveLength(1);
    expect(textAtRest(text)).toContain(withoutProposalIds(raw));
    expect(textAtRest(text).match(/\?/g)).toHaveLength(1);
    expect(row.pending_actions ?? []).toEqual([]);
    expect(nodes[0]!.label).toBe(label);
  });

  it.each([
    { label: 'Pro', hidden: false, otherId: false },
    { label: 'Pro prop_deadbeef', hidden: false, otherId: false },
    { label: 'Pro prop_deadbeef', hidden: true, otherId: false },
    { label: 'Pro prop_deadbeef', hidden: false, otherId: true },
  ])('scope producer display RED/control: one scrubbed question with unchanged authority (%j)', async ({ label, hidden, otherId }) => {
    nodes.push({ id: 'rate', kind: 'factor', label: 'Price', observed_state: { value: .5, raw_value: 49, cap: 98, unit: 'GBP/subscriber/month', source: 'brief_extraction' } },
      { id: 'count', kind: 'factor', label: 'Accounts', observed_state: { value: .5, raw_value: 300, cap: 600, unit: 'subscribers', source: 'brief_extraction' } });
    const scope = GoalScopeSchema.parse({ modelled: 'total business revenue', alternative: 'Pro revenue', extent: 'total', stated_in_brief: true,
      source: { quote: 'total business revenue' }, component: { label, rate_id: 'rate', count_id: 'count', basis: 'unknown', source: { quote: label } } });
    const check = goalScopeCheck({ nodes, edges: [] }, 'revenue', scope);
    expect(check.referencesValid).toBe(true);
    const question = scopeQuestion('Quarterly revenue', scope, check);
    const pending = reconciliationPending(SID, { kind: 'reconcile_goal_scope', goal_id: 'revenue', goal_label: 'Quarterly revenue', scope,
      expected: 'component_share', question, operands: check.operands, derivations: check.derivations });
    scripted.pending = pending;
    if (otherId) scripted.text += ' Inspect prop_abcdef.';
    scripted.text += `${hidden ? ' Questions this model does not answer yet:' : ''} ${question}`;
    const { text, row } = await turn();
    expect(text).not.toMatch(/prop_[0-9a-f]+/);
    expect(textAtRest(text)).toContain(withoutProposalIds(question));
    expect(textAtRest(text).match(/\?/g)).toHaveLength(1);
    expect(row.pending_actions).toEqual([pending]);
  });
});
