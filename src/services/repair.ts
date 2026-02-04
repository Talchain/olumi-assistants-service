import type { GraphT } from "../schemas/graph.js";
import { log } from "../utils/telemetry.js";
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from "../config/graphCaps.js";

/**
 * Allowed edge patterns (closed-world).
 * These match the v4 prompt EDGE_TABLE.
 */
const ALLOWED_EDGE_PATTERNS: Array<{ from: string; to: string }> = [
  { from: "decision", to: "option" },
  { from: "option", to: "factor" },
  { from: "factor", to: "outcome" },
  { from: "factor", to: "risk" },
  { from: "factor", to: "factor" },
  { from: "outcome", to: "goal" },
  { from: "risk", to: "goal" },
];

/**
 * Check if an edge pattern is allowed.
 */
function isEdgeAllowed(fromKind: string, toKind: string): boolean {
  return ALLOWED_EDGE_PATTERNS.some(
    (p) => p.from === fromKind && p.to === toKind
  );
}

// =============================================================================
// Connectivity Repair Helpers
// =============================================================================

/**
 * Find goal node ID from nodes array
 */
function findGoalId(nodes: GraphT["nodes"]): string | undefined {
  return nodes.find((n) => n.kind === "goal")?.id;
}

/**
 * Wire orphaned outcomes/risks to goal node.
 * Logic replicated from goal-inference.ts:wireOutcomesToGoal
 */
function wireOrphansToGoal(
  nodes: GraphT["nodes"],
  edges: GraphT["edges"],
  goalId: string,
  requestId?: string
): { edges: GraphT["edges"]; wiredIds: string[] } {
  // Find outcome/risk nodes
  const outcomeRiskIds = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "outcome" || node.kind === "risk") {
      outcomeRiskIds.add(node.id);
    }
  }

  // Find which already have edges to goal
  const alreadyWired = new Set<string>();
  for (const edge of edges) {
    if (edge.to === goalId && outcomeRiskIds.has(edge.from)) {
      alreadyWired.add(edge.from);
    }
  }

  // Add missing edges
  const newEdges = [...edges];
  const wiredIds: string[] = [];
  for (const nodeId of outcomeRiskIds) {
    if (!alreadyWired.has(nodeId)) {
      const node = nodes.find((n) => n.id === nodeId);
      const isRisk = node?.kind === "risk";
      newEdges.push({
        from: nodeId,
        to: goalId,
        strength_mean: isRisk ? -0.5 : 0.7,
        strength_std: 0.15,
        belief_exists: 0.9,
        effect_direction: isRisk ? "negative" : "positive",
      });
      wiredIds.push(nodeId);
    }
  }

  if (wiredIds.length > 0) {
    log.info(
      {
        event: "SIMPLE_REPAIR_WIRED_TO_GOAL",
        request_id: requestId,
        wired_node_ids: wiredIds,
        edge_count_added: wiredIds.length,
      },
      `simpleRepair wired ${wiredIds.length} orphaned outcome/risk nodes to goal`
    );
  }

  return { edges: newEdges, wiredIds };
}

/**
 * Wire orphaned outcome/risk nodes FROM the causal chain.
 * Finds nodes with no INBOUND edges from factors and connects them
 * to a factor in the graph (prefers controllable).
 *
 * This complements wireOrphansToGoal which handles OUTBOUND edges.
 * Both are needed for full reachability from decision via forward BFS.
 *
 * LIMITATION: All orphaned nodes wire from the same source factor for
 * simplicity. This is a fallback repair mechanism; production graphs
 * should have proper factor→outcome/risk edges from the LLM.
 */
function wireOrphansFromCausalChain(
  nodes: GraphT["nodes"],
  edges: GraphT["edges"],
  requestId?: string
): { edges: GraphT["edges"]; wiredIds: string[] } {
  // Find outcome/risk nodes
  const outcomeRiskIds = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "outcome" || node.kind === "risk") {
      outcomeRiskIds.add(node.id);
    }
  }

  // Find which already have INBOUND edges from factors
  const hasInbound = new Set<string>();
  for (const edge of edges) {
    const fromNode = nodes.find((n) => n.id === edge.from);
    if (fromNode?.kind === "factor" && outcomeRiskIds.has(edge.to)) {
      hasInbound.add(edge.to);
    }
  }

  // Find a factor to wire from (prefer controllable, fallback to any)
  const factors = nodes.filter((n) => n.kind === "factor");
  const controllableFactor = factors.find((n) => n.category === "controllable");
  const sourceFactor = controllableFactor || factors[0];

  if (!sourceFactor) {
    return { edges, wiredIds: [] };
  }

  // Add inbound edges for orphaned outcome/risk nodes
  const newEdges = [...edges];
  const wiredIds: string[] = [];
  for (const nodeId of outcomeRiskIds) {
    if (!hasInbound.has(nodeId)) {
      const node = nodes.find((n) => n.id === nodeId);
      const isRisk = node?.kind === "risk";
      newEdges.push({
        from: sourceFactor.id,
        to: nodeId,
        strength_mean: isRisk ? 0.3 : 0.5, // Positive causal influence
        strength_std: 0.2,
        belief_exists: 0.75,
        effect_direction: "positive",
      });
      wiredIds.push(nodeId);
    }
  }

  if (wiredIds.length > 0) {
    log.info(
      {
        event: "SIMPLE_REPAIR_WIRED_FROM_FACTOR",
        request_id: requestId,
        source_factor: sourceFactor.id,
        wired_node_ids: wiredIds,
        edge_count_added: wiredIds.length,
      },
      `simpleRepair wired ${wiredIds.length} orphaned outcome/risk nodes from factor`
    );
  }

  return { edges: newEdges, wiredIds };
}

/**
 * Get nodes reachable from decision nodes via BFS
 */
function getReachableFromDecision(
  nodes: GraphT["nodes"],
  edges: GraphT["edges"]
): Set<string> {
  // Build adjacency list (forward edges)
  const adj = new Map<string, string[]>();
  for (const node of nodes) {
    adj.set(node.id, []);
  }
  for (const edge of edges) {
    const list = adj.get(edge.from);
    if (list) list.push(edge.to);
  }

  // BFS from all decision nodes
  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const node of nodes) {
    if (node.kind === "decision") {
      queue.push(node.id);
      reachable.add(node.id);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adj.get(current) || []) {
      if (!reachable.has(neighbor)) {
        reachable.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return reachable;
}

/**
 * Node kinds that must be preserved during repair, even if unreachable.
 * Defined here so pruneUnreachable can reference it.
 */
const PROTECTED_KINDS_FOR_PRUNING = new Set([
  "goal",
  "decision",
  "option",
  "outcome",
  "risk",
]);

/**
 * Prune nodes unreachable from decision.
 * IMPORTANT: Protected kinds (goal, decision, option, outcome, risk) are NEVER pruned
 * to maintain structural integrity of the graph.
 *
 * If no decision nodes exist, pruning is skipped entirely to avoid
 * over-deletion in malformed graphs.
 */
function pruneUnreachable(
  nodes: GraphT["nodes"],
  edges: GraphT["edges"],
  requestId?: string
): { nodes: GraphT["nodes"]; edges: GraphT["edges"]; prunedIds: string[] } {
  // Skip pruning if no decision nodes - can't determine reachability
  const hasDecision = nodes.some((n) => n.kind === "decision");
  if (!hasDecision) {
    return { nodes, edges, prunedIds: [] };
  }

  const reachable = getReachableFromDecision(nodes, edges);

  const prunedIds: string[] = [];
  const keptNodes = nodes.filter((n) => {
    // Always keep protected kinds (structural nodes)
    if (PROTECTED_KINDS_FOR_PRUNING.has(n.kind)) return true;
    // Keep reachable nodes
    if (reachable.has(n.id)) return true;
    // Prune unreachable non-protected nodes
    prunedIds.push(n.id);
    return false;
  });

  if (prunedIds.length > 0) {
    const keptNodeIds = new Set(keptNodes.map((n) => n.id));
    const keptEdges = edges.filter(
      (e) => keptNodeIds.has(e.from) && keptNodeIds.has(e.to)
    );

    log.info(
      {
        event: "SIMPLE_REPAIR_PRUNED_UNREACHABLE",
        request_id: requestId,
        pruned_node_ids: prunedIds,
        reason: "unreachable_from_decision",
      },
      `simpleRepair pruned ${prunedIds.length} unreachable nodes`
    );

    return { nodes: keptNodes, edges: keptEdges, prunedIds };
  }

  return { nodes, edges, prunedIds: [] };
}

/**
 * Node kinds that must be preserved during repair, even if it means exceeding the soft cap.
 * These are structurally required for a valid decision graph:
 * - goal: Required target node
 * - decision: Required root node
 * - option: Required alternatives (at least 2)
 * - outcome: Required positive consequences
 * - risk: Required negative consequences
 */
const PROTECTED_KINDS = new Set(["goal", "decision", "option", "outcome", "risk"]);

/**
 * Simple repair that trims counts to caps.
 *
 * IMPORTANT: Does NOT filter edges by closed-world rules to preserve graph connectivity.
 * Invalid edge patterns are logged for monitoring but kept in the graph.
 * The v3-validator will emit warnings for invalid patterns during validation.
 *
 * Protected node kinds (goal, decision, option, outcome, risk) are ALWAYS preserved
 * regardless of their position in the array, to prevent structural validation failures.
 *
 * Node/edge caps use GRAPH_MAX_NODES (50) and GRAPH_MAX_EDGES (200) from graphCaps.ts.
 */
export function simpleRepair(g: GraphT, requestId?: string): GraphT {
  // Separate protected and unprotected nodes
  const protectedNodes = g.nodes.filter((n) => PROTECTED_KINDS.has(n.kind));
  const unprotectedNodes = g.nodes.filter((n) => !PROTECTED_KINDS.has(n.kind));

  // Always keep protected nodes, then fill with unprotected up to cap
  const maxUnprotected = Math.max(0, GRAPH_MAX_NODES - protectedNodes.length);
  const nodes = [...protectedNodes, ...unprotectedNodes.slice(0, maxUnprotected)];

  if (protectedNodes.length > 0 || unprotectedNodes.length > GRAPH_MAX_NODES) {
    log.info({
      event: "cee.simple_repair.protected_nodes_preserved",
      request_id: requestId,
      protected_count: protectedNodes.length,
      protected_kinds: protectedNodes.map((n) => n.kind),
      unprotected_kept: Math.min(unprotectedNodes.length, maxUnprotected),
      unprotected_dropped: Math.max(0, unprotectedNodes.length - maxUnprotected),
      total_nodes: nodes.length,
      max_nodes: GRAPH_MAX_NODES,
    }, "simpleRepair preserved protected node kinds");
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeKindMap = new Map(nodes.map((node) => [node.id, node.kind]));

  // Filter only dangling edges (references to nodes outside the trimmed set)
  let validEdges = g.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));

  // === Connectivity Repair ===

  // Step A: Wire orphaned outcomes/risks to goal
  const goalId = findGoalId(nodes);
  if (goalId) {
    const wireResult = wireOrphansToGoal(nodes, validEdges, goalId, requestId);
    validEdges = wireResult.edges;
  }

  // Step A.5: Wire orphaned outcomes/risks FROM the causal chain
  // This ensures outcome/risk nodes have INBOUND edges from factors,
  // making them reachable from decision via forward BFS.
  const wireFromResult = wireOrphansFromCausalChain(nodes, validEdges, requestId);
  validEdges = wireFromResult.edges;

  // Step B: Prune nodes unreachable from decision
  const pruneResult = pruneUnreachable(nodes, validEdges, requestId);
  const finalNodes = pruneResult.nodes;
  validEdges = pruneResult.edges;

  // Update nodeKindMap for pruned nodes
  const finalNodeKindMap = new Map(finalNodes.map((node) => [node.id, node.kind]));

  // === End Connectivity Repair ===

  // Detect invalid edge patterns for telemetry (but don't drop them)
  const invalidEdges: Array<{ from: string; to: string; fromKind: string; toKind: string }> = [];
  for (const edge of validEdges) {
    const fromKind = finalNodeKindMap.get(edge.from);
    const toKind = finalNodeKindMap.get(edge.to);
    if (fromKind && toKind && !isEdgeAllowed(fromKind, toKind)) {
      invalidEdges.push({ from: edge.from, to: edge.to, fromKind, toKind });
    }
  }

  // Log invalid patterns for monitoring (helps track v4 prompt effectiveness)
  if (invalidEdges.length > 0) {
    log.warn({
      event: "cee.simple_repair.invalid_edges_preserved",
      request_id: requestId,
      invalid_count: invalidEdges.length,
      total_edge_count: validEdges.length,
      invalid_patterns: invalidEdges.map((e) => `${e.fromKind}→${e.toKind}`),
      invalid_edges: invalidEdges,
    }, "simpleRepair detected invalid edge patterns (preserved for connectivity)");
  }

  const edges = validEdges
    .slice(0, GRAPH_MAX_EDGES)
    .map((edge, idx) => ({ ...edge, id: edge.id || `${edge.from}::${edge.to}::${idx}` }))
    .sort((a, b) => a.id!.localeCompare(b.id!));

  return { ...g, nodes: finalNodes, edges };
}
