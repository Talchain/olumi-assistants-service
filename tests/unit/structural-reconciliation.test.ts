/**
 * Structural Truth Reconciliation Pass (STRP) Tests
 *
 * Tests all 4 reconciliation rules and integration scenarios.
 */

import { describe, it, expect } from 'vitest';
import {
  reconcileStructuralTruth,
  normaliseConstraintTargets,
  fuzzyMatchNodeId,
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
        category: 'controllable' as any,
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

    it('sets category when absent (null/undefined) — infers from structure', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      delete (factor as any).category; // simulate LLM omitting category

      const result = reconcileStructuralTruth(graph);

      expect(factor.category).toBe('controllable');
      const mutation = result.mutations.find(m => m.code === 'CATEGORY_OVERRIDE' && m.node_id === 'fac_price');
      expect(mutation).toBeDefined();
      expect(mutation!.before).toBeUndefined();
      expect(mutation!.after).toBe('controllable');
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
  // Rule 1 — absent/undefined category override scenarios
  // =============================================================================

  describe('Rule 1: Absent Category Override', () => {
    it('sets category to controllable when null and factor has incoming option edge', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      (factor as any).category = null;

      const result = reconcileStructuralTruth(graph);

      expect(factor.category).toBe('controllable');
      const mutation = result.mutations.find(m => m.code === 'CATEGORY_OVERRIDE' && m.node_id === 'fac_price');
      expect(mutation).toBeDefined();
      expect(mutation!.before).toBeNull();
      expect(mutation!.after).toBe('controllable');
    });

    it('overrides observable→controllable when factor has incoming option edge (existing behaviour)', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      factor.category = 'observable' as any;

      const result = reconcileStructuralTruth(graph);

      expect(factor.category).toBe('controllable');
      const mutation = result.mutations.find(m => m.code === 'CATEGORY_OVERRIDE');
      expect(mutation).toBeDefined();
      expect(mutation!.before).toBe('observable');
      expect(mutation!.after).toBe('controllable');
    });

    it('does not override when category is already controllable and factor has option edge', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      factor.category = 'controllable' as any;

      const result = reconcileStructuralTruth(graph);

      expect(factor.category).toBe('controllable');
      expect(result.mutations.filter(m => m.code === 'CATEGORY_OVERRIDE' && m.node_id === 'fac_price')).toHaveLength(0);
    });

    it('does not set category to controllable when null and factor has NO incoming option edge', () => {
      const graph = createValidGraph();
      // Add a factor with no option edge and no value — should infer external, not controllable
      graph.nodes.push({
        id: 'fac_ext',
        kind: 'factor',
        label: 'External Factor',
        data: { extractionType: 'inferred' },
      });
      graph.edges.push(
        { from: 'fac_ext', to: 'outcome_1', strength_mean: 0.4, belief_exists: 0.7 },
      );

      const result = reconcileStructuralTruth(graph);

      const factor = graph.nodes.find(n => n.id === 'fac_ext')!;
      expect(factor.category).toBe('external');
      expect(factor.category).not.toBe('controllable');
      const mutation = result.mutations.find(m => m.code === 'CATEGORY_OVERRIDE' && m.node_id === 'fac_ext');
      expect(mutation).toBeDefined();
      expect(mutation!.before).toBeUndefined();
      expect(mutation!.after).toBe('external');
    });

    it('sets category to observable when absent and factor has value but no option edge', () => {
      const graph = createValidGraph();
      // Add a factor with value (→ observable) but no option edge
      graph.nodes.push({
        id: 'fac_obs',
        kind: 'factor',
        label: 'Observable Factor',
        data: { value: 42, extractionType: 'explicit' },
      });
      graph.edges.push(
        { from: 'fac_obs', to: 'outcome_1', strength_mean: 0.6, belief_exists: 0.9 },
      );

      const result = reconcileStructuralTruth(graph);

      const factor = graph.nodes.find(n => n.id === 'fac_obs')!;
      expect(factor.category).toBe('observable');
      const mutation = result.mutations.find(m => m.code === 'CATEGORY_OVERRIDE' && m.node_id === 'fac_obs');
      expect(mutation).toBeDefined();
      expect(mutation!.before).toBeUndefined();
      expect(mutation!.after).toBe('observable');
    });

    it('does not auto-fill data fields when category was absent (deferred to Rule 5)', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      delete (factor as any).category;
      delete (factor.data as any).factor_type;
      delete (factor.data as any).uncertainty_drivers;

      reconcileStructuralTruth(graph);

      // Category set, but data fields NOT auto-filled — Rule 5 handles that in late STRP
      expect(factor.category).toBe('controllable');
      expect((factor.data as any).factor_type).toBeUndefined();
      expect((factor.data as any).uncertainty_drivers).toBeUndefined();
    });

    it('auto-fills data fields when category was absent AND fillControllableData is true (Rule 5)', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      delete (factor as any).category;
      delete (factor.data as any).factor_type;
      delete (factor.data as any).uncertainty_drivers;

      const result = reconcileStructuralTruth(graph, { fillControllableData: true });

      expect(factor.category).toBe('controllable');
      expect((factor.data as any).factor_type).toBe('other');
      expect((factor.data as any).uncertainty_drivers).toEqual(['Estimation uncertainty']);
      // Rule 1 sets category, Rule 5 fills data
      expect(result.mutations.some(m => m.code === 'CATEGORY_OVERRIDE')).toBe(true);
      expect(result.mutations.some(m => m.code === 'CONTROLLABLE_DATA_FILLED')).toBe(true);
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

  // =============================================================================
  // Rule 3: Label-based fuzzy matching
  // =============================================================================

  describe('Rule 3: Label-based Constraint Matching', () => {
    it('remaps constraint via label when stem matching fails', () => {
      const graph = createValidGraph();
      // Constraint targets fac_customer_retention, graph has fac_retention_rate
      // Stems: "customer_retention" vs "retention_rate" → no substring match
      // But label "Customer Retention Rate" → normalised "customer_retention_rate" → matches
      graph.nodes.push({
        id: 'fac_retention_rate',
        kind: 'factor',
        label: 'Customer Retention Rate',
        data: { value: 0.85, extractionType: 'explicit' },
      } as any);
      graph.edges.push(
        { from: 'fac_retention_rate', to: 'outcome_1', strength_mean: 0.7, belief_exists: 0.9 },
      );

      const nodeLabels = new Map<string, string>();
      for (const n of graph.nodes) {
        if (n.label) nodeLabels.set(n.id, n.label);
      }

      const constraints = [{ node_id: 'fac_customer_retention', constraint_id: 'c1', operator: '>=', value: 80 }];
      const result = reconcileStructuralTruth(graph, {
        goalConstraints: constraints as any,
        nodeLabels,
      });

      expect(result.goalConstraints).toHaveLength(1);
      expect(result.goalConstraints![0].node_id).toBe('fac_retention_rate');
      const mutation = result.mutations.find(m => m.code === 'CONSTRAINT_REMAPPED');
      expect(mutation).toBeDefined();
      expect(mutation!.before).toBe('fac_customer_retention');
      expect(mutation!.after).toBe('fac_retention_rate');
    });

    it('does not use label matching when stem matching already succeeds', () => {
      const graph = createValidGraph();
      // fac_pric → fac_price is a stem substring match
      const constraints = [{ node_id: 'fac_pric', constraint_id: 'c1', operator: '>=', value: 100 }];
      const nodeLabels = new Map<string, string>();
      for (const n of graph.nodes) {
        if (n.label) nodeLabels.set(n.id, n.label);
      }

      const result = reconcileStructuralTruth(graph, {
        goalConstraints: constraints as any,
        nodeLabels,
      });

      expect(result.goalConstraints![0].node_id).toBe('fac_price');
    });

    it('drops constraint when neither stem nor label produces unambiguous match', () => {
      const graph = createValidGraph();
      // Add two fac_ nodes whose labels both contain "throughput"
      graph.nodes.push(
        { id: 'fac_tp_alpha', kind: 'factor', label: 'Network Throughput' } as any,
        { id: 'fac_tp_beta', kind: 'factor', label: 'Data Throughput' } as any,
      );
      const nodeLabels = new Map<string, string>();
      for (const n of graph.nodes) {
        if (n.label) nodeLabels.set(n.id, n.label);
      }

      const constraints = [{ node_id: 'fac_throughput', constraint_id: 'c1', operator: '>=', value: 100 }];
      const result = reconcileStructuralTruth(graph, {
        goalConstraints: constraints as any,
        nodeLabels,
      });

      // Stem "throughput" doesn't match "tp_alpha" or "tp_beta"
      // Label fallback: both normalise to contain "throughput" → ambiguous → drop
      expect(result.goalConstraints).toHaveLength(0);
      expect(result.mutations.find(m => m.code === 'CONSTRAINT_DROPPED')).toBeDefined();
    });
  });
});

// =============================================================================
// fuzzyMatchNodeId — exported unit tests
// =============================================================================

describe('fuzzyMatchNodeId', () => {
  const nodeIds = ['fac_price', 'fac_retention_rate', 'fac_churn', 'out_revenue', 'fac_marketing_budget'];

  it('returns exact substring match on stems', () => {
    // "pric" is substring of "price"
    expect(fuzzyMatchNodeId('fac_pric', nodeIds)).toBe('fac_price');
  });

  it('returns undefined for ambiguous stem matches', () => {
    // Both fac_price and fac_retention_rate could match something too broad
    // "fac_" stem is too short
    expect(fuzzyMatchNodeId('fac_a', nodeIds)).toBeUndefined();
  });

  it('returns undefined for stems shorter than MIN_FUZZY_STEM_LENGTH', () => {
    expect(fuzzyMatchNodeId('fac_ab', nodeIds)).toBeUndefined();
  });

  it('respects prefix filtering (fac_ vs out_)', () => {
    // fac_revenue won't match out_revenue due to prefix mismatch
    expect(fuzzyMatchNodeId('fac_revenue', nodeIds)).toBeUndefined();
  });

  it('matches via label when stem matching fails', () => {
    const labels = new Map([
      ['fac_retention_rate', 'Customer Retention Rate'],
      ['fac_price', 'Price'],
      ['fac_churn', 'Churn Rate'],
    ]);

    // "customer_retention" doesn't substring-match "retention_rate" (stem)
    // But does match normalised label "customer_retention_rate"
    expect(fuzzyMatchNodeId('fac_customer_retention', nodeIds, labels)).toBe('fac_retention_rate');
  });

  it('returns undefined when label matching is ambiguous', () => {
    // Use IDs where stem matching fails (no substring match on stems)
    // but labels both contain the constraint stem
    const ids = ['fac_rate_alpha', 'fac_rate_beta', 'fac_price'];
    const labels = new Map([
      ['fac_rate_alpha', 'Customer Satisfaction Score'],
      ['fac_rate_beta', 'Employee Satisfaction Index'],
    ]);

    // Constraint stem "satisfaction" doesn't match stems "rate_alpha" or "rate_beta"
    // But labels both normalise to contain "satisfaction" → ambiguous
    expect(fuzzyMatchNodeId('fac_satisfaction', ids, labels)).toBeUndefined();
  });

  it('returns undefined when no labels provided and stem fails', () => {
    expect(fuzzyMatchNodeId('fac_customer_retention', nodeIds)).toBeUndefined();
  });

  it('label matching normalises special characters', () => {
    const labels = new Map([
      ['fac_marketing_budget', 'Marketing & Advertising Budget'],
    ]);

    // "marketing" is substring of "marketing___advertising_budget" normalised
    expect(fuzzyMatchNodeId('fac_marketing', nodeIds, labels)).toBe('fac_marketing_budget');
  });

  it('label fallback respects prefix filtering (fac_ constraint does not match out_ node)', () => {
    // Constraint is fac_revenue, only label match is on out_revenue which has prefix out_
    const ids = ['out_revenue_growth', 'fac_price', 'fac_churn'];
    const labels = new Map([
      ['out_revenue_growth', 'Revenue Growth Forecast'],
      ['fac_price', 'Price'],
      ['fac_churn', 'Churn Rate'],
    ]);

    // Stem "revenue" doesn't match any fac_ node stems
    // Label "revenue_growth_forecast" matches but node is out_ prefix → must be rejected
    expect(fuzzyMatchNodeId('fac_revenue', ids, labels)).toBeUndefined();
  });

  it('label fallback allows same-prefix match while rejecting cross-prefix', () => {
    const ids = ['fac_rev_target', 'out_revenue_growth'];
    const labels = new Map([
      ['fac_rev_target', 'Annual Revenue Target'],
      ['out_revenue_growth', 'Revenue Growth Outcome'],
    ]);

    // Both labels contain "revenue", but only fac_rev_target shares the fac_ prefix
    expect(fuzzyMatchNodeId('fac_revenue', ids, labels)).toBe('fac_rev_target');
  });
});
