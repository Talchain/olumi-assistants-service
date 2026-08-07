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
import { extractQuantities } from '../../context/cqe/extract-quantities.js';
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
    // Narrow on dispatch — a matched result can be either `clarify`
    // (plural `candidates`) or `set_factor_value` (singular
    // `candidate`). Dice-only matches are clarify by design (A3.1
    // limits set_factor_value to single substring matches), so
    // asserting the dispatch first both type-narrows and pins the
    // brief contract.
    expect(result.dispatch).toBe('clarify');
    if (result.dispatch !== 'clarify') return;
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

  it('chip message preserves the user verb and renders the parsed quantity', () => {
    // 1.16 item E — deliberate expectation change: the chip previously
    // embedded `raw_text` verbatim ('£300k'). The value slot now renders
    // from the PARSED quantity (mapCqeQuantityToProposalValue +
    // formatValueWithUnit), because CQE `raw_text` can span the whole
    // sentence (see the real-CQE fixtures below). A GBP quantity therefore
    // renders as the canonical '£300,000'.
    const msg = buildClarifyChipMessage(
      'Increase the budget to £300k',
      { id: 'f1', label: 'Hiring and Staffing Cost', score: 0.5, source: 'dice' },
      { ...quantity(300000, '£300k'), unit: 'GBP' },
    );
    expect(msg).toBe('Increase Hiring and Staffing Cost to £300,000.');
  });

  // -------------------------------------------------------------------------
  // 1.16 item E — clarify chip raw-text embed. CQE's `raw_text` is the FULL
  // pattern match (context/cqe/rules.ts `emit`: raw = match[0]), and the
  // sentence-level patterns capture the whole leading phrase. Embedding it in
  // the chip template produced "Set X to Set migration cost to £250k." —
  // garbled copy whose replay also re-parses unreliably. These fixtures run
  // REAL CQE over the exact diagnosed sentence.
  // -------------------------------------------------------------------------

  describe('buildClarifyChipMessage — real-CQE raw_text spans the sentence (item E, 1.16)', () => {
    it('"Set migration cost to £250k." → chip renders the parsed value, not the sentence', () => {
      const parsed = extractQuantities('Set migration cost to £250k.');
      expect(parsed.length).toBe(1);
      // Proves the hazard: raw_text covers the whole sentence.
      expect(parsed[0]!.raw_text.toLowerCase()).toContain('set migration cost');
      const msg = buildClarifyChipMessage(
        'Set migration cost to £250k.',
        { id: 'f1', label: 'Migration Cost', score: 1, source: 'substring' },
        parsed[0]!,
      );
      expect(msg).toBe('Set Migration Cost to £250,000.');
    });

    it('delta phrasing keeps its "by" semantics so the replay stays a delta', () => {
      const parsed = extractQuantities('Increase the budget by £20k.');
      expect(parsed.length).toBe(1);
      expect(parsed[0]!.operator).toBe('increment');
      const msg = buildClarifyChipMessage(
        'Increase the budget by £20k.',
        { id: 'f1', label: 'Budget', score: 1, source: 'substring' },
        parsed[0]!,
      );
      // "to £20,000" would silently flip the delta into an absolute set on
      // replay; the preposition must follow the parsed operator.
      expect(msg).toBe('Increase Budget by £20,000.');
    });

    it('raw_text is only a fallback when the quantity has no parsed value', () => {
      const msg = buildClarifyChipMessage(
        'Set the cost to a lot',
        { id: 'f1', label: 'Cost', score: 1, source: 'substring' },
        { ...quantity(0, 'a lot'), value: null },
      );
      expect(msg).toBe('Set Cost to a lot.');
    });
  });
});

// ---------------------------------------------------------------------------
// 1.16 item B — kind-gate clarify restore. PR #383's type filter narrows the
// candidate pool to factor-kind nodes, which is right for ranking — but when
// the user names a NON-factor node ("Set Customer Churn Risk to 20%") the
// filtered pool yields no match and the turn fell through to the LLM as
// `no_candidate_match`, losing the cheap pre-LLM recovery that existed
// before the filter: dispatch the single substring match and let the
// caller's kind check downgrade it to the kind-gate clarify
// (`downgrade_reason: 'non_factor_kind'`).
// ---------------------------------------------------------------------------

describe('tryDeterministicValueUpdate — non-factor single substring match (item B, 1.16)', () => {
  const MIXED_KINDS = makeGraph([
    { id: 'fac_mkt', label: 'Marketing Cost' },
    { id: 'risk_churn', label: 'Customer Churn Risk' },
  ]);
  const FACTOR_IDS = new Set(['fac_mkt']);
  const PARSED_20: QuantityExtractionResult[] = [quantity(20, '20%')];

  it('only substring match in the unfiltered pool is a non-factor → dispatches it for the caller kind gate (was: no_candidate_match)', () => {
    const result = tryDeterministicValueUpdate(
      'Set Customer Churn Risk to 20%',
      PARSED_20,
      MIXED_KINDS,
      [],
      FACTOR_IDS,
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.candidate.id).toBe('risk_churn');
    expect(result.candidate.source).toBe('substring');
  });

  it('multiple non-factor substring matches → still no_candidate_match (narrow by design)', () => {
    const graph = makeGraph([
      { id: 'fac_mkt', label: 'Marketing Cost' },
      { id: 'risk_churn', label: 'Churn Risk' },
      { id: 'out_churn', label: 'Churn Outcome' },
    ]);
    const result = tryDeterministicValueUpdate(
      'Set Churn Risk and Churn Outcome to 20%',
      PARSED_20,
      graph,
      [],
      new Set(['fac_mkt']),
    );
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('no_candidate_match');
  });

  it('factor match present → non-factor pool is never consulted (type filter unchanged)', () => {
    const result = tryDeterministicValueUpdate(
      'Set Marketing Cost to 20%',
      PARSED_20,
      MIXED_KINDS,
      [],
      FACTOR_IDS,
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.candidate.id).toBe('fac_mkt');
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

// ===========================================================================
// 1.16b — Demo-Gate usability defect: a unique, exact substring match on a
// factor label was being defeated by lower-quality Dice runner-ups (which
// could include differently-typed nodes, e.g. the decision node, sharing
// tokens with the message). Fixed via:
//   1. auto-select when the top substring match clearly dominates any
//      Dice runner-up (AUTO_SELECT_DOMINANCE_MARGIN), and
//   2. an optional `factorNodeIds` type filter so non-factor nodes never
//      enter the candidate pool at all.
// The two fixes are independently exercised below, plus a regression guard
// that genuinely-ambiguous cases (comparable-score factor matches) still
// clarify.
// ===========================================================================

/**
 * Extended graph builder that also accepts a `factorIds` set, mirroring
 * production's `factorIdSet` (turn-executor.ts) — the caller-supplied type
 * filter. `makeGraph` above stays factor-only-by-construction for the
 * pre-existing tests; this helper is separate so it can model a candidate
 * pool that mixes factor and non-factor nodes under the same bucketed
 * `listEntitiesByKind('node')` EntityKind, exactly as `buildGraphLookup`
 * does in production.
 */
function makeMixedGraph(
  entries: ReadonlyArray<{ id: string; label: string | null }>,
): GraphLookup {
  const byId = new Map(entries.map((f) => [f.id, f]));
  return {
    findEntityById: (id) => {
      const f = byId.get(id);
      return f ? { id: f.id, kind: 'node', label: f.label } : null;
    },
    listEntitiesByKind: (kind) => {
      if (kind !== 'node') return [];
      return entries.map((f) => ({ id: f.id, label: f.label }));
    },
  };
}

describe('tryDeterministicValueUpdate — 1.16b factor-edit matcher fix', () => {
  it('REGRESSION FIXTURE (render request_id 1921f7c1-b295-4056-8b3a-21b4c3ef63fb): exact factor label + a differently-typed node sharing tokens (decision) → auto-applies (was: clarify)', () => {
    // Reproduces the verified defect: a perfect substring match on the
    // named factor ("North America Market Growth Rate") competed against
    // two Dice matches whose labels share tokens but belong to a
    // differently-typed node (here: a decision node) — those Dice
    // candidates previously forced clarify even though the substring
    // match was unique and exact. With the `factorNodeIds` type filter,
    // the decision node never enters the candidate pool in the first
    // place, so the lone substring match auto-selects.
    const graph = makeMixedGraph([
      { id: 'fac_namg', label: 'North America Market Growth Rate' },
      { id: 'dec_expand', label: 'Grow North America market share' },
      { id: 'out_entry', label: 'Enter the North American market' },
    ]);
    const factorNodeIds = new Set(['fac_namg']); // only the factor is a valid type

    const result = tryDeterministicValueUpdate(
      'Set North America Market Growth Rate to £5m',
      [quantity(5_000_000, '£5m')],
      graph,
      [],
      factorNodeIds,
    );

    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.candidate.id).toBe('fac_namg');
    expect(result.candidate.source).toBe('substring');
  });

  it('dominance fix alone (no type filter supplied): unique substring match beats weak same-kind Dice runner-ups → auto-applies', () => {
    // Isolates fix component #1 from #2: every candidate here IS a
    // factor (no non-factor node in the pool at all — `factorNodeIds` is
    // omitted), so this exercises the dominance-margin auto-select on
    // its own. Before the fix, ANY Dice runner-up — however weak —
    // defeated the substring match; now a weak echo (well below the
    // 0.85 dominance-margin cutoff) does not.
    const graph = makeGraph([
      { id: 'fac_namg', label: 'North America Market Growth Rate' },
      { id: 'fac_decoy_1', label: 'Grow North America market share' },
      { id: 'fac_decoy_2', label: 'Enter the North American market' },
    ]);

    const result = tryDeterministicValueUpdate(
      'Set North America Market Growth Rate to £5m',
      [quantity(5_000_000, '£5m')],
      graph,
    );

    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.candidate.id).toBe('fac_namg');
  });

  it('type filter alone: a decision-kind node scoring ABOVE the dominance margin is excluded from candidates entirely, not merely outscored', () => {
    // Distinguishes "type-filtered out" from "dominated but still
    // present": the decision node's label is deliberately chosen to
    // Dice-score close to (or above) the 0.85 dominance cutoff against
    // the message, so if it were merely outscored (not filtered) this
    // case could still tip into ambiguous_quantity/clarify. Because
    // `factorNodeIds` excludes it from the pool up front, it can never
    // appear in `matched.length`/candidates and never influence the
    // dispatch at all — the sole factor candidate auto-selects.
    const graph = makeMixedGraph([
      { id: 'fac_namg', label: 'North America Market Growth Rate' },
      // Near-identical wording to the factor label but a decision node —
      // Dice-scores 0.857 against the message (verified in this file's
      // dev-time score computation), i.e. ABOVE the 0.85 dominance
      // cutoff. If this candidate were merely outscored rather than
      // type-filtered out, the dominance check alone would deem it "too
      // close to call" and fall through to clarify — proving this
      // assertion exercises the type filter, not the dominance margin.
      { id: 'dec_near_dupe', label: 'The North America Market Growth Rate' },
    ]);
    const factorNodeIds = new Set(['fac_namg']);

    const result = tryDeterministicValueUpdate(
      'Set North America Market Growth Rate to £5m',
      [quantity(5_000_000, '£5m')],
      graph,
      [],
      factorNodeIds,
    );

    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.candidate.id).toBe('fac_namg');
  });

  it('GENUINELY AMBIGUOUS regression guard: two comparable-score factor matches still clarify (dominance fix does not over-correct)', () => {
    // Two near-duplicate FACTOR labels (both pass the type filter) where
    // the unmatched one Dice-scores 0.902 against the message — well
    // ABOVE the 0.85 dominance cutoff, i.e. a genuine rival, not a weak
    // echo. Must still clarify — the over-acceptance guard and the new
    // dominance auto-select coexist. (Labels are deliberately long/
    // near-identical so the single Q1/Q2 token difference is diluted
    // enough by shared bigrams to land above the cutoff — a short label
    // pair would score lower and defeat the point of this fixture.)
    const LABEL_Q1 = 'North America Market Growth Rate for Q1 Regional Expansion Plan';
    const LABEL_Q2 = 'North America Market Growth Rate for Q2 Regional Expansion Plan';
    const graph = makeMixedGraph([
      { id: 'fac_q1', label: LABEL_Q1 },
      { id: 'fac_q2', label: LABEL_Q2 },
    ]);
    const factorNodeIds = new Set(['fac_q1', 'fac_q2']);

    const result = tryDeterministicValueUpdate(
      `Set ${LABEL_Q1} to £5m`,
      [quantity(5_000_000, '£5m')],
      graph,
      [],
      factorNodeIds,
    );

    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('clarify');
    if (result.dispatch !== 'clarify') return;
    const ids = result.candidates.map((c) => c.id);
    expect(ids).toContain('fac_q1');
    expect(ids).toContain('fac_q2');
  });

  it('factorNodeIds omitted (back-compat): unfiltered pool behaves exactly as before this fix for non-dominant cases', () => {
    // When the caller has no kind information (factorNodeIds undefined),
    // the pool is unfiltered — same as every pre-1.16b test fixture.
    // Pins that omitting the new parameter does not change behaviour for
    // a case that was ALREADY clarify before this fix (comparable-score
    // rival present, no type information to exclude it). Same labels as
    // the fixture above, verifying the outcome doesn't depend on whether
    // `factorNodeIds` is supplied-but-inclusive or omitted entirely.
    const LABEL_Q1 = 'North America Market Growth Rate for Q1 Regional Expansion Plan';
    const LABEL_Q2 = 'North America Market Growth Rate for Q2 Regional Expansion Plan';
    const graph = makeGraph([
      { id: 'fac_q1', label: LABEL_Q1 },
      { id: 'fac_q2', label: LABEL_Q2 },
    ]);

    const result = tryDeterministicValueUpdate(
      `Set ${LABEL_Q1} to £5m`,
      [quantity(5_000_000, '£5m')],
      graph,
    );

    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('clarify');
  });
});
