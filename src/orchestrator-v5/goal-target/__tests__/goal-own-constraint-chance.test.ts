/**
 * ⭐ DL (b1), 12 Oct 2026 — THE DEADLINE GOAL'S CHANCE IS THE ENGINE'S OWN (`goal-own-constraint-chance.ts`).
 *
 * Evidence: Paul's REAL-ENGINE response (staging PLoT 6ec01e8 + ISL, posted 2026-10-12T11:49:51Z; sha256 2b9d1b3c…,
 * `recovery/score/EBD-REAL-ENGINE.md`) to the request CEE builds from his stored graph (`ebd-paul-stored-graph-20261012.json`,
 * the graph the route replay stores; its request is sha256 7ea1f711…). The engine gives no `probability_of_goal` at threshold
 * 1; its `auto_goal_threshold` constraint on `event_goal` (>= 1) carries 0.8301 / 0.9515 / 0.4158 on n = 10,000 draws.
 * CEE's own approximation (`normalChance`) is never the evidence here.
 *
 * Rows: the bound read (positive), its identity contrasts (id, node, operator, threshold), never over a CEE withhold, never the
 * joint, and the three share-gate branches the DL pinned (engine-read: no 2-point test; equal exact-law ends: the exact
 * point; unsupported parts: E5's next step, never a wordless withhold).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalOwnConstraintChanceRecords, GOAL_OWN_CONSTRAINT_ID } from '../goal-own-constraint-chance.js';
import { goalChanceLicenceOf } from '../goal-chance-licence.js';
import { goalChancePrecisionOf } from '../goal-chance-driver.js';
import { exactChance, gate, normalChance, type ShareParts } from '../event-by-date-share.js';
import { shareGateForOption, sharePartsForOption } from '../share-by-date-run.js';
import { withShareByDateChanceGate } from '../goal-chance-range.js';
import { GOAL_FIGURES_SHARE_APPROXIMATION } from '../../../orchestrator/context/option-result-source.js';

type Rec = Record<string, any>;
const fixture = (name: string): Rec => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const ENGINE = (): Rec => fixture('ebd-paul-real-engine-response-6ec01e8.json');
const GRAPH = (): Rec => fixture('ebd-paul-stored-graph-20261012.json');
const GOAL = 'event_goal';
const OPTIONS = ['event_option_1', 'event_option_2', 'event_option_3'];
const withConstraint = (r: Rec, edit: (c: Rec) => Rec): Rec => ({ ...r, constraint_results: r.constraint_results.map(edit) }) as Rec;

describe('DL (b1): the goal’s own constraint is the figure where PLoT gives no probability_of_goal at threshold 1', () => {
  it('precondition: the real engine sent no probability_of_goal, and its auto constraint sits on the goal at >= 1', () => {
    const r = ENGINE();
    for (const o of r.option_comparison) expect('probability_of_goal' in o, o.option_id).toBe(false);
    expect(r.constraint_results).toEqual([expect.objectContaining({ constraint_id: GOAL_OWN_CONSTRAINT_ID, node_id: GOAL, operator: '>=', value: 1 })]);
    expect(GRAPH().nodes.find((n: Rec) => n.id === GOAL)).toMatchObject({ goal_threshold: 1, goal_direction: '>=' });
  });

  it('Paul’s real-engine response: the licence quotes 83 / 95 / 42, each with its own 95% Wilson block on n = 10,000', () => {
    const r = ENGINE(), g = GRAPH();
    const licence = goalChanceLicenceOf(r, g, GOAL)!;
    expect(licence).not.toBeNull();
    expect(licence.pct_by_option).toEqual({ event_option_1: 83, event_option_2: 95, event_option_3: 42 });
    expect(licence.withheld_option_ids).toBeUndefined();
    const read = goalOwnConstraintChanceRecords(r, g, GOAL, r.option_comparison);
    expect([...read.engineRead].sort()).toEqual(OPTIONS);
    for (const rec of read.records as Rec[]) {
      expect(rec.probability_of_goal).toBe(rec.constraint_probabilities[GOAL_OWN_CONSTRAINT_ID]);
      expect(goalChancePrecisionOf(rec)).toMatchObject({ n_informative: 10000, n_met: Math.round(rec.probability_of_goal * 10000) });
    }
    // The Run's own records are never edited.
    expect(r.option_comparison.every((o: Rec) => !('probability_of_goal' in o))).toBe(true);
  });

  it('DL (b1)(ii): an ENGINE-READ figure skips the 2-point test; where CEE’s own approximation is the figure, the test still applies', () => {
    const r = ENGINE(), g = GRAPH();
    // Contrast: the same option with CEE's own approximation as its figure is not a point under the 2-point test.
    const parts = sharePartsForOption(g, 'event_option_2')!;
    expect(Math.abs(normalChance(parts, 1) - exactChance(parts, 1)) * 100).toBeGreaterThan(2);
    expect(shareGateForOption(g, 'event_option_2', 0.9515)?.form).toBe('range');
    const approximated = { ...r, option_comparison: r.option_comparison.map((o: Rec) => ({ ...o, probability_of_goal: normalChance(sharePartsForOption(g, o.option_id)!, 1) })) };
    expect(goalChanceLicenceOf(approximated, g, GOAL)!.withheld_option_ids).toEqual(expect.arrayContaining(['event_option_2', 'event_option_3']));
    // The engine-read figure is quoted as the engine's point.
    expect(goalChanceLicenceOf(r, g, GOAL)!.pct_by_option.event_option_2).toBe(95);
  });

  it.each([
    ['a different constraint id', (c: Rec) => ({ ...c, constraint_id: 'c_deadline' })],
    ['another node', (c: Rec) => ({ ...c, node_id: 'event_team' })],
    ['a strict operator', (c: Rec) => ({ ...c, operator: '>' })],
    ['another threshold', (c: Rec) => ({ ...c, value: 0.9 })],
  ])('CONTRAST — %s: no read, every figure withheld', (_name, edit) => {
    const r = withConstraint(ENGINE(), edit), g = GRAPH();
    expect(goalOwnConstraintChanceRecords(r, g, GOAL, r.option_comparison).engineRead.size).toBe(0);
    const licence = goalChanceLicenceOf(r, g, GOAL);
    expect(licence === null || Object.keys(licence.pct_by_option).length === 0).toBe(true);
  });

  it('CONTRAST — one entry of the auto id that does not bind (a second, on another node) vetoes the read', () => {
    const r = ENGINE();
    const two: Rec = { ...r, constraint_results: [...r.constraint_results, { ...r.constraint_results[0], node_id: 'event_team', option_id: 'event_option_2' }] };
    expect(goalOwnConstraintChanceRecords(two, GRAPH(), GOAL, two.option_comparison).engineRead.size).toBe(0);
  });

  it('never over a CEE withhold: an option a goal-figures withhold names stays withheld; the others are read', () => {
    const r: Rec = { ...ENGINE(), inference_warnings: [{ code: GOAL_FIGURES_SHARE_APPROXIMATION, severity: 'warning', option_ids: ['event_option_2'], message: 'x' }] };
    const read = goalOwnConstraintChanceRecords(r, GRAPH(), GOAL, r.option_comparison);
    expect([...read.engineRead].sort()).toEqual(['event_option_1', 'event_option_3']);
    const runWide: Rec = { ...ENGINE(), inference_warnings: [{ code: GOAL_FIGURES_SHARE_APPROXIMATION, severity: 'warning', message: 'x' }] };
    expect(goalOwnConstraintChanceRecords(runWide, GRAPH(), GOAL, runWide.option_comparison).engineRead.size).toBe(0);
  });

  it('never the joint of several: a record with only probability_of_joint_goal is not read', () => {
    const r = ENGINE();
    const jointOnly = { ...r, option_comparison: r.option_comparison.map((o: Rec) => {
      const { constraint_probabilities: _c, constraint_probabilities_precision: _p, ...rest } = o;
      return rest;
    }) };
    expect(jointOnly.option_comparison[0].probability_of_joint_goal).toBe(0.8301);
    expect(goalOwnConstraintChanceRecords(jointOnly, GRAPH(), GOAL, jointOnly.option_comparison).engineRead.size).toBe(0);
  });

  it('a record that carries probability_of_goal keeps it (the read never overrides the engine’s own goal figure)', () => {
    const r = ENGINE();
    const carried = { ...r, option_comparison: r.option_comparison.map((o: Rec) => ({ ...o, probability_of_goal: 0.5 })) };
    const read = goalOwnConstraintChanceRecords(carried, GRAPH(), GOAL, carried.option_comparison);
    expect(read.engineRead.size).toBe(0);
    expect((read.records as Rec[]).map((x) => x.probability_of_goal)).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('DL 12 Oct: the share gate’s three branches where CEE’s own approximation is the figure (probability_of_goal present)', () => {
  // A narrow team time (7.00–7.01 months to finish, six months to the deadline) and one hire starting 0–6 months in, adding
  // 10% a month: the Normal stands in badly for the hire's uniform start (error > 2 points), yet both ends of the exact law's
  // range show the same whole %.
  const narrow: ShareParts = { team: { quantity: 'months_to_finish', D: 6, low: 7, high: 7.01 }, extra: { monthlyShare: 0.1, D: 6, leadLow: 0, leadHigh: 6 } };

  it('equal ends: the exact law’s own figure is the point (monotone in the team’s time), never a range or nothing', () => {
    const at = (v: number): number => exactChance({ ...narrow, team: { ...narrow.team, low: v, high: v } }, 1);
    expect(Math.abs(normalChance(narrow, 1) - exactChance(narrow, 1)) * 100).toBeGreaterThan(2);
    expect(Math.round(at(7) * 100)).toBe(Math.round(at(7.01) * 100));
    const decision = gate(narrow, 1);
    expect(decision).toMatchObject({ form: 'point', exact_point: exactChance(narrow, 1) });
    expect(Math.round(exactChance(narrow, 1) * 100)).toBe(Math.round(at(7) * 100));
  });

  it('distinct ends: a range, as before (control: Paul’s two developers under CEE’s own approximation)', () => {
    const decision = gate(sharePartsForOption(GRAPH(), 'event_option_2')!, 1);
    expect(decision.form).toBe('range');
    if (decision.form === 'range') expect(Math.round(decision.low * 100)).not.toBe(Math.round(decision.high * 100));
  });

  it('unsupported parts (three ranged starts on one option): withheld with E5’s next step, never a wordless withhold', () => {
    const g = GRAPH();
    const third = { ...structuredClone(g.nodes.find((n: Rec) => n.id === 'event_capacity_1')), id: 'event_capacity_3', label: 'Third hire' };
    g.nodes.push(third);
    g.edges.push({ ...structuredClone(g.edges.find((e: Rec) => e.from === 'event_capacity_1' && e.to === GOAL)), from: 'event_capacity_3' });
    for (const o of g.nodes.filter((n: Rec) => n.kind === 'option')) {
      o.interventions = { ...o.interventions, event_capacity_3: { value: o.id === 'event_option_2' ? 1 : 0 } };
      g.edges.push({ ...structuredClone(g.edges.find((e: Rec) => e.from === o.id && e.to === 'event_capacity_1')), to: 'event_capacity_3' });
    }
    g.nodes.find((n: Rec) => n.id === 'event_option_2').interventions.event_capacity_1 = { value: 1 };
    expect(sharePartsForOption(g, 'event_option_2'), 'three ranged starts exceed the exact check').toBeNull();
    const run = { option_comparison: OPTIONS.map(id => ({ option_id: id, probability_of_goal: 0.5 })) };
    const ws = ((withShareByDateChanceGate(run, g, GOAL) as Rec).inference_warnings ?? []) as Rec[];
    const own = ws.filter(w => Array.isArray(w.option_ids) && w.option_ids.includes('event_option_2'));
    expect(own.map(w => w.message)).toEqual(['Not shown. Olumi can use at most two start times for ‘Hire two developers’ yet: say which two starts to use.']);
    expect(JSON.stringify(ws)).not.toContain('so this chance is not shown');
  });
});
