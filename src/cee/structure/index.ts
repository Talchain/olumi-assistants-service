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
      affected_node_ids: relatedIds,
      affected_edge_ids: [],
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
        affected_node_ids: capped,
        affected_edge_ids: [],
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
      affected_node_ids: cycleNodeIds,
      affected_edge_ids: [],
      explanation:
        "Cycles were detected and automatically broken to enforce DAG structure; review these nodes for correctness.",
    } as CEEStructuralWarningV1);
  }

  // 4) decision_after_outcome: edges flowing from outcome back into decision/option.
  // NOTE: outcome→goal is VALID V4 topology (outcomes aggregate into goals)
  const backwardsEdgeNodeIds = new Set<string>();
  const backwardsEdgeIds: string[] = [];

  for (const e of edges) {
    const from = (e as any)?.from;
    const to = (e as any)?.to;
    if (typeof from !== "string" || typeof to !== "string") continue;

    const fromKind = getKind(from);
    const toKind = getKind(to);

    if (fromKind === "outcome" && (toKind === "decision" || toKind === "option")) {
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
      affected_node_ids: nodesList,
      affected_edge_ids: backwardsEdgeIds,
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
      // V4 fields take precedence, fallback to legacy for backwards compatibility
      const raw = (normalisedEdges[edgeIndex] as any).belief_exists ?? (normalisedEdges[edgeIndex] as any).belief;
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
      const normalizedValue = value / sum;
      // Write to both V4 and legacy fields during transition
      (normalisedEdges[edgeIndex] as any).belief_exists = normalizedValue;
      (normalisedEdges[edgeIndex] as any).belief = normalizedValue;
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
  // V4 field takes precedence, fallback to legacy
  if (typeof edge?.belief_exists === "number" || typeof edge?.belief === "number") score += 10;
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

  // Normalize beliefs on edges leaving the compound goal to 1.0
  // After goal merge, there's only one path from compound goal, so belief should be 100%
  const dedupedEdges = Array.from(edgesByKey.values()).map((edge) => {
    // V4 field takes precedence, fallback to legacy
    const hasBeliefValue = typeof (edge as any)?.belief_exists === "number" || typeof (edge as any)?.belief === "number";
    if ((edge as any)?.from === primaryId && hasBeliefValue) {
      // Write to both V4 and legacy fields during transition
      return { ...edge, belief_exists: 1.0, belief: 1.0 };
    }
    return edge;
  });

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
    // V4 field takes precedence, fallback to legacy
    const belief = (edge as any)?.belief_exists ?? (edge as any)?.belief;
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
          // Write to both V4 and legacy fields during transition
          belief_exists: defaultBelief,
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

/**
 * Uniform strength detection result
 */
export interface UniformStrengthResult {
  /** Whether uniform strengths were detected (>80% edges have default 0.5) */
  detected: boolean;
  /** Total number of edges analyzed */
  totalEdges: number;
  /** Number of edges with default 0.5 strength */
  defaultStrengthCount: number;
  /** Percentage of edges with default strength */
  defaultStrengthPercentage: number;
  /** Warning to include in draft_warnings if detected */
  warning?: CEEStructuralWarningV1;
}

/**
 * Structural edge types that should be excluded from uniform strength detection.
 * These edges don't carry meaningful causal weights:
 * - decision→option: represents branching, not causal influence
 * - option→factor: represents intervention targeting, not causal influence
 * Aligned with V3 validator logic (src/cee/validation/v3-validator.ts:213)
 */
const STRUCTURAL_EDGE_TYPES = new Set(["decision-option", "option-factor"]);

/**
 * Detect uniform edge strengths indicating LLM did not output varied coefficients.
 *
 * When >80% of CAUSAL edges have strength_mean === 0.5 (the default), this indicates
 * the LLM failed to output the V4 `strength: {mean, std}` nested object and
 * the pipeline fell back to defaults. This defeats sensitivity analysis.
 *
 * Structural edges (decision→option, option→factor) are excluded from this check
 * as they don't carry meaningful causal weights.
 *
 * @param graph - Graph to analyze
 * @param threshold - Percentage threshold for detection (default: 0.8 = 80%)
 * @returns Detection result with optional warning
 */
export function detectUniformStrengths(
  graph: GraphV1 | undefined,
  threshold: number = 0.8,
): UniformStrengthResult {
  const DEFAULT_STRENGTH = 0.5;
  const EPSILON = 0.001; // Tolerance for floating point comparison

  if (!graph || !Array.isArray((graph as any).edges) || !Array.isArray((graph as any).nodes)) {
    return {
      detected: false,
      totalEdges: 0,
      defaultStrengthCount: 0,
      defaultStrengthPercentage: 0,
    };
  }

  const nodes = (graph as any).nodes as any[];
  const edges = (graph as any).edges as any[];

  if (edges.length === 0) {
    return {
      detected: false,
      totalEdges: 0,
      defaultStrengthCount: 0,
      defaultStrengthPercentage: 0,
    };
  }

  // Build node kind map for edge type classification
  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) {
    const id = typeof node?.id === "string" ? node.id : undefined;
    const kind = typeof node?.kind === "string" ? node.kind : undefined;
    if (id && kind) {
      nodeKindMap.set(id, kind);
    }
  }

  let defaultStrengthCount = 0;
  let causalEdgeCount = 0;
  const affectedEdgeIds: string[] = [];

  for (const edge of edges) {
    const from = edge?.from;
    const to = edge?.to;
    const fromKind = typeof from === "string" ? nodeKindMap.get(from) : undefined;
    const toKind = typeof to === "string" ? nodeKindMap.get(to) : undefined;

    // Skip structural edges (don't carry meaningful causal weights)
    if (fromKind && toKind) {
      const edgeType = `${fromKind}-${toKind}`;
      if (STRUCTURAL_EDGE_TYPES.has(edgeType)) {
        continue;
      }
    }

    causalEdgeCount++;

    // Check V4 field (strength_mean) first, fallback to legacy (weight)
    const strength = edge?.strength_mean ?? edge?.weight ?? DEFAULT_STRENGTH;

    if (typeof strength === "number" && Math.abs(strength - DEFAULT_STRENGTH) < EPSILON) {
      defaultStrengthCount++;
      const edgeId = edge?.id;
      if (typeof edgeId === "string" && affectedEdgeIds.length < 10) {
        affectedEdgeIds.push(edgeId);
      }
    }
  }

  // Handle case where all edges are structural
  if (causalEdgeCount === 0) {
    return {
      detected: false,
      totalEdges: edges.length,
      defaultStrengthCount: 0,
      defaultStrengthPercentage: 0,
    };
  }

  const defaultStrengthPercentage = defaultStrengthCount / causalEdgeCount;
  const detected = defaultStrengthPercentage >= threshold;

  if (!detected) {
    return {
      detected: false,
      totalEdges: causalEdgeCount,
      defaultStrengthCount,
      defaultStrengthPercentage,
    };
  }

  const warning: CEEStructuralWarningV1 = {
    id: "uniform_edge_strengths",
    severity: "medium",
    node_ids: [],
    edge_ids: affectedEdgeIds,
    affected_node_ids: [],
    affected_edge_ids: affectedEdgeIds,
    explanation: `${Math.round(defaultStrengthPercentage * 100)}% of causal edges have default strength (0.5). ` +
      `The LLM may not have output varied edge coefficients, which reduces sensitivity analysis accuracy. ` +
      `Consider reviewing edge strengths or refining the brief with more causal detail.`,
  };

  return {
    detected: true,
    totalEdges: causalEdgeCount,
    defaultStrengthCount,
    defaultStrengthPercentage,
    warning,
  };
}

/**
 * Canonical edge values for structural edges (decision→option, option→factor).
 * These edges represent structural relationships, not causal influence,
 * so they should have fixed values.
 * T2: Strict canonical - exactly std=0.01, undefined triggers repair.
 */
const CANONICAL_STRUCTURAL_EDGE = {
  mean: 1.0,
  std: 0.01,    // Strict canonical (not a max)
  prob: 1.0,
  direction: "positive" as const,
};

/**
 * PLoT-compatible repair record for tracking changes.
 * T3: Matches PLoT's repairs_applied[] structure.
 */
export interface RepairRecord {
  /** Field that was repaired: "strength.std", "strength.mean", "exists_probability" */
  field: string;
  /** Action taken: "clamped" | "defaulted" | "normalised" */
  action: "clamped" | "defaulted" | "normalised";
  /** Original value (null if undefined) */
  from_value: number | string | null;
  /** New canonical value */
  to_value: number | string;
  /** Human-readable explanation */
  reason: string;
  /** Edge ID (use actual edge.id, NOT from->to concatenation) */
  edge_id: string;
  /** Source node ID */
  edge_from: string;
  /** Target node ID */
  edge_to: string;
}

/**
 * Result of structural edge fix operation
 */
export interface StructuralEdgeFixResult {
  graph: GraphV1;
  fixedEdgeCount: number;
  fixedEdgeIds: string[];
  /** T3: PLoT-compatible repair records */
  repairs: RepairRecord[];
}

/**
 * Fix non-canonical structural edges (option→factor) to have canonical values.
 *
 * Structural edges represent structural relationships (option targets a factor),
 * not causal influence. They should have:
 * - strength_mean: 1.0
 * - strength_std: 0.01
 * - belief_exists: 1.0
 * - effect_direction: "positive"
 *
 * This is a deterministic repair that does not require LLM intervention.
 * T3: Returns PLoT-compatible RepairRecord array for each field repaired.
 *
 * @param graph - Graph to fix
 * @returns Fixed graph with count of repaired edges and repair records
 */
export function fixNonCanonicalStructuralEdges(
  graph: GraphV1 | undefined,
): StructuralEdgeFixResult | undefined {
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
  const repairs: RepairRecord[] = [];
  let mutated = false;

  const updatedEdges = edges.map((edge, index) => {
    const from = (edge as any)?.from;
    const to = (edge as any)?.to;
    // T3: Use real edge.id to avoid multi-edge collisions
    const edgeId = typeof (edge as any)?.id === "string"
      ? ((edge as any).id as string)
      : `${from}:${to}:structural:${index}`;

    // Only fix option→factor edges (structural edges)
    if (
      typeof from === "string" &&
      typeof to === "string" &&
      kinds.get(from) === "option" &&
      kinds.get(to) === "factor"
    ) {
      // Check if edge is already canonical
      // T2: Strict canonical - exactly mean=1.0, std=0.01, prob=1.0, direction="positive"
      const mean = (edge as any)?.strength_mean ?? (edge as any)?.weight;
      const std = (edge as any)?.strength_std;
      const prob = (edge as any)?.belief_exists ?? (edge as any)?.belief;
      const direction = (edge as any)?.effect_direction;

      const isCanonical =
        mean === CANONICAL_STRUCTURAL_EDGE.mean &&
        std === CANONICAL_STRUCTURAL_EDGE.std &&
        prob === CANONICAL_STRUCTURAL_EDGE.prob &&
        direction === CANONICAL_STRUCTURAL_EDGE.direction;

      if (!isCanonical) {
        mutated = true;
        if (typeof (edge as any)?.id === "string") {
          fixedEdgeIds.push((edge as any).id);
        }

        // T3: Track individual field repairs
        if (mean !== CANONICAL_STRUCTURAL_EDGE.mean) {
          repairs.push({
            edge_id: edgeId,
            edge_from: from,
            edge_to: to,
            field: "strength.mean",
            action: mean === undefined ? "defaulted" : "normalised",
            from_value: mean ?? null,
            to_value: CANONICAL_STRUCTURAL_EDGE.mean,
            reason: "Structural edge mean normalised to canonical value",
          });
        }
        if (std !== CANONICAL_STRUCTURAL_EDGE.std) {
          repairs.push({
            edge_id: edgeId,
            edge_from: from,
            edge_to: to,
            field: "strength.std",
            action: std === undefined ? "defaulted" : "normalised",
            from_value: std ?? null,
            to_value: CANONICAL_STRUCTURAL_EDGE.std,
            reason: "Structural edge std normalised to canonical value",
          });
        }
        if (prob !== CANONICAL_STRUCTURAL_EDGE.prob) {
          repairs.push({
            edge_id: edgeId,
            edge_from: from,
            edge_to: to,
            field: "exists_probability",
            action: prob === undefined ? "defaulted" : "normalised",
            from_value: prob ?? null,
            to_value: CANONICAL_STRUCTURAL_EDGE.prob,
            reason: "Structural edge exists_probability normalised to canonical value",
          });
        }
        // Track effect_direction repair if not already positive
        if (direction !== CANONICAL_STRUCTURAL_EDGE.direction) {
          repairs.push({
            edge_id: edgeId,
            edge_from: from,
            edge_to: to,
            field: "effect_direction",
            action: direction === undefined ? "defaulted" : "normalised",
            from_value: direction ?? null,
            to_value: CANONICAL_STRUCTURAL_EDGE.direction,
            reason: "Structural edge effect_direction normalised to canonical value",
          });
        }

        return {
          ...(edge as any),
          // V4 fields
          strength_mean: CANONICAL_STRUCTURAL_EDGE.mean,
          strength_std: CANONICAL_STRUCTURAL_EDGE.std,
          belief_exists: CANONICAL_STRUCTURAL_EDGE.prob,
          effect_direction: CANONICAL_STRUCTURAL_EDGE.direction,
          // Legacy fields for backwards compatibility
          weight: CANONICAL_STRUCTURAL_EDGE.mean,
          belief: CANONICAL_STRUCTURAL_EDGE.prob,
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
      repairs: [],  // T3: Empty array, not undefined
    };
  }

  return {
    graph: {
      ...(graph as any),
      edges: updatedEdges as any,
    } as GraphV1,
    fixedEdgeCount: fixedEdgeIds.length,
    fixedEdgeIds,
    repairs,  // T3: PLoT-compatible repair records
  };
}

// =============================================================================
// Quality Detection Functions (Phase 5: Pre-Analysis Validation)
// =============================================================================

/**
 * Result of strength clustering detection.
 */
export interface StrengthClusteringResult {
  detected: boolean;
  coefficientOfVariation: number;
  edgeCount: number;
  warning?: CEEStructuralWarningV1;
}

/**
 * Detect strength clustering: low coefficient of variation (CV < 0.3) in edge strengths.
 * CV = std(strengths) / mean(abs(strengths))
 * If mean(abs(strengths)) === 0, treat as clustered.
 * Excludes structural edges (decision→option, option→factor).
 */
export function detectStrengthClustering(
  graph: GraphV1 | undefined,
  threshold: number = 0.3
): StrengthClusteringResult {
  if (!graph || !Array.isArray((graph as any).edges) || !Array.isArray((graph as any).nodes)) {
    return { detected: false, coefficientOfVariation: 0, edgeCount: 0 };
  }

  const nodes = (graph as any).nodes as any[];
  const edges = (graph as any).edges as any[];

  // Build node kind map
  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) {
    const id = typeof node?.id === "string" ? node.id : undefined;
    const kind = typeof node?.kind === "string" ? node.kind : undefined;
    if (id && kind) nodeKindMap.set(id, kind);
  }

  // Collect causal edge strengths
  const strengths: number[] = [];
  const affectedEdgeIds: string[] = [];

  for (const edge of edges) {
    const from = edge?.from;
    const to = edge?.to;
    const fromKind = typeof from === "string" ? nodeKindMap.get(from) : undefined;
    const toKind = typeof to === "string" ? nodeKindMap.get(to) : undefined;

    // Skip structural edges
    if (fromKind && toKind) {
      const edgeType = `${fromKind}-${toKind}`;
      if (STRUCTURAL_EDGE_TYPES.has(edgeType)) continue;
    }

    const strength = edge?.strength_mean ?? edge?.weight ?? 0.5;
    if (typeof strength === "number" && Number.isFinite(strength)) {
      strengths.push(strength);
      const edgeId = edge?.id;
      if (typeof edgeId === "string") affectedEdgeIds.push(edgeId);
    }
  }

  if (strengths.length < 2) {
    return { detected: false, coefficientOfVariation: 0, edgeCount: strengths.length };
  }

  // Calculate mean of absolute values
  const absStrengths = strengths.map(Math.abs);
  const meanAbs = absStrengths.reduce((a, b) => a + b, 0) / absStrengths.length;

  // If mean is zero, treat as clustered
  if (meanAbs === 0) {
    return {
      detected: true,
      coefficientOfVariation: 0,
      edgeCount: strengths.length,
      warning: {
        id: "strength_clustering" as any,
        severity: "medium",
        node_ids: [],
        edge_ids: affectedEdgeIds.slice(0, 10),
        affected_node_ids: [],
        affected_edge_ids: affectedEdgeIds.slice(0, 10),
        explanation: "All edge strengths are zero — estimates may need review.",
        fix_hint: "Review edge strengths — low variance suggests estimates may be rough approximations",
      } as CEEStructuralWarningV1,
    };
  }

  // Calculate standard deviation
  const variance = strengths.reduce((sum, s) => sum + Math.pow(s - meanAbs, 2), 0) / strengths.length;
  const std = Math.sqrt(variance);
  const cv = std / meanAbs;

  const detected = cv < threshold;

  if (!detected) {
    return { detected: false, coefficientOfVariation: cv, edgeCount: strengths.length };
  }

  return {
    detected: true,
    coefficientOfVariation: cv,
    edgeCount: strengths.length,
    warning: {
      id: "strength_clustering" as any,
      severity: "medium",
      node_ids: [],
      edge_ids: affectedEdgeIds.slice(0, 10),
      affected_node_ids: [],
      affected_edge_ids: affectedEdgeIds.slice(0, 10),
      explanation: `Edge strength CV is ${cv.toFixed(2)} (threshold: ${threshold}) — strengths are clustered.`,
      fix_hint: "Review edge strengths — low variance suggests estimates may be rough approximations",
    } as CEEStructuralWarningV1,
  };
}

/**
 * Result of same lever options detection.
 */
export interface SameLeverOptionsResult {
  detected: boolean;
  maxOverlapPercentage: number;
  overlappingOptionPairs: Array<{ option1: string; option2: string; overlapPct: number }>;
  warning?: CEEStructuralWarningV1;
}

/**
 * Detect when options share >60% of intervention targets.
 */
export function detectSameLeverOptions(
  graph: GraphV1 | undefined,
  threshold: number = 0.6
): SameLeverOptionsResult {
  if (!graph || !Array.isArray((graph as any).nodes)) {
    return { detected: false, maxOverlapPercentage: 0, overlappingOptionPairs: [] };
  }

  const nodes = (graph as any).nodes as any[];

  // Get option nodes with interventions
  const optionInterventions = new Map<string, Set<string>>();
  for (const node of nodes) {
    if (node?.kind !== "option") continue;
    const optionId = node?.id;
    if (typeof optionId !== "string") continue;

    const rawInterventions = (node?.data as any)?.interventions;
    // Handle both array (V1/V2) and object (V3) formats
    const interventionValues = Array.isArray(rawInterventions)
      ? rawInterventions
      : rawInterventions && typeof rawInterventions === "object"
        ? Object.values(rawInterventions) as any[]
        : [];
    const targets = new Set<string>();
    for (const interv of interventionValues) {
      const targetId = interv?.target_match?.node_id ?? interv?.target;
      if (typeof targetId === "string") targets.add(targetId);
    }
    if (targets.size > 0) optionInterventions.set(optionId, targets);
  }

  const optionIds = Array.from(optionInterventions.keys());
  if (optionIds.length < 2) {
    return { detected: false, maxOverlapPercentage: 0, overlappingOptionPairs: [] };
  }

  const overlappingPairs: Array<{ option1: string; option2: string; overlapPct: number }> = [];
  let maxOverlap = 0;

  for (let i = 0; i < optionIds.length; i++) {
    for (let j = i + 1; j < optionIds.length; j++) {
      const targets1 = optionInterventions.get(optionIds[i])!;
      const targets2 = optionInterventions.get(optionIds[j])!;
      const intersection = new Set([...targets1].filter(t => targets2.has(t)));
      const union = new Set([...targets1, ...targets2]);
      const overlapPct = union.size > 0 ? intersection.size / union.size : 0;

      if (overlapPct > maxOverlap) maxOverlap = overlapPct;
      if (overlapPct > threshold) {
        overlappingPairs.push({ option1: optionIds[i], option2: optionIds[j], overlapPct });
      }
    }
  }

  const detected = overlappingPairs.length > 0;

  if (!detected) {
    return { detected: false, maxOverlapPercentage: maxOverlap, overlappingOptionPairs: [] };
  }

  const affectedOptionIds = [...new Set(overlappingPairs.flatMap(p => [p.option1, p.option2]))];

  return {
    detected: true,
    maxOverlapPercentage: maxOverlap,
    overlappingOptionPairs: overlappingPairs,
    warning: {
      id: "same_lever_options" as any,
      severity: "medium",
      node_ids: affectedOptionIds,
      edge_ids: [],
      affected_node_ids: affectedOptionIds,
      affected_edge_ids: [],
      explanation: `${overlappingPairs.length} option pair(s) share >${Math.round(threshold * 100)}% intervention targets.`,
      fix_hint: "Options share most intervention targets — consider differentiating approaches",
    } as CEEStructuralWarningV1,
  };
}

/**
 * Result of missing baseline detection.
 */
export interface MissingBaselineResult {
  detected: boolean;
  hasBaseline: boolean;
  warning?: CEEStructuralWarningV1;
}

/**
 * Detect when no status quo / baseline option exists.
 * Looks for options with labels containing "status quo", "do nothing", "no action", "baseline", "current".
 */
export function detectMissingBaseline(graph: GraphV1 | undefined): MissingBaselineResult {
  if (!graph || !Array.isArray((graph as any).nodes)) {
    return { detected: false, hasBaseline: false };
  }

  const nodes = (graph as any).nodes as any[];
  const baselinePatterns = [
    /status\s*quo/i,
    /do\s*nothing/i,
    /no\s*action/i,
    /baseline/i,
    /current\s*state/i,
    /as\s*is/i,
  ];

  let hasBaseline = false;
  for (const node of nodes) {
    if (node?.kind !== "option") continue;
    const label = node?.label ?? "";
    if (typeof label === "string" && baselinePatterns.some(p => p.test(label))) {
      hasBaseline = true;
      break;
    }
    // Also check option data for status_quo flag
    if ((node?.data as any)?.is_status_quo === true) {
      hasBaseline = true;
      break;
    }
  }

  const optionIds = nodes.filter(n => n?.kind === "option").map(n => n?.id).filter(Boolean);

  if (hasBaseline || optionIds.length === 0) {
    return { detected: false, hasBaseline };
  }

  return {
    detected: true,
    hasBaseline: false,
    warning: {
      id: "missing_baseline" as any,
      severity: "low",
      node_ids: optionIds,
      edge_ids: [],
      affected_node_ids: optionIds,
      affected_edge_ids: [],
      explanation: "No status quo / baseline option detected.",
      fix_hint: "Add a status quo option to enable comparison with no action",
    } as CEEStructuralWarningV1,
  };
}

/**
 * Result of goal baseline value detection.
 */
export interface GoalNoBaselineValueResult {
  detected: boolean;
  goalHasValue: boolean;
  goalNodeId?: string;
  warning?: CEEStructuralWarningV1;
}

/**
 * Detect when goal node has no observed_state.value.
 */
export function detectGoalNoBaselineValue(graph: GraphV1 | undefined): GoalNoBaselineValueResult {
  if (!graph || !Array.isArray((graph as any).nodes)) {
    return { detected: false, goalHasValue: false };
  }

  const nodes = (graph as any).nodes as any[];
  const goalNodeId = (graph as any)?.goal_node_id;

  let goalNode: any = null;
  for (const node of nodes) {
    if (node?.kind === "goal" || node?.id === goalNodeId) {
      goalNode = node;
      break;
    }
  }

  if (!goalNode) {
    return { detected: false, goalHasValue: false };
  }

  const observedValue = goalNode?.observed_state?.value ?? goalNode?.data?.observed_value ?? goalNode?.data?.value;
  const hasValue = observedValue !== undefined && observedValue !== null;

  if (hasValue) {
    return { detected: false, goalHasValue: true, goalNodeId: goalNode.id };
  }

  return {
    detected: true,
    goalHasValue: false,
    goalNodeId: goalNode.id,
    warning: {
      id: "goal_no_baseline_value" as any,
      severity: "low",
      node_ids: [goalNode.id],
      edge_ids: [],
      affected_node_ids: [goalNode.id],
      affected_edge_ids: [],
      explanation: "Goal node has no observed_state.value set.",
      fix_hint: "Set goal node's observed_state.value to establish baseline for comparison",
    } as CEEStructuralWarningV1,
  };
}

/**
 * Result of goal connectivity check.
 */
export interface GoalConnectivityResult {
  status: "full" | "partial" | "none";
  disconnectedOptions: string[];
  weakPaths: Array<{ option_id: string; path_strength: number; hop_count: number }>;
  warning?: CEEStructuralWarningV1;
}

/**
 * Check goal connectivity for all options.
 * Returns status: full (all connected), partial (some connected), none (no connections).
 */
export function checkGoalConnectivity(graph: GraphV1 | undefined): GoalConnectivityResult {
  if (!graph || !Array.isArray((graph as any).nodes) || !Array.isArray((graph as any).edges)) {
    return { status: "none", disconnectedOptions: [], weakPaths: [] };
  }

  const nodes = (graph as any).nodes as any[];
  const edges = (graph as any).edges as any[];
  const goalNodeId = (graph as any)?.goal_node_id;

  // Find goal node
  let goalId: string | undefined;
  for (const node of nodes) {
    if (node?.kind === "goal" || node?.id === goalNodeId) {
      goalId = node?.id;
      break;
    }
  }

  if (!goalId) {
    const optionIds = nodes.filter(n => n?.kind === "option").map(n => n?.id).filter(Boolean);
    // Sort for deterministic ordering
    const sortedOptionIds = [...optionIds].sort() as string[];
    return {
      status: "none",
      disconnectedOptions: sortedOptionIds,
      weakPaths: [],
      warning: {
        id: "goal_connectivity_none",
        severity: "blocker",
        node_ids: sortedOptionIds,
        edge_ids: [],
        affected_node_ids: sortedOptionIds,
        affected_edge_ids: [],
        explanation: "No goal node found in graph.",
        fix_hint: "Connect each option to the goal via at least one factor or edge",
      },
    };
  }

  // Build adjacency list
  const adjacency = new Map<string, Array<{ to: string; strength: number }>>();
  for (const edge of edges) {
    const from = edge?.from;
    const to = edge?.to;
    if (typeof from !== "string" || typeof to !== "string") continue;
    const strength = Math.abs(edge?.strength_mean ?? edge?.weight ?? 0.5);
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push({ to, strength });
  }

  // Get option IDs
  const optionIds = nodes.filter(n => n?.kind === "option").map(n => n?.id).filter(Boolean) as string[];

  // BFS to find path from each option to goal
  const disconnectedOptions: string[] = [];
  const weakPaths: Array<{ option_id: string; path_strength: number; hop_count: number }> = [];

  for (const optionId of optionIds) {
    const visited = new Set<string>();
    const queue: Array<{ node: string; strength: number; hops: number }> = [{ node: optionId, strength: 1, hops: 0 }];
    let foundPath = false;
    let bestPath: { strength: number; hops: number } | null = null;

    while (queue.length > 0) {
      const { node, strength, hops } = queue.shift()!;
      if (node === goalId) {
        foundPath = true;
        if (!bestPath || strength > bestPath.strength) {
          bestPath = { strength, hops };
        }
        continue;
      }
      if (visited.has(node)) continue;
      visited.add(node);

      const neighbors = adjacency.get(node) ?? [];
      for (const { to, strength: edgeStrength } of neighbors) {
        queue.push({ node: to, strength: strength * edgeStrength, hops: hops + 1 });
      }
    }

    if (!foundPath) {
      disconnectedOptions.push(optionId);
    } else if (bestPath && bestPath.strength < 0.1) {
      weakPaths.push({ option_id: optionId, path_strength: bestPath.strength, hop_count: bestPath.hops });
    }
  }

  const status: "full" | "partial" | "none" =
    disconnectedOptions.length === 0 ? "full" :
    disconnectedOptions.length === optionIds.length ? "none" : "partial";

  // Sort disconnected options for deterministic ordering
  const sortedDisconnectedOptions = [...disconnectedOptions].sort();

  const warning: CEEStructuralWarningV1 | undefined = status === "none" ? {
    id: "goal_connectivity_none",
    severity: "blocker",
    node_ids: sortedDisconnectedOptions,
    edge_ids: [],
    // Deterministic order: goal first, then sorted option IDs
    affected_node_ids: [goalId, ...sortedDisconnectedOptions],
    affected_edge_ids: [],
    explanation: `No options have a path to the goal node.`,
    fix_hint: "Connect each option to the goal via at least one factor or edge",
  } : undefined;

  return { status, disconnectedOptions: sortedDisconnectedOptions, weakPaths, warning };
}

/**
 * Compute model quality factors for a graph.
 */
export interface ModelQualityFactorsResult {
  estimate_confidence: number;
  strength_variation: number;
  range_confidence_coverage: number;
  has_baseline_option: boolean;
}

/**
 * Compute model quality factors for the draft graph.
 */
export function computeModelQualityFactors(graph: GraphV1 | undefined): ModelQualityFactorsResult {
  const defaultResult: ModelQualityFactorsResult = {
    estimate_confidence: 0.5,
    strength_variation: 0,
    range_confidence_coverage: 0,
    has_baseline_option: false,
  };

  if (!graph || !Array.isArray((graph as any).nodes) || !Array.isArray((graph as any).edges)) {
    return defaultResult;
  }

  const nodes = (graph as any).nodes as any[];
  const edges = (graph as any).edges as any[];

  // Compute strength variation (CV)
  const strengths = edges
    .map(e => e?.strength_mean ?? e?.weight ?? 0.5)
    .filter(s => typeof s === "number" && Number.isFinite(s));

  let strengthVariation = 0;
  if (strengths.length > 1) {
    const mean = strengths.reduce((a, b) => a + b, 0) / strengths.length;
    const variance = strengths.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / strengths.length;
    const std = Math.sqrt(variance);
    strengthVariation = mean !== 0 ? std / Math.abs(mean) : 0;
  }

  // Check for baseline option
  const baselinePatterns = [/status\s*quo/i, /do\s*nothing/i, /no\s*action/i, /baseline/i, /current/i, /as\s*is/i];
  const hasBaselineOption = nodes.some(n => {
    if (n?.kind !== "option") return false;
    const label = n?.label ?? "";
    if (baselinePatterns.some(p => p.test(label))) return true;
    if ((n?.data as any)?.is_status_quo === true) return true;
    return false;
  });

  // Compute range confidence coverage (% of interventions with Priority 1-2 ranges)
  // Per spec: only count 'explicit' or 'extracted' sources, NOT 'inferred*' or 'default'
  const HIGH_CONFIDENCE_SOURCES = new Set(["explicit", "extracted", "brief", "context"]);

  let totalInterventions = 0;
  let interventionsWithHighConfidenceRanges = 0;

  for (const node of nodes) {
    if (node?.kind !== "option") continue;
    const rawInterventions = (node?.data as any)?.interventions;
    // Handle both array (V1/V2) and object (V3) formats
    const interventionValues = Array.isArray(rawInterventions)
      ? rawInterventions
      : rawInterventions && typeof rawInterventions === "object"
        ? Object.values(rawInterventions) as any[]
        : [];
    for (const interv of interventionValues) {
      totalInterventions++;
      // Check if intervention has a range with high-confidence source
      const hasRange = interv?.range?.min !== undefined && interv?.range?.max !== undefined;
      const hasExtractedRange = interv?.extracted_range?.min !== undefined && interv?.extracted_range?.max !== undefined;

      if (hasRange || hasExtractedRange) {
        // Check source - exclude inferred/default sources
        const rangeSource = interv?.range_source ?? interv?.extracted_range?.source ?? "default";
        const isHighConfidence = HIGH_CONFIDENCE_SOURCES.has(rangeSource) ||
          // Also accept sources that don't start with 'inferred' or 'default'
          (typeof rangeSource === "string" &&
           !rangeSource.startsWith("inferred") &&
           rangeSource !== "default");

        if (isHighConfidence) {
          interventionsWithHighConfidenceRanges++;
        }
      }
    }
  }

  const rangeConfidenceCoverage = totalInterventions > 0 ? interventionsWithHighConfidenceRanges / totalInterventions : 0;

  // Estimate overall confidence based on factors
  const confidenceFactors = [
    strengthVariation > 0.3 ? 0.8 : 0.5, // Higher variation = more confidence
    hasBaselineOption ? 0.9 : 0.6,
    rangeConfidenceCoverage > 0.5 ? 0.8 : 0.5,
  ];
  const estimateConfidence = confidenceFactors.reduce((a, b) => a + b, 0) / confidenceFactors.length;

  return {
    estimate_confidence: Math.round(estimateConfidence * 100) / 100,
    strength_variation: Math.round(strengthVariation * 1000) / 1000,
    range_confidence_coverage: Math.round(rangeConfidenceCoverage * 100) / 100,
    has_baseline_option: hasBaselineOption,
  };
}

// Re-export goal inference utilities
export {
  inferGoalFromBrief,
  ensureGoalNode,
  hasGoalNode,
  createGoalNode,
  wireOutcomesToGoal,
  DEFAULT_GOAL_LABEL,
  type GoalInferenceResult,
} from "./goal-inference.js";
