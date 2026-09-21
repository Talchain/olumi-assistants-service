/**
 * Minimum structure validation.
 *
 * Extracted from pipeline.ts for reuse in the unified pipeline.
 * Checks that a graph has the minimum required node kinds and connectivity.
 */

import type { GraphV1 } from "../../contracts/plot/engine.js";

// Minimum structure requirements for draft graphs.
// A usable decision model must include at least one goal, one decision, and one option.
export const MINIMUM_STRUCTURE_REQUIREMENT: Readonly<Record<string, number>> = {
  goal: 1,
  decision: 1,
  option: 1,
};

export type ConnectivityDiagnostic = {
  passed: boolean;
  decision_ids: string[];
  reachable_options: string[];
  reachable_goals: string[];
  unreachable_nodes: string[];
  all_option_ids: string[];
  all_goal_ids: string[];
};

export type MinimumStructureResult = {
  valid: boolean;
  missing: string[];
  counts: Record<string, number>;
  connectivity?: ConnectivityDiagnostic;
  connectivity_failed?: boolean;
  outcome_or_risk_missing?: boolean;
};

/**
 * Check if graph has connected minimum structure with diagnostic info.
 * Returns both pass/fail and detailed diagnostics for observability.
 */
export function checkConnectedMinimumStructure(graph: GraphV1 | undefined): ConnectivityDiagnostic {
  const emptyDiagnostic: ConnectivityDiagnostic = {
    passed: false,
    decision_ids: [],
    reachable_options: [],
    reachable_goals: [],
    unreachable_nodes: [],
    all_option_ids: [],
    all_goal_ids: [],
  };

  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray((graph as any).edges)) {
    return emptyDiagnostic;
  }

  const nodes = graph.nodes;
  const edges = (graph as any).edges as Array<{ from?: string; to?: string }>;

  const kinds = new Map<string, string>();
  const decisions: string[] = [];
  const options: string[] = [];
  const goals: string[] = [];
  const adjacency = new Map<string, Set<string>>();
  const allNodeIds: string[] = [];

  for (const node of nodes) {
    const id = typeof (node as any).id === "string" ? ((node as any).id as string) : undefined;
    const kind = node.kind as unknown as string | undefined;
    if (!id || !kind) {
      continue;
    }

    kinds.set(id, kind);
    allNodeIds.push(id);
    if (!adjacency.has(id)) {
      adjacency.set(id, new Set());
    }
    if (kind === "decision") {
      decisions.push(id);
    } else if (kind === "option") {
      options.push(id);
    } else if (kind === "goal") {
      goals.push(id);
    }
  }

  for (const edge of edges) {
    const from = typeof edge.from === "string" ? (edge.from as string) : undefined;
    const to = typeof edge.to === "string" ? (edge.to as string) : undefined;
    if (!from || !to) {
      continue;
    }

    if (!adjacency.has(from)) {
      adjacency.set(from, new Set());
    }
    if (!adjacency.has(to)) {
      adjacency.set(to, new Set());
    }

    adjacency.get(from)!.add(to);
    adjacency.get(to)!.add(from);
  }

  if (decisions.length === 0) {
    return {
      ...emptyDiagnostic,
      all_option_ids: options,
      all_goal_ids: goals,
      unreachable_nodes: [...options, ...goals],
    };
  }

  // Track all reachable nodes from any decision
  const allReachable = new Set<string>();
  let foundValidPath = false;

  for (const decisionId of decisions) {
    const visited = new Set<string>();
    const queue: string[] = [decisionId];
    let hasGoal = false;
    let hasOption = false;

    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      allReachable.add(current);

      const kind = kinds.get(current);
      if (kind === "goal") {
        hasGoal = true;
      } else if (kind === "option") {
        hasOption = true;
      }

      if (hasGoal && hasOption) {
        foundValidPath = true;
      }

      const neighbours = adjacency.get(current);
      if (!neighbours) {
        continue;
      }

      for (const next of neighbours) {
        if (!visited.has(next)) {
          queue.push(next);
        }
      }
    }
  }

  // Compute reachable options and goals
  const reachableOptions = options.filter(id => allReachable.has(id));
  const reachableGoals = goals.filter(id => allReachable.has(id));

  // Compute unreachable nodes (options and goals not reachable from any decision)
  const unreachableNodes = allNodeIds.filter(id => {
    const kind = kinds.get(id);
    return (kind === "option" || kind === "goal") && !allReachable.has(id);
  });

  return {
    passed: foundValidPath,
    decision_ids: decisions,
    reachable_options: reachableOptions,
    reachable_goals: reachableGoals,
    unreachable_nodes: unreachableNodes,
    all_option_ids: options,
    all_goal_ids: goals,
  };
}

export function validateMinimumStructure(graph: GraphV1 | undefined): MinimumStructureResult {
  const counts: Record<string, number> = {};

  if (graph?.nodes) {
    for (const node of graph.nodes) {
      const kind = node.kind as unknown as string | undefined;
      if (typeof kind === "string" && kind.length > 0) {
        counts[kind] = (counts[kind] ?? 0) + 1;
      }
    }
  }

  const missing: string[] = [];
  for (const [kind, min] of Object.entries(MINIMUM_STRUCTURE_REQUIREMENT)) {
    if ((counts[kind] ?? 0) < min) {
      missing.push(kind);
    }
  }

  const hasMinimumCounts = missing.length === 0;

  // Only check connectivity if kind counts pass
  if (!hasMinimumCounts) {
    return {
      valid: false,
      missing,
      counts,
    };
  }

  // Check outcome OR risk requirement (at least one must exist)
  // This check happens BEFORE connectivity to give a clearer error message.
  // Outcomes and risks are the bridges between factors and goal in the topology.
  const outcomeCount = counts["outcome"] ?? 0;
  const riskCount = counts["risk"] ?? 0;
  if (outcomeCount + riskCount === 0) {
    return {
      valid: false,
      missing: [], // All required kinds are present, but outcome/risk bridge is missing
      counts,
      outcome_or_risk_missing: true,
    };
  }

  // Get full connectivity diagnostic
  const connectivity = checkConnectedMinimumStructure(graph);
  const connectivityFailed = !connectivity.passed;

  return {
    valid: connectivity.passed,
    missing,
    counts,
    connectivity,
    connectivity_failed: connectivityFailed,
  };
}
