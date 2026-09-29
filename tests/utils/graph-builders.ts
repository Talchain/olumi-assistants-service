/**
 * Shared Graph Builder Utilities for Tests
 *
 * Provides common graph construction patterns used across test files.
 * These builders create valid graph structures that satisfy the GraphT schema.
 *
 * Usage:
 *   import { createMinimalValidGraph, createGraphWithOptions } from '../utils/graph-builders.js';
 *   const graph = createMinimalValidGraph();
 */

import type { GraphT, NodeT, EdgeT } from '../../src/schemas/graph.js';

/**
 * Create a minimal valid graph for testing.
 * Structure: decision -> [opt_a, opt_b] -> factor -> outcome -> goal
 *
 * This graph satisfies all validation tiers and can be used as a baseline
 * for tests that need a valid starting point.
 */
export function createMinimalValidGraph(): GraphT {
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

/**
 * Create a graph with a specified number of options.
 * Useful for testing option count validation (MIN_OPTIONS, MAX_OPTIONS).
 */
export function createGraphWithOptions(optionCount: number): GraphT {
  const nodes: NodeT[] = [
    { id: 'decision_1', kind: 'decision', label: 'Which option?' },
  ];
  const edges: EdgeT[] = [];

  // Add options
  for (let i = 1; i <= optionCount; i++) {
    nodes.push({
      id: `opt_${i}`,
      kind: 'option',
      label: `Option ${i}`,
      data: { interventions: { fac_1: i * 100 } },
    });
    edges.push({
      from: 'decision_1',
      to: `opt_${i}`,
      strength_mean: 1,
      belief_exists: 1,
    });
  }

  // Add factor, outcome, goal
  nodes.push(
    {
      id: 'fac_1',
      kind: 'factor',
      label: 'Factor 1',
      data: { value: 100, extractionType: 'explicit', factor_type: 'price', uncertainty_drivers: [] },
    },
    { id: 'outcome_1', kind: 'outcome', label: 'Outcome 1' },
    { id: 'goal_1', kind: 'goal', label: 'Goal 1' }
  );

  // Connect options to factor with required fields
  for (let i = 1; i <= optionCount; i++) {
    edges.push({
      from: `opt_${i}`,
      to: 'fac_1',
      strength_mean: 1,
      strength_std: 0.01,
      belief_exists: 1,
      effect_direction: 'positive',
    });
  }

  // Add remaining edges
  edges.push(
    { from: 'fac_1', to: 'outcome_1', strength_mean: 0.8, belief_exists: 0.9 },
    { from: 'outcome_1', to: 'goal_1', strength_mean: 0.9, belief_exists: 1 }
  );

  return {
    version: '1',
    default_seed: 42,
    nodes,
    edges,
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
  };
}

/**
 * Create a minimal graph with only the required node kinds.
 * Useful for testing missing node detection.
 */
export function createGraphWithNodeKinds(
  kinds: Array<'decision' | 'option' | 'factor' | 'outcome' | 'goal' | 'risk'>
): GraphT {
  const nodes: NodeT[] = [];
  const edges: EdgeT[] = [];
  let nodeIndex = 1;

  const addedKinds: Record<string, string> = {};

  for (const kind of kinds) {
    const id = `${kind}_${nodeIndex++}`;
    const node: NodeT = { id, kind, label: `${kind} node` };

    if (kind === 'option') {
      node.data = { interventions: {} };
    } else if (kind === 'factor') {
      node.data = { value: 100, extractionType: 'explicit', factor_type: 'price', uncertainty_drivers: [] };
    }

    nodes.push(node);
    addedKinds[kind] = id;
  }

  // Add basic edges if we have the right nodes
  if (addedKinds.decision && addedKinds.option) {
    edges.push({ from: addedKinds.decision, to: addedKinds.option, strength_mean: 1, belief_exists: 1 });
  }
  if (addedKinds.option && addedKinds.factor) {
    edges.push({
      from: addedKinds.option,
      to: addedKinds.factor,
      strength_mean: 1,
      strength_std: 0.01,
      belief_exists: 1,
      effect_direction: 'positive',
    });
  }
  if (addedKinds.factor && addedKinds.outcome) {
    edges.push({ from: addedKinds.factor, to: addedKinds.outcome, strength_mean: 0.8, belief_exists: 0.9 });
  }
  if (addedKinds.outcome && addedKinds.goal) {
    edges.push({ from: addedKinds.outcome, to: addedKinds.goal, strength_mean: 0.9, belief_exists: 1 });
  }

  return {
    version: '1',
    default_seed: 42,
    nodes,
    edges,
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
  };
}

/**
 * Create an empty graph with no nodes or edges.
 * Useful for testing empty graph handling.
 */
export function createEmptyGraph(): GraphT {
  return {
    version: '1',
    default_seed: 42,
    nodes: [],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
  };
}

/**
 * Deep clone a graph to avoid mutation between tests.
 */
export function cloneGraph(graph: GraphT): GraphT {
  return JSON.parse(JSON.stringify(graph)) as GraphT;
}

/**
 * Add a node to a graph (returns new graph, does not mutate).
 */
export function addNode(graph: GraphT, node: NodeT): GraphT {
  const cloned = cloneGraph(graph);
  cloned.nodes.push(node);
  return cloned;
}

/**
 * Add an edge to a graph (returns new graph, does not mutate).
 */
export function addEdge(graph: GraphT, edge: EdgeT): GraphT {
  const cloned = cloneGraph(graph);
  cloned.edges.push(edge);
  return cloned;
}

/**
 * Remove a node and its edges from a graph (returns new graph).
 */
export function removeNode(graph: GraphT, nodeId: string): GraphT {
  const cloned = cloneGraph(graph);
  cloned.nodes = cloned.nodes.filter((n) => n.id !== nodeId);
  cloned.edges = cloned.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
  return cloned;
}
