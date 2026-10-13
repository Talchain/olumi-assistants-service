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
 *     way". No route recorded the user's answer: the change frame is refused and the reading was written only by construction.
 *
 * The capture holds the refusal codes, not the Agent's arguments; the arguments are RECONSTRUCTED from the second turn-14
 * call (the one that reached the change-frame refusal, so its figure passed the user-words door): at least 10 %. The module
 * is driven with exactly what `proposeGoalTarget`'s one hook line passes (the hook lands after PROMPT's merge, DL lease);
 * the approval goes through the real `authoriseChange`, the real level door and its commit, and the read-back.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { userWordsOf } from '../../agent-lane/stated-by-user.js';
import { approvalChipIdFor, approvalChipsFor } from '../../agent-lane/approval-chips.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { CONDITIONS_NOT_KEPT } from '../goal-target-basis.js';
import { withholdForOpenTargetQuestion } from '../goal-chance-gate.js';
import { answeredBasisOf, applyGoalReadingEdit } from '../goal-reading-write.js';
import { ALREADY_SAVED_NOTE, heldChangeTargetAnswer, savedGoalMeaningOf } from '../held-change-target.js';
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn(async () => undefined) }));

type Rec = Record<string, any>;
const read = (f: string): Rec => (JSON.parse(readFileSync(`tests/fixtures/batch-g/${f}`, 'utf8')) as Rec).body as Rec;
const SAVED = read('served-hiring-read-14-after-approve-20261013T074403Z.json');
const ASKED = read('served-hiring-read-19-after-reopen-20261013T131858Z.json');
/** The user's turn-14 words, verbatim (07:44 `turns/14.json` `request_body.message`). */
const CLARIFIED = "I mean 10% relative to today's productivity, not percentage points.";
const GOAL = 'productivity';
const QUESTION = 'Does “increase productivity by at least 10%” mean 10% relative to today\'s productivity, or 10 percentage points on a productivity score?';
/** The card's words, its button and the receipt, exactly (AIE_TEXT_PENDING templates, filled from the stored reading). */
const READING = '‘productivity’ up at least 10% from today at three months, measured against today\'s development productivity'
  + '; also required, not part of this target: maintaining code quality; launch readiness';
/** The AIE's card; its closing full stop is not doubled after the question's own "?" (Codex buddy r3). */
const CARD = `Confirm this reading of your target: ${READING}. Question being answered: ${QUESTION}`;
/** The AIE's agent note, verbatim from the ruling (a literal, so reverting the constant turns this red; Codex buddy r3). */
const NOTE = 'Nothing has changed yet. This card proposes confirming the saved target reading shown on it, as an answer to the stored question. '
  + 'Offer it only when the user’s actual source or bound answer supports that complete reading, including its quantity, unit, comparator, reference, '
  + 'denominator, period and conditions; matching a figure alone is insufficient. Show the full reading and question, never the proposal id. Use '
  + 'authorise_change only when the user’s bound approval for this shown card permits this proposal_id. It confirms the reading only; it does not change '
  + 'the underlying claim’s authorship or give permission to Run.';
const BUTTON = { label: 'Yes, read it that way', message: 'Yes, read my target that way.' };
const RECEIPT = `Confirmed the saved target reading: ${READING}. Your recorded answer was: “${CLARIFIED}”.`;
/** At least 10 %: the reconstructed second turn-14 call, as the hook passes it (`TARGET_OPERATOR[type]`, value, unit). */
const AT_LEAST_10 = { operator: '>=', value: 10, unit: '%' };
const goalOf = (body: Rec): Rec => (body.graph.nodes as Rec[]).find((n) => n.id === GOAL)!;

/** Exactly what the hook passes: the turn's context, the caller's own graph read, the goal, the requested target. */
function answer(body: Rec, requested: Rec = AT_LEAST_10, said = CLARIFIED, proposals = new ProposalStore()) {
  const p = heldChangeTargetAnswer({ scenario_id: String(body.scenario_id), user_id: null, user_text: userWordsOf([String(body.brief_text)], said),
    user_turn_text: said, graph: { graph_hash: String(body.graph_hash), raw: body.graph, nodes: body.graph.nodes }, goal_id: GOAL,
    requested: requested as never, rationale: 'The user clarified how the target is read.', proposals });
  return { p: p as Rec | undefined, proposals };
}

describe('G14: restating the saved change target is "already saved", never a refusal', () => {
  it('precondition: the 07:44 saved goal already encodes the relative reading, with no open question', () => {
    expect(goalOf(SAVED)).toMatchObject({ goal_threshold_frame: 'change_abs', goal_threshold_raw: 10, goal_threshold_unit: '%', goal_direction: '>=',
      goal_target_basis: { reference: 'today', denominator: 'today’s productivity', effect_unit: '% of today’s productivity', period_months: 3,
        period_kind: 'at_end', target_frame: 'change_abs', target_raw: 10 } });
    expect(goalOf(SAVED).goal_target_basis.open_question).toBeUndefined();
  });

  it('the real caller (proposeGoalTarget, with its hook): the turn-14 restatement is already saved, never goal_is_a_change', async () => {
    const d: InternalDispatch = async (p) => (p.endsWith('/graph') ? { status: 200, json: structuredClone(SAVED) } : { status: 500, json: {} });
    const out = await createAgentCapabilities(d, new ProposalStore()).proposeGoalTarget!({ scenario_id: String(SAVED.scenario_id),
      authenticated_user_id: null, request_id: 'r', user_text: userWordsOf([String(SAVED.brief_text)], CLARIFIED), user_turn_text: CLARIFIED } as never,
    { constraint_type: 'at_least', value: 10, unit: '%' } as never);
    expect(out).toMatchObject({ ok: true, mutated: false, already_saved: true });
    expect((out as Rec).refusal).toBeUndefined();
  });

  it('the real caller: a genuinely different target keeps the change-frame refusal, now with the saved meaning to compare', async () => {
    const said = "I mean 15% relative to today's productivity.";
    const d: InternalDispatch = async (p) => (p.endsWith('/graph') ? { status: 200, json: structuredClone(SAVED) } : { status: 500, json: {} });
    const out = await createAgentCapabilities(d, new ProposalStore()).proposeGoalTarget!({ scenario_id: String(SAVED.scenario_id),
      authenticated_user_id: null, request_id: 'r', user_text: userWordsOf([String(SAVED.brief_text)], said), user_turn_text: said } as never,
    { constraint_type: 'at_least', value: 15, unit: '%' } as never) as Rec;
    expect(out).toMatchObject({ ok: false, mutated: false, refusal: 'goal_is_a_change',
      saved_goal: { target_frame: 'change_abs', target_raw: 10, unit: '%', comparator: '>=', reference: 'today', denominator: 'today’s productivity' } });
  });

  it('RED→GREEN: the turn-14 restatement → ok, already_saved, nothing prepared, with the FULL saved meaning', () => {
    const { p, proposals } = answer(SAVED);
    expect(p, JSON.stringify(p)).toEqual({ ok: true, mutated: false, already_saved: true, saved_goal: {
      label: 'Productivity', target_frame: 'change_abs', target_raw: 10, unit: '%', comparator: '>=',
      reference: 'today', denominator: 'today’s productivity', effect_unit: '% of today’s productivity', period_months: 3, period_kind: 'at_end',
      also_required: ['maintaining code quality'],
    }, compared: ['target_frame', 'target_raw', 'unit', 'comparator'], not_compared: ['denominator', 'reference', 'period'],
    saved_reading: '‘Productivity’ up at least 10% from today at three months, measured against today’s productivity; also required, not part of '
      + 'this target: maintaining code quality', note: ALREADY_SAVED_NOTE });
    expect(proposals.outstanding(String(SAVED.scenario_id), null)).toEqual([]);
  });

  it('the held effect unit itself is the same target too ("% of today\'s productivity", either apostrophe)', () => {
    expect(answer(SAVED, { ...AT_LEAST_10, unit: "% of today's productivity" }).p).toMatchObject({ already_saved: true,
      compared: ['target_frame', 'target_raw', 'unit', 'comparator', 'denominator'], not_compared: ['reference', 'period'] });
  });

  it.each([
    ['a different figure (15%)', { ...AT_LEAST_10, value: 15 }, "I mean 15% relative to today's productivity."],
    ['the opposite comparator', { ...AT_LEAST_10, operator: '<=' }, "I mean at most 10% relative to today's productivity."],
    ['percentage points', { ...AT_LEAST_10, unit: 'percentage points' }, 'I mean 10 percentage points on the productivity score.'],
    ['another denominator', { ...AT_LEAST_10, unit: '% of revenue' }, "I mean 10% of revenue."],
  ])('CONTRAST: %s is not the saved target — the caller\'s refusal stands, and its saved meaning is there to compare', (_n, requested, said) => {
    const { p, proposals } = answer(SAVED, requested, said);
    expect(p).toBeUndefined();
    expect(proposals.outstanding(String(SAVED.scenario_id), null)).toEqual([]);
    expect(savedGoalMeaningOf(SAVED.graph, GOAL)).toMatchObject({ target_frame: 'change_abs', target_raw: 10, unit: '%', comparator: '>=',
      reference: 'today', denominator: 'today’s productivity', period_months: 3 });
  });

  it('BOUND (Codex buddy): the user says percentage points but the Agent passes "%" — the tool cannot tell, and says which members it did not compare', () => {
    const { p } = answer(SAVED, AT_LEAST_10, 'I mean 10 percentage points on the productivity score.');
    // "already saved" is a claim about the SAVED target only; the reading it holds rides beside it for the Agent to compare.
    expect(p).toMatchObject({ already_saved: true, not_compared: ['denominator', 'reference', 'period'],
      saved_goal: { denominator: 'today’s productivity', effect_unit: '% of today’s productivity', reference: 'today', period_months: 3 } });
  });

  it('CONTRAST: the same figure on a goal with no validated reading is never "already saved" (value alone never matches)', () => {
    const body = structuredClone(SAVED);
    delete goalOf(body).goal_target_basis;
    expect(answer(body).p).toBeUndefined();
  });
});

describe('G: the user\'s answer to the goal\'s open question reaches the saved reading through one card', () => {
  it('precondition: the 13:18 draft holds the relative reading AND its open question', () => {
    expect(goalOf(ASKED)).toMatchObject({ goal_threshold_frame: 'change_abs', goal_threshold_raw: 10, goal_threshold_unit: '%', goal_direction: '>=',
      goal_target_basis: { reference: 'today', effect_unit: '% of today\'s productivity', target_raw: 10, target_frame: 'change_abs',
        also_required: ['maintaining code quality', 'launch readiness'], open_question: QUESTION } });
  });

  it('RED→GREEN: the clarification over the asked draft → ONE confirm_goal_reading card with the user\'s verbatim answer; nothing written', () => {
    const { p, proposals } = answer(ASKED);
    expect(p, JSON.stringify(p)).toMatchObject({ ok: true, mutated: false, public_label: CARD, note: NOTE });
    expect(proposals.outstanding(String(ASKED.scenario_id), null).map((x) => x.proposal_id)).toEqual([p!.proposal_id]);
    expect(proposals.get(String(p!.proposal_id))?.operations).toEqual([{ op: 'confirm_goal_reading', path: GOAL,
      value: { expected_basis: goalOf(ASKED).goal_target_basis, open_question: QUESTION,
        expected_goal: { label: 'productivity', target: { raw: 10, cap: 200, unit: '%', frame: 'change_abs', comparator: '>=', comparator_source: 'goal_direction', source: 'brief_extraction' } },
        answer_words: CLARIFIED } }]);
    // The user authors the answer and the approval, never Olumi's reading: the card is the user's statement of which reading.
    expect(proposals.get(String(p!.proposal_id))?.provenance.authored_by).toBe('user_stated');
    expect(p!.saved_goal).toMatchObject({ open_question: QUESTION, also_required: ['maintaining code quality', 'launch readiness'] });
  });

  it('the card renders with its own button and its words in `detail`, only when the proposer\'s own result returned that card', () => {
    const { p, proposals } = answer(ASKED);
    const call = { name: 'propose_goal_target', ok: true, mutated: false, proposal_id: String(p!.proposal_id) };
    const chips = approvalChipsFor([call], () => ({ proposal: proposals.get(String(p!.proposal_id)), result: p as never }));
    expect(chips[0]).toEqual({ id: approvalChipIdFor(String(p!.proposal_id)), ...BUTTON, detail: CARD });
    expect(chips.map((c) => c.label)).not.toContain('Set this target');
    expect(approvalChipsFor([call], () => ({ proposal: proposals.get(String(p!.proposal_id)), result: { ...p!, public_label: 'other' } as never }))).toEqual([]);
  });

  it('EXACT (Codex buddy r3): the card says every digit of the saved figure — 0.125%, never "0.13%"', () => {
    const g = structuredClone(ASKED) as Rec;
    Object.assign(goalOf(g), { goal_threshold_raw: 0.125 });
    goalOf(g).goal_target_basis.target_raw = 0.125;
    const { p } = answer(g, { ...AT_LEAST_10, value: 0.125 }, "I mean 0.125% relative to today's productivity, not percentage points.");
    expect(p, JSON.stringify(p)).toMatchObject({ ok: true, mutated: false });
    expect(String(p!.public_label)).toContain('‘productivity’ up at least 0.125% from today at three months');
    expect(String(p!.public_label)).not.toContain('0.13%');
  });

  it('an unrelated value elsewhere in the same sentence is never quoted as the answer (strict reading of THIS turn)', () => {
    const said = 'Quality should stay at 10% and productivity should rise by 20%.';
    const { p, proposals } = answer(ASKED, AT_LEAST_10, said);
    // The card is offered (the brief states 10% about productivity: the press is the user's choice), but this turn is not credited.
    expect(p).toMatchObject({ ok: true, mutated: false, public_label: CARD });
    expect(Object.keys(proposals.get(String(p!.proposal_id))!.operations[0]!.value as Rec)).not.toContain('answer_words');
    expect(JSON.stringify(proposals.get(String(p!.proposal_id)))).not.toContain(said);
  });

  it('an answer that does not restate the figure ("Relative to today, not points.") still gets the card, unquoted', () => {
    const { p, proposals } = answer(ASKED, AT_LEAST_10, 'Relative to today, not points.');
    expect(p).toMatchObject({ ok: true, mutated: false, public_label: CARD });
    expect(Object.keys(proposals.get(String(p!.proposal_id))!.operations[0]!.value as Rec)).not.toContain('answer_words');
  });

  it('CONTRAST (mismatched reading): a percentage-points answer over the asked draft is not the held reading — no card, the refusal stands', () => {
    const { p, proposals } = answer(ASKED, { ...AT_LEAST_10, unit: 'percentage points' }, 'I mean 10 percentage points on a productivity score.');
    expect(p).toBeUndefined();
    expect(proposals.outstanding(String(ASKED.scenario_id), null)).toEqual([]);
    expect(savedGoalMeaningOf(ASKED.graph, GOAL)).toMatchObject({ open_question: QUESTION });
  });

  it('BOUND (Codex buddy): a points answer typed with "%" over the asked draft gets the card, whose words state the relative reading; nothing is written unpressed', () => {
    const { p, proposals } = answer(ASKED, AT_LEAST_10, 'I mean 10 percentage points on a productivity score.');
    expect(p!.public_label).toBe(CARD);
    expect(CARD).toContain('% from today at three months, measured against today\'s development productivity');
    expect(proposals.isApplied(String(p!.proposal_id))).toBe(false);
  });

  it('CONTRAST: admission\'s conditions refusal is not a question the user can answer — already saved, no card', () => {
    const body = structuredClone(ASKED);
    goalOf(body).goal_target_basis.open_question = CONDITIONS_NOT_KEPT;
    const { p, proposals } = answer(body);
    // The conditions refusal stays explicit: its sentence rides verbatim in the saved meaning, never cleared or hidden.
    expect(p).toMatchObject({ ok: true, mutated: false, already_saved: true, saved_goal: { open_question: CONDITIONS_NOT_KEPT } });
    expect(proposals.outstanding(String(ASKED.scenario_id), null)).toEqual([]);
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
    let unconfirm: false | 'before' | 'after' = false;
    let afterCommit: ((g: Rec) => void) | undefined;
    const commit = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
      commits.push(input);
      if (unconfirm === 'before') { unconfirm = false; return { status: 'unconfirmed' }; }
      const out = await executeOptionInterventionBatch({ scenarioId: String(body.scenario_id), turnId: input.turn_id, requestId: 'g-door',
        requestHash: `g:${input.turn_id}`, stage: 'frame', freshness: 'fresh', hasExistingAnalysis: true,
        expectedGraphHash: input.base_graph_hash, targets: [], goalReading: input.goal_reading }, store);
      if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
      if (out.kind === 'unchanged') return { status: 'committed', graph_hash: input.base_graph_hash, receipt: null, already_applied: true, committed_levels: [], links_resized: [] };
      if (out.kind !== 'committed') return { status: 'unconfirmed' };
      // The write landed, but its confirmation was lost on the way back.
      if (unconfirm === 'after') { unconfirm = false; return { status: 'unconfirmed' }; }
      // Another writer, after this commit and before the caller's read-back.
      if (afterCommit !== undefined) { const g = graph(); afterCommit(g); bytes = JSON.stringify(g); afterCommit = undefined; }
      return { status: 'committed', graph_hash: out.analysisGraphHash, receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
    };
    const dispatch: InternalDispatch = async (p) => {
      if (!p.endsWith('/graph')) return { status: 500, json: {} };
      return { status: 200, json: { ...structuredClone(body), graph: graph(), graph_hash: computeAnalysisAffectingGraphHash(graph() as never) } };
    };
    /** One process: its own proposal store; the card is issued by the module exactly as the hook will, on this read. */
    const open = () => {
      const proposals = new ProposalStore();
      const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels: commit });
      const card = () => answer({ ...body, graph: graph(), graph_hash: computeAnalysisAffectingGraphHash(graph() as never) }, AT_LEAST_10, CLARIFIED, proposals).p!;
      const press = (pid: string, user: string | null = null, pressed = true) => caps.authoriseChange({ scenario_id: String(body.scenario_id), authenticated_user_id: user,
        request_id: 'r-g', user_text: BUTTON.message, user_turn_text: BUTTON.message, turn_id: 'g-turn-2', ...(pressed ? { typed_approval_of: pid } : {}) } as never,
      { proposal_id: pid } as never) as Promise<Rec>;
      return { proposals, caps, card, press };
    };
    return { graph, rows, commits, store, open, setGraph: (g: Rec) => { bytes = JSON.stringify(g); }, unconfirmNext: (when: 'before' | 'after' = 'before') => { unconfirm = when; },
      afterCommitNext: (f: (g: Rec) => void) => { afterCommit = f; } };
  }
  /** The 13:18 graph with ONLY the question removed from the goal's reading: the one write's whole postimage. */
  const answered = (): Rec => { const g = structuredClone(ASKED.graph) as Rec; delete goalOf({ graph: g }).goal_target_basis.open_question; return g; };

  it('RED→GREEN: the pressed card writes ONE commit removing only the question; the read-back, receipt and row say so', async () => {
    const w = persisted(ASKED);
    const { card, press } = w.open();
    const c = card();
    const r = await press(String(c.proposal_id));
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, mutated: true, applied: true, proposal_id: c.proposal_id });
    expect(r.follow_up).toBe(RECEIPT);
    expect(w.commits).toHaveLength(1);
    expect(w.commits[0]!.goal_reading).toEqual({ goal_id: GOAL, expected_basis: goalOf(ASKED).goal_target_basis, answer_words: CLARIFIED,
      expected_goal: { label: 'productivity', target: { raw: 10, cap: 200, unit: '%', frame: 'change_abs', comparator: '>=', comparator_source: 'goal_direction', source: 'brief_extraction' } } });
    expect(w.rows).toHaveLength(1);
    // Byte equality: the whole postimage is the read with that one member gone; the reading's bytes, key order included.
    expect(w.graph()).toEqual(answered());
    expect(JSON.stringify(goalOf({ graph: w.graph() }).goal_target_basis)).toBe(JSON.stringify(answeredBasisOf(goalOf(ASKED).goal_target_basis)));
    expect(goalOf({ graph: w.graph() }).goal_target_basis).toMatchObject({ source: 'olumi_reading', effects_at_period_end: false,
      also_required: ['maintaining code quality', 'launch readiness'] });
    // The committed row keeps the user's verbatim answer (the existing history), beside the card that showed the question.
    expect(JSON.stringify(w.rows[0]!.write)).toContain(JSON.stringify(`“${CLARIFIED}”`).slice(1, -1));
    // The analysis hash moves (the reading is in it), so the stored Run is stale and the next Run reads the answered reading.
    expect(computeAnalysisAffectingGraphHash(w.graph() as never)).not.toBe(computeAnalysisAffectingGraphHash(ASKED.graph as never));
  });

  it('duplicate press: the same approval again writes nothing twice (one row) and says it was already applied', async () => {
    const w = persisted(ASKED);
    const { card, press } = w.open();
    const pid = String(card().proposal_id);
    expect(await press(pid)).toMatchObject({ ok: true, applied: true });
    expect(await press(pid)).toMatchObject({ ok: true, mutated: false, already_applied: true });
    expect(w.rows).toHaveLength(1);
  });

  it('failed write: a commit that cannot be confirmed gives no receipt and never says the answer was recorded', async () => {
    const w = persisted(ASKED);
    const { card, press, proposals } = w.open();
    const pid = String(card().proposal_id);
    w.unconfirmNext();
    const r = await press(pid);
    expect(r).toMatchObject({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed' });
    expect(r.follow_up).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('Confirmed the saved target reading');
    expect(proposals.isApplied(pid)).toBe(false);
    // It did not land, so the base is unchanged and a plain retry goes through again — never "superseded" (Codex buddy r2).
    expect(w.rows).toHaveLength(0);
    const retry = await press(pid);
    expect(retry, JSON.stringify(retry)).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(w.commits).toHaveLength(2);
    expect(w.rows).toHaveLength(1);
  });

  it('renamed after the commit (Codex buddy r3): the read-back holds another goal meaning → no receipt, never "confirmed" under new words', async () => {
    const w = persisted(ASKED);
    const { card, press, proposals } = w.open();
    const pid = String(card().proposal_id);
    w.afterCommitNext((g) => Object.assign(goalOf({ graph: g }), { label: 'Revenue', goal_direction: '<=' }));
    const r = await press(pid);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed' });
    expect(r.follow_up).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('Confirmed the saved target reading');
    expect(proposals.isApplied(pid)).toBe(false);
    expect(w.rows).toHaveLength(1);
  });

  it('landed but unconfirmed: the retry recovers through the writer\'s verified no-op — applied once, never "superseded" by its own write', async () => {
    const w = persisted(ASKED);
    const { card, press, proposals } = w.open();
    const pid = String(card().proposal_id);
    w.unconfirmNext('after');
    expect(await press(pid)).toMatchObject({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed' });
    expect(w.rows).toHaveLength(1);
    expect(w.graph()).toEqual(answered());
    const retry = await press(pid);
    expect(retry, JSON.stringify(retry)).toMatchObject({ ok: true, applied: true, mutated: false });
    expect(retry.follow_up).toBe(RECEIPT);
    expect(proposals.isApplied(pid)).toBe(true);
    expect(w.rows).toHaveLength(1);
  });

  it('typed, not pressed: the Agent reading a "yes" cannot approve this card (card-only) — nothing is written', async () => {
    const w = persisted(ASKED);
    const { card, press } = w.open();
    expect(await press(String(card().proposal_id), null, false)).toMatchObject({ ok: false, mutated: false, refusal: 'approval_required' });
    expect(w.rows).toHaveLength(0);
  });

  it.each([
    ['the goal renamed', (g: Rec) => { goalOf({ graph: g }).label = 'Team output'; }],
    ['the goal\'s unit changed', (g: Rec) => { goalOf({ graph: g }).goal_threshold_unit = 'points'; }],
  ])('stale meaning: %s after the card (the analysis hash need not move) → refused, nothing written', async (_n, change) => {
    const w = persisted(ASKED);
    const { card, press } = w.open();
    const pid = String(card().proposal_id);
    const moved = structuredClone(ASKED.graph) as Rec;
    change(moved);
    w.setGraph(moved);
    const r = await press(pid);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('Confirmed the saved target reading');
    expect(w.rows).toHaveLength(0);
    expect(w.graph()).toEqual(moved);
  });

  it('denied: another user\'s press is refused and nothing is written', async () => {
    const w = persisted(ASKED);
    const { card, press } = w.open();
    expect(await press(String(card().proposal_id), 'someone-else')).toMatchObject({ ok: false, mutated: false, refusal: 'not_authorised' });
    expect(w.rows).toHaveLength(0);
    expect(w.graph()).toEqual(ASKED.graph);
  });

  it('declined: the user answers the other reading instead — no card for it, the first card is never applied, nothing is written', async () => {
    const w = persisted(ASKED);
    const { proposals, card } = w.open();
    const first = card();
    expect(answer(ASKED, { ...AT_LEAST_10, unit: 'percentage points' }, 'No, I mean 10 percentage points.', proposals).p).toBeUndefined();
    expect(proposals.isApplied(String(first.proposal_id))).toBe(false);
    expect(w.rows).toHaveLength(0);
    expect(w.graph()).toEqual(ASKED.graph);
  });

  it('stale: the reading changed after the card was made (a condition edited) → nothing written, never a partial write', async () => {
    const w = persisted(ASKED);
    const { card, press } = w.open();
    const pid = String(card().proposal_id);
    const moved = structuredClone(ASKED.graph) as Rec;
    goalOf({ graph: moved }).goal_target_basis.also_required = ['maintaining code quality'];
    w.setGraph(moved);
    expect(await press(pid)).toMatchObject({ ok: false, refusal: 'superseded' });
    expect(w.rows).toHaveLength(0);
    expect(w.graph()).toEqual(moved);
  });

  it('conflict: another writer moved the model (a factor\'s level) after the card → a truthful conflict, nothing written', async () => {
    const w = persisted(ASKED);
    const { card, press } = w.open();
    const pid = String(card().proposal_id);
    const moved = structuredClone(ASKED.graph) as Rec;
    const factor = (moved.nodes as Rec[]).find((n) => n.kind === 'factor' && typeof n.observed_state?.value === 'number')!;
    factor.observed_state.value = factor.observed_state.value === 0.5 ? 0.6 : 0.5;
    w.setGraph(moved);
    expect(computeAnalysisAffectingGraphHash(moved as never)).not.toBe(computeAnalysisAffectingGraphHash(ASKED.graph as never));
    expect(await press(pid)).toMatchObject({ ok: false, mutated: false, refusal: 'superseded' });
    expect(w.rows).toHaveLength(0);
    expect(w.graph()).toEqual(moved);
  });

  it('reload: a fresh process reads the answered reading back — no question, no target-question withhold, a restatement is already saved', async () => {
    const w = persisted(ASKED);
    const first = w.open();
    await first.press(String(first.card().proposal_id));
    const reopened = JSON.parse(JSON.stringify(w.graph())) as Rec;
    expect(goalOf({ graph: reopened }).goal_target_basis.open_question).toBeUndefined();
    const stored = ASKED.analysis_result.enrichment as Rec;
    expect(withholdForOpenTargetQuestion(stored, ASKED.graph, GOAL)).not.toBe(stored);
    expect(withholdForOpenTargetQuestion(stored, reopened, GOAL)).toBe(stored);
    const again = w.open().card();
    expect(again).toMatchObject({ ok: true, mutated: false, already_saved: true });
    expect(again.saved_goal.open_question).toBeUndefined();
    expect(w.rows).toHaveLength(1);
  });

  it('the writer, directly: stale reading, an older card, the conditions question, a stale base and a compound edit are refused; a landed write is a no-op', async () => {
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
    expect(await executeOptionInterventionBatch({ ...base, expectedGraphHash: 'stale-base', goalReading: { goal_id: GOAL, expected_basis: expected } }, w.store))
      .toEqual({ kind: 'refused', reason: 'stale_graph' });
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
