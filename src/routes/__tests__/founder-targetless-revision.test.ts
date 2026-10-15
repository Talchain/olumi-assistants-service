/** Actual 57801434 rev-2 graph + recorded redraft, through tool dispatch, construction/admission,
 * card, approval and the REAL register route. Store/provider doubles: offline proof, not served proof. */
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';

vi.mock('../../config/index.js', async (original) => {
  const actual = await original<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
const { storeRef } = vi.hoisted(() => ({ storeRef: { value: null as object | null } }));
vi.mock('../../orchestrator-v5/session/index.js', async (original) => ({
  ...await original<Record<string, unknown>>(), getSessionStore: () => withScenarioRevision(storeRef.value!),
}));
vi.mock('../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
vi.mock('../../orchestrator-v5/drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_ctx: unknown, _brief: unknown, _op: unknown, call: unknown,
    build: (drafter: unknown) => Promise<unknown>) => build(call),
}));

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { createAgentCapabilities, type InternalDispatch } from '../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { dispatchTool } from '../../orchestrator-v5/agent-lane/runtime/agent-tools.js';
import { constructionOperationId, type CallStructuredModel } from '../../orchestrator-v5/agent-lane/runtime/build-model.js';
import { ProposalStore } from '../../orchestrator-v5/agent-lane/proposal.js';
import { registrationTurnId } from '../../orchestrator-v5/graph-registration/registration-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { computeGraphIdentityHash } from '../../orchestrator-v5/context/graph-identity.js';
import { readGoalRecord } from '../../orchestrator-v5/goal-target/goal-record.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('../../orchestrator-v5/agent-lane/__tests__/fixtures/founder-57801434-targetless-revision.json', import.meta.url), 'utf8')) as Rec;
const SID = FX.scenario_id as string;
const GOAL = 'funding_secured';
const OUTCOME = 'larger_fund_secured';
const closed: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closed.splice(0)) await close(); });

async function harness(graph: Rec = FX.graph, raw: Rec[] = FX.turns[0].calls.map((c: Rec) => JSON.parse(c.raw_text))) {
  let stored = structuredClone(graph);
  const writes: Rec[] = [];
  const ledger = { write_turn_ids: [registrationTurnId(SID, constructionOperationId(SID, FX.brief_text))],
    user_message_turn_ids: ['brief-turn'], first_user_message: FX.brief_text.trim(), complete: true };
  storeRef.value = {
    append: vi.fn(async (write: Rec) => { stored = structuredClone(write.graph); writes.push(write); return { id: write.turn_id }; }),
    loadGraph: async () => structuredClone(stored),
    ensureScenarioExists: async () => ({ user_id: null }), getScenarioOwner: async () => null,
    scenarioExists: async () => true, readCommittedTurn: async () => null, readMostRecentPendingActions: async () => [],
  };
  const app = Fastify();
  await registerRoute(app); await app.ready(); closed.push(() => app.close());
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(stored), brief_text: FX.brief_text,
      graph_hash: computeAnalysisAffectingGraphHash(stored as never), graph_identity_hash: computeGraphIdentityHash(stored as never) } };
    if (path.endsWith('/graph/register')) {
      const response = await injectAsCeeWriter(app, { method: 'POST', url: path, payload: body as Record<string, unknown> });
      return { status: response.statusCode, json: response.json() };
    }
    return { status: 404, json: {} };
  };
  let calls = 0;
  const sent: Rec[] = [];
  const model = (async (request: Rec) => { sent.push(structuredClone(request)); return { text: JSON.stringify(raw[Math.min(calls++, raw.length - 1)]) }; }) as unknown as CallStructuredModel;
  const proposals = new ProposalStore();
  const caps = createAgentCapabilities(dispatch, proposals, model, 'full', undefined, {
    readCommittedTurnLedger: async () => structuredClone(ledger), readStatedObjections: async () => [],
  });
  const request = FX.turns[0].request;
  const context = (message = request.message) => ({ scenario_id: SID, authenticated_user_id: null,
    request_id: 'req-founder', turn_id: request.turn_id, user_turn_text: message,
    user_text: `${FX.brief_text}\n${message}`, verified_user_messages: [FX.brief_text, message] });
  const revise = async (message?: string) => dispatchTool('propose_change', JSON.stringify({ ops: [
    { op: 'revise_model', kind: 'goal', label: 'Funding secured', quote: context(message).user_turn_text },
  ] }), context(message) as never, caps) as Promise<Rec>;
  const approve = async (offer: Rec) => {
    ledger.user_message_turn_ids.push(request.turn_id);
    return caps.authoriseChange({ ...context(), turn_id: 'approve-founder', user_turn_text: '', typed_approval_of: offer.proposal_id },
      { proposal_id: offer.proposal_id } as never);
  };
  const candidateOf = (offer: Rec) => proposals.get(String(offer.proposal_id))!.operations[0]!.value as Rec;
  return { revise, approve, caps, context, writes, sent, candidateOf, graph: () => structuredClone(stored) };
}

describe('founder correction: goal-owned targets, separate outcome targets and explicit approval', () => {
  it('RED captured rev-2 + actual typed correction + recorded targetless redraft → OFFERED → real register → readback', async () => {
    expect(readGoalRecord(FX.graph, GOAL)?.target?.raw).toBeUndefined();
    const eventual = FX.graph.goal_constraints.find((r: Rec) => r.node_id === OUTCOME);
    expect(eventual).toMatchObject({ role: 'goal_target', value: 1.3, unit: 'million (currency unspecified)' });
    expect(FX.graph.nodes.find((n: Rec) => n.id === OUTCOME).kind).toBe('outcome');
    const s = await harness(); const offer = await s.revise();
    expect(offer, JSON.stringify(offer)).toMatchObject({ ok: true, mutated: false });
    expect(offer.public_label).toContain('has no numeric target, as before');
    expect(offer.public_label).toContain('Larger fund secured');
    expect(offer.public_label.match(/‘Larger fund secured’ at least 1\.3/g)).toHaveLength(1);
    expect(s.writes).toHaveLength(0);
    expect(s.candidateOf(offer).candidate.goal_constraints).toContainEqual(expect.objectContaining(eventual));
    expect(await s.approve(offer)).toMatchObject({ ok: true, applied: true, mutated: true });
    expect(s.writes).toHaveLength(1);
    const reopened = s.graph();
    expect(readGoalRecord(reopened, reopened.nodes.find((n: Rec) => n.kind === 'goal').id)?.target?.raw).toBeUndefined();
    expect(reopened.goal_constraints).toContainEqual(expect.objectContaining(eventual));
  });

  it('never-revised goal target dropped by the drafter → refused, even with a separate eventual outcome target', async () => {
    const graph = structuredClone(FX.graph);
    graph.goal_constraints.push({ constraint_id: 'current-funding-target', node_id: GOAL, role: 'goal_target',
      operator: '>=', value: 250000, unit: '£', provenance: 'explicit', value_frame: 'level' });
    // Adverse producer contrast: it keeps the eventual outcome's row but drops the governing goal's row.
    const raw = FX.turns[0].calls.map((c: Rec) => {
      const draft = JSON.parse(c.raw_text);
      draft.outcomes.push({ label: 'Larger fund secured', provenance: 'explicit', unit: 'million (currency unspecified)', plausible_max: null });
      draft.constraints.push({ metric: 'Larger fund secured', operator: '>=', value: 1.3,
        unit: 'million (currency unspecified)', provenance: 'explicit', frame: 'level', role: 'target' });
      return draft;
    });
    const s = await harness(graph, raw); const offer = await s.revise();
    expect(offer).toMatchObject({ ok: false, refusal: 'revised_draft_has_no_target' });
    expect(s.writes).toHaveLength(0);
    expect(s.graph()).toEqual(graph);
  });

  it('typed at least £250k for the current goal → provisional source-bound card → approval → readback, eventual ambition kept', async () => {
    const message = 'For the current goal, I need angel funding secured of at least £250,000.';
    const raw = JSON.parse(FX.turns.find((t: Rec) => t.turn === 10).calls[0].raw_text);
    raw.goal = { ...raw.goal, target_stated: true, value: 250000, unit: '£', operator: '>=' };
    // Scripted binding contrast, not a claim that the recorded model supplied this binding.
    raw.statements = raw.statements.map((s: Rec) => s.value === 250000
      ? { ...s, quote: message, field: 'target', qualifier: null, conditions: null } : s);
    raw.constraints.push({ metric: raw.goal.metric, operator: '>=', value: 250000, unit: '£', provenance: 'explicit', frame: 'level', role: 'target' });
    const s = await harness(FX.graph, [raw]);
    const offer = await dispatchTool('propose_goal_target', JSON.stringify({ measures: 'angel funding secured', value: 250000,
      unit: '£', constraint_type: 'at_least', rationale: message }), s.context(message) as never, s.caps) as Rec;
    expect(offer, JSON.stringify(offer)).toMatchObject({ ok: true, mutated: false, revised_draft: { holds_this_target: true } });
    expect(s.sent[0]!.input).toContain(JSON.stringify({ speaker: 'user', source: 'typed', text: message }));
    const prepared = s.candidateOf(offer).candidate;
    expect(prepared.goal_constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ node_id: 'angel_funding_secured', value: 250000, provenance: 'inferred' }),
      expect.objectContaining(FX.graph.goal_constraints.find((r: Rec) => r.node_id === OUTCOME)),
    ]));
    const goal = prepared.nodes.find((n: Rec) => n.id === 'angel_funding_secured');
    expect(JSON.stringify(goal.user_statements)).toContain(message);
    expect(goal.observed_state?.raw_value).not.toBe(250000);
    expect(s.writes).toHaveLength(0);
    expect(await s.approve(offer)).toMatchObject({ ok: true, applied: true });
    expect(s.graph().goal_constraints).toEqual(prepared.goal_constraints);
  });

  it('the recorded conditional £250k statement stays conditional; a qualitative revision never turns it into today’s funding', async () => {
    const recorded = FX.turns.find((t: Rec) => t.turn === 10);
    const raw = JSON.parse(recorded.calls[0].raw_text);
    expect(raw.statements[11]).toMatchObject({ value: 250000, field: 'level', conditions: 'if angel funding can be secured' });
    expect(raw.goal).toMatchObject({ target_stated: false, value: null });
    const s = await harness(FX.graph, [raw]); const offer = await s.revise(recorded.request.message);
    expect(offer, JSON.stringify(offer)).toMatchObject({ ok: true, mutated: false });
    const prepared = s.candidateOf(offer).candidate;
    const goal = prepared.nodes.find((n: Rec) => n.kind === 'goal');
    expect(readGoalRecord(prepared, goal.id)?.target?.raw).toBeUndefined();
    expect(goal.observed_state?.raw_value).not.toBe(250000);
    expect(JSON.stringify(goal.user_statements)).toContain('if angel funding can be secured');
    expect(s.writes).toHaveLength(0);
  });

  it.each([
    'Keep the fundraising target at 1.3 million. The advertising budget is £250,000 per year.',
    'My earlier £250,000 target is withdrawn; keep the original target.',
  ])('an unrelated/withdrawn numeral cannot replace the goal target: %s', async (message) => {
    const graph = structuredClone(FX.graph);
    Object.assign(graph.nodes.find((n: Rec) => n.id === GOAL), { goal_threshold_raw: 1.3, goal_threshold_unit: 'million (currency unspecified)' });
    const raw = JSON.parse(FX.turns[0].calls[0].raw_text);
    raw.goal = { ...raw.goal, target_stated: true, value: 250000, unit: '£', operator: '>=' };
    const s = await harness(graph, [raw]);
    expect(await s.revise(message)).toMatchObject({ ok: false, refusal: 'revised_draft_drops_stated_target' });
    expect(s.writes).toHaveLength(0);
  });
});
