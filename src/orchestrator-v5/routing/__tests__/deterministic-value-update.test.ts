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
  buildClarifyAssistantText,
  buildClarifyChipMessage,
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
const PARSED_20PCT: QuantityExtractionResult[] = [quantity(20, '20%')];

const TWO_COSTS = makeGraph([
  { id: 'fac_hire', label: 'Hiring and Staffing Cost' },
  { id: 'fac_mkt', label: 'Marketing Cost' },
]);

describe('tryDeterministicValueUpdate — detection rules', () => {
  it('exact substring match → top candidate score = 1.0, source = substring', () => {
    const result = tryDeterministicValueUpdate(
      'Set Hiring and Staffing Cost to £300k',
      PARSED_300K,
      TWO_COSTS,
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.candidates[0]).toMatchObject({
      id: 'fac_hire',
      label: 'Hiring and Staffing Cost',
      score: 1,
      source: 'substring',
    });
  });

  it('"Set Engineering Capacity to 8" with exact factor → matched, source=substring', () => {
    const result = tryDeterministicValueUpdate(
      'Set Engineering Capacity to 8',
      PARSED_8,
      makeGraph([{ id: 'fac_eng', label: 'Engineering Capacity' }]),
    );
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.candidates[0].id).toBe('fac_eng');
    expect(result.candidates[0].source).toBe('substring');
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
    expect(result.candidates.every((c) => c.id !== 'f1')).toBe(true);
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
