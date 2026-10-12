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
import { draftedTeamPartOf, eventModelAsk, withEventShareDate } from '../event-by-date-model.js';
import { chanceGoalDeadlineAsk } from '../goal-kind.js';
import { readStatedDeadline } from '../deadline-date.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { constructionOperationId } from '../../agent-lane/runtime/build-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { applyTeamShareEdit, bindTeamTimeQuote, teamTimeCard, teamTimesInQuote, widenedTeamTime, type ApprovedTeamTime } from '../team-share-write.js';
import { shareChanceRunBlock } from '../share-by-date-run.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { goalChanceScreenLinesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';

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
    expect(r).toMatchObject({ ok: true, public_label: 'Is your deadline 12 April 2027 (6 months from 12 October 2026)?' });
  });
  it('an unplaceable phrase: the Agent is told to ask the model\'s own deadline question, never "never offer a date"', async () => {
    const { proposals, dispatch } = caps(), c = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { now: () => new Date('2026-10-12T08:52:27Z') });
    const r = await c.proposeGoalDeadline!(ctx('Our deadline is the next sprint.') as never, { deadline_words: 'the next sprint', rationale: '' }) as Rec;
    expect(r).toMatchObject({ ok: false, refusal: 'deadline_not_placed' });
    expect(r.detail).toBe('Olumi cannot place "the next sprint" on the calendar without guessing (for example a fiscal quarter, a sprint, or a date that has passed), so nothing was prepared. '
      + `Ask the user directly: "${chanceGoalDeadlineAsk('next feature launch')}" Then call propose_goal_deadline with the words they reply with; Olumi works out the date from them.`);
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

  it("Paul's sentence: his 7 months is the most likely time, and Olumi's range for his low confidence is P to 1.5 × P", () => {
    const quote = "they're going to be a month late delivering the next feature (so, 7 months)";
    expect(bindTeamTimeQuote({ now: PAUL_TEAM }, { quote, low_months: 7, high_months: 7 })).toEqual({ kind: 'bound', quote,
      time: { low_months: 7, high_months: 10.5, most_likely_months: 7, range_origin: 'olumi_estimate', widening: 'doubt' } });
  });
  it.each([
    ['The team say 7 months.', 'The team say 7 months', 7, { low_months: 6, high_months: 8.8, widening: 'default' }],
    ['It will take about 13 months, I think.', 'about 13 months', 13, { low_months: 11.1, high_months: 16.3, widening: 'default' }],
    ["About 8 months, but I'm not confident in that.", 'About 8 months', 8, { low_months: 8, high_months: 12, widening: 'doubt' }],
    ['We have no doubt: 8 months.', '8 months', 8, { low_months: 6.8, high_months: 10, widening: 'default' }],
  ])('the one widening rule: "%s"', (now, quote, p, expected) => {
    const r = bindTeamTimeQuote({ now }, { quote, low_months: p, high_months: p });
    expect(r).toEqual({ kind: 'bound', quote, time: { ...expected, most_likely_months: p, range_origin: 'olumi_estimate' } });
    expect(widenedTeamTime(p, expected.widening as 'doubt' | 'default')).toEqual({ low_months: expected.low_months, high_months: expected.high_months });
  });
  it('a stated range is written as stated, never widened', () => {
    expect(bindTeamTimeQuote({ now: 'Probably 6 to 9 months' }, { quote: 'Probably 6 to 9 months', low_months: 6, high_months: 9 }))
      .toEqual({ kind: 'bound', quote: 'Probably 6 to 9 months', time: { low_months: 6, high_months: 9 } });
  });
  it('FROM ANY MESSAGE: a chip turn binds the quote to an earlier message; the quote must be the user\'s and hold the figure', () => {
    const conversation = [BRIEF, PAUL_TEAM].join('\n');
    expect(bindTeamTimeQuote({ now: '', conversation }, { quote: '(so, 7 months)', low_months: 7, high_months: 7 }))
      .toMatchObject({ kind: 'bound', time: { low_months: 7, high_months: 10.5, most_likely_months: 7 } });
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
  it('the card says the user\'s figure and labels the range as Olumi\'s estimate from it; the write keeps both authorships', () => {
    const g = dated(), part = draftedTeamPartOf(g)!;
    const a: ApprovedTeamTime = { goal_id: part.goal.id, team_id: part.team.id, deadline: '2027-04-12', reference_date: '2026-10-12',
      low_months: 7, high_months: 10.5, most_likely_months: 7, range_origin: 'olumi_estimate', widening: 'doubt' };
    expect(teamTimeCard(a, part.goal.goal_threshold_unit, part.deliverable)).toBe("Use Olumi's 7–10.5 months for today's team? It is Olumi's estimate "
      + 'from your 7 months, allowing for it to run later because you have doubts about it. By 12 April 2027 that is about 70% of next feature launch.');
    expect(teamTimeCard({ ...a, low_months: 6, high_months: 8.8, widening: 'default' }, part.goal.goal_threshold_unit, part.deliverable))
      .toBe("Use Olumi's 6–8.8 months for today's team? It is Olumi's estimate from your 7 months, allowing for it to run earlier or later. "
        + 'By 12 April 2027 that is about 82% of next feature launch.');
    const written = applyTeamShareEdit(g, a, computeAnalysisAffectingGraphHash(g as never)!);
    if (written.kind !== 'mutated') throw new Error(JSON.stringify(written));
    expect(draftedTeamPartOf(written.mutatedGraph)!.team.observed_state.stated_time).toEqual({ quantity: 'months_to_finish', low: 7, high: 10.5,
      unit: 'months', deadline: '2027-04-12', reference_date: '2026-10-12', most_likely: 7, most_likely_origin: 'user', range_origin: 'olumi_estimate', widening: 'doubt' });
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
    const dispatch: InternalDispatch = async path => {
      if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
      if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch ${path}`);
      return { status: 200, json: { graph: graph(), graph_hash: computeAnalysisAffectingGraphHash(graph() as never), brief_text: BRIEF } };
    };
    const proposals = new ProposalStore();
    return { graph, rows, proposals, replace: (g: Rec) => { json = JSON.stringify(g); },
      caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels: commit, now: () => new Date('2026-10-12T09:14:24Z') }) };
  }
  const ctx = (text: string): Rec => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'ebd-scope', user_text: text, user_turn_text: text });
  const quote = "they're going to be a month late delivering the next feature (so, 7 months)";
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
    const card = await w.caps.proposeTeamTime!(ctx(PAUL_TEAM) as never, { quote, low_months: 7, high_months: 7 }) as Rec;
    expect(card.ok).toBe(true);
    const moved = hiringTimesLand(w.graph());
    expect(computeAnalysisAffectingGraphHash(moved as never)).not.toBe(card.base_revision);
    w.replace(moved);
    expect(await approve(w, card.proposal_id)).toMatchObject({ ok: true, applied: true });
    expect(draftedTeamPartOf(w.graph())!.team.observed_state.stated_time).toMatchObject({ low: 7, high: 10.5, most_likely: 7 });
    // The hiring times that landed first are kept: the write is scoped to the team part.
    expect(w.graph().nodes.find((n: Rec) => n.id === 'event_capacity_2').observed_state.extra_share_by_date).toMatchObject({ lead_low: 1, lead_high: 3 });
  });
  it('reverse order: hiring times land → card offered → approved = APPLIED', async () => {
    const w = world(hiringTimesLand(dated()));
    const card = await w.caps.proposeTeamTime!(ctx(PAUL_TEAM) as never, { quote, low_months: 7, high_months: 7 }) as Rec;
    expect(await approve(w, card.proposal_id)).toMatchObject({ ok: true, applied: true });
  });
  it.each([
    ['the team part\'s own time changed', (g: Rec): Rec => { const out = structuredClone(g); const t = draftedTeamPartOf(out)!.team;
      out.nodes.find((n: Rec) => n.id === t.id).observed_state = { value: 0.5, std: 0.1, raw_value: 50, unit: t.observed_state?.unit ?? '% of next feature launch', cap: 100, source: 'cee_inference',
        stated_time: { quantity: 'months_to_finish', low: 5, high: 8, unit: 'months', deadline: '2027-04-12', reference_date: '2026-10-12' } }; return out; }],
    ['the deadline changed', (g: Rec): Rec => { const out = structuredClone(g); draftedTeamPartOf(out)!.goal; out.nodes.find((n: Rec) => n.kind === 'goal').goal_horizon = { deadline: '2027-05-12' }; return out; }],
  ])('CONTROL: %s → refused as superseded, nothing written', async (_name, change) => {
    const w = world();
    const card = await w.caps.proposeTeamTime!(ctx(PAUL_TEAM) as never, { quote, low_months: 7, high_months: 7 }) as Rec;
    const changed = change(w.graph()); w.replace(changed);
    expect(await approve(w, card.proposal_id)).toMatchObject({ ok: false, refusal: 'superseded' });
    expect(w.rows).toHaveLength(0);
    expect(w.graph()).toEqual(changed);
  });
  it('CONTROL: a proposal with no field-scoped read (the deadline card) is still stale on any model change, byte-identically', async () => {
    const w = world(drafted());
    const card = await w.caps.proposeGoalDeadline!(ctx('Our launch deadline is in six months time.') as never, { deadline_words: 'in six months time', rationale: '' }) as Rec;
    expect(card.ok).toBe(true);
    w.replace(hiringTimesLand(w.graph()));
    expect(await approve(w, card.proposal_id)).toMatchObject({ ok: false, refusal: 'superseded' });
  });
  it('the write stays CAS-fenced: the writer refuses an expected hash the model has moved past', () => {
    const g = dated(), part = draftedTeamPartOf(g)!;
    const a: ApprovedTeamTime = { goal_id: part.goal.id, team_id: part.team.id, deadline: '2027-04-12', reference_date: '2026-10-12', low_months: 6, high_months: 9 };
    expect(applyTeamShareEdit(hiringTimesLand(g), a, computeAnalysisAffectingGraphHash(g as never)!)).toEqual({ kind: 'refused', reason: 'stale_graph' });
  });
  it.skip('E5 combine (DL, at the rebase): a hiring-times card offered before the team time lands still applies via hiringTimesStillApply', () => {
    // Goes live when SYS1's goal-target/hiring-times.ts is combined and wired into `scoped_precondition_holds`.
    expect('hiringTimesStillApply wired').toBe('TODO');
  });
});

describe('E2 — a range line never calls Olumi\'s range "yours"', () => {
  const held = (): Rec => {
    const g = dated(), part = draftedTeamPartOf(g)!;
    Object.assign(g.nodes.find((n: Rec) => n.id === part.goal.id), { goal_horizon_months: 6, goal_horizon_reference_date: '2026-10-12', goal_horizon_stated_months: 6 });
    const written = applyTeamShareEdit(g, { goal_id: part.goal.id, team_id: part.team.id, deadline: '2027-04-12', reference_date: '2026-10-12',
      low_months: 7, high_months: 10.5, most_likely_months: 7, range_origin: 'olumi_estimate', widening: 'doubt' }, computeAnalysisAffectingGraphHash(g as never)!);
    if (written.kind !== 'mutated') throw new Error('write');
    return written.mutatedGraph;
  };
  it('RANGE line: "from the slow end of your 7 months, which Olumi widened to 7–10.5 months"', () => {
    const g = held(), team = draftedTeamPartOf(g)!.team.id;
    const target = { comparator: 'at_least', value: 100, unit: '% of next feature launch', by_date: '2027-04-12' };
    const range = { inference_warnings: [{ code: 'GOAL_CHANCE_RANGE', severity: 'info', message: 'Stated time.', option_ids: ['event_option_3'], target,
      range_by_option: { event_option_3: { kind: 'stated_time', basis: 'stated_time', quantity: 'months_to_finish',
        stated_estimate: { low: 7, high: 10.5, unit: 'months' }, low: 0.2, high: 0.6, low_pct: 20, high_pct: 60,
        low_rounding: 'whole', high_rounding: 'whole', from: team, to: 'event_goal', among: 'all' } } }] };
    const line = goalChanceScreenLinesForAgent(range, g, true).find(l => l.option_id === 'event_option_3')!.chance;
    expect(line).toBe("‘Carry on as now’: between about 20% and 60% chance of launching by 12 April 2027, in this model, using Olumi's estimate from your 7 months "
      + '(7–10.5 months), from the slow end of your 7 months, which Olumi widened to 7–10.5 months to the fast end.');
    expect(line).not.toContain('your 7–10.5');
  });
});
