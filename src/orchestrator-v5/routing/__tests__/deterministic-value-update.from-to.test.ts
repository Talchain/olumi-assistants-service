/**
 * Fix A — deterministic "from X to Y" value-edit attribution
 * (CEE V5 Golden Journey row 7 workstream).
 *
 * The existing AC.2 "ambiguous_quantity" guard rejects every multi-quantity
 * message to avoid silently picking the wrong number. Fix A introduces a
 * narrow, deterministic exception: when the original message contains a
 * literal "from <...> to <...>" anchor AND CQE extracted exactly two
 * non-null quantities, the SECOND quantity is the user's intended target
 * value. The operator is forced to 'set' regardless of verb, because
 * "increase from £80,000 to £100,000" means "set to £100,000", not
 * "+£100,000".
 *
 * Negative cases (range / disjunction / 3+ quantities) MUST keep the
 * existing `ambiguous_quantity` skip.
 *
 * Section anchors map to the workstream plan
 * `/Users/paulslee/.claude/plans/workstream-cee-v5-edit-recovery-giggly-river.md`:
 *   - §2a — pre-coding regression gate (must already pass on origin/staging).
 *   - §10 — Fix A test list.
 */

import { describe, it, expect } from 'vitest';

import type { QuantityExtractionResult } from '../../context/cqe/schema-types.js';
import type { GraphLookup } from '../validator.js';
import {
  tryDeterministicValueUpdate,
  tryDeicticValueUpdate,
  deriveOperator,
} from '../deterministic-value-update.js';

function makeGraph(
  factors: ReadonlyArray<{ id: string; label: string | null }>,
): GraphLookup {
  const byId = new Map(factors.map((f) => [f.id, f]));
  return {
    findEntityById: (id) => {
      const f = byId.get(id);
      return f ? { id: f.id, kind: 'node', label: f.label } : null;
    },
    listEntitiesByKind: (kind) => {
      if (kind !== 'node') return [];
      return factors.map((f) => ({ id: f.id, label: f.label }));
    },
  };
}

function quantity(
  value: number,
  raw_text: string,
  overrides: Partial<QuantityExtractionResult> = {},
): QuantityExtractionResult {
  return {
    raw_text,
    value,
    unit: null,
    direction: null,
    multiplier: null,
    operator: null,
    comparator: null,
    range_min: null,
    range_max: null,
    approximate: false,
    source: 'cqe',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// §2a — Pre-coding regression gate.
// The one-quantity exact-label path must ALREADY work today on origin/staging.
// If this test fails, the diagnosis is incomplete — STOP and report.
// ---------------------------------------------------------------------------

describe('§2a regression gate — one-quantity exact-label dispatch (must already work on origin/staging)', () => {
  it('"increase Hiring and Salary Cost to £100,000" → set_factor_value (single substring match, single quantity)', () => {
    const result = tryDeterministicValueUpdate(
      'increase Hiring and Salary Cost to £100,000',
      [quantity(100000, '£100,000', { unit: 'GBP', operator: 'set', direction: 'set' })],
      makeGraph([{ id: 'fac_hire', label: 'Hiring and Salary Cost' }]),
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.candidate.id).toBe('fac_hire');
    expect(result.candidate.label).toBe('Hiring and Salary Cost');
    expect(result.candidate.source).toBe('substring');
    expect(result.quantity.value).toBe(100000);
  });
});

// ---------------------------------------------------------------------------
// Fix A — positive cases (currently failing on origin/staging; will pass
// once the from/to attribution branch is added).
// ---------------------------------------------------------------------------

describe('Fix A — from/to attribution (positive cases)', () => {
  it('"increase from £80,000 to £100,000" + matching factor → set_factor_value, value=100000, attribution=from_to, operator=set', () => {
    const result = tryDeterministicValueUpdate(
      'increase Hiring and Salary Cost from £80,000 to £100,000',
      [
        quantity(80000, '£80,000', { unit: 'GBP' }),
        quantity(100000, '£100,000', { unit: 'GBP' }),
      ],
      makeGraph([{ id: 'fac_hire', label: 'Hiring and Salary Cost' }]),
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.candidate.id).toBe('fac_hire');
    expect(result.quantity.value).toBe(100000);
    expect(result.attribution).toBe('from_to');
    // Operator: from/to "to <Y>" means SET to Y, regardless of the verb in
    // the message. Force operator=set on the returned quantity so the
    // caller's deriveOperator() resolves to 'set', not 'increase'.
    expect(deriveOperator('increase Hiring and Salary Cost from £80,000 to £100,000', result.quantity)).toBe('set');
  });

  it('"change annual budget from 80k to 100k" + matching factor → set_factor_value, value=100000, attribution=from_to', () => {
    const result = tryDeterministicValueUpdate(
      'change annual budget from 80k to 100k',
      [
        quantity(80000, '80k', { unit: 'GBP' }),
        quantity(100000, '100k', { unit: 'GBP' }),
      ],
      makeGraph([{ id: 'fac_budget', label: 'annual budget' }]),
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.candidate.id).toBe('fac_budget');
    expect(result.quantity.value).toBe(100000);
    expect(result.attribution).toBe('from_to');
  });

  it('mixed-case from/to ("FROM £80,000 TO £100,000") is detected (case-insensitive anchor)', () => {
    const result = tryDeterministicValueUpdate(
      'INCREASE Hiring and Salary Cost FROM £80,000 TO £100,000',
      [
        quantity(80000, '£80,000', { unit: 'GBP' }),
        quantity(100000, '£100,000', { unit: 'GBP' }),
      ],
      makeGraph([{ id: 'fac_hire', label: 'Hiring and Salary Cost' }]),
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.quantity.value).toBe(100000);
    expect(result.attribution).toBe('from_to');
  });
});

// ---------------------------------------------------------------------------
// Fix A — negative gates: cases that MUST keep the existing ambiguous_quantity
// skip or other existing skip reasons. The new branch is narrow on purpose.
// ---------------------------------------------------------------------------

describe('Fix A — negative gates (keep existing skips)', () => {
  it('no edit verb: "from £80,000 to £100,000" → no_edit_verb skip (verb gate is unchanged)', () => {
    const result = tryDeterministicValueUpdate(
      'from £80,000 to £100,000',
      [
        quantity(80000, '£80,000', { unit: 'GBP' }),
        quantity(100000, '£100,000', { unit: 'GBP' }),
      ],
      makeGraph([{ id: 'fac_hire', label: 'Hiring and Salary Cost' }]),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('no_edit_verb');
  });

  it('range pattern: "between £80k and £100k" → ambiguous_quantity (no from/to anchor)', () => {
    const result = tryDeterministicValueUpdate(
      'set Hiring and Salary Cost between £80k and £100k',
      [
        quantity(80000, '£80k', { unit: 'GBP' }),
        quantity(100000, '£100k', { unit: 'GBP' }),
      ],
      makeGraph([{ id: 'fac_hire', label: 'Hiring and Salary Cost' }]),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('ambiguous_quantity');
  });

  it('disjunction: "increase by £20,000 or £30,000" → ambiguous_quantity (no from/to anchor)', () => {
    const result = tryDeterministicValueUpdate(
      'increase Hiring and Salary Cost by £20,000 or £30,000',
      [
        quantity(20000, '£20,000', { unit: 'GBP' }),
        quantity(30000, '£30,000', { unit: 'GBP' }),
      ],
      makeGraph([{ id: 'fac_hire', label: 'Hiring and Salary Cost' }]),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('ambiguous_quantity');
  });

  it('3+ non-null quantities (even with from/to in the message) → ambiguous_quantity (from/to only attributes the 2-quantity case)', () => {
    const result = tryDeterministicValueUpdate(
      'increase Hiring and Salary Cost from £80,000 to £100,000 (was £50,000)',
      [
        quantity(80000, '£80,000', { unit: 'GBP' }),
        quantity(100000, '£100,000', { unit: 'GBP' }),
        quantity(50000, '£50,000', { unit: 'GBP' }),
      ],
      makeGraph([{ id: 'fac_hire', label: 'Hiring and Salary Cost' }]),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('ambiguous_quantity');
  });

  it('from/to anchor but no matching label → no_candidate_match (label gate is unchanged)', () => {
    const result = tryDeterministicValueUpdate(
      'increase the widget from £80,000 to £100,000',
      [
        quantity(80000, '£80,000', { unit: 'GBP' }),
        quantity(100000, '£100,000', { unit: 'GBP' }),
      ],
      makeGraph([{ id: 'fac_hire', label: 'Hiring and Salary Cost' }]),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('no_candidate_match');
  });

  it('hypothetical-gated from/to: "what if we set budget from £80k to £100k" → hypothetical_gate', () => {
    const result = tryDeterministicValueUpdate(
      'what if we set Hiring and Salary Cost from £80k to £100k',
      [
        quantity(80000, '£80k', { unit: 'GBP' }),
        quantity(100000, '£100k', { unit: 'GBP' }),
      ],
      makeGraph([{ id: 'fac_hire', label: 'Hiring and Salary Cost' }]),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('hypothetical_gate');
  });
});

// ---------------------------------------------------------------------------
// Fix A — deictic path: from/to attribution must also fire when the user
// uses a deictic reference + selection.
// ---------------------------------------------------------------------------

describe('Fix A — deictic from/to attribution', () => {
  const FACTORS = makeGraph([
    { id: 'fac_budget', label: 'Advertising budget' },
    { id: 'fac_other', label: 'Headcount' },
  ]);
  const RESOLVE = (id: string) =>
    id === 'fac_budget' ? 'Advertising budget' : id === 'fac_other' ? 'Headcount' : null;

  it('"increase that factor from £80,000 to £100,000" + one selected factor → set_factor_value, value=100000, attribution=from_to', () => {
    const result = tryDeicticValueUpdate(
      'increase that factor from £80,000 to £100,000',
      [
        quantity(80000, '£80,000', { unit: 'GBP' }),
        quantity(100000, '£100,000', { unit: 'GBP' }),
      ],
      FACTORS,
      ['fac_budget'],
      RESOLVE,
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.candidate.id).toBe('fac_budget');
    expect(result.quantity.value).toBe(100000);
    expect(result.attribution).toBe('from_to');
  });

  it('deictic with two quantities but NO from/to anchor → ambiguous_quantity (range/disjunction not eligible)', () => {
    const result = tryDeicticValueUpdate(
      'set that factor between £80k and £100k',
      [
        quantity(80000, '£80k', { unit: 'GBP' }),
        quantity(100000, '£100k', { unit: 'GBP' }),
      ],
      FACTORS,
      ['fac_budget'],
      RESOLVE,
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('ambiguous_quantity');
  });

  it('deictic from/to but no selection → clarify_deictic (no silent updates)', () => {
    const result = tryDeicticValueUpdate(
      'increase that factor from £80,000 to £100,000',
      [
        quantity(80000, '£80,000', { unit: 'GBP' }),
        quantity(100000, '£100,000', { unit: 'GBP' }),
      ],
      FACTORS,
      [],
      RESOLVE,
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('clarify_deictic');
  });
});
