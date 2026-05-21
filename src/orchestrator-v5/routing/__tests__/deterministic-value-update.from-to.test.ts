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

import { extractQuantities } from '../../context/cqe/extract-quantities.js';
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

  it('reviewer counterexample (PR #192): "from Q1 to Q2 by £20k and headcount by 3" → ambiguous_quantity (anchors not bound to numeric tokens)', () => {
    // The first-draft FROM_TO_ANCHOR_PATTERN matched the words from/to
    // anywhere in the message and would have attributed the SECOND CQE
    // quantity (3) as the target — silently setting "annual budget" to
    // 3. The tightened FROM_TO_NUMERIC_ANCHOR_PATTERN requires digits at
    // both anchors; "from Q1" fails because "Q" is neither currency nor
    // a digit, so the message falls through to the conservative
    // multi-quantity guard.
    const result = tryDeterministicValueUpdate(
      'change annual budget from Q1 to Q2 by £20k and headcount by 3',
      [
        quantity(20000, '£20k', { unit: 'GBP' }),
        quantity(3, '3'),
      ],
      makeGraph([
        { id: 'fac_budget', label: 'annual budget' },
        { id: 'fac_head', label: 'headcount' },
      ]),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('ambiguous_quantity');
  });

  it('non-numeric from-side: "from January to £100k by £20k" → ambiguous_quantity (from-anchor not bound to a number)', () => {
    const result = tryDeterministicValueUpdate(
      'increase Hiring and Salary Cost from January to £100,000 by £20,000',
      [
        quantity(100000, '£100,000', { unit: 'GBP' }),
        quantity(20000, '£20,000', { unit: 'GBP' }),
      ],
      makeGraph([{ id: 'fac_hire', label: 'Hiring and Salary Cost' }]),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('ambiguous_quantity');
  });

  it('non-numeric to-side: "from £80k to next quarter by £20k" → ambiguous_quantity (to-anchor not bound to a number)', () => {
    const result = tryDeterministicValueUpdate(
      'increase Hiring and Salary Cost from £80,000 to next quarter by £20,000',
      [
        quantity(80000, '£80,000', { unit: 'GBP' }),
        quantity(20000, '£20,000', { unit: 'GBP' }),
      ],
      makeGraph([{ id: 'fac_hire', label: 'Hiring and Salary Cost' }]),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('ambiguous_quantity');
  });

  it('reviewer counterexample (PR #192 round 3): "from ¥1 to ¥2" with synthetic 2-quantity fixture → ambiguous_quantity (¥ is NOT in CQE CURRENCY_SYMBOL; regex must NOT accept it)', () => {
    // Same drift class as bare-`b`: the round-3 regex `[£$€¥]?`
    // accepted ¥ locally, but CQE's `CURRENCY_SYMBOL = £|\$|€` does
    // not. If CQE were to emit two bare numeric quantities for a ¥
    // message, the deterministic branch would have silently set the
    // factor to the bare second number. Real CQE emits 0 quantities
    // for ¥ today (see the integration test below), so the actual
    // hazard is zero today — but the grammar drift is the bug. The
    // fix shares CQE's `CURRENCY_SYMBOL_SOURCE` so the regex rejects
    // ¥ for the same reason CQE does.
    const result = tryDeterministicValueUpdate(
      'increase Japan Cost from ¥1 to ¥2',
      [
        quantity(1, '¥1'),
        quantity(2, '¥2'),
      ],
      makeGraph([{ id: 'fac_japan', label: 'Japan Cost' }]),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('ambiguous_quantity');
  });

  it('reviewer counterexample (PR #192 round 2): "from £1b to £2b" → falls through (bare `b` is NOT a CQE suffix; regex must NOT accept it)', () => {
    // Synthetic CQE quantities mirror what CQE actually emits when the
    // user writes "£1b" / "£2b" with the bare-b form: bare numbers 1 and
    // 2, because `b` is NOT in CQE's suffix grammar
    // `(?:k|m|bn|million|billion|thousand)`. The earlier regex
    // `(?:k|m|bn?)?` accepted `b` and would have attributed `2` as the
    // target value — silently setting the factor to £2 instead of £2bn.
    // The fix shares CQE's exact suffix source so the regex rejects
    // bare-`b` exactly the way CQE does.
    const result = tryDeterministicValueUpdate(
      'increase Market Size from £1b to £2b',
      [
        quantity(1, '£1', { unit: 'GBP' }),
        quantity(2, '£2', { unit: 'GBP' }),
      ],
      makeGraph([{ id: 'fac_mkt', label: 'Market Size' }]),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('ambiguous_quantity');
  });

  it('"from £1bn to £2bn" with real `bn` suffix → set_factor_value, value=2_000_000_000 (suffix-grammar positive case)', () => {
    const result = tryDeterministicValueUpdate(
      'increase Market Size from £1bn to £2bn',
      [
        quantity(1_000_000_000, '£1bn', { unit: 'GBP' }),
        quantity(2_000_000_000, '£2bn', { unit: 'GBP' }),
      ],
      makeGraph([{ id: 'fac_mkt', label: 'Market Size' }]),
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.quantity.value).toBe(2_000_000_000);
    expect(result.attribution).toBe('from_to');
  });

  it('"from 1 million to 2 million" with the word-form suffix → set_factor_value, value=2_000_000 (long-form suffix-grammar positive case)', () => {
    const result = tryDeterministicValueUpdate(
      'increase Market Size from 1 million to 2 million',
      [
        quantity(1_000_000, '1 million'),
        quantity(2_000_000, '2 million'),
      ],
      makeGraph([{ id: 'fac_mkt', label: 'Market Size' }]),
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.quantity.value).toBe(2_000_000);
    expect(result.attribution).toBe('from_to');
  });
});

// ---------------------------------------------------------------------------
// Fix A — CQE integration: exercise the real `extractQuantities()` so
// regressions in CQE-vs-regex grammar drift surface immediately rather
// than only when the synthetic-quantity tests stop reflecting reality.
// PR #192 reviewer feedback (2026-05-22) made this case explicit.
// ---------------------------------------------------------------------------

describe('Fix A — real-CQE integration (no synthetic quantities)', () => {
  // Probing real CQE (2026-05-22) shows it MERGES well-formed
  // "from <X> to <Y>" phrases into ONE quantity with operator='set' and
  // value=Y. The deterministic detector's from/to branch only fires
  // when CQE emits 2 separate quantities — which happens when CQE
  // didn't recognise the from/to pattern (e.g. an unsupported suffix
  // like bare-`b`). The branch is therefore a safety net for the
  // exact edge case the reviewer was worried about, not the common
  // path. These integration tests pin the contract end-to-end.

  it('"increase Market Size from £1bn to £2bn" via real CQE → CQE collapses to ONE quantity (value=2bn); detector dispatches via single-quantity path', () => {
    const message = 'increase Market Size from £1bn to £2bn';
    const cqe = extractQuantities(message);
    const nonNull = cqe.filter((q) => q.value !== null);
    // Real CQE behaviour: ONE quantity with the to-value. If CQE
    // ever changes to emit two separate quantities, this assertion
    // fails first — proves a human review caught the drift before
    // the deterministic branch quietly took over.
    expect(nonNull.length).toBe(1);
    expect(nonNull[0]!.value).toBe(2_000_000_000);
    expect(nonNull[0]!.operator).toBe('set');

    const result = tryDeterministicValueUpdate(
      message,
      cqe,
      makeGraph([{ id: 'fac_mkt', label: 'Market Size' }]),
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.quantity.value).toBe(2_000_000_000);
    // Single-quantity path — from/to branch did NOT fire because
    // CQE already merged. `attribution` is therefore unset.
    expect(result.attribution).toBeUndefined();
  });

  it('"increase Market Size from £1b to £2b" via real CQE → 2 quantities (1, 2) → tightened regex rejects bare-`b` → ambiguous_quantity (no silent mis-mutation)', () => {
    // This is the reviewer's specific safety check. CQE does NOT
    // recognise bare-`b` as a billion suffix (its grammar is
    // `k|m|bn|million|billion|thousand`), so its from/to merger does
    // not fire. CQE falls back to two separate bare-currency
    // quantities (1 and 2). With the first-draft `bn?` regex the
    // detector would have matched and attributed `2` as the target —
    // silently setting Market Size to £2 instead of the user's
    // intended £2bn. The fix (sharing CQE's exact suffix source) makes
    // the regex reject bare-`b` exactly the way CQE does.
    const message = 'increase Market Size from £1b to £2b';
    const cqe = extractQuantities(message);
    const nonNull = cqe.filter((q) => q.value !== null);
    // Real CQE behaviour (locked): 2 quantities, bare values (no
    // billion multiplier). If CQE ever starts handling bare-`b`, this
    // pins the change for human review before the detector's regex
    // diverges.
    expect(nonNull.length).toBe(2);
    expect(nonNull[0]!.value).toBe(1);
    expect(nonNull[1]!.value).toBe(2);

    const result = tryDeterministicValueUpdate(
      message,
      cqe,
      makeGraph([{ id: 'fac_mkt', label: 'Market Size' }]),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('ambiguous_quantity');
  });

  it('"increase Japan Cost from ¥1 to ¥2" via real CQE → 0 quantities (CQE rejects ¥) → no_quantity skip (no silent mis-mutation today)', () => {
    // Locks the real-CQE behaviour for ¥: zero quantities extracted.
    // The deterministic detector therefore skips at the
    // nonNullQuantities.length === 0 gate, well before the from/to
    // branch can fire. If CQE ever adds ¥ to `CURRENCY_SYMBOL`, the
    // shared `CURRENCY_SYMBOL_SOURCE` import means the anchor pattern
    // updates automatically AND this test pins the change for human
    // review.
    const message = 'increase Japan Cost from ¥1 to ¥2';
    const cqe = extractQuantities(message);
    const nonNull = cqe.filter((q) => q.value !== null);
    expect(nonNull.length).toBe(0);

    const result = tryDeterministicValueUpdate(
      message,
      cqe,
      makeGraph([{ id: 'fac_japan', label: 'Japan Cost' }]),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('no_quantity');
  });

  it('"increase Hiring and Salary Cost from £80,000 to £100,000" via real CQE → single quantity (£100,000, operator=set) → set_factor_value with value=100000', () => {
    // The Golden Journey row 7 phrasing routed end-to-end through real
    // CQE: CQE merges the from/to into one quantity (100000), the
    // detector substring-matches the factor label, single-quantity
    // path dispatches set_factor_value. This is the deterministic
    // happy path the row-7 workstream targeted; the from/to branch
    // is the safety net for cases where this merger does not fire.
    const message = 'increase Hiring and Salary Cost from £80,000 to £100,000';
    const cqe = extractQuantities(message);
    const nonNull = cqe.filter((q) => q.value !== null);
    expect(nonNull.length).toBe(1);
    expect(nonNull[0]!.value).toBe(100000);

    const result = tryDeterministicValueUpdate(
      message,
      cqe,
      makeGraph([{ id: 'fac_hire', label: 'Hiring and Salary Cost' }]),
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.candidate.id).toBe('fac_hire');
    expect(result.quantity.value).toBe(100000);
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
