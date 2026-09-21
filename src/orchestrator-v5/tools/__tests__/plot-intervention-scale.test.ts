/**
 * Unit tests for the CEE → PLoT intervention value-scale protection (Tier 0,
 * Phase 1 — egress net). Diagnostic category names follow the Tier 0 brief:
 * raw_value_used, cap_denormalised, ambiguous_no_evidence, inconsistent_scale,
 * no_cap, encoded_verbatim, passthrough.
 *
 * Proves the evidence-gated rule in `plot-intervention-scale.ts`:
 *   - raw_value preference + deterministic conflict policy (raw_value wins,
 *     inconsistency flagged via `inconsistent_scale`);
 *   - cap denormalisation ONLY with proven factor normalised-convention
 *     evidence (no silent corruption of genuine raw [0,1] values);
 *   - passthrough for already-raw (outside [0,1]) values, missing cap,
 *     ambiguous-no-evidence, and categorical/boolean (incl. without value_type);
 *   - the trace-shaped regression fixture (0.25 / raw 5000 / cap 20000 → 5000);
 *   - redaction-safe conversion summary;
 *   - exact key/precedence parity between the numeric and object-preserving
 *     intervention merges.
 */
import { describe, it, expect } from 'vitest';

import {
  resolveRawInterventionValue,
  buildFactorScaleMap,
  projectInterventionsToRawScale,
  summariseConversions,
  summaryIsNoteworthy,
  type FactorScaleInfo,
} from '../plot-intervention-scale.js';
import {
  mergeInterventionSources,
  mergeInterventionSourceObjects,
} from '../../../orchestrator/tools/analysis-ready-helper.js';

// Factor that PROVES the normalised convention (value ≈ raw/cap).
const proven = (cap: number, unit = '£'): FactorScaleInfo => ({ cap, unit, normalisedConvention: true });
// Factor with a cap but NO normalisation evidence.
const unproven = (cap: number, unit = '£'): FactorScaleInfo => ({ cap, unit });

describe('resolveRawInterventionValue — raw_value precedence (raw_value_used)', () => {
  it('prefers a finite numeric raw_value (already user-scale)', () => {
    const r = resolveRawInterventionValue({ value: 0.25, raw_value: 5000, unit: '£' }, proven(20000));
    expect(r).toMatchObject({ value: 5000, rule: 'raw_value_used', inputValue: 0.25, inconsistent: false });
  });

  it('regression fixture: {value:0.25, raw_value:5000, cap:20000, unit:£} → 5000, not 0.25', () => {
    const r = resolveRawInterventionValue({ value: 0.25, raw_value: 5000, unit: '£' }, proven(20000));
    expect(r.value).toBe(5000);
    expect(r.value).not.toBe(0.25);
  });

  it('deterministic conflict policy: stale/inconsistent raw_value still wins, flagged inconsistent', () => {
    // 0.3 * 20000 = 6000, but raw_value says 5000 → raw_value wins, inconsistent.
    const r = resolveRawInterventionValue({ value: 0.3, raw_value: 5000 }, proven(20000));
    expect(r.value).toBe(5000);
    expect(r.rule).toBe('raw_value_used');
    expect(r.inconsistent).toBe(true);
  });

  it('consistent raw_value is not flagged', () => {
    const r = resolveRawInterventionValue({ value: 0.25, raw_value: 5000 }, proven(20000));
    expect(r.inconsistent).toBe(false);
  });

  it('uses a NUMERIC-string raw_value (e.g. "5000") as the user-scale value', () => {
    const r = resolveRawInterventionValue({ value: 0.25, raw_value: '5000' }, proven(20000));
    expect(r).toMatchObject({ value: 5000, rule: 'raw_value_used', inputValue: 0.25, inconsistent: false });
  });

  it('a non-numeric / formatted string raw_value (e.g. "£5k") does NOT suppress; falls to factor evidence', () => {
    const r = resolveRawInterventionValue({ value: 0.25, raw_value: '£5k' }, proven(20000));
    // Not encoded, not parseable → factor evidence denormalises to 5000, not 0.25.
    expect(r).toMatchObject({ value: 5000, rule: 'cap_denormalised', inputValue: 0.25, inconsistent: false });
  });

  it('flags inconsistency when a raw-looking value (>1) disagrees with a stale raw_value', () => {
    // Phase-2 shape: both fields look raw-scale but disagree → raw_value wins, flagged.
    const r = resolveRawInterventionValue({ value: 25000, raw_value: 5000 }, proven(100000));
    expect(r.value).toBe(5000);
    expect(r.rule).toBe('raw_value_used');
    expect(r.inconsistent).toBe(true);
  });

  it('does not flag consistent raw-looking value/raw_value (both > 1, equal)', () => {
    const r = resolveRawInterventionValue({ value: 5000, raw_value: 5000 }, proven(100000));
    expect(r.value).toBe(5000);
    expect(r.inconsistent).toBe(false);
  });
});

describe('resolveRawInterventionValue — cap denormalisation (cap_denormalised, evidence-gated)', () => {
  it('denormalises a [0,1] value via cap when the factor PROVES the normalised convention', () => {
    const r = resolveRawInterventionValue({ value: 0.25 }, proven(20000));
    expect(r).toMatchObject({ value: 5000, rule: 'cap_denormalised', inputValue: 0.25, inconsistent: false });
  });

  it('does NOT multiply a [0,1] value when the factor lacks evidence (no silent corruption)', () => {
    const r = resolveRawInterventionValue({ value: 0.25 }, unproven(20000));
    expect(r).toMatchObject({
      value: 0.25,
      rule: 'ambiguous_no_evidence',
      inputValue: 0.25,
      inconsistent: false,
    });
  });

  it('treats value === 1.0 as the full cap (with evidence)', () => {
    const r = resolveRawInterventionValue({ value: 1 }, proven(100000));
    expect(r).toMatchObject({ value: 100000, rule: 'cap_denormalised', inputValue: 1, inconsistent: false });
  });

  it('treats value === 0 as 0 (with evidence)', () => {
    const r = resolveRawInterventionValue({ value: 0 }, proven(100000));
    expect(r).toMatchObject({ value: 0, rule: 'cap_denormalised', inputValue: 0, inconsistent: false });
  });

  it('denormalises a bare-number [0,1] value via cap (with evidence)', () => {
    const r = resolveRawInterventionValue(0.5, proven(80000));
    expect(r).toMatchObject({ value: 40000, rule: 'cap_denormalised', inputValue: 0.5, inconsistent: false });
  });

  it('passes a bare-number [0,1] value through when evidence is absent', () => {
    const r = resolveRawInterventionValue(0.5, unproven(80000));
    expect(r.rule).toBe('ambiguous_no_evidence');
    expect(r.value).toBe(0.5);
  });

  it('end-to-end: a [0,1] intervention on a ZERO-baseline capped factor is NOT corrupted', () => {
    // buildFactorScaleMap must withhold evidence for the zero baseline, so the
    // resolve step passes the value through rather than multiplying by cap.
    const factor = buildFactorScaleMap([
      { id: 'fac_zero', kind: 'factor', observed_state: { value: 0, raw_value: 0, cap: 100000 } },
    ]).get('fac_zero');
    const r = resolveRawInterventionValue({ value: 0.25 }, factor);
    expect(r.value).toBe(0.25);
    expect(r.rule).toBe('ambiguous_no_evidence');
  });
});

describe('resolveRawInterventionValue — passthrough (already-raw)', () => {
  it('passes through an already-raw value (> 1) on a capped factor — never multiplied again', () => {
    const r = resolveRawInterventionValue({ value: 25000 }, proven(100000));
    expect(r).toMatchObject({ value: 25000, rule: 'passthrough', inputValue: 25000, inconsistent: false });
  });

  it('passes through a bare already-raw value (> 1)', () => {
    const r = resolveRawInterventionValue(9000, proven(20000));
    expect(r).toMatchObject({ value: 9000, rule: 'passthrough', inputValue: 9000, inconsistent: false });
  });

  it('passes through a negative value on a capped factor (outside [0,1])', () => {
    const r = resolveRawInterventionValue({ value: -0.4 }, proven(100000));
    expect(r).toMatchObject({ value: -0.4, rule: 'passthrough', inputValue: -0.4, inconsistent: false });
  });

  it('passes through when the factor has no cap', () => {
    const r = resolveRawInterventionValue({ value: 0.25 }, { unit: '£' });
    expect(r).toMatchObject({ value: 0.25, rule: 'no_cap', inputValue: 0.25, inconsistent: false });
  });

  it('passes through when there is no factor scale info at all', () => {
    const r = resolveRawInterventionValue({ value: 0.25 }, undefined);
    expect(r.rule).toBe('no_cap');
    expect(r.value).toBe(0.25);
  });

  it('ignores a non-positive cap and passes through', () => {
    const r = resolveRawInterventionValue({ value: 0.25 }, { cap: 0, normalisedConvention: true });
    expect(r.rule).toBe('no_cap');
    expect(r.value).toBe(0.25);
  });
});

describe('resolveRawInterventionValue — encoded categorical/boolean preservation (encoded_verbatim)', () => {
  it('preserves but marks a categorical code above the faithful domain invalid', () => {
    const r = resolveRawInterventionValue(
      { value: 2, value_type: 'categorical', raw_value: 'UK', encoding_map: { UK: 2 } },
      proven(5),
    );
    expect(r).toMatchObject({
      value: 2,
      rule: 'encoded_verbatim',
      inputValue: 2,
      inconsistent: false,
      invalidEncodedContract: true,
    });
  });

  it('preserves an exactly-proven categorical code in the faithful domain', () => {
    const r = resolveRawInterventionValue(
      { value: 1, value_type: 'categorical', raw_value: 'UK', encoding_map: { UK: 1 } },
      proven(5),
    );
    expect(r).toMatchObject({ value: 1, rule: 'encoded_verbatim', codeNotMagnitude: true });
    expect(r.invalidEncodedContract).toBeUndefined();
  });

  it('never scales a boolean encoded value', () => {
    const r = resolveRawInterventionValue(
      { value: 1, value_type: 'boolean', raw_value: true, encoding_map: { true: 1, false: 0 } },
      proven(10),
    );
    expect(r.rule).toBe('encoded_verbatim');
    expect(r.value).toBe(1);
    expect(r.invalidEncodedContract).toBeUndefined();
  });

  it('a non-numeric string raw_value alone is NOT treated as encoded (no silent under-reporting)', () => {
    // The encoded value is still preserved — but via the evidence/passthrough
    // path, NOT by misclassifying a possibly-numeric intervention as categorical.
    const r = resolveRawInterventionValue({ value: 2, raw_value: 'France' }, unproven(100));
    expect(r.value).toBe(2);
    expect(r.rule).toBe('passthrough'); // value 2 > 1 → already-raw passthrough
  });

  it('detects encoding WITHOUT value_type via a boolean raw_value', () => {
    const r = resolveRawInterventionValue({ value: 1, raw_value: false }, proven(100));
    expect(r.rule).toBe('encoded_verbatim');
    expect(r.value).toBe(1);
    expect(r.invalidEncodedContract).toBe(true);
  });

  it('detects encoding WITHOUT value_type via a present encoding_map', () => {
    const r = resolveRawInterventionValue({ value: 1, encoding_map: { Developers: 0, Lead: 1 } }, proven(100));
    expect(r.rule).toBe('encoded_verbatim');
    expect(r.value).toBe(1);
    expect(r.invalidEncodedContract).toBe(true);
  });

  it('a bare encoded 1 with no metadata on a non-normalised factor is NOT scaled (evidence backstop)', () => {
    // A boolean factor does not exhibit the normalised-convention signature, so
    // even an undetected encoded 1 falls to ambiguous passthrough, not cap*1.
    const r = resolveRawInterventionValue({ value: 1 }, unproven(100));
    expect(r.value).toBe(1);
    expect(r.rule).toBe('ambiguous_no_evidence');
  });
});

describe('resolveRawInterventionValue — membership (drop non-numeric)', () => {
  it('drops an object with no finite numeric value', () => {
    const r = resolveRawInterventionValue({ raw_value: 5000 }, proven(20000));
    expect(r).toMatchObject({ value: null, rule: 'dropped', inputValue: null, inconsistent: false });
  });

  it('drops null / arrays / strings / NaN', () => {
    expect(resolveRawInterventionValue(null, proven(1)).value).toBeNull();
    expect(resolveRawInterventionValue([0.5] as unknown, proven(1)).value).toBeNull();
    expect(resolveRawInterventionValue('0.5' as unknown, proven(1)).value).toBeNull();
    expect(resolveRawInterventionValue(Number.NaN, proven(1)).value).toBeNull();
  });
});

describe('buildFactorScaleMap', () => {
  it('reads observed_state.cap/unit and proves normalisedConvention when value ≈ raw/cap', () => {
    const map = buildFactorScaleMap([
      { id: 'fac_spend', kind: 'factor', observed_state: { value: 0.25, raw_value: 5000, cap: 20000, unit: '£' } },
      { id: 'goal_1', kind: 'goal' },
    ]);
    expect(map.get('fac_spend')).toEqual({ cap: 20000, unit: '£', normalisedConvention: true });
    expect(map.get('goal_1')).toEqual({});
  });

  it('tolerates rounding in the consistency check (0.653 ≈ 49/75)', () => {
    const map = buildFactorScaleMap([
      { id: 'fac_price', kind: 'factor', observed_state: { value: 0.653, raw_value: 49, cap: 75, unit: '£' } },
    ]);
    expect(map.get('fac_price')?.normalisedConvention).toBe(true);
  });

  it('withholds normalisedConvention when raw_value is absent', () => {
    const map = buildFactorScaleMap([
      { id: 'fac_a', kind: 'factor', observed_state: { value: 0.5, cap: 100000, unit: '£' } },
    ]);
    expect(map.get('fac_a')).toEqual({ cap: 100000, unit: '£' });
    expect(map.get('fac_a')?.normalisedConvention).toBeUndefined();
  });

  it('withholds normalisedConvention when the factor baseline is itself raw (value > 1)', () => {
    const map = buildFactorScaleMap([
      { id: 'fac_count', kind: 'factor', observed_state: { value: 12, raw_value: 12, unit: 'people' } },
    ]);
    expect(map.get('fac_count')?.normalisedConvention).toBeUndefined();
  });

  it('withholds normalisedConvention when observed_state is inconsistent (value !≈ raw/cap)', () => {
    const map = buildFactorScaleMap([
      { id: 'fac_bad', kind: 'factor', observed_state: { value: 0.9, raw_value: 5000, cap: 20000 } },
    ]);
    expect(map.get('fac_bad')?.normalisedConvention).toBeUndefined();
  });

  it('withholds normalisedConvention for a ZERO baseline (0 == 0/anything is scale-ambiguous)', () => {
    const map = buildFactorScaleMap([
      { id: 'fac_zero', kind: 'factor', observed_state: { value: 0, raw_value: 0, cap: 100000 } },
    ]);
    expect(map.get('fac_zero')?.normalisedConvention).toBeUndefined();
  });

  it('withholds normalisedConvention when raw_value does not exceed value (no real downscaling, cap ≤ 1)', () => {
    const map = buildFactorScaleMap([
      { id: 'fac_flat', kind: 'factor', observed_state: { value: 0.5, raw_value: 0.5, cap: 1 } },
    ]);
    expect(map.get('fac_flat')?.normalisedConvention).toBeUndefined();
  });

  it('falls back to data.cap / top-level cap for alternate persisted shapes', () => {
    const map = buildFactorScaleMap([
      { id: 'fac_a', kind: 'factor', data: { cap: 100, unit: 'months' } },
      { id: 'fac_b', kind: 'factor', cap: 250 },
    ]);
    expect(map.get('fac_a')).toEqual({ cap: 100, unit: 'months' });
    expect(map.get('fac_b')).toEqual({ cap: 250 });
  });

  it('returns an empty map for non-array input', () => {
    expect(buildFactorScaleMap(undefined).size).toBe(0);
    expect(buildFactorScaleMap({}).size).toBe(0);
  });
});

describe('projectInterventionsToRawScale', () => {
  it('projects a mixed bundle and records redaction-safe conversions', () => {
    const factors = buildFactorScaleMap([
      { id: 'fac_with_raw', kind: 'factor', observed_state: { value: 0.25, raw_value: 5000, cap: 20000 } },
      { id: 'fac_no_raw', kind: 'factor', observed_state: { value: 0.5, raw_value: 50000, cap: 100000 } },
      { id: 'fac_raw_looking', kind: 'factor', observed_state: { value: 0.45, raw_value: 9000, cap: 20000 } },
      { id: 'fac_ambiguous', kind: 'factor', observed_state: { value: 0.5, cap: 50000 } }, // no raw_value → no evidence
      { id: 'fac_uncapped', kind: 'factor', observed_state: { value: 0.3 } },
    ]);
    const raw = {
      fac_with_raw: { value: 0.25, raw_value: 5000 },
      fac_no_raw: { value: 0.5 },
      fac_raw_looking: { value: 9000 },
      fac_ambiguous: { value: 0.4 },
      fac_uncapped: { value: 0.3 },
    };
    const { interventions, conversions } = projectInterventionsToRawScale(raw, factors);
    expect(interventions).toEqual({
      fac_with_raw: 5000, // raw_value
      fac_no_raw: 50000, // 0.5 * 100000, evidence present
      fac_raw_looking: 9000, // > 1 passthrough
      fac_ambiguous: 0.4, // [0,1] but no evidence → NOT multiplied
      fac_uncapped: 0.3, // no cap passthrough
    });
    const byFactor = Object.fromEntries(conversions.map((c) => [c.factor_id, c.rule]));
    expect(byFactor).toEqual({
      fac_with_raw: 'raw_value_used',
      fac_no_raw: 'cap_denormalised',
      fac_raw_looking: 'passthrough',
      fac_ambiguous: 'ambiguous_no_evidence',
      fac_uncapped: 'no_cap',
    });
    // Conversions carry NO numeric magnitudes (redaction by construction).
    for (const c of conversions) {
      expect(Object.keys(c).sort()).toEqual(['factor_id', 'inconsistent', 'rule']);
    }
  });

  it('does not mutate the input objects (read-only)', () => {
    const raw = { fac_a: { value: 0.25, raw_value: 5000 } };
    const factors = buildFactorScaleMap([
      { id: 'fac_a', kind: 'factor', observed_state: { value: 0.25, raw_value: 5000, cap: 20000 } },
    ]);
    const before = JSON.stringify(raw);
    projectInterventionsToRawScale(raw, factors);
    expect(JSON.stringify(raw)).toBe(before);
  });
});

describe('summariseConversions (redaction-safe diagnostics)', () => {
  it('aggregates counts + factor ids, with no magnitudes', () => {
    const summary = summariseConversions([
      { factor_id: 'fac_a', rule: 'cap_denormalised', inconsistent: false },
      { factor_id: 'fac_b', rule: 'raw_value_used', inconsistent: true },
      { factor_id: 'fac_c', rule: 'ambiguous_no_evidence', inconsistent: false },
      { factor_id: 'fac_d', rule: 'passthrough', inconsistent: false },
    ]);
    expect(summary.total).toBe(4);
    expect(summary.by_rule).toEqual({
      cap_denormalised: 1,
      raw_value_used: 1,
      ambiguous_no_evidence: 1,
      passthrough: 1,
    });
    expect(summary.cap_denormalised_factors).toEqual(['fac_a']);
    expect(summary.inconsistent_scale_factors).toEqual(['fac_b']);
    expect(summary.ambiguous_no_evidence_factors).toEqual(['fac_c']);
    // No numeric magnitudes anywhere in the summary.
    expect(JSON.stringify(summary)).not.toMatch(/\b\d{3,}\b/); // no large magnitudes
  });

  it('summaryIsNoteworthy is false for an all-clean projection', () => {
    const summary = summariseConversions([
      { factor_id: 'fac_a', rule: 'raw_value_used', inconsistent: false },
      { factor_id: 'fac_b', rule: 'passthrough', inconsistent: false },
    ]);
    expect(summaryIsNoteworthy(summary)).toBe(false);
  });

  it('summaryIsNoteworthy is true when a denormalisation/inconsistency/ambiguity occurs', () => {
    expect(
      summaryIsNoteworthy(summariseConversions([{ factor_id: 'f', rule: 'cap_denormalised', inconsistent: false }])),
    ).toBe(true);
    expect(
      summaryIsNoteworthy(summariseConversions([{ factor_id: 'f', rule: 'raw_value_used', inconsistent: true }])),
    ).toBe(true);
    expect(
      summaryIsNoteworthy(
        summariseConversions([{ factor_id: 'f', rule: 'ambiguous_no_evidence', inconsistent: false }]),
      ),
    ).toBe(true);
  });
});

describe('mergeInterventionSourceObjects — exact key/precedence parity with mergeInterventionSources', () => {
  // The object-preserving merge must select the SAME factor set from the SAME
  // source as the numeric merge across all three sources, including conflicts.
  const cases: Array<{ name: string; node: Record<string, unknown> }> = [
    {
      name: 'data.interventions only (objects)',
      node: { id: 'o', kind: 'option', data: { interventions: { fac_x: { value: 0.25, raw_value: 5000 }, fac_y: { value: 0.5 } } } },
    },
    {
      name: 'top-level interventions only (mixed bare + object)',
      node: { id: 'o', kind: 'option', interventions: { fac_x: 0.6, fac_y: { value: 0.7 } } },
    },
    {
      name: 'data wins over top-level on conflict',
      node: { id: 'o', kind: 'option', data: { interventions: { fac_x: { value: 0.25, raw_value: 5000 } } }, interventions: { fac_x: { value: 0.99 } } },
    },
    {
      name: 'slash-keyed entries + top-level fallback, skipping non-finite',
      node: { id: 'o', kind: 'option', 'data/interventions/fac_slash': { value: 0.4, raw_value: 8000 }, interventions: { fac_top: 0.6, fac_bad: { raw_value: 5 } } },
    },
    {
      name: 'three-source precedence: data > slash > top-level',
      node: { id: 'o', kind: 'option', data: { interventions: { fac_x: { value: 0.1 } } }, 'data/interventions/fac_x': { value: 0.2 }, interventions: { fac_x: { value: 0.3 }, fac_z: 0.9 } },
    },
  ];

  for (const { name, node } of cases) {
    it(`same keys + precedence: ${name}`, () => {
      const numeric = mergeInterventionSources(node) ?? {};
      const objects = mergeInterventionSourceObjects(node);
      // Identical key set.
      expect(Object.keys(objects).sort()).toEqual(Object.keys(numeric).sort());
      // Same source picked per factor: the object entry's resolved numeric
      // value equals the numeric merge's value.
      for (const k of Object.keys(numeric)) {
        const o = objects[k];
        const resolved = typeof o === 'number' ? o : (o as Record<string, unknown>).value;
        expect(resolved).toBe(numeric[k]);
      }
    });
  }
});
