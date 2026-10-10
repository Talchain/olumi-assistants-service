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
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, type ToolResult } from '../runtime/agent-tools.js';
import { constructionOperationId } from '../runtime/build-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { ProposalStore } from '../proposal.js';
import { proposalPendingAction } from '../durable-proposal.js';
import { proposalRecord } from '../proposal-object/record.js';
import { approvalChipsFor, approvalChipIdFor, DEADLINE_CHANGE_CHIP } from '../approval-chips.js';
import { commitOptionLevelsInProcess } from '../../system-events/dispatch.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { deadlineCardToIssue, firstAgentTurnAfterDraft, type DeadlineIssueInput } from '../deadline-card.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

type Rec = Record<string, any>;
const R = '2026-10-10', STAMP = `${R}T00:35:48.393294Z`;
const hash = (g: Rec) => computeAnalysisAffectingGraphHash(g as never)!;
const goal = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'goal');
function world(fixture: { graph: Rec; brief: string } = d2) {
  const sid = randomUUID(); let bytes = JSON.stringify(fixture.graph), brief = fixture.brief;
  let draftStamp: string | null = STAMP, scenarioStamp: string | null = '2026-09-01T10:00:00Z', broken = false, snapshotBroken = false;
  const read = (): Rec => JSON.parse(bytes);
  const rows: SessionTurnWithContent[] = [makeSessionTurnRow({ id: randomUUID(), scenario_id: sid, turn_id: registrationTurnId(sid, constructionOperationId(sid, brief)),
    request_hash: 'graph_registration:draft', turn_class: 'direct_answer', handler_id: null, response_emitted: false, created_at: STAMP })];
  const writes: Rec[] = []; const latest = () => rows.find(r => !r.turn_id.endsWith(':claim'));
  const store = createMockSessionStore({
    loadGraph: async () => read(), loadGraphAndBriefText: async () => ({ graph: read(), briefText: brief }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readCommittedTurn: async (_sid, id) => { const r = rows.find(r => r.turn_id === id); return r ? { id: r.id, request_hash: r.request_hash,
      user_message: r.user_message ?? null, assistant_message: r.assistant_message ?? null, llm_calls_used: r.llm_calls_used } : null; },
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
    reference: (draft: string | null, scenario: string | null) => { draftStamp = draft; scenarioStamp = scenario; }, failRead: () => { broken = true; }, failSnapshot: () => { snapshotBroken = true; } };
}
const apps: FastifyInstance[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function route(w: ReturnType<typeof world>) {
  vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden'); }));
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
function card(body: Rec) {
  const calls = body._agent.tool_calls.filter((c: Rec) => c.name === 'propose_goal_deadline');
  expect(calls).toHaveLength(1); expect(calls[0].ok).toBe(true);
  const yes = body.suggested_actions.find((c: Rec) => c.id === approvalChipIdFor(calls[0].proposal_id));
  expect(yes).toMatchObject({ label: 'Yes', detail: 'Is your deadline 10 August 2027 (10 months from 10 October 2026)?' });
  expect(body.suggested_actions).toContainEqual(DEADLINE_CHANGE_CHIP);
  return { call: calls[0], yes };
}
describe('deterministic deadline card on the first Agent turn', () => {
  it('R1 Run-chip offers exactly one bound card using draft R; no graph change', async () => {
    const w = world(), before = w.read(), turn = await route(w), body = await turn(), { call, yes } = card(body);
    expect(body.assistant_text).toBe(yes.detail); expect(w.read()).toEqual(before);
    const carrier = (w.rows[0] as Rec).pending_actions.find((p: Rec) => p.chip_id === yes.id);
    expect(carrier.action.inline_patch.agent_proposal).toMatchObject({ proposal_id: call.proposal_id,
      operations: [{ op: 'set_goal_deadline', path: goal(before).id, value: { deadline: '2027-08-10', words: 'ten months', reference: R, expected_deadline: null, stated_months: 10 } }] });
  });
  it('R5 stored brief never satisfies the model-facing THIS typed-turn gate', async () => {
    const w = world();
    expect(await dispatchTool('propose_goal_deadline', JSON.stringify({ deadline_words: 'ten months', rationale: '' }), w.ctx('Run the analysis.'), w.caps, 'full'))
      .toMatchObject({ ok: false, mutated: false, refusal: 'deadline_not_stated' });
    expect(w.proposals.outstanding(w.sid, null)).toHaveLength(0);
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
      .toEqual({ goal_id: goal(graph).id, words: 'ten months', reference: R, date: '2027-08-10' });
    expect(deadlineCardToIssue({ ...issueInput(), storedBrief: '', typedNow: 'My deadline is ten months' })).toBeDefined();
  });
  it.each([
    ['invented words', 'We want to keep registered riders under the ceiling.'],
    ['rival date', 'Our rival wants to keep registered riders under the ceiling over the next ten months.'],
    ['example date', 'For example, we want to keep registered riders under the ceiling over the next ten months.'],
    ['other goal date', 'We have 1,400 registered riders. Our revenue goal is to reach £1,900 in ten months.'],
    ['duration, not deadline', 'We have registered riders. Our staff training lasts ten months.'],
    ['owner absent', 'Registered riders should stay under the ceiling over the next ten months.'],
  ])('%s is silent', (_name, storedBrief) => { expect(deadlineCardToIssue({ ...issueInput(), storedBrief })).toBeUndefined(); });
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
  it.each([['d2 structural', d2], ['d1 ceiling', d1]] as const)('%s', async (shape, fixture) => {
    const w = world(fixture), before = w.read(), turn = await route(w), first = await turn(), { yes } = card(first);
    expect(w.read()).toEqual(before);
    const answer = await turn({ message: yes.message, source: 'chip_click', chip: { id: yes.id }, agent_session_id: first._agent.session_id });
    expect(answer._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    const after = w.read(); expect(goal(after)).toMatchObject({ goal_horizon: { deadline: '2027-08-10' }, goal_horizon_months: 10 });
    for (const n of before.nodes.filter((n: Rec) => n.kind !== 'goal')) expect(JSON.stringify(after.nodes.find((a: Rec) => a.id === n.id))).toBe(JSON.stringify(n));
    const nonStructural = (n: Rec) => { const { goal_horizon, goal_horizon_months, goal_horizon_reference_date, goal_horizon_stated_months,
      nonlinear_identity, observed_state, ...other } = n; return other; };
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
  it('newest system event, unreadable identity, and an earlier Agent answer fail closed', async () => {
    const w = world(); w.rows.unshift(makeSessionTurnRow({ id: randomUUID(), scenario_id: w.sid, turn_class: 'direct_answer', handler_id: null,
      request_hash: 'sha256:system-event', turn_id: 'system-event' }));
    const body = await (await route(w))(); expect(body._agent.tool_calls.filter((c: Rec) => c.name === 'propose_goal_deadline')).toEqual([]);
    expect(firstAgentTurnAfterDraft(undefined, w.sid, d2.brief)).toBe(false);
    expect(firstAgentTurnAfterDraft({ rowId: 'wrong-row', rows: w.rows }, w.sid, d2.brief)).toBe(false);
    const draft = w.rows.find(r => r.request_hash.startsWith('graph_registration:'))!;
    expect(firstAgentTurnAfterDraft({ rowId: draft.id, rows: [draft, makeSessionTurnRow({ request_hash: 'agent_turn:prior' })] }, w.sid, d2.brief)).toBe(false);
  });
  it('scenario immutable reference is fallback; missing both cannot use clock', async () => {
    const w = world(); w.reference(null, '2026-10-09T10:00:00Z');
    const input = { ...issueInput(), start: { rowId: w.rows[0]!.id, rows: w.rows } };
    const issuer = await w.caps.deadlineCardFromDraft(w.ctx('Run'), input); expect(issuer).toBeDefined();
    const out = await issuer!.issue(w.ctx('Run'), { deadline_words: issuer!.words, rationale: '' }) as Rec;
    expect(out.public_label).toBe('Is your deadline 9 August 2027 (10 months from 9 October 2026)?');
    expect(w.proposals.get(out.proposal_id)!.operations[0]!.value).toMatchObject({ reference: '2026-10-09', expected_deadline: null });
    w.reference(null, null); expect(await w.caps.deadlineCardFromDraft(w.ctx('Run'), input)).toBeUndefined();
  });
  it('Change date follow-up can still propose THIS newly typed deadline through the model door', async () => {
    const w = world(); const out = await w.caps.proposeGoalDeadline!(w.ctx('My deadline is eleven months'), { deadline_words: 'eleven months', rationale: '' });
    expect(out).toMatchObject({ ok: true, public_label: 'Is your deadline 10 September 2027 (11 months from 10 October 2026)?' });
  });
});
