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
import { computeGraphIdentityHash, normaliseGraphForIdentity } from '../../orchestrator-v5/context/graph-identity.js';
import { readGoalRecord } from '../../orchestrator-v5/goal-target/goal-record.js';
import { MEANING_FLAG_NOTE, meaningFlagWords } from '../../orchestrator-v5/agent-lane/runtime/meaning-flags.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('../../orchestrator-v5/agent-lane/__tests__/fixtures/founder-57801434-targetless-revision.json', import.meta.url), 'utf8')) as Rec;
const SID = FX.scenario_id as string;
const GOAL = 'funding_secured';
const OUTCOME = 'larger_fund_secured';
const closed: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closed.splice(0)) await close(); });

async function harness(graph: Rec = FX.graph, raw: Rec[] = FX.turns[0].calls.map((c: Rec) => JSON.parse(c.raw_text)),
  history?: { scenario_id: string; brief_text: string; messages: { turn_id: string; user_message: string }[];
    correction: { turn_id: string; message: string }; constructionRecorded: boolean }) {
  const scenarioId = history?.scenario_id ?? SID;
  const brief = history?.brief_text ?? FX.brief_text;
  let stored = structuredClone(graph);
  const writes: Rec[] = [];
  const ledger = { write_turn_ids: [registrationTurnId(scenarioId, constructionOperationId(scenarioId, brief))],
    user_message_turn_ids: history?.messages.map(m => m.turn_id) ?? ['brief-turn'],
    first_user_message: history?.messages[0]?.user_message.trim() ?? brief.trim(),
    later_user_messages: history?.messages.slice(1).map(m => ({ turn_id: m.turn_id, text: m.user_message })) ?? [], complete: true };
  if (history?.constructionRecorded === false) ledger.write_turn_ids = [];
  storeRef.value = {
    append: vi.fn(async (write: Rec) => { stored = structuredClone(write.graph); writes.push(write); return { id: write.turn_id }; }),
    loadGraph: async () => structuredClone(stored),
    ensureScenarioExists: async () => ({ user_id: null }), getScenarioOwner: async () => null,
    scenarioExists: async () => true, readCommittedTurn: async () => null, readMostRecentPendingActions: async () => [],
  };
  const app = Fastify();
  await registerRoute(app); await app.ready(); closed.push(() => app.close());
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(stored), brief_text: brief,
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
  const request = history?.correction ?? FX.turns[0].request;
  const context = (message = request.message) => ({ scenario_id: scenarioId, authenticated_user_id: null,
    request_id: 'req-founder', turn_id: request.turn_id, user_turn_text: message,
    user_text: `${brief}\n${message}`, verified_user_messages: [brief, message] });
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

  it('BUDDY raw stated governing target is never masked by an unrelated drafted outcome target: the card OPENS with its loss', async () => {
    const graph = structuredClone(FX.graph);
    Object.assign(graph.nodes.find((n: Rec) => n.id === GOAL), { goal_threshold_raw: 1.3, goal_threshold_unit: 'million (currency unspecified)' });
    expect(readGoalRecord(graph, GOAL)?.target).toMatchObject({ raw: 1.3, unit: 'million (currency unspecified)' });
    expect(graph.goal_constraints.filter((r: Rec) => r.node_id === GOAL)).toHaveLength(0);
    const raw = FX.turns[0].calls.map((c: Rec) => {
      const draft = JSON.parse(c.raw_text);
      draft.outcomes.push({ label: 'Larger fund secured', provenance: 'explicit', unit: 'million (currency unspecified)', plausible_max: null });
      draft.constraints.push({ metric: 'Larger fund secured', operator: '>=', value: 1.3,
        unit: 'million (currency unspecified)', provenance: 'explicit', frame: 'level', role: 'target' });
      return draft;
    });
    const s = await harness(graph, raw);
    const offer = await s.revise('Keep the fundraising target at 1.3 million. The advertising budget is £250,000 per year.');
    // ⭐ CONFIRM, NOT REFUSE (PLAN-CONFIRM-NOT-REFUSE step 2): a separate outcome target never hides the governing goal's loss.
    // The card is offered and opens with that loss, by the goal's own saved figure; only the user's press saves it.
    expect(offer, JSON.stringify(offer).slice(0, 600)).toMatchObject({ ok: true, mutated: false });
    expect(String(offer.public_label).startsWith(`${meaningFlagWords({ kind: 'goal_target_change',
      from: '\u2018Funding secured\u2019 1.3 million (currency unspecified)',
      to: '\u2018Progress on funding, PoC and hiring\u2019 with no numeric target' })} Replace the early draft`), String(offer.public_label)).toBe(true);
    expect(String(offer.note)).toContain(MEANING_FLAG_NOTE.trim());
    expect(s.writes).toHaveLength(0);
    expect(s.graph()).toEqual(graph);
  });

  it('never-revised goal target dropped by the drafter → the card opens with that loss; only the press saves it, eventual outcome target kept', async () => {
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
    expect(offer, JSON.stringify(offer).slice(0, 600)).toMatchObject({ ok: true, mutated: false });
    expect(String(offer.public_label).startsWith(`${meaningFlagWords({ kind: 'goal_target_change',
      from: '\u2018Funding secured\u2019 at least \u00a3250,000',
      to: '\u2018Progress on funding, PoC and hiring\u2019 with no numeric target' })} Replace the early draft`), String(offer.public_label)).toBe(true);
    expect(String(offer.note)).toContain(MEANING_FLAG_NOTE.trim());
    expect(s.writes).toHaveLength(0);
    expect(s.graph()).toEqual(graph);
    // The press saves exactly what the card said: the goal holds no target row; the eventual outcome target is kept.
    expect(await s.approve(offer)).toMatchObject({ ok: true, applied: true, mutated: true });
    const saved = s.graph();
    const goalNow = saved.nodes.find((n: Rec) => n.kind === 'goal');
    expect(saved.goal_constraints.filter((r: Rec) => r.node_id === goalNow.id)).toEqual([]);
    expect(saved.goal_constraints.some((r: Rec) => r.value === 250000)).toBe(false);
    expect(saved.goal_constraints).toContainEqual(expect.objectContaining({ value: 1.3, unit: 'million (currency unspecified)', role: 'goal_target' }));
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

  // ⭐ CONFIRM ON THE CARD (PLAN-CONFIRM-NOT-REFUSE, second conversion; VERIFY-ec381b25 turn 12, the founder's words verbatim):
  // the goal-target call holds the user's own £250,000, but the redraft held NO target, so it was refused
  // `revised_draft_has_no_target`. The host puts the CALL's target on the redraft's goal as Olumi's reading (`inferred`).
  it('RED turn 12: a goal-target call whose redraft holds no target → the call\u2019s own £250,000 on the goal, flagged as Olumi\u2019s reading; only the press saves it', async () => {
    const message = 'If I could secure angel funding of even £250,000, that would buy me the breathing space to bring in technical resource and allow me to have more time.';
    const raw = JSON.parse(FX.turns.find((t: Rec) => t.turn === 10).calls[0].raw_text);
    expect(raw.goal).toMatchObject({ target_stated: false, value: null });
    const s = await harness(FX.graph, [raw]);
    const offer = await dispatchTool('propose_goal_target', JSON.stringify({ measures: 'angel funding', value: 250000,
      unit: '£', constraint_type: 'at_least', rationale: message }), s.context(message) as never, s.caps) as Rec;
    expect(offer, JSON.stringify(offer).slice(0, 600)).toMatchObject({ ok: true, mutated: false, revised_draft: { holds_this_target: true } });
    // The card OPENS with Olumi's reading (which goal the user's figure governs); the eventual 1.3 million is carried, said once.
    expect(String(offer.public_label).startsWith(`${meaningFlagWords({ kind: 'goal_target_reading', figure: 'at least \u00a3250,000',
      goal: '\u2018Angel funding secured\u2019' })} Replace the early draft`), String(offer.public_label)).toBe(true);
    expect(String(offer.public_label).match(/1\.3 million/g)).toHaveLength(1);
    expect(String(offer.note)).toContain(MEANING_FLAG_NOTE.trim());
    const prepared = s.candidateOf(offer).candidate;
    const goal = prepared.nodes.find((n: Rec) => n.kind === 'goal');
    // The user's figure, comparator and unit; its goal binding is Olumi's reading, so the row is stored `inferred`.
    expect(prepared.goal_constraints.filter((r: Rec) => r.node_id === goal.id)).toEqual([{ constraint_id: `agent-lane:${goal.id}:>=`,
      node_id: goal.id, role: 'goal_target', operator: '>=', value: 250000, unit: '\u00a3', label: goal.label, provenance: 'inferred', value_frame: 'level' }]);
    expect(prepared.goal_constraints).toContainEqual(expect.objectContaining(FX.graph.goal_constraints.find((r: Rec) => r.node_id === OUTCOME)));
    expect(s.writes).toHaveLength(0);
    expect(await s.approve(offer)).toMatchObject({ ok: true, applied: true, mutated: true });
    const saved = s.graph();
    const savedGoal = saved.nodes.find((n: Rec) => n.kind === 'goal');
    expect(readGoalRecord(saved, savedGoal.id)?.target).toMatchObject({ raw: 250000 });
    expect(saved.goal_constraints.find((r: Rec) => r.node_id === savedGoal.id)).toMatchObject({ value: 250000, provenance: 'inferred' });
    expect(saved.goal_constraints).toContainEqual(expect.objectContaining({ node_id: OUTCOME, value: 1.3 }));
  });

  it.each([{ value: 0, refusal: 'target_not_positive' }, { value: -1, refusal: 'target_not_stated' }])('BUDDY B1: the restated-goal handoff refuses a non-positive at-least target (£$value) before drafting or offering a card', async ({ value, refusal }) => {
    const message = `I need angel funding of at least £${value} to bring in technical resource.`;
    const raw = JSON.parse(FX.turns.find((t: Rec) => t.turn === 10).calls[0].raw_text);
    const s = await harness(FX.graph, [raw]);
    const offer = await dispatchTool('propose_goal_target', JSON.stringify({ measures: 'angel funding', value,
      unit: '£', constraint_type: 'at_least', rationale: message }), s.context(message) as never, s.caps) as Rec;
    expect(offer).toMatchObject({ ok: false, mutated: false, refusal });
    expect(offer.proposal_id).toBeUndefined();
    expect(s.sent).toHaveLength(0);
    expect(s.writes).toHaveLength(0);
    expect(s.graph()).toEqual(FX.graph);
  });

  it('BUDDY B1 contrast: an at-most zero reading keeps the supported comparator, with nothing saved before approval', async () => {
    const message = 'I need angel funding of at most £0 to bring in technical resource.';
    const raw = JSON.parse(FX.turns.find((t: Rec) => t.turn === 10).calls[0].raw_text);
    const s = await harness(FX.graph, [raw]);
    const offer = await dispatchTool('propose_goal_target', JSON.stringify({ measures: 'angel funding', value: 0,
      unit: '£', constraint_type: 'at_most', rationale: message }), s.context(message) as never, s.caps) as Rec;
    expect(offer).toMatchObject({ ok: true, mutated: false, revised_draft: { holds_this_target: true } });
    const candidate = s.candidateOf(offer).candidate;
    const goal = candidate.nodes.find((n: Rec) => n.kind === 'goal');
    expect(candidate.goal_constraints.find((r: Rec) => r.node_id === goal.id)).toMatchObject({
      operator: '<=', value: 0, provenance: 'inferred' });
    expect(s.writes).toHaveLength(0);
  });

  it('the cached call reading belongs to its quantity, never another call with the same figure', async () => {
    const message = 'If I could secure angel funding of even £250,000, that would buy me the breathing space to bring in technical resource and allow me to have more time.';
    const raw = JSON.parse(FX.turns.find((t: Rec) => t.turn === 10).calls[0].raw_text);
    const s = await harness(FX.graph, [raw]);
    const call = { measures: 'angel funding', value: 250000, unit: '£', constraint_type: 'at_least', rationale: message };
    const first = await dispatchTool('propose_goal_target', JSON.stringify(call), s.context(message) as never, s.caps) as Rec;
    const other = await dispatchTool('propose_goal_target', JSON.stringify({ ...call, measures: 'technical resource' }), s.context(message) as never, s.caps) as Rec;
    expect(first).toMatchObject({ ok: true, revised_draft: { holds_this_target: true } });
    expect(other).toMatchObject({ ok: true, proposal_id: first.proposal_id, revised_draft: { holds_this_target: 'unknown' } });
    expect(s.sent).toHaveLength(1);
    expect(s.writes).toHaveLength(0);
  });

  it('a strict call target retains its strict comparator through the schema, approval and readback', async () => {
    const message = 'I need angel funding of more than £250,000 to bring in technical resource and allow me to have more time.';
    const raw = JSON.parse(FX.turns.find((t: Rec) => t.turn === 10).calls[0].raw_text);
    const s = await harness(FX.graph, [raw]);
    const offer = await dispatchTool('propose_goal_target', JSON.stringify({ measures: 'angel funding', value: 250000,
      unit: '£', constraint_type: 'at_least', rationale: message }), s.context(message) as never, s.caps) as Rec;
    expect(offer).toMatchObject({ ok: true, mutated: false, revised_draft: { holds_this_target: true } });
    const prepared = s.candidateOf(offer).candidate;
    const goal = prepared.nodes.find((n: Rec) => n.kind === 'goal');
    expect(prepared.goal_constraints.find((r: Rec) => r.node_id === goal.id)).toMatchObject({
      operator: '>=', operator_as_stated: '>', value: 250000, provenance: 'inferred' });
    expect(String(offer.public_label)).toContain('Olumi read above £250,000');
    expect(s.writes).toHaveLength(0);
    expect(await s.approve(offer)).toMatchObject({ ok: true, applied: true, mutated: true });
    expect(s.graph().goal_constraints.find((r: Rec) => r.node_id === goal.id)).toMatchObject({
      operator: '>=', operator_as_stated: '>', value: 250000, provenance: 'inferred' });
    expect(readGoalRecord(s.graph(), goal.id)?.target).toMatchObject({ raw: 250000, comparator: '>' });
  });

  it('CONTRAST turn 12: a figure the user did not write about the redraft\u2019s goal is never put on it; still refused, nothing written', async () => {
    const message = 'If I could secure angel funding of even £250,000, that would buy me the breathing space to bring in technical resource and allow me to have more time.';
    const raw = JSON.parse(FX.turns.find((t: Rec) => t.turn === 10).calls[0].raw_text);
    raw.goal = { ...raw.goal, metric: 'Technical resource hired', unit: 'people' };
    const s = await harness(FX.graph, [raw]);
    const offer = await dispatchTool('propose_goal_target', JSON.stringify({ measures: 'angel funding', value: 250000,
      unit: '£', constraint_type: 'at_least', rationale: message }), s.context(message) as never, s.caps) as Rec;
    expect(offer, JSON.stringify(offer).slice(0, 600)).toMatchObject({ ok: false, refusal: 'revised_draft_has_no_target' });
    expect(s.writes).toHaveLength(0);
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
    // S2 C4 (TL 09:50Z, cost 3 ACKed): the drafter's 250000 is a figure the user wrote for something else, so it is never bound as
    // the target. The redraft holds none, and the card flags the change BEFORE any approval (#3264), never a silent swap or a write.
    const offer = await s.revise(message) as Rec;
    expect(offer, JSON.stringify(offer)).toMatchObject({ ok: true, mutated: false });
    const prepared = s.candidateOf(offer).candidate;
    expect(readGoalRecord(prepared, prepared.nodes.find((n: Rec) => n.kind === 'goal').id)?.target?.raw, 'the unrelated/withdrawn numeral is never the target').toBeUndefined();
    expect(String(offer.public_label)).toMatch(/^Check this change first: the goal\u2019s target would change from \u2018Funding secured\u2019 1\.3 million/);
    expect(String(offer.public_label)).not.toContain('250,000');
    expect(s.writes).toHaveLength(0);
  });
});


describe('turn-2 founder construction reaches the native CAS register', () => {
  const capture = JSON.parse(readFileSync(new URL('../../orchestrator-v5/agent-lane/__tests__/fixtures/funding-16d51e1b-turn2-brief.json', import.meta.url), 'utf8')) as Rec;
  it.each([true, false])('captured graph/brief/messages, construction record=%s: one flagged card → own approval → one native write → whole readback', async constructionRecorded => {
    // Actual 16d51e1b capture; earlier recorded drafter outputs and a complete ledger are explicit offline doubles.
    // Mutation rows were not captured: neither branch claims to reproduce their served presence.
    const s = await harness(capture.graph, undefined, { ...capture, constructionRecorded } as never);
    const offer = await s.revise(capture.correction.message);
    expect(offer, JSON.stringify(offer)).toMatchObject({ ok: true, mutated: false });
    expect(offer.public_label).toContain('saved brief does not match your first message');
    if (!constructionRecorded) expect(offer.public_label).toContain('does not confirm the original construction');
    expect(s.writes).toHaveLength(0);
    const approved = s.candidateOf(offer).candidate;
    expect(await s.approve(offer)).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(s.writes).toHaveLength(1);
    // The native route adds stable display refs; every approved component/field otherwise stays exactly equal.
    const held = s.graph();
    expect(held.nodes.every((n: Rec) => typeof n.ref === 'string')).toBe(true);
    const withoutRefs = { ...held, nodes: held.nodes.map(({ ref: _ref, ...n }: Rec) => n) };
    expect(normaliseGraphForIdentity(withoutRefs as never)?.graph).toEqual(normaliseGraphForIdentity(approved as never)?.graph);
  });
});
