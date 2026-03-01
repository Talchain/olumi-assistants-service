/**
 * Structural validator for decision graphs.
 *
 * Core traversal functions (buildNodeMap, buildAdjacencyLists, bfsForward,
 * bfsReverse, hasCycle, buildInterventionSignature) are adapted from
 * src/validators/graph-validator.ts in the parent CEE service. They are
 * copied here rather than imported to avoid the telemetry.ts side-effects
 * (pino logger, hot-shots StatsD client) that the parent module pulls in.
 *
 * Equivalence tests in tests/scorer.test.ts verify the cycle-detection and
 * reachability logic produces identical pass/fail results for known fixtures.
 */

import type { ParsedGraph, GraphNode, GraphEdge } from "./types.js";

// =============================================================================
// Constants
// =============================================================================

export const NODE_LIMIT = 50;
export const EDGE_LIMIT = 100;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

// =============================================================================
// Internal helpers
// =============================================================================

interface NodeMap {
  byId: Map<string, GraphNode>;
  byKind: Map<string, GraphNode[]>;
}

interface AdjacencyLists {
  forward: Map<string, string[]>;
  reverse: Map<string, string[]>;
}

/** Build node lookup maps for efficient access. */
export function buildNodeMap(nodes: GraphNode[]): NodeMap {
  const byId = new Map<string, GraphNode>();
  const byKind = new Map<string, GraphNode[]>();

  for (const node of nodes) {
    byId.set(node.id, node);
    const kindList = byKind.get(node.kind) ?? [];
    kindList.push(node);
    byKind.set(node.kind, kindList);
  }

  return { byId, byKind };
}

/** Returns true if the edge is a directed (non-bidirected) edge. */
function isDirectedEdge(edge: GraphEdge): boolean {
  return edge.edge_type !== "bidirected";
}

/** Build forward and reverse adjacency lists (directed edges only). */
export function buildAdjacencyLists(edges: GraphEdge[]): AdjacencyLists {
  const forward = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();

  for (const edge of edges) {
    if (!isDirectedEdge(edge)) continue;

    const fwdList = forward.get(edge.from) ?? [];
    fwdList.push(edge.to);
    forward.set(edge.from, fwdList);

    const revList = reverse.get(edge.to) ?? [];
    revList.push(edge.from);
    reverse.set(edge.to, revList);
  }

  return { forward, reverse };
}

/** BFS forward traversal from a set of starting nodes. */
export function bfsForward(
  startNodes: string[],
  adjacency: AdjacencyLists
): Set<string> {
  const visited = new Set<string>();
  const queue = [...startNodes];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = adjacency.forward.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }

  return visited;
}

/** BFS reverse traversal — returns all nodes that can reach startNodes. */
export function bfsReverse(
  startNodes: string[],
  adjacency: AdjacencyLists
): Set<string> {
  const visited = new Set<string>();
  const queue = [...startNodes];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = adjacency.reverse.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }

  return visited;
}

/**
 * Detect cycles using Kahn's algorithm (topological sort).
 * Bidirected edges are excluded — they represent unmeasured confounders, not
 * directed paths, so they cannot form structural cycles.
 *
 * Returns true if a cycle exists.
 */
export function hasCycle(nodes: GraphNode[], edges: GraphEdge[]): boolean {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    if (!isDirectedEdge(edge)) continue;
    const list = adjacency.get(edge.from);
    if (list) list.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  let processedCount = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processedCount++;

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return processedCount !== nodes.length;
}

/**
 * Build a canonical intervention signature for an option node.
 * Floats are rounded to 4dp for stability — differences beyond that are
 * treated as negligible for identity comparison.
 */
export function buildInterventionSignature(
  interventions: Record<string, number>
): string {
  const entries = Object.entries(interventions)
    .map(([factorId, value]) => `${factorId}:${value.toFixed(4)}`)
    .sort();
  return entries.join("|");
}

// =============================================================================
// Forbidden edge types
// =============================================================================

/** Edge pairs (from_kind → to_kind) that are explicitly forbidden. */
const FORBIDDEN_EDGE_KINDS: Array<[string, string]> = [
  ["option", "outcome"],
  ["option", "risk"],
  ["option", "goal"],
  ["factor", "goal"],
  ["decision", "factor"],
  ["decision", "outcome"],
  ["decision", "risk"],
  ["outcome", "outcome"],
  ["risk", "risk"],
  ["outcome", "risk"],
  ["risk", "outcome"],
];

// =============================================================================
// Structural validation
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  violations: string[];
}

/**
 * Run all structural validity checks on a parsed graph.
 * Returns a list of violation codes — empty means valid.
 *
 * Checks:
 * 1.  Exactly 1 goal node
 * 2.  Exactly 1 decision node
 * 3.  2–6 option nodes
 * 4.  ≥1 outcome or risk node
 * 5.  No cycles in directed edges
 * 6.  No forbidden edge types (by node kind)
 * 7.  Every controllable factor has ≥1 incoming option→factor edge
 * 8.  Every outcome/risk is reachable from decision via controllable factor
 * 9.  Every option has a path through controllable factors to the goal
 * 10. No orphan nodes
 * 11. ≤50 nodes, ≤100 edges
 * 12. All edge from/to IDs reference existing nodes
 */
export function validateStructural(graph: ParsedGraph): ValidationResult {
  const violations: string[] = [];
  const { nodes, edges } = graph;

  const nodeMap = buildNodeMap(nodes);
  const adjacency = buildAdjacencyLists(edges);

  // ── 12. Edge reference integrity ──────────────────────────────────────────
  for (const edge of edges) {
    if (!nodeMap.byId.has(edge.from) || !nodeMap.byId.has(edge.to)) {
      violations.push("INVALID_EDGE_REF");
      break;
    }
  }

  // ── 1. Exactly 1 goal ─────────────────────────────────────────────────────
  const goals = nodeMap.byKind.get("goal") ?? [];
  if (goals.length !== 1) violations.push("MISSING_GOAL");

  // ── 2. Exactly 1 decision ─────────────────────────────────────────────────
  const decisions = nodeMap.byKind.get("decision") ?? [];
  if (decisions.length !== 1) violations.push("MISSING_DECISION");

  // ── 3. 2–6 options ────────────────────────────────────────────────────────
  const options = nodeMap.byKind.get("option") ?? [];
  if (options.length < MIN_OPTIONS) violations.push("INSUFFICIENT_OPTIONS");
  if (options.length > MAX_OPTIONS) violations.push("TOO_MANY_OPTIONS");

  // ── 4. ≥1 outcome or risk ─────────────────────────────────────────────────
  const outcomes = nodeMap.byKind.get("outcome") ?? [];
  const risks = nodeMap.byKind.get("risk") ?? [];
  if (outcomes.length + risks.length === 0) violations.push("MISSING_BRIDGE");

  // ── 11. Node / edge limits ────────────────────────────────────────────────
  if (nodes.length > NODE_LIMIT) violations.push("NODE_LIMIT_EXCEEDED");
  if (edges.length > EDGE_LIMIT) violations.push("EDGE_LIMIT_EXCEEDED");

  // ── 5. No cycles ──────────────────────────────────────────────────────────
  if (hasCycle(nodes, edges)) violations.push("CYCLE_DETECTED");

  // ── 6. No forbidden edge types ────────────────────────────────────────────
  for (const edge of edges) {
    if (!isDirectedEdge(edge)) continue; // bidirected edges exempt
    const fromNode = nodeMap.byId.get(edge.from);
    const toNode = nodeMap.byId.get(edge.to);
    if (!fromNode || !toNode) continue;

    for (const [fromKind, toKind] of FORBIDDEN_EDGE_KINDS) {
      if (fromNode.kind === fromKind && toNode.kind === toKind) {
        violations.push("FORBIDDEN_EDGE");
        break;
      }
    }
  }

  // ── 7. Every controllable factor has ≥1 incoming option→factor edge ───────
  const factorsWithOptionEdge = new Set<string>();
  for (const edge of edges) {
    if (!isDirectedEdge(edge)) continue;
    const fromNode = nodeMap.byId.get(edge.from);
    const toNode = nodeMap.byId.get(edge.to);
    if (fromNode?.kind === "option" && toNode?.kind === "factor") {
      factorsWithOptionEdge.add(edge.to);
    }
  }

  const factors = nodeMap.byKind.get("factor") ?? [];
  const controllableFactors = factors.filter(
    (f) =>
      f.category === "controllable" ||
      // Infer controllable from structure if category not set
      factorsWithOptionEdge.has(f.id)
  );

  for (const factor of controllableFactors) {
    if (!factorsWithOptionEdge.has(factor.id)) {
      violations.push("CONTROLLABLE_NO_OPTION_EDGE");
      break;
    }
  }

  // ── 8. Every outcome/risk reachable from decision via controllable factor ──
  // Path must go: decision → option → controllable factor → ... → outcome/risk
  const bridgeNodes = [...outcomes, ...risks];
  if (decisions.length === 1 && bridgeNodes.length > 0) {
    const decisionId = decisions[0].id;

    // Find nodes reachable from decision through controllable factors
    // (decision → option → controllable factor → downstream)
    const reachableThroughControllable = new Set<string>();
    for (const option of options) {
      // From each option, BFS forward to find what controllable factors they set
      const optionReachable = bfsForward([option.id], adjacency);
      for (const nodeId of optionReachable) {
        const n = nodeMap.byId.get(nodeId);
        if (
          n?.kind === "factor" &&
          (n.category === "controllable" || factorsWithOptionEdge.has(n.id))
        ) {
          // This controllable factor is reachable; continue BFS from it
          const downstreamFromFactor = bfsForward([n.id], adjacency);
          for (const d of downstreamFromFactor) reachableThroughControllable.add(d);
        }
      }
    }

    // Verify each bridge node is reachable
    for (const bridge of bridgeNodes) {
      if (!reachableThroughControllable.has(bridge.id)) {
        violations.push("OUTCOME_UNREACHABLE");
        break;
      }
    }
  }

  // ── 9. Every option has a path through controllable factors to goal ────────
  if (goals.length === 1) {
    const goalId = goals[0].id;
    for (const option of options) {
      // Find controllable factors this option can reach
      const optionForward = bfsForward([option.id], adjacency);
      let pathExists = false;

      for (const nodeId of optionForward) {
        const n = nodeMap.byId.get(nodeId);
        if (
          n?.kind === "factor" &&
          (n.category === "controllable" || factorsWithOptionEdge.has(n.id))
        ) {
          // Check if this factor can reach the goal
          const factorForward = bfsForward([n.id], adjacency);
          if (factorForward.has(goalId)) {
            pathExists = true;
            break;
          }
        }
      }

      if (!pathExists) {
        violations.push("OPTION_NO_GOAL_PATH");
        break;
      }
    }
  }

  // ── 10. No orphan nodes ────────────────────────────────────────────────────
  // A node is an orphan if it is neither reachable from the decision
  // nor can it reach the goal.
  if (decisions.length === 1 && goals.length === 1) {
    const decisionId = decisions[0].id;
    const goalId = goals[0].id;

    const reachableFromDecision = bfsForward([decisionId], adjacency);
    const canReachGoal = bfsReverse([goalId], adjacency);

    for (const node of nodes) {
      // decision and goal are anchor points — never orphans
      if (node.kind === "decision" || node.kind === "goal") continue;

      const inReachable = reachableFromDecision.has(node.id);
      const inCanReach = canReachGoal.has(node.id);

      if (!inReachable && !inCanReach) {
        violations.push("ORPHAN_NODE");
        break;
      }
    }
  }

  return { valid: violations.length === 0, violations };
}
