/**
 * ⭐ RECOVERY BATCH B (B1, dates relative to a stated date). Paul's marketing test, 11 Oct
 * (`third-party-review/test2-marketing-transcript.txt` l.36–63):
 *
 *   Paul:  "We have 6 months to launch our new features from last Friday, and that's when the initial 3-month sales cycle starts."
 *   Olumi: "What exact date do you mean by “last Friday”?"
 *   Paul:  "Last Friday was the 9th of October."
 *   Olumi: "That identifies the starting date, but I couldn’t prepare the deadline from that clarification alone. …
 *           Could you state the full deadline as “six months from 9 October”, including the year?"
 *
 * The one calendar (`deadline-date.ts`) read only "N months from now/today". The rule (DL ruling, 12 Oct): read
 * "N months/weeks/days from <date or last <weekday>>". Paul's A2g ruling supersedes host weekday selection:
 * the host never chooses a weekday date; retain explicit dating or an AI-proposed date on an approval card.
 */
import { describe, expect, it } from 'vitest';
import { constructionOperationId } from '../../agent-lane/runtime/build-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { deadlineCardSubjectOf } from '../../agent-lane/proposal-object/still-applies.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { applyGoalHorizonEdit } from '../goal-horizon-write.js';
import { readStatedDeadline, readStatedWeekdayDate, sayDeadlineFromToday } from '../deadline-date.js';

type Rec = Record<string, any>;

/** Paul's words, verbatim from the transcript. */
const TURN_A = "We have 6 months to launch our new features from last Friday, and that's when the initial 3-month sales cycle starts.";
const TURN_B = 'Last Friday was the 9th of October.';
const SIX_FROM_9_OCT = 'six months from 9 October';
/** The deadline phrase of TURN_A, as the Agent quotes it (whole words of his message). */
const A_WORDS = '6 months to launch our new features from last Friday';
/** Sunday 11 October 2026: the draft's recorded day (the transcripts' day). */
const SUNDAY = '2026-10-11';
const MONDAY = '2026-10-12';

describe('the one calendar reads a count from a STATED day', () => {
  it('RED: "six months from 9 October" (11 Oct 2026) is 9 April 2027, 6 months from 9 October 2026 — never "from today", never a stated count from today', () => {
    const d = readStatedDeadline(SIX_FROM_9_OCT, SUNDAY);
    expect(d).toEqual({ words: SIX_FROM_9_OCT, form: 'months_from_date', date: '2027-04-09', reference: SUNDAY,
      anchor: { date: '2026-10-09', count: { value: 6, unit: 'months' } } });
    expect(sayDeadlineFromToday(d!)).toBe('6 months from 9 October 2026');
  });

  it('RED: "Last Friday was the 9th of October." dates last Friday (9 October 2026 IS a Friday), and the phrase counts from it', () => {
    const dated = readStatedWeekdayDate(TURN_B, SUNDAY);
    expect(dated).toEqual({ weekday: 'friday', date: '2026-10-09' });
    expect(readStatedDeadline(A_WORDS, SUNDAY, { lastWeekday: dated! })?.date).toBe('2027-04-09');
  });

  it('the host never selects a date for an undated "last Friday", on any reference weekday', () => {
    for (const reference of [SUNDAY, MONDAY, '2026-10-16']) {
      expect(readStatedDeadline(A_WORDS, reference)).toBeNull();
      expect(readStatedDeadline('2 weeks from last friday', reference)).toBeNull();
    }
    expect(readStatedDeadline(A_WORDS, MONDAY, { relativeWeekdays: false })).toBeNull();
    // The user's dating of a DIFFERENT weekday is not this one's.
    expect(readStatedDeadline(A_WORDS, SUNDAY, { lastWeekday: { weekday: 'monday', date: '2026-10-05' } })).toBeNull();
  });

  it('a start day without a year is the reference year\'s and is NEVER rolled into next year: a count that then ends in the past is asked', () => {
    expect(readStatedDeadline('one month from 9 January', SUNDAY)).toBeNull();
    expect(readStatedDeadline('six months from 9 October 2025', SUNDAY)).toBeNull();
    expect(readStatedDeadline('six months from 9 October 2026', SUNDAY)?.date).toBe('2027-04-09');
    expect(readStatedDeadline('two weeks from 9 November', SUNDAY)?.date).toBe('2026-11-23');
    expect(readStatedDeadline('6 months from the 31st of August', SUNDAY)?.date).toBe('2027-02-28');
  });

  it.each([
    ['a dating that is not that weekday', () => readStatedWeekdayDate('Last Friday was the 8th of October.', SUNDAY)],
    ['a day the month does not have', () => readStatedDeadline('six months from 31 September', SUNDAY)],
    ['a start that is not a day', () => readStatedDeadline('6 months to recover from the outage', SUNDAY)],
    ['"next sprint"', () => readStatedDeadline('6 months from next sprint', SUNDAY)],
    ['a duration that is not a deadline', () => readStatedDeadline('recruitment will take more than 3 months', SUNDAY)],
  ])('never guessed: %s → null', (_what, read) => { expect(read()).toBeNull(); });

  it('CONTROL: the forms counted from today are unchanged, byte for byte', () => {
    expect(readStatedDeadline('a deadline in 6 months', '2026-10-07')).toEqual({ words: 'a deadline in 6 months', form: 'months_from_today',
      date: '2027-04-07', reference: '2026-10-07', stated_count: { value: 6, unit: 'months' } });
    expect(readStatedDeadline('6 months from now', '2026-10-07')).toEqual(expect.objectContaining({ form: 'months_from_today', date: '2027-04-07' }));
  });

  it('"N months to <what> from today" is a count from today, as "from today" always was', () => {
    expect(readStatedDeadline('6 months to launch from today', '2026-10-07')).toEqual(expect.objectContaining({ form: 'months_from_today', date: '2027-04-07', stated_count: { value: 6, unit: 'months' } }));
  });
});

// ---------------------------------------------------------------------------
// The door (`propose_goal_deadline`) on Paul's marketing model, its draft recorded on Sunday 11 October 2026.
// ---------------------------------------------------------------------------
const SCENARIO = '9b2a7c11-4d3e-4f50-8a6b-7c8d9e0f1a2b';
const BRIEF = "Should I hire a marketing manager, or use an AI tool to plan the campaign for the next product feature launch, and use the money I'd save to spend more on advertising? Our budget for the year is £100,000. I can't spend more than 25% of my time on this, and I'm not that experienced with marketing.";
const GOAL_ID = 'feature_launch_campaign_completion';

function marketingGraph(): Rec {
  const e = (from: string, to: string, mean = 0.5) => ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: mean < 0 ? 'negative' : 'positive' });
  const g = {
    goal_node_id: GOAL_ID,
    nodes: [
      { id: 'dec_plan', kind: 'decision', label: 'Hire a marketing manager or use an AI tool?' },
      { id: GOAL_ID, kind: 'goal', label: 'Feature launch campaign completion', goal_threshold_unit: '%', goal_threshold_frame: 'level' },
      { id: 'opt_manager', kind: 'option', label: 'Hire Marketing Manager', interventions: { fac_plan_quality: { value: 0.6, raw_value: 60 } } },
      { id: 'opt_ai', kind: 'option', label: 'Use an AI planning tool', interventions: { fac_plan_quality: { value: 0.5, raw_value: 50 } } },
      { id: 'fac_plan_quality', kind: 'factor', label: 'Campaign plan quality', category: 'controllable', observed_state: { value: 0.4, raw_value: 40, unit: 'score', cap: 100 } },
    ],
    edges: [e('dec_plan', 'opt_manager', 1), e('dec_plan', 'opt_ai', 1), e('opt_manager', 'fac_plan_quality', 1), e('opt_ai', 'fac_plan_quality', 1), e('fac_plan_quality', GOAL_ID)],
  };
  return assignEntityRefs(projectGraphForPersistence(g), { nodes: [], edges: [] }).graph as Rec;
}

function door(draftAt = '2026-10-11T10:00:00Z') {
  const graph = marketingGraph();
  const proposals = new ProposalStore();
  const dispatch: InternalDispatch = async (path) => {
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [{ version_id: 'draft-v1', sequence: 1, created_at: draftAt,
      creation: { kind: 'initial', source_turn_id: registrationTurnId(SCENARIO, constructionOperationId(SCENARIO, BRIEF)) } }] } };
    if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch: ${path}`);
    return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never), brief_text: BRIEF } };
  };
  // The turn's clock is a day later than the draft: the reference is the RECORDED draft day, never the clock.
  const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { now: () => new Date('2026-10-12T09:00:00Z') });
  return { caps, proposals, graph };
}
const saying = (thisMessage: string, earlier: readonly string[] = []) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'deadline-b',
  user_text: [...earlier, thisMessage].join('\n'), user_turn_text: thisMessage });

describe('the deadline door on Paul\'s marketing turns', () => {
  it('RED (Paul\'s second turn): "Last Friday was the 9th of October." places his first turn\'s deadline — the card "Is your deadline 9 April 2027 (6 months from 9 October 2026)?"', async () => {
    const d = door();
    const r = await d.caps.proposeGoalDeadline!(saying(TURN_B, [TURN_A]), { deadline_words: A_WORDS, rationale: TURN_B }) as Rec;
    // ⛔ DLf5 (#2997 Codex check, DL rule): EXPECTATION CHANGED, old "Your words: …" / user_stated → new "… Olumi’s
    // interpretation; check the date and reference before approving." / model_proposed. His first turn holds two durations
    // ("6 months … from last Friday", "the initial 3-month sales cycle"), so which is the deadline is Olumi's reading for
    // him to check. The date (9 April 2027), the reference and the saved horizon are unchanged.
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, public_label: 'Is your deadline 9 April 2027 (6 months from 9 October 2026)? Your words: “6 months to launch our new features from last Friday”. Olumi’s interpretation; check the date and reference before approving. Basis supplied for this interpretation: ' + TURN_B }));
    expect(d.proposals.get(String(r.proposal_id))!.provenance).toEqual({ authored_by: 'model_proposed', basis: TURN_B });
    expect(r.deadline.words).toBe(A_WORDS);
    expect(d.graph.nodes.find((n: Rec) => n.id === GOAL_ID).goal_horizon).toBeUndefined();
    const op = d.proposals.get(String(r.proposal_id))!.operations[0]!;
    // The horizon is measured from the recorded draft day (11 Oct), so the count from 9 Oct is NOT its length.
    expect(op).toEqual({ op: 'set_goal_deadline', path: GOAL_ID, value: { deadline: '2027-04-09', expected_deadline: null, words: A_WORDS, reference: SUNDAY,
      expected_goal: deadlineCardSubjectOf(d.graph, GOAL_ID) } });
    const applied = applyGoalHorizonEdit(d.graph, { goal_id: GOAL_ID, deadline: '2027-04-09', expected_deadline: null, reference_date: SUNDAY });
    expect(applied.kind).toBe('mutated');
    if (applied.kind === 'mutated') expect((applied.mutatedGraph.nodes as Rec[]).find((n) => n.id === GOAL_ID)).toEqual(expect.objectContaining({
      goal_horizon: { deadline: '2027-04-09' }, goal_horizon_months: 5, goal_horizon_reference_date: SUNDAY }));
  });

  it('RED: "six months from 9 October", typed, is the same card', async () => {
    const d = door();
    const said = "Let's say six months from 9 October.";
    const r = await d.caps.proposeGoalDeadline!(saying(said, [TURN_A, TURN_B]), { deadline_words: SIX_FROM_9_OCT, rationale: said }) as Rec;
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, public_label: 'Is your deadline 9 April 2027 (6 months from 9 October 2026)? Your words: “six months from 9 October”.' }));
    expect(d.proposals.get(String(r.proposal_id))!.provenance).toEqual({ authored_by: 'user_stated', basis: said });
    expect(r.deadline.words).toBe(SIX_FROM_9_OCT);
    expect(d.graph.nodes.find((n: Rec) => n.id === GOAL_ID).goal_horizon).toBeUndefined();
  });

  it('Paul\'s first turn, on a Sunday draft: "last Friday" is asked about — with the words to call again with — never chosen', async () => {
    const d = door();
    const r = await d.caps.proposeGoalDeadline!(saying(TURN_A), { deadline_words: A_WORDS, rationale: TURN_A }) as Rec;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'deadline_not_placed' }));
    expect(String(r.detail)).toContain('which date "last friday"');
    expect(String(r.detail)).toContain('Ask which date the user means. Once they explicitly date that weekday, call propose_goal_deadline with the original deadline_words. Never invent or offer a start date.');
    expect(d.proposals.outstanding(SCENARIO, null)).toHaveLength(0);
    expect(d.graph.nodes.find((n: Rec) => n.id === GOAL_ID).goal_horizon).toBeUndefined();
    // Same words, no AI date/reference: Monday must also ask, never choose a weekday.
    const monday = door('2026-10-12T10:00:00Z');
    const m = await monday.caps.proposeGoalDeadline!(saying(TURN_A), { deadline_words: A_WORDS, rationale: TURN_A }) as Rec;
    expect(m, JSON.stringify(m)).toEqual(expect.objectContaining({ ok: false, refusal: 'deadline_not_placed' }));
    expect(monday.proposals.outstanding(SCENARIO, null)).toHaveLength(0);
    expect(monday.graph.nodes.find((n: Rec) => n.id === GOAL_ID).goal_horizon).toBeUndefined();
  });

  it('an explicit AI interpretation shows the source, proposed date and references without writing or becoming human-authored', async () => {
    const d = door();
    const before = JSON.stringify(d.graph);
    const basis = `${TURN_A} Olumi interprets last Friday as 9 October 2026, using the recorded reference 11 October 2026; six months from that start is 9 April 2027.`;
    const r = await d.caps.proposeGoalDeadline!(saying(TURN_A), {
      deadline_words: A_WORDS, deadline_date: '2027-04-09', rationale: basis,
    }) as Rec;
    expect(r).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(r.public_label).toBe('Is your deadline 9 April 2027 (about 5.9 months from 11 October 2026)? Your words: “6 months to launch our new features from last Friday”. Olumi’s interpretation; check the date and reference before approving. Basis supplied for this interpretation: ' + basis);
    const proposal = d.proposals.get(String(r.proposal_id))!;
    expect(proposal.provenance).toEqual({ authored_by: 'model_proposed', basis });
    expect(proposal.operations).toEqual([{ op: 'set_goal_deadline', path: GOAL_ID,
      value: { deadline: '2027-04-09', expected_deadline: null, words: A_WORDS, reference: SUNDAY, expected_goal: deadlineCardSubjectOf(d.graph, GOAL_ID) } }]);
    expect(JSON.stringify(d.graph)).toBe(before);
    // Removing the AI-supplied date and interpretation leaves the same human words unresolved.
    const without = door();
    const refused = await without.caps.proposeGoalDeadline!(saying(TURN_A), { deadline_words: A_WORDS, rationale: TURN_A }) as Rec;
    expect(refused).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'deadline_not_placed' }));
    expect(without.proposals.outstanding(SCENARIO, null)).toHaveLength(0);
    expect(JSON.stringify(without.graph)).toBe(before);
  });

  it.each([
    ['an earlier ambiguous weekday this message does not date', 'Yes, add the AI tool option.', 'deadline_not_placed'],
    ['a dating that is not that weekday', 'Last Friday was the 8th of October.', 'deadline_not_placed'],
    ['a dating of another weekday', 'Last Monday was the 5th of October.', 'deadline_not_placed'],
  ])('refused, nothing prepared: %s', async (_what, thisMessage, refusal) => {
    const d = door();
    const r = await d.caps.proposeGoalDeadline!(saying(thisMessage, [TURN_A]), { deadline_words: A_WORDS, rationale: thisMessage }) as Rec;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal }));
    expect(d.proposals.get(String(r.proposal_id))).toBeUndefined();
  });
});
