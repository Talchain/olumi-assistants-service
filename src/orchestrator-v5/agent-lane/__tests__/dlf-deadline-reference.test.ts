/** Retained graph/brief/creation from 2026-10-13T131858Z/deadline/reads/12-13-after-msg.json.
 * Tool arguments were not retained; reference variants below are probes, not claimed original bytes. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { draftedTeamPartOf } from '../../goal-target/event-by-date-model.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { log } from '../../../utils/telemetry.js';
import fixture from './fixtures/dlf-turn13-deadline.json';

type Rec = Record<string, any>;
const SID = '7eb4f8d8-c004-46ae-bec6-3f1e909424d8';
const WORDS = '6 months from today';
const TEAM = "The team are currently telling me they're going to be a month late delivering the next feature (so, 7 months), but I have low confidence in this because they keep missing deadlines.";
const QUOTE = "they're going to be a month late delivering the next feature (so, 7 months)";
const ctx = (text = TEAM) => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'DLf',
  user_turn_text: text, user_text: `${WORDS}\n${text}`, user_text_complete: true });
const goal = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'goal');
const tuple = (g: Rec) => ({ deadline: goal(g).goal_horizon?.deadline, reference: goal(g).goal_horizon_reference_date,
  months: goal(g).goal_horizon_months, stated_months: goal(g).goal_horizon_stated_months });
const EXPECTED = { deadline: '2027-04-13', reference: '2026-10-13', months: 6, stated_months: 6 };
function world() {
  let bytes = JSON.stringify(fixture.graph);
  const read = (): Rec => JSON.parse(bytes);
  const rows: { id: string; write: SessionTurnWrite }[] = [];
  const store = createMockSessionStore({
    loadGraph: async () => read(), loadGraphAndBriefText: async () => ({ graph: read(), briefText: fixture.brief_text }),
    append: async write => { const saved = JSON.parse(JSON.stringify(write)) as SessionTurnWrite;
      const id = `dlf-${rows.length}`; rows.push({ id, write: saved });
      if (saved.graph !== undefined) bytes = JSON.stringify(saved.graph); return { id }; },
    readRecent: async () => rows.map(({ id, write: w }) => makeSessionTurnRow({ id, scenario_id: w.scenario_id,
      turn_id: w.turn_id, turn_class: w.turn_class, handler_id: w.handler_id, request_hash: w.request_hash,
      response_emitted: w.response_emitted, llm_calls_used: w.llm_calls_used, duration_ms: w.duration_ms })),
    readFactsWithTurnFor: async ids => rows.filter(r => ids.includes(r.id)).flatMap(({ id, write }) =>
      write.handler_facts.map(fact => ({ turn_id: id, fact_created_at: '2026-10-13T14:05:24Z', fact }))),
  });
  const commit = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    const out = await executeOptionInterventionBatch({ scenarioId: SID, turnId: input.turn_id, requestId: 'DLf', requestHash: input.turn_id,
      stage: 'frame', freshness: 'none', hasExistingAnalysis: false, expectedGraphHash: input.base_graph_hash, targets: [],
      goalHorizon: input.goal_horizon, teamTime: input.team_time }, store);
    if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
    if (out.kind !== 'committed' && out.kind !== 'unchanged') throw new Error(JSON.stringify(out));
    const graphHash = computeAnalysisAffectingGraphHash(read() as never);
    if (graphHash === null) throw new Error('Committed fixture must have a readable graph hash');
    return { status: 'committed', graph_hash: graphHash, receipt: null,
      already_applied: out.kind === 'unchanged', committed_levels: [], links_resized: [] };
  };
  const dispatch: InternalDispatch = async path => {
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    if (path.endsWith('/graph')) return { status: 200, json: { graph: read(), graph_hash: computeAnalysisAffectingGraphHash(read() as never),
      brief_text: fixture.brief_text, scenario_created_at: fixture.scenario_created_at } };
    throw new Error(path);
  };
  const proposals = new ProposalStore();
  const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, {
    commitOptionLevels: commit, now: () => new Date('2026-10-13T14:05:24Z'),
  });
  const offer = (args: Rec = {}, text = TEAM) => caps.proposeGoalDeadline!(ctx(text), { deadline_words: WORDS, rationale: '', ...args });
  const approve = (id: string, pressed = true) => caps.authoriseChange({ ...ctx('Yes'), ...(pressed ? { typed_approval_of: id } : {}) }, { proposal_id: id });
  return { read, rows, proposals, caps, offer, approve };
}
afterEach(() => vi.restoreAllMocks());
async function saveDeadline(w: ReturnType<typeof world>, args: Rec = { reference_date: null }) {
  const card = await w.offer(args);
  expect(card.ok, JSON.stringify(card)).toBe(true);
  expect(await w.approve(String(card.proposal_id))).toMatchObject({ ok: true, applied: true });
  expect(tuple(w.read())).toEqual(EXPECTED);
  return card;
}

describe('DLf: turn-13 deadline reaches the saved model', () => {
  it.each([undefined, null, '', 'today', '2026-13-45'])('(a) model reference %s cannot block the recorded reference', async reference_date => {
    const w = world(), before = w.read();
    const trace = vi.spyOn(log, 'info');
    const card = await w.offer(reference_date === undefined ? {} : { reference_date });
    expect(card.ok, JSON.stringify(card)).toBe(true);
    const proposal = w.proposals.get(String(card.proposal_id))!;
    expect(proposal.operations).toEqual([{ op: 'set_goal_deadline', path: 'event_goal', value: {
      deadline: '2027-04-13', expected_deadline: null, reference: '2026-10-13', stated_months: 6, words: WORDS,
    } }]);
    expect(proposal.provenance.authored_by).toBe('user_stated');
    expect(card.public_label).toBe(`Is your deadline 13 April 2027 (6 months from 13 October 2026)? Your words: “${WORDS}”.`);
    if (reference_date !== undefined) expect(trace).toHaveBeenCalledWith(expect.objectContaining({
      event: 'v5.agent.deadline_reference_ignored', request_id: 'DLf', reference_date: '2026-10-13', ignored_reference_date: reference_date,
    }), expect.any(String));
    expect(w.read()).toEqual(before); expect(w.rows).toHaveLength(0);
  });
  it('(b) approval saves the exact tuple; another process and a next-day clock retain it', async () => {
    const w = world(); await saveDeadline(w);
    expect(w.rows.filter(r => r.write.graph !== undefined)).toHaveLength(1);
    for (const clock of ['2026-10-13T14:05:24Z', '2026-10-14T14:05:24Z']) {
      const read = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./fixtures/dlf-cold-read.ts', import.meta.url))], {
        input: JSON.stringify({ graph: w.read(), clock }), encoding: 'utf8', env: process.env,
      }));
      expect(read).toEqual({ ...EXPECTED, clock: new Date(clock).toISOString() });
    }
  });
  it('(c) the seven-month low-confidence forecast needs its own press and leaves the deadline intact', async () => {
    const w = world(); await saveDeadline(w);
    const before = w.read();
    const card = await w.caps.proposeTeamTime!(ctx(), { quote: QUOTE, low_months: 7, high_months: 7 });
    expect(card.ok, JSON.stringify(card)).toBe(true);
    expect(card.public_label).toBe(`From your message: ‘${TEAM}’ Do you want to use 7 months as your forecast for today's team to finish next feature launch? `
      + 'Olumi’s assumed 3.5–10.5-month range informs this approximate calculation; modelled outcomes can fall outside those time bounds. '
      + 'You described low confidence in that forecast.');
    expect(await w.approve(String(card.proposal_id), false)).toMatchObject({ ok: false, refusal: 'approval_required' });
    expect(w.read()).toEqual(before);
    expect(resolveRunAdmission(w.read()).willProceed).toBe(false);
    expect(await w.approve(String(card.proposal_id))).toMatchObject({ ok: true, applied: true });
    expect(tuple(w.read())).toEqual(EXPECTED);
    expect(draftedTeamPartOf(w.read())!.team.observed_state.stated_time).toEqual({ quantity: 'months_to_finish', low: 3.5, high: 10.5,
      unit: 'months', deadline: '2027-04-13', reference_date: '2026-10-13', forecast: 7, forecast_origin: 'user_confirmed',
      forecast_words: QUOTE, range_origin: 'olumi_estimate', range_rule: 'low_confidence',
      selection: { by: 'user_press', interpretation: 'olumi', source: TEAM, quote: QUOTE } });
    expect(resolveRunAdmission(w.read()).willProceed).toBe(true);
  });
  it.each([
    ['unrelated revenue date', 'Revenue was 2m as of 2026-09-01. Our launch deadline is 6 months from today.', undefined],
    ['unrelated revenue date with correct host echo', 'Revenue was 2m as of 2026-09-01. Our launch deadline is 6 months from today.', '2026-10-13'],
    ['old report date before deadline dating', 'as of 2026-09-01 for the old report; our launch deadline is 6 months from today as of 2026-10-13', undefined],
    ['comma and revenue date', 'Revenue was 2m as of 2026-09-01, and our launch deadline is 6 months from today.', undefined],
    ['comma and revenue date with correct host echo', 'Revenue was 2m as of 2026-09-01, and our launch deadline is 6 months from today.', '2026-10-13'],
    ['old report comma before deadline dating', 'as of 2026-09-01 for the old report, our launch deadline is 6 months from today as of 2026-10-13', undefined],
    ['deadline before unrelated revenue date', 'Our launch deadline is 6 months from today, and revenue was 2m as of 2026-09-01.', undefined],
  ])('DLf4 %s never becomes the saved deadline reference', async (_name, text, reference_date) => {
    const w = world();
    const card = await w.offer(reference_date === undefined ? {} : { reference_date }, text);
    expect(card.ok, JSON.stringify(card)).toBe(true);
    expect(await w.approve(String(card.proposal_id))).toMatchObject({ ok: true, applied: true });
    expect(tuple(w.read())).toEqual(EXPECTED);
    const proposal = w.proposals.get(String(card.proposal_id))!;
    expect(proposal.operations).toEqual([{ op: 'set_goal_deadline', path: 'event_goal', value: {
      deadline: '2027-04-13', expected_deadline: null, words: WORDS, reference: '2026-10-13', stated_months: 6,
    } }]);
    expect(proposal.provenance).toEqual({ authored_by: 'user_stated', basis: '' });
    expect(card.public_label).toBe(`Is your deadline 13 April 2027 (6 months from 13 October 2026)? Your words: “${WORDS}”.`);
    expect(w.rows.filter(r => r.write.graph !== undefined)).toHaveLength(1);
  });
  it('DLf4 an explicit as-of dates the deadline with a matching model echo', async () => {
    const w = world();
    const card = await w.offer({ deadline_words: 'six months', reference_date: '2026-11-01' }, 'as of 2026-11-01 our deadline is six months');
    expect(card.ok, JSON.stringify(card)).toBe(true);
    expect(card.public_label).toBe('Is your deadline 1 May 2027 (6 months from 1 November 2026)? Your words: “six months”.');
    const proposal = w.proposals.get(String(card.proposal_id))!;
    expect(proposal.operations).toEqual([{ op: 'set_goal_deadline', path: 'event_goal', value: {
      deadline: '2027-05-01', expected_deadline: null, words: 'six months', reference: '2026-11-01', stated_months: 6,
    } }]);
    expect(proposal.provenance).toEqual({ authored_by: 'user_stated', basis: '' });
    expect(w.rows).toEqual([]);
    expect(await w.approve(String(card.proposal_id))).toMatchObject({ ok: true, applied: true });
    expect(tuple(w.read())).toEqual({ ...EXPECTED, deadline: '2027-05-01', reference: '2026-11-01' });
  });
  it('(d) an unverified model reference never overrides the host reference', async () => {
    const w = world(); await saveDeadline(w, { reference_date: '2026-11-01' });
  });
  it.each([undefined, '2026-11-01', 'today'])('(d) current-turn as-of overrides only with matching model echo %s', async reference_date => {
    const w = world();
    const card = await w.offer({ reference_date }, `${WORDS}, as of 2026-11-01`);
    expect(card.ok, JSON.stringify(card)).toBe(true);
    const expected = reference_date === '2026-11-01'
      ? { ...EXPECTED, deadline: '2027-05-01', reference: '2026-11-01' } : EXPECTED;
    expect(w.proposals.get(String(card.proposal_id))!.operations[0].value).toEqual({
      deadline: expected.deadline, expected_deadline: null, reference: expected.reference, stated_months: 6, words: WORDS,
    });
    expect(await w.approve(String(card.proposal_id))).toMatchObject({ ok: true, applied: true });
    expect(tuple(w.read())).toEqual(expected);
  });
  it('(d) a malformed date actually stated as the user reference still refuses', async () => {
    const w = world();
    expect(await w.offer({ reference_date: '2026-13-45' }, `${WORDS}, as of 2026-13-45`))
      .toMatchObject({ ok: false, mutated: false, refusal: 'reference_invalid' });
    expect(w.rows).toHaveLength(0);
  });
  it.each(['2027-02-30', 'tomorrow', 123, null])('(d) malformed deadline %s still refuses', async deadline_date => {
    const w = world();
    expect(await w.offer({ deadline_date })).toMatchObject({ ok: false, mutated: false, refusal: 'unreadable_deadline' });
    expect(w.rows).toHaveLength(0);
  });
  it.each([true, false, undefined])('(d) unverified words remain unknown with completeness %s', async user_text_complete => {
    const w = world();
    expect(await w.caps.proposeGoalDeadline!({ ...ctx('Show the deadline'), user_text: 'Show the deadline', user_text_complete,
      unverified_user_text: WORDS }, { deadline_words: WORDS, reference_date: '2026-11-01', rationale: '' }))
      .toMatchObject({ ok: false, mutated: false, refusal: 'origin_unknown' });
    expect(w.rows).toHaveLength(0);
  });
  it.each(['2027-04-14', '2027-04-13'])('(e) model deadline %s cannot replace a resolved date or its stated count', async deadline_date => {
    const w = world(); await saveDeadline(w, { deadline_date });
  });
});
