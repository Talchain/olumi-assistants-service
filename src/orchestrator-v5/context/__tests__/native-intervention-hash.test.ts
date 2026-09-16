/**
 * ⭐ A NATIVE COST THAT CHANGES A DISPLAYED VERDICT MUST MOVE THE FRESHNESS HASH.
 *
 * `projectIntervention` carried `value`, `value_type`, `encoding_map` and
 * `target_match.node_id` — and NOT `raw_value` or `unit`. Measured before the
 * fix, with a live positive control in the same run:
 *
 *   encoded only            d4384a59464a5724
 *   + raw_value/unit        d4384a59464a5724   <- IDENTICAL
 *   + raw_value 95k -> 250k d4384a59464a5724   <- STILL IDENTICAL
 *   CONTROL value .7 -> .85 556b459c2eaeff70   <- differs, instrument is alive
 *
 * So an option's cost could change from £95,000 to £250,000 and the product
 * would report the stored analysis as CURRENT. That is tolerable only while
 * nothing consumes the native. The moment a limit check reads it, the verdict
 * on screen depends on a field the freshness identity cannot see — the product
 * would say "still current" over a feasibility answer that had changed.
 *
 * Ruling (Codex CX-20260916-54): "if a stored field affects ANY displayed
 * analysis/feasibility verdict, the existing freshness/cache identity must
 * account for it BEFORE that consumer is enabled." This spec is that account,
 * landed ahead of the consumer rather than behind it.
 *
 * ⚠ ONE-TIME COST, DISCLOSED NOT HIDDEN: any stored graph already carrying
 * `raw_value` hashes differently after this change, so those scenarios read
 * STALE once. That is the honest direction — they were being reported fresh on
 * an identity that ignored a real field.
 */
import { describe, expect, it } from 'vitest';

import { computeAnalysisAffectingGraphHash } from '../graph-hash.js';

const graphWith = (intervention: Record<string, unknown>) =>
  ({
    nodes: [
      { id: 'fac_cost', kind: 'factor', label: 'Hiring Cost' },
      {
        id: 'opt_a',
        kind: 'option',
        label: 'Hire a Tech Lead',
        interventions: { fac_cost: intervention },
      },
    ],
    edges: [],
  }) as never;

const hash = (intervention: Record<string, unknown>) =>
  computeAnalysisAffectingGraphHash(graphWith(intervention));

const ENCODED = { value: 0.7, source: 'user_specified' };

describe('the analysis-affecting hash accounts for a native intervention value', () => {
  it('POSITIVE CONTROL — the hash discriminates on a field it already covered', () => {
    // Without this, a "these differ" result below could be an artefact of a
    // hash that differs on everything, and a "these match" result could be a
    // dead instrument (trap 13).
    expect(hash({ ...ENCODED, value: 0.85 })).not.toBe(hash(ENCODED));
  });

  it('adding a native value CHANGES the hash', () => {
    expect(hash({ ...ENCODED, raw_value: 95000, unit: 'GBP' })).not.toBe(hash(ENCODED));
  });

  it('CHANGING the native value changes the hash — the case that matters', () => {
    // £95,000 -> £250,000 crosses a £200,000 limit. Before the fix these were
    // byte-identical, so the product reported the analysis current across it.
    expect(hash({ ...ENCODED, raw_value: 250000, unit: 'GBP' })).not.toBe(
      hash({ ...ENCODED, raw_value: 95000, unit: 'GBP' }),
    );
  });

  it('changing the UNIT changes the hash', () => {
    // The same magnitude in a different currency is a different quantity.
    expect(hash({ ...ENCODED, raw_value: 95000, unit: 'USD' })).not.toBe(
      hash({ ...ENCODED, raw_value: 95000, unit: 'GBP' }),
    );
  });

  it('EQUIVALENT REPRESENTATIONS of one quantity hash ALIKE', () => {
    // `RawInterventionValue` admits number | string | boolean, so the same
    // figure can arrive either way. Two spellings of one quantity must not
    // read as two different graphs — that would report a change nobody made.
    expect(hash({ ...ENCODED, raw_value: '95000', unit: 'GBP' })).toBe(
      hash({ ...ENCODED, raw_value: 95000, unit: 'GBP' }),
    );
  });

  it('a NON-numeric raw value is preserved verbatim, never coerced', () => {
    // Categorical raws are codes, not magnitudes. "UK" must not become NaN or
    // collapse into another category.
    expect(hash({ ...ENCODED, raw_value: 'UK' })).not.toBe(hash({ ...ENCODED, raw_value: 'US' }));
  });

  it('⚠ UNIT ALONE still hashes to nothing — the older rule is preserved, not overridden', () => {
    // `graph-hash.test.ts` asserts that intervention `unit` does not move the
    // hash, and that is CORRECT beside an encoded value: the unit is metadata
    // about the number the engine computes on. This pair is the discriminator —
    // the same field name carries two meanings (trap 21), and collapsing them
    // would either break the older rule or leave the native case unguarded.
    expect(hash({ ...ENCODED, unit: 'USD' })).toBe(hash({ ...ENCODED, unit: 'GBP' }));
    // ...but beside a NATIVE value the unit IS part of the quantity.
    expect(hash({ ...ENCODED, raw_value: 95000, unit: 'USD' })).not.toBe(
      hash({ ...ENCODED, raw_value: 95000, unit: 'GBP' }),
    );
  });

  it('an intervention with no native value is UNCHANGED by this projection', () => {
    // The overwhelming majority of interventions carry no native. Their hash
    // must not move, or every existing scenario reads stale for nothing.
    expect(hash(ENCODED)).toBe(hash({ value: 0.7, source: 'user_specified' }));
  });
});
