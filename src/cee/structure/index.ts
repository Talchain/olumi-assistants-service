import type { components } from "../../generated/openapi.d.ts";
import type { GraphV1 } from "../../contracts/plot/engine.js";

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
