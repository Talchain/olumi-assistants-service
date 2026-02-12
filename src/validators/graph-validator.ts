/**
 * Graph Validator
 *
 * Deterministic graph validation that runs after Zod schema validation,
 * before enrichment. Extracts rules from the LLM prompt into code for
 * faster validation and precise repair feedback.
 *
 * @module validators/graph-validator
 */

import { log } from "../utils/telemetry.js";
import type { GraphT, NodeT, EdgeT, FactorDataT, OptionDataT } from "../schemas/graph.js";
import {
  type GraphValidationInput,
  type GraphValidationResult,
  type ControllabilitySummary,
  type ValidationIssue,
  type NodeMap,
  type AdjacencyLists,
  type FactorCategory,
  type FactorCategoryInfo,
  NODE_LIMIT,
  EDGE_LIMIT,
  MIN_OPTIONS,
  MAX_OPTIONS,
  ALLOWED_EDGES,
  CANONICAL_EDGE,
} from "./graph-validator.types.js";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Build node lookup maps for efficient access.
 */
function buildNodeMap(nodes: NodeT[]): NodeMap {
  const byId = new Map<string, NodeT>();
  const byKind = new Map<string, NodeT[]>();

  for (const node of nodes) {
    byId.set(node.id, node);
    const kindList = byKind.get(node.kind) ?? [];
    kindList.push(node);
    byKind.set(node.kind, kindList);
  }

  return { byId, byKind };
}

/**
 * Build forward and reverse adjacency lists.
 */
function buildAdjacencyLists(edges: EdgeT[]): AdjacencyLists {
  const forward = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();

  for (const edge of edges) {
    const fwdList = forward.get(edge.from) ?? [];
    fwdList.push(edge.to);
    forward.set(edge.from, fwdList);

    const revList = reverse.get(edge.to) ?? [];
    revList.push(edge.from);
    reverse.set(edge.to, revList);
  }

  return { forward, reverse };
}

/**
 * Infer factor category from graph structure.
 * - controllable: Has incoming edge from option node
 * - observable: No option edge but has data.value
 * - external: No option edge, no data.value
 */
function inferFactorCategories(
  nodes: NodeT[],
  edges: EdgeT[],
  nodeMap: NodeMap
): Map<string, FactorCategoryInfo> {
  const categories = new Map<string, FactorCategoryInfo>();

  // Find option node IDs
  const optionIds = new Set(
    (nodeMap.byKind.get("option") ?? []).map((n) => n.id)
  );

  // Find factor IDs with incoming edges from options
  const factorsWithOptionEdge = new Set<string>();
  for (const edge of edges) {
    if (optionIds.has(edge.from)) {
      factorsWithOptionEdge.add(edge.to);
    }
  }

  // Categorize each factor
  const factors = nodeMap.byKind.get("factor") ?? [];
  for (const node of factors) {
    const hasOptionEdge = factorsWithOptionEdge.has(node.id);
    const data = node.data as FactorDataT | undefined;
    const hasValue = data?.value !== undefined;

    // Read explicit category from node.category (V12.4+ schema field)
    const explicitCategory = node.category as FactorCategory | undefined;

    // Infer category from structure
    let category: FactorCategory;
    if (hasOptionEdge) {
      category = "controllable";
    } else if (hasValue) {
      category = "observable";
    } else {
      category = "external";
    }

    categories.set(node.id, {
      nodeId: node.id,
      category,
      hasOptionEdge,
      hasValue,
      explicitCategory,
    });
  }

  return categories;
}

/**
 * Normalise factor categories by overwriting LLM-declared categories with
 * structurally inferred ones. When a factor is reclassified, auto-fill or
 * strip data fields so downstream Tier 4 validation passes.
 *
 * Mutates `graph.nodes` in place for the categories and data fields.
 * Returns info-level issues for observability.
 */
function normaliseCategoryOverrides(
  graph: GraphT,
  nodeMap: NodeMap,
  factorCategories: Map<string, FactorCategoryInfo>,
  requestId?: string,
): { overrides: ValidationIssue[]; overrideCount: number } {
  const overrides: ValidationIssue[] = [];
  const factors = nodeMap.byKind.get("factor") ?? [];

  for (const node of factors) {
    const info = factorCategories.get(node.id);
    if (!info) continue;

    const declared = node.category as FactorCategory | undefined;
    const inferred = info.category;

    // Nothing to override when categories already agree or no declared category
    if (!declared || declared === inferred) continue;

    // Overwrite the node's declared category with the inferred one
    (node as any).category = inferred;

    // Update the factorCategories map so downstream CATEGORY_MISMATCH check
    // sees the corrected explicitCategory (now matches inferred)
    factorCategories.set(node.id, { ...info, explicitCategory: inferred });

    const data = (node.data ?? {}) as Record<string, unknown>;

    if (inferred === "controllable") {
      // Reclassified TO controllable — auto-fill missing required fields
      if (!data.factor_type) {
        data.factor_type = "general";
      }
      if (!data.uncertainty_drivers) {
        data.uncertainty_drivers = ["Estimation uncertainty"];
      }
      // Ensure data is attached if it wasn't before
      if (!node.data) {
        (node as any).data = data;
      }
    } else {
      // Reclassified FROM controllable to observable/external — strip extra fields
      if (data.factor_type !== undefined) {
        delete data.factor_type;
      }
      if (data.uncertainty_drivers !== undefined) {
        delete data.uncertainty_drivers;
      }
    }

    overrides.push({
      code: "CATEGORY_OVERRIDE",
      severity: "info",
      message: `Factor "${node.id}" category overridden: "${declared}" → "${inferred}" (structural inference)`,
      path: `nodesById.${node.id}`,
      context: {
        nodeId: node.id,
        declaredCategory: declared,
        inferredCategory: inferred,
      },
    });
  }

  if (overrides.length > 0) {
    log.info(
      {
        event: "graph_validator.category_overrides",
        requestId,
        overrideCount: overrides.length,
        overrides: overrides.map((o) => ({
          nodeId: o.context?.nodeId,
          from: o.context?.declaredCategory,
          to: o.context?.inferredCategory,
        })),
      },
      `Overrode ${overrides.length} factor category mismatch(es)`
    );
  }

  return { overrides, overrideCount: overrides.length };
}

/**
 * BFS forward traversal from a set of starting nodes.
 * Returns all reachable node IDs.
 */
function bfsForward(
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
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  return visited;
}

/**
 * BFS reverse traversal from a set of starting nodes.
 * Returns all nodes that can reach the starting nodes.
 */
function bfsReverse(
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
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  return visited;
}

/**
 * Detect cycles using Kahn's algorithm (topological sort).
 * Returns true if cycle exists.
 */
function hasCycle(nodes: NodeT[], edges: EdgeT[]): boolean {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  // Build adjacency and count in-degrees
  for (const edge of edges) {
    const list = adjacency.get(edge.from);
    if (list) list.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  // Find all nodes with in-degree 0
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  // Process nodes
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

  // If not all nodes processed, there's a cycle
  return processedCount !== nodes.length;
}

/**
 * Build canonical intervention signature for an option.
 * Sort by factor_id, canonicalise floats to 4 decimal places for stability;
 * differences beyond 4dp treated as negligible for identity comparison.
 */
function buildInterventionSignature(interventions: Record<string, number>): string {
  const entries = Object.entries(interventions)
    .map(([factorId, value]) => `${factorId}:${value.toFixed(4)}`)
    .sort();
  return entries.join("|");
}

/**
 * Check if a number is NaN or Infinity.
 */
function isInvalidNumber(value: unknown): boolean {
  if (typeof value !== "number") return false;
  return !Number.isFinite(value);
}

/**
 * Goal-number detection patterns.
 * Matches factor labels that appear to be goal target values, not causal factors.
 * E.g., "£20k MRR", "$50k revenue target", "target of £100k"
 *
 * Patterns are intentionally specific to reduce false positives:
 * - Require currency symbols (£$€) OR specific financial terms (MRR/ARR/revenue/sales)
 * - Avoid matching generic factors like "target customer segments" or "objective function"
 */
const GOAL_NUMBER_PATTERNS = [
  // "goal of reaching £20k" or "goal of $1M"
  /goal of (?:reaching |achieving )?[£$€]?[\d,]+[kKmM]?/i,
  // "target of £100k" - requires currency symbol to avoid "target 5 segments"
  /target (?:of )?[£$€][\d,]+[kKmM]?/i,
  // "target of 100k revenue" or "revenue target of 50k" - requires financial keyword
  /(?:revenue|sales|MRR|ARR)\s*target\s*(?:of\s*)?[\d,]+[kKmM]?/i,
  /target\s*(?:of\s*)?[\d,]+[kKmM]?\s*(?:revenue|sales|MRR|ARR)/i,
  // Standalone currency amounts like "£20k MRR" or "$50k"
  /^[£$€][\d,]+[kKmM]?\s*(?:MRR|ARR|revenue|sales)?$/i,
  // "50k MRR" or "100k revenue target"
  /^\d+[kKmM]\s*(?:MRR|ARR|revenue|sales|target|goal)/i,
  // "$50k revenue target"
  /[£$€]\d+[kKmM]?\s*(?:revenue|sales)?\s*target/i,
];

/**
 * Patterns that indicate a REFERENCE to a target, not THE target itself.
 * These are used to exclude false positives like "share of £20k target".
 */
const GOAL_REFERENCE_EXCLUSIONS = [
  // "share of £20k target" or "fraction of $100k goal"
  /(?:share|fraction|portion|percentage|%)\s+of\s+[£$€]?[\d,]+[kKmM]?\s*(?:target|goal)?/i,
  // "progress toward £20k" or "progress to $100k"
  /progress\s+(?:toward|towards|to)\s+[£$€]?[\d,]+[kKmM]?/i,
  // "(0-1, share of £20k target)" - normalized metric description
  /\([\d.]+[-–][\d.]+,?\s*(?:share|fraction|portion)\s+of\s+[£$€]?[\d,]+[kKmM]?\s*(?:target|goal)?\)/i,
  // "relative to £20k target" or "compared to $50k goal"
  /(?:relative|compared)\s+to\s+[£$€]?[\d,]+[kKmM]?\s*(?:target|goal)?/i,
  // "as % of £20k" or "as fraction of $100k"
  /as\s+(?:%|percent|percentage|fraction|share)\s+of\s+[£$€]?[\d,]+[kKmM]?/i,
];

/**
 * Check if a factor label appears to be a goal target value.
 * Excludes cases where the target is just a reference point (e.g., "share of £20k target").
 */
function isGoalNumberLabel(label: string): boolean {
  if (!label) return false;

  // First check if this is a reference to a target (not the target itself)
  const isReference = GOAL_REFERENCE_EXCLUSIONS.some((pattern) => pattern.test(label));
  if (isReference) return false;

  // Then check if it matches goal number patterns
  return GOAL_NUMBER_PATTERNS.some((pattern) => pattern.test(label));
}

// =============================================================================
// Tier 1: Structural Validation
// =============================================================================

function validateStructural(
  graph: GraphT,
  nodeMap: NodeMap
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // MISSING_GOAL: Exactly 1 goal node
  const goals = nodeMap.byKind.get("goal") ?? [];
  if (goals.length === 0) {
    issues.push({
      code: "MISSING_GOAL",
      severity: "error",
      message: "Graph must have exactly 1 goal node",
      context: { goalCount: 0 },
    });
  } else if (goals.length > 1) {
    issues.push({
      code: "MISSING_GOAL",
      severity: "error",
      message: `Graph must have exactly 1 goal node, found ${goals.length}`,
      context: { goalCount: goals.length, goalIds: goals.map((g) => g.id) },
    });
  }

  // MISSING_DECISION: Exactly 1 decision node
  const decisions = nodeMap.byKind.get("decision") ?? [];
  if (decisions.length === 0) {
    issues.push({
      code: "MISSING_DECISION",
      severity: "error",
      message: "Graph must have exactly 1 decision node",
      context: { decisionCount: 0 },
    });
  } else if (decisions.length > 1) {
    issues.push({
      code: "MISSING_DECISION",
      severity: "error",
      message: `Graph must have exactly 1 decision node, found ${decisions.length}`,
      context: { decisionCount: decisions.length, decisionIds: decisions.map((d) => d.id) },
    });
  }

  // INSUFFICIENT_OPTIONS: 2-6 options
  const options = nodeMap.byKind.get("option") ?? [];
  if (options.length < MIN_OPTIONS) {
    issues.push({
      code: "INSUFFICIENT_OPTIONS",
      severity: "error",
      message: `Graph must have at least ${MIN_OPTIONS} options, found ${options.length}`,
      context: { optionCount: options.length, min: MIN_OPTIONS },
    });
  } else if (options.length > MAX_OPTIONS) {
    issues.push({
      code: "INSUFFICIENT_OPTIONS",
      severity: "error",
      message: `Graph must have at most ${MAX_OPTIONS} options, found ${options.length}`,
      context: { optionCount: options.length, max: MAX_OPTIONS },
    });
  }

  // MISSING_BRIDGE: >=1 outcome or risk
  const outcomes = nodeMap.byKind.get("outcome") ?? [];
  const risks = nodeMap.byKind.get("risk") ?? [];
  if (outcomes.length === 0 && risks.length === 0) {
    issues.push({
      code: "MISSING_BRIDGE",
      severity: "error",
      message: "Graph must have at least 1 outcome or risk node",
      context: { outcomeCount: 0, riskCount: 0 },
    });
  }

  // NODE_LIMIT_EXCEEDED: <=50 nodes
  if (graph.nodes.length > NODE_LIMIT) {
    issues.push({
      code: "NODE_LIMIT_EXCEEDED",
      severity: "error",
      message: `Graph exceeds node limit of ${NODE_LIMIT}, found ${graph.nodes.length}`,
      context: { nodeCount: graph.nodes.length, limit: NODE_LIMIT },
    });
  }

  // EDGE_LIMIT_EXCEEDED: <=200 edges
  if (graph.edges.length > EDGE_LIMIT) {
    issues.push({
      code: "EDGE_LIMIT_EXCEEDED",
      severity: "error",
      message: `Graph exceeds edge limit of ${EDGE_LIMIT}, found ${graph.edges.length}`,
      context: { edgeCount: graph.edges.length, limit: EDGE_LIMIT },
    });
  }

  // INVALID_EDGE_REF: from/to must reference existing node IDs
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    if (!nodeMap.byId.has(edge.from)) {
      issues.push({
        code: "INVALID_EDGE_REF",
        severity: "error",
        message: `Edge references non-existent node: ${edge.from}`,
        path: `edges[${i}]`,
        context: { field: "from", nodeId: edge.from },
      });
    }
    if (!nodeMap.byId.has(edge.to)) {
      issues.push({
        code: "INVALID_EDGE_REF",
        severity: "error",
        message: `Edge references non-existent node: ${edge.to}`,
        path: `edges[${i}]`,
        context: { field: "to", nodeId: edge.to },
      });
    }
  }

  return issues;
}

// =============================================================================
// Tier 2: Topology Validation
// =============================================================================

function validateTopology(
  graph: GraphT,
  nodeMap: NodeMap,
  adjacency: AdjacencyLists,
  factorCategories: Map<string, FactorCategoryInfo>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // GOAL_HAS_OUTGOING: Goal must be sink
  const goals = nodeMap.byKind.get("goal") ?? [];
  for (const goal of goals) {
    const outgoing = adjacency.forward.get(goal.id) ?? [];
    if (outgoing.length > 0) {
      issues.push({
        code: "GOAL_HAS_OUTGOING",
        severity: "error",
        message: `Goal node "${goal.id}" must not have outgoing edges`,
        path: `nodesById.${goal.id}`,
        context: { outgoingTo: outgoing },
      });
    }
  }

  // DECISION_HAS_INCOMING: Decision must be source
  const decisions = nodeMap.byKind.get("decision") ?? [];
  for (const decision of decisions) {
    const incoming = adjacency.reverse.get(decision.id) ?? [];
    if (incoming.length > 0) {
      issues.push({
        code: "DECISION_HAS_INCOMING",
        severity: "error",
        message: `Decision node "${decision.id}" must not have incoming edges`,
        path: `nodesById.${decision.id}`,
        context: { incomingFrom: incoming },
      });
    }
  }

  // INVALID_EDGE_TYPE: Edge violates allowed matrix
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    const fromNode = nodeMap.byId.get(edge.from);
    const toNode = nodeMap.byId.get(edge.to);

    if (!fromNode || !toNode) continue; // Already caught by INVALID_EDGE_REF

    const fromKind = fromNode.kind;
    const toKind = toNode.kind;

    // Get factor categories if applicable
    const fromFactorCat = factorCategories.get(edge.from)?.category;
    const toFactorCat = factorCategories.get(edge.to)?.category;

    // Check if edge matches any allowed rule
    let isAllowed = false;
    for (const rule of ALLOWED_EDGES) {
      if (rule.fromKind !== fromKind || rule.toKind !== toKind) continue;

      // Check factor category constraints
      if (rule.toFactorCategory && toFactorCat !== rule.toFactorCategory) continue;
      if (rule.fromFactorCategory && fromFactorCat !== rule.fromFactorCategory) continue;

      isAllowed = true;
      break;
    }

    if (!isAllowed) {
      issues.push({
        code: "INVALID_EDGE_TYPE",
        severity: "error",
        message: `Invalid edge from ${fromKind} to ${toKind}`,
        path: `edges[${i}]`,
        context: {
          fromKind,
          toKind,
          fromId: edge.from,
          toId: edge.to,
          fromFactorCategory: fromFactorCat,
          toFactorCategory: toFactorCat,
        },
      });
    }
  }

  // CYCLE_DETECTED: DAG required
  if (hasCycle(graph.nodes, graph.edges)) {
    issues.push({
      code: "CYCLE_DETECTED",
      severity: "error",
      message: "Graph contains a cycle; must be a DAG",
    });
  }

  return issues;
}

// =============================================================================
// Tier 3: Reachability Validation
// =============================================================================

function validateReachability(
  graph: GraphT,
  nodeMap: NodeMap,
  adjacency: AdjacencyLists,
  factorCategories: Map<string, FactorCategoryInfo>
): { errors: ValidationIssue[]; infoIssues: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const infoIssues: ValidationIssue[] = [];

  const decisions = nodeMap.byKind.get("decision") ?? [];
  const goals = nodeMap.byKind.get("goal") ?? [];

  if (decisions.length === 0 || goals.length === 0) {
    // Can't check reachability without decision and goal
    return { errors, infoIssues };
  }

  const decisionId = decisions[0].id;
  const goalId = goals[0].id;

  // Forward BFS from decision
  const reachableFromDecision = bfsForward([decisionId], adjacency);

  // Reverse BFS from goal (nodes that can reach goal)
  const canReachGoal = bfsReverse([goalId], adjacency);

  // UNREACHABLE_FROM_DECISION: Must be reachable from decision
  // Exception: observable/external factors may be exogenous roots IF they have path to goal
  // Exception: outcome/risk nodes are exempt (emit info instead of error)
  for (const node of graph.nodes) {
    if (node.kind === "decision" || node.kind === "goal") continue;

    if (!reachableFromDecision.has(node.id)) {
      // Check exemption for exogenous factors
      const factorInfo = factorCategories.get(node.id);
      const isExogenousFactor =
        factorInfo &&
        (factorInfo.category === "observable" || factorInfo.category === "external");

      if (isExogenousFactor && canReachGoal.has(node.id)) {
        // Exempted: exogenous factor with path to goal
        continue;
      }

      // Exempt outcome/risk nodes: emit info instead of error
      if ((node.kind === "outcome" || node.kind === "risk") && canReachGoal.has(node.id)) {
        // Determine exemption reason: exogenous (has ancestors outside decision path) vs isolated
        const ancestors = adjacency.reverse.get(node.id) ?? [];
        const reason = ancestors.length > 0 ? "exogenous" : "isolated";

        infoIssues.push({
          code: "EXEMPT_UNREACHABLE_OUTCOME_RISK",
          severity: "info",
          message: `Outcome/risk "${node.label ?? node.id}" has no controllable path from decision — decision influence is limited`,
          path: `nodesById.${node.id}`,
          context: { kind: node.kind, nodeId: node.id, reason },
        });
        continue;
      }

      errors.push({
        code: "UNREACHABLE_FROM_DECISION",
        severity: "error",
        message: `Node "${node.id}" is not reachable from decision`,
        path: `nodesById.${node.id}`,
        context: { kind: node.kind },
      });
    }
  }

  // NO_PATH_TO_GOAL: All nodes (except decision) must reach goal
  for (const node of graph.nodes) {
    if (node.kind === "decision") continue; // Exempt decision from reverse check

    if (!canReachGoal.has(node.id)) {
      errors.push({
        code: "NO_PATH_TO_GOAL",
        severity: "error",
        message: `Node "${node.id}" has no path to goal`,
        path: `nodesById.${node.id}`,
        context: { kind: node.kind },
      });
    }
  }

  return { errors, infoIssues };
}

// =============================================================================
// Controllability Summary
// =============================================================================

/**
 * Compute controllable ancestry for each outcome/risk node.
 * Uses reverse BFS from each outcome/risk, stopping when a controllable factor is found.
 */
function computeControllabilitySummary(
  graph: GraphT,
  nodeMap: NodeMap,
  adjacency: AdjacencyLists,
  factorCategories: Map<string, FactorCategoryInfo>,
  exemptNodeIds: string[]
): ControllabilitySummary {
  const outcomeRiskNodes = [
    ...(nodeMap.byKind.get("outcome") ?? []),
    ...(nodeMap.byKind.get("risk") ?? []),
  ];

  let withControllable = 0;
  let withoutControllable = 0;

  for (const node of outcomeRiskNodes) {
    // Reverse BFS from this node to find controllable ancestors
    const visited = new Set<string>();
    const queue = [node.id];
    let foundControllable = false;

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const info = factorCategories.get(current);
      if (info?.category === "controllable") {
        foundControllable = true;
        break;
      }

      // Traverse reverse edges (parents)
      const parents = adjacency.reverse.get(current) ?? [];
      for (const parent of parents) {
        if (!visited.has(parent)) {
          queue.push(parent);
        }
      }
    }

    if (foundControllable) {
      withControllable++;
    } else {
      withoutControllable++;
    }
  }

  return {
    total_outcome_risk_nodes: outcomeRiskNodes.length,
    with_controllable_ancestry: withControllable,
    without_controllable_ancestry: withoutControllable,
    exempt_count: exemptNodeIds.length,
    exempt_node_ids: exemptNodeIds,
  };
}

// =============================================================================
// Tier 4: Factor Data Consistency
// =============================================================================

function validateFactorData(
  nodeMap: NodeMap,
  factorCategories: Map<string, FactorCategoryInfo>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const factors = nodeMap.byKind.get("factor") ?? [];

  for (const factor of factors) {
    const info = factorCategories.get(factor.id);
    if (!info) continue;

    const data = factor.data as FactorDataT | undefined;

    if (info.category === "controllable") {
      // CONTROLLABLE_MISSING_DATA: Must have value, extractionType, factor_type, uncertainty_drivers
      const missing: string[] = [];
      if (data?.value === undefined) missing.push("value");
      if (!data?.extractionType) missing.push("extractionType");
      if (!data?.factor_type) missing.push("factor_type");
      if (!data?.uncertainty_drivers) missing.push("uncertainty_drivers");

      if (missing.length > 0) {
        issues.push({
          code: "CONTROLLABLE_MISSING_DATA",
          severity: "error",
          message: `Controllable factor "${factor.id}" missing required data: ${missing.join(", ")}`,
          path: `nodesById.${factor.id}`,
          context: { missing },
        });
      }
    } else if (info.category === "observable") {
      // OBSERVABLE_MISSING_DATA: Must have value and extractionType
      const missing: string[] = [];
      if (data?.value === undefined) missing.push("value");
      if (!data?.extractionType) missing.push("extractionType");

      if (missing.length > 0) {
        issues.push({
          code: "OBSERVABLE_MISSING_DATA",
          severity: "error",
          message: `Observable factor "${factor.id}" missing required data: ${missing.join(", ")}`,
          path: `nodesById.${factor.id}`,
          context: { missing },
        });
      }

      // OBSERVABLE_EXTRA_DATA: Must NOT have factor_type or uncertainty_drivers
      const extra: string[] = [];
      if (data?.factor_type) extra.push("factor_type");
      if (data?.uncertainty_drivers) extra.push("uncertainty_drivers");

      if (extra.length > 0) {
        issues.push({
          code: "OBSERVABLE_EXTRA_DATA",
          severity: "error",
          message: `Observable factor "${factor.id}" should not have: ${extra.join(", ")}`,
          path: `nodesById.${factor.id}`,
          context: { extra },
        });
      }
    } else if (info.category === "external") {
      // EXTERNAL_HAS_DATA: Must NOT have value, factor_type, or uncertainty_drivers
      const extra: string[] = [];
      if (data?.value !== undefined) extra.push("value");
      if (data?.factor_type) extra.push("factor_type");
      if (data?.uncertainty_drivers) extra.push("uncertainty_drivers");

      if (extra.length > 0) {
        issues.push({
          code: "EXTERNAL_HAS_DATA",
          severity: "error",
          message: `External factor "${factor.id}" should not have: ${extra.join(", ")}`,
          path: `nodesById.${factor.id}`,
          context: { extra },
        });
      }
    }

    // CATEGORY_MISMATCH: If explicit category (V12.4+) exists, must match inferred
    if (info.explicitCategory && info.explicitCategory !== info.category) {
      issues.push({
        code: "CATEGORY_MISMATCH",
        severity: "error",
        message: `Factor "${factor.id}" declares category "${info.explicitCategory}" but structure indicates "${info.category}"`,
        path: `nodesById.${factor.id}`,
        context: { explicit: info.explicitCategory, inferred: info.category },
      });
    }
  }

  return issues;
}

// =============================================================================
// Tier 5: Semantic Integrity
// =============================================================================

function validateSemantic(
  graph: GraphT,
  nodeMap: NodeMap,
  adjacency: AdjacencyLists,
  factorCategories: Map<string, FactorCategoryInfo>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const options = nodeMap.byKind.get("option") ?? [];
  const goals = nodeMap.byKind.get("goal") ?? [];

  if (goals.length === 0) return issues;
  const goalId = goals[0].id;

  // Build reachability from goal (reverse)
  const canReachGoal = bfsReverse([goalId], adjacency);

  // NO_EFFECT_PATH: Each option must have >=1 controllable factor with path to goal
  for (const option of options) {
    const optionTargets = adjacency.forward.get(option.id) ?? [];
    const controllableWithPath = optionTargets.filter((targetId) => {
      const factorInfo = factorCategories.get(targetId);
      return factorInfo?.category === "controllable" && canReachGoal.has(targetId);
    });

    if (controllableWithPath.length === 0) {
      issues.push({
        code: "NO_EFFECT_PATH",
        severity: "error",
        message: `Option "${option.id}" has no controllable factors with path to goal`,
        path: `nodesById.${option.id}`,
        context: { targets: optionTargets },
      });
    }
  }

  // OPTIONS_IDENTICAL: Options must have different intervention signatures
  const signatureToOptions = new Map<string, string[]>();
  for (const option of options) {
    const data = option.data as OptionDataT | undefined;
    if (!data?.interventions) continue;

    const signature = buildInterventionSignature(data.interventions);
    const existing = signatureToOptions.get(signature) ?? [];
    existing.push(option.id);
    signatureToOptions.set(signature, existing);
  }

  for (const [signature, optionIds] of signatureToOptions) {
    if (optionIds.length > 1) {
      issues.push({
        code: "OPTIONS_IDENTICAL",
        severity: "error",
        message: `Options have identical intervention signatures: ${optionIds.join(", ")}`,
        context: { optionIds, signature },
      });
    }
  }

  // INVALID_INTERVENTION_REF: Option intervention references non-existent or non-factor node
  for (const option of options) {
    const data = option.data as OptionDataT | undefined;
    if (!data?.interventions) continue;

    for (const factorId of Object.keys(data.interventions)) {
      const targetNode = nodeMap.byId.get(factorId);
      if (!targetNode) {
        issues.push({
          code: "INVALID_INTERVENTION_REF",
          severity: "error",
          message: `Option "${option.id}" references non-existent node: ${factorId}`,
          path: `nodesById.${option.id}.data.interventions`,
          context: { factorId },
        });
      } else if (targetNode.kind !== "factor") {
        issues.push({
          code: "INVALID_INTERVENTION_REF",
          severity: "error",
          message: `Option "${option.id}" intervention references non-factor node: ${factorId} (kind: ${targetNode.kind})`,
          path: `nodesById.${option.id}.data.interventions`,
          context: { factorId, actualKind: targetNode.kind },
        });
      }
    }
  }

  // GOAL_NUMBER_AS_FACTOR: Factor labels should not be goal target values
  // E.g., "£20k MRR" is a goal target, not a causal factor
  const factors = nodeMap.byKind.get("factor") ?? [];
  for (const factor of factors) {
    const label = factor.label ?? factor.id;
    if (isGoalNumberLabel(label)) {
      // Determine controllability using EITHER:
      // 1. category === 'controllable' (declared in factor data), OR
      // 2. Presence of option→factor edges
      // Only flag if BOTH indicate "not controllable"
      const factorInfo = factorCategories.get(factor.id);
      const hasOptionEdge = factorInfo?.hasOptionEdge ?? false;
      const declaredControllable = (factor as any).category === "controllable";
      const isControllable = hasOptionEdge || declaredControllable;

      if (!isControllable) {
        issues.push({
          code: "GOAL_NUMBER_AS_FACTOR",
          severity: "error",
          message: `Factor "${label}" appears to be a goal target value, not a causal factor`,
          path: `nodesById.${factor.id}`,
          context: {
            label,
            factorId: factor.id,
            hasOptionEdge,
            category: (factor as any).category ?? null,
          },
        });
      }
    }
  }

  // STRUCTURAL_EDGE_NOT_CANONICAL_ERROR: option→factor edges must have canonical values
  // This is an ERROR for option→factor (triggering repair), WARNING for decision→option
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    const fromNode = nodeMap.byId.get(edge.from);
    const toNode = nodeMap.byId.get(edge.to);

    if (!fromNode || !toNode) continue;

    // Only check option→factor edges (structural edges that require canonical values)
    if (fromNode.kind === "option" && toNode.kind === "factor") {
      const mean = edge.strength_mean ?? edge.weight;
      const std = edge.strength_std;
      const prob = edge.belief_exists ?? edge.belief;
      const direction = edge.effect_direction;

      // T2: Strict canonical - exactly mean=1.0, std=0.01, prob=1.0, direction="positive"
      // undefined values trigger error (will be repaired by fixNonCanonicalStructuralEdges)
      const isCanonical =
        mean === CANONICAL_EDGE.mean &&
        std === CANONICAL_EDGE.std &&
        prob === CANONICAL_EDGE.prob &&
        direction === CANONICAL_EDGE.direction;

      if (!isCanonical) {
        issues.push({
          code: "STRUCTURAL_EDGE_NOT_CANONICAL_ERROR",
          severity: "error",
          message: `Option→factor structural edge must have canonical values (mean=1.0, std=0.01, prob=1.0, direction="positive")`,
          path: `edges[${i}]`,
          context: {
            from: edge.from,
            to: edge.to,
            expected: { mean: CANONICAL_EDGE.mean, std: CANONICAL_EDGE.std, prob: CANONICAL_EDGE.prob, direction: CANONICAL_EDGE.direction },
            actual: { mean, std, prob, direction },
          },
        });
      }
    }
  }

  return issues;
}

// =============================================================================
// Tier 6: Numeric Validation
// =============================================================================

function validateNumeric(graph: GraphT): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Check nodes for NaN/Infinity in data.value
  for (const node of graph.nodes) {
    if (node.kind === "factor" && node.data) {
      const data = node.data as FactorDataT;
      if (isInvalidNumber(data.value)) {
        issues.push({
          code: "NAN_VALUE",
          severity: "error",
          message: `Factor "${node.id}" has invalid numeric value: ${data.value}`,
          path: `nodesById.${node.id}.data.value`,
          context: { value: data.value },
        });
      }
      if (isInvalidNumber(data.baseline)) {
        issues.push({
          code: "NAN_VALUE",
          severity: "error",
          message: `Factor "${node.id}" has invalid baseline: ${data.baseline}`,
          path: `nodesById.${node.id}.data.baseline`,
          context: { value: data.baseline },
        });
      }
    }

    if (node.kind === "option" && node.data) {
      const data = node.data as OptionDataT;
      if (data.interventions) {
        for (const [factorId, value] of Object.entries(data.interventions)) {
          if (isInvalidNumber(value)) {
            issues.push({
              code: "NAN_VALUE",
              severity: "error",
              message: `Option "${node.id}" has invalid intervention value for ${factorId}: ${value}`,
              path: `nodesById.${node.id}.data.interventions.${factorId}`,
              context: { factorId, value },
            });
          }
        }
      }
    }
  }

  // Check edges for NaN/Infinity in strength_mean, strength_std, belief_exists
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    if (isInvalidNumber(edge.strength_mean)) {
      issues.push({
        code: "NAN_VALUE",
        severity: "error",
        message: `Edge has invalid strength_mean: ${edge.strength_mean}`,
        path: `edges[${i}]`,
        context: { field: "strength_mean", value: edge.strength_mean },
      });
    }
    if (isInvalidNumber(edge.strength_std)) {
      issues.push({
        code: "NAN_VALUE",
        severity: "error",
        message: `Edge has invalid strength_std: ${edge.strength_std}`,
        path: `edges[${i}]`,
        context: { field: "strength_std", value: edge.strength_std },
      });
    }
    if (isInvalidNumber(edge.belief_exists)) {
      issues.push({
        code: "NAN_VALUE",
        severity: "error",
        message: `Edge has invalid belief_exists: ${edge.belief_exists}`,
        path: `edges[${i}]`,
        context: { field: "belief_exists", value: edge.belief_exists },
      });
    }
  }

  return issues;
}

// =============================================================================
// Warnings
// =============================================================================

function collectWarnings(
  graph: GraphT,
  nodeMap: NodeMap,
  factorCategories: Map<string, FactorCategoryInfo>
): ValidationIssue[] {
  const warnings: ValidationIssue[] = [];

  // Edge warnings
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    const fromNode = nodeMap.byId.get(edge.from);
    const toNode = nodeMap.byId.get(edge.to);

    if (!fromNode || !toNode) continue;

    // STRENGTH_OUT_OF_RANGE: mean outside [-1, +1]
    if (edge.strength_mean !== undefined) {
      if (edge.strength_mean < -1 || edge.strength_mean > 1) {
        warnings.push({
          code: "STRENGTH_OUT_OF_RANGE",
          severity: "warn",
          message: `Edge strength_mean ${edge.strength_mean} outside [-1, +1]`,
          path: `edges[${i}]`,
          context: { value: edge.strength_mean },
        });
      }
    }

    // PROBABILITY_OUT_OF_RANGE: prob outside [0, 1]
    if (edge.belief_exists !== undefined) {
      if (edge.belief_exists < 0 || edge.belief_exists > 1) {
        warnings.push({
          code: "PROBABILITY_OUT_OF_RANGE",
          severity: "warn",
          message: `Edge belief_exists ${edge.belief_exists} outside [0, 1]`,
          path: `edges[${i}]`,
          context: { value: edge.belief_exists },
        });
      }
    }

    // OUTCOME_NEGATIVE_POLARITY: outcome->goal with negative mean
    if (fromNode.kind === "outcome" && toNode.kind === "goal") {
      if (edge.strength_mean !== undefined && edge.strength_mean < 0) {
        warnings.push({
          code: "OUTCOME_NEGATIVE_POLARITY",
          severity: "warn",
          message: `Outcome->goal edge has negative strength_mean (${edge.strength_mean})`,
          path: `edges[${i}]`,
          context: { from: edge.from, to: edge.to, value: edge.strength_mean },
        });
      }
    }

    // RISK_POSITIVE_POLARITY: risk->goal with positive mean
    if (fromNode.kind === "risk" && toNode.kind === "goal") {
      if (edge.strength_mean !== undefined && edge.strength_mean > 0) {
        warnings.push({
          code: "RISK_POSITIVE_POLARITY",
          severity: "warn",
          message: `Risk->goal edge has positive strength_mean (${edge.strength_mean})`,
          path: `edges[${i}]`,
          context: { from: edge.from, to: edge.to, value: edge.strength_mean },
        });
      }
    }

    // LOW_EDGE_CONFIDENCE: exists_probability < 0.3
    if (edge.belief_exists !== undefined && edge.belief_exists < 0.3) {
      warnings.push({
        code: "LOW_EDGE_CONFIDENCE",
        severity: "warn",
        message: `Edge has low confidence (belief_exists: ${edge.belief_exists})`,
        path: `edges[${i}]`,
        context: { value: edge.belief_exists },
      });
    }

    // STRUCTURAL_EDGE_NOT_CANONICAL: decision->option or option->factor not canonical
    const isStructuralEdge =
      (fromNode.kind === "decision" && toNode.kind === "option") ||
      (fromNode.kind === "option" && toNode.kind === "factor");

    if (isStructuralEdge) {
      const mean = edge.strength_mean ?? edge.weight;
      const std = edge.strength_std;
      const prob = edge.belief_exists ?? edge.belief;
      const direction = edge.effect_direction;

      const isCanonical =
        mean === CANONICAL_EDGE.mean &&
        (std === undefined || std <= CANONICAL_EDGE.stdMax) &&
        prob === CANONICAL_EDGE.prob &&
        (direction === undefined || direction === CANONICAL_EDGE.direction);

      if (!isCanonical) {
        warnings.push({
          code: "STRUCTURAL_EDGE_NOT_CANONICAL",
          severity: "warn",
          message: `Structural edge ${fromNode.kind}->${toNode.kind} is not canonical`,
          path: `edges[${i}]`,
          context: {
            expected: CANONICAL_EDGE,
            actual: { mean, std, prob, direction },
          },
        });
      }
    } else {
      // LOW_STD_NON_STRUCTURAL: Non-structural edges should have std >= 0.05
      const std = edge.strength_std;
      if (std !== undefined && std < 0.05) {
        warnings.push({
          code: "LOW_STD_NON_STRUCTURAL",
          severity: "warn",
          message: `Non-structural edge has low std (${std}); causal edges should have std >= 0.05`,
          path: `edges[${i}]`,
          context: { from: edge.from, to: edge.to, std, threshold: 0.05 },
        });
      }
    }
  }

  // Factor warnings
  for (const factor of nodeMap.byKind.get("factor") ?? []) {
    const info = factorCategories.get(factor.id);
    if (!info || info.category !== "controllable") continue;

    const data = factor.data as FactorDataT | undefined;

    // EMPTY_UNCERTAINTY_DRIVERS: Controllable has empty array
    if (data?.uncertainty_drivers && data.uncertainty_drivers.length === 0) {
      warnings.push({
        code: "EMPTY_UNCERTAINTY_DRIVERS",
        severity: "warn",
        message: `Controllable factor "${factor.id}" has empty uncertainty_drivers`,
        path: `nodesById.${factor.id}.data.uncertainty_drivers`,
      });
    }
  }

  return warnings;
}

// =============================================================================
// Post-Normalisation Validation
// =============================================================================

/**
 * Validate graph after normalisation (clamping).
 * Checks for sign mismatch between effect_direction and strength_mean.
 */
export function validateGraphPostNormalisation(
  input: GraphValidationInput
): GraphValidationResult {
  const { graph, requestId } = input;
  const issues: ValidationIssue[] = [];

  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];

    // SIGN_MISMATCH: effect_direction contradicts sign(strength_mean)
    if (edge.effect_direction && edge.strength_mean !== undefined && edge.strength_mean !== 0) {
      const signIsPositive = edge.strength_mean > 0;
      const directionIsPositive = edge.effect_direction === "positive";

      if (signIsPositive !== directionIsPositive) {
        issues.push({
          code: "SIGN_MISMATCH",
          severity: "error",
          message: `Edge effect_direction "${edge.effect_direction}" contradicts strength_mean sign (${edge.strength_mean})`,
          path: `edges[${i}]`,
          context: {
            effect_direction: edge.effect_direction,
            strength_mean: edge.strength_mean,
          },
        });
      }
    }
  }

  if (issues.length > 0) {
    log.warn(
      {
        event: "graph_validator.post_norm.issues",
        requestId,
        issueCount: issues.length,
      },
      "Post-normalisation validation found issues"
    );
  }

  return {
    valid: issues.length === 0,
    errors: issues,
    warnings: [],
  };
}

// =============================================================================
// Main Validation Function
// =============================================================================

/**
 * Validate a graph for structural, topological, and semantic correctness.
 * Runs after Zod schema validation, before enrichment.
 *
 * @param input - The graph to validate with optional request ID
 * @returns Validation result with errors and warnings
 */
export function validateGraph(input: GraphValidationInput): GraphValidationResult {
  const { graph, requestId } = input;
  const startTime = Date.now();

  log.info(
    {
      event: "graph_validator.start",
      requestId,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
    },
    "Starting graph validation"
  );

  // Build lookup structures
  const nodeMap = buildNodeMap(graph.nodes);
  const adjacency = buildAdjacencyLists(graph.edges);
  const factorCategories = inferFactorCategories(graph.nodes, graph.edges, nodeMap);

  // Normalise: override LLM-declared categories with structural inference.
  // Auto-fills/strips data fields so Tier 4 sees consistent state.
  const { overrides: categoryOverrides } = normaliseCategoryOverrides(
    graph, nodeMap, factorCategories, requestId
  );

  // Collect all errors (don't short-circuit)
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Tier 1: Structural
  errors.push(...validateStructural(graph, nodeMap));

  // Tier 2: Topology
  errors.push(...validateTopology(graph, nodeMap, adjacency, factorCategories));

  // Tier 3: Reachability
  const reachabilityResult = validateReachability(graph, nodeMap, adjacency, factorCategories);
  errors.push(...reachabilityResult.errors);

  // Tier 4: Factor Data Consistency
  errors.push(...validateFactorData(nodeMap, factorCategories));

  // Tier 5: Semantic Integrity
  errors.push(...validateSemantic(graph, nodeMap, adjacency, factorCategories));

  // Tier 6: Numeric
  errors.push(...validateNumeric(graph));

  // Collect warnings
  warnings.push(...collectWarnings(graph, nodeMap, factorCategories));

  // Append category override info issues for observability
  warnings.push(...categoryOverrides);

  // Append outcome/risk reachability exemption info issues
  warnings.push(...reachabilityResult.infoIssues);

  // Compute controllability summary metadata
  const exemptNodeIds = reachabilityResult.infoIssues
    .map((i) => i.context?.nodeId as string)
    .filter(Boolean);
  const controllability_summary = computeControllabilitySummary(
    graph, nodeMap, adjacency, factorCategories, exemptNodeIds
  );

  const durationMs = Date.now() - startTime;

  log.info(
    {
      event: "graph_validator.complete",
      requestId,
      errorCount: errors.length,
      warningCount: warnings.length,
      controllability_summary,
      durationMs,
      valid: errors.length === 0,
    },
    errors.length === 0 ? "Graph validation passed" : "Graph validation failed"
  );

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    controllability_summary,
  };
}
