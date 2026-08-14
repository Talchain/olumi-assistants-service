/**
 * ── CAP + FRAMED VALUE MUST SHIP WITH A CORROBORATING `raw_value` ───────────
 *
 * A factor `observed_state` that carries a `cap` and a framed `[0,1]` `value`
 * but NO `raw_value` cannot PROVE its scale convention. `buildFactorScaleMap`
 * grants `normalisedConvention` only on a self-consistent `value`/`raw_value`
 * pair, so such a factor classifies `ambiguous_no_evidence` at
 * `resolveRawInterventionValue` — and PLoT divides intervention values by
 * `observed_state.cap`, so submitting 0.6 against cap 150,000 would reach ISL
 * as ~0.000004: a catastrophic intervention masquerading as "no change".
 *
 * The rejection is CORRECT and is deliberately not weakened here. What is
 * fixed is the PRODUCER: when the transform writes a cap beside a framed
 * value, it now writes the `raw_value` that corroborates it.
 *
 * ⚠ EVERY EXPECTATION IN THIS FILE IS DERIVED FROM THE CONSUMER'S OWN
 * FUNCTIONS (`buildFactorScaleMap` / `resolveRawInterventionValue`), never
 * from a local re-implementation of the arithmetic (trap 13c: a mutant kit
 * validates sensitivity, never a wrong oracle; trap 12: a mirrored predicate
 * drifts silently and the drift reads as green).
 */

import { describe, it, expect } from 'vitest';
import { transformNodeToV3 } from '../schema-v3.js';
import {
  buildFactorScaleMap,
  resolveRawInterventionValue,
} from '../../../orchestrator-v5/tools/plot-intervention-scale.js';
import { findUncorroboratedCapFactorIds } from '../observed-state-cap-corroboration.js';

type Dict = Record<string, unknown>;

/** A model-drafted factor exactly as the prompt teaches it, minus `raw_value`. */
function draftedFactor(data: Dict): Dict {
  return {
    id: 'fac_annual_cost',
    kind: 'factor',
    label: 'Annual cost',
    category: 'controllable',
    data,
  };
}

function observedOf(node: Dict): Dict | undefined {
  const v3 = transformNodeToV3(node as never) as unknown as Dict;
  return v3.observed_state as Dict | undefined;
}

describe('observed_state: a written cap carries a corroborating raw_value', () => {
  it('SIGNATURE 1 — transform emits raw_value = value x cap when the model omits it', () => {
    const observed = observedOf(
      draftedFactor({ value: 0.6, unit: '£', cap: 150000, extractionType: 'explicit' }),
    );
    expect(observed).toBeDefined();
    expect(observed!.cap).toBe(150000);
    expect(observed!.value).toBe(0.6);
    // 0.6 x 150000 — the consistent pair a writer that stores a cap must store.
    expect(observed!.raw_value).toBe(90000);
  });

  it('SIGNATURE 2 — the emitted pair PROVES the normalised convention to the consumer', () => {
    const observed = observedOf(
      draftedFactor({ value: 0.6, unit: '£', cap: 150000, extractionType: 'explicit' }),
    );
    const node = { id: 'fac_annual_cost', kind: 'factor', observed_state: observed };
    const scale = buildFactorScaleMap([node]).get('fac_annual_cost');
    // The consumer's OWN evidence predicate, not a re-implementation of it.
    expect(scale?.normalisedConvention).toBe(true);
    expect(scale?.cap).toBe(150000);
  });

  it('SIGNATURE 3 — the factor is usable as HOLD PROVENANCE (no ambiguous_no_evidence)', () => {
    const observed = observedOf(
      draftedFactor({ value: 0.6, unit: '£', cap: 150000, extractionType: 'explicit' }),
    );
    const node = { id: 'fac_annual_cost', kind: 'factor', observed_state: observed };
    const scale = buildFactorScaleMap([node]).get('fac_annual_cost');
    // Exactly the candidate `buildHoldFactorValues` synthesises for a capped
    // factor: `{value, raw_value}` (analysable-option-gate.ts:293-320).
    const result = resolveRawInterventionValue(
      { value: observed!.value, raw_value: observed!.raw_value },
      scale,
    );
    expect(result.rule).toBe('raw_value_used');
    expect(result.inconsistent).toBe(false);
    // The precondition for demotion — what makes the held value survivable in a
    // mixed request rather than annihilated by PLoT's request-level gate.
    expect(result.unitIntervalEquivalent).toBe(0.6);
  });

  it('SIGNATURE 4 — a stated raw_value is NEVER overwritten (the author owns it)', () => {
    const observed = observedOf(
      draftedFactor({ value: 0.6, unit: '£', cap: 150000, raw_value: 88000 }),
    );
    // 0.6 x 150000 = 90000, but the model stated 88000. The derived-field rule
    // makes `raw_value` the source of truth; a disagreement is SURFACED by the
    // consumer's `inconsistent` flag, never silently repaired here.
    expect(observed!.raw_value).toBe(88000);
  });
});

describe('the honest-absence domain: no raw_value is fabricated outside it', () => {
  it('no cap → no raw_value invented', () => {
    const observed = observedOf(draftedFactor({ value: 0.6, unit: '£' }));
    expect(observed!.raw_value).toBeUndefined();
  });

  it('value ABOVE the unit interval is already raw — value x cap would fabricate', () => {
    const observed = observedOf(draftedFactor({ value: 25000, unit: '£', cap: 150000 }));
    expect(observed!.raw_value).toBeUndefined();
  });

  it('NEGATIVE value has no unit-interval representation — nothing derived', () => {
    const observed = observedOf(draftedFactor({ value: -0.4, unit: '£', cap: 150000 }));
    expect(observed!.raw_value).toBeUndefined();
  });

  it('degenerate cap <= 1 cannot downscale — the class the consumer excludes by construction', () => {
    // `buildFactorScaleMap` requires `baselineRaw > baselineValue`, which with
    // `value * cap ~= raw` forces `cap > 1`. Writing a pair the consumer can
    // never accept as evidence would be noise at best and a false witness at
    // worst, so this factor stays honestly unprovable.
    const observed = observedOf(draftedFactor({ value: 0.6, unit: 'ratio', cap: 0.9 }));
    expect(observed!.raw_value).toBeUndefined();
  });

  it('non-finite cap is not arithmetic', () => {
    const observed = observedOf(draftedFactor({ value: 0.6, unit: '£', cap: Number.NaN }));
    expect(observed!.raw_value).toBeUndefined();
  });
});

describe('THE LOUD GUARD — discriminating triple, bound to the consumer', () => {
  const nodeWith = (observed_state: Dict): Dict[] => [
    { id: 'fac_annual_cost', kind: 'factor', observed_state },
  ];

  it('RED: a cap written WITHOUT a corroborating raw_value is reported', () => {
    const ids = findUncorroboratedCapFactorIds(
      nodeWith({ value: 0.6, unit: '£', cap: 150000 }),
    );
    expect(ids).toEqual(['fac_annual_cost']);
  });

  it('RED: an INCONSISTENT raw_value (!= value x cap) is reported — presence is not enough', () => {
    // A guard that only checked PRESENCE would bless this wrong number.
    const ids = findUncorroboratedCapFactorIds(
      nodeWith({ value: 0.6, unit: '£', cap: 150000, raw_value: 50000 }),
    );
    expect(ids).toEqual(['fac_annual_cost']);
  });

  it('GREEN: a consistent pair is accepted', () => {
    const ids = findUncorroboratedCapFactorIds(
      nodeWith({ value: 0.6, unit: '£', cap: 150000, raw_value: 90000 }),
    );
    expect(ids).toEqual([]);
  });

  it('GREEN: a capless factor is out of scope (projector.ts stores no cap by design)', () => {
    const ids = findUncorroboratedCapFactorIds(nodeWith({ value: 0.6, raw_value: 600000 }));
    expect(ids).toEqual([]);
  });

  it('GREEN: an already-raw value on a capped factor is passthrough, not ambiguous', () => {
    const ids = findUncorroboratedCapFactorIds(
      nodeWith({ value: 25000, unit: '£', cap: 150000 }),
    );
    expect(ids).toEqual([]);
  });

  it('the guard reports the TRANSFORM OUTPUT as clean (writer and guard agree end to end)', () => {
    const observed = observedOf(
      draftedFactor({ value: 0.6, unit: '£', cap: 150000, extractionType: 'explicit' }),
    );
    expect(
      findUncorroboratedCapFactorIds(nodeWith(observed as Dict)),
    ).toEqual([]);
  });
});
