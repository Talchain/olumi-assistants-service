/**
 * D3 STEP 1 — THE GOAL CHANCE IS A PROBABILITY OF MEETING A STATED TARGET, OR IT IS NOT SHOWN (DL 0df0e1, PL rec 5;
 * #87 6006078553). RED rows the DL named: NaN / ∞ / 1.2 / −0.1 / missing target. Each withheld option is named with its
 * typed cause; its win share is NEVER put where the goal chance was; a valid option beside it keeps its chance (control).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withholdUnusableGoalChances, goalChanceTargetCause, GOAL_FIT_UNUSABLE, GOAL_FIGURES_NO_STATED_TARGET } from '../goal-chance-gate.js';
import { GOAL_FIGURES_PROBABILITY_UNUSABLE, GOAL_FIGURES_WITHHELD_CODES, runWithheldGoalFigures } from '../../../orchestrator/context/option-result-source.js';

type Json = Record<string, any>;
const RT10B = JSON.parse(readFileSync(new URL('../../tools/handlers/__tests__/fixtures/bprime-rt10b.json', import.meta.url), 'utf8')) as {
  graph_without_target: Json; graph_with_target: Json;
};
const GOAL = 'monthly_cancellations';

const envelope = (p: unknown, fit: unknown = 0.42): Json => ({
  option_comparison: [
    { option_id: 'a', id: 'a', probability_of_goal: p, win_probability: 0.7, outcome: { mean: 0.5, p10: 0.4, p90: 0.6 } },
    { option_id: 'b', id: 'b', probability_of_goal: 0.42, win_probability: 0.3, outcome: { mean: 0.6, p10: 0.5, p90: 0.7 } },
  ],
  decision_brief: { analysis_summary: { goal_fit: fit, leading_option: 'a' } },
  inference_warnings: [],
});
const rowOf = (e: Json, id: string): Json => e.option_comparison.find((r: Json) => r.option_id === id);
const gateWarning = (e: Json): Json | undefined => (e.inference_warnings as Json[]).find((w) => w.code === GOAL_FIGURES_PROBABILITY_UNUSABLE && Array.isArray(w.causes));

describe('D3 step 1 — the goal-chance seam gate', () => {
  it('PRECONDITION: the stated ceiling (rt10b: held "<=", its own row 400, a unit, minimised) is a stated target; no target is not', () => {
    expect(goalChanceTargetCause(RT10B.graph_with_target, GOAL)).toBeNull();
    expect(goalChanceTargetCause(RT10B.graph_without_target, GOAL)).toBe('no_stated_target');
  });

  it('CONTROL: a finite chance in [0, 1] beside a stated target passes untouched (the same envelope back)', () => {
    const e = envelope(0.15);
    expect(withholdUnusableGoalChances(e, RT10B.graph_with_target, GOAL)).toBe(e);
  });

  it.each([
    ['NaN', Number.NaN, 'not_finite'],
    ['∞', Number.POSITIVE_INFINITY, 'not_finite'],
    ['1.2', 1.2, 'outside_unit_interval'],
    ['−0.1', -0.1, 'outside_unit_interval'],
    ['a string', '0.3', 'not_finite'],
  ] as const)('RED row %s: that option\'s chance is withheld with its cause; the other keeps 0.42; no share is substituted', (_n, p, cause) => {
    const out = withholdUnusableGoalChances(envelope(p), RT10B.graph_with_target, GOAL) as Json;
    expect(rowOf(out, 'a')).not.toHaveProperty('probability_of_goal');
    expect(rowOf(out, 'a').win_probability).toBe(0.7); // the ordering stays, as a share — never as the goal chance
    expect(rowOf(out, 'b').probability_of_goal).toBe(0.42);
    expect(gateWarning(out)).toMatchObject({ option_ids: ['a'], causes: [{ option_id: 'a', cause }] });
    expect(GOAL_FIGURES_WITHHELD_CODES.has(GOAL_FIGURES_PROBABILITY_UNUSABLE)).toBe(true);
    // The leader's goal_fit goes with a withheld goal chance (a target claim), whatever its own value.
    expect(out.decision_brief.analysis_summary).not.toHaveProperty('goal_fit');
    expect(out.decision_brief.analysis_summary.leading_option).toBe('a');
  });

  it('RED row MISSING TARGET: every option\'s chance and goal_fit go, typed no_stated_target — ONLY those (nothing else moves)', () => {
    const out = withholdUnusableGoalChances(envelope(0.15), RT10B.graph_without_target, GOAL) as Json;
    for (const id of ['a', 'b']) expect(rowOf(out, id)).not.toHaveProperty('probability_of_goal');
    expect(out.decision_brief.analysis_summary).not.toHaveProperty('goal_fit');
    expect((out.inference_warnings as Json[])).toEqual([expect.objectContaining({
      code: GOAL_FIGURES_NO_STATED_TARGET, severity: 'info', option_ids: ['a', 'b'], cause: 'no_stated_target', goal_fit_removed: true,
      invite: { kind: 'state_goal_target', goal_node_id: GOAL } })]);
    // Every other figure stays (shares, outcome, the leader), and no reader is told a target "could not be tested".
    expect(rowOf(out, 'a')).toMatchObject({ win_probability: 0.7, outcome: { mean: 0.5, p10: 0.4, p90: 0.6 } });
    expect(out.decision_brief.analysis_summary.leading_option).toBe('a');
    expect(GOAL_FIGURES_WITHHELD_CODES.has(GOAL_FIGURES_NO_STATED_TARGET)).toBe(false);
    expect(runWithheldGoalFigures(out)).toBe(false);
  });

  it('goal_fit ALONE unusable (1.3) with every option valid: goal_fit is withheld with its cause, every option keeps its chance', () => {
    const out = withholdUnusableGoalChances(envelope(0.15, 1.3), RT10B.graph_with_target, GOAL) as Json;
    expect(rowOf(out, 'a').probability_of_goal).toBe(0.15);
    expect(out.decision_brief.analysis_summary).not.toHaveProperty('goal_fit');
    expect((out.inference_warnings as Json[])).toEqual([expect.objectContaining({ code: GOAL_FIT_UNUSABLE, goal_fit_cause: 'outside_unit_interval' })]);
    // Codex buddy r2 F1: no option's figure was withheld, so the run's option records are NOT read as withheld.
    expect(GOAL_FIGURES_WITHHELD_CODES.has(GOAL_FIT_UNUSABLE)).toBe(false);
    expect(runWithheldGoalFigures(out)).toBe(false);
    // CONTROL: a per-option withhold IS read as withheld.
    expect(runWithheldGoalFigures(withholdUnusableGoalChances(envelope(1.2), RT10B.graph_with_target, GOAL) as Json)).toBe(true);
  });

  it('a held ceiling the run did NOT minimise (no proof of its sense) is not a chance of meeting it: ceiling_not_minimised', () => {
    const g = { nodes: [{ id: 'goal', kind: 'goal', label: 'Revenue', goal_direction: '<=', goal_threshold_raw: 400, goal_threshold_unit: '£' }], edges: [] };
    expect(goalChanceTargetCause(g, 'goal')).toBe('ceiling_not_minimised');
    const out = withholdUnusableGoalChances(envelope(0.15), g, 'goal') as Json;
    expect(gateWarning(out)?.causes[0]).toEqual({ option_id: 'a', cause: 'ceiling_not_minimised' });
  });

  // ⭐ floor_minimised (Review Desk 6b; DL 0df0e1 pulled forward; rows pre-registered by Science d5, #87 6007413821).
  describe('the stated comparator and the scored sense must agree, both ways', () => {
    const goalOf = (label: string, held: string, raw: number) =>
      ({ nodes: [{ id: 'goal', kind: 'goal', label, goal_direction: held, goal_threshold_raw: raw, goal_threshold_unit: 'tickets' }], edges: [] });

    it('CAUSE (RED on base): ">= 300" on a goal the run MINIMISED (a "reduce" label) scored P(≤300) → withheld, floor_minimised', () => {
      const g = goalOf('Reduce support tickets', '>=', 300);
      expect(goalChanceTargetCause(g, 'goal')).toBe('floor_minimised');
      const out = withholdUnusableGoalChances(envelope(0.15), g, 'goal') as Json;
      expect(rowOf(out, 'a')).not.toHaveProperty('probability_of_goal');
      expect(gateWarning(out)?.causes).toEqual([{ option_id: 'a', cause: 'floor_minimised' }, { option_id: 'b', cause: 'floor_minimised' }]);
      // The same floor on a goal the run did not minimise is a chance of meeting it: nothing withheld.
      expect(goalChanceTargetCause(goalOf('Support tickets handled', '>=', 300), 'goal')).toBeNull();
    });

    it('CONTROL: "<= 400" on the same minimised goal is a chance of staying at or below it — unchanged', () => {
      const g = goalOf('Reduce support tickets', '<=', 400);
      expect(goalChanceTargetCause(g, 'goal')).toBeNull();
      expect(withholdUnusableGoalChances(envelope(0.15), g, 'goal')).toEqual(envelope(0.15));
    });

    it('CONTROL (Codex r1): "at least a 20% cut" — held ">=" on a NEGATIVE typed change — points DOWN; minimising is its sense', () => {
      for (const frame of ['change_rel', 'change_abs'] as const) {
        const raw = frame === 'change_rel' ? -0.2 : -500;
        const g = { nodes: [{ id: 'goal', kind: 'goal', label: 'Reduce cloud costs', goal_direction: '>=', goal_threshold_frame: frame,
          goal_threshold_raw: raw, goal_threshold: raw, goal_threshold_unit: '£/month' }], edges: [] };
        expect(goalChanceTargetCause(g, 'goal'), frame).toBeNull();
        // …while a POSITIVE change held as a floor ("grow by at least 20%") on the same minimised goal still conflicts.
        const up = { nodes: [{ ...g.nodes[0], goal_threshold_raw: -raw, goal_threshold: -raw }], edges: [] };
        expect(goalChanceTargetCause(up, 'goal'), `${frame} positive`).toBe('floor_minimised');
      }
    });

    it('MIRROR: "<= 400" on a goal the run MAXIMISED (an "increase" label) scored P(≥400) → withheld, ceiling_not_minimised', () => {
      const g = goalOf('Increase support tickets handled', '<=', 400);
      expect(goalChanceTargetCause(g, 'goal')).toBe('ceiling_not_minimised');
      const out = withholdUnusableGoalChances(envelope(0.15), g, 'goal') as Json;
      expect(rowOf(out, 'a')).not.toHaveProperty('probability_of_goal');
    });
  });

  it('the threshold CEE holds on the goal (raw figure absent on an older graph) is the target the Run scored; NONE is not', () => {
    const held = { nodes: [{ id: 'goal', kind: 'goal', label: 'MRR', goal_threshold: 0.8, goal_threshold_unit: '£/month', goal_direction: '>=' }], edges: [] };
    expect(goalChanceTargetCause(held, 'goal')).toBeNull();
    const none = { nodes: [{ id: 'goal', kind: 'goal', label: 'MRR' }], edges: [] }; // PLoT's synthesised target only
    expect(goalChanceTargetCause(none, 'goal')).toBe('no_stated_target');
  });

  it('NO STATED DIRECTION: every chance withheld, typed, and the warning carries the "at least / at most {target}?" invite', () => {
    const g = { nodes: [{ id: 'goal', kind: 'goal', label: 'MRR', goal_threshold_raw: 100000, goal_threshold: 0.8, goal_threshold_unit: '£/month' }], edges: [] };
    const out = withholdUnusableGoalChances(envelope(0.15), g, 'goal') as Json;
    expect(rowOf(out, 'a')).not.toHaveProperty('probability_of_goal');
    expect(gateWarning(out)).toMatchObject({
      causes: [{ option_id: 'a', cause: 'no_stated_direction' }, { option_id: 'b', cause: 'no_stated_direction' }],
      invite: { kind: 'state_goal_direction', goal_node_id: 'goal', target: { value: 100000, unit: '£/month' } },
    });
    // A target stated as a CHANGE carries its direction in its sign ("cut by 20%"): stated, never invited.
    const change = { nodes: [{ id: 'goal', kind: 'goal', label: 'Spend', goal_threshold_frame: 'change_rel', goal_threshold_raw: -0.2,
      goal_threshold: -0.2, goal_threshold_unit: '£/month' }], edges: [] };
    expect(goalChanceTargetCause(change, 'goal')).not.toBe('no_stated_direction');
    // CONTROL: a held comparator is a stated direction — nothing withheld, no invite.
    const held = { nodes: [{ ...g.nodes[0], goal_direction: '>=' }], edges: [] };
    expect(withholdUnusableGoalChances(envelope(0.15), held, 'goal')).toEqual(envelope(0.15));
  });

  it('a target with no stated direction, or no unit, is not a stated target either', () => {
    const noDirection = { nodes: [{ id: 'goal', kind: 'goal', label: 'Revenue', goal_threshold_raw: 400, goal_threshold_unit: '£' }], edges: [] };
    const noUnit = { nodes: [{ id: 'goal', kind: 'goal', label: 'Revenue', goal_direction: '>=', goal_threshold_raw: 400 }], edges: [] };
    // ⭐ STEP 2 (DL 0df0e1; c6): withheld WITH its one-click invitation (the row below pins the invite).
    expect(goalChanceTargetCause(noDirection, 'goal')).toBe('no_stated_direction');
    expect(goalChanceTargetCause(noUnit, 'goal')).toBe('no_target_unit');
  });
});
