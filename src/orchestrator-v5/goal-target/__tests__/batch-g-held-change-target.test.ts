/**
 * ⭐ G: A RESTATED OR CLARIFIED CHANGE TARGET MEETS THE GOAL AS SAVED (G14; bG brief "relative to today" continuation).
 *
 * Two served hiring captures, each the server's own `/graph` read, verbatim:
 *   · 2026-10-13T074403Z read 04 (after the turn-14 approval): the saved goal ALREADY reads "at least 10% above today's
 *     productivity at month three" (change_abs 10, "% of today’s productivity", reference today, no open question). The
 *     user's turn 14 said "I mean 10% relative to today's productivity, not percentage points."; the Agent's
 *     propose_goal_target was refused `derivation_mismatch`, then `goal_is_a_change`, and it told the user "The update was
 *     refused" and later "The saved target still hasn't been corrected" — false (judge §(a), §(c)).
 *   · 2026-10-13T131858Z read 07 (after the cold reopen): the draft holds the same reading AND its open question ("10%
 *     relative to today's productivity, or 10 percentage points?"), so every cell is withheld "can be read more than one
 *     way". No route records the user's answer: the change frame is refused and `goal_target_basis` is written only by
 *     construction.
 *
 * The capture holds the refusal codes, not the Agent's arguments; the arguments here are RECONSTRUCTED from the second
 * turn-14 call (the one that reached the change-frame refusal, so its figure passed the user-words door): at least 10 %.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { userWordsOf } from '../../agent-lane/stated-by-user.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { CONDITIONS_NOT_KEPT } from '../goal-target-basis.js';
import { withholdForOpenTargetQuestion } from '../goal-chance-gate.js';
import { applyGoalReadingEdit } from '../goal-reading-write.js';
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn(async () => undefined) }));

type Rec = Record<string, any>;
const read = (f: string): Rec => (JSON.parse(readFileSync(`tests/fixtures/batch-g/${f}`, 'utf8')) as Rec).body as Rec;
const SAVED = read('served-hiring-read-14-after-approve-20261013T074403Z.json');
const ASKED = read('served-hiring-read-19-after-reopen-20261013T131858Z.json');
/** The user's turn-14 words, verbatim (07:44 `turns/14.json` `request_body.message`). */
const CLARIFIED = "I mean 10% relative to today's productivity, not percentage points.";
const GOAL = 'productivity';
/** The card's words and the receipt, exactly (AIE_TEXT_PENDING templates, filled from the stored reading and its question). */
const READING = '‘productivity’ up at least 10% from today at three months, measured against today\'s development productivity';
const CARD = `Read your target as ${READING}. This answers: Does “increase productivity by at least 10%” mean 10% relative to today's productivity, or 10 percentage points on a productivity score?`;
const RECEIPT = `Recorded your answer: your target is read as ${READING}. Run the analysis again.`;

function world(body: Rec) {
  const sent: Array<{ path: string; body: unknown }> = [];
  const d: InternalDispatch = async (p, b) => {
    if (p.endsWith('/graph')) return { status: 200, json: structuredClone(body) };
    sent.push({ path: p, body: b });
    return { status: 500, json: {} };
  };
  return { d, sent };
}
function propose(body: Rec, args: Rec, said = CLARIFIED) {
  const w = world(body);
  const store = new ProposalStore();
  const ctx = { scenario_id: String(body.scenario_id), authenticated_user_id: null, request_id: 'r-g14',
    user_text: userWordsOf([String(body.brief_text)], said), user_turn_text: said };
  return createAgentCapabilities(w.d, store).proposeGoalTarget!(ctx as never, args as never).then((p) => ({ p: p as Rec, w, store, ctx }));
}
const AT_LEAST_10 = { constraint_type: 'at_least', value: 10, unit: '%', rationale: 'The user clarified the target is relative to today.' };
const goalOf = (body: Rec): Rec => (body.graph.nodes as Rec[]).find((n) => n.id === GOAL)!;

describe('G14: restating the saved change target is "already saved", never a refusal', () => {
  it('precondition: the 07:44 saved goal already encodes the relative reading, with no open question', () => {
    expect(goalOf(SAVED)).toMatchObject({ goal_threshold_frame: 'change_abs', goal_threshold_raw: 10, goal_threshold_unit: '%', goal_direction: '>=',
      goal_target_basis: { reference: 'today', denominator: 'today’s productivity', effect_unit: '% of today’s productivity', period_months: 3,
        period_kind: 'at_end', target_frame: 'change_abs', target_raw: 10 } });
    expect(goalOf(SAVED).goal_target_basis.open_question).toBeUndefined();
  });

  it('RED→GREEN: the turn-14 restatement → ok, already_saved, nothing prepared, nothing sent, with the saved meaning', async () => {
    const { p, w, store } = await propose(SAVED, AT_LEAST_10);
    expect(p, JSON.stringify(p)).toMatchObject({ ok: true, mutated: false, already_saved: true });
    expect(p.saved_goal).toEqual({
      label: 'Productivity', target_frame: 'change_abs', target_raw: 10, unit: '%', comparator: '>=',
      reference: 'today', denominator: 'today’s productivity', effect_unit: '% of today’s productivity', period_months: 3, period_kind: 'at_end',
      also_required: ['maintaining code quality'],
    });
    expect(p.proposal_id).toBeUndefined();
    expect(store.outstanding(String(SAVED.scenario_id), null)).toEqual([]);
    expect(w.sent).toEqual([]);
  });

  it('CONTRAST: a genuinely different relative target (15%) keeps the change-frame refusal, now with the saved meaning to compare', async () => {
    const said = "I mean 15% relative to today's productivity.";
    const { p, w, store } = await propose(SAVED, { ...AT_LEAST_10, value: 15 }, said);
    expect(p, JSON.stringify(p)).toMatchObject({ ok: false, mutated: false, refusal: 'goal_is_a_change' });
    expect(p.saved_goal).toMatchObject({ target_frame: 'change_abs', target_raw: 10, unit: '%', comparator: '>=', reference: 'today' });
    expect(store.outstanding(String(SAVED.scenario_id), null)).toEqual([]);
    expect(w.sent).toEqual([]);
  });

  it('CONTRAST: the opposite comparator on the same figure is not the saved target', async () => {
    const { p } = await propose(SAVED, { ...AT_LEAST_10, constraint_type: 'at_most' }, "I mean at most 10% relative to today's productivity.");
    expect(p, JSON.stringify(p)).toMatchObject({ ok: false, refusal: 'goal_is_a_change' });
    expect(p.already_saved).toBeUndefined();
  });

  it('CONTRAST: a percentage-points reading (another unit family) is not the saved relative target', async () => {
    const { p } = await propose(SAVED, { ...AT_LEAST_10, unit: 'percentage points' }, 'I mean 10 percentage points on the productivity score.');
    expect(p.already_saved).toBeUndefined();
    expect(p.ok).toBe(false);
  });
});

describe('G: the user\'s answer to the goal\'s open question reaches the saved reading through one card', () => {
  it('precondition: the 13:18 draft holds the relative reading AND its open question', () => {
    expect(goalOf(ASKED)).toMatchObject({ goal_threshold_frame: 'change_abs', goal_threshold_raw: 10, goal_threshold_unit: '%', goal_direction: '>=',
      goal_target_basis: { reference: 'today', effect_unit: '% of today\'s productivity', target_raw: 10, target_frame: 'change_abs',
        also_required: ['maintaining code quality', 'launch readiness'] } });
    expect(goalOf(ASKED).goal_target_basis.open_question).toMatch(/relative to today's productivity, or 10 percentage points/);
  });

  it('RED→GREEN: the clarification over the asked draft → ONE confirm_goal_reading card, nothing sent before approval', async () => {
    const { p, w, store } = await propose(ASKED, AT_LEAST_10);
    expect(p, JSON.stringify(p)).toMatchObject({ ok: true, mutated: false });
    expect(typeof p.proposal_id).toBe('string');
    expect(store.outstanding(String(ASKED.scenario_id), null).map((x) => x.proposal_id)).toEqual([p.proposal_id]);
    expect(store.get(String(p.proposal_id))?.operations).toEqual([{ op: 'confirm_goal_reading', path: GOAL,
      value: { expected_basis: goalOf(ASKED).goal_target_basis, open_question: goalOf(ASKED).goal_target_basis.open_question } }]);
    expect(p.public_label).toBe(CARD);
    expect(p.saved_goal).toMatchObject({ open_question: goalOf(ASKED).goal_target_basis.open_question, also_required: ['maintaining code quality', 'launch readiness'] });
    expect(w.sent).toEqual([]);
  });

  it('CONTRAST: a percentage-points answer over the asked draft is not the held reading — refused with the saved meaning, no card', async () => {
    const { p, store } = await propose(ASKED, { ...AT_LEAST_10, unit: 'percentage points' }, 'I mean 10 percentage points on a productivity score.');
    expect(p, JSON.stringify(p)).toMatchObject({ ok: false, refusal: 'goal_is_a_change' });
    expect(p.saved_goal).toMatchObject({ open_question: goalOf(ASKED).goal_target_basis.open_question });
    expect(store.outstanding(String(ASKED.scenario_id), null)).toEqual([]);
  });

  it('CONTRAST: admission\'s conditions refusal is not a question the user can answer — already saved, no card', async () => {
    const body = structuredClone(ASKED);
    goalOf(body).goal_target_basis.open_question = CONDITIONS_NOT_KEPT;
    const { p, store } = await propose(body, AT_LEAST_10);
    expect(p, JSON.stringify(p)).toMatchObject({ ok: true, mutated: false, already_saved: true });
    expect(store.outstanding(String(ASKED.scenario_id), null)).toEqual([]);
  });
});

describe('G: approve → the one writer → read-back → cold reopen, on the 13:18 read', () => {
  /** The served read's graph as the store holds it; a fresh capabilities object per "process" reads it back from bytes. */
  function persisted(body: Rec) {
    let bytes = JSON.stringify(body.graph);
    const graph = () => JSON.parse(bytes) as Rec;
    const rows: Array<{ id: string; write: SessionTurnWrite }> = [];
    const store = createMockSessionStore({
      loadGraph: async () => graph(), loadGraphAndBriefText: async () => ({ graph: graph(), briefText: String(body.brief_text) }),
      readMostRecentPendingActions: async () => [], getScenarioOwner: async () => null,
      append: async (write) => {
        const s = JSON.parse(JSON.stringify(write)) as SessionTurnWrite, id = `g-row-${rows.length + 1}`;
        rows.push({ id, write: s }); if (s.graph !== undefined && s.graph !== null) bytes = JSON.stringify(s.graph); return { id };
      },
      readRecent: async () => rows.map(({ id, write: w }) => makeSessionTurnRow({ id, scenario_id: w.scenario_id, turn_id: w.turn_id,
        turn_class: w.turn_class, handler_id: w.handler_id, request_hash: w.request_hash })),
      readFactsWithTurnFor: async (ids) => rows.filter((r) => ids.includes(r.id)).flatMap(({ id, write }) =>
        write.handler_facts.map((fact) => ({ turn_id: id, fact_created_at: '2026-10-13T23:00:00.000Z', fact }))),
    });
    const commits: CommitOptionLevelsInput[] = [];
    const commit = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
      commits.push(input);
      const out = await executeOptionInterventionBatch({ scenarioId: String(body.scenario_id), turnId: input.turn_id, requestId: 'g-door',
        requestHash: `g:${input.turn_id}`, stage: 'frame', freshness: 'fresh', hasExistingAnalysis: true,
        expectedGraphHash: input.base_graph_hash, targets: [], goalReading: input.goal_reading }, store);
      if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
      if (out.kind === 'unchanged') return { status: 'committed', graph_hash: input.base_graph_hash, receipt: null, already_applied: true, committed_levels: [], links_resized: [] };
      if (out.kind !== 'committed') return { status: 'unconfirmed' };
      return { status: 'committed', graph_hash: out.analysisGraphHash, receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
    };
    const dispatch: InternalDispatch = async (p) => {
      if (!p.endsWith('/graph')) return { status: 500, json: {} };
      return { status: 200, json: { ...structuredClone(body), graph: graph(), graph_hash: computeAnalysisAffectingGraphHash(graph() as never) } };
    };
    const open = () => {
      const proposals = new ProposalStore();
      return { proposals, caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels: commit }) };
    };
    return { graph, rows, commits, store, open, setGraph: (g: Rec) => { bytes = JSON.stringify(g); } };
  }
  const ctxOf = (body: Rec, extra: Rec = {}) => ({ scenario_id: String(body.scenario_id), authenticated_user_id: null, request_id: 'r-g',
    user_text: userWordsOf([String(body.brief_text)], CLARIFIED), user_turn_text: CLARIFIED, turn_id: 'g-turn-1', ...extra });
  /** The 13:18 graph with ONLY the question removed from the goal's reading: the one write's whole postimage. */
  const answered = (): Rec => { const g = structuredClone(ASKED.graph) as Rec; delete goalOf({ graph: g }).goal_target_basis.open_question; return g; };

  it('RED→GREEN: the pressed card writes ONE commit removing only the question; the read-back and receipt say so', async () => {
    const w = persisted(ASKED);
    const { caps } = w.open();
    const card = await caps.proposeGoalTarget!(ctxOf(ASKED) as never, AT_LEAST_10 as never) as Rec;
    expect(card.proposal_id).toEqual(expect.any(String));
    const r = await caps.authoriseChange(ctxOf(ASKED, { typed_approval_of: card.proposal_id, turn_id: 'g-turn-2' }) as never, { proposal_id: card.proposal_id } as never) as Rec;
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, mutated: true, applied: true, proposal_id: card.proposal_id });
    expect(r.follow_up).toBe(RECEIPT);
    expect(w.commits).toHaveLength(1);
    expect(w.commits[0]!.goal_reading).toEqual({ goal_id: GOAL, expected_basis: goalOf(ASKED).goal_target_basis });
    expect(w.rows).toHaveLength(1);
    expect(w.graph()).toEqual(answered());
    // Everything but that one member is byte-identical: the target, the reading's other members, and every other node and link.
    expect(goalOf({ graph: w.graph() }).goal_target_basis).toEqual({ ...goalOf(ASKED).goal_target_basis, open_question: undefined });
    expect(goalOf({ graph: w.graph() }).goal_target_basis.source).toBe('olumi_reading');
    // The analysis hash moves (the reading is in it), so the stored Run is stale and the next Run reads the answered reading.
    expect(computeAnalysisAffectingGraphHash(w.graph() as never)).not.toBe(computeAnalysisAffectingGraphHash(ASKED.graph as never));
  });

  it('a retry of the same approval writes nothing twice (one row), and says it was already applied', async () => {
    const w = persisted(ASKED);
    const { caps } = w.open();
    const card = await caps.proposeGoalTarget!(ctxOf(ASKED) as never, AT_LEAST_10 as never) as Rec;
    const press = () => caps.authoriseChange(ctxOf(ASKED, { typed_approval_of: card.proposal_id, turn_id: 'g-turn-2' }) as never, { proposal_id: card.proposal_id } as never);
    expect(await press()).toMatchObject({ ok: true, applied: true });
    expect(await press()).toMatchObject({ ok: true, mutated: false, already_applied: true });
    expect(w.rows).toHaveLength(1);
  });

  it('cold reopen: a fresh process reads the answered reading back — no question, and the target-question withhold no longer fires', async () => {
    const w = persisted(ASKED);
    const first = w.open();
    const card = await first.caps.proposeGoalTarget!(ctxOf(ASKED) as never, AT_LEAST_10 as never) as Rec;
    await first.caps.authoriseChange(ctxOf(ASKED, { typed_approval_of: card.proposal_id, turn_id: 'g-turn-2' }) as never, { proposal_id: card.proposal_id } as never);
    const reopened = JSON.parse(JSON.stringify(w.graph())) as Rec;
    expect(goalOf({ graph: reopened }).goal_target_basis.open_question).toBeUndefined();
    const stored = ASKED.analysis_result.enrichment as Rec;
    expect(withholdForOpenTargetQuestion(stored, ASKED.graph, GOAL)).not.toBe(stored);
    expect(withholdForOpenTargetQuestion(stored, reopened, GOAL)).toBe(stored);
    // The same restatement after the reopen is now "already saved" — never a second card, never a refusal.
    const again = await w.open().caps.proposeGoalTarget!(ctxOf(ASKED) as never, AT_LEAST_10 as never) as Rec;
    expect(again).toMatchObject({ ok: true, mutated: false, already_saved: true });
    expect(again.saved_goal.open_question).toBeUndefined();
  });

  it('stale: the reading changed after the card was made (a condition edited) → nothing written, never a partial write', async () => {
    const w = persisted(ASKED);
    const { caps } = w.open();
    const card = await caps.proposeGoalTarget!(ctxOf(ASKED) as never, AT_LEAST_10 as never) as Rec;
    const moved = structuredClone(ASKED.graph) as Rec;
    goalOf({ graph: moved }).goal_target_basis.also_required = ['maintaining code quality'];
    w.setGraph(moved);
    const r = await caps.authoriseChange(ctxOf(ASKED, { typed_approval_of: card.proposal_id, turn_id: 'g-turn-2' }) as never, { proposal_id: card.proposal_id } as never) as Rec;
    expect(r.ok).toBe(false);
    expect(w.rows).toHaveLength(0);
    expect(w.graph()).toEqual(moved);
  });

  it('the writer, directly: stale reading, conditions question and a compound edit are each refused; a landed write is a verified no-op', async () => {
    const w = persisted(ASKED);
    const base = { scenarioId: String(ASKED.scenario_id), turnId: 'g-direct', requestId: 'g-door', requestHash: 'g:direct', stage: 'frame' as const,
      freshness: 'fresh' as const, hasExistingAnalysis: true, expectedGraphHash: computeAnalysisAffectingGraphHash(ASKED.graph as never)!, targets: [] };
    const expected = goalOf(ASKED).goal_target_basis as Rec;
    expect(await executeOptionInterventionBatch({ ...base, goalReading: { goal_id: GOAL, expected_basis: { ...expected, target_raw: 15 } } }, w.store))
      .toEqual({ kind: 'refused', reason: 'goal_reading_reading_changed' });
    // A card made on an older reading (one condition fewer) must never write that older reading over the held one.
    expect(await executeOptionInterventionBatch({ ...base, goalReading: { goal_id: GOAL,
      expected_basis: { ...expected, also_required: ['maintaining code quality'] } } }, w.store))
      .toEqual({ kind: 'refused', reason: 'goal_reading_reading_changed' });
    expect(await executeOptionInterventionBatch({ ...base, goalReading: { goal_id: GOAL, expected_basis: { ...expected, open_question: CONDITIONS_NOT_KEPT } } }, w.store))
      .toEqual({ kind: 'refused', reason: 'goal_reading_not_a_reading_question' });
    expect(await executeOptionInterventionBatch({ ...base, goalReading: { goal_id: GOAL, expected_basis: expected },
      targets: [{ optionId: 'hire_a_tech_lead', factorId: 'tech_lead_headcount', modelValue: 0.2 }] }, w.store))
      .toEqual({ kind: 'refused', reason: 'goal_reading_not_alone' });
    expect(w.rows).toHaveLength(0);
    expect((await executeOptionInterventionBatch({ ...base, goalReading: { goal_id: GOAL, expected_basis: expected } }, w.store)).kind).toBe('committed');
    expect(await executeOptionInterventionBatch({ ...base, goalReading: { goal_id: GOAL, expected_basis: expected } }, w.store)).toEqual({ kind: 'unchanged' });
    expect(w.rows).toHaveLength(1);
    expect(applyGoalReadingEdit(answered(), { goal_id: GOAL, expected_basis: expected })).toEqual({ kind: 'unchanged' });
  });
});
