/**
 * THE INTERVENTION TARGET IS A MODEL-UNIT *TO*, NEVER A RAW *FROM*.
 *
 * `pickInterventionTarget` had ZERO test references repo-wide before this file
 * (derived at staging `7aa49ec8`, `rg -a -c pickInterventionTarget` → 2 hits,
 * both in its own source; contrast `buildCounterfactualModel` → 12 hits in a
 * test file, so the sweep can see test references). Nothing pinned it, so both
 * halves below shipped silently.
 *
 * ── WRITTEN AGAINST THE SPEC, NOT THE FAILURE MODE (trap 13d) ──────────────
 * The two properties asserted here are the CONTRACT's, not this defect's:
 *
 *   1. SEMANTICS. `observed_state.baseline` is *"Baseline/original value
 *      (e.g., \"from X to Y\" → baseline is X)"* (`schemas/graph.ts:158`) —
 *      X is the level the factor is at TODAY. An intervention target is the
 *      level we are asking ISL to move it TO. Reading the FROM as the TO asks
 *      "what if this factor were where it already is".
 *
 *   2. SCALE. `FactorObservedState.value` is *"The factor's current position on
 *      the model 0-1 scale"* (`schemas/graph.ts:263`) and is the scale every
 *      other variable in the request is pinned in. `baseline` and `cap` are
 *      RAW — the contract's own examples are `baseline is X` for "from 49 to
 *      59" and *"\"up to £500k\" → cap is 500000"* (`schemas/graph.ts:162`).
 *      Sending a raw magnitude as the intervention puts one variable ~100x off
 *      the scale of the equations that consume it.
 *
 * ── WHY THIS IS NOT A HYPOTHETICAL ────────────────────────────────────────
 * Derived on the DEPLOYED staging service, 2026-09-12: `cee-staging` carries a
 * truthy `ISL_BASE_URL`, so `createCounterfactualClient()` returns a client and
 * the lens is NOT in the "latent" state two comments in this tree assert. The
 * deployed build (`/healthz` → `build: "7aa49ec"`) is this tip. Probed live
 * against `isl-staging` (fabricated-route contrast control → 404, so the probe
 * discriminates), the endpoint returns HTTP 200 for BOTH scales and simply
 * computes on whatever it is given:
 *
 *   intervention X=0.59 (model-unit TO)   → point_estimate 0.295   ← correct
 *   intervention X=49   (raw FROM, today) → point_estimate 24.5    ← ~83x out
 *
 * There is no error path. A wrong number comes back 200, validates against the
 * typed contract, and is composed into a card.
 */

import { describe, it, expect } from 'vitest';

import { buildCounterfactualModel } from '../build-counterfactual-model.js';
import { formatFactorValue } from '../../../../compose/format-factor-value.js';
import type { CounterfactualProbe } from '../select-counterfactual-probe.js';

interface LooseGraph {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}

const PRICE_PROBE: CounterfactualProbe = {
  factor_id: 'factor_price',
  factor_label: 'Pro plan price',
  trigger: 'concrete_flip',
};

/**
 * The graph Paul's price brief produces, with the probe factor's
 * `observed_state` supplied per-case. Structure is held constant so each case
 * differs ONLY in the numeric surface under test.
 */
function priceGraph(probeObservedState: Record<string, unknown>): LooseGraph {
  return {
    nodes: [
      { id: 'goal_margin', kind: 'goal', label: 'Gross margin', observed_state: { value: 0.4 } },
      {
        id: 'factor_price',
        kind: 'factor',
        label: 'Pro plan price',
        observed_state: probeObservedState,
      },
      { id: 'factor_volume', kind: 'factor', label: 'Signup volume', observed_state: { value: 0.3 } },
    ],
    edges: [
      {
        from: 'factor_price',
        to: 'goal_margin',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'positive',
      },
      {
        from: 'factor_volume',
        to: 'goal_margin',
        strength: { mean: -0.4, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'negative',
      },
    ],
  };
}

describe('pickInterventionTarget — the target is a model-unit TO', () => {
  /**
   * The shape measured in the owner's own debug bundle
   * (`olumi-debug-5b41f0eb-20260911.json`): a framed factor carrying a raw
   * `baseline`, a raw `cap`, and a model-unit `value`. The frame is recoverable
   * from the pair (49 / 0.49 = 100), so `cap` HAS a model-unit form: 1.0.
   */
  it('puts a raw `cap` onto the model scale instead of sending it verbatim', () => {
    const built = buildCounterfactualModel(
      priceGraph({ value: 0.49, raw_value: 49, baseline: 49, cap: 100, unit: '£' }),
      PRICE_PROBE,
    );
    expect(built).not.toBeNull();
    const { request, meta } = built!;

    // Bound by IDENTITY to the probe variable, never by a value predicate
    // another variable could satisfy (trap 19).
    expect(request.intervention.factor_price).toBe(1);

    // The defect, stated as its own assertion so a regression names itself:
    // 100 is the RAW ceiling and must never reach the wire.
    expect(request.intervention.factor_price).not.toBe(100);

    // The pinned distribution must agree with the intervention it represents.
    expect(request.model.distributions.factor_price).toEqual({
      type: 'uniform',
      parameters: { min: 1, max: 1 },
    });

    // SCALE COHERENCE, as a property rather than a number: the intervention
    // must sit on the same scale as the roots the equations consume.
    expect(request.model.distributions.factor_volume).toEqual({
      type: 'uniform',
      parameters: { min: 0.3, max: 0.3 },
    });

    // The current level is the STATED one, on `value`'s frame (49 / 100).
    expect(meta.factorCurrentValue).toBe(0.49);

    // Display keeps the RAW magnitude — `formatFactorValue` formats user-scale
    // values and returns null for a bare sub-1 decimal, which is exactly why
    // the raw-valued defect looked correct on screen.
    expect(meta.interventionDisplayValue).toBe(100);
    expect(formatFactorValue(meta.interventionDisplayValue, meta.factorUnit)?.display).toBe('£100');
  });

  /**
   * Paul's brief, fully projected — the shape `validators/option-no-op.ts`
   * documents as actually arising: `{value: 0.59, raw_value: 59, baseline: 49}`.
   * `value` holds the PROPOSED level (£59) and `baseline` the current one (£49).
   */
  it('reads a distinct `baseline` as the current level and `value` as the target', () => {
    const built = buildCounterfactualModel(
      priceGraph({ value: 0.59, raw_value: 59, baseline: 49, unit: '£' }),
      PRICE_PROBE,
    );
    expect(built).not.toBeNull();
    const { request, meta } = built!;

    // SEMANTICS: the TO (0.59), not the FROM (49 raw / 0.49 model).
    expect(request.intervention.factor_price).toBe(0.59);
    expect(request.intervention.factor_price).not.toBe(49);
    expect(request.intervention.factor_price).not.toBe(0.49);

    // The current level is the stated baseline on `value`'s frame (49 / 100).
    expect(meta.factorCurrentValue).toBe(0.49);

    // DIRECTION COHERENCE: both numbers on one scale, so `run-counterfactual-
    // lens.ts`'s raise/lower comparison is meaningful. Raising £49 → £59 must
    // read as a raise; against the raw baseline (49 > 0.59) it read as a lower.
    expect(meta.interventionValue).toBeGreaterThan(meta.factorCurrentValue);

    // And the card shows the user's own magnitude.
    expect(meta.interventionDisplayValue).toBe(59);
    expect(formatFactorValue(meta.interventionDisplayValue, meta.factorUnit)?.display).toBe('£59');
  });

  /**
   * FAITHFUL-OR-NULL. The same from-to pair with no `raw_value` and no
   * `scale_frame` carries no divisor, so nothing can say whether
   * `{value: 0.59, baseline: 49}` is a framed pair (current 0.49) or an
   * unframed one (current 49). The module's contract is to emit nothing rather
   * than invent the conversion — and today it emits the raw 49.
   */
  it('returns null when a distinct baseline cannot be put on `value`s frame', () => {
    const built = buildCounterfactualModel(
      priceGraph({ value: 0.59, baseline: 49, unit: '£' }),
      PRICE_PROBE,
    );
    expect(built).toBeNull();
  });

  /**
   * THE OPPOSITE-DIRECTION TWIN (trap 22b). An unframed factor — a count, where
   * raw IS the model scale — must keep working exactly as it does today. A fix
   * that disarmed the 100x error by refusing everything would pass every
   * assertion above and silently delete the lens.
   */
  it('leaves an unframed factor alone — raw IS the model scale there', () => {
    const built = buildCounterfactualModel(
      priceGraph({ value: 10, cap: 20, unit: 'engineers' }),
      PRICE_PROBE,
    );
    expect(built).not.toBeNull();
    const { request, meta } = built!;

    expect(request.intervention.factor_price).toBe(20);
    expect(meta.factorCurrentValue).toBe(10);
    expect(meta.interventionDisplayValue).toBe(20);
  });
});
