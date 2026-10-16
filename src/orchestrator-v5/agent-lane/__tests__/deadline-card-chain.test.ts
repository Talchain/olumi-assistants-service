import { runPressToolResponse } from './fixtures/run-press-model.js';
/** Retained d2/d1 replay: local dispatch and real approval writer; providers forbidden. */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type {} from '../../../plugins/scenario-ownership.js';
import type {} from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';
const live = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../session/index.js', async original => ({ ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => live.store }));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden in deadline replay'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in deadline replay'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import d2 from '../../../../tests/fixtures/deadline-card-d2.json';
import d1 from '../../../../tests/fixtures/ceiling-stock-t3.json';
import hiring from '../../../../tests/fixtures/deadline-card-hiring-post3000.json';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, type ToolResult } from '../runtime/agent-tools.js';
import { constructionOperationId } from '../runtime/build-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { ProposalStore, createProposal } from '../proposal.js';
import { proposalPendingAction } from '../durable-proposal.js';
import { proposalRecord } from '../proposal-object/record.js';
import { approvalChipsFor, approvalChipIdFor, DEADLINE_CHANGE_CHIP } from '../approval-chips.js';
import { commitOptionLevelsInProcess } from '../../system-events/dispatch.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { timeClassOf } from '../../goal-target/time-class.js';
import { buildTurnAlreadyOfferedDeadline, deadlineCardToIssue, deadlineOfferOpen, DEADLINE_OFFER_ANSWERS_MAX, firstAgentTurnAfterDraft, type DeadlineIssueInput } from '../deadline-card.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

type Rec = Record<string, any>;
const R = '2026-10-10', STAMP = `${R}T00:35:48.393294Z`;
const hash = (g: Rec) => computeAnalysisAffectingGraphHash(g as never)!;
const goal = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'goal');
function world(fixture: { graph: Rec; brief: string } = d2) {
  const sid = randomUUID(); let bytes = JSON.stringify(fixture.graph), brief = fixture.brief;
  let draftStamp: string | null = STAMP, scenarioStamp: string | null = '2026-09-01T10:00:00Z', broken = false, snapshotBroken = false;
  let committedMode: 'ok' | 'throw' | 'missing' | 'malformed' = 'ok', committedTurn = '';
  const read = (): Rec => JSON.parse(bytes);
  const rows: SessionTurnWithContent[] = [makeSessionTurnRow({ id: randomUUID(), scenario_id: sid, turn_id: registrationTurnId(sid, constructionOperationId(sid, brief)),
    request_hash: 'graph_registration:draft', turn_class: 'direct_answer', handler_id: null, response_emitted: false, created_at: STAMP })];
  const writes: Rec[] = []; const latest = () => rows.find(r => !r.turn_id.endsWith(':claim'));
  const store = createMockSessionStore({
    loadGraph: async () => read(), loadGraphAndBriefText: async () => ({ graph: read(), briefText: brief }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readCommittedTurn: async (_sid, id) => { const target = id === committedTurn; if (target && committedMode === 'throw') throw new Error('committed read failed'); const r = target && committedMode === 'missing' ? undefined : rows.find(r => r.turn_id === id); return r ? { id: r.id, request_hash: r.request_hash,
      user_message: r.user_message ?? null, assistant_message: r.assistant_message ?? null, llm_calls_used: r.llm_calls_used,
      pending_actions: target && committedMode === 'malformed' ? [null, 'junk'] : (r as Rec).pending_actions ?? [] } : null; },
    readMostRecentPendingActions: async (_sid, opts) => { if (broken) throw new Error('unreadable carrier'); if (snapshotBroken && opts?.onLatestRowId) { snapshotBroken = false; throw new Error('snapshot read failed'); } opts?.onLatestRowId?.(latest()?.id ?? null); return (latest() as Rec)?.pending_actions ?? []; },
    readRecent: async () => rows.filter(r => !r.turn_id.endsWith(':claim')),
    readFactsWithTurnFor: async ids => rows.flatMap(r => ids.includes(r.id) ? (writes.find(w => w.turn_id === r.turn_id)?.handler_facts ?? [])
      .map((fact: Rec) => ({ turn_id: r.id, fact_created_at: r.created_at, fact })) : []),
    append: async write => {
      writes.push(write); if (write.graph !== undefined) bytes = JSON.stringify(write.graph);
      const id = randomUUID(); rows.unshift({ ...makeSessionTurnRow({ id, scenario_id: sid, turn_id: write.turn_id, request_hash: write.request_hash,
        turn_class: write.turn_class, handler_id: write.handler_id, response_emitted: write.response_emitted, created_at: new Date().toISOString(),
        user_message: write.userMessage ?? null, assistant_message: write.assistantMessage ?? null }), pending_actions: write.pending_actions ?? [] } as SessionTurnWithContent);
      return { id };
    },
  });
  live.store = store;
  const graphWire = () => ({ graph: read(), graph_hash: hash(read()), brief_text: brief, scenario_created_at: scenarioStamp });
  const versions = () => ({ versions: draftStamp === null ? [] : [{ version_id: 'draft-r7', sequence: 1, created_at: draftStamp,
    creation: { kind: 'initial', source_turn_id: registrationTurnId(sid, constructionOperationId(sid, brief)) } }] });
  const dispatch: InternalDispatch = async path => {
    if (path.endsWith('/graph')) return { status: 200, json: graphWire() };
    if (path.endsWith('/versions')) return { status: 200, json: versions() };
    throw new Error(`Unexpected local dispatch ${path}`);
  };
  const proposals = new ProposalStore();
  const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, {
    commitOptionLevels: input => commitOptionLevelsInProcess(input, 'deadline-replay'), now: () => new Date('2026-11-20T12:00:00Z'),
  });
  const ctx = (text: string) => ({ scenario_id: sid, authenticated_user_id: null, request_id: 'deadline-replay', user_text: text, user_turn_text: text });
  return { sid, store, rows, writes, read, caps, ctx, proposals, graphWire, versions,
    replace: (g: Rec) => { bytes = JSON.stringify(g); }, setBrief: (text: string) => { brief = text; },
    reference: (draft: string | null, scenario: string | null) => { draftStamp = draft; scenarioStamp = scenario; }, failRead: () => { broken = true; }, failSnapshot: () => { snapshotBroken = true; }, failCommitted: (mode: 'throw' | 'missing' | 'malformed', turnId: string) => { committedMode = mode; committedTurn = turnId; } };
}
const apps: FastifyInstance[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
/** What this harness's AI answers on a turn that calls no tool. */
const AGENT_ANSWER = 'The model is available to review.';
async function route(w: ReturnType<typeof world>) {
  vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => runPressToolResponse(JSON.parse(String(init?.body ?? '{}')))
    ?? new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: AGENT_ANSWER }] }] }), { status: 200 })));
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false }); apps.push(app);
  app.post('/assist/v1/scenarios/:id/graph', async () => w.graphWire());
  app.post('/assist/v1/scenarios/:id/versions', async () => w.versions());
  app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'Local Run result', suggested_actions: [], insights: [], graph_hash: hash(w.read()),
    // A local upstream Run response only; the stored model still owns the offered reading. No engine/provider call.
    ...(goal(w.read()).goal_horizon ? { blocks: [{ type: 'analysis_result', computed_against_hash: hash(w.read()), leading_option_id: null,
      enrichment: { option_comparison: [], inference_warnings: [] } }] } : {}) }));
  await app.register(agentV1TurnRoute); await app.ready();
  return async (over: Rec = {}, expectedStatus = 200) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { turn_id: randomUUID(), scenario_id: w.sid,
      message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' }, ...over } });
    expect(r.statusCode, r.body).toBe(expectedStatus); return r.json() as Rec;
  };
}
/** d2's and d1's brief: the sentence the stored words come from. */
const D2_SENTENCE = 'Our depot can service at most 1,900 riders without breaking its maintenance targets, and the council wants us to stay under '
  + 'that ceiling, without turning anyone away, over the next ten months.';
/**
 * AMENDED (ruling A, DL 14 Oct; was "…? Your words: “ten months”."): the route card quotes the sentence its words were read from,
 * and is always Olumi's interpretation to check: that these are the goal's deadline is the drafter's reading, never the user's.
 */
const ROUTE_CARD_D2 = `Is your deadline 10 August 2027 (10 months from 10 October 2026)? Your words: “ten months” in “${D2_SENTENCE.slice(0, -1)}”. `
  + 'Olumi’s interpretation; check the date and reference before approving.';
function card(body: Rec) {
  const calls = body._agent.tool_calls.filter((c: Rec) => c.name === 'propose_goal_deadline');
  expect(calls).toHaveLength(1); expect(calls[0].ok).toBe(true);
  const yes = body.suggested_actions.find((c: Rec) => c.id === approvalChipIdFor(calls[0].proposal_id));
  expect(yes).toMatchObject({ label: 'Yes', detail: ROUTE_CARD_D2 });
  expect(body.suggested_actions).toContainEqual(DEADLINE_CHANGE_CHIP);
  return { call: calls[0], yes };
}
describe('deterministic deadline card on the first Agent turn', () => {
  it('A2 keeps full source, qualifiers and interpretation on the approval card: the user\'s sentence verbatim, the rationale in provenance', async () => {
    const w = world();
    const source = 'We hope to launch within ten months, provided the evidence supports it; this is not a firm commitment and hiring completion is a separate milestone.';
    const rationale = `${source} The source is the current human message; Olumi interprets ten months from the known draft reference.`;
    const out = await w.caps.proposeGoalDeadline!(w.ctx(source), { deadline_words: 'ten months', rationale }) as Rec;
    expect(out).toMatchObject({ ok: true, mutated: false });
    // AMENDED (served hiring e2e 8f52bfd5, DL 14 Oct "one true thing"): the user's own sentence, verbatim, carries the source and
    // its conditions; the AI's account of it ("Olumi interprets …") is kept with the proposal, not shown beside the date.
    expect(out.public_label).toBe(`Is your deadline 10 August 2027 (10 months from 10 October 2026)? Your words: \u201cten months\u201d in \u201c${source.replace(/\.$/, '')}\u201d.`);
    expect(out.public_label).toContain('provided the evidence supports it; this is not a firm commitment');
    expect(w.proposals.get(String(out.proposal_id))!.provenance).toEqual({ authored_by: 'user_stated', basis: rationale });
    expect(out.deadline.words).toBe('ten months');
  });
  it('R1 Run-chip offers exactly one bound card using draft R; no graph change', async () => {
    const w = world(), before = w.read(), turn = await route(w), body = await turn(), { call, yes } = card(body);
    // AMENDED (hiring post3007 turn 02, DL 14 Oct; was `toBe(yes.detail)`): the card's question follows the AI's answer, never replaces it.
    expect(body.assistant_text).toBe(`${AGENT_ANSWER}\n\n${yes.detail}`); expect(w.read()).toEqual(before);
    const carrier = (w.rows[0] as Rec).pending_actions.find((p: Rec) => p.chip_id === yes.id);
    expect(carrier.action.inline_patch.agent_proposal).toMatchObject({ proposal_id: call.proposal_id,
      operations: [{ op: 'set_goal_deadline', path: goal(before).id, value: { deadline: '2027-08-10', words: 'ten months', reference: R, expected_deadline: null, stated_months: 10 } }] });
  });
  it('A2h words found only in the unverified stored brief stay unknown', async () => {
    const w = world();
    const out = await dispatchTool('propose_goal_deadline', JSON.stringify({ deadline_words: 'ten months', rationale: '' }), w.ctx('Run the analysis.'), w.caps, 'full');
    expect(out).toMatchObject({ ok: false, mutated: false, refusal: 'origin_unknown' });
    expect(out.proposal_id).toBeUndefined();
    expect(w.writes).toHaveLength(0);
  });
  it('W3 unbound deadline words prepare an Olumi-labelled card without writing', async () => {
    const w = world(); w.setBrief('Plan the launch.'); // These words occur nowhere in retained user material.
    const out = await dispatchTool('propose_goal_deadline', JSON.stringify({ deadline_words: 'ten months', rationale: '' }), w.ctx('Run the analysis.'), w.caps, 'full');
    expect(out).toMatchObject({ ok: true, mutated: false });
    expect(w.proposals.get(String(out.proposal_id))?.provenance.authored_by).toBe('model_proposed');
    expect(out.public_label).toBe('Is your deadline 10 August 2027 (10 months from 10 October 2026)? Olumi’s wording: “ten months”. Olumi’s interpretation; check the date and reference before approving.');
  });
  it('A2h a verified pending deadline retains human words when history is unknown', async () => {
    const w = world();
    const first = await w.caps.proposeGoalDeadline!(w.ctx('My deadline is ten months'), { deadline_words: 'ten months', rationale: '' });
    expect(first.ok).toBe(true);
    const second = await w.caps.proposeGoalDeadline!({ ...w.ctx('Show that card again.'), unverified_user_text: 'My deadline is ten months' },
      { deadline_words: 'ten months', rationale: '' });
    expect(second.ok).toBe(true);
    expect(w.proposals.get(String(second.proposal_id))?.provenance.authored_by).toBe('user_stated');
    expect(second.public_label).toBe('Is your deadline 10 August 2027 (10 months from 10 October 2026)? Your words: “ten months”.');
  });
  it('W2 ISO interpretation reaches the real approval writer; malformed dates write nothing', async () => {
    const w = world();
    const out = await dispatchTool('propose_goal_deadline', JSON.stringify({ deadline_words: 'after the spring launch', deadline_date: '2027-04-30', rationale: '' }), w.ctx('after the spring launch'), w.caps, 'full');
    expect(out).toMatchObject({ ok: true, mutated: false });
    expect(w.proposals.get(String(out.proposal_id))?.provenance.authored_by).toBe('model_proposed');
    expect(out.public_label).toBe('Is your deadline 30 April 2027 (about 6.7 months from 10 October 2026)? Your words: “after the spring launch”. Olumi’s interpretation; check the date and reference before approving.');
    const done = await w.caps.authoriseChange({ ...w.ctx('Yes'), typed_approval_of: String(out.proposal_id) }, { proposal_id: String(out.proposal_id) });
    expect(done).toMatchObject({ ok: true, applied: true });
    expect(goal(w.read()).goal_horizon.deadline).toBe('2027-04-30');
    // DLf5 (DL-approved flip, PL AMEND 22:37Z): was `unreadable_deadline`. "ten months" resolves, so the user's phrase owns
    // the date and a malformed OPTIONAL model date beside it is ignored: the source-first tuple, the user's, nothing written.
    for (const deadline_date of ['2027-02-30', 'tomorrow', 123, null]) {
      const kept = await dispatchTool('propose_goal_deadline', JSON.stringify({ deadline_words: 'ten months', deadline_date, rationale: '' }), w.ctx('ten months'), w.caps, 'full');
      expect(kept, String(deadline_date)).toMatchObject({ ok: true, mutated: false });
      const proposal = w.proposals.get(String(kept.proposal_id))!;
      expect(proposal.provenance.authored_by).toBe('user_stated');
      expect(proposal.operations[0]).toMatchObject({ op: 'set_goal_deadline', value: { deadline: '2027-08-10', reference: R } });
    }
    expect(goal(w.read()).goal_horizon.deadline, 'nothing written without approval').toBe('2027-04-30');
    // Words that do not resolve still refuse a malformed fallback date.
    for (const deadline_date of ['2027-02-30', 'tomorrow', '2026-01-01']) {
      expect(await dispatchTool('propose_goal_deadline', JSON.stringify({ deadline_words: 'after the spring launch', deadline_date, rationale: '' }), w.ctx('after the spring launch'), w.caps, 'full'))
        .toMatchObject({ ok: false, mutated: false, refusal: 'unreadable_deadline' });
    }
  });
  it('manual door keeps its proposal/goal/date/chip identity and expected null deadline', async () => {
    const w = world(), before = w.read();
    const out = await w.caps.proposeGoalDeadline!(w.ctx('My deadline is ten months'), { deadline_words: 'ten months', rationale: '' }) as Rec;
    expect(out.ok).toBe(true); const p = w.proposals.get(out.proposal_id)!;
    expect(p.operations[0]).toMatchObject({ op: 'set_goal_deadline', path: goal(before).id, value: { deadline: '2027-08-10', expected_deadline: null, reference: R } });
    expect(approvalChipsFor([{ name: 'propose_goal_deadline', ok: true, mutated: false, proposal_id: p.proposal_id }], () => ({ proposal: p, result: out as ToolResult })))
      .toEqual([expect.objectContaining({ id: approvalChipIdFor(p.proposal_id), label: 'Yes', detail: out.public_label }), DEADLINE_CHANGE_CHIP]);
    expect(w.read()).toEqual(before);
  });
});

const issueInput = (graph: Rec = structuredClone(d2.graph)): DeadlineIssueInput => ({ graph, storedBrief: d2.brief, typedNow: null, reference: R,
  toolCalls: [{ name: 'run_analysis' }], mutated: false, fastPath: 'run', proposalOffered: false, pending: [], priorOffer: false });
describe('R3 deterministic authorship and placement guards', () => {
  it('binds both retained goal shapes; typed-owned words also qualify', () => {
    for (const graph of [d2.graph, d1.graph]) expect(deadlineCardToIssue(issueInput(graph)))
      .toMatchObject({ goal_id: goal(graph).id, words: 'ten months', reference: R, date: '2027-08-10', quote: D2_SENTENCE });
    expect(deadlineCardToIssue({ ...issueInput(), storedBrief: '', typedNow: 'My deadline is ten months' })).toBeDefined();
  });
  it('invented words (the stored words occur nowhere in the brief) are silent', () => {
    expect(deadlineCardToIssue({ ...issueInput(), storedBrief: 'We want to keep registered riders under the ceiling.' })).toBeUndefined();
  });
  it.each([
    'Of course, we want to keep registered riders under the ceiling over the next ten months.',
    'We want to keep registered riders under the ceiling over the next ten months while training takes place.',
  ])('ordinary wording is not a duration: %s', storedBrief => {
    expect(deadlineCardToIssue({ ...issueInput(), storedBrief })).toEqual(expect.objectContaining({ words: 'ten months', date: '2027-08-10' }));
  });
  it('whole words: 6 months cannot come from 16 months', () => {
    const g = structuredClone(d2.graph); goal(g).goal_deadline_as_stated = '6 months';
    expect(deadlineCardToIssue({ ...issueInput(g), storedBrief: 'We want to keep registered riders under the ceiling over the next 16 months.' })).toBeUndefined();
  });
  it.each(['2027-08-10', '2027-09-10'])('held deadline %s is silent', deadline => {
    const g = structuredClone(d2.graph) as Rec; goal(g).goal_horizon = { deadline };
    expect(deadlineCardToIssue(issueInput(g))).toBeUndefined();
  });
  it.each(['before the audit', 'fiscal quarter', '2020-01-01'])('unplaceable phrase %s is silent', words => {
    const g = structuredClone(d2.graph); goal(g).goal_deadline_as_stated = words;
    expect(deadlineCardToIssue({ ...issueInput(g), storedBrief: `We want to keep registered riders under the ceiling by ${words}.` })).toBeUndefined();
  });
  it('two goals or missing stated words is silent', () => {
    const g = structuredClone(d2.graph) as Rec; g.nodes.push({ ...goal(g), id: 'other-goal' });
    expect(deadlineCardToIssue(issueInput(g))).toBeUndefined(); g.nodes.pop(); delete goal(g).goal_deadline_as_stated;
    expect(deadlineCardToIssue(issueInput(g))).toBeUndefined();
  });
  it.each([{ mutated: true }, { fastPath: 'approve' }, { proposalOffered: true }, { priorOffer: true }, { reference: undefined },
    { toolCalls: [{ name: 'propose_goal_deadline' }] }, { pending: [{} as never] }])('no competing/uncertain authority: %j', over => {
    expect(deadlineCardToIssue({ ...issueInput(), ...over })).toBeUndefined();
  });
  it('preview refuses internal issuance; existing dispatch permission remains read-only', async () => {
    const w = world(), caps = createAgentCapabilities(async () => ({ status: 200, json: w.graphWire() }), new ProposalStore(), undefined, 'preview');
    expect(await caps.deadlineCardFromDraft(w.ctx('Run'), { ...issueInput(), start: { rowId: w.rows[0]!.id, rows: w.rows } })).toBeUndefined();
    expect(await dispatchTool('propose_goal_deadline', JSON.stringify({ deadline_words: 'ten months', rationale: '' }), w.ctx('My deadline is ten months'), caps, 'preview')).toMatchObject({ ok: false, mutated: false });
  });
});
describe('R2 Run → deadline Yes → existing reading, with exact unrelated-byte scope', () => {
  it.each([['d2', d2], ['d1', d1]] as const)('CONTRAST (S4 time class) %s: the ORIGINAL recorded brief, with "starting in month 3", still gets the deadline card but is refused the reading card, honestly', async (_name, fixture) => {
    expect(fixture.brief).toContain('starting in month 3');
    const w = world(fixture), turn = await route(w), first = await turn(), { yes } = card(first);
    await turn({ message: yes.message, source: 'chip_click', chip: { id: yes.id }, agent_session_id: first._agent.session_id });
    expect(goal(w.read())).toMatchObject({ goal_horizon: { deadline: '2027-08-10' } });
    expect(await w.caps.proposeIdentity!(w.ctx('Confirm the reading'))).toMatchObject({ ok: false, mutated: false, refusal: 'no_reading_to_confirm' });
    expect(timeClassOf(fixture.brief).shapes).toEqual([{ kind: 'scheduled_start', words: 'starting in month 3' }]);
  });
  it.each([['d2 structural', d2], ['d1 ceiling', d1]] as const)('%s', async (shape, fixture) => {
    // S4 time class (#2952): both recorded briefs state a month-3 start the product cannot yet work out, so the FULL brief is refused a
    // reading card (time-class.test.ts pins that). This chain tests the existing reading path on the same brief without that clause.
    const w = world({ ...fixture, brief: fixture.brief.replace(', starting in month 3,', ',') }), before = w.read(), turn = await route(w), first = await turn(), { yes } = card(first);
    expect(w.read()).toEqual(before);
    const answer = await turn({ message: yes.message, source: 'chip_click', chip: { id: yes.id }, agent_session_id: first._agent.session_id });
    expect(answer._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    const after = w.read(); expect(goal(after)).toMatchObject({ goal_horizon: { deadline: '2027-08-10' }, goal_horizon_months: 10 });
    for (const n of before.nodes.filter((n: Rec) => n.kind !== 'goal')) expect(JSON.stringify(after.nodes.find((a: Rec) => a.id === n.id))).toBe(JSON.stringify(n));
    const nonStructural = (n: Rec) => {
      const other = { ...n };
      for (const key of ['goal_horizon', 'goal_horizon_months', 'goal_horizon_reference_date', 'goal_horizon_stated_months',
        'nonlinear_identity', 'observed_state']) delete other[key];
      return other;
    };
    expect(nonStructural(goal(after))).toEqual(nonStructural(goal(before)));
    expect(goal(after).observed_state).toEqual(goal(before).observed_state);
    expect(after.goal_constraints).toEqual(before.goal_constraints);
    const newNodes = after.nodes.filter((n: Rec) => !before.nodes.some((a: Rec) => a.id === n.id));
    if (shape === 'd2 structural') {
      expect(newNodes.map((n: Rec) => n.id).sort()).toEqual(['registered_riders_at_month_10', 'registered_riders_at_month_10_net_zero_rate']);
      for (const e of before.edges.filter((e: Rec) => e.to !== goal(before).id || !['registered_riders_today', 'net_rider_gain_per_month'].includes(e.from)))
        expect(JSON.stringify(after.edges.find((a: Rec) => a.from === e.from && a.to === e.to))).toBe(JSON.stringify(e));
      expect(after.edges.filter((e: Rec) => e.to === 'registered_riders_at_month_10').map((e: Rec) => e.from).sort())
        .toEqual(['net_rider_gain_per_month', 'registered_riders_at_month_10_net_zero_rate', 'registered_riders_today']);
      expect(after.edges).toContainEqual(expect.objectContaining({ from: 'registered_riders_at_month_10', to: goal(before).id }));
      expect(after.edges.length).toBe(before.edges.length + 2);
    } else { expect(newNodes).toEqual([]); expect(JSON.stringify(after.edges)).toBe(JSON.stringify(before.edges)); }
    // The user sees the existing identity path after Yes. This is a fresh capability/ProposalStore, not a fixture-only recogniser.
    const offered = await w.caps.proposeIdentity!(w.ctx('Confirm the reading')) as Rec;
    expect(offered.ok, JSON.stringify(offered)).toBe(true);
    const p = w.proposals.get(offered.proposal_id)!;
    const chips = approvalChipsFor([{ name: 'propose_identity', ok: true, mutated: false, proposal_id: p.proposal_id }], () => ({ proposal: p, result: offered as ToolResult }));
    expect(chips[0]!.id).toBe(approvalChipIdFor(p.proposal_id)); expect(chips[0]!.detail).toBe(offered.card.words);
    const value = p.operations[0]!.value as Rec;
    if (shape === 'd2 structural') { expect(value.ceiling_stock).toBeUndefined(); expect(offered.card.words).not.toContain('at or under'); }
    else { expect(value.ceiling_stock).toMatchObject({ goal_id: goal(after).id, comparator: '<=', horizon_months: 10, ceiling: { raw_value: 1900 } });
      expect(offered.card.words).toBe('Olumi reads ‘Rider capacity surplus at month 10’ as ‘Registered riders at month 10’ at or under 1,900 riders (1,900 riders included; you said ‘at most 1,900 riders’), checked at month 10 only, assuming 1,400 riders today and a net 30 riders a month continue. Is that how you work it out?'); }
    if (shape === 'd1 ceiling') {
      const carrier = proposalPendingAction(p, chips[0]!, { scenario_id: w.sid, emitted_at_iso: new Date().toISOString() });
      expect(proposalRecord(carrier, undefined)).toBeDefined();
      expect(proposalRecord(carrier, after)).toBeDefined();
    }
    const next = await turn({ agent_session_id: answer._agent.session_id });
    const identityCall = next._agent.tool_calls.find((c: Rec) => c.name === 'propose_identity');
    expect(identityCall, JSON.stringify(next)).toMatchObject({ ok: true, proposal_id: p.proposal_id });
    expect(next.suggested_actions, `wire card ${p.proposal_id} for ${goal(after).id}`).toContainEqual(expect.objectContaining({ id: approvalChipIdFor(p.proposal_id), detail: offered.card.words }));
    expect(JSON.stringify(w.read())).toBe(JSON.stringify(after)); // offering the next card writes nothing
    if (shape === 'd1 ceiling') {
      const carried = await turn({ agent_session_id: next._agent.session_id });
      const yesIdentity = carried.suggested_actions.find((c: Rec) => c.id === approvalChipIdFor(p.proposal_id));
      expect(yesIdentity).toMatchObject({ detail: offered.card.words });
      const applied = await turn({ message: yesIdentity.message, source: 'chip_click', chip: { id: yesIdentity.id }, agent_session_id: carried._agent.session_id });
      expect(applied._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
      expect(goal(w.read())).toMatchObject({ goal_direction: '<=', goal_threshold_raw: 1900, nonlinear_identity: { stated_in_brief: true } });
      const settled = await turn({ agent_session_id: applied._agent.session_id });
      expect(settled.suggested_actions.some((c: Rec) => c.id === yesIdentity.id)).toBe(false);
    }
  });
});
describe('R4 durable first-Agent-turn gate', () => {
  it.each(['decline', 'Change date', 'ignore'])('%s then turn 2, fresh worker, and unrelated value revision are silent', async choice => {
    const w = world(), turn = await route(w), first = await turn(); card(first);
    const { call } = card(first);
    // Change-date replay starts from the persisted Agent answer, not a manufactured interpreter/provider response.
    if (choice === 'Change date') w.rows.unshift({ ...makeSessionTurnRow({ id: randomUUID(), scenario_id: w.sid, turn_id: randomUUID(),
      turn_class: 'direct_answer', handler_id: null, request_hash: 'agent_turn:change-date', user_message: DEADLINE_CHANGE_CHIP.message }), pending_actions: [] } as SessionTurnWithContent);
    const second = await turn(choice !== 'decline' ? {} : { message: 'No.',
      chip: { id: `agent-decline-proposal:${call.proposal_id}` }, agent_session_id: first._agent.session_id });
    if (choice === 'decline') expect(second._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'withdraw_proposal', ok: true }));
    expect(second._agent.tool_calls.filter((c: Rec) => c.name === 'propose_goal_deadline')).toEqual([]);
    const input = { ...issueInput(), start: { rowId: w.rows[0]!.id, rows: w.rows }, typedNow: null };
    const fresh = createAgentCapabilities(async path => ({ status: 200, json: path.endsWith('/versions') ? w.versions() : w.graphWire() }), new ProposalStore());
    expect(await fresh.deadlineCardFromDraft(w.ctx('Run'), input)).toBeUndefined();
    const g = w.read(); Object.assign(g.nodes.find((n: Rec) => n.id === 'extra_spending_per_month').observed_state, { raw_value: 25, value: .0025 });
    expect(hash(g)).not.toBe(hash(w.read())); w.replace(g);
    expect(await fresh.deadlineCardFromDraft(w.ctx('Run'), input)).toBeUndefined();
  });
  it('latest carrier read failure is silent on the real route', async () => {
    const w = world(); w.failRead(); const body = await (await route(w))({}, 503);
    expect(body.error).toBe('TURN_STATE_UNVERIFIABLE'); expect(w.writes).toHaveLength(0);
  });
  it('strict turn-start read failure recovers the route but offers no deadline', async () => {
    const w = world(); w.failSnapshot(); const body = await (await route(w))();
    expect(body._agent.tool_calls.filter((c: Rec) => c.name === 'propose_goal_deadline')).toEqual([]);
  });
  it('a later system event or earlier Agent conversation does not suppress the first offer; an Agent answer after the draft does', async () => {
    const w = world(); w.rows.unshift(makeSessionTurnRow({ id: randomUUID(), scenario_id: w.sid, turn_class: 'direct_answer', handler_id: null,
      request_hash: 'sha256:system-event', turn_id: 'system-event' }));
    const body = await (await route(w))(); const { call } = card(body);
    expect(call.proposal_id).toEqual(expect.any(String));
    // Unreadable identity, no draft row, and an Agent answer NEWER than the draft stay closed.
    expect(firstAgentTurnAfterDraft(undefined, w.sid, d2.brief)).toBe(false);
    expect(firstAgentTurnAfterDraft({ rowId: 'wrong-row', rows: w.rows }, w.sid, d2.brief)).toBe(false);
    const draft = w.rows.find(r => r.request_hash.startsWith('graph_registration:'))!;
    const prior = makeSessionTurnRow({ id: randomUUID(), scenario_id: w.sid, request_hash: 'agent_turn:prior', turn_id: 'prior' });
    expect(firstAgentTurnAfterDraft({ rowId: prior.id, rows: [prior, draft] }, w.sid, d2.brief)).toBe(false);
    expect(firstAgentTurnAfterDraft({ rowId: draft.id, rows: [draft, prior] }, w.sid, d2.brief)).toBe(true);
    expect(firstAgentTurnAfterDraft({ rowId: prior.id, rows: [prior] }, w.sid, d2.brief)).toBe(false);
  });
  it('an Agent answer carrying the same brief text never stands in for the construction row (declined card stays closed)', () => {
    const sid = randomUUID(), brief = d2.brief;
    const row = (request_hash: string, over: Rec = {}) => makeSessionTurnRow({ id: randomUUID(), scenario_id: sid, turn_id: randomUUID(), request_hash,
      turn_class: 'direct_answer', handler_id: null, response_emitted: true, user_message: null, ...over });
    const construction = row('graph_registration:draft', { turn_id: registrationTurnId(sid, constructionOperationId(sid, brief)), response_emitted: false });
    const offer = row('agent_turn:offer'), decline = row('agent_turn:decline'), retry = row('agent_turn:retry', { user_message: brief });
    const system = row('sha256:system-event');
    const rows = [system, retry, decline, offer, construction];
    expect(firstAgentTurnAfterDraft({ rowId: system.id, rows }, sid, brief)).toBe(false);
    expect(firstAgentTurnAfterDraft({ rowId: system.id, rows: [system, construction] }, sid, brief)).toBe(true);
  });
  it('a throwing shared tail returns the door\'s own refusal and never takes the turn down', async () => {
    const w = world(), input = { ...issueInput(), start: { rowId: w.rows[0]!.id, rows: w.rows } };
    const issuer = await w.caps.deadlineCardFromDraft(w.ctx('Run'), input); expect(issuer).toBeDefined();
    vi.spyOn(w.proposals, 'put').mockImplementation(() => { throw new Error('proposal store down'); });
    const out = await issuer!.issue(w.ctx('Run'), { deadline_words: issuer!.words, rationale: '' }) as Rec;
    expect(out).toMatchObject({ ok: false, mutated: false, refusal: 'deadline_not_placed' });
  });
  it('without a turn-start snapshot nothing is read and nothing is offered', async () => {
    const w = world(); let reads = 0;
    const counting = createAgentCapabilities(async path => { reads += 1; return { status: 200, json: path.endsWith('/versions') ? w.versions() : w.graphWire() }; }, new ProposalStore());
    expect(await counting.deadlineCardFromDraft(w.ctx('Run'), { ...issueInput(), start: undefined })).toBeUndefined();
    expect(reads).toBe(0);
  });
  it('a pre-draft Agent conversation still gets the first post-draft offer, and the second turn never repeats it', async () => {
    const w = world(); w.rows.push(makeSessionTurnRow({ id: randomUUID(), scenario_id: w.sid, turn_class: 'direct_answer', handler_id: null,
      request_hash: 'agent_turn:before-the-draft', turn_id: 'before-the-draft' }));
    const turn = await route(w), first = await turn(); card(first);
    const second = await turn({ agent_session_id: first._agent.session_id });
    expect(second._agent.tool_calls.filter((c: Rec) => c.name === 'propose_goal_deadline')).toEqual([]);
  });
  it('with no version AND no usable scenario stamp the automatic card is silent: the clock is never a fallback', async () => {
    const w = world(); w.reference(null, null);
    const input = { ...issueInput(), start: { rowId: w.rows[0]!.id, rows: w.rows } };
    expect(await w.caps.deadlineCardFromDraft(w.ctx('Run'), input)).toBeUndefined();
    w.reference(null, 'not-a-date'); expect(await w.caps.deadlineCardFromDraft(w.ctx('Run'), input)).toBeUndefined();
    // The model-facing door keeps its own (unchanged) date-only card: a typed deadline still gets a card there.
    expect(await w.caps.proposeGoalDeadline!(w.ctx('My deadline is ten months'), { deadline_words: 'ten months', rationale: '' })).toMatchObject({ ok: true });
  });
  /**
   * Served 10 Oct, staging 1bf67f90, guest 5d5122d1: a GUEST has no version history (`findConstructionVersion` is empty by design),
   * and the automatic offer alone refused the scenario's server stamp (#2941), so it had no reference and stayed silent on every guest
   * draft. DL github-6d: ONE resolver (`draftReferenceDate`) for the door and the automatic offer.
   */
  describe('R9 a guest draft has no version history: ONE reference resolver for the card and the offer', () => {
    it('the automatic offer uses the scenario\'s server stamp, and the route offers the same bound card', async () => {
      const w = world(); w.reference(null, '2026-10-10T08:00:00Z');
      const issued = await w.caps.deadlineCardFromDraft(w.ctx('Run'), { ...issueInput(), start: { rowId: w.rows[0]!.id, rows: w.rows } });
      expect(issued?.words).toBe('ten months');
      const guest = world(); guest.reference(null, '2026-10-10T08:00:00Z');
      card(await (await route(guest))());
    });
    it('CONTRAST: the door and the automatic offer give the SAME reference (the same label) on the same guest draft, and a version wins for both', async () => {
      for (const [version, scenario] of [[null, '2026-10-09T10:00:00Z'], ['2026-10-10T10:00:00Z', '2026-10-09T10:00:00Z']] as const) {
        const w = world(); w.reference(version, scenario);
        const offer = await w.caps.deadlineCardFromDraft(w.ctx('Run'), { ...issueInput(), start: { rowId: w.rows[0]!.id, rows: w.rows } });
        const viaOffer = await offer!.issue(w.ctx('Run'), { deadline_words: offer!.words, rationale: '' }) as Rec;
        const viaDoor = await world(), door = (viaDoor.reference(version, scenario), await viaDoor.caps.proposeGoalDeadline!(viaDoor.ctx('My deadline is ten months'), { deadline_words: 'ten months', rationale: '' })) as Rec;
        // AMENDED (ruling A; was the whole label): the route card now quotes its sentence and follows #2997's authorship rule, so
        // the SAME reference is pinned on the question both cards ask.
        expect(viaOffer.public_label.split('?')[0], String(version)).toBe(door.public_label.split('?')[0]);
        expect(viaOffer.public_label).toContain(version === null ? '9 October 2026' : '10 October 2026');
      }
    });
  });
  it('Yes on the route-issued card writes byte-for-byte what Yes on the model-facing door\'s card writes', async () => {
    const viaRoute = world(), turn = await route(viaRoute), first = await turn(), { yes } = card(first);
    await turn({ message: yes.message, source: 'chip_click', chip: { id: yes.id }, agent_session_id: first._agent.session_id });
    const viaDoor = world();
    const out = await viaDoor.caps.proposeGoalDeadline!(viaDoor.ctx('My deadline is ten months'), { deadline_words: 'ten months', rationale: '' }) as Rec;
    expect(out.ok).toBe(true);
    const p = viaDoor.proposals.get(out.proposal_id)!;
    const chip = approvalChipsFor([{ name: 'propose_goal_deadline', ok: true, mutated: false, proposal_id: p.proposal_id }], () => ({ proposal: p, result: out as ToolResult }))[0]!;
    const applied = await viaDoor.caps.authoriseChange({ ...viaDoor.ctx(chip.message), typed_approval_of: p.proposal_id, typed_approval_words: chip.message }, { proposal_id: p.proposal_id }) as Rec;
    expect(applied.applied, JSON.stringify(applied)).toBe(true);
    expect(JSON.stringify(viaRoute.read())).toBe(JSON.stringify(viaDoor.read()));
    expect(goal(viaRoute.read())).toMatchObject({ goal_horizon: { deadline: '2027-08-10' } });
  });
  it('Change date follow-up can still propose THIS newly typed deadline through the model door', async () => {
    const w = world(); const out = await w.caps.proposeGoalDeadline!(w.ctx('My deadline is eleven months'), { deadline_words: 'eleven months', rationale: '' });
    expect(out).toMatchObject({ ok: true, public_label: 'Is your deadline 10 September 2027 (11 months from 10 October 2026)? Your words: “eleven months” in “My deadline is eleven months”.' });
  });
});

/**
 * R6 — served 08bbe2eb (scenario b2ad8385, UI a75a01fd, CEE 08bbe2e): the create turn is ITSELF an Agent turn (the model
 * calls `build_model_from_brief`), so its answer row is always newer than the registration row. R4's "no Agent answer
 * after the draft" made the route-issued card unreachable on every real draft; only synthetic rows (a registration row
 * and nothing after it) reached it. The ONE answer to the turn that built the draft — the Agent row whose user message
 * IS the stored brief — is not an offer; any second Agent answer still closes it.
 */
/**
 * ⭐ R10 A HELD CARD NEVER LOSES THE DEADLINE OFFER FOR GOOD (DL-3 ruling 16 Oct; hiring s2 aa63b55c on ca0714a8: turn 01 offered the
 * starting-figures card, still held at turn 02, so the deadline card was not issued (`pending.length > 0`), and the one-answer window
 * then closed it permanently). Once the other card is pressed, declined or lapses, the next turn offers the deadline card: still one
 * card at a time, and a deadline card offered once is never offered again.
 */
describe('R10 a held card never loses the deadline offer for good (DL-3 16 Oct)', () => {
  const buildAnswer = (w: ReturnType<typeof world>, over: Rec = {}) => makeSessionTurnRow({ id: randomUUID(), scenario_id: w.sid, turn_id: randomUUID(),
    request_hash: 'agent_turn:build', turn_class: 'direct_answer', handler_id: null, response_emitted: true, user_message: d2.brief, assistant_message: 'Here is the model.', ...over });
  const answer = (w: ReturnType<typeof world>, request_hash: string, pending: Rec[], over: Rec = {}) => ({ ...makeSessionTurnRow({ id: randomUUID(), scenario_id: w.sid,
    turn_id: randomUUID(), request_hash, turn_class: 'direct_answer', handler_id: null, response_emitted: true, user_message: 'Yes, use those.', assistant_message: 'Done.', ...over }),
    pending_actions: pending } as SessionTurnWithContent);
  /**
   * Real held cards for THIS world: the deadline card the door makes, and another card built from it with a different change (the
   * "starting figures" card): a valid content id and this scenario, so the route reads it as a live hold.
   */
  const heldCards = async (w: ReturnType<typeof world>): Promise<{ deadline: Rec[]; other: Rec[] }> => {
    const offered = await w.caps.proposeGoalDeadline!(w.ctx('My deadline is ten months'), { deadline_words: 'ten months', rationale: '' }) as Rec;
    expect(offered.ok, JSON.stringify(offered)).toBe(true);
    const base = w.proposals.get(offered.proposal_id)!;
    const carrier = (p: Rec) => [proposalPendingAction(p as never, { id: approvalChipIdFor(p.proposal_id), label: 'Yes', message: 'Yes, use those.' } as never,
      { scenario_id: w.sid, emitted_at_iso: new Date().toISOString() }) as unknown as Rec];
    const { proposal_id: _id, ...content } = base as Rec;
    const other = createProposal({ ...content, operations: [{ op: 'set_factor_value', path: '/nodes/registered_riders_today/observed_state', value: { value: 1400 } }],
      public_label: 'Use these starting figures' } as never);
    return { deadline: carrier(base as Rec), other: carrier(other as Rec) };
  };
  const proposed = (b: Rec) => b._agent.tool_calls.filter((c: Rec) => c.name === 'propose_goal_deadline');
  it('⭐ RED→GREEN (s2 shape): turn 01 holds another card, turn 02 presses it, turn 03 is offered the deadline card, once', async () => {
    const w = world(), { other } = await heldCards(w); w.rows.unshift(answer(w, 'agent_turn:press', []), buildAnswer(w, { pending_actions: other }));
    expect(w.rows.map((r) => r.request_hash), 'newest first').toEqual(['agent_turn:press', 'agent_turn:build', 'graph_registration:draft']);
    const turn = await route(w), third = await turn();
    card(third);
    const fourth = await turn({ agent_session_id: third._agent.session_id });
    expect(proposed(fourth), 'offered once, never repeated').toEqual([]);
  });
  it('NEGATIVE (one card at a time): while the other card is still held, no deadline card is offered beside it', async () => {
    const w = world(), { other } = await heldCards(w);
    w.rows.unshift(answer(w, 'agent_turn:chat', other, { user_message: 'Why that?' }), buildAnswer(w, { pending_actions: other }));
    expect(proposed(await (await route(w))())).toEqual([]);
  });
  it('NEGATIVE: a deadline card already offered on a later turn (then declined) is not offered again', async () => {
    // Newest first: the decline, the turn that offered the deadline card, the build turn that held the other card.
    const w = world(), { other, deadline } = await heldCards(w); w.rows.unshift({ ...makeSessionTurnRow({ id: randomUUID(), scenario_id: w.sid, turn_id: randomUUID(), request_hash: 'system_event:decline',
        turn_class: 'direct_answer', handler_id: null, response_emitted: true, user_message: null, assistant_message: null }), pending_actions: [] } as SessionTurnWithContent,
      answer(w, 'agent_turn:press', deadline), buildAnswer(w, { pending_actions: other }));
    expect(proposed(await (await route(w))())).toEqual([]);
  });
  it('the window itself: open only across answers given while a card was held; an unreadable row, a deadline offer or too many answers close it', async () => {
    const { other, deadline } = await heldCards(world());
    const { sid, brief } = { sid: randomUUID(), brief: d2.brief };
    const row = (request_hash: string, over: Rec = {}) => makeSessionTurnRow({ id: randomUUID(), scenario_id: sid, turn_id: randomUUID(), request_hash,
      turn_class: 'direct_answer', handler_id: null, response_emitted: true, user_message: null, ...over });
    const construction = row('graph_registration:draft', { turn_id: registrationTurnId(sid, constructionOperationId(sid, brief)), response_emitted: false });
    const built = row('agent_turn:build', { user_message: brief }), a1 = row('agent_turn:a1'), a2 = row('agent_turn:a2');
    const startWith = (pending: Record<string, readonly unknown[] | null | 'throw'>, rows = [a2, a1, built, construction]) => ({ rowId: rows[0]!.id, rows,
      committedPending: async (id: string) => { const p = pending[id]; if (p === 'throw') throw new Error('unreadable'); return p ?? []; } });
    expect(await deadlineOfferOpen(startWith({ [built.turn_id]: other, [a1.turn_id]: other, [a2.turn_id]: [] }), sid, brief), 'held, held, resolved').toBe(true);
    expect(await deadlineOfferOpen(startWith({ [built.turn_id]: other, [a1.turn_id]: [], [a2.turn_id]: [] }), sid, brief), 'a1 had nothing held').toBe(false);
    expect(await deadlineOfferOpen(startWith({ [built.turn_id]: other, [a1.turn_id]: deadline, [a2.turn_id]: [] }), sid, brief), 'already offered').toBe(false);
    expect(await deadlineOfferOpen(startWith({ [built.turn_id]: other, [a1.turn_id]: 'throw', [a2.turn_id]: [] }), sid, brief), 'unreadable').toBe(false);
    expect(await deadlineOfferOpen(startWith({ [built.turn_id]: other, [a1.turn_id]: null, [a2.turn_id]: [] }), sid, brief), 'missing row').toBe(false);
    expect(await deadlineOfferOpen({ ...startWith({ [built.turn_id]: other }), committedPending: undefined } as never, sid, brief), 'no reader').toBe(false);
    const notBuilt = row('agent_turn:chat', { user_message: 'What do you think?' });
    expect(await deadlineOfferOpen(startWith({ [notBuilt.turn_id]: other, [a1.turn_id]: [] }, [a1, notBuilt, construction]), sid, brief), 'first answer is not the build answer').toBe(false);
    const many = Array.from({ length: DEADLINE_OFFER_ANSWERS_MAX }, (_, i) => row(`agent_turn:m${i}`));
    expect(await deadlineOfferOpen({ rowId: many[0]!.id, rows: [...many, built, construction], committedPending: async () => other }, sid, brief), 'too many answers').toBe(false);
  });
});

describe('R6 the draft was built inside an Agent turn', () => {
  const buildAnswer = (w: ReturnType<typeof world>, over: Rec = {}) => makeSessionTurnRow({ id: randomUUID(), scenario_id: w.sid, turn_id: randomUUID(),
    request_hash: 'agent_turn:build', turn_class: 'direct_answer', handler_id: null, response_emitted: true, user_message: d2.brief, assistant_message: 'Here is the model.', ...over });
  it('the first turn after the build turn offers exactly one bound card; the turn after that never repeats it', async () => {
    const w = world(), before = w.read(); w.rows.unshift(buildAnswer(w));
    const turn = await route(w), first = await turn(), { call, yes } = card(first);
    // AMENDED (hiring post3007 turn 02, DL 14 Oct; was `toBe(yes.detail)`): the card's question follows the AI's answer.
    expect(first.assistant_text).toBe(`${AGENT_ANSWER}\n\n${yes.detail}`); expect(w.read()).toEqual(before);
    expect(call.proposal_id).toEqual(expect.any(String));
    const second = await turn({ agent_session_id: first._agent.session_id });
    expect(second._agent.tool_calls.filter((c: Rec) => c.name === 'propose_goal_deadline')).toEqual([]);
  });
  it('an Agent answer that is not the build answer, or a second Agent answer, keeps the offer closed', async () => {
    const other = world(); other.rows.unshift(buildAnswer(other, { user_message: 'What do you think?' }));
    expect((await (await route(other))())._agent.tool_calls.filter((c: Rec) => c.name === 'propose_goal_deadline')).toEqual([]);
    const two = world(); two.rows.unshift(buildAnswer(two), buildAnswer(two, { request_hash: 'agent_turn:chat', user_message: 'Why?' }));
    expect((await (await route(two))())._agent.tool_calls.filter((c: Rec) => c.name === 'propose_goal_deadline')).toEqual([]);
  });
  it('a re-sent brief (a second answer carrying the same text) is a second answer, not the build answer', () => {
    const sid = randomUUID(), brief = d2.brief;
    const row = (request_hash: string, over: Rec = {}) => makeSessionTurnRow({ id: randomUUID(), scenario_id: sid, turn_id: randomUUID(), request_hash,
      turn_class: 'direct_answer', handler_id: null, response_emitted: true, user_message: null, ...over });
    const construction = row('graph_registration:draft', { turn_id: registrationTurnId(sid, constructionOperationId(sid, brief)), response_emitted: false });
    const built = row('agent_turn:build', { user_message: brief, assistant_message: 'Here is the model.' }), resent = row('agent_turn:resent', { user_message: brief, assistant_message: 'Here is the model.' });
    expect(firstAgentTurnAfterDraft({ rowId: built.id, rows: [built, construction] }, sid, brief)).toBe(true);
    expect(firstAgentTurnAfterDraft({ rowId: resent.id, rows: [resent, built, construction] }, sid, brief)).toBe(false);
    expect(firstAgentTurnAfterDraft({ rowId: built.id, rows: [{ ...built, user_message: 'Which one?' }, construction] }, sid, brief)).toBe(false);
  });
  const rowsOf = () => {
    const sid = randomUUID(), brief = d2.brief;
    const row = (request_hash: string, over: Rec = {}) => makeSessionTurnRow({ id: randomUUID(), scenario_id: sid, turn_id: randomUUID(), request_hash,
      turn_class: 'direct_answer', handler_id: null, response_emitted: true, user_message: null, ...over });
    const construction = row('graph_registration:draft', { turn_id: registrationTurnId(sid, constructionOperationId(sid, brief)), response_emitted: false });
    return { sid, brief, row, construction };
  };
  it('whitespace around the typed message still matches the trimmed stored brief; nothing the answer SAYS decides whether it was the build answer', () => {
    const { sid, brief, row, construction } = rowsOf();
    const spaced = row('agent_turn:build', { user_message: ` ${brief}\n`, assistant_message: 'Here is the model.' });
    expect(firstAgentTurnAfterDraft({ rowId: spaced.id, rows: [spaced, construction] }, sid, brief)).toBe(true);
    // DL github-6d (#2948 r6-r9): no reply prose decides it. Null content, a question about the deadline, a stated date in any wording,
    // and a year in passing all leave the build answer a build answer; only the committed offer (below) can close the card.
    for (const said of [null, '', 'Here is the model.', 'Is your deadline 10 August 2027 (10 months from 10 October 2026)?', 'The deadline is August 10th, 2027. Does that work?',
      'Your deadline is:\n\n10 August 2027.\n\nDoes that work for you?', 'Would you like to use 10 August 2027 as your due date?', 'Launch by 31 December 2027.']) {
      const built = row('agent_turn:build', { user_message: brief, assistant_message: said });
      expect(firstAgentTurnAfterDraft({ rowId: built.id, rows: [built, construction] }, sid, brief), String(said)).toBe(true);
    }
  });
  describe('R8 the build turn already OFFERED a deadline: a committed proposal, never the prose (DL github-6d)', () => {
    const proposal = (over: Rec = {}) => ({ id: randomUUID(), scenario_id: 'x', chip_id: 'chip', action: { kind: 'apply_proposed_change', proposal_ref: 'chip',
      inline_patch: { agent_proposal: { operations: [{ op: 'set_goal_deadline', path: 'g', value: {} }] } } }, ...over });
    const startOf = (committedPending: ((id: string) => Promise<readonly unknown[] | null | undefined>) | undefined) => {
      const { sid, brief, row, construction } = rowsOf(), built = row('agent_turn:build', { user_message: brief, assistant_message: 'Here is the model.' });
      return { sid, brief, built, start: { rowId: built.id, rows: [built, construction], ...(committedPending ? { committedPending } : {}) } };
    };
    it('a committed set_goal_deadline proposal on the build row means it was offered; any other committed action does not', async () => {
      const offered = startOf(async () => [proposal()]);
      expect(await buildTurnAlreadyOfferedDeadline(offered.start, offered.sid, offered.brief)).toBe(true);
      for (const committed of [[], [proposal({ action: { kind: 'run_analysis' } })], [proposal({ action: { kind: 'apply_proposed_change', proposal_ref: 'c',
        inline_patch: { agent_proposal: { operations: [{ op: 'set_factor_value', path: 'f', value: 1 }] } } } })]]) {
        const other = startOf(async () => committed);
        expect(await buildTurnAlreadyOfferedDeadline(other.start, other.sid, other.brief), JSON.stringify(committed)).toBe(false);
      }
    });
    it('an unreadable carrier is UNKNOWN and fails closed: no reader, a throw, a missing row, a non-array, an entry that is not a record', async () => {
      for (const reader of [undefined, async () => { throw new Error('unreadable'); }, async () => null, async () => undefined,
        async () => 'nope' as unknown as unknown[], async () => [null], async () => ['junk']]) {
        const w = startOf(reader as never);
        expect(await buildTurnAlreadyOfferedDeadline(w.start, w.sid, w.brief)).toBe(true);
      }
    });
    it('no Agent build answer means nothing was offered; a second answer is closed by the answer count, not by this', async () => {
      const { sid, brief, construction } = rowsOf();
      expect(await buildTurnAlreadyOfferedDeadline({ rowId: construction.id, rows: [construction] }, sid, brief)).toBe(false);
      const { sid: s2, brief: b2, row, construction: c2 } = rowsOf(), a = row('agent_turn:build', { user_message: b2 }), b = row('agent_turn:chat', { user_message: 'Why?' });
      expect(await buildTurnAlreadyOfferedDeadline({ rowId: b.id, rows: [b, a, c2], committedPending: async () => [] }, s2, b2)).toBe(true);
    });
    // The route, end to end: the real carrier a first turn commits is lifted onto a build row, and a LATER system row (the user's
    // decline, say) is the newest, so nothing is live and only the committed proposal can say the date was already offered.
    const offeredEarlier = async () => { const w = world(), turn = await route(w); await turn(); return (w.rows[0] as Rec).pending_actions as Rec[]; };
    const declined = (w: ReturnType<typeof world>) => makeSessionTurnRow({ id: randomUUID(), scenario_id: w.sid, turn_id: randomUUID(), request_hash: 'system_event:decline',
      turn_class: 'direct_answer', handler_id: null, response_emitted: true, user_message: null, assistant_message: null });
    const proposals = (b: Rec) => b._agent.tool_calls.filter((c: Rec) => c.name === 'propose_goal_deadline');
    it('the build turn committed the deadline proposal, the user declined, the next turn is NOT offered the card again', async () => {
      const carried = await offeredEarlier(); expect(carried.length).toBeGreaterThan(0);
      const w = world(); w.rows.unshift(buildAnswer(w, { pending_actions: carried }), declined(w));
      expect(proposals(await (await route(w))())).toEqual([]);
    });
    it('CONTRAST: the same build row with nothing committed is offered the card', async () => {
      const w = world(); w.rows.unshift(buildAnswer(w, { pending_actions: [] }), declined(w));
      card(await (await route(w))());
    });
    it('a build answer whose prose asks about the deadline and mentions years, with no committed proposal, is still offered the card', async () => {
      const w = world(); w.rows.unshift(buildAnswer(w, { assistant_message: 'Is your deadline 10 August 2027? Launch is planned for 31 December 2027. What is the deadline?' }));
      card(await (await route(w))());
    });
    it('an UNKNOWN carrier read closes the offer AND says why on the existing logger (a silent closed offer is observable)', async () => {
      const { log } = await import('../../../utils/telemetry.js');
      for (const [mode, reason] of [['throw', 'committed_read_failed'], ['missing', 'committed_row_missing_or_malformed'], ['malformed', 'committed_entry_malformed']] as const) {
        const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
        try {
          const w = world(), build = buildAnswer(w); w.rows.unshift(build); w.failCommitted(mode, build.turn_id);
          expect(proposals(await (await route(w))())).toEqual([]);
          expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'agent_lane.deadline_offer_closed_unknown', reason, scenario_id: w.sid }), expect.any(String));
        } finally { warn.mockRestore(); }
      }
    });
    it('CONTRAST: a readable carrier never logs the unknown event', async () => {
      const { log } = await import('../../../utils/telemetry.js');
      const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
      try {
        const w = world(); w.rows.unshift(buildAnswer(w)); card(await (await route(w))());
        expect(warn.mock.calls.some(([fields]) => (fields as Rec)?.event === 'agent_lane.deadline_offer_closed_unknown')).toBe(false);
      } finally { warn.mockRestore(); }
    });
    it('a goal that already holds a deadline is never offered one', () => {
      const g = structuredClone(d2.graph); Object.assign(goal(g), { goal_horizon: { deadline: '2027-08-10' } });
      expect(deadlineCardToIssue(issueInput(g))).toBeUndefined();
    });
  });
});

/**
 * R7 — the SERVED goal node of scenario b2ad8385 (CEE 08bbe2e): `goal_threshold_unit: "%"`, label "Riders served without
 * being turned away". A unit with no letters named no subject, so attribution failed even once the build answer stopped
 * closing the offer. The label names the subject then, minus function words.
 */
describe('R7 attribution on the served share-of-riders goal', () => {
  const brief = 'Our bike-share scheme has 1,500 registered riders today and adds about 60 new riders a month. Our depot can handle at most 1,900 riders, '
    + 'and we want to stay under that ceiling, without turning anyone away, over the next ten months. We could rent a second depot or add a Sunday maintenance crew. Which should we do?';
  const served = { id: 'riders_served_without_being_turned_away', ref: 'G1', kind: 'goal', label: 'Riders served without being turned away',
    provenance: 'ai_inferred', goal_threshold_unit: '%', goal_threshold_frame: 'level', goal_deadline_as_stated: 'ten months' };
  const input = (over: Partial<DeadlineIssueInput> = {}): DeadlineIssueInput => ({ graph: { nodes: [served], edges: [] }, storedBrief: brief, typedNow: null,
    reference: R, toolCalls: [], mutated: false, fastPath: 'run', proposalOffered: false, pending: [], priorOffer: false, ...over });
  it('offers the served goal its ten months, bound to the goal id and verbatim words, quoting their sentence', () => {
    expect(deadlineCardToIssue(input())).toMatchObject({ goal_id: served.id, words: 'ten months', reference: R, date: '2027-08-10',
      quote: 'Our depot can handle at most 1,900 riders, and we want to stay under that ceiling, without turning anyone away, over the next ten months.' });
  });
  it('the unit-with-letters path is unchanged: "under" is still a subject word there (buddy r2 P3)', () => {
    const goal = { id: 'under_65_population', kind: 'goal', label: 'Under-65 population', goal_threshold_unit: 'people under 65', goal_deadline_as_stated: 'ten months' };
    expect(deadlineCardToIssue(input({ graph: { nodes: [goal], edges: [] }, storedBrief: 'We want to increase our under-65 population to 500 in ten months.' })))
      .toMatchObject({ goal_id: 'under_65_population', words: 'ten months', reference: R, date: '2027-08-10',
        quote: 'We want to increase our under-65 population to 500 in ten months.' });
  });
});

/**
 * ⭐ RULING A (DL 14 Oct, hiring-post3000 judge row 2): the route card trusts the construction's attested `goal_deadline_as_stated`
 * (its only writer); `goalOwnsDeadline` is retired. Every negative it carried becomes a card OFFERED as Olumi's interpretation,
 * quoting the sentence its words came from: the user approves or declines it, and nothing is saved until they do. Known residual (PR body):
 * a date the drafter wrongly claims for the goal is offered too. The quote shows what it was read from.
 */
describe('RULING A: the route card trusts the attested words; retired negatives are offered as a question, never saved', () => {
  const RETIRED: ReadonlyArray<readonly [string, string, string?]> = [
    ['rival date', 'Our rival wants to keep registered riders under the ceiling over the next ten months.'],
    ['example date', 'For example, we want to keep registered riders under the ceiling over the next ten months.'],
    ['other goal date', 'We have 1,400 registered riders. Our revenue goal is to reach £1,900 in ten months.', 'Our revenue goal is to reach £1,900 in ten months.'],
    ['duration, not deadline', 'We have registered riders. Our staff training lasts ten months.', 'Our staff training lasts ten months.'],
    ['owner absent', 'Registered riders should stay under the ceiling over the next ten months.'],
    ['previous-sentence subject (buddy r1 P1)', 'We have registered riders. We must reach revenue of £10,000 in ten months.', 'We must reach revenue of £10,000 in ten months.'],
    ['course duration, not a deadline (buddy r1 P1)', 'We have registered riders. We keep training staff over ten months as a course duration, not a deadline.',
      'We keep training staff over ten months as a course duration, not a deadline.'],
    ['same-sentence duration, not a deadline', 'We keep training registered riders over ten months as a course duration, not a deadline.'],
    ['same-sentence duration only', 'We keep training registered riders over ten months as a course.'],
    ['same-sentence "lasts"', 'We keep registered riders onboarded in a programme that lasts ten months.'],
    ['another subject (R7)', 'Our depot can handle at most 1,900 riders. We must finish the migration without downtime in ten months.',
      'We must finish the migration without downtime in ten months.'],
    ['no subject (R7)', 'We want to stay under that ceiling, without turning anyone away, over the next ten months.'],
    ...['We want to increase customers served to 500 in ten months.', 'We must finish the survey of riders in ten months.',
      'We keep riders enrolled in the survey over ten months.', 'We must finish the survey of riders served in ten months.',
      'We want to keep riders served without turning anyone away indefinitely, and finish our depot renovation in ten months.',
      'We want to increase survey responses from riders served to 500 in ten months.',
      'We want to keep riders served without turning anyone away indefinitely, and renovate our depot in ten months.',
      'We want to keep riders served without turning anyone away indefinitely, and refurbish our depot in ten months.',
      'We want to increase survey responses from riders served to five hundred in ten months.',
      'We want to keep riders served without turning anyone away indefinitely, and refurbish the depot serving our riders in ten months.',
      'We want to keep riders served without turning anyone away indefinitely, and renovate our riders\' depot in ten months.',
      'We want to increase survey responses from riders served in ten months.',
      'We want to increase survey responses from riders served, ideally to 500, in ten months.',
      'We want to increase survey responses from riders served, ideally, in ten months.',
      'We want to increase survey responses from 200 to 500, over the next ten months.',
    ].map((brief) => [`shared label word (R7 buddy r2 P2): ${brief}`, brief] as const),
  ];
  it.each(RETIRED.map(([name, brief, sentence]) => ({ name, brief, sentence: sentence ?? brief })))('$name', async ({ brief, sentence }) => {
    const w = world({ graph: d2.graph, brief }), before = w.read();
    // The capability reads the stored brief itself (route-only authorship: no argument selects the source).
    const offer = await w.caps.deadlineCardFromDraft(w.ctx('Run'), { ...issueInput(), start: { rowId: w.rows[0]!.id, rows: w.rows } });
    expect(offer?.words).toBe('ten months');
    const out = await offer!.issue(w.ctx('Run'), { deadline_words: 'ten months', rationale: '' }) as Rec;
    expect(out).toMatchObject({ ok: true, mutated: false });
    // The user's words, quoted with their sentence; that they are this goal's deadline is Olumi's interpretation (even one phrase).
    expect(out.public_label).toBe(`Is your deadline 10 August 2027 (10 months from 10 October 2026)? Your words: “ten months” in “${sentence.slice(0, -1)}”. `
      + 'Olumi’s interpretation; check the date and reference before approving.');
    expect(w.proposals.get(String(out.proposal_id))?.provenance.authored_by).toBe('model_proposed');
    expect(w.writes).toHaveLength(0);
    expect(w.read()).toEqual(before);
  });

  it('SERVED hiring-post3000: "We have an urgent launch date in the next three months." is offered on the first turn after the draft (was: no card)', async () => {
    // Served (CEE d9b6f799): turn 01 built the draft holding "three months" on the sole goal and asked "What is the actual launch
    // date?"; turn 02 offered no card (`goalOwnsDeadline` refused the sentence), so no date was ever saved.
    expect(goal(hiring.graph as Rec)).toMatchObject({ id: 'productivity', goal_deadline_as_stated: 'three months', goal_threshold_unit: '%' });
    expect(goal(hiring.graph as Rec).goal_horizon).toBeUndefined();
    const w = world(hiring as { graph: Rec; brief: string }); w.reference('2026-10-14T02:14:10Z', '2026-10-14T02:14:10Z');
    const before = w.read(), turn = await route(w), body = await turn();
    const calls = body._agent.tool_calls.filter((c: Rec) => c.name === 'propose_goal_deadline');
    expect(calls, JSON.stringify(body._agent.tool_calls)).toHaveLength(1);
    const yes = body.suggested_actions.find((c: Rec) => c.id === approvalChipIdFor(calls[0].proposal_id));
    expect(yes).toMatchObject({ label: 'Yes',
      detail: 'Is your deadline 14 January 2027 (3 months from 14 October 2026)? Your words: “three months” in “We have an urgent launch date in the next three months”. '
        + 'Olumi’s interpretation; check the date and reference before approving.' });
    const carrier = (w.rows[0] as Rec).pending_actions.find((p: Rec) => p.chip_id === yes.id);
    expect(carrier.action.inline_patch.agent_proposal, JSON.stringify(carrier)).toMatchObject({ proposal_id: calls[0].proposal_id,
      provenance: { authored_by: 'model_proposed' },
      operations: [{ op: 'set_goal_deadline', path: 'productivity', value: { deadline: '2027-01-14', words: 'three months', reference: '2026-10-14' } }] });
    expect(body.suggested_actions).toContainEqual(DEADLINE_CHANGE_CHIP);
    expect(w.read(), 'offered, not saved').toEqual(before);
    // Yes saves the date the card showed.
    await turn({ message: yes.message, source: 'chip_click', chip: { id: yes.id }, agent_session_id: body._agent.session_id });
    expect(goal(w.read()).goal_horizon).toMatchObject({ deadline: '2027-01-14' });
  });

  /**
   * Served (CEE 35a66525, `live/runs/2026-10-14T031016Z-hiring-post3007/hiring/turns/02.json`): Paul typed ASKED on the first turn
   * after the draft. The AI answered (one conversation call, 17.6 s), but the reply was ONLY the card. Turn 03's AI then said its
   * deadline question "failed to answer your UI question". This runs that turn's shape through the real route, with the AI
   * answering `answer`, then a second turn. It returns the reply and the second turn's assistant-history texts (by item, not by
   * substring).
   */
  const ASKED = 'Why can I barely see any of the connections between the factors, risks and outcome? Is this a UI or a data issue?';
  const HIRING_CARD = 'Is your deadline 14 January 2027 (3 months from 14 October 2026)? Your words: “three months” in “We have an urgent launch '
    + 'date in the next three months”. Olumi’s interpretation; check the date and reference before approving.';
  async function turn02(answer: string): Promise<{ body: Rec; history: string[]; before: Rec; after: Rec }> {
    const w = world(hiring as { graph: Rec; brief: string }); w.reference('2026-10-14T03:10:16Z', '2026-10-14T03:10:16Z');
    const before = w.read(), turn = await route(w);
    const inputs: Rec[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      inputs.push(JSON.parse(String(init?.body ?? '{}')) as Rec);
      // A provider message item as the Responses API returns it (with its role), so history is read by item.
      return new Response(JSON.stringify({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answer }] }] }), { status: 200 });
    }));
    const body = await turn({ message: ASKED, source: 'composer', chip: undefined });
    const calls = body._agent.tool_calls.filter((c: Rec) => c.name === 'propose_goal_deadline');
    expect(calls, JSON.stringify(body._agent.tool_calls)).toHaveLength(1);
    expect(body.suggested_actions.find((c: Rec) => c.id === approvalChipIdFor(calls[0].proposal_id))).toMatchObject({ label: 'Yes', detail: HIRING_CARD });
    const after = w.read();
    await turn({ message: 'Thanks. What should I look at first?', source: 'composer', chip: undefined, agent_session_id: body._agent.session_id });
    const items = (inputs.at(-1)!.input ?? []) as Rec[];
    const history = items.filter((i) => i.role === 'assistant').map((i) => (Array.isArray(i.content) ? i.content as Rec[] : [])
      .map((c) => typeof c.text === 'string' ? c.text : '').join(''));
    return { body, history, before, after };
  }
  const count = (text: string, part: string): number => text.split(part).length - 1;

  it('SERVED hiring-post3007 turn 02: the card rides ALONGSIDE the AI\'s answer to the user\'s own question, never instead of it', async () => {
    // Author-written stand-in for the AI's answer (the served one was replaced, so never captured): the claim is structural.
    const answer = 'It is mostly a data issue: most links between the factors and the outcome are still unsized, so they draw faintly.';
    const { body, history, before, after } = await turn02(answer);
    // Served: `assistant_text` was the card alone. Now the AI's answer, then the card's question.
    expect(body.assistant_text).toBe(`${answer}\n\n${HIRING_CARD}`);
    expect(after, 'offered, not saved').toEqual(before);
    // The next turn's AI holds this reply as ONE assistant item: its answer was given, and the card asked once.
    expect(history).toContain(body.assistant_text);
    expect(history.reduce((n, t) => n + count(t, HIRING_CARD), 0)).toBe(1);
  });

  it('Codex #3009: an answer that already says the card\'s whole question is not given it again (reply and history hold it once)', async () => {
    const answer = `It is mostly a data issue: most links are still unsized. ${HIRING_CARD}`;
    const { body, history } = await turn02(answer);
    expect(body.assistant_text).toBe(answer);
    expect(count(body.assistant_text, HIRING_CARD)).toBe(1);
    expect(history).toContain(answer);
    expect(history.reduce((n, t) => n + count(t, HIRING_CARD), 0)).toBe(1);
  });
});

/**
 * ⭐ A HELD CARD LAPSES ONLY WHEN ITS OWN SUBJECT CHANGED (served hiring witness on 35a66525, turn 04,
 * JUDGE-hiring-post3007-codex.md "False or lost"): approving two unrelated link strengths moved the model's hash, and the pending
 * deadline card "no longer fits the model as it now stands, so it has lapsed" while the saved goal and its date were unchanged.
 * The real route, the real reconcile (`lifecycle.ts`) and the real approval writer; the link change is written to the store as
 * the strength approval writes it (one edge's strength moved, nothing else).
 */
describe('a held deadline card survives an unrelated model change, and lapses when its own date moved', () => {
  const moveOneLink = (g: Rec): Rec => {
    const decision = g.nodes.find((n: Rec) => n.kind === 'decision')?.id;
    const e = g.edges.find((x: Rec) => x.from !== decision && typeof x.strength?.mean === 'number');
    expect(e, 'an edge with a strength outside the decision').toBeDefined();
    e.strength = { ...e.strength, mean: e.strength.mean === 0.5 ? 0.7 : 0.5 };
    return g;
  };
  const onLatestRow = (w: ReturnType<typeof world>, chipId: string) =>
    ((w.rows.find((r) => !r.turn_id.endsWith(':claim')) as Rec | undefined)?.pending_actions ?? []).some((p: Rec) => p.chip_id === chipId);

  it('⭐ RED→GREEN: card offered → a link strength lands → the next turn keeps the card (no lapse said) → Yes writes the date', async () => {
    const w = world(), turn = await route(w), first = await turn(), { yes } = card(first);
    const original = structuredClone(w.read()), before = hash(original);
    w.replace(moveOneLink(w.read()));
    expect(hash(w.read()), 'the model moved').not.toBe(before);
    const next = await turn({ agent_session_id: first._agent.session_id });
    expect(String(next.assistant_text)).not.toMatch(/no longer fits the model/);
    expect(onLatestRow(w, yes.id), 'the card is still held on the latest row').toBe(true);
    const changed = (w.read().edges as Rec[]).filter((x, i) => JSON.stringify(x) !== JSON.stringify(original.edges[i]));
    expect(changed, 'exactly the one link moved').toHaveLength(1);
    await turn({ message: yes.message, source: 'chip_click', chip: { id: yes.id }, agent_session_id: first._agent.session_id });
    const after = w.read();
    expect(goal(after)).toMatchObject({ goal_horizon: { deadline: '2027-08-10' } });
    // The date write re-points the goal's own links to its dated carrier; the moved link (outside the goal) is kept as moved.
    expect((after.edges as Rec[]).filter((x) => x.from === changed[0]!.from && x.to === changed[0]!.to), 'the link change is kept').toEqual(changed);
  });

  it('NEGATIVE: the model moved AND the goal’s own date changed → the card lapses, said; Yes writes nothing', async () => {
    const w = world(), turn = await route(w), first = await turn(), { yes } = card(first);
    const g = moveOneLink(w.read());
    goal(g).goal_horizon = { ...(goal(g).goal_horizon ?? {}), deadline: '2027-01-31' };
    w.replace(g);
    const next = await turn({ agent_session_id: first._agent.session_id });
    expect(String(next.assistant_text)).toMatch(/no longer fits the model as it now stands, so it has lapsed/);
    expect(onLatestRow(w, yes.id)).toBe(false);
    await turn({ message: yes.message, source: 'chip_click', chip: { id: yes.id }, agent_session_id: first._agent.session_id });
    expect(goal(w.read()).goal_horizon.deadline).toBe('2027-01-31');
  });
});
