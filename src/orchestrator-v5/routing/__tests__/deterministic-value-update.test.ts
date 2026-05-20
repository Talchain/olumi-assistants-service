/**
 * Unit tests for `tryDeterministicValueUpdate` (V5 explain-stabilisation
 * Task 4 — Test G fix).
 *
 * The pre-route catches "Set X to N" / "Increase Y to N" phrasings before
 * the LLM sees them and dispatches as a clarify direct_answer with
 * candidate factor chips. Tests cover detection rules, the negative gate
 * for hypotheticals, substring-vs-Dice match precedence, and the no-op
 * fall-through when no candidate qualifies.
 */

import { describe, it, expect } from 'vitest';

import type { QuantityExtractionResult } from '../../context/cqe/schema-types.js';
import type { GraphLookup } from '../validator.js';
import {
  tryDeterministicValueUpdate,
  tryDeicticValueUpdate,
  buildClarifyAssistantText,
  buildClarifyChipMessage,
  buildDeicticClarifyAssistantText,
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
    operator: null,
    comparator: null,
    range_min: null,
    range_max: null,
    approximate: false,
    source: 'cqe',
  };
}

const PARSED_300K: QuantityExtractionResult[] = [quantity(300000, '£300k')];
const PARSED_8: QuantityExtractionResult[] = [quantity(8, '8')];

const TWO_COSTS = makeGraph([
  { id: 'fac_hire', label: 'Hiring and Staffing Cost' },
  { id: 'fac_mkt', label: 'Marketing Cost' },
]);

describe('tryDeterministicValueUpdate — detection rules', () => {
  it('exact substring match against multiple candidates → clarify (only "Hiring and Staffing Cost" substring-matches; "Marketing Cost" does not)', () => {
    // V5 D1 golden-path closure (A3.1): single substring match
    // dispatches `set_factor_value`; this fixture has only one
    // substring match (Hiring and Staffing Cost) plus a non-matching
    // sibling (Marketing Cost), so the dispatch is set_factor_value.
    const result = tryDeterministicValueUpdate(
      'Set Hiring and Staffing Cost to £300k',
      PARSED_300K,
      TWO_COSTS,
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.candidate).toMatchObject({
      id: 'fac_hire',
      label: 'Hiring and Staffing Cost',
      score: 1,
      source: 'substring',
    });
  });

  it('"Set Engineering Capacity to 8" with single exact factor → set_factor_value dispatch (A3.1)', () => {
    const result = tryDeterministicValueUpdate(
      'Set Engineering Capacity to 8',
      PARSED_8,
      makeGraph([{ id: 'fac_eng', label: 'Engineering Capacity' }]),
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.candidate.id).toBe('fac_eng');
    expect(result.candidate.source).toBe('substring');
  });

  it('Dice-only match above floor → matched as fuzzy candidate, source=dice', () => {
    // No substring match, but the label shares enough bigrams with the
    // message to clear the 0.4 Dice floor.
    const result = tryDeterministicValueUpdate(
      'Set engineering team capacity to 8',
      PARSED_8,
      makeGraph([{ id: 'fac_eng', label: 'Engineering Capacity' }]),
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.candidates[0].id).toBe('fac_eng');
    expect(result.candidates[0].score).toBeGreaterThanOrEqual(0.4);
    expect(result.candidates[0].score).toBeLessThan(1);
    expect(result.candidates[0].source).toBe('dice');
  });

  it('KNOWN-LIMITATION: "Increase the budget to £300k" vs "Hiring and Staffing Cost" → falls through to LLM', () => {
    // Brief contract: "All candidates < 0.4 → { matched: false } (LLM
    // falls through)". bigramDice("increase the budget to £300k",
    // "Hiring and Staffing Cost") ≈ 0.04 — no algorithmic threshold can
    // reach this without surfacing unrelated factors on routine prompts.
    // A robust fix needs either a curated synonym layer (brittle) or LLM
    // understanding (which is what falling through delivers). Pinning
    // this behaviour so a future change cannot silently re-introduce a
    // broad fallback that contradicts the brief.
    const result = tryDeterministicValueUpdate(
      'Increase the budget to £300k',
      PARSED_300K,
      TWO_COSTS,
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('no_candidate_match');
  });

  it('unrelated target with no substring or Dice match → falls through (no clarify against unrelated factors)', () => {
    // Negative test: when the user's target has no shared lexical
    // material with any factor label, the pre-route MUST fall through
    // rather than surface random factor labels. This protects against a
    // regression where a broad fallback would flood clarify with
    // unrelated chips on dense graphs.
    const result = tryDeterministicValueUpdate(
      'Set the widget to 5',
      PARSED_8,
      makeGraph([
        { id: 'f1', label: 'Engineering Capacity' },
        { id: 'f2', label: 'Marketing Spend' },
      ]),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('no_candidate_match');
  });

  it('verb match is case-insensitive and word-bounded', () => {
    expect(
      tryDeterministicValueUpdate('SET Engineering Capacity to 8', PARSED_8, makeGraph([
        { id: 'f1', label: 'Engineering Capacity' },
      ])).matched,
    ).toBe(true);
    expect(
      tryDeterministicValueUpdate('upset Engineering Capacity to 8', PARSED_8, makeGraph([
        { id: 'f1', label: 'Engineering Capacity' },
      ])).matched,
    ).toBe(false);
  });
});

describe('tryDeterministicValueUpdate — negative gates (hypothetical phrasing)', () => {
  // Each test below pairs a hypothetical phrase with a verb from the edit-
  // verb list so we reach the negative gate (the verb check runs first).
  // The graph carries a factor whose label substring-matches so we'd hit
  // the matched path if the negative gate didn't fire.
  const SUBSTRING_GRAPH = makeGraph([{ id: 'fac_b', label: 'budget' }]);

  it('"What would happen if we set budget to £300k?" → falls through (what would)', () => {
    const result = tryDeterministicValueUpdate(
      'What would happen if we set budget to £300k?',
      PARSED_300K,
      SUBSTRING_GRAPH,
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('hypothetical_gate');
  });

  it('"Can we see what happens if we increase the budget to £300k?" → falls through (if we)', () => {
    const result = tryDeterministicValueUpdate(
      'Can we see what happens if we increase the budget to £300k?',
      PARSED_300K,
      SUBSTRING_GRAPH,
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('hypothetical_gate');
  });

  it('"What if I set the budget higher?" → falls through (what if)', () => {
    const result = tryDeterministicValueUpdate(
      'What if I set the budget higher?',
      PARSED_300K,
      SUBSTRING_GRAPH,
    );
    expect(result.matched).toBe(false);
  });

  it('"Suppose we set budget to £400k" → falls through (suppose)', () => {
    const result = tryDeterministicValueUpdate(
      'Suppose we set budget to £400k',
      PARSED_300K,
      SUBSTRING_GRAPH,
    );
    expect(result.matched).toBe(false);
  });

  it('"Imagine I set the budget to £500k" → falls through (imagine)', () => {
    const result = tryDeterministicValueUpdate(
      'Imagine I set the budget to £500k',
      PARSED_300K,
      SUBSTRING_GRAPH,
    );
    expect(result.matched).toBe(false);
  });

  it('"fastest" does NOT trigger the test negative gate (word-boundary anchored)', () => {
    // The negative-gate `\btest\b` must not fire on "fastest". This test
    // pins the anchor — without it, legitimate "Set fastest delivery to 5"
    // would erroneously fall through to the LLM.
    const result = tryDeterministicValueUpdate(
      'Set fastest delivery to 5',
      PARSED_8,
      makeGraph([{ id: 'f1', label: 'fastest delivery' }]),
    );
    expect(result.matched).toBe(true);
  });
});

describe('tryDeterministicValueUpdate — fall-through cases', () => {
  it('no edit verb → falls through with skip_reason=no_edit_verb', () => {
    const result = tryDeterministicValueUpdate(
      'Tell me about the budget',
      [], // CQE typically empty for "tell me about" prompts; explicit anyway
      TWO_COSTS,
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('no_edit_verb');
  });

  it('edit verb but no CQE quantity → falls through with skip_reason=no_quantity', () => {
    // "Add a risk factor for competition" has an edit-ish verb pattern miss
    // ("add" isn't in the verb list — try a verb that IS in the list).
    const result = tryDeterministicValueUpdate(
      'Set up the budget',
      [],
      TWO_COSTS,
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('no_quantity');
  });

  it('verb + quantity but no graph → falls through with skip_reason=no_graph', () => {
    const result = tryDeterministicValueUpdate(
      'Set the budget to £300k',
      PARSED_300K,
      undefined,
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('no_graph');
  });

  it('factors with null labels are skipped from the candidate pool', () => {
    const result = tryDeterministicValueUpdate(
      'Set Hiring Cost to £300k',
      PARSED_300K,
      makeGraph([
        { id: 'f1', label: null },
        { id: 'f2', label: 'Hiring Cost' },
      ]),
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    // V5 D1 golden-path closure (A3.1): single substring match → dispatch
    // is set_factor_value (a single candidate), not clarify. The
    // null-labelled f1 must still be excluded from consideration.
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.candidate.id).toBe('f2');
  });

});

describe('buildClarifyAssistantText / buildClarifyChipMessage', () => {
  it('single candidate → singular phrasing', () => {
    const text = buildClarifyAssistantText([
      { id: 'f1', label: 'Hiring Cost', score: 1, source: 'substring' },
    ]);
    expect(text).toContain('Hiring Cost');
    expect(text).toContain("wasn't sure");
  });

  it('multiple candidates → plural phrasing', () => {
    const text = buildClarifyAssistantText([
      { id: 'f1', label: 'Hiring Cost', score: 1, source: 'substring' },
      { id: 'f2', label: 'Marketing Cost', score: 1, source: 'substring' },
    ]);
    expect(text).toContain('one of these');
  });

  it('chip message preserves the user verb and surfaces the raw quantity text', () => {
    const msg = buildClarifyChipMessage(
      'Increase the budget to £300k',
      { id: 'f1', label: 'Hiring and Staffing Cost', score: 0.5, source: 'dice' },
      quantity(300000, '£300k'),
    );
    expect(msg).toBe('Increase Hiring and Staffing Cost to £300k.');
  });
});

// ---------------------------------------------------------------------------
// P0 V5 golden-path repair (Wave 2) — Path A selection narrowing
// ---------------------------------------------------------------------------

// Two factors whose labels both appear as substrings in the message.
// Substring matching requires the label to be a substring of the message
// (case-insensitive), so the labels here are short standalone tokens.
const TWO_FACTORS_BOTH_NAMED = makeGraph([
  { id: 'fac_a', label: 'budget' },
  { id: 'fac_b', label: 'cost' },
]);
const PARSED_30K: QuantityExtractionResult[] = [quantity(30000, '£30k')];

describe('tryDeterministicValueUpdate — Path A: selection narrows multi-candidate', () => {
  it('two substring matches + selection picks one factor → set_factor_value on that factor', () => {
    const result = tryDeterministicValueUpdate(
      'Raise budget and cost to £30k',
      PARSED_30K,
      TWO_FACTORS_BOTH_NAMED,
      ['fac_a'],
    );
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.dispatch).toBe('set_factor_value');
      if (result.dispatch === 'set_factor_value') {
        expect(result.candidate.id).toBe('fac_a');
      }
    }
  });

  it('two substring matches + selection contains zero of the candidates → clarify', () => {
    const result = tryDeterministicValueUpdate(
      'Raise budget and cost to £30k',
      PARSED_30K,
      TWO_FACTORS_BOTH_NAMED,
      ['fac_unrelated'],
    );
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.dispatch).toBe('clarify');
  });

  it('two substring matches + selection contains both candidates → clarify (selection too broad)', () => {
    const result = tryDeterministicValueUpdate(
      'Raise budget and cost to £30k',
      PARSED_30K,
      TWO_FACTORS_BOTH_NAMED,
      ['fac_a', 'fac_b'],
    );
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.dispatch).toBe('clarify');
  });

  it('single substring match + no selection → unchanged behaviour (existing test parity)', () => {
    const single = makeGraph([
      { id: 'fac_ad_budget', label: 'Advertising budget' },
      { id: 'fac_other', label: 'Headcount' },
    ]);
    const result = tryDeterministicValueUpdate(
      'Set Advertising budget to £30k',
      PARSED_30K,
      single,
      [],
    );
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.dispatch).toBe('set_factor_value');
      if (result.dispatch === 'set_factor_value') {
        expect(result.candidate.id).toBe('fac_ad_budget');
      }
    }
  });

  it('single substring match + selection on a different factor → label match still wins', () => {
    // Selection should narrow only when label evidence is ambiguous.
    // Otherwise the explicit label is more authoritative than selection.
    const single = makeGraph([
      { id: 'fac_ad_budget', label: 'Advertising budget' },
      { id: 'fac_other', label: 'Headcount' },
    ]);
    const result = tryDeterministicValueUpdate(
      'Set Advertising budget to £30k',
      PARSED_30K,
      single,
      ['fac_other'],
    );
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.dispatch).toBe('set_factor_value');
      if (result.dispatch === 'set_factor_value') {
        expect(result.candidate.id).toBe('fac_ad_budget');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// P0 V5 golden-path repair (Wave 2) — Path B selected-deictic
// ---------------------------------------------------------------------------

describe('tryDeicticValueUpdate — Path B: deictic + selection', () => {
  const FACTORS = makeGraph([
    { id: 'fac_ad_budget', label: 'Advertising budget' },
    { id: 'fac_other', label: 'Headcount' },
  ]);
  const RESOLVE = (id: string) =>
    id === 'fac_ad_budget' ? 'Advertising budget' : id === 'fac_other' ? 'Headcount' : null;

  it('"Update that factor to £30k" + exactly one factor selected → set_factor_value', () => {
    const result = tryDeicticValueUpdate(
      'Update that factor to £30,000',
      PARSED_30K,
      FACTORS,
      ['fac_ad_budget'],
      RESOLVE,
    );
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.dispatch).toBe('set_factor_value');
      if (result.dispatch === 'set_factor_value') {
        expect(result.candidate.id).toBe('fac_ad_budget');
        expect(result.candidate.label).toBe('Advertising budget');
      }
    }
  });

  it('"Update this factor to £30k" works the same way', () => {
    const result = tryDeicticValueUpdate(
      'Update this factor to £30k',
      PARSED_30K,
      FACTORS,
      ['fac_ad_budget'],
      RESOLVE,
    );
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.dispatch).toBe('set_factor_value');
  });

  it('"Set the selected factor to £30k" works the same way', () => {
    const result = tryDeicticValueUpdate(
      'Set the selected factor to £30k',
      PARSED_30K,
      FACTORS,
      ['fac_ad_budget'],
      RESOLVE,
    );
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.dispatch).toBe('set_factor_value');
  });

  it('deictic + no selection → clarify (no_factor_selected)', () => {
    const result = tryDeicticValueUpdate(
      'Update that factor to £30k',
      PARSED_30K,
      FACTORS,
      [],
      RESOLVE,
    );
    expect(result.matched).toBe(true);
    if (result.matched && result.dispatch === 'clarify_deictic') {
      expect(result.reason).toBe('no_factor_selected');
    }
  });

  it('deictic + multiple factors selected → clarify (multiple_factors_selected)', () => {
    const result = tryDeicticValueUpdate(
      'Update that factor to £30k',
      PARSED_30K,
      FACTORS,
      ['fac_ad_budget', 'fac_other'],
      RESOLVE,
    );
    expect(result.matched).toBe(true);
    if (result.matched && result.dispatch === 'clarify_deictic') {
      expect(result.reason).toBe('multiple_factors_selected');
    }
  });

  it('deictic with no quantity → no_quantity skip (falls through to LLM)', () => {
    const result = tryDeicticValueUpdate(
      'Update that factor',
      [],
      FACTORS,
      ['fac_ad_budget'],
      RESOLVE,
    );
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.skip_reason).toBe('no_quantity');
  });

  it('non-deictic message → no_deictic skip (Path A handles it)', () => {
    const result = tryDeicticValueUpdate(
      'Update Advertising budget to £30k',
      PARSED_30K,
      FACTORS,
      ['fac_ad_budget'],
      RESOLVE,
    );
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.skip_reason).toBe('no_deictic');
  });

  it('hypothetical-gated deictic ("what if I set that factor to £30k") → hypothetical_gate', () => {
    const result = tryDeicticValueUpdate(
      'What if I set that factor to £30k',
      PARSED_30K,
      FACTORS,
      ['fac_ad_budget'],
      RESOLVE,
    );
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.skip_reason).toBe('hypothetical_gate');
  });

  it('clarify copy contains no internal terms', () => {
    const noFactor = buildDeicticClarifyAssistantText('no_factor_selected');
    const tooMany = buildDeicticClarifyAssistantText('multiple_factors_selected');
    for (const text of [noFactor, tooMany]) {
      expect(text).not.toMatch(/\bfac_/);
      expect(text).not.toMatch(/\bnoop\b/i);
      expect(text).not.toMatch(/\bzod\b/i);
      expect(text).not.toMatch(/\bedit_graph\b/i);
      expect(text).not.toMatch(/\bnormalised\b/i);
    }
  });
});

// ===========================================================================
// AC.2 — Conservative `ambiguous_quantity` skip on multi-quantity messages.
//
// Replaces deferred Tasks #10/#15 (proximity attribution). The plan-locked
// behaviour: when CQE extracts >1 non-null quantity, the deterministic path
// skips with `skip_reason: 'ambiguous_quantity'` rather than picking the
// first non-null. No first-non-null fallback survives anywhere.
// ===========================================================================

describe('tryDeterministicValueUpdate — AC.2 conservative multi-quantity skip', () => {
  it('multi-quantity message with one matched factor → skip_reason ambiguous_quantity (no first-non-null fallback)', () => {
    const parsed: QuantityExtractionResult[] = [
      quantity(500000, '£500,000'),
      quantity(5, '5'),
      quantity(100000, '£100,000'),
    ];
    const result = tryDeterministicValueUpdate(
      'Set Hiring and Staffing Cost to £500,000 — 5x our £100,000 baseline',
      parsed,
      TWO_COSTS,
    );
    expect(result.matched).toBe(false);
    if (!result.matched) {
      expect(result.skip_reason).toBe('ambiguous_quantity');
    }
  });

  it('multi-quantity message with TWO matched factors → still ambiguous_quantity (clarify path also forbidden from first-non-null)', () => {
    // The clarify dispatch path would have used `parsedQuantities.find(...)`
    // before the fix. AC.2 requires no first-non-null on ANY chip/pending-
    // action-emitting path, so this case also skips.
    const parsed: QuantityExtractionResult[] = [
      quantity(50, '50'),
      quantity(100, '100'),
    ];
    const result = tryDeterministicValueUpdate(
      'Set Hiring and Staffing Cost and Marketing Cost to 50 and 100',
      parsed,
      TWO_COSTS,
    );
    expect(result.matched).toBe(false);
    if (!result.matched) {
      expect(result.skip_reason).toBe('ambiguous_quantity');
    }
  });

  it('single non-null quantity → unchanged set_factor_value dispatch (regression guard)', () => {
    // Single-quantity path must NOT be disturbed by the multi-quantity guard.
    const result = tryDeterministicValueUpdate(
      'Set Hiring and Staffing Cost to £300k',
      PARSED_300K,
      makeGraph([{ id: 'fac_hire', label: 'Hiring and Staffing Cost' }]),
    );
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.dispatch).toBe('set_factor_value');
      if (result.dispatch === 'set_factor_value') {
        expect(result.quantity.value).toBe(300000);
      }
    }
  });

  it('single non-null + one null quantity → unchanged dispatch (null quantities are ignored, not counted toward ambiguity)', () => {
    const parsed: QuantityExtractionResult[] = [
      quantity(300000, '£300k'),
      // A pattern that returned a result but with `value: null` (e.g. CQE
      // saw "the budget" without a numeric anchor) — must not count.
      {
        raw_text: 'the budget',
        value: null,
        unit: null,
        direction: null,
        multiplier: null,
        operator: null,
        comparator: null,
        range_min: null,
        range_max: null,
        approximate: false,
        source: 'cqe',
      },
    ];
    const result = tryDeterministicValueUpdate(
      'Set Hiring and Staffing Cost to £300k for the budget',
      parsed,
      makeGraph([{ id: 'fac_hire', label: 'Hiring and Staffing Cost' }]),
    );
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.dispatch).toBe('set_factor_value');
    }
  });
});

describe('tryDeicticValueUpdate — AC.2 conservative multi-quantity skip', () => {
  it('multi-quantity on the deictic path → skip_reason ambiguous_quantity', () => {
    // The deictic path used to apply the same first-non-null
    // selection as the main detector. AC.2 forbids that pattern on
    // any chip/pending-action-emitting path; deictic must skip with
    // ambiguous_quantity too.
    const parsed: QuantityExtractionResult[] = [
      quantity(30000, '£30k'),
      quantity(5, '5'),
    ];
    const result = tryDeicticValueUpdate(
      'Set that factor to £30k — that is 5 times the baseline',
      parsed,
      makeGraph([{ id: 'fac_a', label: 'Factor A' }]),
      ['fac_a'],
      () => 'Factor A',
    );
    expect(result.matched).toBe(false);
    if (!result.matched) {
      expect(result.skip_reason).toBe('ambiguous_quantity');
    }
  });

  it('single quantity on the deictic path → unchanged dispatch', () => {
    const result = tryDeicticValueUpdate(
      'Set that factor to £30k',
      [quantity(30000, '£30k')],
      makeGraph([{ id: 'fac_a', label: 'Factor A' }]),
      ['fac_a'],
      () => 'Factor A',
    );
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.dispatch).toBe('set_factor_value');
    }
  });
});
