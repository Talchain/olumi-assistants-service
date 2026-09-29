/**
 * QUALITY DETECTORS — DOES A DETECTOR THAT ASKS ABOUT **MAGNITUDE** STAY BLIND
 * TO **POLARITY**?
 *
 * Three sibling detectors in `cee/structure/index.ts` are handed the SAME
 * post-STRP `ctx.graph` in the SAME stage (`unified-pipeline/stages/package.ts`),
 * and all three ask a question about how far apart the edge strengths are —
 * never about which way they point:
 *
 *   | detector                     | call site         | the question it answers                          |
 *   |------------------------------|-------------------|--------------------------------------------------|
 *   | `detectUniformStrengths`     | `package.ts:594`  | did the model default every edge to the midpoint? |
 *   | `detectStrengthClustering`   | `package.ts:601`  | did the model hedge?                              |
 *   | `computeModelQualityFactors` | `package.ts:653`  | did the model hedge? (as a confidence input)      |
 *
 * The first two emit to `draft_warnings` (`package.ts:800`); the third emits
 * `model_quality_factors` (`package.ts:805`) and lifts `estimate_confidence` by
 * +0.10 when `strength_variation > 0.3`. All three are on the wire.
 *
 * ⚠ WHY THIS FILE EXISTS, AND WHY IT BELONGS TO THE POLARITY CHANGE. Before
 * STRP Rule 4 became direction-authoritative, a stated-negative relationship
 * carried a POSITIVE magnitude — the signed and the unsigned reading agreed, and
 * a detector that read the signed value was indistinguishable from one that read
 * the magnitude. Once the sign moves onto the magnitude the two readings part,
 * and a detector reading the signed value stops answering its own question:
 *
 *   · `detectUniformStrengths` measured distance from **+0.5**, so a defaulted
 *     edge at −0.5 no longer counted as defaulted. On a graph where its own
 *     warning string ("100% of causal edges have default strength (0.5)") is
 *     literally true it computed 40% and said nothing.
 *   · `detectStrengthClustering` took the variance of **signed** values about the
 *     mean of **absolute** values — not a coefficient of variation at all once
 *     signs are mixed. For an edge at −0.6 against `meanAbs` 0.6 it read a
 *     deviation of −1.2 where the true deviation from the magnitude mean is 0.
 *
 * Both errors point the same way: a warning that says "the model hedged" goes
 * QUIET on exactly the drafts the polarity change touches. `Math.abs` at each
 * reader is the same remedy `validation/integrity-sentinel.ts:516-517` already
 * applies to this same question, for this same stated reason.
 *
 * These cases are written against the SPEC — "a magnitude question is blind to
 * polarity" — not against the failure mode in hand, and every case has its
 * OPPOSITE-DIRECTION TWIN (genuinely varied magnitudes must still NOT trip a
 * detector), so a fix that buys detection by making the detectors fire more
 * often cannot pass.
 *
 * ⚠ WHY THE EXISTING CORPORA COULD NOT SEE THIS. `cee.quality-detection.test.ts`
 * carries 17 positive `strength_mean` literals and 1 negative;
 * `cee.uniform-strength-detection.test.ts` carries 27 and 2. NEITHER FILE
 * MENTIONS `effect_direction` AT ALL, so neither can construct a graph whose
 * negatives arrive by the route reconciliation creates. The corpora shared the
 * code's blind spot and therefore certified it. Every graph below is built
 * with stated directions and passed through the REAL `reconcileStructuralTruth`
 * rather than hand-written into its post-state.
 */

import { describe, it, expect } from 'vitest';
import { reconcileStructuralTruth } from '../../src/validators/structural-reconciliation.js';
import {
  detectUniformStrengths,
  detectStrengthClustering,
  computeModelQualityFactors,
} from '../../src/cee/structure/index.js';
import type { GraphT } from '../../src/schemas/graph.js';

type Direction = 'positive' | 'negative';

/**
 * A graph of five `factor → outcome` edges and nothing else.
 *
 * Deliberately carries NO decision→option or option→factor edges: those are the
 * two structural types `detectUniformStrengths` and `detectStrengthClustering`
 * exclude but `computeModelQualityFactors` does not, so excluding them makes all
 * three siblings read the IDENTICAL edge set. Any divergence between the three
 * verdicts below is then a property of the readers, not of their populations.
 */
function causalGraph(edges: Array<{ mean: number; direction: Direction }>): GraphT {
  return {
    version: '1',
    default_seed: 42,
    nodes: [
      ...edges.map((_, i) => ({
        id: `fac_${i + 1}`,
        kind: 'factor',
        label: `Driver ${i + 1}`,
        data: { value: 0.5, extractionType: 'explicit' },
      })),
      { id: 'out_result', kind: 'outcome', label: 'Result' },
    ],
    edges: edges.map((e, i) => ({
      id: `e${i + 1}`,
      from: `fac_${i + 1}`,
      to: 'out_result',
      strength_mean: e.mean,
      belief_exists: 1,
      effect_direction: e.direction,
    })),
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
  } as unknown as GraphT;
}

/**
 * Build the graph, run the REAL reconciliation, and PIN THE PRECONDITION.
 *
 * Every assertion in this file is about what the detectors see AFTER the sign
 * has moved onto the magnitude. If reconciliation ever stopped doing that, each
 * case below would pass while testing nothing — so the count of signs actually
 * moved is asserted here, in-test, before any detector runs (CLAUDE.md trap 13b:
 * a discriminator must pin its own precondition).
 */
function reconciled(
  edges: Array<{ mean: number; direction: Direction }>,
  expectedSignsMoved: number,
): GraphT {
  const graph = causalGraph(edges);
  const before = (graph.edges as unknown as Array<{ strength_mean: number }>).map((e) => e.strength_mean);

  reconcileStructuralTruth(graph);

  const after = (graph.edges as unknown as Array<{ strength_mean: number }>).map((e) => e.strength_mean);
  const signsMoved = after.filter((v, i) => v !== before[i]).length;
  expect(
    signsMoved,
    'PRECONDITION: reconciliation must have moved the sign onto the magnitude, or every assertion below is vacuous',
  ).toBe(expectedSignsMoved);

  return graph;
}

/** A fully hedged graph: five causal edges, every magnitude the 0.5 default, three stated negative. */
const HEDGED_WITH_NEGATIVES: Array<{ mean: number; direction: Direction }> = [
  { mean: 0.5, direction: 'positive' },
  { mean: 0.5, direction: 'negative' },
  { mean: 0.5, direction: 'negative' },
  { mean: 0.5, direction: 'negative' },
  { mean: 0.5, direction: 'positive' },
];

/** The twin: genuinely varied magnitudes, negatives included. No detector may trip on this. */
const VARIED_WITH_NEGATIVES: Array<{ mean: number; direction: Direction }> = [
  { mean: 0.15, direction: 'positive' },
  { mean: 0.4, direction: 'negative' },
  { mean: 0.62, direction: 'negative' },
  { mean: 0.85, direction: 'negative' },
  { mean: 0.95, direction: 'positive' },
];

describe('quality detectors that ask about MAGNITUDE stay blind to POLARITY', () => {
  describe('detectUniformStrengths — "did the model default every edge to the midpoint?"', () => {
    it('trips on a fully hedged graph whose stated-negative edges carry -0.5 after reconciliation', () => {
      const graph = reconciled(HEDGED_WITH_NEGATIVES, 3);

      const result = detectUniformStrengths(graph as never);

      // Its own warning string asserts this percentage, so it must be the true one.
      expect(result.defaultStrengthPercentage).toBe(1);
      expect(result.defaultStrengthCount).toBe(5);
      expect(result.detected, 'every causal edge is at the 0.5 default — the warning must fire').toBe(true);
      expect(result.warning?.explanation).toContain('100% of causal edges have default strength (0.5)');
    });

    // OPPOSITE-DIRECTION TWIN: closing the gap must not buy detection by firing
    // on a graph the model did NOT hedge. `Math.abs` of a varied magnitude is
    // still varied.
    it('TWIN: stays silent when the magnitudes are genuinely varied, stated negatives included', () => {
      const graph = reconciled(VARIED_WITH_NEGATIVES, 3);

      const result = detectUniformStrengths(graph as never);

      expect(result.defaultStrengthCount).toBe(0);
      expect(result.detected).toBe(false);
      expect(result.warning).toBeUndefined();
    });

    // A magnitude question cannot have two answers for one graph. This is the
    // property, stated directly: polarity is not an input.
    it('returns the identical verdict whether the hedged edges are stated positive or negative', () => {
      const allPositive = causalGraph(HEDGED_WITH_NEGATIVES.map((e) => ({ ...e, direction: 'positive' as const })));
      reconcileStructuralTruth(allPositive);
      const mixed = reconciled(HEDGED_WITH_NEGATIVES, 3);

      const fromPositive = detectUniformStrengths(allPositive as never);
      const fromMixed = detectUniformStrengths(mixed as never);

      expect(fromMixed.detected).toBe(fromPositive.detected);
      expect(fromMixed.defaultStrengthPercentage).toBe(fromPositive.defaultStrengthPercentage);
    });
  });

  describe('detectStrengthClustering — "did the model hedge?"', () => {
    it('trips on a fully hedged graph whose stated-negative edges carry -0.5 after reconciliation', () => {
      const graph = reconciled(HEDGED_WITH_NEGATIVES, 3);

      const result = detectStrengthClustering(graph as never);

      // Five magnitudes of exactly 0.5: zero spread, so the CV is zero.
      expect(result.coefficientOfVariation).toBeCloseTo(0, 10);
      expect(result.detected, 'a graph with zero spread in magnitude is clustered by definition').toBe(true);
      expect(result.warning?.id).toBe('strength_clustering');
    });

    it('TWIN: stays silent when the magnitudes are genuinely varied, stated negatives included', () => {
      const graph = reconciled(VARIED_WITH_NEGATIVES, 3);

      const result = detectStrengthClustering(graph as never);

      expect(result.coefficientOfVariation).toBeGreaterThan(0.3);
      expect(result.detected).toBe(false);
      expect(result.warning).toBeUndefined();
    });

    it('returns the identical verdict whether the hedged edges are stated positive or negative', () => {
      const allPositive = causalGraph(HEDGED_WITH_NEGATIVES.map((e) => ({ ...e, direction: 'positive' as const })));
      reconcileStructuralTruth(allPositive);
      const mixed = reconciled(HEDGED_WITH_NEGATIVES, 3);

      const fromPositive = detectStrengthClustering(allPositive as never);
      const fromMixed = detectStrengthClustering(mixed as never);

      expect(fromMixed.detected).toBe(fromPositive.detected);
      expect(fromMixed.coefficientOfVariation).toBeCloseTo(fromPositive.coefficientOfVariation, 10);
    });

    // The specific arithmetic defect, pinned so a later tidy-up cannot restore
    // it: the deviation must be taken from the magnitude mean, in magnitude
    // space. A single stated-negative edge at −0.6 against `meanAbs` 0.6 read a
    // deviation of −1.2 under the signed reading, where the true deviation is 0.
    it('takes the deviation in magnitude space — mixed signs at one magnitude have zero spread', () => {
      const graph = reconciled(
        [
          { mean: 0.6, direction: 'positive' },
          { mean: 0.6, direction: 'negative' },
        ],
        1,
      );

      const result = detectStrengthClustering(graph as never);

      expect(result.edgeCount).toBe(2);
      expect(result.coefficientOfVariation).toBeCloseTo(0, 10);
    });
  });

  describe('computeModelQualityFactors — the sibling repaired earlier in this change', () => {
    it('reports no strength variation on a fully hedged graph with stated negatives', () => {
      const graph = reconciled(HEDGED_WITH_NEGATIVES, 3);

      const result = computeModelQualityFactors(graph as never);

      expect(result.strength_variation).toBeCloseTo(0, 10);
      // strength_variation <= 0.3 is the "hedged" branch, which must NOT lift
      // estimate_confidence.
      expect(result.strength_variation).toBeLessThanOrEqual(0.3);
    });

    it('TWIN: still reports real variation when the magnitudes genuinely differ', () => {
      const graph = reconciled(VARIED_WITH_NEGATIVES, 3);

      const result = computeModelQualityFactors(graph as never);

      expect(result.strength_variation).toBeGreaterThan(0.3);
    });
  });

  /**
   * The whole-seam property. `package.ts` calls all three of these on ONE graph
   * within a few lines of each other. Reconciliation moving a sign onto a
   * magnitude is not new information about how varied the strengths are, so it
   * must move NO detector's verdict.
   *
   * This case is the one that would have caught the regression: it needs no
   * knowledge of which reader was wrong, only that the three siblings answer one
   * question and reconciliation does not change its answer.
   */
  describe('all three siblings answer one question, and reconciliation does not change its answer', () => {
    it.each([
      { name: 'a fully hedged graph', edges: HEDGED_WITH_NEGATIVES, signsMoved: 3 },
      { name: 'a genuinely varied graph', edges: VARIED_WITH_NEGATIVES, signsMoved: 3 },
    ])('no verdict moves across reconciliation — $name', ({ edges, signsMoved }) => {
      const graph = causalGraph(edges);

      const before = {
        uniform: detectUniformStrengths(graph as never).detected,
        clustering: detectStrengthClustering(graph as never).detected,
        hedgedByQualityFactors: computeModelQualityFactors(graph as never).strength_variation <= 0.3,
      };

      const meansBefore = (graph.edges as unknown as Array<{ strength_mean: number }>).map((e) => e.strength_mean);
      reconcileStructuralTruth(graph);
      const meansAfter = (graph.edges as unknown as Array<{ strength_mean: number }>).map((e) => e.strength_mean);
      expect(
        meansAfter.filter((v, i) => v !== meansBefore[i]).length,
        'PRECONDITION: reconciliation must have moved signs, or this comparison is between two identical graphs',
      ).toBe(signsMoved);

      const after = {
        uniform: detectUniformStrengths(graph as never).detected,
        clustering: detectStrengthClustering(graph as never).detected,
        hedgedByQualityFactors: computeModelQualityFactors(graph as never).strength_variation <= 0.3,
      };

      expect(after).toEqual(before);
    });
  });
});
