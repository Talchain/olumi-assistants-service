/**
 * Structural Truth Reconciliation Pass (STRP) Tests
 *
 * Tests all 4 reconciliation rules and integration scenarios.
 */

import { describe, it, expect } from 'vitest';
import {
  reconcileStructuralTruth,
  normaliseConstraintTargets,
  type STRPResult,
} from '../../src/validators/structural-reconciliation.js';
import { validateGraph } from '../../src/validators/graph-validator.js';
import type { GraphT } from '../../src/schemas/graph.js';

// =============================================================================
// Helpers
// =============================================================================

function createValidGraph(): GraphT {
  return {
    version: '1',
    default_seed: 42,
    nodes: [
      { id: 'decision_1', kind: 'decision', label: 'Which option?' },
      { id: 'opt_a', kind: 'option', label: 'Option A', data: { interventions: { fac_price: 100 } } },
      { id: 'opt_b', kind: 'option', label: 'Option B', data: { interventions: { fac_price: 200 } } },
      {
        id: 'fac_price',
        kind: 'factor',
        label: 'Price',
        data: {
          value: 150,
          extractionType: 'explicit',
          factor_type: 'price',
          uncertainty_drivers: ['market volatility'],
        },
      },
      { id: 'outcome_1', kind: 'outcome', label: 'Revenue' },
      { id: 'goal_1', kind: 'goal', label: 'Maximize profit' },
    ],
    edges: [
      { from: 'decision_1', to: 'opt_a', strength_mean: 1, belief_exists: 1 },
      { from: 'decision_1', to: 'opt_b', strength_mean: 1, belief_exists: 1 },
      { from: 'opt_a', to: 'fac_price', strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: 'positive' },
      { from: 'opt_b', to: 'fac_price', strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: 'positive' },
      { from: 'fac_price', to: 'outcome_1', strength_mean: 0.8, belief_exists: 0.9 },
      { from: 'outcome_1', to: 'goal_1', strength_mean: 0.9, belief_exists: 1 },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
  };
}

// =============================================================================
// Rule 1: Category Override
// =============================================================================

describe('reconcileStructuralTruth', () => {
  describe('Rule 1: Category Override', () => {
    it('overrides observable→controllable when factor has option edges', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      factor.category = 'observable' as any;

      const result = reconcileStructuralTruth(graph);

      expect(factor.category).toBe('controllable');
      const mutation = result.mutations.find(m => m.code === 'CATEGORY_OVERRIDE');
      expect(mutation).toBeDefined();
      expect(mutation!.before).toBe('observable');
      expect(mutation!.after).toBe('controllable');
      expect(mutation!.node_id).toBe('fac_price');
      expect(mutation!.severity).toBe('info');
    });

    it('overrides controllable→observable and strips factor_type/uncertainty_drivers', () => {
      const graph = createValidGraph();
      graph.nodes.push({
        id: 'fac_obs',
        kind: 'factor',
        label: 'Observable Factor',
        category: 'controllable' as any,
        data: { value: 42, extractionType: 'explicit', factor_type: 'cost', uncertainty_drivers: ['supply'] },
      });
      graph.edges.push(
        { from: 'fac_price', to: 'fac_obs', strength_mean: 0.5, belief_exists: 0.8 },
        { from: 'fac_obs', to: 'outcome_1', strength_mean: 0.6, belief_exists: 0.9 },
      );

      reconcileStructuralTruth(graph);

      const factor = graph.nodes.find(n => n.id === 'fac_obs')!;
      expect(factor.category).toBe('observable');
      expect((factor.data as any).factor_type).toBeUndefined();
      expect((factor.data as any).uncertainty_drivers).toBeUndefined();
    });

    it('auto-fills factor_type and uncertainty_drivers when reclassifying to controllable', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      factor.category = 'external' as any;
      delete (factor.data as any).factor_type;
      delete (factor.data as any).uncertainty_drivers;

      reconcileStructuralTruth(graph);

      expect(factor.category).toBe('controllable');
      expect((factor.data as any).factor_type).toBe('other');
      expect((factor.data as any).uncertainty_drivers).toEqual(['Estimation uncertainty']);
    });

    it('does not fire when declared category matches inferred', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      factor.category = 'controllable' as any;

      const result = reconcileStructuralTruth(graph);

      expect(result.mutations.filter(m => m.code === 'CATEGORY_OVERRIDE')).toHaveLength(0);
      expect((factor.data as any).factor_type).toBe('price'); // untouched
    });

    it('does not fire when category is absent', () => {
      const graph = createValidGraph();
      // Default createValidGraph has no category fields
      const result = reconcileStructuralTruth(graph);
      expect(result.mutations.filter(m => m.code === 'CATEGORY_OVERRIDE')).toHaveLength(0);
    });

    // =========================================================================
    // Data-completeness pass (CONTROLLABLE_DATA_FILLED) — requires fillControllableData
    // =========================================================================

    it('fills factor_type on controllable factor when fillControllableData is true', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      delete (factor.data as any).factor_type;

      const result = reconcileStructuralTruth(graph, { fillControllableData: true });

      expect((factor.data as any).factor_type).toBe('other');
      const mutation = result.mutations.find(
        m => m.code === 'CONTROLLABLE_DATA_FILLED' && m.field === 'data.factor_type'
      );
      expect(mutation).toBeDefined();
      expect(mutation!.node_id).toBe('fac_price');
      expect(mutation!.before).toBeUndefined();
      expect(mutation!.after).toBe('other');
      expect(mutation!.severity).toBe('info');
    });

    it('fills uncertainty_drivers on controllable factor when fillControllableData is true', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      delete (factor.data as any).uncertainty_drivers;

      const result = reconcileStructuralTruth(graph, { fillControllableData: true });

      expect((factor.data as any).uncertainty_drivers).toEqual(['Estimation uncertainty']);
      const mutation = result.mutations.find(
        m => m.code === 'CONTROLLABLE_DATA_FILLED' && m.field === 'data.uncertainty_drivers'
      );
      expect(mutation).toBeDefined();
      expect(mutation!.node_id).toBe('fac_price');
      expect(mutation!.severity).toBe('info');
    });

    it('does not emit CONTROLLABLE_DATA_FILLED when both fields already present', () => {
      const graph = createValidGraph();
      const result = reconcileStructuralTruth(graph, { fillControllableData: true });
      expect(result.mutations.filter(m => m.code === 'CONTROLLABLE_DATA_FILLED')).toHaveLength(0);
    });

    it('fills data via override when reclassifying to controllable (Rule 5 is a no-op since override already filled)', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      factor.category = 'external' as any;
      delete (factor.data as any).factor_type;
      delete (factor.data as any).uncertainty_drivers;

      const result = reconcileStructuralTruth(graph, { fillControllableData: true });

      // Category override fires and fills data inline (lines 171-181)
      expect(result.mutations.some(m => m.code === 'CATEGORY_OVERRIDE')).toBe(true);
      expect((factor.data as any).factor_type).toBe('other');
      expect((factor.data as any).uncertainty_drivers).toEqual(['Estimation uncertainty']);
      // Rule 5 finds fields already present — no CONTROLLABLE_DATA_FILLED mutations
      expect(result.mutations.filter(m => m.code === 'CONTROLLABLE_DATA_FILLED')).toHaveLength(0);
    });

    it('does not fill factor_type on observable/external factors', () => {
      const graph = createValidGraph();
      graph.nodes.push({
        id: 'fac_obs',
        kind: 'factor',
        label: 'Observable Factor',
        data: { value: 42, extractionType: 'explicit' },
      });
      graph.edges.push(
        { from: 'fac_price', to: 'fac_obs', strength_mean: 0.5, belief_exists: 0.8 },
        { from: 'fac_obs', to: 'outcome_1', strength_mean: 0.6, belief_exists: 0.9 },
      );

      const result = reconcileStructuralTruth(graph, { fillControllableData: true });

      const obsFactor = graph.nodes.find(n => n.id === 'fac_obs')!;
      expect((obsFactor.data as any).factor_type).toBeUndefined();
      expect(
        result.mutations.filter(m => m.code === 'CONTROLLABLE_DATA_FILLED' && m.node_id === 'fac_obs')
      ).toHaveLength(0);
    });

    it('does NOT fill missing fields when fillControllableData is not set', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      delete (factor.data as any).factor_type;
      delete (factor.data as any).uncertainty_drivers;

      const result = reconcileStructuralTruth(graph);

      expect((factor.data as any).factor_type).toBeUndefined();
      expect((factor.data as any).uncertainty_drivers).toBeUndefined();
      expect(result.mutations.filter(m => m.code === 'CONTROLLABLE_DATA_FILLED')).toHaveLength(0);
    });
  });

  // =============================================================================
  // Rule 2: Enum Validation
  // =============================================================================

  describe('Rule 2: Enum Validation', () => {
    it('corrects invalid factor_type to "other"', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      (factor.data as any).factor_type = 'general'; // invalid

      const result = reconcileStructuralTruth(graph);

      expect((factor.data as any).factor_type).toBe('other');
      const mutation = result.mutations.find(m => m.field === 'data.factor_type');
      expect(mutation).toBeDefined();
      expect(mutation!.code).toBe('ENUM_VALUE_CORRECTED');
      expect(mutation!.before).toBe('general');
      expect(mutation!.after).toBe('other');
      expect(mutation!.severity).toBe('warn');
    });

    it('does not touch valid factor_type values', () => {
      const graph = createValidGraph();
      // fac_price already has factor_type: 'price' (valid)
      const result = reconcileStructuralTruth(graph);
      expect(result.mutations.filter(m => m.field === 'data.factor_type')).toHaveLength(0);
    });

    it('corrects invalid extractionType to "inferred"', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      (factor.data as any).extractionType = 'guessed'; // invalid

      const result = reconcileStructuralTruth(graph);

      expect((factor.data as any).extractionType).toBe('inferred');
      const mutation = result.mutations.find(m => m.field === 'data.extractionType');
      expect(mutation).toBeDefined();
      expect(mutation!.before).toBe('guessed');
      expect(mutation!.after).toBe('inferred');
    });

    it('invalid category is handled by Rule 1 (category override runs first)', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      factor.category = 'semi-controllable' as any; // invalid

      const result = reconcileStructuralTruth(graph);

      // Rule 1 runs first: sees "semi-controllable" !== "controllable" (inferred) → overrides
      // Rule 2 then sees a valid category and skips
      expect(factor.category).toBe('controllable');
      const overrideMutation = result.mutations.find(m => m.code === 'CATEGORY_OVERRIDE');
      expect(overrideMutation).toBeDefined();
      expect(overrideMutation!.before).toBe('semi-controllable');
      expect(overrideMutation!.after).toBe('controllable');
    });

    it('corrects invalid effect_direction to "positive"', () => {
      const graph = createValidGraph();
      graph.edges.push({
        from: 'fac_price', to: 'outcome_1',
        strength_mean: 0.5, effect_direction: 'up' as any,
      });

      const result = reconcileStructuralTruth(graph);

      const fixedEdge = graph.edges.find(e => e.effect_direction === 'positive' && e.from === 'fac_price' && e.to === 'outcome_1');
      expect(fixedEdge).toBeDefined();
      const mutation = result.mutations.find(m => m.field === 'effect_direction' && m.code === 'ENUM_VALUE_CORRECTED');
      expect(mutation).toBeDefined();
      expect(mutation!.before).toBe('up');
    });

    it('handles multiple enum violations in same graph', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      (factor.data as any).factor_type = 'banana';
      (factor.data as any).extractionType = 'magic';

      const result = reconcileStructuralTruth(graph);

      expect((factor.data as any).factor_type).toBe('other');
      expect((factor.data as any).extractionType).toBe('inferred');
      expect(result.mutations.filter(m => m.code === 'ENUM_VALUE_CORRECTED')).toHaveLength(2);
    });
  });

  // =============================================================================
  // Rule 3: Constraint Target (via reconcileStructuralTruth)
  // =============================================================================

  describe('Rule 3: Constraint Target', () => {
    it('remaps constraint with fuzzy match', () => {
      const graph = createValidGraph();
      const constraints = [{ node_id: 'fac_pric', constraint_id: 'c1', operator: '>=', value: 100 }];

      const result = reconcileStructuralTruth(graph, { goalConstraints: constraints as any });

      expect(result.goalConstraints).toHaveLength(1);
      expect(result.goalConstraints![0].node_id).toBe('fac_price');
      const mutation = result.mutations.find(m => m.code === 'CONSTRAINT_REMAPPED');
      expect(mutation).toBeDefined();
      expect(mutation!.before).toBe('fac_pric');
      expect(mutation!.after).toBe('fac_price');
    });

    it('drops constraint with no match', () => {
      const graph = createValidGraph();
      const constraints = [{ node_id: 'fac_totally_unknown', constraint_id: 'c1', operator: '>=', value: 100 }];

      const result = reconcileStructuralTruth(graph, { goalConstraints: constraints as any });

      expect(result.goalConstraints).toHaveLength(0);
      const mutation = result.mutations.find(m => m.code === 'CONSTRAINT_DROPPED');
      expect(mutation).toBeDefined();
    });

    it('is no-op when goalConstraints not provided', () => {
      const graph = createValidGraph();
      const result = reconcileStructuralTruth(graph);
      expect(result.goalConstraints).toBeUndefined();
      expect(result.mutations.filter(m => m.rule === 'constraint_target')).toHaveLength(0);
    });

    it('is no-op when goalConstraints is empty', () => {
      const graph = createValidGraph();
      const result = reconcileStructuralTruth(graph, { goalConstraints: [] });
      expect(result.goalConstraints).toHaveLength(0);
      expect(result.mutations.filter(m => m.rule === 'constraint_target')).toHaveLength(0);
    });
  });

  // =============================================================================
  // Rule 4: Sign Reconciliation
  // =============================================================================

  describe('Rule 4: Sign Reconciliation', () => {
    it('flips effect_direction when it contradicts strength_mean sign', () => {
      const graph = createValidGraph();
      // Add edge with negative strength but positive direction
      graph.edges.push({
        from: 'fac_price', to: 'outcome_1',
        strength_mean: -0.5, effect_direction: 'positive',
      });

      const result = reconcileStructuralTruth(graph);

      const fixedEdge = graph.edges.find(e => e.from === 'fac_price' && e.to === 'outcome_1' && e.strength_mean === -0.5);
      expect(fixedEdge!.effect_direction).toBe('negative');
      const mutation = result.mutations.find(m => m.code === 'SIGN_CORRECTED');
      expect(mutation).toBeDefined();
      expect(mutation!.before).toBe('positive');
      expect(mutation!.after).toBe('negative');
      expect(mutation!.severity).toBe('warn');
    });

    it('flips negative→positive when strength_mean is positive', () => {
      const graph = createValidGraph();
      graph.edges.push({
        from: 'fac_price', to: 'outcome_1',
        strength_mean: 0.7, effect_direction: 'negative',
      });

      const result = reconcileStructuralTruth(graph);

      const fixedEdge = graph.edges.find(e => e.from === 'fac_price' && e.to === 'outcome_1' && e.strength_mean === 0.7);
      expect(fixedEdge!.effect_direction).toBe('positive');
      const mutation = result.mutations.find(m => m.code === 'SIGN_CORRECTED');
      expect(mutation).toBeDefined();
    });

    it('does not fire when sign and direction agree', () => {
      const graph = createValidGraph();
      // All edges in createValidGraph have positive strength_mean and positive direction
      const result = reconcileStructuralTruth(graph);
      expect(result.mutations.filter(m => m.code === 'SIGN_CORRECTED')).toHaveLength(0);
    });

    it('does not fire when strength_mean is zero', () => {
      const graph = createValidGraph();
      graph.edges.push({
        from: 'fac_price', to: 'outcome_1',
        strength_mean: 0, effect_direction: 'positive',
      });

      const result = reconcileStructuralTruth(graph);
      expect(result.mutations.filter(m => m.code === 'SIGN_CORRECTED')).toHaveLength(0);
    });

    it('does not fire when effect_direction is absent', () => {
      const graph = createValidGraph();
      // fac_price→outcome_1 edge has no effect_direction
      const result = reconcileStructuralTruth(graph);
      expect(result.mutations.filter(m => m.code === 'SIGN_CORRECTED')).toHaveLength(0);
    });
  });

  // =============================================================================
  // Integration: Multiple rules in same pass
  // =============================================================================

  describe('Integration', () => {
    it('applies multiple rules in single pass', () => {
      const graph = createValidGraph();
      // Rule 1 trigger: wrong category
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      factor.category = 'external' as any;
      // Rule 2 trigger: invalid factor_type
      (factor.data as any).factor_type = 'general';
      // Rule 4 trigger: sign mismatch
      graph.edges.push({
        from: 'fac_price', to: 'outcome_1',
        strength_mean: -0.3, effect_direction: 'positive',
      });

      const result = reconcileStructuralTruth(graph);

      // Should have mutations from Rule 1, Rule 2, and Rule 4
      expect(result.mutations.some(m => m.code === 'CATEGORY_OVERRIDE')).toBe(true);
      expect(result.mutations.some(m => m.code === 'ENUM_VALUE_CORRECTED')).toBe(true);
      expect(result.mutations.some(m => m.code === 'SIGN_CORRECTED')).toBe(true);
      expect(result.mutations.length).toBeGreaterThanOrEqual(3);
    });

    it('clean graph produces zero mutations', () => {
      const graph = createValidGraph();
      const result = reconcileStructuralTruth(graph);
      expect(result.mutations).toHaveLength(0);
    });

    it('is idempotent: STRP(STRP(graph)) === STRP(graph)', () => {
      const graph = createValidGraph();
      // Introduce mismatches
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      factor.category = 'external' as any;
      (factor.data as any).factor_type = 'general';
      graph.edges.push({
        from: 'fac_price', to: 'outcome_1',
        strength_mean: -0.3, effect_direction: 'positive',
      });

      // First pass (with data-completeness)
      const result1 = reconcileStructuralTruth(graph, { fillControllableData: true });
      expect(result1.mutations.length).toBeGreaterThan(0);

      // Second pass — should produce zero mutations
      const result2 = reconcileStructuralTruth(graph, { fillControllableData: true });
      expect(result2.mutations).toHaveLength(0);
    });

    it('STRP→validateGraph pipeline produces valid result after reconciliation', () => {
      const graph = createValidGraph();
      // Introduce category mismatch that would cause CATEGORY_MISMATCH/CONTROLLABLE_MISSING_DATA
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      factor.category = 'external' as any;
      delete (factor.data as any).factor_type;
      delete (factor.data as any).uncertainty_drivers;

      // Without STRP, validateGraph would fail on Tier 4
      // With STRP, category is fixed + fields auto-filled
      reconcileStructuralTruth(graph, { fillControllableData: true });
      const result = validateGraph({ graph });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns same graph reference (mutates in place)', () => {
      const graph = createValidGraph();
      const result = reconcileStructuralTruth(graph);
      expect(result.graph).toBe(graph);
    });
  });
});
