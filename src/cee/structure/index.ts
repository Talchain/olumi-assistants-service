import type { components } from "../../generated/openapi.d.ts";
import type { GraphV1 } from "../../contracts/plot/engine.js";
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from "../../config/graphCaps.js";

type CEEStructuralWarningV1 = components["schemas"]["CEEStructuralWarningV1"];

export interface StructuralMeta {
  had_cycles?: boolean;
  cycle_node_ids?: string[];
  had_pruned_nodes?: boolean;
}

export interface StructuralDetectionResult {
  warnings: CEEStructuralWarningV1[];
  uncertainNodeIds: string[];
}

/**
 * Deterministic, metadata-only structural diagnostics for CEE v1.
 *
 * This helper only inspects graph structure (node kinds, edges, IDs) and
 * upstream structural meta. It never inspects labels or free text and never
 * performs network or LLM calls.
 */
export function detectStructuralWarnings(
  graph: GraphV1 | undefined,
  meta?: StructuralMeta,
): StructuralDetectionResult {
  const warnings: CEEStructuralWarningV1[] = [];
  const uncertainNodeIds = new Set<string>();

  if (!graph || !Array.isArray((graph as any).nodes) || !Array.isArray((graph as any).edges)) {
    return { warnings, uncertainNodeIds: [] };
  }

  const nodes = ((graph as any).nodes ?? []) as any[];
  const edges = ((graph as any).edges ?? []) as any[];

  const byId = new Map<string, any>();
  for (const n of nodes) {
    const id = (n as any)?.id;
    if (typeof id === "string" && id.length > 0) {
      byId.set(id, n);
    }
  }

  const nodeIds = Array.from(byId.keys());

  const getKind = (id: string): string | undefined => {
    const n = byId.get(id);
    const kind = (n as any)?.kind;
    return typeof kind === "string" ? kind : undefined;
  };

  // 1) no_outcome_node: graph contains no outcome nodes at all.
  const hasOutcome = nodes.some((n) => (n as any)?.kind === "outcome");
  if (!hasOutcome && nodeIds.length > 0) {
    const relatedIds = nodeIds.slice(0, 20);
    for (const id of relatedIds) uncertainNodeIds.add(id);
    warnings.push({
      id: "no_outcome_node",
      severity: "medium",
      node_ids: relatedIds,
      edge_ids: [],
      explanation:
        "Graph contains no outcome nodes; decision consequences may not be fully represented.",
    } as CEEStructuralWarningV1);
  }

  // 2) orphan_node: nodes not connected to any edges but still present in final graph.
  if (nodeIds.length > 1) {
    const connected = new Set<string>();
    for (const e of edges) {
      const from = (e as any)?.from;
      const to = (e as any)?.to;
      if (typeof from === "string") connected.add(from);
      if (typeof to === "string") connected.add(to);
    }

    const orphanIds = nodeIds.filter((id) => !connected.has(id));
    if (orphanIds.length > 0) {
      const capped = orphanIds.slice(0, 20);
      for (const id of capped) uncertainNodeIds.add(id);
      warnings.push({
        id: "orphan_node",
        severity: "low",
        node_ids: capped,
        edge_ids: [],
        explanation:
          "Some nodes are not connected to any edges; they may not influence the decision.",
      } as CEEStructuralWarningV1);
    }
  }

  // 3) cycle_detected: cycles were present upstream and broken to enforce DAG.
  if (meta?.had_cycles && Array.isArray(meta.cycle_node_ids) && meta.cycle_node_ids.length > 0) {
    const cycleNodeIds = meta.cycle_node_ids.filter((id) => byId.has(id));
    for (const id of cycleNodeIds) uncertainNodeIds.add(id);
    warnings.push({
      id: "cycle_detected",
      severity: "high",
      node_ids: cycleNodeIds,
      edge_ids: [],
      explanation:
        "Cycles were detected and automatically broken to enforce DAG structure; review these nodes for correctness.",
    } as CEEStructuralWarningV1);
  }

  // 4) decision_after_outcome: edges flowing from outcome back into decision/goal/option.
  const backwardsEdgeNodeIds = new Set<string>();
  const backwardsEdgeIds: string[] = [];

  for (const e of edges) {
    const from = (e as any)?.from;
    const to = (e as any)?.to;
    if (typeof from !== "string" || typeof to !== "string") continue;

    const fromKind = getKind(from);
    const toKind = getKind(to);

    if (fromKind === "outcome" && (toKind === "decision" || toKind === "goal" || toKind === "option")) {
      backwardsEdgeNodeIds.add(from);
      backwardsEdgeNodeIds.add(to);
      const edgeId = (e as any)?.id;
      if (typeof edgeId === "string" && edgeId.length > 0) {
        backwardsEdgeIds.push(edgeId);
      }
    }
  }

  if (backwardsEdgeNodeIds.size > 0) {
    const nodesList = Array.from(backwardsEdgeNodeIds);
    for (const id of nodesList) uncertainNodeIds.add(id);
    warnings.push({
      id: "decision_after_outcome",
      severity: "medium",
      node_ids: nodesList,
      edge_ids: backwardsEdgeIds,
      explanation:
        "Some edges flow from outcome nodes back into decision or option nodes; this may invert cause and effect.",
    } as CEEStructuralWarningV1);
  }

  return {
    warnings,
    uncertainNodeIds: Array.from(uncertainNodeIds),
  };
}

export function normaliseDecisionBranchBeliefs(
  graph: GraphV1 | undefined,
): GraphV1 | undefined {
  if (!graph || !Array.isArray((graph as any).nodes) || !Array.isArray((graph as any).edges)) {
    return graph;
  }

  const nodes = (graph as any).nodes as any[];
  const edges = (graph as any).edges as any[];

  const kinds = new Map<string, string>();
  for (const node of nodes) {
    const id = typeof (node as any)?.id === "string" ? ((node as any).id as string) : undefined;
    const kind = typeof (node as any)?.kind === "string" ? ((node as any).kind as string) : undefined;
    if (!id || !kind) continue;
    kinds.set(id, kind);
  }

  const groups = new Map<string, number[]>();
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index] as any;
    const from = typeof edge?.from === "string" ? (edge.from as string) : undefined;
    const to = typeof edge?.to === "string" ? (edge.to as string) : undefined;
    if (!from || !to) continue;

    const fromKind = kinds.get(from);
    const toKind = kinds.get(to);
    if (fromKind === "decision" && toKind === "option") {
      const existing = groups.get(from);
      if (existing) {
        existing.push(index);
      } else {
        groups.set(from, [index]);
      }
    }
  }

  if (groups.size === 0) {
    return graph;
  }

  const epsilon = 0.01;
  let mutated = false;
  const normalisedEdges = edges.map((edge) => ({ ...(edge as any) }));

  for (const indices of groups.values()) {
    if (indices.length < 2) continue;

    const numericIndices: number[] = [];
    const values: number[] = [];

    for (const edgeIndex of indices) {
      const raw = (normalisedEdges[edgeIndex] as any).belief;
      if (typeof raw === "number" && Number.isFinite(raw)) {
        const clamped = Math.max(0, Math.min(1, raw));
        numericIndices.push(edgeIndex);
        values.push(clamped);
      }
    }

    if (numericIndices.length < 2) continue;

    const sum = values.reduce((acc, value) => acc + value, 0);
    if (!(sum > 0)) continue;

    if (Math.abs(sum - 1) <= epsilon) continue;

    mutated = true;
    for (let i = 0; i < numericIndices.length; i += 1) {
      const edgeIndex = numericIndices[i];
      const value = values[i];
      (normalisedEdges[edgeIndex] as any).belief = value / sum;
    }
  }

  if (!mutated) {
    return graph;
  }

  return {
    ...(graph as any),
    edges: normalisedEdges as any,
  } as GraphV1;
}

/**
 * Result of graph size limit validation
 */
export interface GraphSizeValidationResult {
  valid: boolean;
  nodeCount: number;
  edgeCount: number;
  maxNodes: number;
  maxEdges: number;
  error?: string;
}

/**
 * Validate graph against size limits.
 * Returns validation result with error message if limits exceeded.
 */
export function validateGraphSizeLimits(
  graph: GraphV1 | undefined,
): GraphSizeValidationResult {
  const maxNodes = GRAPH_MAX_NODES;
  const maxEdges = GRAPH_MAX_EDGES;

  if (!graph || !Array.isArray((graph as any).nodes) || !Array.isArray((graph as any).edges)) {
    return { valid: true, nodeCount: 0, edgeCount: 0, maxNodes, maxEdges };
  }

  const nodeCount = ((graph as any).nodes as any[]).length;
  const edgeCount = ((graph as any).edges as any[]).length;

  if (nodeCount > maxNodes) {
    return {
      valid: false,
      nodeCount,
      edgeCount,
      maxNodes,
      maxEdges,
      error: `Graph exceeds maximum node limit: ${nodeCount} nodes (max ${maxNodes})`,
    };
  }

  if (edgeCount > maxEdges) {
    return {
      valid: false,
      nodeCount,
      edgeCount,
      maxNodes,
      maxEdges,
      error: `Graph exceeds maximum edge limit: ${edgeCount} edges (max ${maxEdges})`,
    };
  }

  return { valid: true, nodeCount, edgeCount, maxNodes, maxEdges };
}

/**
 * Result of single goal enforcement
 */
export interface SingleGoalResult {
  graph: GraphV1;
  hadMultipleGoals: boolean;
  originalGoalCount: number;
  mergedGoalIds?: string[];
}

/**
 * Score an edge for deduplication priority.
 * Prefer edges with provenance, then with beliefs, then with IDs.
 */
function edgePriority(edge: any): number {
  let score = 0;
  if (edge?.provenance?.source) score += 100;
  if (edge?.provenance?.quote) score += 50;
  if (typeof edge?.belief === "number") score += 10;
  if (typeof edge?.id === "string") score += 1;
  return score;
}

/**
 * Enforce single goal constraint.
 * If multiple goal nodes exist, merge them into a compound goal.
 *
 * Strategy:
 * - Keep the first goal node as the primary
 * - Update its label to combine all goal labels
 * - Redirect all edges pointing to other goals to point to the primary
 * - Remove the duplicate goal nodes
 * - When deduplicating edges, prefer edges with provenance/metadata
 */
export function enforceSingleGoal(
  graph: GraphV1 | undefined,
): SingleGoalResult | undefined {
  if (!graph || !Array.isArray((graph as any).nodes) || !Array.isArray((graph as any).edges)) {
    return undefined;
  }

  const nodes = (graph as any).nodes as any[];
  const edges = (graph as any).edges as any[];

  // Find all goal nodes
  const goalNodes: any[] = [];
  const goalIds: string[] = [];

  for (const node of nodes) {
    if ((node as any)?.kind === "goal" && typeof (node as any)?.id === "string") {
      goalNodes.push(node);
      goalIds.push((node as any).id as string);
    }
  }

  // No goals or single goal - no merge needed
  if (goalNodes.length <= 1) {
    return {
      graph,
      hadMultipleGoals: false,
      originalGoalCount: goalNodes.length,
    };
  }

  // Multiple goals - merge into compound goal
  const primaryId = goalIds[0];
  const otherGoalIds = new Set(goalIds.slice(1));

  // Combine labels into compound goal
  const labels = goalNodes
    .map((g) => (g as any)?.label)
    .filter((l) => typeof l === "string" && l.length > 0);
  const compoundLabel = labels.length > 1
    ? `Compound Goal: ${labels.join(" + ")}`
    : labels[0] || "Compound Goal";

  // Create updated nodes array
  const updatedNodes = nodes.map((node) => {
    if ((node as any)?.id === primaryId) {
      return {
        ...(node as any),
        label: compoundLabel,
      };
    }
    return node;
  }).filter((node) => !otherGoalIds.has((node as any)?.id));

  // Redirect edges from other goals to primary goal
  const updatedEdges = edges.map((edge) => {
    const from = (edge as any)?.from;
    const to = (edge as any)?.to;
    const newEdge = { ...(edge as any) };

    if (typeof from === "string" && otherGoalIds.has(from)) {
      newEdge.from = primaryId;
    }
    if (typeof to === "string" && otherGoalIds.has(to)) {
      newEdge.to = primaryId;
    }

    return newEdge;
  });

  // Deduplicate edges, preferring those with provenance/metadata
  const edgesByKey = new Map<string, any>();
  for (const edge of updatedEdges) {
    const key = `${(edge as any)?.from}:${(edge as any)?.to}`;
    const existing = edgesByKey.get(key);
    if (!existing || edgePriority(edge) > edgePriority(existing)) {
      edgesByKey.set(key, edge);
    }
  }
  const dedupedEdges = Array.from(edgesByKey.values());

  // Update meta.roots to reflect single goal
  const updatedMeta = {
    ...((graph as any).meta || {}),
    roots: [primaryId],
  };

  return {
    graph: {
      ...(graph as any),
      nodes: updatedNodes as any,
      edges: dedupedEdges as any,
      meta: updatedMeta,
    } as GraphV1,
    hadMultipleGoals: true,
    originalGoalCount: goalNodes.length,
    mergedGoalIds: goalIds,
  };
}

/**
 * Result of outcome edge belief fix
 */
export interface OutcomeBeliefFixResult {
  graph: GraphV1;
  fixedEdgeCount: number;
  fixedEdgeIds: string[];
}

/**
 * Fix missing beliefs on option→outcome edges.
 * Sets default belief of 0.5 for edges missing numeric belief values.
 */
export function fixMissingOutcomeEdgeBeliefs(
  graph: GraphV1 | undefined,
  defaultBelief: number = 0.5,
): OutcomeBeliefFixResult | undefined {
  if (!graph || !Array.isArray((graph as any).nodes) || !Array.isArray((graph as any).edges)) {
    return undefined;
  }

  const nodes = (graph as any).nodes as any[];
  const edges = (graph as any).edges as any[];

  // Build kind lookup
  const kinds = new Map<string, string>();
  for (const node of nodes) {
    const id = typeof (node as any)?.id === "string" ? ((node as any).id as string) : undefined;
    const kind = typeof (node as any)?.kind === "string" ? ((node as any).kind as string) : undefined;
    if (id && kind) {
      kinds.set(id, kind);
    }
  }

  const fixedEdgeIds: string[] = [];
  let mutated = false;

  const updatedEdges = edges.map((edge) => {
    const from = (edge as any)?.from;
    const to = (edge as any)?.to;
    const belief = (edge as any)?.belief;
    const edgeId = (edge as any)?.id;

    // Only fix option→outcome edges
    if (
      typeof from === "string" &&
      typeof to === "string" &&
      kinds.get(from) === "option" &&
      kinds.get(to) === "outcome"
    ) {
      // Check if belief is missing or not a valid number
      if (belief === undefined || belief === null || typeof belief !== "number" || !Number.isFinite(belief)) {
        mutated = true;
        if (typeof edgeId === "string") {
          fixedEdgeIds.push(edgeId);
        }
        return {
          ...(edge as any),
          belief: defaultBelief,
        };
      }
    }

    return edge;
  });

  if (!mutated) {
    return {
      graph,
      fixedEdgeCount: 0,
      fixedEdgeIds: [],
    };
  }

  return {
    graph: {
      ...(graph as any),
      edges: updatedEdges as any,
    } as GraphV1,
    fixedEdgeCount: fixedEdgeIds.length,
    fixedEdgeIds,
  };
}

/**
 * Options for graph validation and fixing
 */
export interface GraphFixOptions {
  /** Merge multiple goals into compound goal (default: true) */
  enforceSingleGoal?: boolean;
  /** Fill missing option→outcome beliefs with default (default: true) */
  fillOutcomeBeliefs?: boolean;
  /** Default belief value for missing outcome edges (default: 0.5) */
  defaultOutcomeBelief?: number;
  /** Normalize decision→option beliefs to sum to 1.0 (default: true) */
  normalizeDecisionBranches?: boolean;
  /** Check size limits (default: true, but caller should use existing pipeline) */
  checkSizeLimits?: boolean;
}

/**
 * Combined validation and fix result
 */
export interface GraphValidationAndFixResult {
  graph: GraphV1 | undefined;
  valid: boolean;
  error?: string;
  fixes: {
    singleGoalApplied: boolean;
    originalGoalCount?: number;
    mergedGoalIds?: string[];
    outcomeBeliefsFilled: number;
    decisionBranchesNormalized: boolean;
  };
  warnings: CEEStructuralWarningV1[];
}

/**
 * Comprehensive graph validation and fixing pipeline.
 *
 * IMPORTANT: This is designed as a **mutating pre-processor**, not as the
 * arbiter of valid/error. The CEE draft pipeline should continue to use
 * validateResponse / validateMinimumStructure / buildCeeErrorResponse for
 * error handling with proper error codes and telemetry.
 *
 * Intended usage:
 * ```ts
 * const { graph: fixed, fixes } = validateAndFixGraph(payload.graph, meta, options);
 * if (fixed) payload.graph = fixed;
 * // Attach fixes to draft_warnings if desired
 * ```
 *
 * Execution order:
 * 1. Size limit check (optional, defaults to true but redundant with existing guards)
 * 2. Single goal enforcement (optional, merge if multiple)
 * 3. Fix missing outcome edge beliefs (optional, default 0.5)
 * 4. Normalize decision branch beliefs (sum to 1.0)
 * 5. Detect structural warnings (uses meta for cycle_detected)
 *
 * @param graph - The graph to validate and fix
 * @param meta - Optional StructuralMeta for cycle detection warnings
 * @param options - Optional configuration for which fixes to apply
 */
export function validateAndFixGraph(
  graph: GraphV1 | undefined,
  meta?: StructuralMeta,
  options?: GraphFixOptions,
): GraphValidationAndFixResult {
  const opts: Required<GraphFixOptions> = {
    enforceSingleGoal: options?.enforceSingleGoal ?? true,
    fillOutcomeBeliefs: options?.fillOutcomeBeliefs ?? true,
    defaultOutcomeBelief: options?.defaultOutcomeBelief ?? 0.5,
    normalizeDecisionBranches: options?.normalizeDecisionBranches ?? true,
    checkSizeLimits: options?.checkSizeLimits ?? true,
  };

  // Handle empty/invalid input
  if (!graph || !Array.isArray((graph as any).nodes) || !Array.isArray((graph as any).edges)) {
    return {
      graph: undefined,
      valid: false,
      error: "Invalid graph structure: missing nodes or edges array",
      fixes: {
        singleGoalApplied: false,
        outcomeBeliefsFilled: 0,
        decisionBranchesNormalized: false,
      },
      warnings: [],
    };
  }

  // Step 1: Size limit validation (optional, existing pipeline handles this)
  if (opts.checkSizeLimits) {
    const sizeResult = validateGraphSizeLimits(graph);
    if (!sizeResult.valid) {
      return {
        graph: undefined,
        valid: false,
        error: sizeResult.error,
        fixes: {
          singleGoalApplied: false,
          outcomeBeliefsFilled: 0,
          decisionBranchesNormalized: false,
        },
        warnings: [],
      };
    }
  }

  let currentGraph = graph;
  const fixes = {
    singleGoalApplied: false,
    originalGoalCount: undefined as number | undefined,
    mergedGoalIds: undefined as string[] | undefined,
    outcomeBeliefsFilled: 0,
    decisionBranchesNormalized: false,
  };

  // Step 2: Single goal enforcement (optional)
  if (opts.enforceSingleGoal) {
    const singleGoalResult = enforceSingleGoal(currentGraph);
    if (singleGoalResult) {
      currentGraph = singleGoalResult.graph;
      fixes.singleGoalApplied = singleGoalResult.hadMultipleGoals;
      fixes.originalGoalCount = singleGoalResult.originalGoalCount;
      fixes.mergedGoalIds = singleGoalResult.mergedGoalIds;
    }
  }

  // Step 3: Fix missing outcome edge beliefs (optional)
  if (opts.fillOutcomeBeliefs) {
    const outcomeFixResult = fixMissingOutcomeEdgeBeliefs(currentGraph, opts.defaultOutcomeBelief);
    if (outcomeFixResult) {
      currentGraph = outcomeFixResult.graph;
      fixes.outcomeBeliefsFilled = outcomeFixResult.fixedEdgeCount;
    }
  }

  // Step 4: Normalize decision branch beliefs
  if (opts.normalizeDecisionBranches) {
    const beforeNormalize = currentGraph;
    const normalizedGraph = normaliseDecisionBranchBeliefs(currentGraph);
    if (normalizedGraph && normalizedGraph !== beforeNormalize) {
      currentGraph = normalizedGraph;
      fixes.decisionBranchesNormalized = true;
    }
  }

  // Step 5: Detect structural warnings (pass meta for cycle_detected)
  const { warnings } = detectStructuralWarnings(currentGraph, meta);

  return {
    graph: currentGraph,
    valid: true,
    fixes,
    warnings,
  };
}
