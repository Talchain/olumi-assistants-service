/**
 * EBD — the deadline ("event by date") model's input loop, at its producers (Paul's hiring test, 12 Oct 2026, scenario
 * 4184e877). The end-to-end replay is `ebd-paul-hiring-replay.route.test.ts`; these rows pin each producer by identity.
 */
import { describe, expect, it } from 'vitest';
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
