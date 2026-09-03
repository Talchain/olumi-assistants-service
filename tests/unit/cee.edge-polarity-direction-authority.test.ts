/**
 * EDGE POLARITY — WHICH FIELD IS AUTHORITATIVE WHEN `strength_mean` AND
 * `effect_direction` DISAGREE?
 *
 * Three passes in CEE answer that one question, and until this change they gave
 * TWO different answers:
 *
 *   1. STRP Rule 4  `signReconciliationRule` (validators/structural-reconciliation.ts)
 *        — ran FIRST (Stage 2 Normalise) and answered "the MAGNITUDE",
 *          overwriting `effect_direction` from `sign(strength_mean)`.
 *   2. `fixSignMismatch` (unified-pipeline/stages/repair/deterministic-sweep.ts:147)
 *        — answers "the DIRECTION", negating `strength_mean` to match.
 *   3. `transformEdgeToV3` (cee/transforms/schema-v3.ts:830)
 *        — answers "the DIRECTION", `mean = -|mean|` when direction is negative.
 *
 * Because STRP runs first it ERASED the disagreement, so (2) and (3) never saw
 * it. A drafting model that emits an UNSIGNED magnitude plus a direction — the
 * natural shape, and the one the prompt's own PARAMETER_GUIDANCE grades with
 * absolute-value bars (`strong |mean|>0.6`) — had every stated negative
 * relationship silently turned POSITIVE.
 *
 * Measured in the estate's own corpora (465 JSON/JSONL files, 5,092 edge objects
 * carrying both a numeric mean and an `effect_direction`): 25 disagreements,
 * ALL 25 of the class `mean > 0 & direction = "negative"`, zero of the reverse.
 * 19 of them are in ONE governed evaluator baseline of the real draft-graph task
 * (`tools/graph-evaluator/governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json`),
 * and they are semantically correct negatives — e.g.
 * "Currency and Macro Risk" → "Revenue Growth Achieved".
 *
 * The direction is authoritative. Derived, not asserted:
 *   (a) the draft grammar makes `effect_direction` REQUIRED with a CLOSED enum
 *       (`cee/draft/anthropic-graph-schema.ts:395,409`); `strength.mean` is an
 *       unconstrained number.
 *   (b) the live prompt grades strength as a MAGNITUDE (`|mean|`), so its sign
 *       carries no guaranteed meaning.
 *   (c) two of the three authorities already honour the direction; STRP was the
 *       outlier, 1 of 3.
 *   (d) direction-authoritative is LOSS-FREE (`mean := sign(direction)·|mean|`
 *       keeps both facts). Sign-authoritative DESTROYS the polarity. Between two
 *       remedies for one disagreement, the one that discards information is wrong.
 *
 * These tests are written against that SPEC — "polarity is preserved, magnitude
 * is preserved" — not against the failure mode in hand, and every case has its
 * opposite-direction twin so a fix in one direction cannot pass by breaking the
 * other.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reconcileStructuralTruth } from '../../src/validators/structural-reconciliation.js';
import { transformEdgeToV3 } from '../../src/cee/transforms/schema-v3.js';
import { normaliseRiskCoefficients } from '../../src/cee/transforms/risk-normalisation.js';
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

describe('edge polarity: `effect_direction` is authoritative over `sign(strength_mean)`', () => {
  // ── The measured class: unsigned magnitude + stated negative direction ──────
  describe('a stated NEGATIVE direction survives reconciliation', () => {
    it('keeps direction negative and moves the SIGN onto the magnitude', () => {
      const graph = graphWithEdge({
        from: 'fac_driver', to: 'out_result',
        strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.85,
        effect_direction: 'negative',
      });

      const result = reconcileStructuralTruth(graph);
      const edge = underTest(graph);

      expect(edge.effect_direction).toBe('negative');
      expect(edge.strength_mean).toBe(-0.7);

      const mutation = result.mutations.find(
        (m) => m.code === 'SIGN_CORRECTED' && m.edge_id === 'fac_driver::out_result',
      );
      expect(mutation, 'the reconciliation must be RECORDED, not silent').toBeDefined();
      expect(mutation!.field).toBe('strength_mean');
      expect(mutation!.before).toBe(0.7);
      expect(mutation!.after).toBe(-0.7);
      expect(mutation!.severity).toBe('warn');
    });

    // OPPOSITE-DIRECTION TWIN. A fix that only rescued the measured class would
    // pass the case above and fail here.
    it('keeps direction positive and moves the SIGN onto the magnitude', () => {
      const graph = graphWithEdge({
        from: 'fac_driver', to: 'out_result',
        strength_mean: -0.5, strength_std: 0.12, belief_exists: 0.8,
        effect_direction: 'positive',
      });

      const result = reconcileStructuralTruth(graph);
      const edge = underTest(graph);

      expect(edge.effect_direction).toBe('positive');
      expect(edge.strength_mean).toBe(0.5);

      const mutation = result.mutations.find(
        (m) => m.code === 'SIGN_CORRECTED' && m.edge_id === 'fac_driver::out_result',
      );
      expect(mutation).toBeDefined();
      expect(mutation!.field).toBe('strength_mean');
      expect(mutation!.before).toBe(-0.5);
      expect(mutation!.after).toBe(0.5);
    });
  });

  // ── The rule must NOT start rejecting legitimate relationships ─────────────
  // These two are GREEN before the change and must stay GREEN after it. They
  // are the controls that a one-directional fix breaks.
  describe('agreeing edges are untouched (both polarities)', () => {
    it('a legitimate POSITIVE relationship is left exactly as authored', () => {
      const graph = graphWithEdge({
        from: 'fac_driver', to: 'out_result',
        strength_mean: 0.65, strength_std: 0.2, belief_exists: 0.8,
        effect_direction: 'positive',
      });

      const result = reconcileStructuralTruth(graph);
      const edge = underTest(graph);

      expect(edge.effect_direction).toBe('positive');
      expect(edge.strength_mean).toBe(0.65);
      expect(
        result.mutations.filter((m) => m.code === 'SIGN_CORRECTED' && m.edge_id === 'fac_driver::out_result'),
      ).toHaveLength(0);
    });

    it('a legitimate NEGATIVE relationship is left exactly as authored', () => {
      const graph = graphWithEdge({
        from: 'fac_driver', to: 'out_result',
        strength_mean: -0.35, strength_std: 0.18, belief_exists: 0.75,
        effect_direction: 'negative',
      });

      const result = reconcileStructuralTruth(graph);
      const edge = underTest(graph);

      expect(edge.effect_direction).toBe('negative');
      expect(edge.strength_mean).toBe(-0.35);
      expect(
        result.mutations.filter((m) => m.code === 'SIGN_CORRECTED' && m.edge_id === 'fac_driver::out_result'),
      ).toHaveLength(0);
    });
  });

  // ── Written against the SPEC, not the failure mode ────────────────────────
  describe('invariants over the whole disagreement space', () => {
    const cases: Array<{ mean: number; direction: 'positive' | 'negative' }> = [];
    for (const mean of [0.05, 0.35, 0.7, 1, -0.05, -0.35, -0.7, -1]) {
      for (const direction of ['positive', 'negative'] as const) {
        cases.push({ mean, direction });
      }
    }

    it.each(cases)('|mean| is preserved and polarity is the stated one (mean=$mean, direction=$direction)', ({ mean, direction }) => {
      const graph = graphWithEdge({
        from: 'fac_driver', to: 'out_result',
        strength_mean: mean, strength_std: 0.15, belief_exists: 0.8,
        effect_direction: direction,
      });

      reconcileStructuralTruth(graph);
      const edge = underTest(graph);

      // Polarity: whatever the producer STATED, verbatim.
      expect(edge.effect_direction).toBe(direction);
      // Magnitude: never destroyed, only signed.
      expect(Math.abs(edge.strength_mean)).toBeCloseTo(Math.abs(mean), 10);
      // The two fields agree on exit — the property every downstream pass assumes.
      expect(edge.strength_mean > 0).toBe(direction === 'positive');
    });

    it('is idempotent — the module\'s own declared invariant', () => {
      const graph = graphWithEdge({
        from: 'fac_driver', to: 'out_result',
        strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.85,
        effect_direction: 'negative',
      });

      reconcileStructuralTruth(graph);
      const once = { ...underTest(graph) };
      const second = reconcileStructuralTruth(graph);
      const twice = underTest(graph);

      expect(twice.strength_mean).toBe(once.strength_mean);
      expect(twice.effect_direction).toBe(once.effect_direction);
      expect(
        second.mutations.filter((m) => m.code === 'SIGN_CORRECTED' && m.edge_id === 'fac_driver::out_result'),
      ).toHaveLength(0);
    });

    it('leaves a zero magnitude alone — it carries no polarity to reconcile', () => {
      const graph = graphWithEdge({
        from: 'fac_driver', to: 'out_result',
        strength_mean: 0, strength_std: 0.01, belief_exists: 1,
        effect_direction: 'positive',
      });

      const result = reconcileStructuralTruth(graph);
      const edge = underTest(graph);

      expect(edge.strength_mean).toBe(0);
      expect(edge.effect_direction).toBe('positive');
      expect(
        result.mutations.filter((m) => m.code === 'SIGN_CORRECTED' && m.edge_id === 'fac_driver::out_result'),
      ).toHaveLength(0);
    });
  });

  // ── What the user actually sees, through the REAL stage order ────────────
  describe('the polarity a user sees is the polarity the producer stated', () => {
    const disagreements: Array<{ mean: number; direction: 'positive' | 'negative' }> = [
      { mean: 0.7, direction: 'negative' },
      { mean: 0.35, direction: 'negative' },
      { mean: -0.5, direction: 'positive' },
      { mean: -0.2, direction: 'positive' },
    ];

    it.each(disagreements)('mean=$mean direction=$direction survives Stage 2 → Stage 6 intact', ({ mean, direction }) => {
      const graph = graphWithEdge({
        from: 'fac_driver', to: 'out_result',
        strength_mean: mean, strength_std: 0.15, belief_exists: 0.8,
        effect_direction: direction,
      });

      reconcileStructuralTruth(graph);                       // Stage 2 Normalise
      const v3 = transformEdgeToV3(underTest(graph) as any, 0, graph.nodes as any).edge; // Stage 6 Boundary

      expect(v3.effect_direction).toBe(direction);
      expect(v3.strength.mean > 0).toBe(direction === 'positive');
      expect(Math.abs(v3.strength.mean)).toBeCloseTo(Math.abs(mean), 10);
    });

    /**
     * ⚠ PINNED ASYMMETRY, NOT A GAP TO TIDY. `transformEdgeToV3`
     * (`cee/transforms/schema-v3.ts:829-830`) honours a stated NEGATIVE
     * direction against a positive magnitude, but has NO limb for the mirror
     * case: a stated POSITIVE direction against a negative magnitude falls
     * through to `deriveEffectDirection(mean)` and comes out NEGATIVE.
     *
     * That does not reach a user, because STRP Rule 4 now settles every
     * disagreement before the boundary ever sees one. It is pinned here so
     * that a later lane cannot delete Rule 4 on the belief that "the boundary
     * already handles this" — it handles one of the two directions.
     */
    it('the boundary transform ALONE is only half direction-authoritative', () => {
      const statedNegative = transformEdgeToV3(
        { from: 'fac_driver', to: 'out_result', strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.8, effect_direction: 'negative' } as any,
        0, [] as any,
      ).edge;
      expect(statedNegative.effect_direction, 'a stated negative IS honoured').toBe('negative');

      const statedPositive = transformEdgeToV3(
        { from: 'fac_driver', to: 'out_result', strength_mean: -0.5, strength_std: 0.15, belief_exists: 0.8, effect_direction: 'positive' } as any,
        0, [] as any,
      ).edge;
      expect(statedPositive.effect_direction, 'a stated positive is NOT — the sign wins').toBe('negative');
    });
  });

  // ── THE OPPOSITE-DIRECTION HARM THIS CHANGE COULD HAVE CAUSED ─────────────
  // Making the direction authoritative means any pass that negates a magnitude
  // without also stating the direction gets silently REVERTED by the next STRP.
  // `normaliseRiskCoefficients` is the one in-tree producer that does this, it
  // runs immediately after Rule 4 in Stage 2, and Late STRP (Stage 4 substep 6)
  // sees the result. Without the paired write this case is the regression.
  describe('risk-coefficient normalisation survives the Late-STRP round trip', () => {
    function riskGraph(): GraphT {
      return {
        version: '1',
        default_seed: 42,
        nodes: [
          { id: 'decision_1', kind: 'decision', label: 'Which option?' },
          { id: 'risk_runway', kind: 'risk', label: 'Runway Depletion Risk' },
          { id: 'goal_1', kind: 'goal', label: 'Reach target' },
        ],
        edges: [
          // The model's own output: a risk pushing the goal the WRONG way, and
          // the two fields AGREE, so Rule 4 has nothing to say about it. Only
          // `normaliseRiskCoefficients` knows this is semantically wrong.
          { from: 'risk_runway', to: 'goal_1', strength_mean: 0.6, strength_std: 0.15, belief_exists: 0.9, effect_direction: 'positive' },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
      } as unknown as GraphT;
    }

    it('a risk→goal edge stays negative after normalisation AND a second STRP pass', () => {
      const graph = riskGraph();

      // Stage 2, in the real order: STRP Rule 4, then risk normalisation.
      reconcileStructuralTruth(graph);
      const normalised = normaliseRiskCoefficients(graph.nodes as any, graph.edges as any);
      (graph as any).edges = normalised.edges;

      expect(normalised.corrections, 'the correction must actually fire, or this case proves nothing').toHaveLength(1);

      const afterStage2 = (graph.edges as any[]).find((e) => e.from === 'risk_runway' && e.to === 'goal_1');
      expect(afterStage2.strength_mean).toBe(-0.6);
      expect(afterStage2.effect_direction).toBe('negative');

      // Stage 4 substep 6: Late STRP runs the same rule again.
      const late = reconcileStructuralTruth(graph);
      const afterLate = (graph.edges as any[]).find((e) => e.from === 'risk_runway' && e.to === 'goal_1');

      expect(afterLate.strength_mean, 'Late STRP must not undo the risk correction').toBe(-0.6);
      expect(afterLate.effect_direction).toBe('negative');
      expect(
        late.mutations.filter((m) => m.code === 'SIGN_CORRECTED' && m.edge_id === 'risk_runway::goal_1'),
      ).toHaveLength(0);
    });

    it('a risk→goal edge the model already stated as negative is left alone', () => {
      const graph = riskGraph();
      const edge = (graph.edges as any[])[0];
      edge.strength_mean = -0.6;
      edge.effect_direction = 'negative';

      reconcileStructuralTruth(graph);
      const normalised = normaliseRiskCoefficients(graph.nodes as any, graph.edges as any);

      expect(normalised.corrections, 'nothing to correct — the model got it right').toHaveLength(0);
      const after = (normalised.edges as any[]).find((e) => e.from === 'risk_runway' && e.to === 'goal_1');
      expect(after.strength_mean).toBe(-0.6);
      expect(after.effect_direction).toBe('negative');
    });
  });

  // ── Corpus from OUTSIDE this author's head ────────────────────────────────
  // A governed evaluator baseline of the real draft-graph task on
  // claude-sonnet-4-6. These edges were authored by the drafting model, not by
  // me, and their labels make the correct polarity plain.
  describe('governed evaluator baseline replay (real drafting-model output)', () => {
    const BASELINE = resolve(
      __dirname,
      '../../tools/graph-evaluator/governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json',
    );

    type CorpusEdge = { from: string; to: string; strength_mean?: number; effect_direction?: string };

    function statedNegativesWithPositiveMagnitude(): Array<{ caseIndex: number; edge: CorpusEdge; nodes: any[] }> {
      const doc = JSON.parse(readFileSync(BASELINE, 'utf-8'));
      const out: Array<{ caseIndex: number; edge: CorpusEdge; nodes: any[] }> = [];
      doc.run.cases.forEach((c: any, i: number) => {
        const g = c?.graph;
        if (!g || !Array.isArray(g.edges)) return;
        for (const e of g.edges) {
          if (e?.effect_direction === 'negative' && typeof e.strength_mean === 'number' && e.strength_mean > 0) {
            out.push({ caseIndex: i, edge: e, nodes: g.nodes ?? [] });
          }
        }
      });
      return out;
    }

    it('the corpus actually contains the class under test — otherwise every assertion below is vacuous', () => {
      // Positive control (CLAUDE.md trap 13). The count is a FLOOR pinned to
      // this committed artefact; it REDs if the fixture is edited away.
      expect(statedNegativesWithPositiveMagnitude().length).toBeGreaterThanOrEqual(19);
    });

    it('every stated-negative relationship in the corpus survives STRP as negative', () => {
      const corpus = statedNegativesWithPositiveMagnitude();
      const survived: string[] = [];
      const flipped: string[] = [];

      for (const { edge, nodes } of corpus) {
        const label = (id: string) => nodes.find((n: any) => n?.id === id)?.label ?? id;
        const graph = {
          version: '1',
          default_seed: 42,
          nodes,
          edges: [{ ...edge }],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
        } as unknown as GraphT;

        reconcileStructuralTruth(graph);
        const after = (graph.edges as any[])[0];
        const name = `${label(edge.from)} → ${label(edge.to)}`;
        (after.effect_direction === 'negative' ? survived : flipped).push(name);
      }

      expect(flipped, `these stated-negative relationships were silently turned positive: ${flipped.join('; ')}`).toEqual([]);
      expect(survived.length).toBe(corpus.length);
    });
  });
});
