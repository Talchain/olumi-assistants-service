/**
 * Structural Graph Validator (Pre-validation)
 *
 * Validates the structural integrity of a candidate graph after
 * applying PatchOperations, before the patch is proposed to the user.
 *
 * Checks run exhaustively (no short-circuit) — all violations are reported.
 *
 * Limits: configurable via CEE_GRAPH_MAX_NODES / CEE_GRAPH_MAX_EDGES env vars
 * (defaults: 20 nodes, 30 edges). These are AI mutation safety limits, deliberately
 * stricter than PLoT's platform limits (50/100). They constrain per-turn graph
 * mutations to keep patches reviewable. PLoT remains the canonical validation
 * authority for absolute graph size.
 */

import type { GraphV3T } from "../schemas/cee-v3.js";

// ============================================================================
// Types
// ============================================================================

export type StructuralViolationCode =
  | 'ORPHAN_NODE'
  | 'NO_PATH_TO_GOAL'
  | 'CYCLE_DETECTED'
  | 'NODE_LIMIT_EXCEEDED'
  | 'EDGE_LIMIT_EXCEEDED'
  | 'NO_GOAL'
  | 'NO_DECISION'
  | 'FEWER_THAN_TWO_OPTIONS';

export interface StructuralViolation {
  code: StructuralViolationCode;
  detail: string;
}

export interface StructuralValidationResult {
  valid: boolean;
  violations: StructuralViolation[];
}

// ============================================================================
// Constants
// ============================================================================

// AI mutation safety limits — deliberately stricter than PLoT's platform limits (50/100).
// They constrain per-turn graph mutations to keep patches reviewable.
// PLoT remains the canonical validation authority for absolute graph size.
const DEFAULT_MAX_NODES = 20;
const DEFAULT_MAX_EDGES = 30;

function parseEnvInt(envVar: string | undefined, fallback: number): number {
  if (!envVar) return fallback;
  const parsed = parseInt(envVar, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const MAX_NODES = parseEnvInt(process.env.CEE_GRAPH_MAX_NODES, DEFAULT_MAX_NODES);
const MAX_EDGES = parseEnvInt(process.env.CEE_GRAPH_MAX_EDGES, DEFAULT_MAX_EDGES);
const MIN_OPTIONS = 2;

// ============================================================================
// User-facing violation messages
// ============================================================================

export const VIOLATION_MESSAGES: Record<StructuralViolationCode, string> = {
  ORPHAN_NODE: 'This change would leave a node with no connections.',
  NO_PATH_TO_GOAL: 'This change would leave a node that cannot reach the goal.',
  CYCLE_DETECTED: 'This change would create a circular dependency in the model.',
  NODE_LIMIT_EXCEEDED: `The model would exceed the ${MAX_NODES}-node limit.`,
  EDGE_LIMIT_EXCEEDED: `The model would exceed the ${MAX_EDGES}-edge limit.`,
  NO_GOAL: 'The model would have no goal node.',
  NO_DECISION: 'The model would have no decision node.',
  FEWER_THAN_TWO_OPTIONS: 'The model would have fewer than two options.',
};

// ============================================================================
// Validator
// ============================================================================

/**
 * Validate the structural integrity of a graph.
 *
 * All checks run exhaustively — no short-circuit.
 * Returns all violations found.
 */
export function validateGraphStructure(graph: GraphV3T): StructuralValidationResult {
  const violations: StructuralViolation[] = [];

  checkRequiredNodeKinds(graph, violations);
  checkLimits(graph, violations);
  checkOrphanNodes(graph, violations);
  checkPathToGoal(graph, violations);
  checkCycles(graph, violations);

  return {
    valid: violations.length === 0,
    violations,
  };
}

// ============================================================================
// Individual Checks
// ============================================================================

function checkRequiredNodeKinds(graph: GraphV3T, violations: StructuralViolation[]): void {
  const hasGoal = graph.nodes.some((n) => n.kind === 'goal');
  const hasDecision = graph.nodes.some((n) => n.kind === 'decision');
  const optionCount = graph.nodes.filter((n) => n.kind === 'option').length;

  if (!hasGoal) {
    violations.push({ code: 'NO_GOAL', detail: 'No goal node in graph' });
  }
  if (!hasDecision) {
    violations.push({ code: 'NO_DECISION', detail: 'No decision node in graph' });
  }
  if (optionCount < MIN_OPTIONS) {
    violations.push({
      code: 'FEWER_THAN_TWO_OPTIONS',
      detail: `Only ${optionCount} option node(s) — minimum is ${MIN_OPTIONS}`,
    });
  }
}

function checkLimits(graph: GraphV3T, violations: StructuralViolation[]): void {
  if (graph.nodes.length > MAX_NODES) {
    violations.push({
      code: 'NODE_LIMIT_EXCEEDED',
      detail: `${graph.nodes.length} nodes exceeds limit of ${MAX_NODES}`,
    });
  }
  if (graph.edges.length > MAX_EDGES) {
    violations.push({
      code: 'EDGE_LIMIT_EXCEEDED',
      detail: `${graph.edges.length} edges exceeds limit of ${MAX_EDGES}`,
    });
  }
}

function checkOrphanNodes(graph: GraphV3T, violations: StructuralViolation[]): void {
  // Build set of nodes that have at least one edge (directed or bidirected)
  const connected = new Set<string>();
  for (const edge of graph.edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }

  for (const node of graph.nodes) {
    if (!connected.has(node.id)) {
      violations.push({
        code: 'ORPHAN_NODE',
        detail: `Node "${node.id}" (${node.label}) has no edges`,
      });
    }
  }
}

function isDirected(edge: GraphV3T['edges'][number]): boolean {
  // Treat absent edge_type as 'directed' (backward compat, matches schemas/graph.ts)
  return (edge as Record<string, unknown>).edge_type !== 'bidirected';
}

function checkPathToGoal(graph: GraphV3T, violations: StructuralViolation[]): void {
  const goalNodes = graph.nodes.filter((n) => n.kind === 'goal');
  if (goalNodes.length === 0) return; // Already caught by NO_GOAL check

  const decisionNodes = graph.nodes.filter((n) => n.kind === 'decision');
  if (decisionNodes.length === 0) return; // Already caught by NO_DECISION check

  // Build forward adjacency list — skip bidirected edges (unmeasured confounders)
  const forward = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!isDirected(edge)) continue;
    if (!forward.has(edge.from)) forward.set(edge.from, new Set());
    forward.get(edge.from)!.add(edge.to);
  }

  // BFS from each decision node to find all reachable nodes
  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const dec of decisionNodes) {
    queue.push(dec.id);
    reachable.add(dec.id);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbours = forward.get(current);
    if (neighbours) {
      for (const next of neighbours) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }
  }

  // Check if every goal is reachable
  for (const goal of goalNodes) {
    if (!reachable.has(goal.id)) {
      violations.push({
        code: 'NO_PATH_TO_GOAL',
        detail: `Goal node "${goal.id}" (${goal.label}) not reachable from decision node`,
      });
    }
  }

  // Check non-decision/non-goal nodes that are unreachable
  for (const node of graph.nodes) {
    if (node.kind === 'decision') continue; // Decision is the source
    if (reachable.has(node.id)) continue;
    // Already caught by orphan check if it has no edges at all
    // But a node might have edges yet be disconnected from the decision
    const hasAnyEdge = graph.edges.some((e) => e.from === node.id || e.to === node.id);
    if (hasAnyEdge) {
      violations.push({
        code: 'NO_PATH_TO_GOAL',
        detail: `Node "${node.id}" (${node.label}) not reachable from decision via directed paths`,
      });
    }
  }
}

function checkCycles(graph: GraphV3T, violations: StructuralViolation[]): void {
  // Build forward adjacency list — skip bidirected edges (not directed paths)
  const forward = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!isDirected(edge)) continue;
    if (!forward.has(edge.from)) forward.set(edge.from, []);
    forward.get(edge.from)!.push(edge.to);
  }

  // DFS cycle detection
  const WHITE = 0; // unvisited
  const GRAY = 1;  // in current path
  const BLACK = 2; // fully processed

  const color = new Map<string, number>();
  for (const node of graph.nodes) {
    color.set(node.id, WHITE);
  }

  let cycleFound = false;

  function dfs(nodeId: string): void {
    if (cycleFound) return; // One cycle is sufficient evidence
    color.set(nodeId, GRAY);

    const neighbours = forward.get(nodeId) ?? [];
    for (const next of neighbours) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        cycleFound = true;
        return;
      }
      if (c === WHITE) {
        dfs(next);
        if (cycleFound) return;
      }
    }

    color.set(nodeId, BLACK);
  }

  for (const node of graph.nodes) {
    if (color.get(node.id) === WHITE) {
      dfs(node.id);
      if (cycleFound) break;
    }
  }

  if (cycleFound) {
    violations.push({
      code: 'CYCLE_DETECTED',
      detail: 'Directed cycle detected in graph',
    });
  }
}
