/**
 * ⛔ URGENT (DL 15 Oct, hiring timing diagnosis on CEE 62e94f27): after the deadline card was APPROVED ("Your deadline for
 * "Productivity" is now 15 January 2027"), the saved goal and the canonical result still asked "Does the 10% productivity target
 * need to be achieved by the launch date, or is the launch timing context rather than the target's measurement deadline?". That
 * open question also withholds the chance (`goal-chance-licence.ts`, `goal-horizon-verdict.ts`), and turn 07's timing answer was
 * refused `propose_hiring_times` `deadline_not_held` although the deadline was held, so hiring could never reach a chance.
 *
 * Bisect (recorded in the PR): reverting #3219 alone does not change this. Construction held "three months" both ways, and the
 * after-approve graph reads the same goal record and reading on c1e944a4 (before #3219) and on 62e94f27.
 *
 * The deadline card IS the answer to a reading stored while awaiting its period: the card shows that question whole, with Olumi's
 * reading of the target, and its press removes it, by identity (`answers_question`, `applyGoalHorizonEdit`). The date stays Olumi's
 * reading, approved. A question the card did not show is never answered by it (the served a3ad3689 two-part question is answered
 * only through the card that shows it). Rows drive the served graphs (`fixtures/hiring-timing-62e94f27.json`, copied, never authored) through the real
 * readers and the real capabilities (option-lead door, the real atomic batch writer and a store).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn(async () => undefined) }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden'); }, getMaxTokensFromConfig: () => undefined,
}));
import { goalTargetBasisOf } from '../goal-target-basis.js';
import { applyGoalHorizonEdit, approvedDeadlineReadingOf } from '../goal-horizon-write.js';
import { goalHorizonVerdict } from '../goal-horizon-verdict.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { optionTimingAtPeriodEnd } from '../../statement-door/fields/goal-timing.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/hiring-timing-62e94f27.json', import.meta.url), 'utf8')) as { reads: Record<string, { graph: Rec }> };
const BEFORE = (): Rec => structuredClone(FX.reads.before_approve!.graph);
const AFTER = (): Rec => structuredClone(FX.reads.after_approve!.graph);
const goalOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'goal');
const QUESTION = /Does the 10% productivity target need to be achieved by the launch date/;
const TURN_07 = 'The tech lead could start in month 1 and would lift productivity from month 2; each developer from month 2.';
const SID = 'c5c0c5c0-0000-4000-8000-00000000c5c0';

describe('the deadline write answers the shown question of a reading awaiting its period', () => {
  it('PRECONDITION: the served reading awaits its period with the launch-date question; the production press (62e94f27) left it stored', () => {
    const before = goalOf(BEFORE()).goal_target_basis, after = goalOf(AFTER()).goal_target_basis;
    expect(before.period_months).toBeUndefined();
    expect(before.open_question).toMatch(QUESTION);
    expect(after.open_question, 'the served press answered nothing').toBe(before.open_question);
    expect(goalOf(AFTER()).goal_horizon).toEqual({ deadline: '2027-01-15' });
    expect(goalHorizonVerdict(AFTER()), 'so the chance was withheld').toBe('withhold');
  });

  it('⭐ RED: the write with the shown question removes it: the reading is valid at 3 months, nothing asks it again, the chance is not withheld for it', () => {
    const g = BEFORE();
    const q = goalOf(g).goal_target_basis.open_question;
    const out = applyGoalHorizonEdit(g, { goal_id: goalOf(g).id, deadline: '2027-01-15', expected_deadline: null, reference_date: '2026-10-15', stated_months: 3, answers_question: q });
    expect(out.kind).toBe('mutated');
    const post = (out as { mutatedGraph: Rec }).mutatedGraph;
    expect(goalOf(post).goal_target_basis).not.toHaveProperty('open_question');
    expect(goalTargetBasisOf(goalOf(post))).toMatchObject({ period_months: 3, period_kind: 'at_end', reference: 'today' });
    expect(goalTargetBasisOf(goalOf(post))?.open_question).toBeUndefined();
    expect(goalHorizonVerdict(post)).toBe('no_horizon');
    expect(approvedDeadlineReadingOf(post, goalOf(post).id)).toMatchObject({ origin: 'olumi_reading', approved_by_user: true, months: 3 });
  });

  it('CONTRAST: a question the card did not show (other words) is never answered by the date', () => {
    const g = BEFORE();
    const out = applyGoalHorizonEdit(g, { goal_id: goalOf(g).id, deadline: '2027-01-15', expected_deadline: null, reference_date: '2026-10-15', stated_months: 3,
      answers_question: 'Must it be achieved by the launch date?' }) as { mutatedGraph: Rec };
    expect(goalOf(out.mutatedGraph).goal_target_basis.open_question).toMatch(QUESTION);
  });

  it('CONTRAST: with no question shown (every other deadline card), the write keeps the question exactly as before', () => {
    const g = BEFORE();
    const out = applyGoalHorizonEdit(g, { goal_id: goalOf(g).id, deadline: '2027-01-15', expected_deadline: null, reference_date: '2026-10-15', stated_months: 3 }) as { mutatedGraph: Rec };
    expect(goalOf(out.mutatedGraph).goal_target_basis.open_question).toMatch(QUESTION);
  });

  it('CONTRAST: a reading stored WITH its own period keeps its question even when the card names it (only an awaited period is answered)', () => {
    const g = BEFORE();
    const goal = goalOf(g);
    goal.goal_target_basis = { ...goal.goal_target_basis, period_months: 3 };
    const out = applyGoalHorizonEdit(g, { goal_id: goal.id, deadline: '2027-01-15', expected_deadline: null, reference_date: '2026-10-15', stated_months: 3,
      answers_question: goal.goal_target_basis.open_question }) as { mutatedGraph: Rec };
    expect(goalOf(out.mutatedGraph).goal_target_basis.open_question).toMatch(QUESTION);
  });
});

function world(start: Rec) {
  let json = JSON.stringify(start);
  const graph = (): Rec => JSON.parse(json) as Rec;
  const rows: { id: string; write: SessionTurnWrite }[] = [];
  const store = createMockSessionStore({
    loadGraph: async () => graph(), loadGraphAndBriefText: async () => ({ graph: graph(), briefText: null }),
    readExistingScenario: async () => ({ userId: null, graph: graph(), briefText: null, analysisInvalidatedAt: null }),
    readMostRecentPendingActions: async () => [], readAnalysisInvalidatedAt: async () => null, getScenarioOwner: async () => null,
    append: async (write) => { const s = JSON.parse(JSON.stringify(write)) as SessionTurnWrite, id = `dla-row-${rows.length + 1}`;
      rows.push({ id, write: s }); if (s.graph !== undefined) json = JSON.stringify(s.graph); return { id }; },
    readRecent: async () => rows.map(({ id, write: x }) => makeSessionTurnRow({ id, scenario_id: x.scenario_id, turn_id: x.turn_id,
      turn_class: x.turn_class, handler_id: x.handler_id, request_hash: x.request_hash, response_emitted: x.response_emitted, llm_calls_used: x.llm_calls_used, duration_ms: x.duration_ms })),
    readFactsWithTurnFor: async (ids) => rows.filter((r) => ids.includes(r.id)).flatMap(({ id, write }) =>
      write.handler_facts.map((fact) => ({ turn_id: id, fact_created_at: '2026-10-15T08:00:05.000Z', fact }))),
  });
  const commit = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    const out = await executeOptionInterventionBatch({ scenarioId: SID, turnId: input.turn_id, requestId: 'dla', requestHash: `dla:${input.turn_id}`,
      stage: 'frame', freshness: 'fresh', hasExistingAnalysis: false, expectedGraphHash: input.base_graph_hash, targets: [],
      ...(input.statement_record !== undefined && 'node_id' in input.statement_record ? { statementRecord: input.statement_record } : {}),
      ...(input.goal_horizon !== undefined ? { goalHorizon: { ...input.goal_horizon,
        ...(input.deadline_card !== undefined ? { expected_goal: input.deadline_card.expected_goal, own_write_landed: input.deadline_card.own_write_landed } : {}) } } : {}) }, store);
    if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
    if (out.kind === 'unchanged') return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(graph() as never)!, receipt: null, already_applied: true, committed_levels: [], links_resized: [] };
    if (out.kind !== 'committed') return { status: 'unconfirmed' };
    return { status: 'committed', graph_hash: out.analysisGraphHash, receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
  };
  const dispatch: InternalDispatch = async (path) => {
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch ${path}`);
    return { status: 200, json: { graph: graph(), graph_hash: computeAnalysisAffectingGraphHash(graph() as never),
      graph_identity_hash: computeGraphIdentityHash(graph() as never), brief_text: null, scenario_created_at: '2026-10-15T07:40:00Z' } };
  };
  const proposals = new ProposalStore();
  return { graph, proposals, caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels: commit, now: () => new Date('2026-10-15T08:00:00Z') }) };
}
const ctx = (turn: string): Rec => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'dla', user_text: turn, user_turn_text: turn });
const PRESS = 'Yes, use this reading.';

describe('the real card on the served graph before the press: it shows the question, and its press answers it', () => {
  it('⭐ RED: "three months" → the card shows the launch-date question with Olumi\'s reading → press → the deadline is held and the question answered', async () => {
    const w = world(BEFORE());
    const brief = 'We have an urgent launch date in the next three months.';
    const card = await w.caps.proposeGoalDeadline!({ ...ctx(brief), verified_user_messages: [brief], user_text_complete: true } as never, { deadline_words: 'in the next three months' } as never) as Rec;
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false });
    expect(card.public_label).toContain('Approving this date also answers the open question on Olumi’s reading of your target (');
    expect(card.public_label).toMatch(QUESTION);
    const res = await w.caps.authoriseChange({ ...ctx('Yes'), typed_approval_of: card.proposal_id, typed_approval_words: 'Yes' } as never, { proposal_id: card.proposal_id }) as Rec;
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true, applied: true });
    const goal = goalOf(w.graph());
    expect(goal.goal_horizon?.deadline).toBe('2027-01-15');
    expect(goal.goal_target_basis).not.toHaveProperty('open_question');
    expect(goalHorizonVerdict(w.graph())).toBe('no_horizon');
  });
});

describe('turn 07 on the approved graph: the timing answer reaches the model', () => {
  // CONTROL (green on staging too): the option-lead door was available on the approved graph; the served AI chose propose_hiring_times.
  it('CONTROL: the Tech lead\'s timing is a card through the option-lead door → press → recorded; at month 3 it is in place', async () => {
    const w = world(AFTER());
    const goalId = goalOf(w.graph()).id;
    const card = await w.caps.proposeStatement!(ctx(TURN_07) as never, { subject: { kind: 'option', label: 'Hire a Tech lead', field: 'lead' },
      statements: [{ quote: TURN_07, reading_words: 'would lift productivity from month 2' }] } as never) as Rec;
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false, statement: { subject: 'Hire a Tech lead', field: 'lead' } });
    const res = await w.caps.authoriseChange({ ...ctx(PRESS), typed_approval_of: card.proposal_id, typed_approval_words: PRESS } as never,
      { proposal_id: card.proposal_id }) as Rec;
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true, applied: true });
    expect(optionTimingAtPeriodEnd(w.graph(), goalId)?.options.find((o) => o.option_id === 'hire_a_tech_lead')?.kind).toBe('in_place');
  });

  it('CONTRAST: on the graph before the press there is no reading to time against, so the door prepares nothing', async () => {
    const out = await world(BEFORE()).caps.proposeStatement!(ctx(TURN_07) as never, { subject: { kind: 'option', label: 'Hire a Tech lead', field: 'lead' },
      statements: [{ quote: TURN_07, reading_words: 'would lift productivity from month 2' }] } as never) as Rec;
    expect(out.ok).toBe(false);
  });

  it('⭐ RED: propose_hiring_times on this model says the truthful reason (no team part) and names the door, never "deadline not held"', async () => {
    const out = await world(AFTER()).caps.proposeHiringTimes!(ctx(TURN_07) as never, { options: [{ option_id: 'hire_a_tech_lead', starts: [{ quote: 'could start in month 1' }] }] } as never) as Rec;
    expect(out).toMatchObject({ ok: false, mutated: false, refusal: 'not_a_team_model' });
    expect(out.detail).toContain('propose_statement (subject the option, field lead)');
  });
});
