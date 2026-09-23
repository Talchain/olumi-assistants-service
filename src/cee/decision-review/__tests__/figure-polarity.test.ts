/**
 * The polarity reader, corpus, and egress repair in isolation.
 *
 * Not RED-first evidence (the module is new). The RED-first proofs live in
 * `shape-check.figure-polarity.test.ts`, the enricher seam spec and the route
 * spec, all of which run at the base. This file pins the reader's corpus in
 * BOTH directions — the flips corpus includes PLoT's own producer strings from
 * the 2026-04-30 staging capture, not only sentences written for this test.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  derivePolarityCorpus,
  findPolarityBoundFigures,
  isFigureGroundedForPolarity,
  redactUngroundedPolarityFigures,
  ungroundedFigureReplacement,
} from '../figure-polarity.js';
import { findForbiddenPhraseHit } from '../../../orchestrator-v5/compose/forbidden-user-facing-phrases.js';

const capture = JSON.parse(
  readFileSync(
    new URL('../../../../tests/fixtures/cross-service/v5-turn.run-analysis.staging.json', import.meta.url),
    'utf8',
  ),
) as { blocks: Array<{ enrichment: Record<string, unknown> }> };
const captured = capture.blocks[0]!.enrichment;
const CAPTURED_ROBUSTNESS = captured.robustness as Record<string, unknown>;

/** PLoT-authored prose from the capture — the producer's own flip dialect. */
const PLOT_FLIP_STRINGS: string[] = [];
(function harvest(node: unknown): void {
  if (typeof node === 'string') {
    if (/% chance (?:this flips|of flipping)/.test(node)) PLOT_FLIP_STRINGS.push(node);
    return;
  }
  if (Array.isArray(node)) return node.forEach(harvest);
  if (node !== null && typeof node === 'object') Object.values(node).forEach(harvest);
})(captured);

describe('findPolarityBoundFigures — MUST bind', () => {
  it.each([
    ['The ordering holds in about 70% of variations.', 'holds', 70],
    ['the ordering holds in about 71% of variations', 'holds', 71],
    ['The result stays the same in roughly 64% of runs.', 'holds', 64],
    ['It holds up in about 58 percent of simulations.', 'holds', 58],
    ['In about 70% of variations, the ordering holds.', 'holds', 70],
    ['There is a 71% probability that the ordering holds.', 'holds', 71],
    ['The ordering could flip in about 70% of variations.', 'flips', 70],
    ['There is a 70% chance this flips.', 'flips', 70],
    ['The ranking changes in about 30% of runs.', 'flips', 30],
    ['In 30% of runs, the ordering flips.', 'flips', 30],
  ] as const)('%s → %s %d', (text, polarity, value) => {
    const figures = findPolarityBoundFigures(text);
    expect(figures).toHaveLength(1);
    expect(figures[0]).toMatchObject({ polarity, value });
    expect(text.slice(figures[0]!.index).startsWith(String(value))).toBe(true);
  });

  it("PLoT's own flip strings from the capture bind as FLIPS (producer corpus, not the author's)", () => {
    // Precondition: the harvest is not empty (trap 13).
    expect(PLOT_FLIP_STRINGS.length).toBeGreaterThanOrEqual(5);
    for (const text of PLOT_FLIP_STRINGS) {
      const figures = findPolarityBoundFigures(text);
      expect(figures.map((f) => f.polarity), text).toEqual(['flips']);
    }
  });
});

describe('findPolarityBoundFigures — must NOT bind', () => {
  it.each([
    // Win probability beside a figure-free flip phrase.
    'Reduce scope scored highest in 52% of runs, but the ordering could flip if the Scope link is weaker.',
    // A holds verb with no attached figure.
    'The lead holds under most plausible variations.',
    // Figure attached to a different subject.
    'Option A holds a 62% share of wins.',
    // Negated frames are DECLINED, not inverted.
    'The ordering does not hold in 30% of variations.',
    "The ordering won't flip in 70% of runs.",
    // A percentage-change, not an ordering change.
    'If the price changes by 20%, the ordering could flip.',
    // No figure at all (the existing grounding test's own sentence).
    'Recommendation holds in about 99 of 100 scenarios tested.',
  ])('%s', (text) => {
    expect(findPolarityBoundFigures(text)).toEqual([]);
  });
});

describe('derivePolarityCorpus + isFigureGroundedForPolarity', () => {
  it('holds ← recommendation_stability ONLY; flips ← switch probabilities ONLY', () => {
    const corpus = derivePolarityCorpus({
      isl_results: {
        robustness: { recommendation_stability: 0.71, overall_confidence: 0.3 },
        fragile_edges: [{ switch_probability: 0.6968, marginal_switch_probability: 0.12 }],
      },
    });
    expect(corpus).toEqual({ holds: [0.71], flips: [0.6968, 0.12] });
  });

  it('ABSENT stability ⇒ a holds figure is UNGROUNDED, even when a flip probability matches it', () => {
    const corpus = derivePolarityCorpus({
      isl_results: { robustness: {}, fragile_edges: [{ switch_probability: 0.6968 }] },
    });
    expect(isFigureGroundedForPolarity({ polarity: 'holds', value: 70 }, corpus)).toBe(false);
    expect(isFigureGroundedForPolarity({ polarity: 'flips', value: 70 }, corpus)).toBe(true);
  });

  it('NO DERIVED EQUIVALENCE: 1 − switch_probability never grounds a holds figure', () => {
    const corpus = derivePolarityCorpus({
      isl_results: { robustness: {}, fragile_edges: [{ switch_probability: 0.3 }] },
    });
    expect(isFigureGroundedForPolarity({ polarity: 'holds', value: 70 }, corpus)).toBe(false);
  });

  it("the capture's own robustness block grounds by polarity", () => {
    const corpus = derivePolarityCorpus({ isl_results: CAPTURED_ROBUSTNESS && {
      robustness: { recommendation_stability: CAPTURED_ROBUSTNESS.recommendation_stability },
      fragile_edges: CAPTURED_ROBUSTNESS.fragile_edges,
    } });
    // 0.7193 stability; 0.452 top switch probability.
    expect(isFigureGroundedForPolarity({ polarity: 'holds', value: 72 }, corpus)).toBe(true);
    expect(isFigureGroundedForPolarity({ polarity: 'flips', value: 45 }, corpus)).toBe(true);
    expect(isFigureGroundedForPolarity({ polarity: 'holds', value: 45 }, corpus)).toBe(false);
    expect(isFigureGroundedForPolarity({ polarity: 'flips', value: 72 }, corpus)).toBe(false);
  });
});

describe('redactUngroundedPolarityFigures', () => {
  const noStability = { isl_results: { robustness: {}, fragile_edges: [{ switch_probability: 0.6968 }] } };

  it('replaces only the offending sentence, in every field, and reports paths', () => {
    const review = {
      narrative_summary: 'Reduce scope scored highest in 52% of runs. The ordering holds in about 70% of variations.',
      robustness_explanation: { summary: 'The ordering holds in about 70% of variations.' },
      key_assumptions: ['Scope can be cut without losing the client.'],
    };
    const out = redactUngroundedPolarityFigures(review, noStability);
    expect(out.value.narrative_summary).toBe(
      'Reduce scope scored highest in 52% of runs. ' + ungroundedFigureReplacement('holds', false),
    );
    expect(out.value.robustness_explanation.summary).toBe(ungroundedFigureReplacement('holds', false));
    expect(out.value.key_assumptions).toBe(review.key_assumptions); // same reference: untouched
    expect(out.paths).toEqual(['narrative_summary', 'robustness_explanation.summary']);
    expect(out.holds).toBe(2);
    expect(out.flips).toBe(0);
    expect(out.holdsSourcePresent).toBe(false);
  });

  it('a clean review comes back as the SAME reference', () => {
    const review = { narrative_summary: 'The ordering could flip in about 70% of variations.' };
    expect(redactUngroundedPolarityFigures(review, noStability).value).toBe(review);
  });

  it('stability PRESENT but mismatched uses the mismatch copy, not "does not report"', () => {
    const out = redactUngroundedPolarityFigures(
      { narrative_summary: 'The ordering holds in about 70% of variations.' },
      { isl_results: { robustness: { recommendation_stability: 0.3 }, fragile_edges: [{ switch_probability: 0.6968 }] } },
    );
    expect(out.value.narrative_summary).toBe(ungroundedFigureReplacement('holds', true));
  });

  it('replacement copy carries no digits, no dashes, no field names, and passes the egress phrase guard', () => {
    for (const polarity of ['holds', 'flips'] as const) {
      for (const present of [true, false]) {
        const copy = ungroundedFigureReplacement(polarity, present);
        expect(copy).not.toMatch(/\d/);
        expect(copy).not.toMatch(/[—–]/);
        expect(copy).not.toMatch(/stability|switch|probability|_/i);
        expect(findForbiddenPhraseHit(copy)).toBeNull();
        // And the copy itself is not a bound figure (it cannot re-trigger).
        expect(findPolarityBoundFigures(copy)).toEqual([]);
      }
    }
  });
});
