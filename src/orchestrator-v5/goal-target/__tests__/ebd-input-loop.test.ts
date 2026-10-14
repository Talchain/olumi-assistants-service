/**
 * EBD — the deadline ("event by date") model's input loop, at its producers (Paul's hiring test, 12 Oct 2026, scenario
 * 4184e877). The end-to-end replay is `ebd-paul-hiring-replay.route.test.ts`; these rows pin each producer by identity.
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn(async () => undefined) }));
import { admitCandidateModel, type CandidateModel } from '../../agent-lane/admit-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { assessRouteAdmission } from '../../../cee/graph-readiness/canonical-readiness.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { decisionInputAsk } from '../../agent-lane/decision-input-ask.js';
import { draftedTeamPartOf, eventModelAsk, eventSetAsideLine, withEventShareDate } from '../event-by-date-model.js';
import { chanceGoalDeadlineAsk } from '../goal-kind.js';
import { readStatedDeadline } from '../deadline-date.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { buildModelFromBrief, constructionOperationId, type CallStructuredModel } from '../../agent-lane/runtime/build-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { applyTeamShareEdit, bindTeamTimeQuote, teamTimeCard, teamTimesInQuote, widenedTeamTime, type ApprovedTeamTime } from '../team-share-write.js';
import { shareChanceRunBlock, shareOptionEstimateWords, sharePartsForOption } from '../share-by-date-run.js';
import { goalChanceLicenceOf } from '../goal-chance-licence.js';
import { withShareByDateChanceGate } from '../goal-chance-range.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { goalChanceScreenLinesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';
import { readinessSentence, readinessSentenceOnce, type ReadinessView } from '../../agent-lane/readiness-view.js';
import { narrateWriteOutcome } from '../../agent-lane/write-outcome.js';

type Rec = Record<string, any>;
const SID = 'ebdebdeb-0000-4000-8000-000000004184';
const BRIEF = 'We need to decide whether to hire a Tech lead or two developers to boost productivity and meet our next feature-launch deadline.';
const candidate = (): CandidateModel => ({
  goal: { kind: 'event_by_date', deliverable: 'next feature launch', metric: 'Next feature launch', operator: '>=', unit: '% of next feature launch',
    value: null, target_stated: false, frame: 'level', baseline_known: false, baseline_value: null, horizon_months: null, provenance: 'inferred' },
  options: [
    { label: 'Hire a Tech lead', provenance: 'explicit', added_capacity: { monthly_share_pct: 12, lead_months_low: 2, lead_months_high: 4 } },
    { label: 'Hire two developers', provenance: 'explicit', added_capacity: { monthly_share_pct: 20, lead_months_low: 2, lead_months_high: 4 } },
    { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, added_capacity: null },
  ], factors: [], risks: [], outcomes: [], links: [], constraints: [], identities: [],
});
const plain = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphV3.parse(g)), { nodes: [], edges: [] }).graph as Rec;
const drafted = (): Rec => { const a = admitCandidateModel(candidate(), {}, BRIEF, undefined, undefined, undefined, undefined, undefined,
  { event_by_date_prompted: true }); return plain({ nodes: a.nodes, edges: a.edges }); };
const dated = (): Rec => plain(withEventShareDate(drafted(), '2027-04-12', '2026-10-12'));
const askContext = { builtOrRan: true, awaitingApproval: false, restingText: '', questionsToggle: false, recentReplies: [] };
const LEVEL_ASK = /before any option changes it|treat it as zero/;

describe('E1 — the deadline model has ONE readiness question, its own', () => {
  it.each([
    ['no deadline yet', drafted, chanceGoalDeadlineAsk('next feature launch')],
    ['deadline held, no team time', dated, 'How long would next feature launch take with the team you have now?'],
  ])('%s: the Run, graph-readiness, the canonical payload and the coach say the same sentence', (_name, graph, expected) => {
    const g = graph(), team = draftedTeamPartOf(g)!.team.id;
    expect(eventModelAsk(g)).toBe(expected);
    expect(decisionInputAsk(g, askContext)).toBe(expected);
    const run = resolveRunAdmission(g);
    expect(run.willProceed).toBe(false);
    // Bound by identity: the team part's own gap, still the level-gap code (required, never offered), with the model's ask.
    expect(run.assessment.blockingIssues.filter(i => i.factor_id === team))
      .toEqual([expect.objectContaining({ code: 'MISSING_FACTOR_LEVEL', factor_id: team, message: expected })]);
    expect((assessRouteAdmission(g).readiness_issues ?? []).filter((i: Rec) => i.factor_id === team).map((i: Rec) => i.message)).toEqual([expected]);
    const payload = buildCanonicalAnalysisReadyFromGraph(g) as Rec;
    expect(payload.blockers.filter((b: Rec) => b.factor_id === team).map((b: Rec) => b.message)).toEqual([expected]);
    expect(JSON.stringify(payload)).not.toMatch(LEVEL_ASK);
  });
  it('CONTRAST: an ordinary root with no level keeps the status-quo level ask, byte for byte', () => {
    const g = drafted();
    g.nodes.push({ id: 'fac_velocity', kind: 'factor', label: 'Team velocity', category: 'observable' });
    g.edges.push({ from: 'fac_velocity', to: 'event_goal', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' });
    const issues = resolveRunAdmission(g).assessment.blockingIssues.filter(i => i.code === 'MISSING_FACTOR_LEVEL');
    expect(issues.find(i => i.factor_id === 'fac_velocity')?.message)
      .toBe('What is "Team velocity" today, before any option changes it? Without a current level the analysis would treat it as zero.');
    expect(issues.find(i => i.factor_id === 'event_team')?.message).toBe(chanceGoalDeadlineAsk('next feature launch'));
  });
});

describe('E3 — the deadline reader finds the date expression inside the user\'s own quoted span', () => {
  const TODAY = '2026-10-12';
  // Paul's own phrasings (served turns 3, 5, 6; the regression probe's refused rows), each 6 months from 12 October 2026.
  it.each([
    'launch deadline in six months time', 'our launch deadline in six months time', 'a launch deadline in 6 months',
    'in six months time', "it's in six months time", 'it’s in six months time', 'launch in six months time',
    '6 months from today', "it's 6 months from today", 'about six months',
  ])('"%s" → 12 April 2027, a stated count of 6 months', words => {
    expect(readStatedDeadline(words, TODAY)).toEqual(expect.objectContaining({ date: '2027-04-12', form: 'months_from_today',
      stated_count: { value: 6, unit: 'months' }, words }));
  });
  it.each([
    'recruitment will take more than 3 months',
    // Paul's own hiring sentence (served turn 9): a hiring time, never his deadline.
    'a tech lead would take at least 3 months', 'get one in within 2 months and then another a month or so later',
    'likely to miss that deadline by over a month', 'we started 6 months ago', 'the team spent 6 months',
    'before March', 'until March', 'next sprint', 'the end of next quarter', '1 October 2026', '0 months',
  ])('never guessed: "%s" → null', words => { expect(readStatedDeadline(words, TODAY)).toBeNull(); });
  it('CONTRAST: the brief scan and the drafter card keep the closed lead-word list (byte-identical readings)', () => {
    expect(readStatedDeadline('launch deadline in six months time', TODAY, { leadWordsOnly: true })).toBeNull();
    expect(readStatedDeadline('a deadline in 6 months', TODAY, { leadWordsOnly: true })?.date).toBe('2027-04-12');
  });
});

describe('E3 — the door: the user\'s phrase is placed, and an unplaceable one gets a direct question, not a ban', () => {
  const caps = () => {
    const g = drafted();
    const dispatch: InternalDispatch = async path => path.endsWith('/versions')
      ? { status: 200, json: { versions: [{ version_id: 'draft-v1', sequence: 1, created_at: '2026-10-12T08:41:24.992Z',
        creation: { kind: 'initial', source_turn_id: registrationTurnId(SID, constructionOperationId(SID, BRIEF)) } }] } }
      : { status: 200, json: { graph: g, graph_hash: computeAnalysisAffectingGraphHash(g as never), brief_text: BRIEF } };
    return { proposals: new ProposalStore(), dispatch };
  };
  const ctx = (text: string) => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'ebd-e3', user_text: text, user_turn_text: text });
  it("Paul's served turn 3 (refused twice on c85817f2) now prepares the card he later got by insisting", async () => {
    const { proposals, dispatch } = caps(), c = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { now: () => new Date('2026-10-12T08:52:27Z') });
    const typed = "If we don't increase our developer's output by 25%, in the next three months, we're unlikely to hit our launch deadline in six months time";
    const r = await c.proposeGoalDeadline!(ctx(typed) as never, { deadline_words: 'launch deadline in six months time', rationale: '' }) as Rec;
    // ⛔ DLf5 (#2997 Codex check, DL rule): EXPECTATION CHANGED, old "Your words: …" (user_stated) → new "… Olumi’s
    // interpretation; …": his sentence holds two durations, so which is the deadline is Olumi's reading. Date unchanged.
    expect(r).toMatchObject({ ok: true, public_label: 'Is your deadline 12 April 2027 (6 months from 12 October 2026)? Your words: “launch deadline in six months time”. Olumi’s interpretation; check the date and reference before approving.' });
  });
  it('an unplaceable phrase: the Agent is told to ask the model\'s own deadline question, never "never offer a date"', async () => {
    const { proposals, dispatch } = caps(), c = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { now: () => new Date('2026-10-12T08:52:27Z') });
    const r = await c.proposeGoalDeadline!(ctx('Our deadline is the next sprint.') as never, { deadline_words: 'the next sprint', rationale: '' }) as Rec;
    expect(r).toMatchObject({ ok: false, refusal: 'deadline_not_placed', deadline_ask: chanceGoalDeadlineAsk('next feature launch') });
    // AIE 6122738619, verbatim.
    expect(r.detail).toBe('No deadline change was prepared because the quoted words do not resolve to a calendar date against the recorded reference date. '
      + "Re-read the user's deadline words and recorded reference first. If they still do not identify a date, ask the one question in deadline_ask, "
      + 'then call propose_goal_deadline with their answer. Do not ask them to restate a date already resolved and held.');
    expect(proposals.outstanding(SID, null)).toEqual([]);
  });
});

/** Paul's served turn 13, verbatim; the Agent's quote is a span of it. */
const PAUL_TEAM = "The team are currently telling me they're going to be a month late delivering the next feature (so, 7 months), but I have low confidence in this because they keep missing deadlines.";
const PAUL_HIRING = "What hiring estimate would you give for a tech lead versus two developers? I would think, but I'm not sure, that a tech lead would take at least 3 months to get in the door. With two developers, we might be able to get one in within 2 months and then another a month or so later, as an estimate to use.";

describe('E2 — the team\'s time, bound by quote, from any of the user\'s messages', () => {
  it.each([
    ["they're going to be a month late delivering the next feature (so, 7 months), but I have low confidence", [{ low_months: 7, high_months: 7 }]],
    ['the team say 7 months', [{ low_months: 7, high_months: 7 }]],
    ['It’ll take 6–10 months', [{ low_months: 6, high_months: 10 }]],
    ['we think between 6 and 9 months, honestly', [{ low_months: 6, high_months: 9 }]],
  ])('reads "%s"', (quote, expected) => { expect(teamTimesInQuote(quote)).toEqual(expected); });
  it.each([
    'a tech lead would take at least 3 months to get in the door', 'get one in within 2 months and then another a month or so later',
    "they're going to be a month late", 'deadline in 6 months', '16 months ago we started', 'half a year', '6 developers',
    'recruitment may take over 3 months', 'we have 2 months left',
  ])('CONTROL: "%s" states no team time', quote => { expect(teamTimesInQuote(quote)).toEqual([]); });

  it("Paul's sentence: his 7-month forecast, kept with his words; his low confidence IN THIS forecast gives Olumi's [0.5P, 1.5P] = 3.5–10.5", () => {
    const quote = "they're going to be a month late delivering the next feature (so, 7 months)";
    expect(bindTeamTimeQuote({ now: PAUL_TEAM }, { quote, low_months: 7, high_months: 7 })).toEqual({ kind: 'bound', quote,
      time: { low_months: 3.5, high_months: 10.5, forecast_months: 7, forecast_words: quote, range_origin: 'olumi_estimate', range_rule: 'low_confidence' } });
  });
  it.each([
    ['The team say 7 months.', 'The team say 7 months', 7, { low_months: 5.3, high_months: 8.8, range_rule: 'default' }],
    ['It will take about 13 months, I think.', 'about 13 months', 13, { low_months: 9.8, high_months: 16.3, range_rule: 'default' }],
    ["About 8 months, but I'm not confident in that.", 'About 8 months', 8, { low_months: 4, high_months: 12, range_rule: 'low_confidence' }],
    ['I doubt it, but the team say 8 months.', 'the team say 8 months', 8, { low_months: 4, high_months: 12, range_rule: 'low_confidence' }],
    // CONTROLS: a confidence keyword with no forecast as its object is not confidence attribution (AIE 6122738619).
    ["About 8 months, but I'm not confident.", 'About 8 months', 8, { low_months: 6, high_months: 10, range_rule: 'default' }],
    ['They keep missing deadlines; the team say 8 months.', 'the team say 8 months', 8, { low_months: 6, high_months: 10, range_rule: 'default' }],
    ['We have no doubt: 8 months.', '8 months', 8, { low_months: 6, high_months: 10, range_rule: 'default' }],
    ['I have low confidence in the vendor; the team say 8 months.', 'the team say 8 months', 8, { low_months: 6, high_months: 10, range_rule: 'default' }],
  ])('the one range convention: "%s"', (now, quote, p, expected) => {
    const r = bindTeamTimeQuote({ now }, { quote, low_months: p, high_months: p });
    expect(r).toEqual({ kind: 'bound', quote, time: { ...expected, forecast_months: p, forecast_words: quote, range_origin: 'olumi_estimate' } });
    expect(widenedTeamTime(p, expected.range_rule as 'low_confidence' | 'default')).toEqual({ low_months: expected.low_months, high_months: expected.high_months });
  });
  it('a stated range is written as stated, never widened', () => {
    expect(bindTeamTimeQuote({ now: 'Probably 6 to 9 months' }, { quote: 'Probably 6 to 9 months', low_months: 6, high_months: 9 }))
      .toEqual({ kind: 'bound', quote: 'Probably 6 to 9 months', time: { low_months: 6, high_months: 9 } });
  });
  it('FROM ANY MESSAGE: a chip turn binds the quote to an earlier message; the quote must be the user\'s and hold the figure', () => {
    const conversation = [BRIEF, PAUL_TEAM].join('\n');
    expect(bindTeamTimeQuote({ now: '', conversation }, { quote: '(so, 7 months)', low_months: 7, high_months: 7 }))
      .toMatchObject({ kind: 'bound', time: { low_months: 3.5, high_months: 10.5, forecast_months: 7 } });
    expect(bindTeamTimeQuote({ now: '', conversation }, { quote: 'the team say 7 months', low_months: 7, high_months: 7 }))
      .toMatchObject({ kind: 'refused' });
    expect(bindTeamTimeQuote({ now: '', conversation }, { quote: 'but I have low confidence in this', low_months: 7, high_months: 7 }))
      .toMatchObject({ kind: 'refused' });
    expect(bindTeamTimeQuote({ now: '', conversation }, { quote: '(so, 7 months)', low_months: 6, high_months: 6 }))
      .toMatchObject({ kind: 'refused' });
    // Paul's own hiring sentence is never his team's time, whichever figure is passed.
    for (const p of [2, 3]) expect(bindTeamTimeQuote({ now: PAUL_HIRING }, { quote: PAUL_HIRING, low_months: p, high_months: p })).toMatchObject({ kind: 'refused' });
    // No quote: THIS message, as before.
    expect(bindTeamTimeQuote({ now: '6–10 months' }, { low_months: 6, high_months: 10 })).toMatchObject({ kind: 'bound', time: { low_months: 6, high_months: 10 } });
  });
  // B2, independent check BLOCKING 2 (CHECK.md, 91405cb2): the quote's figure must be the team's time in the statement that
  // ENCLOSES it in the user's message, never only in the substring the Agent selected.
  it('B2 RED→GREEN (the checker\'s repro): "7 months" whose subject is recruitment is never the team\'s forecast', () => {
    const now = 'The team will finish in 9 months; recruitment takes 7 months';
    expect(bindTeamTimeQuote({ now }, { quote: '7 months', low_months: 7, high_months: 7 })).toMatchObject({ kind: 'refused' });
    expect(bindTeamTimeQuote({ now: '', conversation: now }, { quote: '7 months', low_months: 7, high_months: 7 })).toMatchObject({ kind: 'refused' });
    // CONTRAST, same message: the team's own figure binds, with its words.
    expect(bindTeamTimeQuote({ now }, { quote: '9 months', low_months: 9, high_months: 9 }))
      .toMatchObject({ kind: 'bound', quote: '9 months', time: { forecast_months: 9, forecast_words: '9 months', range_origin: 'olumi_estimate' } });
  });
  it.each([
    ['Hiring will take 7 months.', '7 months', 7],
    ['7 months for recruitment, I reckon', '7 months', 7],
    ['The deadline is in 7 months', '7 months', 7],
    ['They are 2 months behind', '2 months', 2],
    ['Notice periods are 3 months; the team say 8 months', '3 months', 3],
  ])('B2 class: "%s" quoted as "%s" is another quantity\'s, so it is refused', (now, quote, p) => {
    expect(bindTeamTimeQuote({ now }, { quote, low_months: p, high_months: p })).toMatchObject({ kind: 'refused' });
  });
  it('B2 class CONTRAST: the team\'s figure in the same message as another quantity still binds', () => {
    expect(bindTeamTimeQuote({ now: 'Notice periods are 3 months; the team say 8 months' }, { quote: '8 months', low_months: 8, high_months: 8 }))
      .toMatchObject({ kind: 'bound', time: { forecast_months: 8 } });
    expect(bindTeamTimeQuote({ now: PAUL_TEAM }, { quote: '7 months', low_months: 7, high_months: 7 }))
      .toMatchObject({ kind: 'bound', time: { forecast_months: 7, range_rule: 'low_confidence' } });
  });
  // AIE 6125204695 (b1), verbatim: the question and explanation, kept apart through the card writer; the human qualifier appended.
  it('the card (AIE 6125204695): Olumi\'s provisional model from the user\'s forecast and an assumed range, the bell-curve note, the qualifier', () => {
    const g = dated(), part = draftedTeamPartOf(g)!;
    const words = "they're going to be a month late delivering the next feature (so, 7 months)";
    const a: ApprovedTeamTime = { goal_id: part.goal.id, team_id: part.team.id, deadline: '2027-04-12', reference_date: '2026-10-12',
      low_months: 3.5, high_months: 10.5, forecast_months: 7, forecast_words: words, range_origin: 'olumi_estimate', range_rule: 'low_confidence' };
    expect(teamTimeCard(a, part.goal.goal_threshold_unit, part.deliverable)).toBe('Use Olumi’s provisional model based on your 7-month forecast and an '
      + 'assumed 3.5–10.5-month range? The calculation uses bell-curve approximations of progress and can include outcomes outside those time bounds. '
      + 'You described low confidence in that forecast.');
    expect(teamTimeCard({ ...a, low_months: 5.3, high_months: 8.8, range_rule: 'default' }, part.goal.goal_threshold_unit, part.deliverable))
      .toBe('Use Olumi’s provisional model based on your 7-month forecast and an assumed 5.3–8.8-month range? The calculation uses bell-curve '
        + 'approximations of progress and can include outcomes outside those time bounds.');
    const written = applyTeamShareEdit(g, a, computeAnalysisAffectingGraphHash(g as never)!);
    if (written.kind !== 'mutated') throw new Error(JSON.stringify(written));
    // The writer's confirmation is the card's explanation, whole (never a split of the joined card).
    expect(written.confirmation).toBe('The calculation uses bell-curve approximations of progress and can include outcomes outside those time bounds. '
      + 'You described low confidence in that forecast.');
    expect(draftedTeamPartOf(written.mutatedGraph)!.team.observed_state.stated_time).toEqual({ quantity: 'months_to_finish', low: 3.5, high: 10.5,
      unit: 'months', deadline: '2027-04-12', reference_date: '2026-10-12', forecast: 7, forecast_origin: 'user', forecast_words: words,
      range_origin: 'olumi_estimate', range_rule: 'low_confidence' });
    expect(shareChanceRunBlock(written.mutatedGraph)).toBeNull();
    expect(resolveRunAdmission(written.mutatedGraph).willProceed).toBe(true);
  });
  it('(b) a single most likely time (a card approved before the rule) never deletes the team part\'s level', () => {
    const g = dated(), part = draftedTeamPartOf(g)!;
    const range: ApprovedTeamTime = { goal_id: part.goal.id, team_id: part.team.id, deadline: '2027-04-12', reference_date: '2026-10-12', low_months: 6, high_months: 9 };
    const first = applyTeamShareEdit(g, range, computeAnalysisAffectingGraphHash(g as never)!);
    if (first.kind !== 'mutated') throw new Error('first');
    const level = draftedTeamPartOf(first.mutatedGraph)!.team.observed_state;
    const single = applyTeamShareEdit(first.mutatedGraph, { ...range, low_months: 7, high_months: 7 }, computeAnalysisAffectingGraphHash(first.mutatedGraph as never)!);
    if (single.kind !== 'mutated') throw new Error('single');
    expect(draftedTeamPartOf(single.mutatedGraph)!.team.observed_state).toEqual(level);
    expect(resolveRunAdmission(single.mutatedGraph).willProceed).toBe(true);
  });
});

describe('E2 — a team-time card is stale only when what it read changed (the one field-scoped precondition)', () => {
  /** The real capabilities over a serialised store and the real batch writer (s-e-goals-s2b's world, trimmed). */
  function world(initial: Rec = dated()) {
    let json = JSON.stringify(initial);
    const graph = (): Rec => JSON.parse(json);
    const rows: { id: string; write: SessionTurnWrite }[] = [];
    const store = createMockSessionStore({
      loadGraph: async () => graph(), loadGraphAndBriefText: async () => ({ graph: graph(), briefText: null }),
      readExistingScenario: async () => ({ userId: null, graph: graph(), briefText: null, analysisInvalidatedAt: null }),
      readMostRecentPendingActions: async () => [], readAnalysisInvalidatedAt: async () => null, getScenarioOwner: async () => null,
      append: async write => { const s = JSON.parse(JSON.stringify(write)) as SessionTurnWrite, id = `ebd-row-${rows.length + 1}`;
        rows.push({ id, write: s }); if (s.graph !== undefined) json = JSON.stringify(s.graph); return { id }; },
      readRecent: async () => rows.map(({ id, write: w }) => makeSessionTurnRow({ id, scenario_id: w.scenario_id, turn_id: w.turn_id,
        turn_class: w.turn_class, handler_id: w.handler_id, request_hash: w.request_hash, response_emitted: w.response_emitted, llm_calls_used: w.llm_calls_used, duration_ms: w.duration_ms })),
      readFactsWithTurnFor: async ids => rows.filter(r => ids.includes(r.id)).flatMap(({ id, write }) =>
        write.handler_facts.map(fact => ({ turn_id: id, fact_created_at: '2026-10-12T09:14:30.000Z', fact }))),
    });
    const commit = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
      const out = await executeOptionInterventionBatch({ scenarioId: SID, turnId: input.turn_id, requestId: 'ebd', requestHash: `ebd:${input.turn_id}`,
        stage: 'frame', freshness: 'fresh', hasExistingAnalysis: false, expectedGraphHash: input.base_graph_hash, targets: [],
        teamTime: input.team_time, goalHorizon: input.goal_horizon }, store);
      if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
      if (out.kind === 'unchanged') return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(graph() as never)!, receipt: null, already_applied: true, committed_levels: [], links_resized: [] };
      if (out.kind !== 'committed') return { status: 'unconfirmed' };
      return { status: 'committed', graph_hash: out.analysisGraphHash, receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
    };
    const dispatch: InternalDispatch = async (path, body) => {
      if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
      if (path.endsWith('/graph/register')) {
        // E5's door (SYS1): the register route's compare-and-set on both hashes, then its identity-preserving ingress.
        const b = body as Rec, now = graph();
        if (b.expected_graph_hash !== computeAnalysisAffectingGraphHash(now as never)
          || b.expected_graph_identity_hash !== computeGraphIdentityHash(now as never)!.value) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
        json = JSON.stringify(assignEntityRefs(projectGraphForPersistence(GraphStateIngressSchema.parse(b.graph) as never), { nodes: [], edges: [] }).graph);
        return { status: 200, json: { registered: true, model_version: { version_number: 3, version_id: 'v-ebd-e5', mutation_id: 'm-ebd-e5' } } };
      }
      if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch ${path}`);
      return { status: 200, json: { graph: graph(), graph_hash: computeAnalysisAffectingGraphHash(graph() as never),
        graph_identity_hash: computeGraphIdentityHash(graph() as never), brief_text: BRIEF } };
    };
    const proposals = new ProposalStore();
    return { graph, rows, proposals, replace: (g: Rec) => { json = JSON.stringify(g); },
      caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels: commit, now: () => new Date('2026-10-12T09:14:24Z') }) };
  }
  const ctx = (text: string): Rec => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'ebd-scope', user_text: text, user_turn_text: text });
  // Recovery Batch B (independent check, BLOCKING 2): the quote-bound E2 reader is removed from B (it moves to B2), so these
  // rows offer a range THIS message states; the field-scoped precondition they test is unchanged.
  const TEAM_RANGE = 'It’ll take 6–10 months';
  /** What SYS1's E5 door writes for one option: its own hiring times on its capacity part (the team part untouched). */
  const hiringTimesLand = (g: Rec): Rec => {
    const out = structuredClone(g);
    const sw = out.nodes.find((n: Rec) => n.id === 'event_capacity_2');
    Object.assign(sw.observed_state.extra_share_by_date, { lead_low: 1, lead_high: 3 });
    out.edges.find((e: Rec) => e.from === 'event_capacity_2' && e.to === 'event_goal').strength.mean += 0.05;
    return out;
  };
  const approve = (w: ReturnType<typeof world>, id: string) => w.caps.authoriseChange({ ...ctx('Yes'), typed_approval_of: id } as never, { proposal_id: id }) as Promise<Rec>;

  it('card offered → hiring times land → team time approved = APPLIED (the whole-model revision moved; what the card read did not)', async () => {
    const w = world();
    const card = await w.caps.proposeTeamTime!(ctx(TEAM_RANGE) as never, { low_months: 6, high_months: 10 }) as Rec;
    expect(card.ok).toBe(true);
    const moved = hiringTimesLand(w.graph());
    expect(computeAnalysisAffectingGraphHash(moved as never)).not.toBe(card.base_revision);
    w.replace(moved);
    expect(await approve(w, card.proposal_id)).toMatchObject({ ok: true, applied: true });
    expect(draftedTeamPartOf(w.graph())!.team.observed_state.stated_time).toMatchObject({ low: 6, high: 10 });
    // The hiring times that landed first are kept: the write is scoped to the team part.
    expect(w.graph().nodes.find((n: Rec) => n.id === 'event_capacity_2').observed_state.extra_share_by_date).toMatchObject({ lead_low: 1, lead_high: 3 });
  });
  it('reverse order: hiring times land → card offered → approved = APPLIED', async () => {
    const w = world(hiringTimesLand(dated()));
    const card = await w.caps.proposeTeamTime!(ctx(TEAM_RANGE) as never, { low_months: 6, high_months: 10 }) as Rec;
    expect(await approve(w, card.proposal_id)).toMatchObject({ ok: true, applied: true });
  });
  it.each([
    ['the team part\'s own time changed', (g: Rec): Rec => { const out = structuredClone(g); const t = draftedTeamPartOf(out)!.team;
      out.nodes.find((n: Rec) => n.id === t.id).observed_state = { value: 0.5, std: 0.1, raw_value: 50, unit: t.observed_state?.unit ?? '% of next feature launch', cap: 100, source: 'cee_inference',
        stated_time: { quantity: 'months_to_finish', low: 5, high: 8, unit: 'months', deadline: '2027-04-12', reference_date: '2026-10-12' } }; return out; }],
    ['the deadline changed', (g: Rec): Rec => { const out = structuredClone(g); out.nodes.find((n: Rec) => n.kind === 'goal').goal_horizon = { deadline: '2027-05-12' }; return out; }],
  ])('CONTROL: %s → refused as superseded, nothing written', async (_name, change) => {
    const w = world();
    const card = await w.caps.proposeTeamTime!(ctx(TEAM_RANGE) as never, { low_months: 6, high_months: 10 }) as Rec;
    const changed = change(w.graph()); w.replace(changed);
    expect(await approve(w, card.proposal_id)).toMatchObject({ ok: false, refusal: 'superseded' });
    expect(w.rows).toHaveLength(0);
    expect(w.graph()).toEqual(changed);
  });
  // ⛔ EXPECTATION CHANGED (#3024, DL 14 Oct ruling (A)): the deadline card now has its own field-scoped read (its goal's
  // complete projection), so an unrelated model change no longer makes it stale; a change to its goal still does.
  it('CONTROL: the deadline card reads its own subject: hiring times landing leaves it applying; a changed goal supersedes it', async () => {
    const w = world(drafted());
    const card = await w.caps.proposeGoalDeadline!(ctx('Our launch deadline is in six months time.') as never, { deadline_words: 'in six months time', rationale: '' }) as Rec;
    expect(card.ok).toBe(true);
    w.replace(hiringTimesLand(w.graph()));
    expect(await approve(w, card.proposal_id)).toMatchObject({ ok: true, mutated: true });
    const w2 = world(drafted());
    const card2 = await w2.caps.proposeGoalDeadline!(ctx('Our launch deadline is in six months time.') as never, { deadline_words: 'in six months time', rationale: '' }) as Rec;
    const moved = hiringTimesLand(w2.graph()); moved.nodes.find((n: Rec) => n.kind === 'goal').goal_threshold_raw = 90; w2.replace(moved);
    expect(await approve(w2, card2.proposal_id)).toMatchObject({ ok: false, refusal: 'superseded' });
    expect(w2.rows).toHaveLength(0);
  });
  it('the write stays CAS-fenced: the writer refuses an expected hash the model has moved past', () => {
    const g = dated(), part = draftedTeamPartOf(g)!;
    const a: ApprovedTeamTime = { goal_id: part.goal.id, team_id: part.team.id, deadline: '2027-04-12', reference_date: '2026-10-12', low_months: 6, high_months: 9 };
    expect(applyTeamShareEdit(hiringTimesLand(g), a, computeAnalysisAffectingGraphHash(g as never)!)).toEqual({ kind: 'refused', reason: 'stale_graph' });
  });
  // E5 combine (DL, 12 Oct): SYS1's hiring-times card is field-scoped the same way (`hiringTimesStillApply`).
  const PAUL_HIRING = "I would think, but I'm not sure, that a tech lead would take at least 3 months to get in the door. With two developers, we might be able to get one in within 2 months and then another a month or so later, as an estimate to use.";
  const HIRING_ARGS = { options: [
    { option_id: 'event_option_1', starts: [{ quote: 'at least 3 months' }] },
    { option_id: 'event_option_2', starts: [{ quote: 'within 2 months' }, { quote: 'another a month or so later' }] },
  ] };
  it('E5 combine: hiring-times card offered → team time lands → hiring card pressed = APPLIED, and both are held', async () => {
    const w = world();
    const hiring = await w.caps.proposeHiringTimes!(ctx(PAUL_HIRING) as never, HIRING_ARGS as never) as Rec;
    expect(hiring.ok).toBe(true);
    const team = await w.caps.proposeTeamTime!(ctx(TEAM_RANGE) as never, { low_months: 6, high_months: 10 }) as Rec;
    expect(await approve(w, team.proposal_id)).toMatchObject({ ok: true, applied: true });
    expect(computeAnalysisAffectingGraphHash(w.graph() as never)).not.toBe(hiring.base_revision);
    expect(await approve(w, hiring.proposal_id)).toMatchObject({ ok: true, applied: true, mutated: true });
    expect(draftedTeamPartOf(w.graph())!.team.observed_state.stated_time).toMatchObject({ low: 6, high: 10 });
    const devs = sharePartsForOption(w.graph(), 'event_option_2')!;
    expect([devs.extra, ...(devs.furtherExtras ?? [])]).toHaveLength(2);
    // ONE label, both attributions: EBD's assumed team range, then the user's hiring statement and every Olumi assumption.
    // The team's 6–10 months is the user's own range here, so no team-time assumption of Olumi's is attributed.
    expect(shareOptionEstimateWords(w.graph(), 'event_option_1')).toBe('using your hiring time (“at least 3 months”) as modelled: 3–4 months, with Olumi’s estimate of the latest start (4 months), '
      + 'and Olumi’s estimate of the additional progress from the hires (12% of next feature launch per month)');
  });
  it('CONTROL (E5 combine): a hiring-times card whose own carriers changed is still refused as superseded, nothing written', async () => {
    const w = world();
    const hiring = await w.caps.proposeHiringTimes!(ctx(PAUL_HIRING) as never, HIRING_ARGS as never) as Rec;
    expect(hiring.ok).toBe(true);
    const changed = hiringTimesLand(w.graph()); w.replace(changed);
    expect(await approve(w, hiring.proposal_id)).toMatchObject({ ok: false, refusal: 'superseded' });
    expect(w.graph()).toEqual(changed);
  });

  /**
   * ⭐ B2-c CONFIRMATION (DL re-scope, 12 Oct, after the third free-text attribution failure; PL #94 6131809231; AIE #94
   * 6132054663): a duration the user did not type as this whole answer is ONLY a confirmation card — the quote proved verbatim
   * in their own words, the complete source line on the card, and only the press records it as their selected forecast.
   */
  const PAUL_QUOTE = "they're going to be a month late delivering the next feature (so, 7 months)";
  const earlier = (said: string): Rec => ({ ...ctx('Here is what I know.'), user_text: [said, 'Here is what I know.'].join('\n') });
  const noPress = (w: ReturnType<typeof world>, id: string, other?: string) =>
    w.caps.authoriseChange({ ...ctx('Yes'), ...(other !== undefined ? { typed_approval_of: other } : {}) } as never, { proposal_id: id }) as Promise<Rec>;
  it('B2-c RED→GREEN: Paul\'s earlier sentence is a confirmation card (refused at E), worded by the AIE; nothing is his until the press', async () => {
    const w = world();
    const before = JSON.stringify(w.graph());
    const card = await w.caps.proposeTeamTime!(earlier(PAUL_TEAM) as never, { quote: PAUL_QUOTE, low_months: 7, high_months: 7 }) as Rec;
    expect(card.ok).toBe(true);
    expect(card.public_label).toBe(`From your message: ‘${PAUL_TEAM}’ Do you want to use 7 months as your forecast for today's team to finish next feature launch? `
      + 'Olumi’s assumed 3.5–10.5-month range informs this approximate calculation; modelled outcomes can fall outside those time bounds. '
      + 'You described low confidence in that forecast.');
    expect(card.public_label).not.toMatch(/your 7-month forecast|your team forecast/);
    expect(card.team_time).toMatchObject({ forecast_months: 7, low_months: 3.5, high_months: 10.5, range_origin: 'olumi_estimate', range_rule: 'low_confidence',
      confirmation: { source: PAUL_TEAM, quote: PAUL_QUOTE } });
    // No press: refused, nothing written — the Agent's authorise, and a press of ANOTHER card.
    expect(await noPress(w, card.proposal_id)).toMatchObject({ ok: false, mutated: false, refusal: 'approval_required' });
    expect(await noPress(w, card.proposal_id, 'prop_00000000000000000000000000000000')).toMatchObject({ ok: false, mutated: false, refusal: 'approval_required' });
    expect(JSON.stringify(w.graph())).toBe(before);
    expect(w.rows).toHaveLength(0);
    // The press: a NEW selected forecast, linked to his source line and to Olumi's reading of it; the source is unchanged.
    expect(await approve(w, card.proposal_id)).toMatchObject({ ok: true, applied: true });
    expect(draftedTeamPartOf(w.graph())!.team.observed_state.stated_time).toEqual({ quantity: 'months_to_finish', low: 3.5, high: 10.5, unit: 'months',
      deadline: '2027-04-12', reference_date: '2026-10-12', forecast: 7, forecast_origin: 'user_confirmed', forecast_words: PAUL_QUOTE,
      range_origin: 'olumi_estimate', range_rule: 'low_confidence', selection: { by: 'user_press', interpretation: 'olumi', source: PAUL_TEAM, quote: PAUL_QUOTE } });
  });
  /**
   * ⭐ AI-first Lane 1, the deadline Run (DL 12 Oct, PLAN-AI-FIRST-SUBTRACT; run 5, `recovery/sys2/evidence/run5-deadline-stall.md`):
   * Paul's exact turn-13 sentence, said THIS turn, was refused `team_time_not_stated` and the Run stayed closed on the team part's
   * level. Now the Agent's reading is the card, his press is the check, and the Run admits on the level that press wrote.
   */
  it('Lane 1 deadline Run: Paul\'s turn-13 sentence → the card (his whole line, his low confidence) → his press → the team part has a level → the Run admits', async () => {
    const w = world();
    const team = draftedTeamPartOf(w.graph())!.team.id;
    // Before: the team part's own level gap closes the Run (the blocker stays the model's real gap until the press).
    expect(resolveRunAdmission(w.graph()).willProceed).toBe(false);
    expect(resolveRunAdmission(w.graph()).assessment.blockingIssues.map(i => [i.code, i.factor_id])).toContainEqual(['MISSING_FACTOR_LEVEL', team]);
    const card = await w.caps.proposeTeamTime!(ctx(PAUL_TEAM) as never, { quote: PAUL_QUOTE, low_months: 7, high_months: 7 }) as Rec;
    expect(card).toMatchObject({ ok: true, team_time: { forecast_months: 7, low_months: 3.5, high_months: 10.5, range_rule: 'low_confidence',
      confirmation: { source: PAUL_TEAM, quote: PAUL_QUOTE } } });
    expect(String(card.public_label).startsWith(`From your message: ‘${PAUL_TEAM}’ Do you want to use 7 months as your forecast`)).toBe(true);
    expect(resolveRunAdmission(w.graph()).willProceed, 'nothing opens the Run before the press').toBe(false);
    expect(await approve(w, card.proposal_id)).toMatchObject({ ok: true, applied: true });
    const g = w.graph();
    expect(Number.isFinite(draftedTeamPartOf(g)!.team.observed_state.value)).toBe(true);
    expect(resolveRunAdmission(g).willProceed).toBe(true);
    expect((buildCanonicalAnalysisReadyFromGraph(g) as Rec).may_run).toBe(true);
  });
  it('Lane 1: a range in the words is the full-range card (never a midpoint); a bound is the Agent\'s reading ON the card, its words kept, never refused', async () => {
    const w = world();
    const range = await w.caps.proposeTeamTime!(earlier('The team say it will take 6–9 months, honestly.') as never, { quote: '6–9 months', low_months: 6, high_months: 9 }) as Rec;
    expect(range.public_label).toMatch(/^From your message: ‘The team say it will take 6–9 months, honestly\.’ Use 6–9 months for today's team\? By 12 April 2027 that is about \d+% of next feature launch\.$/);
    expect(range.team_time).not.toHaveProperty('forecast_months');
    for (const [said, q] of [['It’ll take at least 7 months.', '7 months'], ['The team need no more than 8 months.', '8 months'], ['Within 9 months, I think.', '9 months']] as const) {
      const n = Number(q[0]);
      const card = await w.caps.proposeTeamTime!(earlier(said) as never, { quote: q, low_months: n, high_months: n }) as Rec;
      expect(card.ok, said).toBe(true);
      expect(String(card.public_label).startsWith(`From your message: ‘${said}’ Do you want to use ${n} months as your forecast`), said).toBe(true);
    }
  });
  it('Lane 1 confidence: an unmatched Agent quote cannot claim the user described low confidence', async () => {
    const w = world(), before = JSON.stringify(w.graph());
    const card = await w.caps.proposeTeamTime!(ctx('Recruitment is slow.') as never,
      { quote: '7 months, but I have low confidence in this', low_months: 7, high_months: 7 }) as Rec;
    expect(card.ok).toBe(true);
    expect.soft(card.public_label).not.toMatch(/confidence/i);
    expect.soft(card.team_time).toMatchObject({ forecast_months: 7, range_rule: 'default', confirmation: { source: '' } });
    expect(card.public_label).not.toContain('From your message');
    expect(JSON.stringify(w.graph())).toBe(before);
  });
  it('Lane 1 provenance: words the user did not type get NO quote line; a figure the quote does not state is still only the Agent\'s card; malformed arguments are refused', async () => {
    for (const [said, q, n, line] of [['The team say 7 months.', 'the team say 8 months', 8, false], ['The team say 7 months.', 'The team say 7 months', 8, true],
      ['Recruitment is slow.', '7 months', 7, false]] as const) {
      const w = world(), before = JSON.stringify(w.graph());
      const card = await w.caps.proposeTeamTime!(earlier(said) as never, { quote: q, low_months: n, high_months: n }) as Rec;
      expect(card.ok, `${said} | ${q}`).toBe(true);
      expect(String(card.public_label).startsWith(line ? `From your message: ‘${said}’ Do you want to use ${n} months` : `Do you want to use ${n} months`), `${said} | ${q}`).toBe(true);
      expect(w.proposals.get(String(card.proposal_id))?.provenance, `${said} | ${q}`).toMatchObject({ authored_by: 'model_proposed', basis: line ? said : q });
      expect(await noPress(w, card.proposal_id)).toMatchObject({ ok: false, mutated: false, refusal: 'approval_required' });
      expect(JSON.stringify(w.graph())).toBe(before);
    }
    for (const args of [{ quote: '7 months', low_months: 0, high_months: 7 }, { quote: '7 months', low_months: 9, high_months: 7 }, { quote: '7 months', low_months: 'seven', high_months: 7 }]) {
      expect(await world().caps.proposeTeamTime!(earlier('The team say 7 months.') as never, args as never), JSON.stringify(args))
        .toMatchObject({ ok: false, mutated: false, refusal: 'team_time_not_stated' });
    }
  });
  /**
   * ⭐ B2-c PROPERTY — ONE generative test over the whole input class (DL, 12 Oct: as the share exit sweep, never instance rows).
   * Every sentence (the check's five misbinds, other subjects, negation, condition, history, Paul's own, ranges, bounds) × where
   * it was said (this turn, earlier) × the quote the Agent gives (verbatim, fabricated, a figure the quote does not state) ×
   * every adoption path (the Agent's reading of a typed yes, ANOTHER card's press, the same words sent again, the card's OWN
   * press). Judged against the corpus's hand-written class, never against what the capability computed:
   *   Q1 a figure is recorded as chosen by the user ONLY by the press on its own card (`user_confirmed` + the selection);
   *   Q2 a typed yes, another card's press, or the same words sent again write nothing (the same words prepare the same card);
   *   Q3 the card shows the complete most recent source line, verbatim, ONLY where the quote is the user's words (AI-first Lane 1:
   *      no reader refuses the Agent's reading; words they did not type get no quote line), never "your forecast" before the press;
   *   Q4 a range never becomes a point;
   *   Q5 the press links the selection to its source and quote; the proposal stays Olumi's reading (`model_proposed`).
   */
  type Said = { readonly said: string; readonly quote: string; readonly low: number; readonly high: number;
    readonly kind: 'point' | 'range' | 'bound' | 'mismatch' | 'unquoted' };
  const point = (said: string, quote = '7 months'): Said => ({ said, quote, low: 7, high: 7, kind: 'point' });
  const CORPUS: readonly Said[] = [
    ...['Recruitment, the team think, will take 7 months.', 'Procurement (the team say) takes [7 months].',
      'I do not believe the team will finish in 7 months.', 'If we hire a contractor, the team will finish in 7 months.',
      'Last project, the team said 7 months.', 'The team are late (7 months).', '7 months? I am sure it is not.',
      'The team will finish in 9 months; recruitment takes (7 months)', 'procurement takes 7 months',
      ...['Hiring', 'Onboarding', 'The notice period', 'Legal review', 'The vendor', 'Security sign-off'].map((x) => `${x} takes 7 months.`),
    ].map((said) => point(said)),
    point(PAUL_TEAM), point(PAUL_TEAM, PAUL_QUOTE),
    { said: 'The team say it will take 6–9 months, honestly.', quote: '6–9 months', low: 6, high: 9, kind: 'range' },
    { said: 'Our lead reckons 5 to 8 months for this.', quote: '5 to 8 months', low: 5, high: 8, kind: 'range' },
    ...['It’ll take at least 7 months.', 'The team need no more than 7 months.', 'Within 7 months, I think.', 'Up to 7 months, they say.',
      'More than 7 months, realistically.'].map((said): Said => ({ ...point(said), kind: 'bound' })),
    { said: 'The team say 7 months.', quote: 'the team say 8 months', low: 8, high: 8, kind: 'unquoted' },
    { said: 'The team say 7 months.', quote: 'The team say 7 months', low: 8, high: 8, kind: 'mismatch' },
    { said: 'Recruitment is slow.', quote: '7 months', low: 7, high: 7, kind: 'unquoted' },
  ];
  const PATHS = ['typed yes', 'another card', 'same words again', 'own press'] as const;
  const statedTime = (w: ReturnType<typeof world>): Rec | undefined => draftedTeamPartOf(w.graph())?.team.observed_state?.stated_time as Rec | undefined;
  it('B2-c PROPERTY: a figure from the user\'s words is theirs ONLY by the press on its own card, whatever the sentence, the quote or the path', async () => {
    let cards = 0, presses = 0;
    for (const s of CORPUS) for (const where of ['now', 'earlier'] as const) for (const path of PATHS) {
      const w = world();
      const before = JSON.stringify(w.graph());
      const c = where === 'now' ? ctx(s.said) : earlier(s.said);
      const args = { quote: s.quote, low_months: s.low, high_months: s.high };
      const card = await w.caps.proposeTeamTime!(c as never, args) as Rec;
      const label = `${s.kind} | ${where} | ${path} | ${s.said} | ${s.quote}`;
      const typed = s.kind !== 'unquoted';                       // the quote stands verbatim in the user's own words
      expect(card.ok, label).toBe(true);
      cards += 1;
      if (typed) expect(String(card.public_label).startsWith(`From your message: ‘${s.said.trim()}’ `), label).toBe(true);   // Q3
      else expect(card.public_label, label).not.toContain('From your message');
      expect(card.public_label, label).not.toMatch(/your \d+(?:–\d+)?-month forecast|your team forecast/);
      expect(w.proposals.get(String(card.proposal_id))?.provenance, label).toMatchObject({ authored_by: 'model_proposed', basis: typed ? s.said.trim() : s.quote }); // Q5
      if (s.kind === 'range') expect(card.team_time, label).not.toHaveProperty('forecast_months');            // Q4
      if (path === 'typed yes') expect(await noPress(w, String(card.proposal_id)), label).toMatchObject({ ok: false, mutated: false, refusal: 'approval_required' });
      if (path === 'another card') expect(await noPress(w, String(card.proposal_id), 'prop_00000000000000000000000000000000'), label)
        .toMatchObject({ ok: false, mutated: false, refusal: 'approval_required' });
      if (path === 'same words again') {
        // Q2: the same words again prepare the SAME card (ids are content-addressed), never a second way to adopt it.
        const again = await w.caps.proposeTeamTime!(c as never, args) as Rec;
        expect(again, label).toMatchObject({ ok: true, proposal_id: card.proposal_id });
      }
      if (path !== 'own press') {                                                                               // Q2
        expect(JSON.stringify(w.graph()), label).toBe(before);
        expect(w.rows, label).toHaveLength(0);
        continue;
      }
      expect(await approve(w, String(card.proposal_id)), label).toMatchObject({ ok: true, applied: true });    // Q1
      presses += 1;
      const time = statedTime(w)!;
      expect(time.selection, label).toEqual({ by: 'user_press', interpretation: 'olumi', source: typed ? s.said.trim() : '', quote: s.quote }); // Q5
      if (s.low === s.high) expect(time, label).toMatchObject({ forecast: s.low, forecast_origin: 'user_confirmed', forecast_words: s.quote });
      else expect(time, label).not.toHaveProperty('forecast');
      expect(time.forecast_origin, label).not.toBe('user');
    }
    // Non-vacuity: every sentence, in both places, reached a card (no reader refuses the Agent's reading); every own press applied.
    expect(cards).toBe(CORPUS.length * 2 * PATHS.length);
    expect(presses).toBe(CORPUS.length * 2);
    expect(new Set(CORPUS.map((s) => s.kind))).toEqual(new Set(['point', 'range', 'bound', 'mismatch', 'unquoted']));
  });

  /**
   * ⭐ S2 (RCA-PAUL-TEST-1617Z Symptom 2; AIE #94 6173489813): Paul's own two messages, c1494f4d 14 Oct 16:25–16:27Z. "At least
   * 7 months", then "8 months" when Olumi asked for the likely upper end. Before: each was a single forecast with Olumi's range
   * (6–10 for "8 months", below his minimum), both cards were withdrawn, nothing was saved and the Run stayed closed.
   */
  const PAUL_LOWER = 'At least 7 months', PAUL_UPPER = '8 months';
  const paulTurn = (): Rec => ({ ...ctx(PAUL_UPPER), user_text: [PAUL_LOWER, PAUL_UPPER].join('\n') });
  const PAUL_STATEMENTS = [{ quote: PAUL_LOWER, form: 'lower_bound', value: 7 }, { quote: PAUL_UPPER, form: 'upper_bound', value: 8, qualifier: 'likely' }];
  it('S2 RED→GREEN: Paul\'s "At least 7 months" + "8 months" (likely upper end) → ONE card quoting both → his press → the Run admits; 7 stays his floor, 8 is never a point or a cap', async () => {
    const w = world();
    const before = JSON.stringify(w.graph());
    const card = await w.caps.proposeTeamTime!(paulTurn() as never, { statements: PAUL_STATEMENTS }) as Rec;
    expect(card.ok).toBe(true);
    expect(card.public_label).toBe(`From your messages: ‘${PAUL_LOWER}’ and ‘${PAUL_UPPER}’ Do you want to use Olumi’s provisional model for today's team to finish `
      + 'next feature launch, based on your lower end of 7 months and your likely upper end of 8 months? A likely end is not a hard limit, so Olumi assumes a '
      + '7–8.25-month range from your words. It informs this approximate calculation; modelled outcomes can fall outside those time bounds.');
    // Never a point of 8, never Olumi's 6–10: his floor is the range's low end, and his likely upper end is not its cap.
    expect(card.team_time).toMatchObject({ low_months: 7, high_months: 8.25, range_origin: 'olumi_estimate', range_rule: 'likely_end' });
    expect(card.team_time).not.toHaveProperty('forecast_months');
    expect((card.team_time as Rec).statements.map((x: Rec) => [x.quote, x.form, x.low, x.high, x.qualifier, x.qualifier_in_quote, x.speaker, x.reading]))
      .toEqual([[PAUL_LOWER, 'lower_bound', 7, undefined, undefined, undefined, 'user', 'olumi'], [PAUL_UPPER, 'upper_bound', undefined, 8, 'likely', false, 'user', 'olumi']]);
    expect(resolveRunAdmission(w.graph()).willProceed, 'nothing opens the Run before the press').toBe(false);
    expect(await noPress(w, card.proposal_id)).toMatchObject({ ok: false, mutated: false, refusal: 'approval_required' });
    expect(JSON.stringify(w.graph())).toBe(before);
    expect(await approve(w, card.proposal_id)).toMatchObject({ ok: true, applied: true });
    const g = w.graph();
    const time = draftedTeamPartOf(g)!.team.observed_state.stated_time;
    expect(time).toMatchObject({ quantity: 'months_to_finish', low: 7, high: 8.25, range_origin: 'olumi_estimate', range_rule: 'likely_end',
      selection: { by: 'user_press', interpretation: 'olumi', source: `${PAUL_LOWER}\n${PAUL_UPPER}`, quote: `${PAUL_LOWER}\n${PAUL_UPPER}` } });
    expect(time.statements.map((x: Rec) => [x.quote, x.form, x.subject])).toEqual([[PAUL_LOWER, 'lower_bound', { quantity: 'months_to_finish', node_id: draftedTeamPartOf(g)!.team.id }],
      [PAUL_UPPER, 'upper_bound', { quantity: 'months_to_finish', node_id: draftedTeamPartOf(g)!.team.id }]]);
    // Approval never makes Olumi's assumed range the user's.
    expect(time).not.toHaveProperty('forecast_origin');
    expect(resolveRunAdmission(g).willProceed).toBe(true);
    expect((buildCanonicalAnalysisReadyFromGraph(g) as Rec).may_run).toBe(true);
  });
  it('S2: a lone bound prepares nothing and asks ONLY for the other end; two hard ends are his own range; disagreeing ends ask which holds', async () => {
    const w = world(), before = JSON.stringify(w.graph());
    const lone = await w.caps.proposeTeamTime!({ ...ctx(PAUL_LOWER) } as never, { statements: [PAUL_STATEMENTS[0]] }) as Rec;
    expect(lone).toMatchObject({ ok: false, mutated: false, refusal: 'team_time_needs_other_end' });
    expect(lone.detail).toContain('the latest time today\'s team could take');
    expect(lone.detail).toContain(`without asking them to repeat the 7 months`);
    // Two hard ends, from two messages: his range as given, no assumed end, no Olumi range.
    const hard = await w.caps.proposeTeamTime!({ ...ctx('No more than 9 months.'), user_text: [PAUL_LOWER, 'No more than 9 months.'].join('\n') } as never,
      { statements: [PAUL_STATEMENTS[0], { quote: 'No more than 9 months.', form: 'upper_bound', value: 9 }] }) as Rec;
    expect(hard.ok).toBe(true);
    expect(hard.team_time).toMatchObject({ low_months: 7, high_months: 9 });
    expect(hard.team_time).not.toHaveProperty('range_origin');
    expect(hard.public_label).toBe(`From your messages: ‘${PAUL_LOWER}’ and ‘No more than 9 months.’ Do you want to use 7–9 months for today's team to finish next feature launch, `
      + 'from your lower end of 7 months and your upper end of 9 months? The calculation uses bell-curve approximations of progress and can include outcomes outside those time bounds.');
    const clash = await w.caps.proposeTeamTime!({ ...ctx('8 months'), user_text: ['At least 9 months', '8 months'].join('\n') } as never,
      { statements: [{ quote: 'At least 9 months', form: 'lower_bound', value: 9 }, { quote: '8 months', form: 'upper_bound', value: 8 }] }) as Rec;
    expect(clash).toMatchObject({ ok: false, mutated: false, refusal: 'team_time_statements_conflict' });
    expect(JSON.stringify(w.graph())).toBe(before);
    expect(w.rows).toHaveLength(0);
  });
  it('S2 provenance: a quote must be a WHOLE statement of a verified message (T2A5); retained unverified words are unknown origin; the figure must be in the quote', async () => {
    const w = world(), before = JSON.stringify(w.graph());
    // "7 months" drops his "At least": not his whole statement, so it can never become a point.
    const part = await w.caps.proposeTeamTime!(paulTurn() as never, { statements: [{ quote: '7 months', form: 'point', value: 7 }, PAUL_STATEMENTS[1]] }) as Rec;
    expect(part).toMatchObject({ ok: false, mutated: false, refusal: 'team_time_not_stated' });
    const unverified = await w.caps.proposeTeamTime!({ ...ctx(PAUL_UPPER), user_text: PAUL_UPPER, unverified_user_text: PAUL_LOWER } as never, { statements: PAUL_STATEMENTS }) as Rec;
    expect(unverified).toMatchObject({ ok: false, mutated: false, refusal: 'origin_unknown' });
    const notInQuote = await w.caps.proposeTeamTime!(paulTurn() as never, { statements: [PAUL_STATEMENTS[0], { ...PAUL_STATEMENTS[1], value: 9 }] }) as Rec;
    expect(notInQuote).toMatchObject({ ok: false, mutated: false, refusal: 'team_time_not_stated' });
    expect(JSON.stringify(w.graph())).toBe(before);
    // Contrast: the same words, correctly quoted, reach the card.
    expect(await w.caps.proposeTeamTime!(paulTurn() as never, { statements: PAUL_STATEMENTS })).toMatchObject({ ok: true });
  });
});

describe('E2 — a range line never calls Olumi\'s range "yours" (AIE 6122738619 words)', () => {
  const words = "they're going to be a month late delivering the next feature (so, 7 months)";
  const held = (): Rec => {
    const g = dated(), part = draftedTeamPartOf(g)!;
    Object.assign(g.nodes.find((n: Rec) => n.id === part.goal.id), { goal_horizon_months: 6, goal_horizon_reference_date: '2026-10-12', goal_horizon_stated_months: 6 });
    const written = applyTeamShareEdit(g, { goal_id: part.goal.id, team_id: part.team.id, deadline: '2027-04-12', reference_date: '2026-10-12',
      low_months: 3.5, high_months: 10.5, forecast_months: 7, forecast_words: words, range_origin: 'olumi_estimate', range_rule: 'low_confidence' },
      computeAnalysisAffectingGraphHash(g as never)!);
    if (written.kind !== 'mutated') throw new Error('write');
    return written.mutatedGraph;
  };
  // A stored stated-time range record (a Run before AIE 6125204695; new Runs make none) still reads with the AIE's note.
  it('RANGE line (stored record): the AIE 6125204695 timing-range note, never "your" range', () => {
    const g = held(), team = draftedTeamPartOf(g)!.team.id;
    const target = { comparator: 'at_least', value: 100, unit: '% of next feature launch', by_date: '2027-04-12' };
    const range = { inference_warnings: [{ code: 'GOAL_CHANCE_RANGE', severity: 'info', message: 'Stated time.', option_ids: ['event_option_3'], target,
      range_by_option: { event_option_3: { kind: 'stated_time', basis: 'stated_time', quantity: 'months_to_finish',
        stated_estimate: { low: 3.5, high: 10.5, unit: 'months' }, low: 0.2, high: 0.6, low_pct: 20, high_pct: 60,
        low_rounding: 'whole', high_rounding: 'whole', from: team, to: 'event_goal', among: 'all' } } }] };
    const line = goalChanceScreenLinesForAgent(range, g, true).find(l => l.option_id === 'event_option_3')!.chance;
    expect(line).toBe('‘Carry on as now’: between about 20% and 60% chance of launching by 12 April 2027, in this model, from the slow end of the range '
      + 'to the fast end. You gave 7 months. Olumi’s assumed 3.5–10.5-month range informs this approximate calculation; '
      + 'modelled outcomes can fall outside those time bounds.');
    expect(line).not.toMatch(/your 3\.5|your 7 months|most likely/);
  });
  // The Run's own range warnings use the same words; a range the user stated keeps its words (control).
  const gated0 = (g: Rec): Rec => withShareByDateChanceGate({ option_comparison: [
    { option_id: 'event_option_1', probability_of_goal: 0.5 }, { option_id: 'event_option_2', probability_of_goal: 0.5 },
    { option_id: 'event_option_3', probability_of_goal: 0.5 }] }, g, draftedTeamPartOf(g)!.goal.id) as Rec;
  const said = (ws: Rec[]): string[] => ws.filter(w => w.code === 'GOAL_CHANCE_RANGE' || /^Not shown as a single figure/.test(String(w.message))).map(w => String(w.message));
  const teamAt = (t: Partial<ApprovedTeamTime> & { low_months: number; high_months: number }): Rec => {
    const g = dated(), part = draftedTeamPartOf(g)!;
    const written = applyTeamShareEdit(g, { goal_id: part.goal.id, team_id: part.team.id, deadline: '2027-04-12', reference_date: '2026-10-12', ...t },
      computeAnalysisAffectingGraphHash(g as never)!);
    if (written.kind !== 'mutated') throw new Error('write');
    return written.mutatedGraph;
  };
  // ⭐ AIE 6125204695 (b1): no old-law slow-to-fast range is made for a deadline chance; each option gets the Run's own point,
  // and the input time range Olumi assumed is said once, as a note (never a probability interval).
  it('AIE b1: no range warnings; each option gets the Run’s point and the assumed-range note is said once (P = 6, low confidence: 3–9)', () => {
    expect(widenedTeamTime(6, 'low_confidence')).toEqual({ low_months: 3, high_months: 9 });
    const g = teamAt({ low_months: 3, high_months: 9, forecast_months: 6, range_origin: 'olumi_estimate', range_rule: 'low_confidence' });
    const out = gated0(g);
    expect(said(out.inference_warnings ?? [])).toEqual([]);
    const licence = goalChanceLicenceOf(out, g, draftedTeamPartOf(g)!.goal.id)!;
    expect(licence.pct_by_option).toEqual({ event_option_1: 50, event_option_2: 50, event_option_3: 50 });
    expect(licence.notes).toEqual(['You gave 6 months. Olumi’s assumed 3–9-month range informs this approximate calculation; '
      + 'modelled outcomes can fall outside those time bounds.']);
    for (const m of [...said(out.inference_warnings ?? []), ...(licence.notes ?? [])]) {
      expect(m).not.toMatch(/your time estimate|stated time or pace range|your 3–9|is not shown|equally likely|slow end|most runs/);
    }
  });
  it('CONTROL: the same range stated by the user (3–9 months): points, no range, and no Olumi assumed-range note', () => {
    const g = teamAt({ low_months: 3, high_months: 9 });
    const out = gated0(g);
    expect(said(out.inference_warnings ?? [])).toEqual([]);
    const licence = goalChanceLicenceOf(out, g, draftedTeamPartOf(g)!.goal.id)!;
    expect(licence.pct_by_option).toEqual({ event_option_1: 50, event_option_2: 50, event_option_3: 50 });
    expect(JSON.stringify(licence)).not.toContain('Olumi’s assumed');
  });
});

describe('E4 — what the deadline model set aside from the brief is named, once', () => {
  const B3 = 'Should we hire two senior engineers or four junior engineers to ship the new platform by Q3, while keeping annual salary spend under £400k?';
  const b3 = (): CandidateModel => ({ ...candidate(), goal: { ...candidate().goal, deliverable: 'the new platform', metric: 'Platform completion', unit: '%' },
    options: [
      { label: 'Current team', provenance: 'ai_proposed', is_status_quo: true, changes: [], interventions: [], added_capacity: null },
      { label: 'Hire two senior engineers', provenance: 'explicit', changes: [], interventions: [{ factor_label: 'Senior engineers hired', value: 2, unit: 'engineers', provenance: 'explicit', stated_evidence: null }], added_capacity: { monthly_share_pct: 12, lead_months_low: 2, lead_months_high: 4 } },
      { label: 'Hire four junior engineers', provenance: 'explicit', changes: [], interventions: [{ factor_label: 'Junior engineers hired', value: 4, unit: 'engineers', provenance: 'explicit', stated_evidence: null }], added_capacity: { monthly_share_pct: 10, lead_months_low: 3, lead_months_high: 5 } },
    ],
    factors: [
      { label: 'Senior engineers hired', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'engineers', provenance: 'inferred', plausible_max: 10 },
      { label: 'Junior engineers hired', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'engineers', provenance: 'inferred', plausible_max: 20 },
    ] });
  const flagged = (c: CandidateModel, brief: string) => admitCandidateModel(c, {}, brief, undefined, undefined, undefined, undefined, undefined, { event_by_date_prompted: true });
  it('the brief\'s own factors kept as context ("remain") and its unmodelled figure (the real limit: not held), in one disclosure', () => {
    expect(eventSetAsideLine(flagged(b3(), B3))).toBe('This forecast does not yet use "Senior engineers hired" and "Junior engineers hired" from your brief; they remain as context for the wider productivity question. '
      + 'This forecast does not yet use "£400k" from your brief, and the model does not hold it.');
  });
  it('CONTROL: Paul\'s drafted event model set nothing aside: no sentence', () => {
    expect(eventSetAsideLine(flagged(candidate(), BRIEF))).toBeNull();
  });
  it('the build owes it once as a construction disclosure (the reply\'s detail), never as an open question', async () => {
    const call: CallStructuredModel = async () => ({ text: JSON.stringify(b3()) });
    const r = await buildModelFromBrief(SID, B3, async path => path.endsWith('/graph/register')
      ? { status: 200, json: { registered: true, model_version: { version_number: 1 } } } : { status: 200, json: { graph: { nodes: [], edges: [] } } }, call) as Rec;
    expect(r.ok).toBe(true);
    const line = eventSetAsideLine(flagged(b3(), B3))!;
    expect(r.event_forecast_disclosures).toEqual([line]);
    expect(r.open_questions).not.toContain(line);
    expect(r.open_questions[0]).toBe(chanceGoalDeadlineAsk('the new platform'));
  });
});

describe('EACH ASK ONCE PER REPLY: the readiness line says only what the reply has not said (DL, 12 Oct)', () => {
  const ASK = chanceGoalDeadlineAsk('next feature launch');
  const OTHER = 'What does "Hire a Tech lead" set "Team size" to?';
  const view = (messages: string[], may_run = false): ReadinessView => ({ checked: true, may_run,
    needs_from_user: messages.map(message => ({ message })), olumi_can_offer: [], will_run_without: [], levels_not_set: [] });
  it('nothing said yet: byte-identical to the existing sentence', () => {
    expect(readinessSentenceOnce(view([ASK]), 'I have set up the comparison.', false)).toBe(readinessSentence(view([ASK])));
  });
  it('the first analysis already said the ask AND that it could not run: no line at all (Paul\'s reply 1)', () => {
    expect(readinessSentenceOnce(view([ASK]), `I have set up the comparison.\nThe first analysis could not run yet: ${ASK}`, true)).toBeNull();
  });
  it('the ask already said, the refusal not: the refusal alone, never the ask again', () => {
    expect(readinessSentenceOnce(view([ASK]), `Next: ${ASK}`, false)).toBe("The analysis can't run yet.");
  });
  it('one of two needs already said: only the other', () => {
    expect(readinessSentenceOnce(view([ASK, OTHER]), `The first analysis could not run yet: ${ASK}`, true)).toBe(`The analysis can't run yet. ${OTHER}`);
  });
  it('CONTROL: a view that may run is untouched', () => {
    expect(readinessSentenceOnce(view([], true), ASK, true)).toBe(readinessSentence(view([], true)));
  });
  const build = { ok: true, mutated: true, model_version: { version_number: 1 }, displayed_next_question: ASK,
    open_questions: [ASK, 'What evidence supports the productivity assumption?', 'Lead time is an Olumi estimate.'] };
  const status = (alreadySaid?: string): string => narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [build as never],
    alreadySaid === undefined ? {} : { alreadySaid }).status ?? '';
  it('the build line does not restate the question the reply already said; the others stay counted behind the toggle', () => {
    expect(status(`The first analysis could not run yet: ${ASK}`)).toBe('Questions this model does not answer yet: 2 more questions remain unresolved.');
  });
  it('CONTROL: with nothing said before it, the build line is byte-identical (the one displayed question, then the count)', () => {
    expect(status()).toBe(`Questions this model does not answer yet: ${ASK} 2 more questions remain unresolved.`);
    expect(status('I have set up the comparison.')).toBe(status());
  });
});
