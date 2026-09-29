/**
 * Compound value-update receipt — the no-em-dash copy ruling, pinned.
 *
 * `buildCompoundReceiptText` is live product copy on the deployed value-edit
 * lane: it is what a user reads after "Set A to 0.6 and B to 0.8", and it is
 * the one sentence that names a part the batch could not apply. Two standing
 * rulings govern it:
 *
 *   1. NO EM DASHES in product content (Paul, 2026-09-10). The refusal sentence
 *      bolted its reason onto the named factors with an em dash. The ruling is
 *      to split into sentences or cut; this splits.
 *   2. Every refused part is named SPECIFICALLY. "…and 3 more" is a defect this
 *      estate has fixed once already and must not re-introduce.
 *
 * Ruling 2 already holds and is pinned here as a REGRESSION guard, so the copy
 * change made for ruling 1 cannot quietly trade one defect for the other. The
 * pair is deliberate: only the em-dash assertions move.
 *
 * WHAT WOULD HAVE TO BE TRUE for these to pass while the property fails? The
 * receipt could omit the refusal entirely (an em-dash-free string that has lost
 * the disclosure). Every case below therefore also asserts the refused label
 * and its reason clause survive — an absence check with its own positive
 * control in the same test.
 */
import { describe, it, expect } from 'vitest';

import type { HandlerOutcome } from '../tools/registry.js';

import {
  buildCompoundReceiptText,
  type CompoundPartRefusal,
} from '../compound-value-update-chain.js';

const EM_DASH = '—';

function outcome(assistant_text: string): HandlerOutcome {
  return { assistant_text, handler_facts: [], llm_calls_used: 0 };
}

const APPLIED: readonly HandlerOutcome[] = [
  outcome('Updated Factor A to 0.6.'),
  outcome('Updated Factor B to 0.8.'),
];

function refusal(
  label: string,
  reason: CompoundPartRefusal['reason'],
): CompoundPartRefusal {
  return { label, target_id: `fac_${label.toLowerCase().replace(/\s+/g, '_')}`, reason };
}

const ALL_REASONS: ReadonlyArray<CompoundPartRefusal['reason']> = [
  'not_a_factor',
  'value_invalid',
  'target_unresolved',
  'unit_incompatible',
  'unit_unresolved',
  'execute_invalid',
];

describe('compound receipt — no em dash in product copy (Paul, 2026-09-10)', () => {
  it.each(ALL_REASONS)('a refusal for reason "%s" carries no em dash', (reason) => {
    const text = buildCompoundReceiptText(APPLIED, [refusal('Marketing Budget', reason)]);
    expect(text).not.toContain(EM_DASH);
    // Positive control: the disclosure is still present, not deleted.
    expect(text).toContain('Marketing Budget');
  });

  it('several refused parts across different reasons carry no em dash', () => {
    const text = buildCompoundReceiptText(APPLIED, [
      refusal('Marketing Budget', 'unit_incompatible'),
      refusal('Headcount', 'not_a_factor'),
      refusal('Churn Rate', 'value_invalid'),
    ]);
    expect(text).not.toContain(EM_DASH);
    expect(text).toContain('Marketing Budget');
    expect(text).toContain('Headcount');
    expect(text).toContain('Churn Rate');
  });

  it('an all-applied receipt (no refusals) carries no em dash', () => {
    const text = buildCompoundReceiptText(APPLIED, []);
    expect(text).not.toContain(EM_DASH);
    expect(text).toContain('Updated Factor A to 0.6.');
  });
});

describe('compound receipt — every refused part is named specifically (regression guard)', () => {
  it('names all four refused factors and never abbreviates the tail to a count', () => {
    const labels = ['Marketing Budget', 'Headcount', 'Churn Rate', 'Unit Cost'];
    const text = buildCompoundReceiptText(
      APPLIED,
      labels.map((l) => refusal(l, 'value_invalid')),
    );
    for (const label of labels) {
      expect(text).toContain(label);
    }
    expect(text).not.toMatch(/\d+\s+more\b/i);
    expect(text).not.toMatch(/\band\s+others\b/i);
  });

  it('the applied parts are still named and the reason clause still reaches the user', () => {
    const text = buildCompoundReceiptText(APPLIED, [
      refusal('Marketing Budget', 'unit_incompatible'),
    ]);
    expect(text).toContain('Updated Factor A to 0.6.');
    expect(text).toContain('Updated Factor B to 0.8.');
    expect(text.toLowerCase()).toContain('unit');
  });
});
