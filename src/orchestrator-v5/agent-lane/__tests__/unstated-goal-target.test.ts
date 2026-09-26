/**
 * ⛔ AN UNSTATED GOAL TARGET MUST STAY UNSTATED (#63 5811781699).
 *
 * MEASURED on Paul's hiring brief — "Should I hire a Tech lead or two developers to
 * increase productivity?" — against the captured bundle: "Goal productivity_increase
 * is stamped from_brief, threshold_raw 0, unit %, frame level; admission says
 * goal_target_stated=true. Brief states no numeric target."
 *
 * The product told the user they had asked for a 0% increase. The cause was that the
 * candidate schema made the absence UNSAYABLE: `value` was a bare `{type:'number'}`
 * in `required`, so the producer had to emit a number and emitted 0.
 *
 * ⭐ THE BASE OF EVERY CASE BELOW IS THE COMMITTED LIVE CAPTURE, with ONLY the goal's
 * own fields varied. A fixture written here would be evidence about my model of the
 * producer rather than about the producer, which this directory forbids.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { admitCandidateModel, type CandidateModel, type WidenerAdditions } from '../admit-model.js';

const here = new URL('./fixtures/', import.meta.url);
const captured = JSON.parse(readFileSync(new URL('faithful.json', here), 'utf8')) as CandidateModel;
const widened = JSON.parse(readFileSync(new URL('widened.json', here), 'utf8')) as WidenerAdditions;

/** The captured candidate with ONLY its goal replaced. */
const withGoal = (goal: Partial<CandidateModel['goal']>): CandidateModel =>
  ({ ...captured, goal: { ...captured.goal, ...goal } }) as CandidateModel;

const goalNodeOf = (m: { nodes: readonly object[] }) => {
  const g = (m.nodes as readonly Record<string, unknown>[]).find((n) => n['kind'] === 'goal');
  expect(g, 'the captured candidate must yield a goal node').toBeDefined();
  return g as Record<string, unknown>;
};

describe('a goal target the brief did not state', () => {
  it('⭐ RED: target_stated false leaves NO threshold — so nothing can attribute a number to the user', () => {
    const g = goalNodeOf(admitCandidateModel(withGoal({ target_stated: false, value: null }), widened));

    // Bound by KEY ABSENCE, not by `=== 0`: a 0 that is present is the whole defect,
    // and `goal_threshold_raw === 0` would pass a predicate written against a value.
    expect('goal_threshold_raw' in g, 'a target nobody stated must not be recorded').toBe(false);
    expect('goal_threshold' in g).toBe(false);
    expect('goal_threshold_cap' in g).toBe(false);
    expect('goal_threshold_cap_provenance' in g).toBe(false);

    // ⚠ And this is the load-bearing consequence, not a second opinion about it:
    // `goalTargetStated` in admission/analysis-admission.ts is
    // `'goal_threshold_raw' in pickGoalThresholdTrio(carrier)` — key presence. So
    // absence here is what makes `semantic_signals.goal_target_stated` tell the truth.
    expect(Object.keys(g).some((k) => k.startsWith('goal_threshold') && k !== 'goal_threshold_frame' && k !== 'goal_threshold_unit')).toBe(false);
  });

  it('⭐ the goal still exists and is still analysable — an unstated target is an ordinary goal', () => {
    const m = admitCandidateModel(withGoal({ target_stated: false, value: null }), widened);
    const g = goalNodeOf(m);
    expect(g['kind']).toBe('goal');
    expect(g['label']).toBe(captured.goal.metric);
    // The frame is a unit of measurement, not a claim about a target, so it stays.
    expect('goal_threshold_frame' in g, 'the frame is not a target and must survive').toBe(true);
    expect(m.nodes.length).toBeGreaterThanOrEqual(20);
  });

  it('⛔ CONTRAST: a target the user DID state is recorded in full', () => {
    const g = goalNodeOf(admitCandidateModel(withGoal({ target_stated: true, value: 40, unit: '%' }), widened));
    expect(g['goal_threshold_raw']).toBe(40);
    expect(g['goal_threshold_cap']).toBe(100);           // '%' normalises against 100
    expect(g['goal_threshold']).toBeCloseTo(0.4, 10);
    expect(g['goal_threshold_unit']).toBe('%');
  });

  it('⛔ BACKWARD COMPATIBILITY: a candidate minted before `target_stated` behaves exactly as it did', () => {
    const { target_stated: _omitted, ...goalWithoutFlag } = { ...captured.goal, target_stated: undefined, value: 40, unit: '%' };
    const g = goalNodeOf(admitCandidateModel({ ...captured, goal: goalWithoutFlag } as CandidateModel, widened));
    expect('goal_threshold_raw' in g, 'no flag + a real number still records the target').toBe(true);
    expect(g['goal_threshold_raw']).toBe(40);
  });

  it('⛔ a non-finite value withholds the threshold even if the flag claims a target', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, null]) {
      const g = goalNodeOf(admitCandidateModel(withGoal({ target_stated: true, value: bad as number }), widened));
      expect('goal_threshold_raw' in g, `value ${String(bad)} must not be recorded as a target`).toBe(false);
    }
  });
});
