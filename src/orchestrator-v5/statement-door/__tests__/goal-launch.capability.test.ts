/**
 * ⭐ THE LAUNCH DATE OF A LAUNCH-WINDOW GOAL on the real path (DL 15 Oct, marketing widen3 S6 LOST; AIE #94 6187235962 option A).
 * Served widen3 (CEE 87d5f90e): turn 04 "We have 6 months to launch our new features from last Friday, and that's when the
 * initial 3-month sales cycle starts." → `launch_opens_window`, then turn 06 "Last Friday was the 9th of October." → the reply said the
 * timing was "noted here, not saved in the model's calculation", and the cold read kept only the relative window.
 *
 * The user's words → `propose_goal_deadline` → ONE card ("Use this reading": the date is Olumi's reading) → the press → the level
 * door's `statement_record` member (one commit) → read-back. Real capabilities, the real atomic batch writer and a store.
 * Brief 1: marketing (the served graph, `tests/fixtures/marketing-withheld-once/run-08.json`, conversion over the first three months
 * after launch). Brief 2: T5 D2's own sentence "We plan to launch six months from today." (a start counted from today, no dating),
 * on the same served goal shape.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn(async () => undefined) }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden'); }, getMaxTokensFromConfig: () => undefined,
}));
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { riskOccurrenceWindowMonths } from '../../agent-lane/risk-occurrence.js';
import { subjectKey } from '../subject.js';

type Rec = Record<string, any>;
const SID = 'c4c0c4c0-0000-4000-8000-00000000c4c0';
const TURN_04 = "We have 6 months to launch our new features from last Friday, and that's when the initial 3-month sales cycle starts.";
const TURN_06 = 'Last Friday was the 9th of October.';
const D2_LAUNCH = 'We plan to launch six months from today.';
const plain = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphV3.parse(g)), { nodes: [], edges: [] }).graph as Rec;
const MARKETING = (): Rec => plain(JSON.parse(readFileSync('tests/fixtures/marketing-withheld-once/run-08.json', 'utf8')).graph);

function world(start: Rec = MARKETING(), now = '2026-10-15T08:00:00Z') {
  let json = JSON.stringify(start);
  const graph = (): Rec => JSON.parse(json) as Rec;
  const rows: { id: string; write: SessionTurnWrite }[] = [];
  const store = createMockSessionStore({
    loadGraph: async () => graph(), loadGraphAndBriefText: async () => ({ graph: graph(), briefText: null }),
    readExistingScenario: async () => ({ userId: null, graph: graph(), briefText: null, analysisInvalidatedAt: null }),
    readMostRecentPendingActions: async () => [], readAnalysisInvalidatedAt: async () => null, getScenarioOwner: async () => null,
    append: async (write) => { const s = JSON.parse(JSON.stringify(write)) as SessionTurnWrite, id = `launch-row-${rows.length + 1}`;
      rows.push({ id, write: s }); if (s.graph !== undefined) json = JSON.stringify(s.graph); return { id }; },
    readRecent: async () => rows.map(({ id, write: x }) => makeSessionTurnRow({ id, scenario_id: x.scenario_id, turn_id: x.turn_id,
      turn_class: x.turn_class, handler_id: x.handler_id, request_hash: x.request_hash, response_emitted: x.response_emitted, llm_calls_used: x.llm_calls_used, duration_ms: x.duration_ms })),
    readFactsWithTurnFor: async (ids) => rows.filter((r) => ids.includes(r.id)).flatMap(({ id, write }) =>
      write.handler_facts.map((fact) => ({ turn_id: id, fact_created_at: '2026-10-15T08:00:05.000Z', fact }))),
  });
  const commit = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    const out = await executeOptionInterventionBatch({ scenarioId: SID, turnId: input.turn_id, requestId: 'launch', requestHash: `launch:${input.turn_id}`,
      stage: 'frame', freshness: 'fresh', hasExistingAnalysis: false, expectedGraphHash: input.base_graph_hash, targets: [],
      ...(input.statement_record !== undefined && 'node_id' in input.statement_record ? { statementRecord: input.statement_record } : {}) }, store);
    if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
    if (out.kind === 'unchanged') return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(graph() as never)!, receipt: null, already_applied: true, committed_levels: [], links_resized: [] };
    if (out.kind !== 'committed') return { status: 'unconfirmed' };
    return { status: 'committed', graph_hash: out.analysisGraphHash, receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
  };
  const dispatch: InternalDispatch = async (path) => {
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch ${path}`);
    return { status: 200, json: { graph: graph(), graph_hash: computeAnalysisAffectingGraphHash(graph() as never),
      graph_identity_hash: computeGraphIdentityHash(graph() as never), brief_text: 'brief', scenario_created_at: '2026-10-09T10:00:00Z' } };
  };
  const proposals = new ProposalStore();
  return { graph, proposals, caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels: commit, now: () => new Date(now) }) };
}
const ctx = (turn: string, earlier: string[] = []): Rec => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'launch',
  user_text: [...earlier, turn].join('\n'), user_turn_text: turn, verified_user_messages: [...earlier, turn], user_text_complete: true });
const PRESS = 'Yes, use this reading.';
const press = (w: ReturnType<typeof world>, id: string) =>
  w.caps.authoriseChange({ ...ctx(PRESS), typed_approval_of: id, typed_approval_words: PRESS } as never, { proposal_id: id }) as Promise<Rec>;
const launchRecordOf = (g: Rec): Rec | undefined => (g.nodes.find((n: Rec) => n.kind === 'goal').user_statements ?? [])
  .find((r: Rec) => r.subject_key === subjectKey({ kind: 'goal', id: 'conversion_rate', field: 'lead' }));

describe('brief 1 (marketing widen3): the launch date is recorded on the goal with their words, never as its deadline', () => {
  it('⭐ RED: their dated launch → one card (9 April 2027, window to 9 July 2027) → press → the goal holds their words and Olumi\'s date', async () => {
    const w = world();
    const before = w.graph();
    const hashBefore = computeAnalysisAffectingGraphHash(before as never);
    // The served AI quoted only "6 months": the reading comes from their own clause, so "from last Friday" is kept.
    const card = await w.caps.proposeGoalDeadline!(ctx(TURN_06, [TURN_04]) as never, { deadline_words: '6 months', deliverable: 'launch our new features' } as never) as Rec;
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false, launch: { date: '2027-04-09', window_end: '2027-07-09', counted_from: '2026-10-09' } });
    expect(card.public_label).toContain('your launch: 9 April 2027, so that window runs from 9 April 2027 to 9 July 2027');
    expect(card.public_label).toContain('Olumi reads “6 months to launch our new features from last Friday” as 9 April 2027, counting from 9 October 2026, the date you gave.');
    expect(card.public_label).toContain('it does not change the calculation yet.');
    expect(JSON.stringify(w.graph())).toBe(JSON.stringify(before));
    const res = await press(w, card.proposal_id);
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true, applied: true });
    const record = launchRecordOf(w.graph());
    expect(record?.attest).toMatchObject({ reading: 'olumi', quantity: 'launch_date', launch_date: '2027-04-09', window_end: '2027-07-09', counted_from: '2026-10-09' });
    expect(record?.statements.map((s: Rec) => [s.quote, s.reference])).toEqual([
      ["We have 6 months to launch our new features from last Friday, and that's when the initial 3-month sales cycle starts.", '2027-04-09'],
      [TURN_06, '2026-10-09']]);
    // No Run input moves: no deadline, no horizon, the analysis hash and the risk window are unchanged.
    const goal = w.graph().nodes.find((n: Rec) => n.kind === 'goal');
    for (const k of ['goal_horizon', 'goal_horizon_months', 'goal_deadline_as_stated', 'goal_horizon_reference_date']) expect(Object.hasOwn(goal, k), k).toBe(false);
    expect(computeAnalysisAffectingGraphHash(w.graph() as never)).toBe(hashBefore);
    expect(riskOccurrenceWindowMonths(w.graph())).toBe(riskOccurrenceWindowMonths(before));
  });

  it('⭐ NEGATIVE (turn 04 alone, "last Friday" undated): nothing is prepared, and the AI is told to ask for the launch date once', async () => {
    const w = world();
    const out = await w.caps.proposeGoalDeadline!(ctx(TURN_04) as never, { deadline_words: '6 months', deliverable: 'launch our new features' } as never) as Rec;
    expect(out).toMatchObject({ ok: false, mutated: false, refusal: 'launch_opens_window' });
    expect(out.detail).toContain('ask once for the launch date');
    expect(w.proposals.outstanding(SID, null)).toEqual([]);
  });

  it('NEGATIVE: a dating that is not that weekday (8 October 2026 is a Thursday) places nothing', async () => {
    const out = await world().caps.proposeGoalDeadline!(ctx('Last Friday was the 8th of October.', [TURN_04]) as never, { deadline_words: '6 months' } as never) as Rec;
    expect(out.refusal).toBe('launch_opens_window');
  });
});

describe('brief 2 (T5 D2\'s launch sentence): a start counted from today', () => {
  it('⭐ RED: "six months from today" → 15 April 2027, window to 15 July 2027, recorded with no dating statement', async () => {
    const w = world();
    const card = await w.caps.proposeGoalDeadline!(ctx(D2_LAUNCH) as never, { deadline_words: 'six months from today' } as never) as Rec;
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, launch: { date: '2027-04-15', window_end: '2027-07-15' } });
    expect(card.launch.counted_from).toBeUndefined();
    expect(await press(w, card.proposal_id)).toMatchObject({ ok: true, applied: true });
    expect(launchRecordOf(w.graph())?.statements.map((s: Rec) => s.quote)).toEqual([D2_LAUNCH]);
  });

  it('CONTROL: the same goal measured from TODAY keeps the existing deadline card (this branch is the launch window only)', async () => {
    const g = MARKETING();
    g.nodes = g.nodes.map((n: Rec) => n.kind === 'goal' ? { ...n, goal_target_basis: { ...n.goal_target_basis, reference: 'today' } } : n);
    const out = await world(g).caps.proposeGoalDeadline!(ctx(D2_LAUNCH) as never, { deadline_words: 'six months from today' } as never) as Rec;
    expect(out).toMatchObject({ ok: true, mutated: false, deadline: { goal: 'Conversion rate' } });
    expect(out.launch).toBeUndefined();
  });
});
