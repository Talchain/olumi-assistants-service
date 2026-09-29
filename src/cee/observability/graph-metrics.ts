/**
 * Graph Quality Metrics Computation
 *
 * Computes metrics from a validated/repaired graph for observability.
 * Used by debug panel to show graph quality indicators.
 *
 * @module cee/observability/graph-metrics
 */

import type { GraphQualityMetrics } from "./types.js";
import type { GraphT, NodeT, EdgeT } from "../../schemas/graph.js";
import type { GraphValidationResult } from "../../validators/graph-validator.types.js";
import type { RepairRecord } from "../structure/index.js";

// ============================================================================
// Types
// ============================================================================

export interface ComputeGraphMetricsInput {
  /** The validated/repaired graph */
  graph: GraphT;
  /** Validation result (optional) */
  validationResult?: GraphValidationResult;
  /** Repair records (optional) */
  repairs?: RepairRecord[];
}

// ============================================================================
// Node Kind Counting
// ============================================================================

interface NodeCounts {
  factor: number;
  option: number;
  outcome: number;
  risk: number;
  decision: number;
  goal: number;
  total: number;
}

function countNodesByKind(nodes: NodeT[]): NodeCounts {
  const counts: NodeCounts = {
    factor: 0,
    option: 0,
    outcome: 0,
    risk: 0,
    decision: 0,
    goal: 0,
    total: nodes.length,
  };

  for (const node of nodes) {
    const kind = node.kind;
    if (kind in counts) {
      counts[kind as keyof NodeCounts]++;
    }
  }

  return counts;
}

// ============================================================================
// Edge Classification
// ============================================================================

interface EdgeCounts {
  structural: number;
  causal: number;
  total: number;
}

function classifyEdges(edges: EdgeT[], nodeMap: Map<string, NodeT>): EdgeCounts {
  const counts: EdgeCounts = {
    structural: 0,
    causal: 0,
    total: edges.length,
  };

  for (const edge of edges) {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);

    if (!fromNode || !toNode) continue;

    // Structural edges: decision→option, option→factor
    if (
      (fromNode.kind === "decision" && toNode.kind === "option") ||
      (fromNode.kind === "option" && toNode.kind === "factor")
    ) {
      counts.structural++;
    } else {
      // All other edges are causal
      counts.causal++;
    }
  }

  return counts;
}

// ============================================================================
// Topology Analysis
// ============================================================================

/**
 * Find nodes with no incoming or outgoing edges.
 */
function findOrphanNodes(nodes: NodeT[], edges: EdgeT[]): number {
  const nodesWithEdges = new Set<string>();

  for (const edge of edges) {
    nodesWithEdges.add(edge.from);
    nodesWithEdges.add(edge.to);
  }

  let orphanCount = 0;
  for (const node of nodes) {
    if (!nodesWithEdges.has(node.id)) {
      orphanCount++;
    }
  }

  return orphanCount;
}

/**
 * Count disconnected subgraphs using union-find.
 * A valid graph should have exactly 1 connected component.
 */
function countDisconnectedSubgraphs(nodes: NodeT[], edges: EdgeT[]): number {
  if (nodes.length === 0) return 0;

  // Union-find parent map
  const parent = new Map<string, string>();

  function find(x: string): string {
    if (!parent.has(x)) {
      parent.set(x, x);
    }
    if (parent.get(x) !== x) {
      parent.set(x, find(parent.get(x)!));
    }
    return parent.get(x)!;
  }

  function union(x: string, y: string): void {
    const px = find(x);
    const py = find(y);
    if (px !== py) {
      parent.set(px, py);
    }
  }

  // Initialize all nodes
  for (const node of nodes) {
    find(node.id);
  }

  // Union connected nodes
  for (const edge of edges) {
    union(edge.from, edge.to);
  }

  // Count unique roots
  const roots = new Set<string>();
  for (const node of nodes) {
    roots.add(find(node.id));
  }

  return roots.size;
}

/**
 * Find the maximum path depth from decision to goal.
 * Uses BFS from decision node.
 */
function findMaxPathDepth(nodes: NodeT[], edges: EdgeT[]): number {
  const decisionNode = nodes.find((n) => n.kind === "decision");
  const goalNode = nodes.find((n) => n.kind === "goal");

  if (!decisionNode || !goalNode) return 0;

  // Build adjacency list
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) {
      adjacency.set(edge.from, []);
    }
    adjacency.get(edge.from)!.push(edge.to);
  }

  // BFS to find max depth
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: decisionNode.id, depth: 0 }];
  let maxDepth = 0;

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;

    if (visited.has(id)) continue;
    visited.add(id);

    maxDepth = Math.max(maxDepth, depth);

    const neighbors = adjacency.get(id) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        queue.push({ id: neighbor, depth: depth + 1 });
      }
    }
  }

  return maxDepth;
}

// ============================================================================
// Data Quality Analysis
// ============================================================================

interface CategoryCounts {
  withCategory: number;
  missingCategory: number;
}

function countFactorCategories(nodes: NodeT[]): CategoryCounts {
  const factors = nodes.filter((n) => n.kind === "factor");
  let withCategory = 0;
  let missingCategory = 0;

  for (const factor of factors) {
    if ((factor as any).category) {
      withCategory++;
    } else {
      missingCategory++;
    }
  }

  return { withCategory, missingCategory };
}

// ============================================================================
// Main Computation Function
// ============================================================================

/**
 * Compute graph quality metrics from a validated/repaired graph.
 *
 * @param input - Graph, validation result, and repair records
 * @returns GraphQualityMetrics object
 */
export function computeGraphMetrics(input: ComputeGraphMetricsInput): GraphQualityMetrics {
  const { graph, validationResult, repairs = [] } = input;

  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];

  // Build node map for edge classification
  const nodeMap = new Map<string, NodeT>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // Compute counts
  const nodeCounts = countNodesByKind(nodes);
  const edgeCounts = classifyEdges(edges, nodeMap);
  const categoryCounts = countFactorCategories(nodes);

  // Compute topology metrics
  const orphanNodes = findOrphanNodes(nodes, edges);
  const disconnectedSubgraphs = countDisconnectedSubgraphs(nodes, edges);
  const maxPathDepth = findMaxPathDepth(nodes, edges);

  // Extract validation info
  const validationPassed = validationResult?.valid ?? true;
  const validationErrors = validationResult?.errors.map((e) => e.code) ?? [];
  const validationWarnings = validationResult?.warnings.map((w) => w.code) ?? [];

  // Count repairs
  const repairsApplied = repairs.length;
  const repairCodes = [...new Set(repairs.map((r) => r.field))];
  const edgesRepaired = new Set(repairs.map((r) => r.edge_id)).size;

  return {
    // Structure
    node_count: nodeCounts.total,
    edge_count: edgeCounts.total,
    factor_count: nodeCounts.factor,
    option_count: nodeCounts.option,
    outcome_count: nodeCounts.outcome,
    risk_count: nodeCounts.risk,

    // Validation
    validation_passed: validationPassed,
    validation_errors: validationErrors,
    validation_warnings: validationWarnings,
    repairs_applied: repairsApplied,
    repair_codes: repairCodes,

    // Topology
    orphan_nodes: orphanNodes,
    disconnected_subgraphs: disconnectedSubgraphs,
    max_path_depth: maxPathDepth,

    // Data Quality
    factors_with_category: categoryCounts.withCategory,
    factors_missing_category: categoryCounts.missingCategory,
    structural_edges: edgeCounts.structural,
    causal_edges: edgeCounts.causal,
    edges_repaired: edgesRepaired,
  };
}
