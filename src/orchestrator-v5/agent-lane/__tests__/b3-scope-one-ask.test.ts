import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { goalScopeCheck, reconciliationPending, scopeQuestion } from '../goal-scope.js';
import { withoutProposalIds } from '../display-ids.js';
import { composeAnalysisStateV1 } from '../../compose/analysis-state-v1.js';
import { selectCanonicalAnalysisState } from '../../context/canonical-analysis-state.js';
import { GoalScopeSchema } from '../../../schemas/goal-scope.js';
import { readFileSync } from 'node:fs';
import { parsePendingAction } from '../../session/pending-action.js';
import { appendCheckedGraphWrite } from '../../persist-graph-write.js';
import { composeReplyShape, sentencesOf, sentenceMultiset, type FaceObligation, type ReplyComposition } from '../reply/compose-reply.js';
import { deriveAnswerTextFromShape } from '../../routing/answer-shape.js';
import { createProposal } from '../proposal.js';
import { proposalPendingAction } from '../durable-proposal.js';
import { withObjectiveConfirmCarry, objectiveCardOnTurn, objectiveConfirmFor } from '../decision-input-ask.js';

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
const CONFIRM = "I've assumed the goal is ‘Quarterly revenue’. Is that what you want to improve?";
type ReplyBody = { assistant_text: string; _answer_shape?: { headline: string; bullets: string[]; detail: string };
  blocks?: { type: string; content?: string }[]; suggested_actions?: { id: string; label: string; message: string }[] };
/** The rendered reply face includes native text cards; the assistant's folded detail is not a resting ask. */
const visibleFace = (body: ReplyBody): string => [body._answer_shape
  ? [body._answer_shape.headline, ...body._answer_shape.bullets].join('\n') : body.assistant_text,
...body.blocks?.filter(b => b.type === 'text').map(b => b.content) ?? []].join('\n');
const expectObjectiveConfirm = (body: ReplyBody): void => {
  expect(body.blocks).toEqual(expect.arrayContaining([{ type: 'text', content: CONFIRM }]));
  expect(visibleFace(body)).toContain(CONFIRM);
  expect(visibleFace(body).match(/\?/g)).toHaveLength(1);
  expect(body.suggested_actions).toEqual(expect.arrayContaining([
    { id: 'objective-confirm:yes:revenue', label: 'Yes', message: `Yes — ${CONFIRM}` },
    { id: 'objective-confirm:change:revenue', label: 'Change it', message: OBJECTIVE },
  ]));
};
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
      // This is a readable, never-analysed model. Missing authority has separate fail-closed route rows.
      analysis_state: composeAnalysisStateV1({ canonical: selectCanonicalAnalysisState({ priorFacts: [],
        currentGraphHash: 'h0', currentGraph: { nodes, edges: [] }, priorFactsReadOk: true }), rawRobustness: null }),
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
    const body = response.json() as ReplyBody;
    const row = scripted.rows.find(r => r.turn_id === turnId)!;
    expect(row.assistantMessage).toBe(body.assistant_text);
    const replay = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().assistant_text).toBe(body.assistant_text);
    return { text: body.assistant_text, body, row };
  };
  it.each(['statement', 'visible', 'hidden'])('the inferred objective owns the successful build and retains the displaced scope ask (%s)', async placement => {
    const pending = reconciliationPending(SID, { kind: 'reconcile_goal_scope', goal_id: 'revenue', goal_label: 'Quarterly revenue',
      declared_scope: { modelled: 'the pilot alone', alternative: 'the whole business', stated_in_brief: false }, expected: 'scope', question: QUESTION, operands: [], derivations: [] });
    scripted.pending = pending;
    if (placement === 'visible') scripted.text += ` ${QUESTION}`;
    if (placement === 'hidden') scripted.text += ` Questions this model does not answer yet: ${QUESTION}`;
    const { text, body, row } = await turn();
    expectObjectiveConfirm(body);
    expect(visibleFace(body)).not.toContain(QUESTION);
    expect(body._answer_shape?.detail).toContain(QUESTION);
    expect(text.split(QUESTION)).toHaveLength(2);
    expect(body._answer_shape?.detail).toContain(OBJECTIVE);
    expect(row.pending_actions).toEqual(expect.arrayContaining([pending]));
  });
  it('the same inferred successful build without a scope issue confirms the objective and records its state', async () => {
    const { body, row } = await turn();
    expectObjectiveConfirm(body);
    expect(body._answer_shape?.detail).toContain(OBJECTIVE);
    expect(row.pending_actions).toEqual(expect.arrayContaining([expect.objectContaining({
      action: expect.objectContaining({ kind: 'objective_confirm', goal_id: 'revenue', goal_label: 'Quarterly revenue', state: 'asked' }),
    })]));
  });

  it.each([
    { label: 'Quarterly revenue', otherId: false },
    { label: 'Quarterly revenue prop_deadbeef', otherId: false },
    { label: 'Quarterly revenue prop_deadbeef', otherId: true },
  ])('raw hidden objective: one native confirm and one scrubbed provisional detail with durable/replay parity (%j)', async ({ label, otherId }) => {
    nodes[0]!.label = label;
    const raw = `I used "${label}" as a provisional objective. What should this model help you explore?`;
    if (otherId) scripted.text += ' Inspect prop_abcdef.';
    scripted.text += ` Questions this model does not answer yet: ${raw}`;
    const { text, body, row } = await turn();
    expect(text).not.toMatch(/prop_[0-9a-f]+/);
    expect(text.match(/provisional objective/g)).toHaveLength(1);
    expect(body._answer_shape?.detail).toContain(withoutProposalIds(raw));
    expect(visibleFace(body)).not.toContain('provisional objective');
    expect(visibleFace(body)).not.toMatch(/prop_[0-9a-f]+/);
    expect(visibleFace(body)).toContain('Is that what you want to improve?');
    expect(visibleFace(body).match(/\?/g)).toHaveLength(1);
    expect(row.pending_actions).toEqual(expect.arrayContaining([expect.objectContaining({
      action: expect.objectContaining({ kind: 'objective_confirm', goal_id: 'revenue', goal_label: label, state: 'asked' }),
    })]));
    expect(nodes[0]!.label).toBe(label);
  });

  it.each([
    { label: 'Pro', hidden: false, otherId: false },
    { label: 'Pro prop_deadbeef', hidden: false, otherId: false },
    { label: 'Pro prop_deadbeef', hidden: true, otherId: false },
    { label: 'Pro prop_deadbeef', hidden: false, otherId: true },
  ])('scope producer display: displaced question remains scrubbed in detail with unchanged authority (%j)', async ({ label, hidden, otherId }) => {
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
    const { text, body, row } = await turn();
    expectObjectiveConfirm(body);
    expect(text).not.toMatch(/prop_[0-9a-f]+/);
    expect(body._answer_shape?.detail).toContain(withoutProposalIds(question));
    expect(visibleFace(body)).not.toContain(withoutProposalIds(question));
    expect(row.pending_actions).toEqual(expect.arrayContaining([pending]));
  });
});

// The second route harness resets module state and installs its own transport mocks only at registration.
{
  // Real route and consented edit adapter; only the offline model and storage transport are supplied.
  const s = { text: '', build: true, pending: [] as unknown[], rows: [] as Record<string, unknown>[], graph: {} as Record<string, unknown> };
  const SID = 'ada227bb-1111-4111-8111-111111111111';
  const GOAL = 'annual_revenue';
  const FACE = "I've assumed the goal is ‘Annual revenue’. Is that what you want to improve?";
  const OTHER = 'Can either SSO or onboarding be completed with the team you have now?';
  const YES = `objective-confirm:yes:${GOAL}`;
  const CHANGE = `objective-confirm:change:${GOAL}`;
  const face = (body: Record<string, unknown>) => {
    const shape = body._answer_shape as { headline: string; bullets: string[] } | undefined;
    return [shape ? [shape.headline, ...shape.bullets].join('\n') : body.assistant_text,
      ...(body.blocks as { type: string; content?: string }[] ?? []).filter(b => b.type === 'text').map(b => b.content)].join('\n');
  };
  const carry = (row: Record<string, unknown>) => (row.pending_actions as { action: Record<string, unknown>; objective_confirm?: Record<string, unknown> }[] ?? [])
    .map(p => p.action.kind === 'objective_confirm' ? p.action : p.objective_confirm).find(Boolean);

  describe('Gate A objective confirm, identity-bound route rows', () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      vi.resetModules();
      vi.doMock('../runtime/agent-loop.js', async original => ({ ...await original<Record<string, unknown>>(), runAgentTurn: vi.fn(async () => ({
        assistant_text: s.text, items: [], tool_calls: s.build ? [{ name: 'build_model_from_brief', ok: true, mutated: true }] : [],
        tool_results: s.build ? [{ ok: true, mutated: true, ...(s.pending[0] ? { pending_action: s.pending[0] } : {}) }] : [],
        mutated: s.build, hops: 1, stopped_reason: 'answered', timing: {},
      })) }));
      vi.doMock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
      vi.doMock('../../session/index.js', () => ({ getSessionStore: () => ({
        ensureScenarioExists: async () => ({ user_id: null }),
        loadGraph: async () => structuredClone(s.graph),
        // Match production's conversation projection: durable sidecars come from the pending-action reader, not readRecent.
        readRecent: async () => [...s.rows].reverse().map(({ pending_actions: _pending, suggested_actions_run_key: _key, ...row }) => row),
        readCommittedTurn: async (_sid: string, tid: string) => s.rows.find(row => row.turn_id === tid) ?? null,
        readMostRecentPendingActions: async () => s.rows.filter(row => !String(row.turn_id).endsWith(':claim')).at(-1)?.pending_actions ?? s.pending,
        append: async (row: Record<string, unknown>) => {
          if (row.graph !== undefined) s.graph = structuredClone(row.graph) as Record<string, unknown>;
          const id = `row-${s.rows.length}`;
          s.rows.push({ ...row, id, assistant_message: row.assistantMessage ?? null, user_message: row.userMessage ?? null, created_at: new Date().toISOString() });
          return { id };
        },
      }) }));
      process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
      const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
      app = Fastify({ logger: false });
      app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: s.graph, graph_hash: 'h0',
        analysis_ready: { status: 'blocked', may_run: false },
        analysis_state: composeAnalysisStateV1({ canonical: selectCanonicalAnalysisState({ priorFacts: [], currentGraphHash: 'h0', currentGraph: s.graph, priorFactsReadOk: true }), rawRobustness: null }),
      }));
      await app.register(agentV1TurnRoute); await app.ready();
    }, 120000);
    afterAll(async () => {
      await app.close();
      vi.doUnmock('../runtime/agent-loop.js');
      vi.doUnmock('../../session/index.js');
      vi.doUnmock('../../../orchestrator/user-identity.js');
      vi.resetModules();
      delete process.env.AGENT_LANE_ENABLED;
      delete process.env.AGENT_LANE_PREVIEW;
    });
    beforeEach(() => {
      s.text = `I mapped the sprint's trade-offs. ${OTHER}`; s.build = true; s.pending = []; s.rows = [];
      s.graph = { nodes: [{ id: GOAL, kind: 'goal', label: 'Annual revenue', provenance: 'ai_inferred' }, { id: 'sso', kind: 'option', label: 'SSO' }], edges: [] };
    });
    const turn = async (opts: { id?: string; chip?: { id: string; label: string; message: string }; message?: string; session?: string } = {}) => {
      const id = opts.id ?? randomUUID();
      const payload = { kind: 'message', scenario_id: SID, turn_id: id, agent_session_id: opts.session ?? randomUUID(),
        message: opts.message ?? opts.chip?.message ?? 'Explore our sprint.', ...(opts.chip ? { chip: opts.chip } : {}) };
      const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
      expect(response.statusCode, response.body.slice(0, 1500)).toBe(200);
      const body = response.json() as Record<string, unknown>;
      const row = s.rows.find(r => r.turn_id === id)!;
      expect(row?.assistantMessage ?? row?.assistant_message).toBe(body.assistant_text);
      return { body, row, payload };
    };
    it('SERVED SHAPE: inferred goal outranks another resting ask, which is asked on the next reply', async () => {
      const first = await turn();
      expect(face(first.body)).toContain(FACE);
      expect(face(first.body).match(/\?/g)).toHaveLength(1);
      expect(first.body.suggested_actions).toEqual(expect.arrayContaining([
        { id: YES, label: 'Yes', message: `Yes — ${FACE}` }, { id: CHANGE, label: 'Change it', message: 'What should this model help you explore?' },
      ]));
      expect((first.body.suggested_actions as Record<string, unknown>[]).filter(a => a.id === YES || a.id === CHANGE).map(Object.keys)).toEqual([['id', 'label', 'message'], ['id', 'label', 'message']]);
      expect(face(first.body)).not.toContain(OTHER);
      expect(first.body.assistant_text).toContain('as a provisional objective. What should this model help you explore?');
      expect(carry(first.row)).toMatchObject({ goal_id: GOAL, goal_label: 'Annual revenue', state: 'asked', deferred_asks: [OTHER] });
      s.build = false; s.text = 'We can examine the delivery trade-offs.';
      const next = await turn();
      expect(face(next.body)).toContain(OTHER);
      expect(face(next.body)).not.toContain(FACE);
    });
    it('pending approval suppresses by name, retains pending over reload, then asks on the next reply', async () => {
      const { log } = await import('../../../utils/telemetry.js');
      const info = vi.spyOn(log, 'info');
      const proposal = createProposal({ scenario_id: SID, user_id: null, base_graph_identity_hash: 'h0',
        operations: [{ op: 'add_edge', path: `sso::${GOAL}` }], provenance: { authored_by: 'model_proposed' },
        validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Connect SSO to Annual revenue' });
      s.pending = [proposalPendingAction(proposal, { id: `agent-approve-proposal:${proposal.proposal_id}`, label: 'Make this change', message: 'Yes, make that change.' },
        { scenario_id: SID, emitted_at_iso: new Date().toISOString() })];
      expect(parsePendingAction(s.pending[0])).not.toBeNull();
      // The stored approval is carried even when it has no model-authored resting question.
      const first = await turn();
      expect(face(first.body)).not.toContain(FACE);
      expect(carry(first.row)).toMatchObject({ state: 'pending', goal_id: GOAL });
      expect(info.mock.calls.some(([fields, event]) => event === 'cee.objective_confirm.suppressed' && (fields as { suppressor?: string }).suppressor === 'pending_approval')).toBe(true);
      info.mockRestore();
      s.pending = []; for (const row of s.rows) row.pending_actions = (row.pending_actions as { action: { kind: string } }[] ?? []).filter(p => p.action.kind === 'objective_confirm');
      (await import('../held-approval-offers.js')).agentProposals.discard(proposal.proposal_id);
      s.build = false; s.text = 'That held change is resolved.';
      expect(face((await turn()).body)).toContain(FACE);
    });
    it('pending what_would_flip as stored never suppresses the objective', async () => {
      s.pending = [{ id: 'flip', scenario_id: SID, chip_id: 'what-flips', action: { kind: 'what_would_flip' }, preconditions: {}, emitted_at_iso: new Date().toISOString(), expires_at_iso: '2099-01-01T00:00:00Z', expires_at_turn_count: 30 }];
      expect(face((await turn()).body)).toContain(FACE);
    });
    it('Paul B1 from_brief + stated target stays silent and keeps the other question', async () => {
      s.graph = JSON.parse(readFileSync(new URL('./fixtures/goal-reach-paul-graph-632b92b9.json', import.meta.url), 'utf8')) as Record<string, unknown>;
      const nodes = s.graph.nodes as Record<string, unknown>[];
      expect(nodes.find(n => n.kind === 'goal')).toMatchObject({ id: 'mrr', provenance: 'from_brief', goal_threshold_raw: 20000 });
      const { body } = await turn();
      expect(face(body)).not.toContain('Is that what you want to improve?');
      expect(face(body)).toContain(OTHER);
    });
    it('same-turn replay gives exactly one ask; cold later replies retain asked state beyond the text window', async () => {
      const first = await turn();
      const replay = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: first.payload });
      expect(replay.statusCode).toBe(200);
      expect(face(replay.json())).toContain(FACE);
      expect(face(replay.json()).match(/Is that what you want to improve\?/g)).toHaveLength(1);
      expect(replay.json().assistant_text).toBe(first.body.assistant_text);
      expect(s.rows.filter(r => r.turn_id === first.payload.turn_id && r.response_emitted)).toHaveLength(1);
      s.build = false; s.text = 'The next issue is delivery capacity.';
      for (let i = 0; i < 22; i++) {
        const next = await turn();
        expect(face(next.body)).not.toContain(FACE);
        expect(carry(next.row)).toMatchObject({ state: 'asked', goal_id: GOAL });
      }
    });
    it('[Yes] connects to the existing consented edit door and confirms the exact stored goal', async () => {
      await turn(); s.build = false;
      const yes = await turn({ chip: { id: YES, label: 'Yes', message: `Yes — ${FACE}` } });
      expect((s.graph.nodes as Record<string, unknown>[]).find(n => n.id === GOAL)).toMatchObject({ label: 'Annual revenue', provenance: 'user_set' });
    expect(carry(yes.row)).toMatchObject({ state: 'answered' });
    expect(face(yes.body)).not.toContain(FACE);
    expect(face(yes.body)).toContain(OTHER);
      expect(face((await turn()).body)).not.toContain(FACE);
    });
    it('[Change it] opens #2537 objective question, no repeat of the confirm', async () => {
      await turn(); s.build = false;
      const changed = await turn({ chip: { id: CHANGE, label: 'Change it', message: 'What should this model help you explore?' } });
      expect(face(changed.body)).toContain('What should this model help you explore?');
      expect(face(changed.body)).not.toContain(FACE);
      expect(carry(changed.row)).toMatchObject({ state: 'change_requested' });
    });
    it('user-edited objective before build never asks', async () => {
      (s.graph.nodes as Record<string, unknown>[])[0]!.provenance = 'user_set';
      expect(face((await turn()).body)).not.toContain(FACE);
    });
    it('an explicit user answer before build never asks even when the draft still labels its goal inferred', async () => {
      const answer = await turn({ message: 'Our goal is ‘Annual revenue’.' });
      expect(face(answer.body)).not.toContain(FACE);
      expect(carry(answer.row)).toMatchObject({ state: 'answered', goal_id: GOAL });
    });
    it('an unchanged hidden graph registration retains asked state across reload', async () => {
      await turn();
      const store = (await import('../../session/index.js')).getSessionStore();
      await appendCheckedGraphWrite({ store, writesGraph: false, source: 'graph_register', baseGraphForInvariants: s.graph,
        write: { scenario_id: SID, turn_id: randomUUID(), turn_class: 'direct_answer', handler_id: null,
          request_hash: 'graph_registration:fixture', response_emitted: false, llm_calls_used: 0, duration_ms: 0, handler_facts: [] } });
      expect(carry(s.rows.at(-1)!)).toMatchObject({ state: 'asked', goal_id: GOAL });
      s.build = false; s.text = 'The model is ready to explore.';
      const next = await turn();
      expect(face(next.body)).not.toContain(FACE);
      expect(carry(next.row)).toMatchObject({ state: 'asked' });
    });
    it('durable state parses and survives wall/turn/revision expiry through the shared carry floor', async () => {
      const { row } = await turn();
      const pending = (row.pending_actions as unknown[]).map(parsePendingAction).find(p => p?.action.kind === 'objective_confirm');
      expect(pending).toBeTruthy();
      const exhausted = { ...pending!, expires_at_iso: '2000-01-01T00:00:00Z', expires_at_turn_count: 0 };
      let survived: typeof pending[] = [];
      await appendCheckedGraphWrite({ store: { ...(await import('../../session/index.js')).getSessionStore(), readMostRecentPendingActions: async () => [exhausted], append: async w => { survived = [...(w.pending_actions ?? [])]; return { id: 'next' }; } },
        writesGraph: false, source: 'agent_turn', baseGraphForInvariants: s.graph, write: { scenario_id: SID, turn_id: randomUUID(), turn_class: 'direct_answer', handler_id: null, request_hash: 'test', response_emitted: true, llm_calls_used: 0, duration_ms: 0, handler_facts: [] } });
      expect(survived).toHaveLength(1);
      expect(survived[0]?.action).toMatchObject({ state: 'asked', goal_id: GOAL });
    });
    it('a full three-slot approval row keeps ask state even when its inline carrier expires or is consumed', async () => {
      const state = objectiveConfirmFor(s.graph, null, null)!;
      const holds = [1, 2, 3].map(index => {
        const proposal = createProposal({ scenario_id: SID, user_id: null, base_graph_identity_hash: 'h0',
          operations: [{ op: 'add_edge', path: `option_${index}::${GOAL}` }], provenance: { authored_by: 'model_proposed' },
          validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: `Connect option ${index}` });
        return proposalPendingAction(proposal, { id: `agent-approve-proposal:${proposal.proposal_id}`, label: 'Make this change', message: 'Yes, make that change.' },
          { scenario_id: SID, emitted_at_iso: '2000-01-01T00:00:00Z' });
      });
      const full = withObjectiveConfirmCarry(holds, state, SID, new Date().toISOString());
      expect(full).toHaveLength(3);
      expect(full[0]?.objective_confirm).toEqual(state);
      let carried: typeof full = [];
      await appendCheckedGraphWrite({ store: { ...(await import('../../session/index.js')).getSessionStore(), readMostRecentPendingActions: async () => full, append: async w => { carried = [...(w.pending_actions ?? [])]; return { id: 'next' }; } },
        writesGraph: false, source: 'agent_turn', baseGraphForInvariants: s.graph, write: { scenario_id: SID, turn_id: randomUUID(), turn_class: 'direct_answer', handler_id: null, request_hash: 'test', response_emitted: true, llm_calls_used: 0, duration_ms: 0, handler_facts: [], pending_actions: [] } });
      expect(carried).toHaveLength(1);
      expect(carried[0]?.action).toEqual(state);
    });
    it('a pending confirm never binds a deleted or retyped goal; stale Yes never edits a factor', async () => {
      const pending = objectiveConfirmFor(s.graph, null, null)!;
      s.pending = withObjectiveConfirmCarry([], pending, SID, new Date().toISOString());
      (s.graph.nodes as Record<string, unknown>[])[0]!.kind = 'factor';
      s.build = false;
      expect(face((await turn()).body)).not.toContain(FACE);
      const asked = { ...pending, state: 'asked' as const, issued_turn_id: randomUUID() };
      for (const row of s.rows) row.pending_actions = withObjectiveConfirmCarry([], asked, SID, new Date().toISOString());
      const stale = await turn({ chip: { id: YES, label: 'Yes', message: `Yes — ${FACE}` } });
      expect(stale.body.assistant_text).toContain('no longer available');
      expect((s.graph.nodes as Record<string, unknown>[])[0]).toMatchObject({ kind: 'factor', provenance: 'ai_inferred' });
      s.graph.nodes = [];
      expect(face((await turn()).body)).not.toContain(FACE);
    });
    it('reload projects only the issuing card; a pending goal rename refreshes the unasked label', async () => {
      const { row } = await turn();
      const pending = (row.pending_actions as unknown[]).map(parsePendingAction).filter(p => p !== null);
      expect(objectiveCardOnTurn(pending, s.graph, null, row.turn_id as string)).toMatchObject({ state: 'asked', goal_id: GOAL });
      expect(objectiveCardOnTurn(pending, s.graph, null, randomUUID())).toBeNull();
      const prior = objectiveConfirmFor(s.graph, null, null)!;
      (s.graph.nodes as Record<string, unknown>[])[0]!.label = 'Customer retention';
      expect(objectiveConfirmFor(s.graph, prior, null)).toMatchObject({ state: 'pending', goal_id: GOAL, goal_label: 'Customer retention' });
    });
  });
}

describe('Gate A: one ranked next step by typed obligation identity', () => {
const composeFace = (c: ReplyComposition): string[] => (c.shape === null ? [] : [c.shape.headline, ...c.shape.bullets]);
/** Every sentence of `original` is in `shipped`, verbatim (bullet markers aside). */
const everySentenceKept = (original: string, shipped: string): void => {
  for (const line of original.split('\n')) {
    const body = line.replace(/^[ \t]{0,6}(?:[-•*]|\d{1,2}[.)])[ \t]{1,4}/, '');
    for (const s of sentencesOf(body)) expect(shipped, `kept: ${s.slice(0, 70)}`).toContain(s);
  }
};
/** RC6 changes the invariant only by the exact, occurrence-counted sentences the composer reports dropping. */
const everySentenceExceptReportedKept = (original: string, c: ReplyComposition): void => {
  const expected = sentenceMultiset(original);
  for (const dropped of c.measure?.said_once_dropped ?? []) {
    const sentences = sentenceMultiset(dropped);
    expect(sentences, 'each reported drop is one whole sentence').toHaveLength(1);
    const at = expected.indexOf(sentences[0]!);
    expect(at, `reported drop existed in the input: ${dropped}`).toBeGreaterThanOrEqual(0);
    expected.splice(at, 1);
  }
  expect(sentenceMultiset(c.text), 'input multiset minus exactly the reported dropped occurrences').toEqual(expected);
};

  const headline = 'Olumi built your sprint model.';
  const objective = "I've assumed the goal is ‘Annual revenue’. Is that what you want to improve?";
  const objectiveQuestion = 'Is that what you want to improve?';
  const other = 'Can either SSO or onboarding be completed in this sprint?';
  const context = 'The model retains the sprint dependencies and provisional assumptions so the team can examine them before relying on its analysis.';

  it.each(['host', 'narrator', 'guided'] as const)('a ranked objective carried only by its typed card outranks %s without adding card words to prose', (kind) => {
    const provisional = "I've used ‘Annual revenue’ as a provisional outcome. What should this model help you explore?";
    const displaced = kind === 'guided'
      ? 'The model needs the strength of onboarding to revenue. Give a rough strength to see the chance.' : other;
    const text = [headline, context, provisional, displaced].join('\n\n');
    const c = composeReplyShape({ faceContract: 'draft', text, typedControlQuestions: [objective], obligations: [
      { role: 'ask', text: objective, rank: 100, subjects: ['goal-annual-revenue'] },
      { role: 'detail', text: provisional },
      ...(kind === 'host' ? [{ role: 'ask' as const, text: displaced }]
        : kind === 'guided' ? [{ role: 'withheld_reason' as const, text: displaced, lead: true as const, ownsNextStep: true as const }] : []),
    ] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(headline);
    expect(c.shape!.bullets).toEqual([]);
    expect(c.selectedAskText).toBe(objectiveQuestion);
    expect(c.shape!.detail).toContain(displaced);
    expect(c.shape!.detail).toContain(provisional);
    expect(c.text).not.toContain(objective);
    expect(composeFace(c).join('\n')).not.toContain(objectiveQuestion);
    everySentenceKept(text, c.text);
  });

  it.each([false, true])('the highest ask rank wins independently of prose and obligation order (reversed = %s)', (reversed) => {
    const asks: FaceObligation[] = [
      { role: 'ask', text: objective, rank: 100, subjects: ['goal-annual-revenue'] },
      { role: 'ask', text: other, rank: 10, subjects: ['factor-sso', 'factor-onboarding'] },
    ];
    const ordered = reversed ? [...asks].reverse() : asks;
    const text = [headline, context, ...ordered.map((ask) => ask.text)].join('\n\n');
    const c = composeReplyShape({ faceContract: 'draft', text, obligations: ordered });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(headline);
    expect(c.shape!.bullets).toEqual([objectiveQuestion]);
    expect(c.selectedAskText).toBe(objectiveQuestion);
    expect(c.shape!.detail).toContain(other);
    expect(c.text).toBe(deriveAnswerTextFromShape(c.shape!));
    everySentenceKept(text, c.text);
  });

  it('a ranked goal-confirm card owns the one question; the displaced host and narrator questions stay in detail', () => {
    const narrator = 'Roughly how much revenue do you expect next year?';
    const text = [headline, context, objective, other, narrator].join('\n\n');
    const c = composeReplyShape({ faceContract: 'draft', text, obligations: [
      { role: 'ask', text: objective, rank: 100, subjects: ['goal-annual-revenue'] },
      { role: 'ask', text: other, subjects: ['factor-sso', 'factor-onboarding'] },
    ], typedControlQuestions: [objective] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(headline);
    expect(c.shape!.bullets).toEqual([]);
    expect(c.selectedAskText).toBe(objectiveQuestion);
    expect(composeFace(c).join('\n')).not.toContain(objectiveQuestion);
    expect(c.shape!.detail).toContain(objective);
    expect(c.shape!.detail).toContain(other);
    expect(c.shape!.detail).toContain(narrator);
    everySentenceKept(text, c.text);
  });

  it('the ranked objective outranks a guided sizing invitation without promoting a duplicate next step', () => {
    const guided = 'The model needs the strength of onboarding to revenue. Give a rough strength to see the chance.';
    const text = [headline, context, objective, guided, other].join('\n\n');
    const c = composeReplyShape({ faceContract: 'run', text, obligations: [
      { role: 'ask', text: objective, rank: 100, subjects: ['goal-annual-revenue'] },
      { role: 'withheld_reason', text: guided, lead: true, ownsNextStep: true },
      { role: 'ask', text: other },
    ], typedControlQuestions: [objective] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(headline);
    expect(c.shape!.bullets).toEqual([]);
    expect(c.selectedAskText).toBe(objectiveQuestion);
    expect(c.shape!.detail).toContain(guided);
    expect(c.shape!.detail).toContain(other);
    everySentenceKept(text, c.text);
  });

  it('rank survives quote rebinding, duplicate removal and overlapping ask merges', () => {
    const written = objective.replaceAll('‘', "'").replaceAll('’', "'");
    const text = [headline, written, context, written, other].join('\n\n');
    const c = composeReplyShape({ faceContract: 'draft', text, obligations: [
      { role: 'host', text: objectiveQuestion },
      { role: 'ask', text: objective, rank: 100, subjects: ['goal-annual-revenue'] },
      { role: 'ask', text: other },
    ] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.bullets).toEqual([objectiveQuestion]);
    expect(c.selectedAskText).toBe(objectiveQuestion);
    expect(c.shape!.detail).toContain(other);
    expect(c.text.split(objectiveQuestion)).toHaveLength(2);
    expect(c.measure!.said_once_dropped).toContain(objectiveQuestion);
    everySentenceExceptReportedKept(text, c);
  });
});
