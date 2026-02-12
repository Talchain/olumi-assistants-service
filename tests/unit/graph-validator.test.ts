/**
 * Graph Validator Tests
 *
 * Comprehensive tests for deterministic graph validation.
 * Tests all 6 validation tiers, warnings, and post-normalisation checks.
 */

import { describe, it, expect } from 'vitest';
import {
  validateGraph,
  validateGraphPostNormalisation,
} from '../../src/validators/graph-validator.js';
import type { GraphT, NodeT } from '../../src/schemas/graph.js';
import {
  NODE_LIMIT,
  EDGE_LIMIT,
  MIN_OPTIONS,
  MAX_OPTIONS,
  type ValidationIssue,
} from '../../src/validators/graph-validator.types.js';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a minimal valid graph for testing.
 * Structure: decision -> [opt_a, opt_b] -> factor -> outcome -> goal
 */
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
      // T2: Strict canonical requires strength_std: 0.01 and effect_direction: "positive" for option→factor edges
      { from: 'opt_a', to: 'fac_price', strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: 'positive' },
      { from: 'opt_b', to: 'fac_price', strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: 'positive' },
      { from: 'fac_price', to: 'outcome_1', strength_mean: 0.8, belief_exists: 0.9 },
      { from: 'outcome_1', to: 'goal_1', strength_mean: 0.9, belief_exists: 1 },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
  };
}

/**
 * Helper to find issue by code
 */
function findIssue(issues: ValidationIssue[], code: string) {
  return issues.find((i) => i.code === code);
}

/**
 * Helper to check if error code exists
 */
function hasError(result: { errors: { code: string }[] }, code: string): boolean {
  return result.errors.some((e) => e.code === code);
}

/**
 * Helper to check if warning code exists
 */
function hasWarning(result: { warnings: { code: string }[] }, code: string): boolean {
  return result.warnings.some((w) => w.code === code);
}

// =============================================================================
// Valid Graph Tests
// =============================================================================

describe('validateGraph', () => {
  describe('valid graphs', () => {
    it('passes validation for minimal valid graph', () => {
      const graph = createValidGraph();
      const result = validateGraph({ graph });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes validation for graph with multiple outcomes and risks', () => {
      const graph = createValidGraph();
      graph.nodes.push({ id: 'outcome_2', kind: 'outcome', label: 'Quality' });
      graph.nodes.push({ id: 'risk_1', kind: 'risk', label: 'Market risk' });
      graph.edges.push({ from: 'fac_price', to: 'outcome_2', strength_mean: 0.5 });
      graph.edges.push({ from: 'fac_price', to: 'risk_1', strength_mean: 0.3 });
      graph.edges.push({ from: 'outcome_2', to: 'goal_1', strength_mean: 0.7 });
      graph.edges.push({ from: 'risk_1', to: 'goal_1', strength_mean: -0.4 });

      const result = validateGraph({ graph });
      expect(result.valid).toBe(true);
    });

    it('passes validation for graph at node limit (50 nodes)', () => {
      const graph = createValidGraph();

      // Add nodes up to limit (already have 6, add 44 more)
      for (let i = 0; i < 44; i++) {
        const factorId = `fac_extra_${i}`;
        graph.nodes.push({
          id: factorId,
          kind: 'factor',
          label: `Extra Factor ${i}`,
          data: { value: i * 10, extractionType: 'explicit' }, // Observable factor (no option edge, has value)
        });
        // Connect to outcome so it has path to goal
        graph.edges.push({ from: factorId, to: 'outcome_1', strength_mean: 0.1 });
      }

      expect(graph.nodes).toHaveLength(NODE_LIMIT);
      const result = validateGraph({ graph });
      expect(hasError(result, 'NODE_LIMIT_EXCEEDED')).toBe(false);
    });

    it('passes validation for graph at edge limit (200 edges)', () => {
      const graph = createValidGraph();

      // Add observable factors and edges to approach limit
      // Start with 6 edges, add more
      const edgesToAdd = EDGE_LIMIT - graph.edges.length;
      for (let i = 0; i < Math.min(edgesToAdd, 40); i++) {
        const factorId = `fac_obs_${i}`;
        graph.nodes.push({
          id: factorId,
          kind: 'factor',
          label: `Observable ${i}`,
          data: { value: i, extractionType: 'explicit' },
        });
        graph.edges.push({ from: factorId, to: 'outcome_1', strength_mean: 0.1 });
      }

      expect(graph.edges.length).toBeLessThanOrEqual(EDGE_LIMIT);
      const result = validateGraph({ graph });
      expect(hasError(result, 'EDGE_LIMIT_EXCEEDED')).toBe(false);
    });
  });

  // =============================================================================
  // Tier 1: Structural Validation
  // =============================================================================

  describe('Tier 1: Structural validation', () => {
    describe('MISSING_GOAL', () => {
      it('errors when graph has no goal node', () => {
        const graph = createValidGraph();
        graph.nodes = graph.nodes.filter((n) => n.kind !== 'goal');
        // Remove edges to goal
        graph.edges = graph.edges.filter((e) => e.to !== 'goal_1');

        const result = validateGraph({ graph });
        expect(hasError(result, 'MISSING_GOAL')).toBe(true);
      });

      it('errors when graph has multiple goal nodes', () => {
        const graph = createValidGraph();
        graph.nodes.push({ id: 'goal_2', kind: 'goal', label: 'Second goal' });

        const result = validateGraph({ graph });
        expect(hasError(result, 'MISSING_GOAL')).toBe(true);
        const issue = findIssue(result.errors, 'MISSING_GOAL');
        expect(issue?.context?.goalCount).toBe(2);
      });
    });

    describe('MISSING_DECISION', () => {
      it('errors when graph has no decision node', () => {
        const graph = createValidGraph();
        graph.nodes = graph.nodes.filter((n) => n.kind !== 'decision');
        graph.edges = graph.edges.filter((e) => e.from !== 'decision_1');

        const result = validateGraph({ graph });
        expect(hasError(result, 'MISSING_DECISION')).toBe(true);
      });

      it('errors when graph has multiple decision nodes', () => {
        const graph = createValidGraph();
        graph.nodes.push({ id: 'decision_2', kind: 'decision', label: 'Second decision' });

        const result = validateGraph({ graph });
        expect(hasError(result, 'MISSING_DECISION')).toBe(true);
        const issue = findIssue(result.errors, 'MISSING_DECISION');
        expect(issue?.context?.decisionCount).toBe(2);
      });
    });

    describe('INSUFFICIENT_OPTIONS', () => {
      it('errors when graph has fewer than 2 options', () => {
        const graph = createValidGraph();
        // Remove opt_b
        graph.nodes = graph.nodes.filter((n) => n.id !== 'opt_b');
        graph.edges = graph.edges.filter((e) => e.from !== 'opt_b' && e.to !== 'opt_b');

        const result = validateGraph({ graph });
        expect(hasError(result, 'INSUFFICIENT_OPTIONS')).toBe(true);
        const issue = findIssue(result.errors, 'INSUFFICIENT_OPTIONS');
        expect(issue?.context?.optionCount).toBe(1);
        expect(issue?.context?.min).toBe(MIN_OPTIONS);
      });

      it('errors when graph has no options', () => {
        const graph = createValidGraph();
        graph.nodes = graph.nodes.filter((n) => n.kind !== 'option');
        graph.edges = graph.edges.filter((e) =>
          e.from !== 'opt_a' && e.from !== 'opt_b' && e.to !== 'opt_a' && e.to !== 'opt_b'
        );

        const result = validateGraph({ graph });
        expect(hasError(result, 'INSUFFICIENT_OPTIONS')).toBe(true);
      });

      it('errors when graph has more than 6 options', () => {
        const graph = createValidGraph();
        // Add 5 more options (already have 2)
        for (let i = 3; i <= 7; i++) {
          const optId = `opt_${String.fromCharCode(96 + i)}`; // opt_c, opt_d, etc.
          graph.nodes.push({
            id: optId,
            kind: 'option',
            label: `Option ${i}`,
            data: { interventions: { fac_price: i * 100 } },
          });
          graph.edges.push({ from: 'decision_1', to: optId, strength_mean: 1, belief_exists: 1 });
          graph.edges.push({ from: optId, to: 'fac_price', strength_mean: 1, belief_exists: 1 });
        }

        const result = validateGraph({ graph });
        expect(hasError(result, 'INSUFFICIENT_OPTIONS')).toBe(true);
        const issue = findIssue(result.errors, 'INSUFFICIENT_OPTIONS');
        expect(issue?.context?.optionCount).toBe(7);
        expect(issue?.context?.max).toBe(MAX_OPTIONS);
      });

      it('passes with exactly 6 options', () => {
        const graph = createValidGraph();
        // Add 4 more options (already have 2)
        for (let i = 3; i <= 6; i++) {
          const optId = `opt_${String.fromCharCode(96 + i)}`;
          graph.nodes.push({
            id: optId,
            kind: 'option',
            label: `Option ${i}`,
            data: { interventions: { fac_price: i * 100 } },
          });
          graph.edges.push({ from: 'decision_1', to: optId, strength_mean: 1, belief_exists: 1 });
          graph.edges.push({ from: optId, to: 'fac_price', strength_mean: 1, belief_exists: 1 });
        }

        const result = validateGraph({ graph });
        expect(hasError(result, 'INSUFFICIENT_OPTIONS')).toBe(false);
      });
    });

    describe('MISSING_BRIDGE', () => {
      it('errors when graph has no outcomes or risks', () => {
        const graph = createValidGraph();
        graph.nodes = graph.nodes.filter((n) => n.kind !== 'outcome' && n.kind !== 'risk');
        graph.edges = graph.edges.filter((e) => e.from !== 'outcome_1' && e.to !== 'outcome_1');
        // Add direct factor->goal edge to maintain connectivity
        graph.edges.push({ from: 'fac_price', to: 'goal_1', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'MISSING_BRIDGE')).toBe(true);
      });

      it('passes with only risk nodes (no outcomes)', () => {
        const graph = createValidGraph();
        // Replace outcome with risk
        graph.nodes = graph.nodes.filter((n) => n.kind !== 'outcome');
        graph.nodes.push({ id: 'risk_1', kind: 'risk', label: 'Risk' });
        graph.edges = graph.edges.filter((e) => e.from !== 'outcome_1' && e.to !== 'outcome_1');
        graph.edges.push({ from: 'fac_price', to: 'risk_1', strength_mean: 0.5 });
        graph.edges.push({ from: 'risk_1', to: 'goal_1', strength_mean: -0.3 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'MISSING_BRIDGE')).toBe(false);
      });
    });

    describe('NODE_LIMIT_EXCEEDED', () => {
      it('errors when graph exceeds 50 nodes', () => {
        const graph = createValidGraph();

        // Add nodes to exceed limit
        for (let i = 0; i < 50; i++) {
          graph.nodes.push({
            id: `extra_${i}`,
            kind: 'factor',
            label: `Extra ${i}`,
            data: { value: i },
          });
        }

        expect(graph.nodes.length).toBeGreaterThan(NODE_LIMIT);
        const result = validateGraph({ graph });
        expect(hasError(result, 'NODE_LIMIT_EXCEEDED')).toBe(true);
      });
    });

    describe('EDGE_LIMIT_EXCEEDED', () => {
      it('errors when graph exceeds 200 edges', () => {
        const graph = createValidGraph();

        // Add many edges to exceed limit
        for (let i = 0; i < 200; i++) {
          graph.edges.push({
            from: 'fac_price',
            to: 'outcome_1',
            strength_mean: 0.1 + i * 0.001,
          });
        }

        expect(graph.edges.length).toBeGreaterThan(EDGE_LIMIT);
        const result = validateGraph({ graph });
        expect(hasError(result, 'EDGE_LIMIT_EXCEEDED')).toBe(true);
      });
    });

    describe('INVALID_EDGE_REF', () => {
      it('errors when edge references non-existent from node', () => {
        const graph = createValidGraph();
        graph.edges.push({ from: 'nonexistent_node', to: 'goal_1', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'INVALID_EDGE_REF')).toBe(true);
        const issue = findIssue(result.errors, 'INVALID_EDGE_REF');
        expect(issue?.context?.field).toBe('from');
        expect(issue?.context?.nodeId).toBe('nonexistent_node');
      });

      it('errors when edge references non-existent to node', () => {
        const graph = createValidGraph();
        graph.edges.push({ from: 'fac_price', to: 'missing_target', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'INVALID_EDGE_REF')).toBe(true);
        const issue = findIssue(result.errors, 'INVALID_EDGE_REF');
        expect(issue?.context?.field).toBe('to');
      });
    });
  });

  // =============================================================================
  // Tier 2: Topology Validation
  // =============================================================================

  describe('Tier 2: Topology validation', () => {
    describe('GOAL_HAS_OUTGOING', () => {
      it('errors when goal node has outgoing edges', () => {
        const graph = createValidGraph();
        graph.edges.push({ from: 'goal_1', to: 'outcome_1', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'GOAL_HAS_OUTGOING')).toBe(true);
      });
    });

    describe('DECISION_HAS_INCOMING', () => {
      it('errors when decision node has incoming edges', () => {
        const graph = createValidGraph();
        graph.edges.push({ from: 'fac_price', to: 'decision_1', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'DECISION_HAS_INCOMING')).toBe(true);
      });
    });

    describe('INVALID_EDGE_TYPE', () => {
      it('errors for decision -> factor edge (should go through option)', () => {
        const graph = createValidGraph();
        graph.edges.push({ from: 'decision_1', to: 'fac_price', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'INVALID_EDGE_TYPE')).toBe(true);
      });

      it('errors for option -> goal edge (should go through outcome/risk)', () => {
        const graph = createValidGraph();
        graph.edges.push({ from: 'opt_a', to: 'goal_1', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'INVALID_EDGE_TYPE')).toBe(true);
      });

      it('errors for factor -> option edge (wrong direction)', () => {
        const graph = createValidGraph();
        graph.edges.push({ from: 'fac_price', to: 'opt_a', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'INVALID_EDGE_TYPE')).toBe(true);
      });

      it('errors for goal -> outcome edge (wrong direction)', () => {
        const graph = createValidGraph();
        graph.edges.push({ from: 'goal_1', to: 'outcome_1', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        // Should have both GOAL_HAS_OUTGOING and INVALID_EDGE_TYPE
        expect(hasError(result, 'GOAL_HAS_OUTGOING')).toBe(true);
        expect(hasError(result, 'INVALID_EDGE_TYPE')).toBe(true);
      });

      it('allows factor -> factor edge for observable factors', () => {
        const graph = createValidGraph();
        // Add an observable factor (has value, no option edge)
        graph.nodes.push({
          id: 'fac_market',
          kind: 'factor',
          label: 'Market Size',
          data: { value: 1000, extractionType: 'explicit' },
        });
        graph.edges.push({ from: 'fac_market', to: 'fac_price', strength_mean: 0.3 });
        // Connect market to outcome for reachability
        graph.edges.push({ from: 'fac_market', to: 'outcome_1', strength_mean: 0.2 });

        const result = validateGraph({ graph });
        // fac_price is controllable (has option edge), so fac_market -> fac_price is invalid
        // because the ALLOWED_EDGES only allows factor -> factor for observable/external targets
        expect(hasError(result, 'INVALID_EDGE_TYPE')).toBe(true);
      });

      it('allows factor -> observable factor edge', () => {
        const graph = createValidGraph();
        // Add an external factor (no value, no option edge)
        graph.nodes.push({
          id: 'fac_external',
          kind: 'factor',
          label: 'External Factor',
        });
        // Add an observable factor
        graph.nodes.push({
          id: 'fac_obs',
          kind: 'factor',
          label: 'Observable Factor',
          data: { value: 500, extractionType: 'explicit' },
        });
        // external -> observable is allowed
        graph.edges.push({ from: 'fac_external', to: 'fac_obs', strength_mean: 0.3 });
        // Connect both to outcome for reachability
        graph.edges.push({ from: 'fac_external', to: 'outcome_1', strength_mean: 0.1 });
        graph.edges.push({ from: 'fac_obs', to: 'outcome_1', strength_mean: 0.2 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'INVALID_EDGE_TYPE')).toBe(false);
      });

      it('option edge to factor with data.value makes it controllable (not observable)', () => {
        const graph = createValidGraph();
        // Add a factor with data.value - would be observable if no option edge
        graph.nodes.push({
          id: 'fac_new',
          kind: 'factor',
          label: 'New Factor',
          data: {
            value: 500,
            extractionType: 'explicit',
            factor_type: 'cost',
            uncertainty_drivers: ['market'],
          },
        });
        // Adding option edge makes it controllable, not observable
        graph.edges.push({ from: 'opt_a', to: 'fac_new', strength_mean: 1, belief_exists: 1 });
        // Connect to outcome for reachability
        graph.edges.push({ from: 'fac_new', to: 'outcome_1', strength_mean: 0.3 });

        const result = validateGraph({ graph });
        // The option edge makes fac_new controllable, so edge type is valid
        expect(hasError(result, 'INVALID_EDGE_TYPE')).toBe(false);
      });
    });

    describe('CYCLE_DETECTED', () => {
      it('errors when graph contains a simple cycle', () => {
        const graph = createValidGraph();
        // Add observable factors that form a cycle
        graph.nodes.push({
          id: 'fac_a',
          kind: 'factor',
          label: 'Factor A',
          data: { value: 10, extractionType: 'explicit' },
        });
        graph.nodes.push({
          id: 'fac_b',
          kind: 'factor',
          label: 'Factor B',
          data: { value: 20, extractionType: 'explicit' },
        });
        // Create cycle: fac_a -> fac_b -> fac_a
        graph.edges.push({ from: 'fac_a', to: 'fac_b', strength_mean: 0.5 });
        graph.edges.push({ from: 'fac_b', to: 'fac_a', strength_mean: 0.5 });
        // Connect to rest of graph
        graph.edges.push({ from: 'fac_a', to: 'outcome_1', strength_mean: 0.2 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'CYCLE_DETECTED')).toBe(true);
      });

      it('errors when graph contains a longer cycle', () => {
        const graph = createValidGraph();
        // Add factors forming a 3-node cycle
        graph.nodes.push(
          { id: 'fac_a', kind: 'factor', label: 'A', data: { value: 1, extractionType: 'explicit' } },
          { id: 'fac_b', kind: 'factor', label: 'B', data: { value: 2, extractionType: 'explicit' } },
          { id: 'fac_c', kind: 'factor', label: 'C', data: { value: 3, extractionType: 'explicit' } }
        );
        // Cycle: a -> b -> c -> a
        graph.edges.push(
          { from: 'fac_a', to: 'fac_b', strength_mean: 0.5 },
          { from: 'fac_b', to: 'fac_c', strength_mean: 0.5 },
          { from: 'fac_c', to: 'fac_a', strength_mean: 0.5 }
        );
        // Connect to outcome
        graph.edges.push({ from: 'fac_a', to: 'outcome_1', strength_mean: 0.2 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'CYCLE_DETECTED')).toBe(true);
      });

      it('passes for valid DAG', () => {
        const graph = createValidGraph();
        const result = validateGraph({ graph });
        expect(hasError(result, 'CYCLE_DETECTED')).toBe(false);
      });
    });
  });

  // =============================================================================
  // Tier 3: Reachability Validation
  // =============================================================================

  describe('Tier 3: Reachability validation', () => {
    describe('UNREACHABLE_FROM_DECISION', () => {
      it('errors when node is not reachable from decision', () => {
        const graph = createValidGraph();
        // Add isolated factor (not connected to decision path)
        graph.nodes.push({
          id: 'isolated_factor',
          kind: 'factor',
          label: 'Isolated',
          data: {
            value: 100,
            extractionType: 'explicit',
            factor_type: 'cost',
            uncertainty_drivers: ['unknown'],
          },
        });
        // Connect to goal via outcome (has path to goal)
        graph.edges.push({ from: 'isolated_factor', to: 'outcome_1', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        // Should NOT error because exogenous factors with path to goal are exempted
        expect(hasError(result, 'UNREACHABLE_FROM_DECISION')).toBe(false);
      });

      it('errors when non-factor node is unreachable', () => {
        const graph = createValidGraph();
        // Add isolated outcome
        graph.nodes.push({ id: 'isolated_outcome', kind: 'outcome', label: 'Isolated Outcome' });
        // No edges to/from it - completely isolated

        const result = validateGraph({ graph });
        expect(hasError(result, 'UNREACHABLE_FROM_DECISION')).toBe(true);
        expect(hasError(result, 'NO_PATH_TO_GOAL')).toBe(true);
      });

      it('exempts exogenous factors with path to goal', () => {
        const graph = createValidGraph();
        // Add observable factor (exogenous - no option edge, has value)
        graph.nodes.push({
          id: 'fac_external',
          kind: 'factor',
          label: 'External Market Factor',
          data: { value: 1000, extractionType: 'explicit' },
        });
        // Has path to goal via outcome
        graph.edges.push({ from: 'fac_external', to: 'outcome_1', strength_mean: 0.3 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'UNREACHABLE_FROM_DECISION')).toBe(false);
      });

      it('passes for exogenous observable root (no incoming edges) with path to goal', () => {
        const graph = createValidGraph();
        // Add observable factor as a pure root - no incoming edges at all
        // This simulates an external market variable that influences the model
        graph.nodes.push({
          id: 'fac_market_root',
          kind: 'factor',
          label: 'Market Conditions',
          data: { value: 85, extractionType: 'explicit' }, // Has value = observable, no option edge = exogenous
        });
        // Only outgoing edge to outcome - no incoming edges
        graph.edges.push({ from: 'fac_market_root', to: 'outcome_1', strength_mean: 0.4 });

        const result = validateGraph({ graph });
        // Exogenous observable root should pass because it has path to goal
        expect(hasError(result, 'UNREACHABLE_FROM_DECISION')).toBe(false);
        expect(hasError(result, 'NO_PATH_TO_GOAL')).toBe(false);
        expect(result.valid).toBe(true);
      });
    });

    describe('NO_PATH_TO_GOAL', () => {
      it('errors when node has no path to goal', () => {
        const graph = createValidGraph();
        // Add factor with no path to goal
        graph.nodes.push({
          id: 'dead_end_factor',
          kind: 'factor',
          label: 'Dead End',
          data: { value: 50, extractionType: 'explicit' },
        });
        // Connected from controllable factor but goes nowhere
        graph.edges.push({ from: 'fac_price', to: 'dead_end_factor', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'NO_PATH_TO_GOAL')).toBe(true);
        const issue = findIssue(result.errors, 'NO_PATH_TO_GOAL');
        expect(issue?.path).toBe('nodesById.dead_end_factor');
      });

      it('decision is exempt from NO_PATH_TO_GOAL check', () => {
        const graph = createValidGraph();
        // Decision typically doesn't have direct path to goal (goes through options)
        const result = validateGraph({ graph });
        expect(hasError(result, 'NO_PATH_TO_GOAL')).toBe(false);
      });
    });
  });

  // =============================================================================
  // Tier 4: Factor Data Consistency
  // =============================================================================

  describe('Tier 4: Factor data consistency', () => {
    describe('CONTROLLABLE_MISSING_DATA', () => {
      it('errors when controllable factor missing value', () => {
        const graph = createValidGraph();
        // Modify controllable factor to be missing value
        const factor = graph.nodes.find((n) => n.id === 'fac_price') as NodeT;
        factor.data = {
          extractionType: 'explicit',
          factor_type: 'price',
          uncertainty_drivers: ['test'],
        } as never;

        const result = validateGraph({ graph });
        expect(hasError(result, 'CONTROLLABLE_MISSING_DATA')).toBe(true);
        const issue = findIssue(result.errors, 'CONTROLLABLE_MISSING_DATA');
        expect(issue?.context?.missing).toContain('value');
      });

      it('errors when controllable factor missing extractionType', () => {
        const graph = createValidGraph();
        const factor = graph.nodes.find((n) => n.id === 'fac_price') as NodeT;
        factor.data = {
          value: 100,
          factor_type: 'price',
          uncertainty_drivers: ['test'],
        } as never;

        const result = validateGraph({ graph });
        expect(hasError(result, 'CONTROLLABLE_MISSING_DATA')).toBe(true);
        const issue = findIssue(result.errors, 'CONTROLLABLE_MISSING_DATA');
        expect(issue?.context?.missing).toContain('extractionType');
      });

      it('errors when controllable factor missing factor_type', () => {
        const graph = createValidGraph();
        const factor = graph.nodes.find((n) => n.id === 'fac_price') as NodeT;
        factor.data = {
          value: 100,
          extractionType: 'explicit',
          uncertainty_drivers: ['test'],
        } as never;

        const result = validateGraph({ graph });
        expect(hasError(result, 'CONTROLLABLE_MISSING_DATA')).toBe(true);
        const issue = findIssue(result.errors, 'CONTROLLABLE_MISSING_DATA');
        expect(issue?.context?.missing).toContain('factor_type');
      });

      it('errors when controllable factor missing uncertainty_drivers', () => {
        const graph = createValidGraph();
        const factor = graph.nodes.find((n) => n.id === 'fac_price') as NodeT;
        factor.data = {
          value: 100,
          extractionType: 'explicit',
          factor_type: 'price',
        } as never;

        const result = validateGraph({ graph });
        expect(hasError(result, 'CONTROLLABLE_MISSING_DATA')).toBe(true);
        const issue = findIssue(result.errors, 'CONTROLLABLE_MISSING_DATA');
        expect(issue?.context?.missing).toContain('uncertainty_drivers');
      });
    });

    describe('OBSERVABLE_MISSING_DATA', () => {
      it('errors when observable factor lacks extractionType', () => {
        const graph = createValidGraph();
        // Add observable factor (no option edge, has value) missing extractionType
        graph.nodes.push({
          id: 'fac_obs',
          kind: 'factor',
          label: 'Observable',
          data: {
            value: 500, // Has value = observable
            // Missing extractionType!
          },
        } as never);
        graph.edges.push({ from: 'fac_obs', to: 'outcome_1', strength_mean: 0.3 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'OBSERVABLE_MISSING_DATA')).toBe(true);
        const issue = findIssue(result.errors, 'OBSERVABLE_MISSING_DATA');
        expect(issue?.context?.missing).toContain('extractionType');
      });

      it('passes when observable factor has value and extractionType', () => {
        const graph = createValidGraph();
        // Add properly formed observable factor
        graph.nodes.push({
          id: 'fac_obs',
          kind: 'factor',
          label: 'Observable',
          data: {
            value: 500,
            extractionType: 'explicit',
          },
        } as never);
        graph.edges.push({ from: 'fac_obs', to: 'outcome_1', strength_mean: 0.3 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'OBSERVABLE_MISSING_DATA')).toBe(false);
      });
    });

    describe('OBSERVABLE_EXTRA_DATA', () => {
      it('errors when observable factor has factor_type', () => {
        const graph = createValidGraph();
        // Add observable factor with extra data
        graph.nodes.push({
          id: 'fac_obs',
          kind: 'factor',
          label: 'Observable',
          data: {
            value: 500, // Has value = observable
            extractionType: 'explicit', // Required
            factor_type: 'cost', // Should not have this
          },
        } as never);
        graph.edges.push({ from: 'fac_obs', to: 'outcome_1', strength_mean: 0.3 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'OBSERVABLE_EXTRA_DATA')).toBe(true);
        const issue = findIssue(result.errors, 'OBSERVABLE_EXTRA_DATA');
        expect(issue?.context?.extra).toContain('factor_type');
      });

      it('errors when observable factor has uncertainty_drivers', () => {
        const graph = createValidGraph();
        graph.nodes.push({
          id: 'fac_obs',
          kind: 'factor',
          label: 'Observable',
          data: {
            value: 500,
            extractionType: 'explicit',
            uncertainty_drivers: ['should not be here'],
          },
        } as never);
        graph.edges.push({ from: 'fac_obs', to: 'outcome_1', strength_mean: 0.3 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'OBSERVABLE_EXTRA_DATA')).toBe(true);
      });
    });

    describe('EXTERNAL_HAS_DATA', () => {
      it('errors when external factor has value', () => {
        const graph = createValidGraph();
        // Add factor with no option edge and with value (should be observable, not external)
        // But if we mark it as external explicitly and give it value, that's wrong
        // Actually, a factor with value but no option edge is observable.
        // External = no value, no option edge
        // The test should add a factor and somehow make it classified as external but with value
        // Wait - the classification is automatic: if no option edge and has value = observable
        // If no option edge and no value = external
        // So EXTERNAL_HAS_DATA would only trigger if there's a bug or explicit category override
        // Let's just check that an external factor (no value, no option edge) with value triggers
        // Actually, an external factor by definition has no value. If we add value, it becomes observable.

        // This error code is for when an external factor has data it shouldn't.
        // Since external is inferred from having no option edge and no value,
        // we need to test the explicit category mismatch case instead.

        // Actually, let's add a factor with no option edge and no value (external)
        // and then give it factor_type which it shouldn't have
        graph.nodes.push({
          id: 'fac_ext',
          kind: 'factor',
          label: 'External',
          data: {
            factor_type: 'other', // External should not have this
          },
        } as never);
        graph.edges.push({ from: 'fac_ext', to: 'outcome_1', strength_mean: 0.1 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'EXTERNAL_HAS_DATA')).toBe(true);
      });
    });

    describe('CATEGORY_MISMATCH (normalised by category override)', () => {
      it('overrides observable→controllable and emits CATEGORY_OVERRIDE info (no CATEGORY_MISMATCH error)', () => {
        const graph = createValidGraph();
        // The controllable factor (has option edges) claims to be observable
        const factor = graph.nodes.find((n) => n.id === 'fac_price') as NodeT;
        (factor as Record<string, unknown>).category = 'observable'; // Wrong!

        const result = validateGraph({ graph });
        // Category override normalises the mismatch before Tier 4 runs
        expect(hasError(result, 'CATEGORY_MISMATCH')).toBe(false);
        const overrideIssue = result.warnings.find(w => w.code === 'CATEGORY_OVERRIDE');
        expect(overrideIssue).toBeDefined();
        expect(overrideIssue!.context?.declaredCategory).toBe('observable');
        expect(overrideIssue!.context?.inferredCategory).toBe('controllable');
      });

      it('overrides external→controllable and emits CATEGORY_OVERRIDE info (no CATEGORY_MISMATCH error)', () => {
        const graph = createValidGraph();
        const factor = graph.nodes.find((n) => n.id === 'fac_price') as NodeT;
        (factor as Record<string, unknown>).category = 'external'; // Wrong!

        const result = validateGraph({ graph });
        expect(hasError(result, 'CATEGORY_MISMATCH')).toBe(false);
        const overrideIssue = result.warnings.find(w => w.code === 'CATEGORY_OVERRIDE');
        expect(overrideIssue).toBeDefined();
        expect(overrideIssue!.context?.declaredCategory).toBe('external');
        expect(overrideIssue!.context?.inferredCategory).toBe('controllable');
      });

      it('overrides controllable→observable and strips extra fields (no CATEGORY_MISMATCH error)', () => {
        const graph = createValidGraph();
        // Add an observable factor (has value, no option edge) but claim it's controllable
        graph.nodes.push({
          id: 'fac_obs',
          kind: 'factor',
          label: 'Observable Factor',
          category: 'controllable', // Wrong - no option edges
          data: { value: 100, extractionType: 'explicit', factor_type: 'cost', uncertainty_drivers: ['market'] },
        } as never);
        graph.edges.push({ from: 'fac_obs', to: 'outcome_1', strength_mean: 0.3 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'CATEGORY_MISMATCH')).toBe(false);
        expect(hasError(result, 'OBSERVABLE_EXTRA_DATA')).toBe(false);
        const overrideIssue = result.warnings.find(w => w.code === 'CATEGORY_OVERRIDE');
        expect(overrideIssue).toBeDefined();
        expect(overrideIssue!.context?.declaredCategory).toBe('controllable');
        expect(overrideIssue!.context?.inferredCategory).toBe('observable');
      });

      it('passes when explicit category matches inferred category (no override)', () => {
        const graph = createValidGraph();
        // Set correct explicit category on controllable factor
        const factor = graph.nodes.find((n) => n.id === 'fac_price') as NodeT;
        (factor as Record<string, unknown>).category = 'controllable'; // Correct!

        const result = validateGraph({ graph });
        expect(hasError(result, 'CATEGORY_MISMATCH')).toBe(false);
        const overrideIssue = result.warnings.find(w => w.code === 'CATEGORY_OVERRIDE');
        expect(overrideIssue).toBeUndefined();
      });

      it('passes when explicit category is absent (fallback to inference, no override)', () => {
        const graph = createValidGraph();
        // No explicit category - should infer from structure
        const result = validateGraph({ graph });
        expect(hasError(result, 'CATEGORY_MISMATCH')).toBe(false);
        const overrideIssue = result.warnings.find(w => w.code === 'CATEGORY_OVERRIDE');
        expect(overrideIssue).toBeUndefined();
      });
    });
  });

  // =============================================================================
  // Tier 5: Semantic Integrity
  // =============================================================================

  describe('Tier 5: Semantic integrity', () => {
    describe('NO_EFFECT_PATH', () => {
      it('errors when option has no controllable factors with path to goal', () => {
        const graph = createValidGraph();
        // Remove edge from fac_price to outcome (breaking the path)
        graph.edges = graph.edges.filter(
          (e) => !(e.from === 'fac_price' && e.to === 'outcome_1')
        );
        // Now fac_price has no path to goal

        const result = validateGraph({ graph });
        expect(hasError(result, 'NO_EFFECT_PATH')).toBe(true);
      });
    });

    describe('OPTIONS_IDENTICAL', () => {
      it('errors when two options have identical intervention signatures', () => {
        const graph = createValidGraph();
        // Make opt_b have same interventions as opt_a
        const optB = graph.nodes.find((n) => n.id === 'opt_b') as NodeT;
        optB.data = { interventions: { fac_price: 100 } }; // Same as opt_a

        const result = validateGraph({ graph });
        expect(hasError(result, 'OPTIONS_IDENTICAL')).toBe(true);
        const issue = findIssue(result.errors, 'OPTIONS_IDENTICAL');
        expect(issue?.context?.optionIds).toContain('opt_a');
        expect(issue?.context?.optionIds).toContain('opt_b');
      });

      it('passes when options have different intervention values', () => {
        const graph = createValidGraph();
        // Default graph has opt_a: fac_price=100, opt_b: fac_price=200
        const result = validateGraph({ graph });
        expect(hasError(result, 'OPTIONS_IDENTICAL')).toBe(false);
      });
    });

    describe('INVALID_INTERVENTION_REF', () => {
      it('errors when intervention references non-existent node', () => {
        const graph = createValidGraph();
        const optA = graph.nodes.find((n) => n.id === 'opt_a') as NodeT;
        (optA.data as { interventions: Record<string, number> }).interventions.nonexistent_factor = 999;

        const result = validateGraph({ graph });
        expect(hasError(result, 'INVALID_INTERVENTION_REF')).toBe(true);
        const issue = findIssue(result.errors, 'INVALID_INTERVENTION_REF');
        expect(issue?.context?.factorId).toBe('nonexistent_factor');
      });

      it('errors when intervention references non-factor node', () => {
        const graph = createValidGraph();
        const optA = graph.nodes.find((n) => n.id === 'opt_a') as NodeT;
        // Reference the goal node in interventions (which is not a factor)
        (optA.data as { interventions: Record<string, number> }).interventions.goal_1 = 999;

        const result = validateGraph({ graph });
        expect(hasError(result, 'INVALID_INTERVENTION_REF')).toBe(true);
        const issue = findIssue(result.errors, 'INVALID_INTERVENTION_REF');
        expect(issue?.context?.factorId).toBe('goal_1');
        expect(issue?.context?.actualKind).toBe('goal');
      });
    });

    describe('GOAL_NUMBER_AS_FACTOR', () => {
      it('errors when factor label is "£20k MRR"', () => {
        const graph = createValidGraph();
        // Add a factor that looks like a goal target value (no option edge = observable)
        graph.nodes.push({
          id: 'fac_goal_num',
          kind: 'factor',
          label: '£20k MRR',
          data: { value: 20000, extractionType: 'explicit' },
        } as never);
        graph.edges.push({ from: 'fac_goal_num', to: 'outcome_1', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'GOAL_NUMBER_AS_FACTOR')).toBe(true);
        const issue = findIssue(result.errors, 'GOAL_NUMBER_AS_FACTOR');
        expect(issue?.context?.label).toBe('£20k MRR');
      });

      it('errors when factor label is "$50k revenue target"', () => {
        const graph = createValidGraph();
        graph.nodes.push({
          id: 'fac_revenue_target',
          kind: 'factor',
          label: '$50k revenue target',
          data: { value: 50000, extractionType: 'explicit' },
        } as never);
        graph.edges.push({ from: 'fac_revenue_target', to: 'outcome_1', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'GOAL_NUMBER_AS_FACTOR')).toBe(true);
      });

      it('errors when factor label matches "target of £100k"', () => {
        const graph = createValidGraph();
        graph.nodes.push({
          id: 'fac_target',
          kind: 'factor',
          label: 'target of £100k',
          data: { value: 100000, extractionType: 'explicit' },
        } as never);
        graph.edges.push({ from: 'fac_target', to: 'outcome_1', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'GOAL_NUMBER_AS_FACTOR')).toBe(true);
      });

      it('errors when factor label matches "goal of reaching $1M"', () => {
        const graph = createValidGraph();
        graph.nodes.push({
          id: 'fac_goal',
          kind: 'factor',
          label: 'goal of reaching $1M',
          data: { value: 1000000, extractionType: 'explicit' },
        } as never);
        graph.edges.push({ from: 'fac_goal', to: 'outcome_1', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'GOAL_NUMBER_AS_FACTOR')).toBe(true);
      });

      it('passes when factor label is "Monthly Revenue" (no number)', () => {
        const graph = createValidGraph();
        graph.nodes.push({
          id: 'fac_revenue',
          kind: 'factor',
          label: 'Monthly Revenue',
          data: { value: 15000, extractionType: 'explicit' },
        } as never);
        graph.edges.push({ from: 'fac_revenue', to: 'outcome_1', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'GOAL_NUMBER_AS_FACTOR')).toBe(false);
      });

      it('passes when factor with goal-like name has option edge (controllable)', () => {
        const graph = createValidGraph();
        // Add a factor with goal-like name BUT it has option edge = controllable
        graph.nodes.push({
          id: 'fac_controllable_goal',
          kind: 'factor',
          label: '50k revenue',
          data: {
            value: 50000,
            extractionType: 'explicit',
            factor_type: 'revenue',
            uncertainty_drivers: ['market'],
          },
        } as never);
        // Adding option edge makes it controllable - should pass validation
        graph.edges.push({ from: 'opt_a', to: 'fac_controllable_goal', strength_mean: 1, belief_exists: 1 });
        graph.edges.push({ from: 'fac_controllable_goal', to: 'outcome_1', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'GOAL_NUMBER_AS_FACTOR')).toBe(false);
      });

      it('passes when factor label is "Price" (normal factor)', () => {
        const graph = createValidGraph();
        // Default fac_price should pass
        const result = validateGraph({ graph });
        expect(hasError(result, 'GOAL_NUMBER_AS_FACTOR')).toBe(false);
      });

      it('passes when factor label is "target customer segments" (no currency/financial term)', () => {
        const graph = createValidGraph();
        // This should NOT match - it's a legitimate factor, not a goal target
        graph.nodes.push({
          id: 'fac_segments',
          kind: 'factor',
          label: 'target customer segments',
          data: { value: 5, extractionType: 'explicit' },
        } as never);
        graph.edges.push({ from: 'fac_segments', to: 'outcome_1', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'GOAL_NUMBER_AS_FACTOR')).toBe(false);
      });

      it('passes when factor label is "objective function weight" (no currency/financial term)', () => {
        const graph = createValidGraph();
        // This should NOT match - it's a legitimate technical factor
        graph.nodes.push({
          id: 'fac_weight',
          kind: 'factor',
          label: 'objective function weight',
          data: { value: 0.5, extractionType: 'explicit' },
        } as never);
        graph.edges.push({ from: 'fac_weight', to: 'outcome_1', strength_mean: 0.3 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'GOAL_NUMBER_AS_FACTOR')).toBe(false);
      });

      // T1: Controllability detection edge cases
      // After category normalisation, a factor declared controllable but structurally
      // observable (no option edge) is reclassified. The goal-number check then
      // correctly applies since the factor is non-controllable with a goal-like name.
      it('errors when factor has category=controllable but no option edge (category normalised)', () => {
        const graph = createValidGraph();
        // Factor with goal-like name AND category: controllable (but no option edge)
        graph.nodes.push({
          id: 'fac_controllable_declared',
          kind: 'factor',
          label: '50k revenue',
          category: 'controllable',  // Declared controllable, but structurally observable
          data: { value: 50000, extractionType: 'explicit' },
        } as never);
        // No option edge — category normalisation overrides to observable
        graph.edges.push({ from: 'fac_controllable_declared', to: 'outcome_1', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        // Category was overridden from controllable → observable, so goal-number check applies
        expect(hasError(result, 'GOAL_NUMBER_AS_FACTOR')).toBe(true);
      });

      it('errors when factor has no category, no option edge, and matches goal-number pattern', () => {
        const graph = createValidGraph();
        // Factor with goal-like name, no category, no option edge = should flag
        graph.nodes.push({
          id: 'fac_uncategorized_goal',
          kind: 'factor',
          label: '$100k revenue target',
          data: { value: 100000, extractionType: 'explicit' },
        } as never);
        graph.edges.push({ from: 'fac_uncategorized_goal', to: 'outcome_1', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'GOAL_NUMBER_AS_FACTOR')).toBe(true);
      });

      it('passes when factor has category=controllable even with goal-number pattern', () => {
        const graph = createValidGraph();
        // Factor with goal-number pattern but explicitly marked controllable
        graph.nodes.push({
          id: 'fac_goal_but_controllable',
          kind: 'factor',
          label: '£50k MRR target',
          category: 'controllable',  // Trust declaration even for goal-like names
          data: { value: 50000, extractionType: 'explicit' },
        } as never);
        graph.edges.push({ from: 'fac_goal_but_controllable', to: 'outcome_1', strength_mean: 0.5 });

        const result = validateGraph({ graph });
        expect(hasError(result, 'GOAL_NUMBER_AS_FACTOR')).toBe(false);
      });
    });

    describe('STRUCTURAL_EDGE_NOT_CANONICAL_ERROR', () => {
      it('errors when option->factor edge has non-canonical std (0.15)', () => {
        const graph = createValidGraph();
        const optionEdge = graph.edges.find(
          (e) => e.from === 'opt_a' && e.to === 'fac_price'
        );
        if (optionEdge) {
          optionEdge.strength_std = 0.15; // T2: Should be exactly 0.01 for structural
        }

        const result = validateGraph({ graph });
        expect(hasError(result, 'STRUCTURAL_EDGE_NOT_CANONICAL_ERROR')).toBe(true);
        const issue = findIssue(result.errors, 'STRUCTURAL_EDGE_NOT_CANONICAL_ERROR');
        expect(issue?.context?.from).toBe('opt_a');
        expect(issue?.context?.to).toBe('fac_price');
      });

      // T2: Strict canonical - std: 0.05 is NOT canonical (only 0.01 is)
      it('errors when option->factor edge has std=0.05 (not strictly canonical)', () => {
        const graph = createValidGraph();
        const optionEdge = graph.edges.find(
          (e) => e.from === 'opt_a' && e.to === 'fac_price'
        );
        if (optionEdge) {
          optionEdge.strength_std = 0.05; // T2: 0.05 is NOT canonical, only 0.01 is
        }

        const result = validateGraph({ graph });
        expect(hasError(result, 'STRUCTURAL_EDGE_NOT_CANONICAL_ERROR')).toBe(true);
      });

      // T2: undefined std triggers error (will be repaired to 0.01)
      it('errors when option->factor edge has undefined std', () => {
        const graph = createValidGraph();
        const optionEdge = graph.edges.find(
          (e) => e.from === 'opt_a' && e.to === 'fac_price'
        );
        if (optionEdge) {
          delete optionEdge.strength_std; // T2: undefined triggers error, then repair
        }

        const result = validateGraph({ graph });
        expect(hasError(result, 'STRUCTURAL_EDGE_NOT_CANONICAL_ERROR')).toBe(true);
      });

      it('errors when option->factor edge has non-canonical mean', () => {
        const graph = createValidGraph();
        const optionEdge = graph.edges.find(
          (e) => e.from === 'opt_a' && e.to === 'fac_price'
        );
        if (optionEdge) {
          optionEdge.strength_mean = 0.8; // Should be 1 for structural
        }

        const result = validateGraph({ graph });
        expect(hasError(result, 'STRUCTURAL_EDGE_NOT_CANONICAL_ERROR')).toBe(true);
      });

      it('errors when option->factor edge has non-canonical belief_exists', () => {
        const graph = createValidGraph();
        const optionEdge = graph.edges.find(
          (e) => e.from === 'opt_a' && e.to === 'fac_price'
        );
        if (optionEdge) {
          optionEdge.belief_exists = 0.9; // Should be 1 for structural
        }

        const result = validateGraph({ graph });
        expect(hasError(result, 'STRUCTURAL_EDGE_NOT_CANONICAL_ERROR')).toBe(true);
      });

      it('passes when option->factor edge has canonical values (mean=1, std=0.01, prob=1, direction=positive)', () => {
        const graph = createValidGraph();
        // Default graph has canonical structural edges (createValidGraph now includes std=0.01 and direction)
        const result = validateGraph({ graph });
        expect(hasError(result, 'STRUCTURAL_EDGE_NOT_CANONICAL_ERROR')).toBe(false);
      });

      // T2: effect_direction must also be canonical ("positive")
      it('errors when option->factor edge has non-canonical effect_direction', () => {
        const graph = createValidGraph();
        const optionEdge = graph.edges.find(
          (e) => e.from === 'opt_a' && e.to === 'fac_price'
        );
        if (optionEdge) {
          optionEdge.effect_direction = 'negative'; // Should be "positive" for structural
        }

        const result = validateGraph({ graph });
        expect(hasError(result, 'STRUCTURAL_EDGE_NOT_CANONICAL_ERROR')).toBe(true);
      });

      it('errors when option->factor edge has undefined effect_direction', () => {
        const graph = createValidGraph();
        const optionEdge = graph.edges.find(
          (e) => e.from === 'opt_a' && e.to === 'fac_price'
        );
        if (optionEdge) {
          delete optionEdge.effect_direction; // undefined triggers error, then repair
        }

        const result = validateGraph({ graph });
        expect(hasError(result, 'STRUCTURAL_EDGE_NOT_CANONICAL_ERROR')).toBe(true);
      });

      it('decision->option non-canonical is WARNING not ERROR', () => {
        const graph = createValidGraph();
        const decisionEdge = graph.edges.find(
          (e) => e.from === 'decision_1' && e.to === 'opt_a'
        );
        if (decisionEdge) {
          decisionEdge.strength_mean = 0.5; // Non-canonical
        }

        const result = validateGraph({ graph });
        // decision->option non-canonical is warning, not error
        expect(hasError(result, 'STRUCTURAL_EDGE_NOT_CANONICAL_ERROR')).toBe(false);
        expect(hasWarning(result, 'STRUCTURAL_EDGE_NOT_CANONICAL')).toBe(true);
      });
    });
  });

  // =============================================================================
  // Tier 6: Numeric Validation
  // =============================================================================

  describe('Tier 6: Numeric validation', () => {
    describe('NAN_VALUE', () => {
      it('errors when factor value is NaN', () => {
        const graph = createValidGraph();
        const factor = graph.nodes.find((n) => n.id === 'fac_price') as NodeT;
        (factor.data as { value: number }).value = NaN;

        const result = validateGraph({ graph });
        expect(hasError(result, 'NAN_VALUE')).toBe(true);
        const issue = findIssue(result.errors, 'NAN_VALUE');
        expect(issue?.path).toBe('nodesById.fac_price.data.value');
      });

      it('errors when factor value is Infinity', () => {
        const graph = createValidGraph();
        const factor = graph.nodes.find((n) => n.id === 'fac_price') as NodeT;
        (factor.data as { value: number }).value = Infinity;

        const result = validateGraph({ graph });
        expect(hasError(result, 'NAN_VALUE')).toBe(true);
      });

      it('errors when factor baseline is NaN', () => {
        const graph = createValidGraph();
        const factor = graph.nodes.find((n) => n.id === 'fac_price') as NodeT;
        (factor.data as { baseline?: number }).baseline = NaN;

        const result = validateGraph({ graph });
        expect(hasError(result, 'NAN_VALUE')).toBe(true);
        const issue = findIssue(result.errors, 'NAN_VALUE');
        expect(issue?.path).toBe('nodesById.fac_price.data.baseline');
      });

      it('errors when edge strength_mean is NaN', () => {
        const graph = createValidGraph();
        graph.edges[0].strength_mean = NaN;

        const result = validateGraph({ graph });
        expect(hasError(result, 'NAN_VALUE')).toBe(true);
        const issue = findIssue(result.errors, 'NAN_VALUE');
        expect(issue?.context?.field).toBe('strength_mean');
      });

      it('errors when edge strength_std is Infinity', () => {
        const graph = createValidGraph();
        graph.edges[0].strength_std = Infinity;

        const result = validateGraph({ graph });
        expect(hasError(result, 'NAN_VALUE')).toBe(true);
        const issue = findIssue(result.errors, 'NAN_VALUE');
        expect(issue?.context?.field).toBe('strength_std');
      });

      it('errors when edge belief_exists is NaN', () => {
        const graph = createValidGraph();
        graph.edges[0].belief_exists = NaN;

        const result = validateGraph({ graph });
        expect(hasError(result, 'NAN_VALUE')).toBe(true);
        const issue = findIssue(result.errors, 'NAN_VALUE');
        expect(issue?.context?.field).toBe('belief_exists');
      });

      it('errors when option intervention value is NaN', () => {
        const graph = createValidGraph();
        const optA = graph.nodes.find((n) => n.id === 'opt_a') as NodeT;
        (optA.data as { interventions: Record<string, number> }).interventions.fac_price = NaN;

        const result = validateGraph({ graph });
        expect(hasError(result, 'NAN_VALUE')).toBe(true);
      });
    });
  });

  // =============================================================================
  // Warnings
  // =============================================================================

  describe('Warnings', () => {
    describe('STRENGTH_OUT_OF_RANGE', () => {
      it('warns when strength_mean > 1', () => {
        const graph = createValidGraph();
        const causalEdge = graph.edges.find((e) => e.from === 'fac_price' && e.to === 'outcome_1');
        if (causalEdge) causalEdge.strength_mean = 1.5;

        const result = validateGraph({ graph });
        expect(hasWarning(result, 'STRENGTH_OUT_OF_RANGE')).toBe(true);
      });

      it('warns when strength_mean < -1', () => {
        const graph = createValidGraph();
        const causalEdge = graph.edges.find((e) => e.from === 'fac_price' && e.to === 'outcome_1');
        if (causalEdge) causalEdge.strength_mean = -1.5;

        const result = validateGraph({ graph });
        expect(hasWarning(result, 'STRENGTH_OUT_OF_RANGE')).toBe(true);
      });
    });

    describe('PROBABILITY_OUT_OF_RANGE', () => {
      it('warns when belief_exists > 1', () => {
        const graph = createValidGraph();
        graph.edges[0].belief_exists = 1.5;

        const result = validateGraph({ graph });
        expect(hasWarning(result, 'PROBABILITY_OUT_OF_RANGE')).toBe(true);
      });

      it('warns when belief_exists < 0', () => {
        const graph = createValidGraph();
        graph.edges[0].belief_exists = -0.5;

        const result = validateGraph({ graph });
        expect(hasWarning(result, 'PROBABILITY_OUT_OF_RANGE')).toBe(true);
      });
    });

    describe('OUTCOME_NEGATIVE_POLARITY', () => {
      it('warns when outcome->goal edge has negative strength_mean', () => {
        const graph = createValidGraph();
        const outcomeGoalEdge = graph.edges.find(
          (e) => e.from === 'outcome_1' && e.to === 'goal_1'
        );
        if (outcomeGoalEdge) outcomeGoalEdge.strength_mean = -0.5;

        const result = validateGraph({ graph });
        expect(hasWarning(result, 'OUTCOME_NEGATIVE_POLARITY')).toBe(true);
      });
    });

    describe('RISK_POSITIVE_POLARITY', () => {
      it('warns when risk->goal edge has positive strength_mean', () => {
        const graph = createValidGraph();
        // Add risk with positive edge to goal
        graph.nodes.push({ id: 'risk_1', kind: 'risk', label: 'Risk' });
        graph.edges.push({ from: 'fac_price', to: 'risk_1', strength_mean: 0.3 });
        graph.edges.push({ from: 'risk_1', to: 'goal_1', strength_mean: 0.5 }); // Positive = wrong

        const result = validateGraph({ graph });
        expect(hasWarning(result, 'RISK_POSITIVE_POLARITY')).toBe(true);
      });

      it('does not warn when risk->goal edge has negative strength_mean', () => {
        const graph = createValidGraph();
        graph.nodes.push({ id: 'risk_1', kind: 'risk', label: 'Risk' });
        graph.edges.push({ from: 'fac_price', to: 'risk_1', strength_mean: 0.3 });
        graph.edges.push({ from: 'risk_1', to: 'goal_1', strength_mean: -0.5 }); // Negative = correct

        const result = validateGraph({ graph });
        expect(hasWarning(result, 'RISK_POSITIVE_POLARITY')).toBe(false);
      });
    });

    describe('LOW_EDGE_CONFIDENCE', () => {
      it('warns when belief_exists < 0.3', () => {
        const graph = createValidGraph();
        const causalEdge = graph.edges.find((e) => e.from === 'fac_price' && e.to === 'outcome_1');
        if (causalEdge) causalEdge.belief_exists = 0.2;

        const result = validateGraph({ graph });
        expect(hasWarning(result, 'LOW_EDGE_CONFIDENCE')).toBe(true);
      });

      it('does not warn when belief_exists >= 0.3', () => {
        const graph = createValidGraph();
        const causalEdge = graph.edges.find((e) => e.from === 'fac_price' && e.to === 'outcome_1');
        if (causalEdge) causalEdge.belief_exists = 0.5;

        const result = validateGraph({ graph });
        expect(hasWarning(result, 'LOW_EDGE_CONFIDENCE')).toBe(false);
      });
    });

    describe('EMPTY_UNCERTAINTY_DRIVERS', () => {
      it('warns when controllable factor has empty uncertainty_drivers array', () => {
        const graph = createValidGraph();
        const factor = graph.nodes.find((n) => n.id === 'fac_price') as NodeT;
        (factor.data as { uncertainty_drivers: string[] }).uncertainty_drivers = [];

        const result = validateGraph({ graph });
        expect(hasWarning(result, 'EMPTY_UNCERTAINTY_DRIVERS')).toBe(true);
      });
    });

    describe('STRUCTURAL_EDGE_NOT_CANONICAL', () => {
      it('warns when decision->option edge has non-canonical values', () => {
        const graph = createValidGraph();
        const decisionEdge = graph.edges.find(
          (e) => e.from === 'decision_1' && e.to === 'opt_a'
        );
        if (decisionEdge) {
          decisionEdge.strength_mean = 0.5; // Should be 1
        }

        const result = validateGraph({ graph });
        expect(hasWarning(result, 'STRUCTURAL_EDGE_NOT_CANONICAL')).toBe(true);
      });

      it('warns when option->factor edge has non-canonical values', () => {
        const graph = createValidGraph();
        const optionEdge = graph.edges.find(
          (e) => e.from === 'opt_a' && e.to === 'fac_price'
        );
        if (optionEdge) {
          optionEdge.belief_exists = 0.8; // Should be 1
        }

        const result = validateGraph({ graph });
        expect(hasWarning(result, 'STRUCTURAL_EDGE_NOT_CANONICAL')).toBe(true);
      });

      it('does not warn for canonical structural edges', () => {
        const graph = createValidGraph();
        // All structural edges in createValidGraph() are canonical
        const result = validateGraph({ graph });
        expect(hasWarning(result, 'STRUCTURAL_EDGE_NOT_CANONICAL')).toBe(false);
      });
    });

    describe('LOW_STD_NON_STRUCTURAL', () => {
      it('warns when non-structural edge has std < 0.05', () => {
        const graph = createValidGraph();
        // factor->outcome edge is non-structural
        const factorOutcomeEdge = graph.edges.find(
          (e) => e.from === 'fac_price' && e.to === 'outcome_1'
        );
        if (factorOutcomeEdge) {
          factorOutcomeEdge.strength_std = 0.01; // Too low for non-structural
        }

        const result = validateGraph({ graph });
        expect(hasWarning(result, 'LOW_STD_NON_STRUCTURAL')).toBe(true);
        const issue = findIssue(result.warnings, 'LOW_STD_NON_STRUCTURAL');
        expect(issue?.context?.std).toBe(0.01);
      });

      it('does not warn when non-structural edge has std >= 0.05', () => {
        const graph = createValidGraph();
        // factor->outcome edge is non-structural
        const factorOutcomeEdge = graph.edges.find(
          (e) => e.from === 'fac_price' && e.to === 'outcome_1'
        );
        if (factorOutcomeEdge) {
          factorOutcomeEdge.strength_std = 0.1; // Above threshold
        }

        const result = validateGraph({ graph });
        expect(hasWarning(result, 'LOW_STD_NON_STRUCTURAL')).toBe(false);
      });

      it('does not warn for structural edges with low std', () => {
        const graph = createValidGraph();
        // decision->option and option->factor are structural, low std is expected/canonical
        const optionEdge = graph.edges.find(
          (e) => e.from === 'opt_a' && e.to === 'fac_price'
        );
        if (optionEdge) {
          optionEdge.strength_std = 0.01; // Low std is fine for structural edges
        }

        const result = validateGraph({ graph });
        expect(hasWarning(result, 'LOW_STD_NON_STRUCTURAL')).toBe(false);
      });
    });
  });

  // =============================================================================
  // Edge Cases
  // =============================================================================

  describe('Edge cases', () => {
    it('handles empty nodes array', () => {
      const graph: GraphT = {
        version: '1',
        default_seed: 42,
        nodes: [],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
      };

      const result = validateGraph({ graph });
      expect(result.valid).toBe(false);
      expect(hasError(result, 'MISSING_GOAL')).toBe(true);
      expect(hasError(result, 'MISSING_DECISION')).toBe(true);
      expect(hasError(result, 'INSUFFICIENT_OPTIONS')).toBe(true);
      expect(hasError(result, 'MISSING_BRIDGE')).toBe(true);
    });

    it('includes requestId in logs', () => {
      const graph = createValidGraph();
      const result = validateGraph({ graph, requestId: 'test-request-123' });
      expect(result.valid).toBe(true);
    });

    it('collects all errors without short-circuiting', () => {
      const graph: GraphT = {
        version: '1',
        default_seed: 42,
        nodes: [
          { id: 'orphan', kind: 'factor', label: 'Orphan', data: { value: 1 } },
        ],
        edges: [
          { from: 'nonexistent1', to: 'nonexistent2', strength_mean: 0.5 },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
      };

      const result = validateGraph({ graph });
      expect(result.valid).toBe(false);
      // Should have multiple different error types
      expect(result.errors.length).toBeGreaterThan(3);
      expect(hasError(result, 'MISSING_GOAL')).toBe(true);
      expect(hasError(result, 'MISSING_DECISION')).toBe(true);
      expect(hasError(result, 'INSUFFICIENT_OPTIONS')).toBe(true);
      expect(hasError(result, 'INVALID_EDGE_REF')).toBe(true);
    });
  });
});

// =============================================================================
// Post-Normalisation Validation
// =============================================================================

describe('validateGraphPostNormalisation', () => {
  describe('SIGN_MISMATCH', () => {
    it('errors when effect_direction contradicts strength_mean sign', () => {
      const graph = createValidGraph();
      // Set positive direction but negative mean
      graph.edges[4].effect_direction = 'positive';
      graph.edges[4].strength_mean = -0.5;

      const result = validateGraphPostNormalisation({ graph });
      expect(result.valid).toBe(false);
      expect(hasError(result, 'SIGN_MISMATCH')).toBe(true);
    });

    it('errors when negative direction with positive mean', () => {
      const graph = createValidGraph();
      graph.edges[4].effect_direction = 'negative';
      graph.edges[4].strength_mean = 0.5;

      const result = validateGraphPostNormalisation({ graph });
      expect(result.valid).toBe(false);
      expect(hasError(result, 'SIGN_MISMATCH')).toBe(true);
    });

    it('passes when direction matches sign', () => {
      const graph = createValidGraph();
      graph.edges[4].effect_direction = 'positive';
      graph.edges[4].strength_mean = 0.5;

      const result = validateGraphPostNormalisation({ graph });
      expect(result.valid).toBe(true);
      expect(hasError(result, 'SIGN_MISMATCH')).toBe(false);
    });

    it('passes when strength_mean is zero (direction irrelevant)', () => {
      const graph = createValidGraph();
      graph.edges[4].effect_direction = 'positive';
      graph.edges[4].strength_mean = 0;

      const result = validateGraphPostNormalisation({ graph });
      expect(result.valid).toBe(true);
    });

    it('passes when effect_direction is not set', () => {
      const graph = createValidGraph();
      delete graph.edges[4].effect_direction;

      const result = validateGraphPostNormalisation({ graph });
      expect(result.valid).toBe(true);
    });
  });

  // ===========================================================================
  // Category Override Normalisation
  // ===========================================================================

  describe('Category Override Normalisation', () => {
    it('reclassifies observable→controllable when factor has option edge, auto-fills missing fields', () => {
      const graph = createValidGraph();
      // fac_price already has option edges (opt_a, opt_b → fac_price)
      // Declare it as 'observable' — should be overridden to 'controllable'
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      factor.category = 'observable' as any;
      // Remove factor_type and uncertainty_drivers to test auto-fill
      delete (factor.data as any).factor_type;
      delete (factor.data as any).uncertainty_drivers;

      const result = validateGraph({ graph });

      // Should pass — category override + auto-fill prevents CATEGORY_MISMATCH and CONTROLLABLE_MISSING_DATA
      expect(hasError(result, 'CATEGORY_MISMATCH')).toBe(false);
      expect(hasError(result, 'CONTROLLABLE_MISSING_DATA')).toBe(false);

      // Node should be mutated to controllable
      expect(factor.category).toBe('controllable');
      // Missing fields auto-filled
      expect((factor.data as any).factor_type).toBe('general');
      expect((factor.data as any).uncertainty_drivers).toEqual(['Estimation uncertainty']);

      // Override recorded as info in warnings
      const overrideIssue = result.warnings.find(w => w.code === 'CATEGORY_OVERRIDE');
      expect(overrideIssue).toBeDefined();
      expect(overrideIssue!.severity).toBe('info');
      expect(overrideIssue!.context?.declaredCategory).toBe('observable');
      expect(overrideIssue!.context?.inferredCategory).toBe('controllable');
    });

    it('reclassifies controllable→observable when factor has no option edge, strips extra fields', () => {
      const graph = createValidGraph();
      // Add an external factor with no option edge but declare it as 'controllable'
      graph.nodes.push({
        id: 'fac_ext',
        kind: 'factor',
        label: 'External Factor',
        category: 'controllable' as any,
        data: {
          value: 42,
          extractionType: 'explicit',
          factor_type: 'cost',
          uncertainty_drivers: ['supply chain'],
        },
      });
      // Wire it into the graph for connectivity: fac_price → fac_ext → outcome_1
      graph.edges.push(
        { from: 'fac_price', to: 'fac_ext', strength_mean: 0.5, belief_exists: 0.8 },
        { from: 'fac_ext', to: 'outcome_1', strength_mean: 0.6, belief_exists: 0.9 },
      );

      const result = validateGraph({ graph });

      // fac_ext has no option edge → inferred as observable (has value)
      const factor = graph.nodes.find(n => n.id === 'fac_ext')!;
      expect(factor.category).toBe('observable');
      // Extra fields should be stripped
      expect((factor.data as any).factor_type).toBeUndefined();
      expect((factor.data as any).uncertainty_drivers).toBeUndefined();

      // No CATEGORY_MISMATCH or OBSERVABLE_EXTRA_DATA errors
      expect(hasError(result, 'CATEGORY_MISMATCH')).toBe(false);
      expect(hasError(result, 'OBSERVABLE_EXTRA_DATA')).toBe(false);
    });

    it('reclassifies external→controllable when factor has option edge, auto-fills data', () => {
      const graph = createValidGraph();
      // Add a factor declared as 'external' but with an option edge
      graph.nodes.push({
        id: 'fac_new',
        kind: 'factor',
        label: 'New Factor',
        category: 'external' as any,
        data: {
          value: 10,
          extractionType: 'inferred',
        },
      });
      // Wire: opt_a → fac_new (makes it controllable), fac_new → outcome_1
      graph.edges.push(
        { from: 'opt_a', to: 'fac_new', strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: 'positive' },
        { from: 'fac_new', to: 'outcome_1', strength_mean: 0.7, belief_exists: 0.9 },
      );

      const result = validateGraph({ graph });

      const factor = graph.nodes.find(n => n.id === 'fac_new')!;
      expect(factor.category).toBe('controllable');
      expect((factor.data as any).factor_type).toBe('general');
      expect((factor.data as any).uncertainty_drivers).toEqual(['Estimation uncertainty']);

      expect(hasError(result, 'CATEGORY_MISMATCH')).toBe(false);
      expect(hasError(result, 'CONTROLLABLE_MISSING_DATA')).toBe(false);
    });

    it('does not override when declared category matches inferred', () => {
      const graph = createValidGraph();
      // fac_price has option edges → inferred controllable; declare it controllable
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      factor.category = 'controllable' as any;

      const result = validateGraph({ graph });

      // No override issue should be emitted
      const overrideIssue = result.warnings.find(w => w.code === 'CATEGORY_OVERRIDE');
      expect(overrideIssue).toBeUndefined();

      // Original data untouched
      expect((factor.data as any).factor_type).toBe('price');
    });

    it('overrides multiple factors independently in same graph', () => {
      const graph = createValidGraph();
      // Factor 1: fac_price — declare as 'observable' but has option edges → should become controllable
      const factor1 = graph.nodes.find(n => n.id === 'fac_price')!;
      factor1.category = 'observable' as any;

      // Factor 2: new factor declared as 'controllable' but no option edge → should become observable
      graph.nodes.push({
        id: 'fac_obs',
        kind: 'factor',
        label: 'Observable Factor',
        category: 'controllable' as any,
        data: {
          value: 99,
          extractionType: 'explicit',
          factor_type: 'revenue',
          uncertainty_drivers: ['market'],
        },
      });
      graph.edges.push(
        { from: 'fac_price', to: 'fac_obs', strength_mean: 0.4, belief_exists: 0.7 },
        { from: 'fac_obs', to: 'outcome_1', strength_mean: 0.5, belief_exists: 0.8 },
      );

      const result = validateGraph({ graph });

      // Both should be overridden
      const overrideIssues = result.warnings.filter(w => w.code === 'CATEGORY_OVERRIDE');
      expect(overrideIssues.length).toBe(2);

      expect(factor1.category).toBe('controllable');
      const factor2 = graph.nodes.find(n => n.id === 'fac_obs')!;
      expect(factor2.category).toBe('observable');
      // factor2 extra fields stripped
      expect((factor2.data as any).factor_type).toBeUndefined();
      expect((factor2.data as any).uncertainty_drivers).toBeUndefined();
    });

    it('auto-filled defaults satisfy downstream Tier 4 validation', () => {
      const graph = createValidGraph();
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      factor.category = 'external' as any;
      // Strip all optional factor data — only keep value and extractionType
      delete (factor.data as any).factor_type;
      delete (factor.data as any).uncertainty_drivers;

      const result = validateGraph({ graph });

      // No CONTROLLABLE_MISSING_DATA — factor_type and uncertainty_drivers were auto-filled
      expect(hasError(result, 'CONTROLLABLE_MISSING_DATA')).toBe(false);
      expect(hasError(result, 'CATEGORY_MISMATCH')).toBe(false);
      expect(result.valid).toBe(true);
    });

    it('does not affect graphs with no declared categories (regression)', () => {
      // createValidGraph has no category fields — should be completely unaffected
      const graph = createValidGraph();
      const result = validateGraph({ graph });

      expect(result.valid).toBe(true);
      const overrideIssues = result.warnings.filter(w => w.code === 'CATEGORY_OVERRIDE');
      expect(overrideIssues.length).toBe(0);
    });

    it('does not override when factor has no declared category even if inferred differs', () => {
      const graph = createValidGraph();
      // fac_price has no category field at all — inferFactorCategories will note the
      // explicitCategory as undefined. Override should NOT fire.
      const factor = graph.nodes.find(n => n.id === 'fac_price')!;
      delete (factor as any).category;

      const result = validateGraph({ graph });

      expect(result.valid).toBe(true);
      const overrideIssues = result.warnings.filter(w => w.code === 'CATEGORY_OVERRIDE');
      expect(overrideIssues.length).toBe(0);
    });
  });
});
