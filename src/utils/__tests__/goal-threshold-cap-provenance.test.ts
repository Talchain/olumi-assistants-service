/**
 * THE DENOMINATOR IS DERIVED FROM THE TARGET, SO THE NUMERATOR CANNOT SURVIVE IT.
 *
 * `resolveGoalThresholdCap` rule 3 returns `raw * 1.25`. Every mint site then
 * computes `goal_threshold = raw / cap`. Compose the two and the target cancels:
 *
 *     raw / (raw * 1.25) === 0.8      for EVERY raw > 0
 *
 * So on the headroom rule `goal_threshold` is the CONSTANT 0.8 — the same number
 * for "reach GBP 20,000 MRR" and "reach GBP 20,000,000 MRR" — and ISL scores
 * `P(sample >= 0.8)` in both cases. The user's figure survives only in
 * `goal_threshold_raw`; the normalised value carries no information about the
 * goal at all. It is a constant of the rule, not a measurement of anything.
 *
 * That is not a bug in the arithmetic — a headroom cap is a reasonable way to
 * put a target on a 0-1 scale when nothing better exists. It is a PROVENANCE
 * gap: nothing on the wire distinguishes a denominator the metric supplied
 * (rule 2: a percentage normalises against 100) or one an earlier registration
 * supplied (rule 1) from one this rule invented out of the target itself
 * (rule 3). A consumer cannot fail closed on a denominator it cannot see.
 *
 * These tests pin the rules AND the constant, so the disclosure below can never
 * drift from the arithmetic it describes.
 */
import { describe, expect, it } from 'vitest';

import {
  GOAL_THRESHOLD_CAP_PROVENANCE,
  resolveGoalThresholdCap,
  resolveGoalThresholdCapWithProvenance,
} from '../goal-threshold-cap.js';

describe('the headroom denominator collapses every target to one number', () => {
  /**
   * Deliberately spanning nine orders of magnitude and five units. If the
   * normalised threshold carried ANY information about the target, these could
   * not all be equal.
   */
  const TARGETS: ReadonlyArray<readonly [number, string | undefined]> = [
    [20_000, 'GBP'],
    [20_000_000, 'GBP'],
    [200, 'customers'],
    [3, 'hires'],
    [0.5, 'x'],
    [110, '%'], // > 100, so rule 2 does NOT fire and the headroom rule does
    [7, undefined],
  ];

  it.each(TARGETS)(
    'raw %s (%s) normalises to exactly 0.8 — the target cancels',
    (raw, unit) => {
      const cap = resolveGoalThresholdCap(undefined, raw, unit, undefined);
      expect(cap).not.toBeNull();
      expect(raw / (cap as number)).toBeCloseTo(0.8, 12);
    },
  );

  it('and the resolver says so: every one of them is target_derived_headroom', () => {
    for (const [raw, unit] of TARGETS) {
      const resolved = resolveGoalThresholdCapWithProvenance(
        undefined,
        raw,
        unit,
        undefined,
      );
      expect(resolved?.provenance).toBe('target_derived_headroom');
    }
  });

  it('CONTRAST — a metric-supplied denominator does NOT collapse', () => {
    // Rule 2's denominator is the percentage scale itself, which is independent
    // of the target, so different targets give different thresholds. This is
    // the discrimination the provenance marker exists to carry; without this
    // arm the test above would be consistent with "all thresholds are 0.8".
    const four = resolveGoalThresholdCapWithProvenance(undefined, 4, '%', undefined);
    const ninetySix = resolveGoalThresholdCapWithProvenance(undefined, 96, '%', undefined);
    expect(four?.provenance).toBe('metric_scale');
    expect(ninetySix?.provenance).toBe('metric_scale');
    expect(4 / (four?.cap as number)).toBeCloseTo(0.04, 12);
    expect(96 / (ninetySix?.cap as number)).toBeCloseTo(0.96, 12);
  });
});

describe('every branch of the resolver names the rule that produced its cap', () => {
  it('rule 2 — a percentage normalises against its own scale', () => {
    expect(resolveGoalThresholdCapWithProvenance(undefined, 80, '%', undefined)).toEqual({
      cap: 100,
      provenance: 'metric_scale',
    });
  });

  it('rule 2 beats an inherited cap, and the provenance follows the rule that won', () => {
    // The doctrine's own example: 80% against an inherited cap of 1000 would
    // score 0.08 instead of 0.8. Rule 2 fires first — and the marker must name
    // rule 2, not the cap that lost.
    expect(resolveGoalThresholdCapWithProvenance(1000, 80, '%', '%')).toEqual({
      cap: 100,
      provenance: 'metric_scale',
    });
  });

  it('rule 1 — a compatible, strictly larger existing cap is inherited', () => {
    expect(
      resolveGoalThresholdCapWithProvenance(1000, 800, 'customers', 'customers'),
    ).toEqual({ cap: 1000, provenance: 'inherited' });
  });

  it('rule 3 — a cap equal to the target is NOT inherited; headroom is re-derived', () => {
    // ROADMAP 2.239: `>=` here made the forbidden `goal_threshold = 1.0` state
    // reachable. The provenance must report the rule that actually ran.
    expect(
      resolveGoalThresholdCapWithProvenance(800, 800, 'customers', 'customers'),
    ).toEqual({ cap: 1000, provenance: 'target_derived_headroom' });
  });

  it('an incompatible unit cannot be inherited — headroom, and it says so', () => {
    expect(
      resolveGoalThresholdCapWithProvenance(1000, 800, 'GBP', 'customers'),
    ).toEqual({ cap: 1000, provenance: 'target_derived_headroom' });
  });

  it('a non-positive target has no sound denominator and no provenance to claim', () => {
    expect(resolveGoalThresholdCapWithProvenance(undefined, 0, 'GBP', undefined)).toBeNull();
    expect(resolveGoalThresholdCapWithProvenance(undefined, -5, 'GBP', undefined)).toBeNull();
  });

  it('the sanctioned cap === target: "100%" keeps its ceiling and stays metric_scale', () => {
    // Deliberate, and documented as such at the resolver. `P(x >= 1.0)` is the
    // honest question for "achieve 100% retention"; applying headroom here
    // would silently rescale the user`s stated 100% to 0.8 of the scale.
    expect(resolveGoalThresholdCapWithProvenance(undefined, 100, '%', undefined)).toEqual({
      cap: 100,
      provenance: 'metric_scale',
    });
  });

  it('the enum covers exactly the branches the resolver can take', () => {
    expect([...GOAL_THRESHOLD_CAP_PROVENANCE].sort()).toEqual([
      'inherited',
      'metric_scale',
      'target_derived_headroom',
    ]);
  });
});

describe('ONE authority — the scalar resolver is a projection, not a second copy', () => {
  /**
   * `resolveGoalThresholdCap` has four production call sites and must keep
   * returning exactly what it returned before. If the two functions ever hold
   * separate copies of the rules they will drift, and the drift reads as green
   * (CLAUDE.md trap 12). This asserts the scalar is literally the `.cap` of the
   * richer result across every branch, including the null one.
   */
  const CASES: ReadonlyArray<
    readonly [unknown, number, string | undefined, unknown]
  > = [
    [undefined, 80, '%', undefined],
    [1000, 80, '%', '%'],
    [1000, 800, 'customers', 'customers'],
    [800, 800, 'customers', 'customers'],
    [1000, 800, 'GBP', 'customers'],
    [undefined, 20_000, 'GBP', undefined],
    [undefined, 100, '%', undefined],
    [undefined, 0, 'GBP', undefined],
    [undefined, -5, 'GBP', undefined],
    [Number.NaN, 800, 'customers', 'customers'],
  ];

  it.each(CASES)(
    'scalar === rich.cap for (%s, %s, %s, %s)',
    (existingCap, raw, unit, existingUnit) => {
      const scalar = resolveGoalThresholdCap(existingCap, raw, unit, existingUnit);
      const rich = resolveGoalThresholdCapWithProvenance(
        existingCap,
        raw,
        unit,
        existingUnit,
      );
      expect(scalar).toBe(rich === null ? null : rich.cap);
    },
  );
});
