/**
 * ⭐ G: HIRING'S CONDITIONAL GOAL CHANCE (AIE #94 6128697025, "S4/S8 — D timing decision"; amendments 6131950992 (a)–(e)).
 *
 * Served run 4 (2026-10-12T172858Z, hiring, step 7): the Run scored every option (‘Hire a Tech lead’ 0.2372, ‘Hire two
 * developers’ 0.3246, ‘Continue as now’ 0), yet every canonical cell was `{ kind: 'none' }` with no reason: the goal is
 * ‘productivity’ up at least 10% from today at month three, its basis holds `effects_at_period_end: false`, and ruling 12
 * refused the licence. The AIE ruled that a static model may support a CONDITIONAL chance under Olumi's disclosed assumption
 * that the estimated effects are in place by then. The fixture is that served Run's envelope and graph, verbatim, and the
 * persisted brief read on the same graph hash. What CEE SENT for that Run is rebuilt here by CEE's own wire functions, in the
 * order the Run handler applies them (`run-analysis.ts`, `plotPayload`): the served request body itself was not captured.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  goalChanceLicenceForAgent, goalChanceLicenceOf, periodEndConditionalOf, sentGoalThresholdOf, withGoalChanceLicence,
  withholdForPeriodEndEffects,
} from '../goal-chance-licence.js';
import { PERIOD_END_ASSUMPTION_NOTE_TEMPLATE } from '../period-end-assumption.js';
import { projectCanonicalAnalysisCells } from '../../../routes/canonical-analysis-view.js';
import { goalChanceCellFacesForAgent, goalChanceNotesForAgent, goalChanceScreenLinesForAgent, withScreenLinesOwed } from '../../agent-lane/goal-chance-screen-lines.js';
import { toOutboundGraph } from '../outbound-graph.js';
import { withShareByDateFrame } from '../share-by-date-run.js';
import { withoutStatedLevelRanges } from '../../routing/add-factor-transaction.js';
import { resolveGoalDirection, resolveGoalThresholdStrict } from '../goal-direction.js';
import { toTypedRunRows } from '../../runs/typed-run-rows.js';
import { analysisResultForAgent } from '../../agent-lane/decision-sensitivity.js';
import { HOST_TOOL_CONTRACT } from '../../agent-lane/coach-route-v0_2.js';
import { GOAL_CHANCE_RANKING_INSTRUCTION, SELECTED_RUN_SCOPE_INSTRUCTION } from '../../../routes/agent-v1-turn.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync('tests/fixtures/batch-g/served-hiring-run4-turn07-20261012T172858Z.json', 'utf8')) as Rec;
const GOAL = 'productivity';
const HIRING = ['hire_a_tech_lead', 'hire_two_developers'];
const SQ = 'continue_as_now';
/** The AIE's note, exactly (#94 6128697025), at the basis' month. */
const NOTE = 'Provisional: this calculation assumes the estimated effects are in place by month three. It does not model when they arrive.';
/** E's withhold sentence, exactly (#94 6128697025). */
const WITHHOLD = 'The chance of reaching your target for ‘productivity’ (up at least 10% from today) by month three isn’t shown: '
  + 'the model has not established how much of these effects would be in place by then.';
const OWN_TARGET = 'chance of ‘productivity’ being at least 10% higher than today at three months';
/** Amendment 1, read in the change frame (DL ruling after G r1: the AIE's D2 exact equality in the Run's own recorded frame). */
const DOING_NOTHING = 'Doing nothing: no change to ‘productivity’ in this model, by assumption.';
const SQ_ASSUMED = 'This assumes carrying on as now leaves ‘productivity’ unchanged through month three; each option is measured against that.';
const SQ_MOVED = 'Not shown: this run’s result for carrying on as now doesn’t match ‘productivity’ as it stands today in the model, so it needs checking first.';
const CONDITIONS = 'This chance covers ‘productivity’ only. It does not include: ‘Hiring spend’ at most £200,000; maintaining code quality; the urgent launch date.';
const FACE = {
  hire_a_tech_lead: `‘Hire a Tech lead’: about 24% ${OWN_TARGET}, in this model, using Olumi's estimates for 4 starting values, 2 option settings and 7 relationships (see Check estimates).`,
  hire_two_developers: `‘Hire two developers’: about 32% ${OWN_TARGET}, in this model, using Olumi's estimates for 4 starting values, 1 option setting and 7 relationships (see Check estimates).`,
};

/** What the Run handler sends PLoT for this graph (`plotPayload`): the wire copy, the direction and the strictness. */
function sentRunOf(graph: Rec): Rec {
  const sent: Rec = { graph: toOutboundGraph(withoutStatedLevelRanges(withShareByDateFrame(graph, graph))) };
  const direction = resolveGoalDirection(graph, GOAL);
  if (direction !== undefined) sent.goal_direction = direction.direction;
  if (resolveGoalThresholdStrict(graph, GOAL)) sent.goal_threshold_strict = true;
  return sent;
}
const earned = (id: string, p: 0 | 1): boolean => (FX.goal_certainty as Rec[]).some((d) => d.option_id === id && d.probability_of_goal === p && d.earned);

/** The Run handler's own order: E's withhold, then the licence, with the same inputs (`run-analysis.ts`). */
function runAsTheHandlerDoes(o: { graph?: Rec; brief?: string | null; sentRun?: Rec; envelope?: Rec; effects_timing?: unknown } = {}): { envelope: Rec; view: Rec } {
  const graph = o.graph ?? FX.graph;
  const served = o.envelope ?? FX.envelope;
  const sentRun = o.sentRun ?? sentRunOf(graph);
  const brief = 'brief' in o ? o.brief : FX.brief;
  const effects_timing = 'effects_timing' in o ? o.effects_timing : 'not_stated';
  const withheld = withholdForPeriodEndEffects(served, graph, GOAL, { sentRun, brief, effects_timing });
  const envelope = withGoalChanceLicence(withheld, graph, GOAL, earned, sentGoalThresholdOf(withheld, sentRun.graph, GOAL, earned, sentRun),
    graph, { storedConstraints: graph.goal_constraints, sentConstraints: graph.goal_constraints, sentRun, brief, effects_timing });
  return { envelope, view: { type: 'analysis_result', enrichment: envelope } };
}
const cellsOf = (view: Rec, graph: Rec = FX.graph): Record<string, Rec> => Object.fromEntries(
  projectCanonicalAnalysisCells(view as never, graph, FX.goal_certainty).map((c) => [c.option_id, c.cell as Rec]));
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.id === GOAL)!;
const withGoal = (g: Rec, patch: (goal: Rec) => void): Rec => { const c = structuredClone(g); patch(goalOf(c)); return c; };

/** Withheld with E's sentence on each hiring option, no figure, no licence, no note. */
function expectWithheld(run: { envelope: Rec; view: Rec }, why: string): void {
  expect(goalChanceLicenceForAgent(run.view), why).toBeUndefined();
  const w = (run.envelope.inference_warnings as Rec[]).find((x) => x.detail?.reason === 'effects_at_period_end_unstated');
  expect(w, why).toMatchObject({ code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE', message: WITHHOLD, option_ids: HIRING });
  const cells = cellsOf(run.view);
  for (const id of HIRING) expect(cells[id], `${why}: ${id}`).toMatchObject({ kind: 'withheld', why: WITHHOLD });
  expect(JSON.stringify(run.envelope), why).not.toContain('in place by month three');
}

describe('G: the served run-4 hiring Run shows each option\'s CONDITIONAL chance of its own target', () => {
  it('precondition (RED as served): the Run scored every option, the cells said nothing, and E alone only withholds', () => {
    const rows = Object.fromEntries((FX.envelope.option_comparison as Rec[]).map((r) => [r.option_id, r.probability_of_goal]));
    expect(rows).toEqual({ hire_a_tech_lead: 0.2372, hire_two_developers: 0.3246, continue_as_now: 0 });
    expect(goalOf(FX.graph).goal_target_basis).toMatchObject({ target_frame: 'change_abs', target_raw: 10, period_months: 3,
      period_kind: 'at_end', reference: 'today', effects_at_period_end: false,
      also_required: ['maintaining code quality', 'the urgent launch date'] });
    for (const o of FX.served_canonical_options as Rec[]) expect(o.cell, o.option_id).toEqual({ kind: 'none' });
    // E's head, without the Run's own inputs: refused, and the withhold says why (unchanged).
    expect(goalChanceLicenceOf(FX.envelope, FX.graph, GOAL)).toBeNull();
    expect(withholdForPeriodEndEffects(FX.envelope, FX.graph, GOAL)).not.toBe(FX.envelope);
  });

  it('GREEN: each hiring option is licensed on its own target, with the AIE\'s note once and Olumi\'s assumption recorded', () => {
    const before = JSON.stringify(FX.graph);
    const run = runAsTheHandlerDoes();
    const licence = goalChanceLicenceForAgent(run.view)!;
    expect(licence.chance_words).toBe(OWN_TARGET);
    expect(licence.notes!.filter((n) => n === NOTE)).toHaveLength(1);
    expect(licence.notes).toContain(CONDITIONS);
    expect(licence.provisional).toBe(true);
    expect(licence.period_end_assumption).toEqual({ origin: 'olumi', period_months: 3, reference: 'today' });
    expect([...goalChanceCellFacesForAgent(run.view, FX.graph, true)]).toEqual(Object.entries(FACE));
    const cells = cellsOf(run.view);
    expect(cells.hire_a_tech_lead).toEqual({ kind: 'figure', display: 'about 24%', face: FACE.hire_a_tech_lead });
    expect(cells.hire_two_developers).toEqual({ kind: 'figure', display: 'about 32%', face: FACE.hire_two_developers });
    // Carrying on as now: no change, by assumption (amendment 1), read in the paired-change frame the Run scored.
    expect(licence.status_quo).toEqual({ option_id: SQ, line: DOING_NOTHING });
    expect(cells[SQ]).toMatchObject({ kind: 'withheld', face: 'No change, by assumption', why: DOING_NOTHING });
    expect(goalChanceNotesForAgent(run.view, FX.graph, true)).toEqual([DOING_NOTHING, SQ_ASSUMED, NOTE, CONDITIONS,
      'Provisional: this result uses inputs whose sources have not been verified.']);
    // E's withhold did not run; the Run's own figures stand; the protected field is never written (still false).
    expect((run.envelope.inference_warnings as Rec[]).some((w) => w.detail?.reason === 'effects_at_period_end_unstated')).toBe(false);
    expect(JSON.stringify(FX.graph)).toBe(before);
    expect(goalOf(FX.graph).goal_target_basis.effects_at_period_end).toBe(false);
    // The note is the one shared template (no second copy of its words).
    expect(NOTE).toBe(PERIOD_END_ASSUMPTION_NOTE_TEMPLATE.replace('{period}', 'month three'));
  });

  it('the AND: never "chance of meeting your goal" — the own target\'s words, and every unscored condition named', () => {
    const run = runAsTheHandlerDoes();
    const said = [...goalChanceCellFacesForAgent(run.view, FX.graph, true).values(), ...goalChanceNotesForAgent(run.view, FX.graph, true),
      goalChanceLicenceForAgent(run.view)!.chance_words!];
    for (const s of said) expect(s).not.toMatch(/chance of meeting (?:your|the) goal|by the (?:urgent )?launch date/i);
    expect(goalChanceNotesForAgent(run.view, FX.graph, true)).toContain(CONDITIONS);
  });

  it('survives the stored bytes and a cold reopen: the licence, its origin and the note read back from JSON on a reloaded graph', () => {
    const stored = JSON.parse(JSON.stringify(runAsTheHandlerDoes().envelope)) as Rec;
    const reloaded = JSON.parse(JSON.stringify(FX.graph)) as Rec;
    const view = { type: 'analysis_result', enrichment: stored };
    expect(goalChanceLicenceForAgent(view)!.period_end_assumption).toEqual({ origin: 'olumi', period_months: 3, reference: 'today' });
    expect(goalChanceNotesForAgent(view, reloaded, true).filter((n) => n === NOTE)).toHaveLength(1);
    expect([...goalChanceCellFacesForAgent(view, reloaded, true)]).toEqual(Object.entries(FACE));
    // Stale: nothing is said (currentness is the readers' own guard, unchanged).
    expect(goalChanceNotesForAgent(view, reloaded, false)).toEqual([]);
  });

  it('typed Run rows store each conditional chance as permitted_with_caveat, never an unqualified permission', () => {
    const enrichment = JSON.parse(JSON.stringify(runAsTheHandlerDoes().envelope)) as Rec;
    const scenarioId = '3ad403fc-caf8-48e4-bd5b-578e20c1c48a';
    const rows = toTypedRunRows({ fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
      scenario_id: scenarioId, leading_option_id: null, summary: '', enrichment, computed_at: '2026-10-12T17:32:56.914Z',
      graph_hash_at_run: FX.graph_hash, run_id: 'd00eeb8ba46db2bb30befde8bc9fe78a80cc20dbbba1e1401189c2159b268946',
      // A schema-valid sentinel snapshot (as typed-run-rows.test.ts): the served Run's inputs were not captured.
      input_snapshot: { snapshot_version: 1, sent_digest: 'a'.repeat(64), goal: null, options_not_sent: [], factors: [], constraints: [], links: [],
        options: (enrichment.option_comparison as Rec[]).map((r) => ({ option_id: r.option_id, settings: [] })) } } }, { scenarioId });
    expect(rows, JSON.stringify(rows).slice(0, 300)).toHaveProperty('ok');
    if (!('ok' in rows)) throw new Error(JSON.stringify(rows));
    const status = Object.fromEntries(rows.ok.options.map((o) => [o.option_id, o.licence_status]));
    expect(status).toEqual({ hire_a_tech_lead: 'permitted_with_caveat', hire_two_developers: 'permitted_with_caveat', continue_as_now: 'withheld' });
  });

  it('Agent prose: a Run narration owes each option\'s own-target line and the note, said once and never twice', () => {
    const run = runAsTheHandlerDoes();
    const lines = goalChanceScreenLinesForAgent(run.view, FX.graph, true);
    const notes = goalChanceNotesForAgent(run.view, FX.graph, true);
    const owed = withScreenLinesOwed('Here is what this run shows for the two hiring options.', lines, notes).text;
    for (const face of Object.values(FACE)) expect(owed).toContain(face);
    expect(owed.split(NOTE)).toHaveLength(2);
    expect(withScreenLinesOwed(owed, lines, notes).text).toBe(owed);
  });

  it('D2 IN THE CHANGE FRAME: carrying on\'s recorded chance is what a zero change scores; a level-frame spread is not compared', () => {
    // As served, the status-quo row's outcome is the goal's raw LEVEL samples (std 0.188), and its chance is the paired change's 0.
    const row = (FX.envelope.option_comparison as Rec[]).find((r) => r.option_id === SQ)!;
    expect(row.outcome.std).toBeGreaterThan(0.18);
    expect(row.probability_of_goal).toBe(0);
    expect(goalChanceLicenceForAgent(runAsTheHandlerDoes().view)!.status_quo).toEqual({ option_id: SQ, line: DOING_NOTHING });
    // A change baseline that genuinely moved is still withheld, never relabelled: a chance a zero change cannot have
    // (1 against "at least +10%"), or one strictly between 0 and 1.
    for (const p of [1, 0.3]) {
      const envelope = structuredClone(FX.envelope);
      (envelope.option_comparison as Rec[]).find((r) => r.option_id === SQ)!.probability_of_goal = p;
      const licence = goalChanceLicenceForAgent(runAsTheHandlerDoes({ envelope }).view)!;
      expect(licence.status_quo, String(p)).toBeUndefined();
      expect(licence.withheld_reason_by_option?.[SQ], String(p)).toEqual({ reason: 'reference_moved', line: SQ_MOVED });
      expect(licence.notes, String(p)).not.toContain(SQ_ASSUMED);
    }
  });

  it('D2 PAIRING FROM THE PRODUCER (AIE 6133027121): a Run recorded in another or unknown frame is not read as paired', () => {
    // The at-period-end reading (effects stated), so the conditional's own identity check is not what decides here.
    const g = withGoal(FX.graph, (goal) => { goal.goal_target_basis = { ...goal.goal_target_basis, effects_at_period_end: true }; });
    const licenceWith = (sentRun?: Rec): Rec => goalChanceLicenceOf(FX.envelope, g, GOAL, earned, undefined, g,
      { storedConstraints: g.goal_constraints, sentConstraints: g.goal_constraints, ...(sentRun !== undefined ? { sentRun } : {}) }) as Rec;
    // The producer scored the PAIRED change (ISL 0b3321d1: a change node with a change_abs target): no change, by assumption.
    const sent = sentRunOf(g);
    expect(licenceWith(sent).status_quo).toEqual({ option_id: SQ, line: DOING_NOTHING });
    const others: [string, Rec | undefined][] = [
      ['unknown: no sent Run', undefined],
      ['another frame: the raw samples (delta)', { ...sent, graph: withGoal(sent.graph, (x) => { x.goal_threshold_frame = 'delta'; }) }],
      ['another quantity frame: a level node', { ...sent, graph: withGoal(sent.graph, (x) => { delete x.quantity_frame; }) }],
    ];
    for (const [why, sentRun] of others) {
      const l = licenceWith(sentRun);
      expect(l.status_quo, why).toBeUndefined();
      // No claim either way: never "no change, by assumption", and never "moved" from a frame the Run did not record.
      expect(l.withheld_reason_by_option?.[SQ], why).toBeUndefined();
      expect(JSON.stringify(l), why).not.toMatch(/by assumption|carrying on as now leaves/);
    }
    // The case the held-versus-sent identity cannot decide: the held goal IS what this Run sent, yet the producer does not score
    // it as the paired change (ISL 0b3321d1 :7837-7846 refuses 'change_rel' on a change node by name, CHANGE_OF_A_CHANGE). So the
    // pairing is the producer's own rule on the sent goal, not identity, a figure or an assumed flag.
    const rel = withGoal(g, (x) => {
      x.goal_threshold_frame = 'change_rel';
      x.goal_target_basis = { ...x.goal_target_basis, target_frame: 'change_rel' };
      x.observed_state = { ...(x.observed_state ?? {}), raw_value: 50 };
    });
    const relLicence = goalChanceLicenceOf(FX.envelope, rel, GOAL, earned, undefined, rel,
      { storedConstraints: rel.goal_constraints, sentConstraints: rel.goal_constraints, sentRun: sentRunOf(rel) }) as Rec | null;
    expect(relLicence, 'the identity holds, so the licence is read').not.toBeNull();
    expect(relLicence!.status_quo).toBeUndefined();
    expect(JSON.stringify(relLicence), 'no claim either way').not.toMatch(/by assumption|carrying on as now leaves/);
  });

  it('AGENT, raw explanation: the AIE line once where the licence is received, no whole-goal direction, and the actual target, notes and licence', () => {
    // The AIE's words (#94 6133027121), verbatim, once — at the instruction that names the selected Run's licence.
    expect(SELECTED_RUN_SCOPE_INSTRUCTION).toBe('Describe the selected Run using its licensed target wording and scope. If it scores only part of '
      + 'the user\'s goal, name that target and retain the unscored conditions; never call its chance the chance of meeting the whole goal. '
      + 'Keep its provisional or timing-assumption qualification in your own explanation.');
    const instruction = [HOST_TOOL_CONTRACT, GOAL_CHANCE_RANKING_INSTRUCTION].join(' ');
    expect(instruction.split(SELECTED_RUN_SCOPE_INSTRUCTION)).toHaveLength(2);
    expect(GOAL_CHANCE_RANKING_INSTRUCTION).toContain('analysis.goal_chance_licence');
    // No conflicting whole-goal direction is left at that point (the per-option headline, the superlative, "similar", ranges).
    expect(instruction).not.toMatch(/headline is its chance of meeting|highest chance of meeting|similar chances of meeting|then \u201c chance of meeting your goal/);
    // The Agent is handed the actual target, its own-target words, the notes and the licence (with Olumi's assumption).
    const agent = analysisResultForAgent(runAsTheHandlerDoes().view, FX.graph, true) as Rec;
    expect(agent.goal_chance_licence).toMatchObject({ target: { comparator: 'at_least', value: 10, unit: '%', frame: 'change_abs' },
      chance_words: OWN_TARGET, period_end_assumption: { origin: 'olumi', period_months: 3, reference: 'today' } });
    expect(agent.goal_chance_words).toBe(OWN_TARGET);
    expect(agent.goal_chance_notes).toEqual(expect.arrayContaining([NOTE, CONDITIONS, SQ_ASSUMED]));
    expect(agent.goal_chance_status_quo).toEqual({ option_id: SQ, line: DOING_NOTHING });
    // Nothing the Agent reads about this Run calls a productivity-only chance the chance of meeting the goal.
    expect(JSON.stringify(agent)).not.toMatch(/chance of meeting (?:your|the) goal/);
  });

  it('AGENT, replay: the stored Run read cold hands the Agent the same target, notes and licence as the live one', () => {
    const live = analysisResultForAgent(runAsTheHandlerDoes().view, FX.graph, true);
    const stored = { type: 'analysis_result', enrichment: JSON.parse(JSON.stringify(runAsTheHandlerDoes().envelope)) as Rec };
    expect(analysisResultForAgent(stored, JSON.parse(JSON.stringify(FX.graph)), true)).toEqual(live);
  });

  it('NEGATIVE (c): a stated PARTIAL effect by the period withholds with E\'s sentence', () => {
    expectWithheld(runAsTheHandlerDoes({ effects_timing: 'later_or_partial', brief: `${FX.brief} We'd expect only half the productivity gain by month 3.` }), 'partial');
  });

  it('NEGATIVE (c): a stated LATE effect (the full gain only after the period) withholds with E\'s sentence', () => {
    expectWithheld(runAsTheHandlerDoes({ effects_timing: 'later_or_partial', brief: `${FX.brief} We won't see the full gain until month 6.` }), 'late');
  });

  it.each(['The hires start in month four.', 'The hires cannot contribute during that window.'])(
    'AI reads later_or_partial: %s → E withholds', (words) => {
      expectWithheld(runAsTheHandlerDoes({ brief: `${FX.brief} ${words}`, effects_timing: 'later_or_partial' }), words);
    });

  it.each([undefined, null, '', 'invalid', true])('missing/invalid AI reading %s → E withholds', (effects_timing) => {
    expectWithheld(runAsTheHandlerDoes({ effects_timing }), String(effects_timing));
  });

  it.each(['not_stated', 'in_place_by_period'])('AI reads %s → conditional licence with unchanged note', (effects_timing) => {
    const run = runAsTheHandlerDoes({ effects_timing });
    expect(goalChanceLicenceForAgent(run.view)?.notes).toContain(NOTE);
    expect(goalOf(FX.graph).goal_target_basis.effects_at_period_end).toBe(false);
  });

  it('NEGATIVE (a): a Run whose sent threshold, frame, unit or period is not the held target withholds with E\'s sentence', () => {
    const sent = sentRunOf(FX.graph);
    const variants: Record<string, (g: Rec) => void> = {
      threshold: (g) => { g.goal_threshold = 0.04; },
      frame: (g) => { g.goal_threshold_frame = 'change_rel'; },
      unit: (g) => { g.goal_threshold_unit = 'points'; },
      period: (g) => { g.goal_target_basis = { ...g.goal_target_basis, period_months: 6 }; },
    };
    for (const [why, patch] of Object.entries(variants)) {
      expectWithheld(runAsTheHandlerDoes({ sentRun: { ...sent, graph: withGoal(sent.graph, patch) } }), why);
    }
    // ... and the comparator PLoT scores (a minimised Run for the held "at least").
    expectWithheld(runAsTheHandlerDoes({ sentRun: { ...sent, goal_direction: 'minimise' } }), 'comparator');
    // No sent Run at all: a probability on the wire alone licenses nothing.
    expect(periodEndConditionalOf(FX.envelope, FX.graph, GOAL, { brief: FX.brief, effects_timing: 'not_stated' })).toBeUndefined();
  });

  it('NEGATIVE (d): a brief that could not be read is never "no contradiction"', () => {
    expectWithheld(runAsTheHandlerDoes({ brief: null }), 'null');
    expectWithheld(runAsTheHandlerDoes({ brief: '   ' }), 'blank');
  });

  it('NEGATIVE (b): a held month (a producer reading of timing) is never given this note', () => {
    const held = withGoal(FX.graph, (g) => { g.goal_horizon_months = 3; });
    expect(periodEndConditionalOf(FX.envelope, held, GOAL, { sentRun: sentRunOf(held), brief: FX.brief, effects_timing: 'not_stated' })).toBeUndefined();
    expect(JSON.stringify(runAsTheHandlerDoes({ graph: held }).envelope)).not.toContain('in place by month three');
  });
});
