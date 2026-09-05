/**
 * EDGE POLARITY, PART 2 — WHEN THE MAGNITUDE CARRIES ITS OWN SIGN, THE LABEL
 * IS DERIVED FROM IT AND NEVER THE OTHER WAY ROUND.
 *
 * ⭐⭐ TWO QUESTIONS, NOT ONE. `cee.edge-polarity-direction-authority.test.ts`
 * pins the answer to
 *
 *     Q_B: "the magnitude carries NO sign information (an unsigned |mean| plus
 *           a label) — what is this edge's polarity?"
 *          → the LABEL is the only signal, so the label informs the mean.
 *
 * This file pins the answer to the OTHER question, which that file's rule was
 * silently answering the same way and getting wrong:
 *
 *     Q_A: "the magnitude carries its OWN sign (mean < 0) and the label
 *           contradicts it — what is this edge's polarity?"
 *          → the MEAN is authoritative, so the LABEL is corrected.
 *
 * The two input classes are disjoint by construction (`mean < 0` XOR
 * `mean > 0`), so this is two named predicates, NOT one widened one
 * (CLAUDE.md trap 21 — two questions under one name is this estate's signature
 * defect, and aligning the defaults is the wrong fix).
 *
 * ⭐ WHY THE MEAN IS AUTHORITATIVE ON Q_A — derived at the bytes, and it is the
 * fact that refutes point (d) of the sibling file's rationale:
 *
 *   ISL — the actual compute engine — NEVER SEES `effect_direction`. `EdgeV2`
 *   does not declare it and sets `extra: "ignore"`
 *   (`Inference-Service-Layer/src/models/robustness_v2.py:415-419` @ 7781ca4f),
 *   so the field is silently dropped at the engine boundary. `current_mean` is
 *   `edge.strength.mean` verbatim
 *   (`robustness_analyzer_v2.py:6260-6262`), with no negation or direction
 *   lookup anywhere in that repo.
 *
 *   The sibling rationale claims direction-authoritative is "LOSS-FREE, it
 *   keeps BOTH facts". That is true only where the mean's sign carried no
 *   information. On Q_A it is FALSE and inverted: rewriting -0.53 → +0.53
 *   destroys the polarity of the ONLY field that computes, and ships a
 *   genuinely inverted sign to an engine that is structurally incapable of
 *   detecting it. A field the engine ignores cannot be the authority for what
 *   the engine calculates.
 *
 * ⭐ AND THE PRODUCER AGREES. The live draft grammar instructs the model
 *   "effect_direction MUST match sign of strength.mean"
 *   (`src/prompts/defaults-v15.ts:425`) and the edit-graph prompt states the
 *   derivation as a rule — "mean > 0 -> effect_direction: 'positive'
 *   / mean < 0 -> effect_direction: 'negative'"
 *   (`src/prompts/edit-graph-v6.ts:181-182`). The canonical schema doc records
 *   `effect_direction` as "(encoded in sign)" and applies the label only to the
 *   legacy UNSIGNED `weight`, after signed `strength.mean`
 *   (`Olumi_Decision_Model_Schema_v2_6.md` §C.2). The label is a projection of
 *   the sign; a disagreement on Q_A is stochastic non-compliance with an
 *   explicit instruction, not a second opinion.
 *
 * ⚠ WHAT THIS FILE DELIBERATELY DOES NOT DO: it does not symmetrise the
 * wire-boundary guards (`cee/transforms/schema-v3.ts:834`,
 * PLoT `src/normalisation/graph-normaliser.ts:708`). Both handle only
 * `direction === 'negative' && mean > 0`, and that asymmetry is presently the
 * only thing protecting a correctly-signed negative mean. Making them
 * symmetric would re-open exactly the inversion this file closes.
 *
 * Every case below has its OPPOSITE-DIRECTION TWIN (CLAUDE.md trap 22b), and
 * the invariants are written against the SPEC — "the label projects the sign;
 * the magnitude is never rewritten from the label once it is signed" — never
 * against the failure mode in hand (trap 13d).
 */

import { describe, it, expect } from 'vitest';
import { reconcileStructuralTruth } from '../../src/validators/structural-reconciliation.js';
import type { GraphT } from '../../src/schemas/graph.js';

/**
 * Minimal graph carrying ONE edge under test, bound by an identity no other
 * edge in the graph can satisfy (`fac_driver → out_result`). Assertions find
 * the edge by that pair, never by a value predicate another edge could match
 * (CLAUDE.md trap 19).
 */
function graphWithEdge(edge: Record<string, unknown>): GraphT {
  return {
    version: '1',
    default_seed: 42,
    nodes: [
      { id: 'decision_1', kind: 'decision', label: 'Which option?' },
      { id: 'opt_a', kind: 'option', label: 'Option A', data: { interventions: { fac_driver: 1 } } },
      { id: 'opt_b', kind: 'option', label: 'Option B', data: { interventions: { fac_driver: 2 } } },
      {
        id: 'fac_driver', kind: 'factor', label: 'Driver', category: 'controllable' as any,
        data: { value: 0.5, extractionType: 'explicit', factor_type: 'other', uncertainty_drivers: ['unknown'] },
      },
      { id: 'out_result', kind: 'outcome', label: 'Result' },
      { id: 'goal_1', kind: 'goal', label: 'Win' },
    ],
    edges: [
      { from: 'decision_1', to: 'opt_a', strength_mean: 1, belief_exists: 1 },
      { from: 'decision_1', to: 'opt_b', strength_mean: 1, belief_exists: 1 },
      { from: 'opt_a', to: 'fac_driver', strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: 'positive' },
      { from: 'opt_b', to: 'fac_driver', strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: 'positive' },
      { from: 'out_result', to: 'goal_1', strength_mean: 0.9, belief_exists: 1, effect_direction: 'positive' },
      edge as any,
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
  } as GraphT;
}

function underTest(graph: GraphT) {
  const e = (graph.edges as any[]).find((x) => x.from === 'fac_driver' && x.to === 'out_result');
  expect(e, 'the edge under test must exist — a missing edge would make every assertion below vacuous').toBeDefined();
  return e as any;
}

/**
 * PIN THE PRECONDITION IN-TEST (CLAUDE.md trap 13b). A reconciliation test that
 * silently stops feeding a DISAGREEING edge would go on passing while
 * discriminating nothing. Every case asserts the input actually disagrees
 * before the rule is allowed to run.
 */
function assertInputDisagrees(edge: Record<string, unknown>) {
  const mean = edge.strength_mean as number;
  const dir = edge.effect_direction as string;
  expect(typeof mean, 'precondition: the case must supply a numeric mean').toBe('number');
  expect(mean, 'precondition: a zero mean carries no polarity and would make this case vacuous').not.toBe(0);
  expect(
    mean > 0,
    `precondition: this case must actually DISAGREE (mean ${mean} vs direction "${dir}"), or the rule under test never fires`,
  ).not.toBe(dir === 'positive');
}

describe('edge polarity Q_A: a magnitude that carries its own sign is authoritative over the label', () => {

  describe('the P0 — a correctly-signed NEGATIVE mean with a wrong "positive" label', () => {
    it('corrects the LABEL and leaves the engine-visible mean bit-identical', () => {
      const input = { from: 'fac_driver', to: 'out_result', strength_mean: -0.53, strength_std: 0.15, belief_exists: 0.8, effect_direction: 'positive' };
      assertInputDisagrees(input);

      const graph = graphWithEdge({ ...input });
      const result = reconcileStructuralTruth(graph);
      const edge = underTest(graph);

      expect(edge.strength_mean, 'the mean is the ONLY field ISL reads — it must survive untouched').toBe(-0.53);
      expect(edge.effect_direction, 'the label is a projection of the sign, so it is the field that moves').toBe('negative');

      const mutation = result.mutations.find(
        (m) => m.code === 'DIRECTION_CORRECTED' && m.edge_id === 'fac_driver::out_result',
      );
      expect(mutation, 'the relabel must be RECORDED, not silent').toBeDefined();
      expect(mutation!.field).toBe('effect_direction');
      expect(mutation!.before).toBe('positive');
      expect(mutation!.after).toBe('negative');
    });

    it('records NO strength_mean mutation for this class — the coefficient was not corrected', () => {
      const input = { from: 'fac_driver', to: 'out_result', strength_mean: -0.53, strength_std: 0.15, belief_exists: 0.8, effect_direction: 'positive' };
      assertInputDisagrees(input);

      const result = reconcileStructuralTruth(graphWithEdge({ ...input }));

      expect(
        result.mutations.filter((m) => m.edge_id === 'fac_driver::out_result' && m.field === 'strength_mean'),
        'claiming a coefficient correction here would be a FALSE disclosure — nothing about the coefficient changed',
      ).toHaveLength(0);
    });
  });

  describe('THE TWIN — Q_B is unchanged: an unsigned magnitude still takes its sign from the label', () => {
    it('keeps direction negative and moves the SIGN onto the magnitude', () => {
      const input = { from: 'fac_driver', to: 'out_result', strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.8, effect_direction: 'negative' };
      assertInputDisagrees(input);

      const graph = graphWithEdge({ ...input });
      const result = reconcileStructuralTruth(graph);
      const edge = underTest(graph);

      expect(edge.effect_direction, 'a positive magnitude is ambiguous, so the label survives as the only signal').toBe('negative');
      expect(edge.strength_mean, 'and the label informs the mean, exactly as before').toBe(-0.7);

      const mutation = result.mutations.find(
        (m) => m.code === 'SIGN_CORRECTED' && m.edge_id === 'fac_driver::out_result',
      );
      expect(mutation, 'Q_B keeps its existing code and record shape').toBeDefined();
      expect(mutation!.field).toBe('strength_mean');
      expect(mutation!.before).toBe(0.7);
      expect(mutation!.after).toBe(-0.7);
    });
  });

  describe('invariants over the whole disagreement space, by class', () => {
    const signedNegativeMeans = [-0.01, -0.05, -0.2, -0.53, -0.7, -0.99, -1];

    it.each(signedNegativeMeans)(
      'Q_A mean=%s: the magnitude is preserved EXACTLY and the label projects its sign',
      (mean) => {
        const input = { from: 'fac_driver', to: 'out_result', strength_mean: mean, strength_std: 0.15, belief_exists: 0.8, effect_direction: 'positive' };
        assertInputDisagrees(input);

        const graph = graphWithEdge({ ...input });
        reconcileStructuralTruth(graph);
        const edge = underTest(graph);

        // Written against the SPEC, not the failure mode (trap 13d).
        expect(edge.strength_mean, 'exact preservation, not just magnitude').toBe(mean);
        expect(edge.effect_direction).toBe('negative');
        expect(edge.strength_mean > 0, 'postcondition: the label agrees with the sign').toBe(
          edge.effect_direction === 'positive',
        );
      },
    );

    const unsignedMagnitudes = [0.01, 0.05, 0.2, 0.53, 0.7, 0.99, 1];

    it.each(unsignedMagnitudes)(
      'Q_B mean=%s: the label is preserved and the magnitude takes its sign',
      (mean) => {
        const input = { from: 'fac_driver', to: 'out_result', strength_mean: mean, strength_std: 0.15, belief_exists: 0.8, effect_direction: 'negative' };
        assertInputDisagrees(input);

        const graph = graphWithEdge({ ...input });
        reconcileStructuralTruth(graph);
        const edge = underTest(graph);

        expect(edge.effect_direction, 'the label is the only signal here, so it survives').toBe('negative');
        expect(Math.abs(edge.strength_mean), 'the magnitude is preserved').toBeCloseTo(Math.abs(mean), 10);
        expect(edge.strength_mean > 0, 'postcondition: the label agrees with the sign').toBe(
          edge.effect_direction === 'positive',
        );
      },
    );

    it('the two classes are DISJOINT — no input is reconciled by both predicates', () => {
      for (const mean of [...signedNegativeMeans, ...unsignedMagnitudes]) {
        const direction = mean > 0 ? 'negative' : 'positive';
        const result = reconcileStructuralTruth(
          graphWithEdge({ from: 'fac_driver', to: 'out_result', strength_mean: mean, strength_std: 0.15, belief_exists: 0.8, effect_direction: direction }),
        );
        const forEdge = result.mutations.filter((m) => m.edge_id === 'fac_driver::out_result');
        const codes = forEdge.map((m) => m.code).filter((c) => c === 'SIGN_CORRECTED' || c === 'DIRECTION_CORRECTED');
        expect(codes, `mean=${mean} must be reconciled exactly once, by exactly one predicate`).toHaveLength(1);
        expect(codes[0]).toBe(mean < 0 ? 'DIRECTION_CORRECTED' : 'SIGN_CORRECTED');
      }
    });
  });

  describe('controls — cases the rule must NOT touch', () => {
    it('an agreeing NEGATIVE edge is left exactly as authored', () => {
      const graph = graphWithEdge({ from: 'fac_driver', to: 'out_result', strength_mean: -0.35, strength_std: 0.15, belief_exists: 0.8, effect_direction: 'negative' });
      const result = reconcileStructuralTruth(graph);
      const edge = underTest(graph);

      expect(edge.strength_mean).toBe(-0.35);
      expect(edge.effect_direction).toBe('negative');
      expect(
        result.mutations.filter((m) => m.edge_id === 'fac_driver::out_result' && (m.code === 'SIGN_CORRECTED' || m.code === 'DIRECTION_CORRECTED')),
      ).toHaveLength(0);
    });

    it('an agreeing POSITIVE edge is left exactly as authored', () => {
      const graph = graphWithEdge({ from: 'fac_driver', to: 'out_result', strength_mean: 0.65, strength_std: 0.15, belief_exists: 0.8, effect_direction: 'positive' });
      const result = reconcileStructuralTruth(graph);
      const edge = underTest(graph);

      expect(edge.strength_mean).toBe(0.65);
      expect(edge.effect_direction).toBe('positive');
      expect(
        result.mutations.filter((m) => m.edge_id === 'fac_driver::out_result' && (m.code === 'SIGN_CORRECTED' || m.code === 'DIRECTION_CORRECTED')),
      ).toHaveLength(0);
    });

    it('a zero magnitude carries no polarity and is left alone in BOTH classes', () => {
      for (const direction of ['positive', 'negative'] as const) {
        const graph = graphWithEdge({ from: 'fac_driver', to: 'out_result', strength_mean: 0, strength_std: 0.15, belief_exists: 0.8, effect_direction: direction });
        const result = reconcileStructuralTruth(graph);
        const edge = underTest(graph);

        expect(edge.strength_mean).toBe(0);
        expect(edge.effect_direction, 'a zero mean cannot project a sign, so the label stands').toBe(direction);
        expect(
          result.mutations.filter((m) => m.edge_id === 'fac_driver::out_result' && (m.code === 'SIGN_CORRECTED' || m.code === 'DIRECTION_CORRECTED')),
        ).toHaveLength(0);
      }
    });

    it('an edge with NO label is left alone — there is nothing to reconcile', () => {
      const graph = graphWithEdge({ from: 'fac_driver', to: 'out_result', strength_mean: -0.42, strength_std: 0.15, belief_exists: 0.8 });
      const result = reconcileStructuralTruth(graph);
      const edge = underTest(graph);

      expect(edge.strength_mean).toBe(-0.42);
      expect(edge.effect_direction).toBeUndefined();
      expect(
        result.mutations.filter((m) => m.edge_id === 'fac_driver::out_result' && (m.code === 'SIGN_CORRECTED' || m.code === 'DIRECTION_CORRECTED')),
      ).toHaveLength(0);
    });
  });

  /**
   * ⚠⚠ THE STAGE 4 INVERTER, AND WHY THIS RULE IS WHAT KEEPS IT UNREACHABLE.
   *
   * `fixSignMismatch` (`cee/unified-pipeline/stages/repair/deterministic-sweep.ts:158-172`)
   * is FULLY SYMMETRIC, unlike the two wire-boundary guards:
   *
   *     if ((isNegativeDirection && isMeanPositive) || (!isNegativeDirection && isMeanNegative))
   *         edge.strength_mean = -edge.strength_mean;
   *
   * That second clause IS the Q_A class, and it flips a correctly-signed
   * negative mean to positive — the same P0 this rule closes, sitting two
   * stages downstream. It is gated on a `SIGN_MISMATCH` violation existing,
   * and STRP runs first, so today it never fires on a Q_A edge.
   *
   * That makes THIS rule's postcondition load-bearing for a defect in ANOTHER
   * module. The test below pins it explicitly, so that a change here which
   * stopped resolving Q_A would fail with a message naming Stage 4, rather
   * than silently arming an inverter nothing else guards.
   *
   * NOT FIXED IN THIS LANE, deliberately (scope-expansion rule): Stage 4 is a
   * separate module on a separate path, and making it class-aware is its own
   * change with its own corpus. It is reported, not absorbed.
   */
  describe('the Stage 4 sign-mismatch inverter is left with nothing to invert', () => {
    it.each([-0.01, -0.53, -1, 0.01, 0.53, 1])(
      'mean=%s exits STRP with the two fields in agreement — the precondition Stage 4 needs to stay silent',
      (mean) => {
        const direction = mean > 0 ? 'negative' : 'positive';
        const graph = graphWithEdge({ from: 'fac_driver', to: 'out_result', strength_mean: mean, strength_std: 0.15, belief_exists: 0.8, effect_direction: direction });

        reconcileStructuralTruth(graph);

        // Re-derived here in the SAME shape as fixSignMismatch's own predicate,
        // so this fails if that predicate would fire.
        for (const e of graph.edges as any[]) {
          if (!e.effect_direction || e.strength_mean === undefined) continue;
          const isNegativeDirection = e.effect_direction === 'negative';
          const isMeanPositive = e.strength_mean > 0;
          const isMeanNegative = e.strength_mean < 0;
          expect(
            (isNegativeDirection && isMeanPositive) || (!isNegativeDirection && isMeanNegative),
            `edge ${e.from}->${e.to} (mean=${e.strength_mean}, direction=${e.effect_direction}) would trip fixSignMismatch at Stage 4, which flips the mean symmetrically`,
          ).toBe(false);
        }
      },
    );
  });

  describe('idempotence — the module\'s own declared invariant, on both classes', () => {
    it.each([
      ['Q_A', -0.53, 'positive' as const],
      ['Q_B', 0.7, 'negative' as const],
    ])('%s is a fixed point after one pass', (_label, mean, direction) => {
      const graph = graphWithEdge({ from: 'fac_driver', to: 'out_result', strength_mean: mean, strength_std: 0.15, belief_exists: 0.8, effect_direction: direction });

      reconcileStructuralTruth(graph);
      const once = { mean: underTest(graph).strength_mean, direction: underTest(graph).effect_direction };

      const second = reconcileStructuralTruth(graph);
      const twice = { mean: underTest(graph).strength_mean, direction: underTest(graph).effect_direction };

      expect(twice).toEqual(once);
      expect(
        second.mutations.filter((m) => m.edge_id === 'fac_driver::out_result' && (m.code === 'SIGN_CORRECTED' || m.code === 'DIRECTION_CORRECTED')),
        'a second pass has nothing left to reconcile',
      ).toHaveLength(0);
    });
  });
});
