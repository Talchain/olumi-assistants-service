/**
 * ⭐ DL (b1) + AIE 6125204695, 12 Oct 2026: THE DEADLINE GOAL'S CHANCE IS THE ENGINE'S OWN APPROXIMATE POINT, BOUND PER OPTION
 * (`goal-own-constraint-chance.ts`).
 *
 * Evidence: Paul's REAL request (`ebd-paul-plot-request-7ea1f711.json`, sha256 7ea1f711…, what CEE sent) and the REAL-ENGINE
 * response to it (staging PLoT 6ec01e8 + ISL, posted 2026-10-12T11:49:51Z; sha256 2b9d1b3c…, `recovery/score/EBD-REAL-ENGINE.md`),
 * over his stored graph (`ebd-paul-stored-graph-20261012.json`). The engine gives no `probability_of_goal` at threshold 1; each
 * option's own row carries `constraint_probabilities.auto_goal_threshold` (0.8301 / 0.9515 / 0.4158 on n = 10,000 draws).
 * CEE's own approximation (`normalChance`) and the uniform law (`exactChance`, `gate`) are never the served figure.
 *
 * Rows: the bound read (positive); the SENT-run contrasts (frame, comparator, goal node, threshold); the PER-OPTION contrasts
 * (option not sent, row not on this goal, key absent); the top-level `constraint_results` is never read; never over a CEE
 * withhold; never the joint; a row's own `probability_of_goal` is kept; the earned-0/1 guard; one remaining withhold (more
 * ranged starts than Olumi uses), with its actual reason; and the timing-range note.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalOwnConstraintChanceRecords, GOAL_OWN_CONSTRAINT_ID, SENT_TARGET_NOT_HELD_WORDS, withSentTargetWithheld, type SentRunInputs } from '../goal-own-constraint-chance.js';
import { goalChanceLicenceOf, withGoalChanceLicence } from '../goal-chance-licence.js';
import { goalChancePrecisionOf } from '../goal-chance-driver.js';
import { exactChance, normalChance } from '../event-by-date-share.js';
import { shareGateForOption, sharePartsForOption } from '../share-by-date-run.js';
import { withShareByDateChanceGate } from '../goal-chance-range.js';
import { GOAL_FIGURES_SHARE_APPROXIMATION } from '../../../orchestrator/context/option-result-source.js';

type Rec = Record<string, any>;
const fixture = (name: string): Rec => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const ENGINE = (): Rec => fixture('ebd-paul-real-engine-response-6ec01e8.json');
const GRAPH = (): Rec => fixture('ebd-paul-stored-graph-20261012.json');
const REQUEST = (): Rec => fixture('ebd-paul-plot-request-7ea1f711.json');
const GOAL = 'event_goal';
const OPTIONS = ['event_option_1', 'event_option_2', 'event_option_3'];
const sentGoal = (q: Rec): Rec => q.graph.nodes.find((n: Rec) => n.id === GOAL);
const SENT = (edit: (q: Rec) => Rec = q => q): SentRunInputs => {
  const q = edit(REQUEST());
  return { graph: q.graph, goal_direction: q.goal_direction, goal_threshold_strict: q.goal_threshold_strict };
};
const licenceOf = (r: Rec, sent: SentRunInputs | undefined = SENT(), g: Rec = GRAPH()) =>
  goalChanceLicenceOf(r, g, GOAL, undefined, undefined, g, sent === undefined ? {} : { sentRun: sent });
const readOf = (r: Rec, sent: SentRunInputs | undefined = SENT()) => goalOwnConstraintChanceRecords(r, GRAPH(), GOAL, r.option_comparison, sent);
const withOption = (r: Rec, id: string, edit: (o: Rec) => Rec): Rec =>
  ({ ...r, option_comparison: r.option_comparison.map((o: Rec) => o.option_id === id ? edit(o) : o) });

describe('AIE 6125204695: the goal’s own constraint, bound per option to what CEE sent, is the figure at threshold 1', () => {
  it('precondition: the engine sent no probability_of_goal; CEE sent the goal at threshold 1 in the delta frame; top-level results hold option 1 only', () => {
    const r = ENGINE();
    for (const o of r.option_comparison) expect('probability_of_goal' in o, o.option_id).toBe(false);
    expect(sentGoal(REQUEST())).toMatchObject({ goal_threshold: 1, goal_threshold_frame: 'delta' });
    expect(r.constraint_results.map((c: Rec) => c.option_id)).toEqual(['event_option_1']);
    for (const o of r.option_comparison) expect(o.goal_fit_basis.node_ids).toEqual([GOAL]);
  });

  it('Paul’s real engine: the licence quotes 83 / 95 / 42, each with its own 95% Wilson block on n = 10,000, and the range note once', () => {
    const r = ENGINE();
    const licence = licenceOf(r)!;
    expect(licence.pct_by_option).toEqual({ event_option_1: 83, event_option_2: 95, event_option_3: 42 });
    expect(licence.withheld_option_ids).toBeUndefined();
    expect(licence.notes).toEqual(['You gave 7 months. Olumi’s assumed 3.5–10.5-month range informs this approximate calculation; '
      + 'modelled outcomes can fall outside those time bounds.']);
    const read = readOf(r);
    expect([...read.engineRead].sort()).toEqual(OPTIONS);
    for (const rec of read.records as Rec[]) {
      expect(rec.probability_of_goal).toBe(rec.constraint_probabilities[GOAL_OWN_CONSTRAINT_ID]);
      expect(goalChancePrecisionOf(rec)).toMatchObject({ n_informative: 10000, n_met: Math.round(rec.probability_of_goal * 10000) });
    }
    expect(r.option_comparison.every((o: Rec) => !('probability_of_goal' in o))).toBe(true); // the Run's records are never edited
  });

  it('no old-law authority: two developers is the engine’s 95 although the uniform law and CEE’s Normal disagree by > 2 points', () => {
    const g = GRAPH(), parts = sharePartsForOption(g, 'event_option_2')!;
    expect(Math.abs(normalChance(parts, 1) - exactChance(parts, 1)) * 100).toBeGreaterThan(2);
    expect(shareGateForOption(g, 'event_option_2', 0.9515)?.form).toBe('range'); // the old gate's verdict: a reference only
    expect(licenceOf(ENGINE())!.pct_by_option.event_option_2).toBe(95);
    const out = withShareByDateChanceGate(ENGINE(), g, GOAL) as Rec;
    expect((out.inference_warnings ?? []).some((w: Rec) => w.code === 'GOAL_CHANCE_RANGE' || w.code === GOAL_FIGURES_SHARE_APPROXIMATION)).toBe(false);
  });

  it('the top-level constraint_results is never read: removed, or naming another node, the per-option figures are unchanged', () => {
    const { constraint_results: _gone, ...none } = ENGINE();
    expect(licenceOf(none)!.pct_by_option).toEqual({ event_option_1: 83, event_option_2: 95, event_option_3: 42 });
    const wrong = { ...ENGINE(), constraint_results: [{ ...ENGINE().constraint_results[0], node_id: 'event_team', value: 0.5 }] };
    expect(licenceOf(wrong)!.pct_by_option).toEqual({ event_option_1: 83, event_option_2: 95, event_option_3: 42 });
  });

  it.each([
    ['not in the delta frame', (q: Rec) => { sentGoal(q).goal_threshold_frame = 'level'; return q; }],
    ['minimised (a different comparator from the goal’s held >=)', (q: Rec) => ({ ...q, goal_direction: 'minimise' })],
    ['strict (> rather than the held >=)', (q: Rec) => ({ ...q, goal_threshold_strict: true })],
    ['not this goal node', (q: Rec) => { sentGoal(q).id = 'another_goal'; return q; }],
    ['with no finite threshold', (q: Rec) => { delete sentGoal(q).goal_threshold; return q; }],
    // B2, independent check BLOCKING 3 (CHECK.md on 91405cb2), the checker's repro: finite, but not the held ≥ 100%.
    ['at a delta threshold of 0.5, not the held target', (q: Rec) => { sentGoal(q).goal_threshold = 0.5; return q; }],
    ['at the held target\'s raw figure (100), not its frame\'s 1', (q: Rec) => { sentGoal(q).goal_threshold = 100; return q; }],
  ])('SENT-RUN CONTRAST — the goal was sent %s: no read, every figure withheld', (_name, edit) => {
    const sent = SENT(edit);
    expect(readOf(ENGINE(), sent).engineRead.size).toBe(0);
    const licence = licenceOf(ENGINE(), sent);
    expect(licence === null || Object.keys(licence.pct_by_option).length === 0).toBe(true);
  });

  it('B2 (check BLOCKING 3): a Run sent another threshold withholds EVERY option\'s chance WITH WORDS; the held target is unchanged', () => {
    const sent = SENT(q => { sentGoal(q).goal_threshold = 0.5; return q; });
    const out = withSentTargetWithheld(ENGINE(), GRAPH(), GOAL, sent) as Rec;
    const words = (out.inference_warnings ?? []).filter((w: Rec) => w.code === GOAL_FIGURES_SHARE_APPROXIMATION);
    // AIE 6129564354 (AMENDED): the same saved target (100) sent at the wrong figure is Olumi's mismatch, never "run again".
    const MISMATCH = 'Not shown. This analysis did not test the target saved in your model, so its figures cannot describe your chance of reaching that target. '
      + 'Olumi needs to resolve this analysis mismatch before showing a chance.';
    expect(words.map((w: Rec) => [w.message, [...w.option_ids].sort()])).toEqual([[MISMATCH, OPTIONS]]);
    expect(SENT_TARGET_NOT_HELD_WORDS).toBe('Not shown. This analysis did not test the target saved in your model, so its figures cannot describe your chance of reaching that target.');
    const licence = licenceOf(out, sent);
    expect(licence === null || Object.keys(licence.pct_by_option).length === 0).toBe(true);
    // At Run time, through the licence writer the Run handler calls: the words are stored with the Run, and no chance is.
    const stored = withGoalChanceLicence(ENGINE(), GRAPH(), GOAL, undefined, undefined, GRAPH(), { sentRun: sent }) as Rec;
    const said = (stored.inference_warnings ?? []).filter((w: Rec) => w.message === MISMATCH);
    expect(said.map((w: Rec) => [...w.option_ids].sort())).toEqual([OPTIONS]);
    expect((stored.inference_warnings ?? []).some((w: Rec) => Object.keys(w.pct_by_option ?? {}).length > 0)).toBe(false);
    // CONTRAST: the Run that tested the held target is returned as it came, and quotes 83 / 95 / 42.
    const held = ENGINE();
    expect(withSentTargetWithheld(held, GRAPH(), GOAL, SENT())).toBe(held);
    expect(licenceOf(held)!.pct_by_option).toEqual({ event_option_1: 83, event_option_2: 95, event_option_3: 42 });
  });

  it('AIE 6129564354: "Run the analysis again." ONLY where the saved target changed after the analysis (revision evidence)', () => {
    // The analysis was sent with the target saved then (≥ 90 %, sent as 0.9); the model now holds ≥ 100 %.
    const sent = SENT(q => { sentGoal(q).goal_threshold_raw = 90; sentGoal(q).goal_threshold = 0.9; return q; });
    const out = withSentTargetWithheld(ENGINE(), GRAPH(), GOAL, sent) as Rec;
    const words = (out.inference_warnings ?? []).filter((w: Rec) => w.code === GOAL_FIGURES_SHARE_APPROXIMATION).map((w: Rec) => w.message);
    expect(words).toEqual(['Not shown. This analysis did not test the target saved in your model, so its figures cannot describe your chance of reaching that target. Run the analysis again.']);
    // CONTRAST: the same saved target sent at another figure, frame or comparator is Olumi's mismatch.
    for (const edit of [(q: Rec) => { sentGoal(q).goal_threshold = 0.5; return q; }, (q: Rec) => { sentGoal(q).goal_threshold_frame = 'level'; return q; },
      (q: Rec) => ({ ...q, goal_threshold_strict: true })]) {
      const said = ((withSentTargetWithheld(ENGINE(), GRAPH(), GOAL, SENT(edit)) as Rec).inference_warnings ?? [])
        .filter((w: Rec) => w.code === GOAL_FIGURES_SHARE_APPROXIMATION).map((w: Rec) => w.message);
      expect(said).toHaveLength(1);
      expect(said[0]).toMatch(/Olumi needs to resolve this analysis mismatch before showing a chance\.$/);
      expect(said[0]).not.toContain('Run the analysis again');
    }
  });

  it('no sent run (a caller that cannot say what was sent): no read', () => {
    const r = ENGINE();
    expect(goalOwnConstraintChanceRecords(r, GRAPH(), GOAL, r.option_comparison, undefined).engineRead.size).toBe(0);
    expect(Object.keys(goalChanceLicenceOf(r, GRAPH(), GOAL)?.pct_by_option ?? {})).toEqual([]);
  });

  it.each([
    ['its row is scored on another node', (o: Rec) => ({ ...o, goal_fit_basis: { ...o.goal_fit_basis, node_ids: ['event_team'] } })],
    ['its row names two nodes', (o: Rec) => ({ ...o, goal_fit_basis: { ...o.goal_fit_basis, node_ids: [GOAL, 'event_team'] } })],
    ['its row has no goal-fit basis', (o: Rec) => { const { goal_fit_basis: _b, ...rest } = o; return rest; }],
    ['its own key is another constraint', (o: Rec) => ({ ...o, constraint_probabilities: { c_deadline: 0.9515 } })],
    ['its own figure is not a chance', (o: Rec) => ({ ...o, constraint_probabilities: { [GOAL_OWN_CONSTRAINT_ID]: 1.4 } })],
  ])('PER-OPTION CONTRAST — two developers, %s: that option alone is not read', (_name, edit) => {
    const r = withOption(ENGINE(), 'event_option_2', edit);
    expect([...readOf(r).engineRead].sort()).toEqual(['event_option_1', 'event_option_3']);
    const licence = licenceOf(r)!;
    expect(licence.pct_by_option).toEqual({ event_option_1: 83, event_option_3: 42 });
    expect(licence.withheld_option_ids).toEqual(['event_option_2']);
  });

  it('PER-OPTION CONTRAST — an option CEE did not send is never read', () => {
    const sent = SENT(q => { q.graph.nodes = q.graph.nodes.filter((n: Rec) => n.id !== 'event_option_3'); return q; });
    expect([...readOf(ENGINE(), sent).engineRead].sort()).toEqual(['event_option_1', 'event_option_2']);
  });

  it('never over a CEE withhold: an option a goal-figures withhold names stays withheld; a Run-wide withhold reads none', () => {
    const r: Rec = { ...ENGINE(), inference_warnings: [{ code: GOAL_FIGURES_SHARE_APPROXIMATION, severity: 'warning', option_ids: ['event_option_2'], message: 'x' }] };
    expect([...readOf(r).engineRead].sort()).toEqual(['event_option_1', 'event_option_3']);
    const runWide: Rec = { ...ENGINE(), inference_warnings: [{ code: GOAL_FIGURES_SHARE_APPROXIMATION, severity: 'warning', message: 'x' }] };
    expect(readOf(runWide).engineRead.size).toBe(0);
  });

  it('never the joint of several: a row with only probability_of_joint_goal is not read', () => {
    const r = withOption(ENGINE(), 'event_option_1', (o) => {
      const { constraint_probabilities: _c, constraint_probabilities_precision: _p, ...rest } = o;
      return rest;
    });
    expect(r.option_comparison[0].probability_of_joint_goal).toBe(0.8301);
    expect([...readOf(r).engineRead].sort()).toEqual(['event_option_2', 'event_option_3']);
  });

  it('a row that carries probability_of_goal keeps it (the read never overrides the engine’s own goal figure)', () => {
    const r = ENGINE(), carried = { ...r, option_comparison: r.option_comparison.map((o: Rec) => ({ ...o, probability_of_goal: 0.5 })) };
    const read = readOf(carried);
    expect(read.engineRead.size).toBe(0);
    expect((read.records as Rec[]).map((x) => x.probability_of_goal)).toEqual([0.5, 0.5, 0.5]);
    expect(licenceOf(carried)!.pct_by_option).toEqual({ event_option_1: 50, event_option_2: 50, event_option_3: 50 });
  });

  it('the earned-0/1 guard holds: an engine-read exact 1 the Run did not earn is withheld; earned, it is said', () => {
    const r = withOption(ENGINE(), 'event_option_2', (o) => ({ ...o, constraint_probabilities: { [GOAL_OWN_CONSTRAINT_ID]: 1 } }));
    expect(licenceOf(r)!.withheld_option_ids).toEqual(['event_option_2']);
    const g = GRAPH();
    const earned = goalChanceLicenceOf(r, g, GOAL, (id, p) => id === 'event_option_2' && p === 1, undefined, g, { sentRun: SENT() })!;
    expect(earned.pct_by_option.event_option_2).toBe(100);
  });

  // AIE 6128697025 (row 9, verbatim): the range module's one remaining withhold, on every deadline Run. It counts RANGED
  // starts; fixed starts stay as context, never deleted.
  it('the too-many-starts withhold says the AIE\'s words: three ranged starts on one option (the forecast uses at most two)', () => {
    const g = GRAPH();
    const third = { ...structuredClone(g.nodes.find((n: Rec) => n.id === 'event_capacity_1')), id: 'event_capacity_3', label: 'Third hire' };
    g.nodes.push(third);
    g.edges.push({ ...structuredClone(g.edges.find((e: Rec) => e.from === 'event_capacity_1' && e.to === GOAL)), from: 'event_capacity_3' });
    for (const o of g.nodes.filter((n: Rec) => n.kind === 'option')) {
      o.interventions = { ...o.interventions, event_capacity_3: { value: o.id === 'event_option_2' ? 1 : 0 } };
      g.edges.push({ ...structuredClone(g.edges.find((e: Rec) => e.from === o.id && e.to === 'event_capacity_1')), to: 'event_capacity_3' });
    }
    g.nodes.find((n: Rec) => n.id === 'event_option_2').interventions.event_capacity_1 = { value: 1 };
    expect(sharePartsForOption(g, 'event_option_2'), 'three ranged starts').toBeNull();
    const out = withShareByDateChanceGate(ENGINE(), g, GOAL) as Rec;
    const own = (out.inference_warnings ?? []).filter((w: Rec) => Array.isArray(w.option_ids) && w.option_ids.includes('event_option_2'));
    expect(own.map((w: Rec) => w.message)).toEqual(['Not shown. This forecast can use at most two uncertain hiring starts for ‘Hire two developers’ at once. Say which two it should model.']);
    const licence = goalChanceLicenceOf(out, g, GOAL, undefined, undefined, g, { sentRun: SENT() })!;
    expect(licence.withheld_option_ids).toEqual(['event_option_2']);
    expect(Object.keys(licence.pct_by_option).sort()).toEqual(['event_option_1', 'event_option_3']);
  });
});
