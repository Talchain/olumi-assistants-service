/**
 * ⭐ S-E GOALS, SLICE 1 (lane GOALS, DL 0fd71f, 7 Oct): a chance is never a goal quantity, and a stated deadline is
 * proposed as a date in the same turn. Spec: Science ruling `inflight/science-deadline-ruling-20261007.md` §2 (guard)
 * and §3 (dates); Paul's prod test item 6 ("Olumi should have computed the date 6 months from now and asked whether that
 * is the deadline, as part of the update").
 *
 * RED rows come from the SERVED prod record of scenario 6582edbc (CEE 7e3f8fb2): the run fact of 08:43:37Z (turn 1's
 * "What is it, in % likelihood of on-time launch?"), the run fact of 09:32:39Z (a "probability" whose p10 is below zero),
 * turn 7's "What figure should … reach or stay under?", and Paul's 09:13 words "we have a deadline in 6 months … That
 * should be clear in our goal" (forensics D-01; the elided middle is not in the record, so the two quoted fragments are
 * used as written).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scalingRatio } from '../../../../tests/helpers/scaling-ratio.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { approvalChipsFor, DEADLINE_CHANGE_CHIP } from '../../agent-lane/approval-chips.js';
import { placeholderGoalWarning } from '../../agent-lane/goal-certainty.js';
import { decisionInputLines, isDecisionInputAsk } from '../../agent-lane/decision-input-ask.js';
import { goalChanceWithheldForAgent } from '../../agent-lane/goal-chance-withheld.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import type { SessionTurnWrite } from '../../session/store.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import { applyGoalHorizonEdit, goalHorizonPostimageIsScoped } from '../goal-horizon-write.js';
import { withholdGoalFiguresForChanceGoal } from '../../tools/handlers/run-analysis.js';
import { GOAL_FIGURES_CHANCE_AS_GOAL, GOAL_FIGURES_PLACEHOLDER_PATH, runWithheldGoalFigures } from '../../../orchestrator/context/option-result-source.js';
import { CHANCE_WORD, chanceGoalSentence, goalKindOf, SCALE_NOTE, UNIT_HEAD_CUT, unitNamesAChance } from '../goal-kind.js';
import { addMonths, DEADLINE_PATTERNS_FOR_TIMING, readStatedDeadline, sayDate, timeBetween, todayInLondon } from '../deadline-date.js';

type Rec = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/s-e-goals/served-6582edbc-run1.json', import.meta.url), 'utf8')) as Rec;
const GOAL_ID = 'meet_our_next_feature_launch_deadline';
const SCENARIO = '6582edbc-9572-4f97-8fdb-d225072efa8a';
const CHANCE_SENTENCE = 'Olumi works out the chance of meeting your deadline; it needs the date and what must be done by then.';
/** Paul's 09:13 words, the two fragments the forensics quotes verbatim (D-01). */
const PAUL_0913 = 'we have a deadline in 6 months. That should be clear in our goal';

/** The served v1 model (run 1's input snapshot): the goal as served, the options' levels, the factors' levels, the links. */
function servedGraph(goalUnit: string = SERVED.goal.unit): Rec {
  const factors = (SERVED.factors as Rec[]).filter((f) => f.factor_id !== GOAL_ID);
  const nodes: Rec[] = [
    { id: 'decision_meet_our_next_feature_launch_deadline', kind: 'decision', label: 'Hire a tech lead or two developers?' },
    { id: GOAL_ID, kind: 'goal', label: SERVED.goal.label, goal_threshold_unit: goalUnit, goal_threshold_frame: 'level' },
    ...(SERVED.options as Rec[]).map((o) => ({ id: o.option_id, kind: 'option', label: o.label,
      interventions: Object.fromEntries((o.settings as Rec[]).map((s) => [s.factor_id, { value: s.encoded, raw_value: s.raw }])) })),
    ...factors.map((f) => ({ id: f.factor_id, kind: 'factor', label: f.label,
      observed_state: { value: f.encoded, raw_value: f.raw, unit: f.unit, ...(f.encoded > 0 ? { cap: f.raw / f.encoded } : {}), source: f.source } })),
    { id: 'new_hire_onboarding_disruption', kind: 'risk', label: 'New-hire Onboarding Disruption' },
    { id: 'feature_delivery_capacity', kind: 'outcome', label: 'Feature Delivery Capacity' },
  ];
  const edges = (SERVED.links as Rec[]).map((l) => ({ from: l.from, to: l.to, strength: { mean: l.mean, std: l.std },
    exists_probability: l.exists_probability, effect_direction: l.mean < 0 ? 'negative' : 'positive',
    ...(l.sizing === 'unmarked' && l.band !== 'very_strong' ? { defaulted: true, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } } : {}) }));
  return { goal_node_id: GOAL_ID, nodes, edges };
}
const servedPaths = (): Rec[] => (SERVED.served_placeholder_warning.option_ids as string[])
  .map((option_id) => ({ option_id, links: SERVED.served_placeholder_warning.links }));

describe('§2 guard (Science ruling 7 Oct): a unit naming the chance of an event is never a goal quantity', () => {
  it.each(['% likelihood of on-time launch', 'chance of hitting the date', 'probability of launch on time', '% likely', 'Odds of shipping',
    'on-time launch likelihood', 'probability (%)', 'Chances of shipping by Q2', 'probability (0-1)', 'likelihood (0–100%)', 'percentage chance'])(
    'must-fire: %s', (unit) => {
      expect(unitNamesAChance(unit)).toBe(true);
      expect(goalKindOf({ kind: 'goal', goal_threshold_unit: unit })).toBe('chance_of_event');
    });
  it.each(['% of launch done', '% of customers', 'churn %', '£', 'months', 'feature points per month', 'unlikelihoodish',
    'number of chances created per match', 'chances created per match', '%'])(
    'must-not-fire: %s', (unit) => {
      expect(unitNamesAChance(unit)).toBe(false);
      expect(goalKindOf({ kind: 'goal', goal_threshold_unit: unit })).toBe('level');
    });
  it('Codex r1: a chance in the LEVEL\u2019s unit is not masked by a plain "%" target unit', () => {
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: '%', observed_state: { unit: '% likely' } })).toBe('chance_of_event');
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: '%', observed_state: { unit: '% of launch done' } })).toBe('level');
  });
  it('the served goal (run 1 input snapshot) is a chance goal; a change frame stays a change', () => {
    expect(goalKindOf(servedGraph().nodes[1])).toBe('chance_of_event');
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: '%', goal_threshold_frame: 'change_rel' })).toBe('change');
  });
});

describe('§3 dates (Science ruling 7 Oct): deterministic, Europe/London, month-end clamped, British words', () => {
  it('ruling row 4: "6 months" on 31 Aug is 28 Feb (clamp), and 29 Feb in a leap year; "end of Q2" is 30 Jun', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
    expect(readStatedDeadline('6 months', '2026-08-31')?.date).toBe('2027-02-28');
    expect(readStatedDeadline('end of Q2', '2026-10-07')?.date).toBe('2027-06-30');
  });
  it("Paul's words on 7 Oct 2026 are 7 April 2027, 6 months from today, as a stated count", () => {
    const d = readStatedDeadline('a deadline in 6 months', '2026-10-07');
    expect(d).toEqual({ words: 'a deadline in 6 months', form: 'months_from_today', date: '2027-04-07', reference: '2026-10-07',
      stated_count: { value: 6, unit: 'months' } });
    expect(sayDate(d!.date)).toBe('7 April 2027');
  });
  it.each([
    ['6-month deadline', '2027-04-07'], ['six months', '2027-04-07'], ['within 12 weeks', '2026-12-30'], ['by the end of March', '2027-03-31'],
    ['7 April 2027', '2027-04-07'], ['April 7, 2027', '2027-04-07'], ['end of the year', '2026-12-31'], ['a month', '2026-11-07'],
  ])('"%s" → %s', (words, date) => { expect(readStatedDeadline(words, '2026-10-07')?.date).toBe(date); });
  it.each(['next sprint', 'soon', 'recruitment will take more than 3 months', 'the end of next quarter', '1 October 2026', '0 months',
    'before March', 'until March', 'before Q2', 'till 7 April 2027'])(
    'never guessed: "%s" → null', (words) => { expect(readStatedDeadline(words, '2026-10-07')).toBeNull(); });
  it("today is London's day: 23:30Z on 6 April 2027 (BST) is 7 April; in winter, UTC's day", () => {
    expect(todayInLondon(new Date('2027-04-06T23:30:00Z'))).toBe('2027-04-07');
    expect(todayInLondon(new Date('2027-01-06T23:30:00Z'))).toBe('2027-01-06');
  });
  it('the time from today in the goal unit: 7 Oct → 31 Mar is 5 months and 24 of the next 31 days', () => {
    expect(timeBetween('2026-10-07', '2027-03-31', 'months')).toBe(5.77);
    expect(timeBetween('2026-10-07', '2027-04-07', 'months')).toBe(6);
    expect(timeBetween('2026-10-07', '2026-12-30', 'weeks')).toBe(12);
  });
});

describe('turn 1 (served 08:43:37Z): no "today’s level" of a chance, and no link into it offered', () => {
  it('RED on df15c8c1: the served shape asked "What is it, in % likelihood of on-time launch?" as the typed first ask', () => {
    const w = placeholderGoalWarning(servedGraph(), servedPaths() as never, GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(w.first_ask).toBeUndefined();
    expect(w.acceptable_links).toBeUndefined();
    expect(w.message).toBe(CHANCE_SENTENCE);
    expect(w.message).not.toMatch(/today’s level|likelihood of on-time launch/);
  });
  it('CONTROL: the same model measured as "% of launch done" keeps the level ask (a quantity, not a chance)', () => {
    const w = placeholderGoalWarning(servedGraph('% of launch done'), servedPaths() as never, GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(w.first_ask).toEqual(expect.objectContaining({ kind: 'goal_level', node_id: GOAL_ID }));
    expect(w.message).toMatch(/I first need today’s level of .*What is it, in % of launch done\?$/);
  });
});

describe('turn 7 (served 09:17:15Z): the one question for a chance goal is its deadline, never a target figure', () => {
  const ask = (g: Rec): string | undefined => decisionInputLines(g, { restingText: '', questionsToggle: false, awaitingApproval: false, builtOrRan: true })
    .find(isDecisionInputAsk);
  it('RED on df15c8c1: "What figure should … reach or stay under? I\'ll propose it as your target."', () => {
    expect(ask(servedGraph())).toBe('What is the deadline for "meet our next feature-launch deadline"? A date or a time from now is fine, '
      + 'for example "6 months"; I\'ll propose it as your deadline.');
  });
  it('a chance goal that already holds its date is asked nothing more here', () => {
    const g = servedGraph();
    g.nodes[1].goal_horizon = { deadline: '2027-04-07' };
    expect(ask(g)).toBeUndefined();
  });
  it('CONTROL: a quantity goal keeps its target ask, byte for byte', () => {
    expect(ask(servedGraph('% of launch done'))).toBe('What figure should "meet our next feature-launch deadline" reach or stay under? I\'ll propose it as your target.');
  });
});

describe('run 3 (served 09:32:39Z): a chance goal’s figures are withheld for every option, said once', () => {
  const envelope = (): Rec => ({ option_comparison: structuredClone(SERVED.served_run3_option_comparison.option_comparison), inference_warnings: [] });
  it('RED on df15c8c1: the baseline’s "probability" with p10 below zero is no longer served; every option is named', () => {
    const before = envelope();
    expect(before.option_comparison.find((o: Rec) => o.option_id === 'carry_on_as_now').outcome.p10).toBeLessThan(0);
    const out = withholdGoalFiguresForChanceGoal(before, servedGraph()) as Rec;
    for (const o of out.option_comparison as Rec[]) {
      expect(o.outcome?.mean, o.option_id).toBeUndefined();
      expect(o.outcome?.p10, o.option_id).toBeUndefined();
      expect(o.probability_of_goal, o.option_id).toBeUndefined();
      expect(o.win_probability, o.option_id).toBeUndefined();
    }
    const w = (out.inference_warnings as Rec[]).filter((x) => x.code === GOAL_FIGURES_CHANCE_AS_GOAL);
    expect(w).toHaveLength(1);
    expect(w[0]).toEqual(expect.objectContaining({ severity: 'warning', message: CHANCE_SENTENCE, node_ids: [GOAL_ID],
      option_ids: ['hire_a_tech_lead', 'hire_two_developers', 'carry_on_as_now', 'c3d38027'] }));
    expect(runWithheldGoalFigures(out)).toBe(true);
    // The Agent says the one sentence, under the chance note, never a placeholder ask.
    const said = goalChanceWithheldForAgent({ enrichment: out });
    expect(said).toEqual(expect.objectContaining({ withheld: true, say: CHANCE_SENTENCE }));
    expect(said?.note).toMatch(/never treats as a quantity/);
  });
  it('Codex r1: beside an identical-arms withhold, the chance sentence still speaks alone', () => {
    const out = withholdGoalFiguresForChanceGoal(envelope(), servedGraph()) as Rec;
    out.inference_warnings.push({ code: 'GOAL_FIGURES_OPTIONS_IDENTICAL', severity: 'warning', message: 'Not shown. A and B come out the same.',
      option_ids: ['hire_a_tech_lead', 'hire_two_developers'] });
    expect(goalChanceWithheldForAgent({ enrichment: out })?.say).toBe(CHANCE_SENTENCE);
  });
  it('with the date held, the sentence names it; the date never becomes a figure', () => {
    const g = servedGraph();
    g.nodes[1].goal_horizon = { deadline: '2027-04-07' };
    const out = withholdGoalFiguresForChanceGoal(envelope(), g) as Rec;
    expect(out.inference_warnings[0].message).toBe(chanceGoalSentence('7 April 2027'));
  });
  it('CONTROL: a quantity goal returns the envelope itself (identity)', () => {
    const e = envelope();
    expect(withholdGoalFiguresForChanceGoal(e, servedGraph('% of launch done'))).toBe(e);
  });
});

/** The real proposer, card, approval and commit door over a serialized SessionStore (link-effect-gauge-door's world). */
function world(initial: Rec, now = new Date('2026-10-07T09:13:13Z'), opts: { readonly unconfirmFirst?: boolean } = {}) {
  let graphJson = JSON.stringify(initial);
  const graph = () => JSON.parse(graphJson) as Rec;
  const proposals = new ProposalStore();
  const rows: { id: string; write: SessionTurnWrite }[] = [];
  const store = createMockSessionStore({
    loadGraph: async () => graph(),
    loadGraphAndBriefText: async () => ({ graph: graph(), briefText: null }),
    readExistingScenario: async () => ({ userId: null, graph: graph(), briefText: null, analysisInvalidatedAt: null }),
    readMostRecentPendingActions: async () => [],
    readAnalysisInvalidatedAt: async () => null,
    getScenarioOwner: async () => null,
    append: async (write) => {
      const s = JSON.parse(JSON.stringify(write)) as SessionTurnWrite;
      const id = `deadline-row-${rows.length + 1}`;
      rows.push({ id, write: s });
      if (s.graph !== undefined) graphJson = JSON.stringify(s.graph);
      return { id };
    },
    readRecent: async () => rows.map(({ id, write }) => makeSessionTurnRow({ id, scenario_id: write.scenario_id,
      turn_id: write.turn_id, turn_class: write.turn_class, handler_id: write.handler_id,
      request_hash: write.request_hash, response_emitted: write.response_emitted,
      llm_calls_used: write.llm_calls_used, duration_ms: write.duration_ms })),
    readFactsWithTurnFor: async (ids) => rows.filter((row) => ids.includes(row.id)).flatMap(({ id, write }) =>
      write.handler_facts.map((fact) => ({ turn_id: id, fact_created_at: '2026-10-07T09:14:00.000Z', fact }))),
  });
  const commits: CommitOptionLevelsInput[] = [];
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    commits.push(input);
    const unconfirm = opts.unconfirmFirst === true && commits.length === 1;
    const out = await executeOptionInterventionBatch({ scenarioId: input.scenario_id, turnId: input.turn_id,
      requestId: 'deadline-real-commit', requestHash: `deadline:${input.turn_id}`, stage: 'frame',
      freshness: 'fresh', hasExistingAnalysis: false, expectedGraphHash: input.base_graph_hash, targets: [],
      ...(input.goal_horizon !== undefined ? { goalHorizon: input.goal_horizon } : {}),
    }, store);
    if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
    // The door's own mapping of a verified no-op (`commitOptionLevelsInProcess`: `verified_no_op` → already applied).
    if (out.kind === 'unchanged') return { status: 'committed', graph_hash: input.base_graph_hash, receipt: null, already_applied: true, committed_levels: [], links_resized: [] };
    if (out.kind !== 'committed') throw new Error(`Real commit did not verify: ${JSON.stringify(out)}`);
    // The write LANDED, but this attempt cannot confirm it (a lost response).
    if (unconfirm) return { status: 'unconfirmed' };
    return { status: 'committed', graph_hash: out.analysisGraphHash, receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
  };
  const dispatch: InternalDispatch = async (path) => {
    if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch: ${path}`);
    const read = graph();
    return { status: 200, json: { graph: read, graph_hash: computeAnalysisAffectingGraphHash(read as never) } };
  };
  return { caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels, now: () => now }), proposals, commits, graph,
    commitOptionLevels };
}
const stored = (g: Rec = servedGraph()): Rec => assignEntityRefs(projectGraphForPersistence(g), { nodes: [], edges: [] }).graph as Rec;
const ctxSaying = (user_text: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'deadline', user_text, user_turn_text: user_text });
const goalOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.id === GOAL_ID);

describe('turn 5 (Paul 09:13Z): the stated deadline is proposed as a date in the SAME turn, and the Yes writes it', () => {
  it('RED on df15c8c1 (no door): propose → card "Is your deadline 7 April 2027 (6 months from today)?" [Yes] [Change date] → REAL door → stored → read-back', async () => {
    const w = world(stored());
    const hashBefore = computeAnalysisAffectingGraphHash(w.graph() as never);
    const r = await w.caps.proposeGoalDeadline!(ctxSaying(PAUL_0913), { deadline_words: 'a deadline in 6 months', rationale: PAUL_0913 }) as Rec;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.public_label).toBe('Is your deadline 7 April 2027 (6 months from today)?');
    const chips = approvalChipsFor([{ name: 'propose_goal_deadline', ok: true, mutated: false, proposal_id: String(r.proposal_id) }],
      (id) => ({ proposal: w.proposals.get(id), result: r as never }));
    expect(chips.map((c) => c.label)).toEqual(['Yes', 'Change date']);
    expect(chips[0]!.detail).toBe('Is your deadline 7 April 2027 (6 months from today)?');
    expect(chips[1]).toEqual(DEADLINE_CHANGE_CHIP);
    // Nothing is written by the proposal.
    expect(goalOf(w.graph()).goal_horizon).toBeUndefined();
    const out = await w.caps.authoriseChange({ ...ctxSaying(chips[0]!.message), typed_approval_of: String(r.proposal_id),
      typed_approval_words: chips[0]!.message }, { proposal_id: String(r.proposal_id) }) as Rec;
    expect(out, JSON.stringify(out)).toEqual(expect.objectContaining({ ok: true, applied: true,
      follow_up: 'Your deadline for "meet our next feature-launch deadline" is now 7 April 2027.' }));
    expect(w.commits).toHaveLength(1);
    expect(w.commits[0]!.goal_horizon).toEqual({ goal_id: GOAL_ID, deadline: '2027-04-07', expected_deadline: null });
    const after = w.graph();
    expect(goalOf(after).goal_horizon).toEqual({ deadline: '2027-04-07' });
    // ONLY the date moved: the analysis revision and every other byte of the goal are unchanged.
    expect(computeAnalysisAffectingGraphHash(after as never)).toBe(hashBefore);
    const { goal_horizon: _h, ...rest } = goalOf(after);
    expect(rest).toEqual(goalOf(stored()));
  });
  it('a later card names what it replaces, and a stale card (the date moved since) writes nothing', async () => {
    const g = servedGraph();
    g.nodes[1].goal_horizon = { deadline: '2027-04-07' };
    const w = world(stored(g));
    const r = await w.caps.proposeGoalDeadline!(ctxSaying('Actually the deadline is end of March.'), { deadline_words: 'end of March', rationale: 'x' }) as Rec;
    expect(r.public_label).toBe('Is your deadline 31 March 2027 (about 5.8 months from today)? This replaces 7 April 2027.');
    // Another write moves the date before the Yes.
    const moved = w.graph();
    goalOf(moved).goal_horizon = { deadline: '2027-05-01' };
    const w2 = world(moved);
    w2.proposals.put(w.proposals.get(String(r.proposal_id))!);
    const out = await w2.caps.authoriseChange({ ...ctxSaying('Yes, that is my deadline.'), typed_approval_of: String(r.proposal_id) },
      { proposal_id: String(r.proposal_id) }) as Rec;
    expect(out.applied).not.toBe(true);
    expect(goalOf(w2.graph()).goal_horizon).toEqual({ deadline: '2027-05-01' });
  });
  it.each([
    ['words the user never wrote', 'we need to ship soon', 'a deadline in 6 months', 'deadline_not_stated'],
    ['a phrase no calendar places without guessing', 'the deadline is next sprint', 'next sprint', 'deadline_not_placed'],
    ['the date the goal already holds', 'we have a deadline in 6 months', 'a deadline in 6 months', 'already_held'],
  ])('refused, nothing prepared: %s', async (_name, said, words, refusal) => {
    const g = servedGraph();
    if (refusal === 'already_held') g.nodes[1].goal_horizon = { deadline: '2027-04-07' };
    const w = world(stored(g));
    const r = await w.caps.proposeGoalDeadline!(ctxSaying(said), { deadline_words: words, rationale: said }) as Rec;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal }));
    expect(w.proposals.get(String(r.proposal_id))).toBeUndefined();
  });
  it('Codex r1: the words must be WHOLE words of THIS message — "6 months" inside "16 months", or only in an earlier message, is refused', async () => {
    const w = world(stored());
    const inside = await w.caps.proposeGoalDeadline!(ctxSaying('The deadline is 16 months away.'), { deadline_words: '6 months', rationale: 'x' }) as Rec;
    expect(inside).toEqual(expect.objectContaining({ ok: false, refusal: 'deadline_not_stated' }));
    const earlier = await w.caps.proposeGoalDeadline!({ ...ctxSaying('Yes, add the freelance option.'), user_text: `${PAUL_0913}\nYes, add the freelance option.` },
      { deadline_words: 'a deadline in 6 months', rationale: 'x' }) as Rec;
    expect(earlier).toEqual(expect.objectContaining({ ok: false, refusal: 'deadline_not_stated' }));
    // CONTROL: the same words typed in this message are the user's.
    const typed = await w.caps.proposeGoalDeadline!(ctxSaying('The deadline is 6 months away.'), { deadline_words: '6 months', rationale: 'x' }) as Rec;
    expect(typed).toEqual(expect.objectContaining({ ok: true, public_label: 'Is your deadline 7 April 2027 (6 months from today)?' }));
  });
  it('Codex r2: an approval whose write landed but came back unconfirmed is confirmed on the retry, never "nothing was recorded"', async () => {
    const w = world(stored(), undefined, { unconfirmFirst: true });
    const r = await w.caps.proposeGoalDeadline!(ctxSaying(PAUL_0913), { deadline_words: 'a deadline in 6 months', rationale: PAUL_0913 }) as Rec;
    const yes = { ...ctxSaying('Yes, that is my deadline.'), typed_approval_of: String(r.proposal_id) };
    const first = await w.caps.authoriseChange(yes, { proposal_id: String(r.proposal_id) }) as Rec;
    expect(first).toEqual(expect.objectContaining({ applied: false, refusal: 'not_confirmed' }));
    expect(goalOf(w.graph()).goal_horizon).toEqual({ deadline: '2027-04-07' });
    const retry = await w.caps.authoriseChange(yes, { proposal_id: String(r.proposal_id) }) as Rec;
    expect(retry, JSON.stringify(retry)).toEqual(expect.objectContaining({ ok: true, applied: true }));
    expect(w.commits.map((c) => c.goal_horizon?.deadline)).toEqual(['2027-04-07', '2027-04-07']);
  });
  it('Codex r1: a retry of a write that landed (same turn id) is a verified no-op, never "the deadline changed"', async () => {
    const w = world(stored());
    const input = { scenario_id: SCENARIO, base_graph_hash: computeAnalysisAffectingGraphHash(w.graph() as never), turn_id: 'deadline-retry',
      links: [], levels: [], goal_horizon: { goal_id: GOAL_ID, deadline: '2027-04-07', expected_deadline: null } } as CommitOptionLevelsInput;
    expect(await w.commitOptionLevels(input)).toEqual(expect.objectContaining({ status: 'committed', already_applied: false }));
    expect(await w.commitOptionLevels(input)).toEqual(expect.objectContaining({ status: 'committed', already_applied: true }));
    expect(goalOf(w.graph()).goal_horizon).toEqual({ deadline: '2027-04-07' });
  });
  it('a chance goal takes no target figure and no "today’s level", by name (the doors that asked for one)', async () => {
    const w = world(stored());
    const t = await w.caps.proposeGoalTarget!(ctxSaying('We need at least 80% likelihood of on-time launch.'),
      { constraint_type: 'at_least', value: 80, unit: '%', rationale: 'x' }) as Rec;
    expect(t).toEqual(expect.objectContaining({ ok: false, refusal: 'goal_measures_a_chance' }));
    const l = await w.caps.proposeGoalCurrentLevel!(ctxSaying('It is about 40% today.'),
      { goal_label: 'meet our next feature-launch deadline', value: 40, unit: '%', user_stated: true }) as Rec;
    expect(l).toEqual(expect.objectContaining({ ok: false, refusal: 'goal_measures_a_chance' }));
  });
});

describe('the one horizon writer (goal-horizon-write.ts): its own gates, without the capability in front of it', () => {
  it('a date that moved since the card was made is refused, by name, and nothing is mutated', () => {
    const g = stored();
    goalOf(g).goal_horizon = { deadline: '2027-05-01' };
    const before = JSON.stringify(g);
    expect(applyGoalHorizonEdit(g, { goal_id: GOAL_ID, deadline: '2027-04-07', expected_deadline: null })).toEqual({ kind: 'refused', reason: 'deadline_changed' });
    expect(JSON.stringify(g)).toBe(before);
  });
  it('the date already held is a verified no-op (a retry), checked before the stale gate', () => {
    const g = stored();
    goalOf(g).goal_horizon = { deadline: '2027-04-07' };
    expect(applyGoalHorizonEdit(g, { goal_id: GOAL_ID, deadline: '2027-04-07', expected_deadline: null })).toEqual({ kind: 'unchanged' });
  });
  it('only a goal, only a real calendar date; the postimage differs in goal_horizon alone', () => {
    const g = stored();
    expect(applyGoalHorizonEdit(g, { goal_id: 'feature_delivery_capacity', deadline: '2027-04-07', expected_deadline: null })).toEqual({ kind: 'refused', reason: 'not_a_goal' });
    expect(applyGoalHorizonEdit(g, { goal_id: GOAL_ID, deadline: '2027-02-30', expected_deadline: null })).toEqual({ kind: 'refused', reason: 'date_invalid' });
    const ok = applyGoalHorizonEdit(g, { goal_id: GOAL_ID, deadline: '2027-04-07', expected_deadline: null });
    expect(ok.kind).toBe('mutated');
    const after = (ok as { mutatedGraph: Rec }).mutatedGraph;
    expect(goalHorizonPostimageIsScoped(g, after, GOAL_ID)).toBe(true);
    const widened = structuredClone(after);
    widened.nodes.find((n: Rec) => n.id === 'feature_delivery_capacity').label = 'changed';
    expect(goalHorizonPostimageIsScoped(g, widened, GOAL_ID)).toBe(false);
  });
});

describe('timing (preamble rule): every new regex at 5k → 40k characters, 4 shapes, scaling < 22× (min of 7 calibrated batches)', () => {
  // The public readers gate their input (80 / 200 characters), so each PATTERN is timed directly, unanchored inputs included.
  // Calibrated batches (scalingRatio): single-call min-of-5 read 8.48× on CI (7 Oct), and the calibrated 4× input ratio still
  // read 8.16× against a bar of 8 (#2767, #2790 shard 3, 7 Oct). 8× input instead: linear ≈ 8×, quadratic ≈ 64×, and the bar
  // sits at their geometric midpoint (≈ 22×), so a slow CI runner's noise cannot cross it and a quadratic pattern still cannot pass.
  const patterns: readonly RegExp[] = [CHANCE_WORD, UNIT_HEAD_CUT, new RegExp(SCALE_NOTE.source), ...DEADLINE_PATTERNS_FOR_TIMING];
  it.each([
    ['spaces', (n: number) => ' '.repeat(n)],
    ['counts and lead words', (n: number) => 'in 6 months by the end of q2 '.repeat(Math.ceil(n / 29)).slice(0, n)],
    ['chance words, no boundary', (n: number) => 'likelihoodchanceodds'.repeat(Math.ceil(n / 20)).slice(0, n)],
    ['open brackets', (n: number) => '(['.repeat(Math.ceil(n / 2)).slice(0, n)],
  ])('%s', (_shape, make) => {
    const [small, big] = [make(5000), make(40000)];
    for (const re of patterns) {
      const m = scalingRatio(() => re.exec(small), () => re.exec(big));
      expect(m.ratio, `${String(re)} ${m.detail}`).toBeLessThan(22);
    }
  });
});
