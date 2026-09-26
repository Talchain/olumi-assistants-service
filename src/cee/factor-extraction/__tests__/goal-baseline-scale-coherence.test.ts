/**
 * ROADMAP 2.1160 — THE DRAFT PATH MINTS A CURRENT LEVEL THE `>=` FRAME CANNOT
 * EXPRESS, AND ITS SIBLING ALREADY REFUSES TO.
 *
 * ⚠ THE DEFECT, STATED AS A SEAM AND NOT AS A SENTENCE. The chat path takes its
 * stated current level from `extractGoalTargetWithBaseline`, which REFUSES a
 * decreasing pair by name — `direction_unsupported`, `index.ts:1771-1782`,
 * ROADMAP 2.353 review A2: *"ISL scores P(level >= threshold) and the goal
 * contract carries NO DIRECTION FIELD … a threshold BELOW its baseline enters a
 * `>=` seam that INVERTS the question, and what comes back is not a smaller
 * probability, it is the wrong one, wearing the same confident badge."*
 *
 * `applyGoalTargetRedirect` — the draft path's twin writer — consults NO such
 * rule. It divides whatever `factor.baseline` it is handed by the same cap and
 * stamps it. That is trap 22b exactly: one harm closed on one route and left
 * open on its neighbour, and neither route's tests can see the other.
 *
 * ── MEASURED, NOT INFERRED ────────────────────────────────────────────────
 * Staging Supabase `etmmuzwxtcjipwphdola`, `public.scenarios` (14,447 rows,
 * newest 2026-09-18 21:01:49Z): 71 persisted goal nodes carry BOTH a
 * `goal_threshold_cap` and an `observed_state.baseline`. One of them —
 * "Cut Customer Support Response Times", created 2026-09-10 22:05:08Z — carries
 * `cap 2.5`, `goal_threshold_raw 2`, `observed_state.raw_value 14`, i.e.
 * `observed_state.baseline = 5.6`: a normalised current level **5.6× its own
 * ceiling**, on a goal whose target is BELOW it. It postdates the chat path's
 * refusal (`f68f0e53`, 2026-08-03) by five weeks, which is what pins the route.
 *
 * ⚠ AND THE REACHABILITY IS ROUTE-SPECIFIC, WHICH IS WHY THESE CASES DRIVE THE
 * WRITER DIRECTLY. On the REGEX extraction route the hole is not reachable:
 * the only factor that carries both a goal-synonym label and a `baseline` is
 * the one `resolveGoalPair` mints (`index.ts:2237-2251`), and that resolver
 * already refuses decreases — measured at this tip over eight decreasing
 * briefs, every one of which produced `inferLabel` labels ("Value", "Cost",
 * "Churn Rate") that `isTargetGoalLabel` rejects. The LLM extraction route
 * carries the model's OWN label straight through with its baseline
 * (`llm-extractor.ts:318`) and passes through no goal-pair refusal at all.
 * A brief-level fixture would therefore prove nothing about the route that
 * actually fires; `applyGoalTargetRedirect` is exported for exactly this reason
 * (`enricher.ts:1392-1395`: *"this tests the function that writes"*).
 *
 * ── WHAT IS WITHHELD, AND WHAT IS NOT ─────────────────────────────────────
 * ONLY `goal_baseline` / `goal_baseline_raw`. The target trio
 * (`goal_threshold_raw` / `_unit` / `_cap`) and `goal_threshold` itself are
 * untouched, so "Target: £90" stays on screen and stays true. Without the
 * baseline, `schema-v3.ts:405` builds no `observed_state`, ISL refuses with
 * `missing_goal_baseline` and the ranking is withheld — the refusal path this
 * estate already relies on for the 338 of 409 headroom goals that carry no
 * baseline at all. Hiding a true fact to fix an untrue one would be an
 * overcorrection; withholding the untrue one alone is not.
 */
import { describe, expect, it } from 'vitest';

import { applyGoalTargetRedirect } from '../enricher.js';
import { admitGoalBaseline } from '../goal-baseline-admissibility.js';
import type { ExtractedFactor } from '../index.js';
import type { GraphT } from '../../../schemas/graph.js';
import { resolveGoalThresholdCapWithProvenance } from '../../../utils/goal-threshold-cap.js';

function goalOnlyGraph(): GraphT {
  return {
    version: '1',
    default_seed: 17,
    nodes: [
      { id: 'g1', kind: 'goal', label: 'Cost Goal' },
      { id: 'd1', kind: 'decision', label: 'Pricing decision' },
    ],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'test' },
  } as unknown as GraphT;
}

function targetFactor(value: number, baseline: number | undefined): ExtractedFactor {
  return {
    label: 'Target',
    value,
    ...(baseline === undefined ? {} : { baseline }),
    unit: '£',
    confidence: 0.95,
    matchedText: 'test fixture',
    extractionType: 'explicit',
  };
}

/** The node after one redirect, with the mint's own success flag beside it. */
function mint(value: number, baseline: number | undefined) {
  const graph = goalOnlyGraph();
  const applied = applyGoalTargetRedirect(graph, 0, targetFactor(value, baseline));
  return { applied, goal: graph.nodes[0] as Record<string, unknown> };
}

describe('ROADMAP 2.1160 — the draft path withholds a current level the `>=` frame cannot express', () => {
  it('PRECONDITION: this fixture reaches the baseline-stamping branch (the increasing twin mints one)', () => {
    const { applied, goal } = mint(150, 90);

    // The mint ran at all …
    expect(applied).toBe(true);
    // … and reached the branch under test: a cap was resolved, which is the
    // ONLY branch on which a baseline is ever divided and stamped
    // (`enricher.ts:1560-1575`). Without this the cases below could pass on a
    // fixture that never entered the branch — the exact mistake a defaulted
    // fixture made in this estate today.
    expect(goal.goal_threshold_cap).toBe(187.5);
    expect(goal.goal_baseline).toBeCloseTo(90 / 187.5, 12);
    expect(goal.goal_baseline_raw).toBe(90);
  });

  it('a DECREASING stated level is withheld — the target survives, the baseline does not', () => {
    const { applied, goal } = mint(90, 150);

    // Same branch as the precondition case: cap resolved, target stamped.
    expect(applied).toBe(true);
    expect(goal.goal_threshold_cap).toBe(112.5);

    // THE HONEST TARGET DISPLAY IS UNTOUCHED.
    expect(goal.goal_threshold_raw).toBe(90);
    expect(goal.goal_threshold_unit).toBe('£');
    expect(goal.goal_threshold).toBeCloseTo(0.8, 12);

    // THE INVERTED CURRENT LEVEL IS NOT STAMPED.
    expect(goal.goal_baseline).toBeUndefined();
    expect(goal.goal_baseline_raw).toBeUndefined();
  });

  it('EQUALITY still mints — "hold the line" is a real goal, and 2.353 A2 refuses only a decrease', () => {
    const { applied, goal } = mint(150, 150);

    expect(applied).toBe(true);
    expect(goal.goal_threshold_cap).toBe(187.5);
    expect(goal.goal_baseline).toBeCloseTo(150 / 187.5, 12);
    expect(goal.goal_baseline_raw).toBe(150);
  });

  it('the measured staging shape — target 2, stated level 14 — mints no baseline', () => {
    // "Cut Customer Support Response Times", 2026-09-10 22:05:08Z: cap 2.5,
    // goal_threshold_raw 2, observed_state.raw_value 14, baseline 5.6. The
    // unit is deliberately NOT 'hours' here: `unitIsTemporal` would refuse the
    // whole mint for a different reason (`enricher.ts:1479`) and the case would
    // then prove nothing about this guard.
    const { goal } = mint(2, 14);

    expect(goal.goal_threshold_raw).toBe(2);
    expect(goal.goal_threshold_cap).toBe(2.5);
    expect(goal.goal_baseline).toBeUndefined();
  });

  it('SPEC POSTCONDITION: every minted goal_baseline lands inside its own cap', () => {
    // Written against the CONTRACT (`0 <= goal_baseline <= 1`), not against the
    // failure mode in hand — trap 13d. The cases span both admitted directions
    // and the refused one, so a guard that suppressed everything would fail the
    // precondition case above rather than pass this one vacuously.
    for (const [value, baseline] of [
      [150, 90],
      [150, 150],
      [90, 150],
      [2, 14],
      [11_000_000, 8],
    ] as const) {
      const { goal } = mint(value, baseline);
      const minted = goal.goal_baseline;
      if (minted !== undefined) {
        expect(typeof minted).toBe('number');
        expect(minted as number).toBeGreaterThanOrEqual(0);
        expect(minted as number).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('ROADMAP 2.1160 — the two rules are two questions, and they are asked apart', () => {
  it('rule 1 refuses a decrease BY NAME', () => {
    expect(admitGoalBaseline({ rawTarget: 90, rawBaseline: 150, cap: 112.5 })).toEqual({
      admitted: false,
      reason: 'direction_unsupported',
    });
  });

  it('rule 2 refuses an off-scale level the direction rule cannot see', () => {
    // Direction is FINE here — 90 is below the 100 target — and the baseline
    // still lands at 1.8 on a cap of 50. Rule 1 returns "expressible" and rule
    // 2 is the only limb that can refuse it. This is the discrimination that
    // stops rule 2 being a limb that merely agrees with rule 1.
    expect(admitGoalBaseline({ rawTarget: 100, rawBaseline: 90, cap: 50 })).toEqual({
      admitted: false,
      reason: 'baseline_off_cap_scale',
    });
  });

  it('an admissible pair returns the normalised value, not a bare yes', () => {
    expect(admitGoalBaseline({ rawTarget: 150, rawBaseline: 90, cap: 187.5 })).toEqual({
      admitted: true,
      normalised: 0.48,
    });
  });

  it('equality is admitted — the "hold the line" case rule 1 deliberately spares', () => {
    const admission = admitGoalBaseline({ rawTarget: 150, rawBaseline: 150, cap: 187.5 });
    expect(admission.admitted).toBe(true);
  });

  it('PINS THE CAP GUARANTEE the module\'s reachability note depends on', () => {
    // The module states that from the enricher's call site rule 2 is
    // unreachable today, BECAUSE every branch of the cap resolver returns
    // `cap >= raw`. That is a claim about another module, so it is asserted by
    // execution here rather than left as prose (trap 12d: a derived guard
    // proves agreement, a corpus is what notices the rule moved).
    const cases: ReadonlyArray<
      readonly [unknown, number, string | undefined, unknown]
    > = [
      [undefined, 90, '£', undefined], // rule 3: 25% headroom
      [undefined, 15, '%', undefined], // rule 2: metric scale 100
      [undefined, 100, '%', undefined], // the ONE sanctioned cap === raw
      [1000, 800, '£', '£'], // rule 1: a compatible inherited cap
      [800, 800, '£', '£'], // an equal inherited cap falls through to headroom
    ];
    for (const [existingCap, raw, unit, existingUnit] of cases) {
      const resolved = resolveGoalThresholdCapWithProvenance(
        existingCap,
        raw,
        unit,
        existingUnit,
      );
      expect(resolved).not.toBeNull();
      expect(resolved!.cap).toBeGreaterThanOrEqual(raw);
    }
  });
});

/**
 * RULE 1 IS THE MAXIMISE FRAME'S RULE, NOT A LAW OF GOALS. It exists because ISL
 * scored `P(level >= threshold)` whatever the goal meant. A goal whose MINIMISE
 * sense is attested and forwarded (request-level `goal_direction`) is scored on
 * the lower tail — ISL 3c4ab84 `robustness_analyzer_v2.py` compares
 * `compared <= level_threshold` under `minimise`, and AI Quality measured the
 * complement on the wire (#69 5841701921). On that frame a level ABOVE the target
 * is the ordinary "bring it down" case, not an inversion. Rule 2 is unchanged:
 * scale is a question about the number, not the sense.
 */
describe('the direction rule applies only to the maximise frame', () => {
  it('RED: a minimise goal admits a current level ABOVE its target (the ordinary "bring it down" case)', () => {
    expect(admitGoalBaseline({ rawTarget: 5, rawBaseline: 7, cap: 100, direction: 'minimise' })).toEqual({
      admitted: true,
      normalised: 0.07,
    });
  });

  it('CONTROL: the same pair with no direction is still refused BY NAME (the draft path, unchanged)', () => {
    expect(admitGoalBaseline({ rawTarget: 5, rawBaseline: 7, cap: 100 })).toEqual({
      admitted: false,
      reason: 'direction_unsupported',
    });
    expect(admitGoalBaseline({ rawTarget: 5, rawBaseline: 7, cap: 100, direction: 'maximise' })).toEqual({
      admitted: false,
      reason: 'direction_unsupported',
    });
  });

  it('a minimise goal off the scale is refused by rule 2, BY NAME — not by the direction rule', () => {
    // 700 on a cap of 625 (a £500 target with 25% headroom) is 1.12 — not a point on the scale.
    expect(admitGoalBaseline({ rawTarget: 500, rawBaseline: 700, cap: 625, direction: 'minimise' })).toEqual({
      admitted: false,
      reason: 'baseline_off_cap_scale',
    });
  });
});
