/**
 * Unit tests for `tryCompoundValueUpdate` (A1 multi-edit — build lane).
 *
 * The single-edit pre-route (`tryDeterministicValueUpdate`) bails on any
 * multi-quantity message with `ambiguous_quantity`. This detector covers the
 * safe, unambiguous subset — N distinct factor labels paired positionally with
 * N quantities in strict "label to <num>" interleaving — so a compound edit
 * ("Set A to 0.6 and B to 0.8") applies BOTH values instead of applying one
 * and narrating the other as deferred.
 *
 * Pinned against the live phrasing verified 19 Jul (scenario c4c76247):
 * compound "Set A to 0.6 and B to 0.8" → deterministic value-update BAILED at
 * deterministic-value-update.ts (nonNullQuantities.length > 1 → skip_reason
 * 'ambiguous_quantity') → one applied, one deferred-in-prose.
 */

import { describe, it, expect } from 'vitest';

import type { QuantityExtractionResult } from '../../context/cqe/schema-types.js';
import type { GraphLookup } from '../validator.js';
import {
  tryCompoundValueUpdate,
  tryDeterministicValueUpdate,
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

function quantity(value: number, raw_text: string): QuantityExtractionResult {
  return {
    raw_text,
    value,
    unit: null,
    direction: null,
    multiplier: null,
    operator: 'set',
    comparator: null,
    range_min: null,
    range_max: null,
    approximate: false,
    source: 'cqe',
  };
}

/**
 * O-1: segment pairing binds a quantity to a label via the quantity's
 * VALUE-TOKEN SPAN. Production spans come from `runExtraction`; for these
 * hand-built fixtures we locate the value token in the message (the test
 * messages contain no word-numbers / odd whitespace, so raw offsets equal
 * CQE-normalised offsets). `nth` selects among repeated occurrences.
 */
function spannedQuantity(
  message: string,
  value: number,
  raw_text: string,
  nth = 0,
): QuantityExtractionResult {
  let idx = -1;
  for (let i = 0; i <= nth; i++) {
    idx = message.indexOf(raw_text, idx + 1);
  }
  if (idx === -1) throw new Error(`fixture bug: "${raw_text}" not in "${message}"`);
  return { ...quantity(value, raw_text), span_start: idx, span_end: idx + raw_text.length };
}

const TWO_FACTORS = makeGraph([
  { id: 'fac_a', label: 'Factor A' },
  { id: 'fac_b', label: 'Factor B' },
]);

// Document-order quantities: 0.6 then 0.8 (spanless — used by tests whose
// gates fire before pairing; pairing-reaching tests build spanned fixtures).
const PARSED_06_08: QuantityExtractionResult[] = [
  quantity(0.6, '0.6'),
  quantity(0.8, '0.8'),
];

function spanned06And08(message: string): QuantityExtractionResult[] {
  return [
    spannedQuantity(message, 0.6, '0.6'),
    spannedQuantity(message, 0.8, '0.8'),
  ];
}

describe('tryCompoundValueUpdate — the pinned live phrasing', () => {
  it('"Set Factor A to 0.6 and Factor B to 0.8" → matched with two segment-paired updates', () => {
    const message = 'Set Factor A to 0.6 and Factor B to 0.8';
    const result = tryCompoundValueUpdate(
      message,
      spanned06And08(message),
      TWO_FACTORS,
      new Set(['fac_a', 'fac_b']),
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('compound_value_update');
    expect(result.updates).toHaveLength(2);
    // Segment pairing: 0.6 sits in A's bounded segment, 0.8 in B's.
    expect(result.updates[0]!.candidate.id).toBe('fac_a');
    expect(result.updates[0]!.quantity.value).toBe(0.6);
    expect(result.updates[1]!.candidate.id).toBe('fac_b');
    expect(result.updates[1]!.quantity.value).toBe(0.8);
    // Each part carries its own segment text (the preflight's unit-guard scope).
    expect(result.updates[0]!.segmentText).toContain('0.6');
    expect(result.updates[0]!.segmentText).not.toContain('0.8');
    expect(result.updates[1]!.segmentText).toContain('0.8');
  });

  it('the single-edit path STILL bails on the same phrasing (compound is a separate route)', () => {
    // Regression pin: the single path must keep refusing multi-quantity
    // messages. The compound detector is additive — it does not change the
    // single path's conservative behaviour.
    const single = tryDeterministicValueUpdate(
      'Set Factor A to 0.6 and Factor B to 0.8',
      PARSED_06_08,
      TWO_FACTORS,
      [],
      new Set(['fac_a', 'fac_b']),
    );
    expect(single.matched).toBe(false);
    if (single.matched) return;
    expect(single.skip_reason).toBe('ambiguous_quantity');
  });

  it('the edit verb appears only in the first segment — the second part still resolves', () => {
    // THE SUBTLETY: "Factor B to 0.8" has no verb. A naive split-on-verb
    // would drop it. Segment label↔quantity pairing recovers it.
    const message = 'Increase Factor A to 0.6 and Factor B to 0.8';
    const result = tryCompoundValueUpdate(
      message,
      spanned06And08(message),
      TWO_FACTORS,
      new Set(['fac_a', 'fac_b']),
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.updates.map((u) => u.candidate.id)).toEqual(['fac_a', 'fac_b']);
  });
});

describe('tryCompoundValueUpdate — O-1 segment pairing (the F2 fix)', () => {
  it('a stray leading number (date/budget/age) is IGNORED, never paired: "Using the 2026 forecast, set A to 0.6 and B to 0.8"', () => {
    const message = 'Using the 2026 forecast, set Factor A to 0.6 and Factor B to 0.8';
    const parsed = [
      spannedQuantity(message, 2026, '2026'),
      ...spanned06And08(message),
    ];
    const result = tryCompoundValueUpdate(message, parsed, TWO_FACTORS, new Set(['fac_a', 'fac_b']));
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.updates).toHaveLength(2);
    expect(result.updates[0]!.quantity.value).toBe(0.6);
    expect(result.updates[1]!.quantity.value).toBe(0.8);
  });

  it('a label whose segment has NO quantity bails (unpaired_label) — the 2026 must NOT be attributed: "…set A to current plan and B to 0.8"', () => {
    // THE F2 DEFECT: global document-order pairing attributed the leading
    // 2026 to Factor A and durably wrote it. Segment pairing sees A's
    // segment ("to current plan and") carries no number and refuses.
    const message = 'Using the 2026 forecast, set Factor A to current plan and Factor B to 0.8';
    const parsed = [
      spannedQuantity(message, 2026, '2026'),
      spannedQuantity(message, 0.8, '0.8'),
    ];
    const result = tryCompoundValueUpdate(message, parsed, TWO_FACTORS, new Set(['fac_a', 'fac_b']));
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('unpaired_label');
  });

  it('a segment with TWO quantities bails (unpaired_label): "set A to 0.6 and B to 0.8 by March 2027"', () => {
    const message = 'Set Factor A to 0.6 and Factor B to 0.8 by March 2027';
    const parsed = [
      ...spanned06And08(message),
      spannedQuantity(message, 2027, '2027'),
    ];
    const result = tryCompoundValueUpdate(message, parsed, TWO_FACTORS, new Set(['fac_a', 'fac_b']));
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('unpaired_label');
  });

  it('a quantity WITHOUT a value-token span bails (missing_spans) — no fallback to order pairing', () => {
    // Order pairing is exactly the defect segment pairing replaced, so a
    // spanless quantity must refuse, never silently degrade.
    const result = tryCompoundValueUpdate(
      'Set Factor A to 0.6 and Factor B to 0.8',
      PARSED_06_08,
      TWO_FACTORS,
      new Set(['fac_a', 'fac_b']),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('missing_spans');
  });
});

describe('tryCompoundValueUpdate — ambiguous forms still bail', () => {
  it('range "Set Factor A between 0.6 and 0.8" → not matched (one label, two quantities)', () => {
    const result = tryCompoundValueUpdate(
      'Set Factor A between 0.6 and 0.8',
      PARSED_06_08,
      TWO_FACTORS,
      new Set(['fac_a', 'fac_b']),
    );
    expect(result.matched).toBe(false);
  });

  it('disjunction "Set Factor A to 0.6 or Factor B to 0.8" → not matched (disjunction gate)', () => {
    const result = tryCompoundValueUpdate(
      'Set Factor A to 0.6 or Factor B to 0.8',
      PARSED_06_08,
      TWO_FACTORS,
      new Set(['fac_a', 'fac_b']),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('disjunction');
  });

  it('labels-then-values "Set Factor A and Factor B to 0.6 and 0.8" → not matched (non-interleaved)', () => {
    // Positional pairing would misattribute here — the A↔B labels are
    // adjacent with no `to` between them. Refuse rather than guess.
    const result = tryCompoundValueUpdate(
      'Set Factor A and Factor B to 0.6 and 0.8',
      PARSED_06_08,
      TWO_FACTORS,
      new Set(['fac_a', 'fac_b']),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('non_interleaved');
  });

  it('count mismatch "Set Factor A to 0.6 and Factor B" (2 labels, 1 quantity) → not matched', () => {
    const result = tryCompoundValueUpdate(
      'Set Factor A to 0.6 and Factor B',
      [quantity(0.6, '0.6')],
      TWO_FACTORS,
      new Set(['fac_a', 'fac_b']),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    // Single quantity → the compound detector defers to the single path.
    expect(result.skip_reason).toBe('not_compound');
  });

  it('hypothetical "What if Factor A were 0.6 and Factor B were 0.8" → not matched (hypothetical gate)', () => {
    const result = tryCompoundValueUpdate(
      'What if I set Factor A to 0.6 and Factor B to 0.8',
      PARSED_06_08,
      TWO_FACTORS,
      new Set(['fac_a', 'fac_b']),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('hypothetical_gate');
  });

  it('degraded extraction → refuses (never applies a value CQE could not vouch for)', () => {
    const result = tryCompoundValueUpdate(
      'Set Factor A to 0.6 and Factor B to 0.8',
      PARSED_06_08,
      TWO_FACTORS,
      new Set(['fac_a', 'fac_b']),
      true,
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('degraded_extraction');
  });

  it('no edit verb → not matched', () => {
    const result = tryCompoundValueUpdate(
      'Factor A is 0.6 and Factor B is 0.8',
      PARSED_06_08,
      TWO_FACTORS,
      new Set(['fac_a', 'fac_b']),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('no_edit_verb');
  });
});
