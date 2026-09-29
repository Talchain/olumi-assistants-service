/**
 * Goal Conflict Analysis
 *
 * Analyzes relationships between multiple goals in a decision graph.
 * Detects aligned, conflicting, or independent goals and provides
 * proactive guidance when trade-offs exist.
 *
 * Key concepts:
 * - Aligned goals: Both benefit from the same options/outcomes
 * - Conflicting goals: Improving one tends to hurt the other
 * - Independent goals: No significant shared pathways
 *
 * When conflicts are detected, suggests:
 * - Pareto analysis for finding optimal trade-offs
 * - Prioritization guidance when clear hierarchy exists
 * - Hybrid approaches for complex multi-goal scenarios
 */

import type { GraphV1 } from "../../contracts/plot/engine.js";
import type {
  GoalConflictAnalysis,
  GoalPair,
  GoalRelationship,
  TradeOffGuidance,
} from "./types.js";

// ============================================================================
// Types
// ============================================================================

type NodeLike = { id?: string; kind?: string; label?: string } & Record<string, unknown>;
type EdgeLike = {
  from?: string;
  to?: string;
  source?: string;
  target?: string;
  // V4 fields (preferred)
  strength_mean?: number;
  belief_exists?: number;
  // Legacy fields (fallback)
  weight?: number;
  belief?: number;
} & Record<string, unknown>;

// ============================================================================
// Graph Helpers
// ============================================================================

function getNodes(graph: GraphV1 | undefined): NodeLike[] {
  if (!graph || !Array.isArray((graph as any).nodes)) return [];
  return (graph as any).nodes as NodeLike[];
}

function getEdges(graph: GraphV1 | undefined): EdgeLike[] {
  if (!graph || !Array.isArray((graph as any).edges)) return [];
  return (graph as any).edges as EdgeLike[];
}

function getEdgeFrom(edge: EdgeLike): string | undefined {
  return edge.from ?? edge.source;
}

function getEdgeTo(edge: EdgeLike): string | undefined {
  return edge.to ?? edge.target;
}

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Analyze goal relationships in a decision graph.
 *
 * @param graph - Decision graph to analyze
 * @returns Goal conflict analysis with relationships and guidance
 */
export function analyzeGoalConflicts(
  graph: GraphV1 | undefined,
): GoalConflictAnalysis {
  const nodes = getNodes(graph);
  const edges = getEdges(graph);

  // Find all goal nodes
  const goals = nodes.filter((n) => n.kind === "goal" && n.id && n.label);

  // Handle edge cases
  if (goals.length === 0) {
    return {
      goal_count: 0,
      goals: [],
      relationships: [],
      has_conflicts: false,
      summary: "No goals defined in the model",
    };
  }

  if (goals.length === 1) {
    return {
      goal_count: 1,
      goals: [{ id: goals[0].id!, label: goals[0].label! }],
      relationships: [],
      has_conflicts: false,
      summary: "Single goal defined — no multi-goal trade-offs to consider",
    };
  }

  // Build graph connectivity data
  const connectivity = buildConnectivityData(nodes, edges);

  // Analyze pairwise relationships
  const relationships: GoalPair[] = [];

  for (let i = 0; i < goals.length; i++) {
    for (let j = i + 1; j < goals.length; j++) {
      const goalA = goals[i];
      const goalB = goals[j];
      const relationship = analyzeGoalPair(goalA, goalB, connectivity, edges);
      relationships.push(relationship);
    }
  }

  // Check for conflicts
  const hasConflicts = relationships.some((r) => r.relationship === "conflicting");

  // Generate guidance if conflicts exist
  const guidance = hasConflicts
    ? generateTradeOffGuidance(relationships, goals)
    : undefined;

  // Generate summary
  const summary = generateConflictSummary(relationships, goals);

  return {
    goal_count: goals.length,
    goals: goals.map((g) => ({ id: g.id!, label: g.label! })),
    relationships,
    has_conflicts: hasConflicts,
    guidance,
    summary,
  };
}

// ============================================================================
// Connectivity Analysis
// ============================================================================

interface ConnectivityData {
  /** Nodes reachable from each node (forward direction) */
  downstream: Map<string, Set<string>>;
  /** Nodes that can reach each node (backward direction) */
  upstream: Map<string, Set<string>>;
  /** Node labels by ID */
  labels: Map<string, string>;
  /** Node kinds by ID */
  kinds: Map<string, string>;
  /** Options in the graph */
  optionIds: Set<string>;
  /** Outcomes in the graph */
  outcomeIds: Set<string>;
}

/**
 * Build connectivity data for the graph.
 */
function buildConnectivityData(
  nodes: NodeLike[],
  edges: EdgeLike[],
): ConnectivityData {
  const downstream = new Map<string, Set<string>>();
  const upstream = new Map<string, Set<string>>();
  const labels = new Map<string, string>();
  const kinds = new Map<string, string>();
  const optionIds = new Set<string>();
  const outcomeIds = new Set<string>();

  // Index nodes
  for (const node of nodes) {
    if (!node.id) continue;
    labels.set(node.id, node.label ?? node.id);
    kinds.set(node.id, node.kind ?? "unknown");

    if (node.kind === "option") optionIds.add(node.id);
    if (node.kind === "outcome") outcomeIds.add(node.id);

    downstream.set(node.id, new Set());
    upstream.set(node.id, new Set());
  }

  // Build direct connections
  for (const edge of edges) {
    const from = getEdgeFrom(edge);
    const to = getEdgeTo(edge);
    if (!from || !to) continue;

    if (!downstream.has(from)) downstream.set(from, new Set());
    if (!upstream.has(to)) upstream.set(to, new Set());

    downstream.get(from)!.add(to);
    upstream.get(to)!.add(from);
  }

  // Compute transitive closure using BFS
  for (const [nodeId] of downstream) {
    const reachable = new Set<string>();
    const queue = [nodeId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const neighbors = downstream.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          reachable.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    downstream.set(nodeId, reachable);
  }

  // Compute reverse closure
  for (const [nodeId] of upstream) {
    const ancestors = new Set<string>();
    const queue = [nodeId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const neighbors = upstream.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          ancestors.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    upstream.set(nodeId, ancestors);
  }

  return { downstream, upstream, labels, kinds, optionIds, outcomeIds };
}

// ============================================================================
// Pairwise Goal Analysis
// ============================================================================

/**
 * Analyze the relationship between two goals.
 */
function analyzeGoalPair(
  goalA: NodeLike,
  goalB: NodeLike,
  connectivity: ConnectivityData,
  edges: EdgeLike[],
): GoalPair {
  const idA = goalA.id!;
  const idB = goalB.id!;
  const labelA = goalA.label!;
  const labelB = goalB.label!;

  // Find shared upstream nodes (outcomes, options that influence both goals)
  const upstreamA = connectivity.upstream.get(idA) ?? new Set();
  const upstreamB = connectivity.upstream.get(idB) ?? new Set();

  const sharedUpstream = new Set<string>();
  for (const nodeId of upstreamA) {
    if (upstreamB.has(nodeId)) {
      sharedUpstream.add(nodeId);
    }
  }

  // If no shared upstream nodes, goals are independent
  if (sharedUpstream.size === 0) {
    return {
      goal_a_id: idA,
      goal_a_label: labelA,
      goal_b_id: idB,
      goal_b_label: labelB,
      relationship: "independent",
      strength: 0,
      shared_nodes: [],
      explanation: `"${labelA}" and "${labelB}" have no shared pathways — they can be optimized independently`,
    };
  }

  // Analyze how shared options affect both goals
  const sharedOptions = [...sharedUpstream].filter((id) =>
    connectivity.optionIds.has(id)
  );

  const sharedOutcomes = [...sharedUpstream].filter((id) =>
    connectivity.outcomeIds.has(id)
  );

  // Determine relationship by analyzing edge weights/directions
  const { relationship, strength } = determineRelationship(
    idA,
    idB,
    sharedUpstream,
    edges,
    connectivity,
  );

  // Get labels for shared nodes
  const sharedLabels = [...sharedUpstream]
    .slice(0, 3)
    .map((id) => connectivity.labels.get(id) ?? id);

  // Generate explanation
  const explanation = generatePairExplanation(
    labelA,
    labelB,
    relationship,
    sharedLabels,
    sharedOptions.length,
    sharedOutcomes.length,
  );

  return {
    goal_a_id: idA,
    goal_a_label: labelA,
    goal_b_id: idB,
    goal_b_label: labelB,
    relationship,
    strength,
    shared_nodes: sharedLabels,
    explanation,
  };
}

/**
 * Determine relationship type by analyzing path weights.
 *
 * Logic:
 * - If most shared paths have consistent positive weights to both goals → aligned
 * - If shared paths have opposing signs (positive to one, negative to other) → conflicting
 * - If paths are mixed or neutral → independent
 */
function determineRelationship(
  goalAId: string,
  goalBId: string,
  sharedNodes: Set<string>,
  edges: EdgeLike[],
  connectivity: ConnectivityData,
): { relationship: GoalRelationship; strength: number } {
  // Build edge lookup for weight analysis
  const edgeWeights = new Map<string, number>();
  for (const edge of edges) {
    const from = getEdgeFrom(edge);
    const to = getEdgeTo(edge);
    if (!from || !to) continue;
    // V4 field takes precedence, fallback to legacy
    const weight = edge.strength_mean ?? edge.weight ?? 1.0;
    edgeWeights.set(`${from}->${to}`, weight);
  }

  // Analyze shared options (most important for conflict detection)
  const sharedOptions = [...sharedNodes].filter((id) =>
    connectivity.optionIds.has(id)
  );

  if (sharedOptions.length === 0) {
    // Shared outcomes but no shared options → likely aligned (same outcomes benefit both)
    return {
      relationship: "aligned",
      strength: Math.min(1, sharedNodes.size / 5) * 0.5,
    };
  }

  // For each shared option, estimate effect direction on each goal
  let alignedCount = 0;
  let conflictCount = 0;

  for (const optionId of sharedOptions) {
    // Find paths from option to each goal (simplified: look at direct connections)
    const toGoalA = findPathWeight(optionId, goalAId, edgeWeights, connectivity);
    const toGoalB = findPathWeight(optionId, goalBId, edgeWeights, connectivity);

    // Same sign = aligned, opposite sign = conflicting
    if (toGoalA !== 0 && toGoalB !== 0) {
      if (Math.sign(toGoalA) === Math.sign(toGoalB)) {
        alignedCount++;
      } else {
        conflictCount++;
      }
    }
  }

  // Determine overall relationship
  const total = alignedCount + conflictCount;
  if (total === 0) {
    return { relationship: "independent", strength: 0.3 };
  }

  if (conflictCount > alignedCount) {
    return {
      relationship: "conflicting",
      strength: conflictCount / total,
    };
  }

  if (alignedCount > conflictCount) {
    return {
      relationship: "aligned",
      strength: alignedCount / total,
    };
  }

  // Equal or unclear → treat as potentially conflicting if any conflicts exist
  if (conflictCount > 0) {
    return { relationship: "conflicting", strength: 0.5 };
  }

  return { relationship: "aligned", strength: 0.5 };
}

/**
 * Find aggregate path weight from source to target.
 * Returns positive for beneficial path, negative for harmful.
 */
function findPathWeight(
  sourceId: string,
  targetId: string,
  edgeWeights: Map<string, number>,
  connectivity: ConnectivityData,
): number {
  // Simple heuristic: product of edge weights along shortest path
  // For now, use direct edges or two-hop paths

  // Direct edge
  const directKey = `${sourceId}->${targetId}`;
  if (edgeWeights.has(directKey)) {
    return edgeWeights.get(directKey)!;
  }

  // Two-hop paths
  const downstreamFromSource = connectivity.downstream.get(sourceId) ?? new Set();
  const upstreamFromTarget = connectivity.upstream.get(targetId) ?? new Set();

  let totalWeight = 0;
  let pathCount = 0;

  for (const intermediate of downstreamFromSource) {
    if (upstreamFromTarget.has(intermediate)) {
      const w1 = edgeWeights.get(`${sourceId}->${intermediate}`) ?? 1;
      const w2 = edgeWeights.get(`${intermediate}->${targetId}`) ?? 1;
      totalWeight += w1 * w2;
      pathCount++;
    }
  }

  if (pathCount === 0) return 0;
  return totalWeight / pathCount;
}

/**
 * Generate human-readable explanation for goal pair relationship.
 */
function generatePairExplanation(
  labelA: string,
  labelB: string,
  relationship: GoalRelationship,
  sharedLabels: string[],
  sharedOptionCount: number,
  _sharedOutcomeCount: number,
): string {
  const sharedStr =
    sharedLabels.length > 0
      ? ` through "${sharedLabels.slice(0, 2).join('", "')}"`
      : "";

  switch (relationship) {
    case "aligned":
      return `"${labelA}" and "${labelB}" are aligned${sharedStr} — improving one tends to benefit the other`;

    case "conflicting":
      if (sharedOptionCount > 0) {
        return `"${labelA}" and "${labelB}" compete for the same resources${sharedStr} — a trade-off is needed`;
      }
      return `"${labelA}" and "${labelB}" have opposing effects${sharedStr} — prioritization is required`;

    case "independent":
      return `"${labelA}" and "${labelB}" operate on different pathways — they can be optimized separately`;

    default:
      return `"${labelA}" and "${labelB}" have a complex relationship requiring further analysis`;
  }
}

// ============================================================================
// Trade-off Guidance Generation
// ============================================================================

/**
 * Generate proactive trade-off guidance for conflicting goals.
 */
function generateTradeOffGuidance(
  relationships: GoalPair[],
  goals: NodeLike[],
): TradeOffGuidance {
  const conflicts = relationships.filter((r) => r.relationship === "conflicting");
  const strongConflicts = conflicts.filter((r) => r.strength >= 0.7);

  // Determine guidance type based on conflict patterns
  if (conflicts.length === 1 && goals.length === 2) {
    // Simple two-goal conflict → Pareto analysis
    return generateParetoGuidance(conflicts[0]);
  }

  if (strongConflicts.length > 0) {
    // Strong conflicts → Prioritization needed
    return generatePrioritizationGuidance(strongConflicts, goals);
  }

  // Multiple weaker conflicts → Hybrid approach
  return generateHybridGuidance(conflicts, goals);
}

/**
 * Generate Pareto analysis guidance.
 */
function generateParetoGuidance(conflict: GoalPair): TradeOffGuidance {
  return {
    type: "pareto",
    headline: "Consider Pareto analysis for this trade-off",
    explanation:
      `"${conflict.goal_a_label}" and "${conflict.goal_b_label}" have competing demands. ` +
      `A Pareto analysis can help find solutions where neither goal is made worse without improving the other. ` +
      `Look for options that give acceptable outcomes for both rather than maximizing just one.`,
    suggestions: [
      `Identify options that score reasonably well on both "${conflict.goal_a_label}" and "${conflict.goal_b_label}"`,
      "Plot the trade-off curve to visualize the Pareto frontier",
      "Consider if either goal has a minimum acceptable threshold",
      "Evaluate whether the conflict is fundamental or can be resolved with creative options",
    ],
  };
}

/**
 * Generate prioritization guidance.
 */
function generatePrioritizationGuidance(
  strongConflicts: GoalPair[],
  _goals: NodeLike[],
): TradeOffGuidance {
  const conflictingGoals = new Set<string>();
  for (const conflict of strongConflicts) {
    conflictingGoals.add(conflict.goal_a_label);
    conflictingGoals.add(conflict.goal_b_label);
  }

  const goalList = [...conflictingGoals].slice(0, 3).join('", "');

  return {
    type: "prioritize",
    headline: "Goal prioritization recommended",
    explanation:
      `Your model has strong conflicts between goals: "${goalList}". ` +
      `Since these goals pull in opposite directions, you may need to decide which is more important for this decision. ` +
      `Consider using weighted scoring or explicit priority rankings.`,
    suggestions: [
      "Rank goals by strategic importance for this specific decision",
      "Assign weights to goals based on business priorities",
      "Consider time horizons — short-term vs. long-term trade-offs",
      "Identify if any goal has a hard constraint (must-have vs. nice-to-have)",
      "Consult stakeholders to establish agreed priorities",
    ],
  };
}

/**
 * Generate hybrid guidance for complex multi-goal scenarios.
 */
function generateHybridGuidance(
  conflicts: GoalPair[],
  goals: NodeLike[],
): TradeOffGuidance {
  return {
    type: "hybrid",
    headline: "Multi-goal optimization needed",
    explanation:
      `Your model has ${goals.length} goals with mixed relationships. ` +
      `Some goals are aligned while others conflict. This requires a balanced approach ` +
      `that considers trade-offs between competing goals while leveraging synergies between aligned ones.`,
    suggestions: [
      "Group aligned goals together for joint optimization",
      "For conflicting pairs, identify acceptable ranges rather than single targets",
      "Consider scenario analysis with different goal priority weightings",
      "Look for options that minimize conflicts rather than maximize any single goal",
      "Document trade-off decisions for transparency",
    ],
  };
}

// ============================================================================
// Summary Generation
// ============================================================================

/**
 * Generate human-readable summary of goal relationships.
 */
function generateConflictSummary(
  relationships: GoalPair[],
  goals: NodeLike[],
): string {
  if (goals.length === 0) {
    return "No goals defined in the model";
  }

  if (goals.length === 1) {
    return `Single goal: "${goals[0].label}"`;
  }

  const conflicts = relationships.filter((r) => r.relationship === "conflicting");
  const aligned = relationships.filter((r) => r.relationship === "aligned");
  const independent = relationships.filter((r) => r.relationship === "independent");

  if (conflicts.length === 0) {
    if (aligned.length === relationships.length) {
      return `All ${goals.length} goals are aligned — a win-win approach may be possible`;
    }
    if (independent.length === relationships.length) {
      return `All ${goals.length} goals are independent — they can be optimized separately`;
    }
    return `${goals.length} goals with mixed relationships — no major conflicts detected`;
  }

  // Has conflicts
  if (conflicts.length === 1) {
    const c = conflicts[0];
    return `Trade-off detected between "${c.goal_a_label}" and "${c.goal_b_label}" — Pareto analysis recommended`;
  }

  return `${conflicts.length} goal conflicts detected among ${goals.length} goals — prioritization needed`;
}

// ============================================================================
// Exports
// ============================================================================

export const __test_only = {
  buildConnectivityData,
  analyzeGoalPair,
  determineRelationship,
  generateTradeOffGuidance,
  generateConflictSummary,
};
