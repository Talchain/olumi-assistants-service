/**
 * Holistic whole-graph scorer — deterministic layer (always runs, no keys).
 *
 * This is the working guard against arm C scoring well merely because its
 * output decomposes more cleanly into elements: these metrics see the graph
 * ONLY as a whole. Consumes the BLIND payload — no arm identity can reach it.
 *
 * Score ∈ [0,1] = mean of six components:
 *  - connectivity: fraction of nodes reachable from any goal/decision node
 *    treating edges as undirected (a graph in disconnected pieces is not one
 *    causal story);
 *  - no_orphans: 1 − orphan-node rate;
 *  - referential_integrity: 1 if no dangling edge endpoints/goal ref, else
 *    proportional penalty;
 *  - no_duplicates: 1 − duplicate-normalized-label rate;
 *  - option_coverage: options exist (2–6 sane) and each option node has ≥1
 *    outgoing edge into the causal graph;
 *  - parsimony: node count inside a sane band for a decision brief (4–24);
 *    graphs outside the band decay smoothly (bloat and emptiness both cost).
 */
import type { BlindCandidate, HolisticDeterministicScore } from "../../types.ts";
import { normalizeText } from "../decompose.ts";

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export function scoreHolisticDeterministic(blind: BlindCandidate): HolisticDeterministicScore {
  const { nodes, edges, options, goal_node_id } = blind.graph;
  const notes: string[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  if (nodes.length === 0) {
    return {
      score: 0,
      components: {
        connectivity: 0,
        no_orphans: 0,
        referential_integrity: 0,
        no_duplicates: 0,
        option_coverage: 0,
        parsimony: 0,
      },
      notes: ["empty graph"],
    };
  }

  // connectivity from goal/decision anchors (undirected reachability)
  const adjacency = new Map<string, Set<string>>();
  for (const id of nodeIds) adjacency.set(id, new Set());
  let danglingEdges = 0;
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      danglingEdges++;
      continue;
    }
    adjacency.get(edge.from)!.add(edge.to);
    adjacency.get(edge.to)!.add(edge.from);
  }
  const anchors = nodes.filter((n) => n.kind === "goal" || n.kind === "decision").map((n) => n.id);
  const reached = new Set<string>(anchors);
  const queue = [...anchors];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  const connectivity = anchors.length === 0 ? 0 : clamp01(reached.size / nodes.length);
  if (anchors.length === 0) notes.push("no goal/decision anchor node");

  // orphans: degree-0 nodes
  const orphanCount = nodes.filter((n) => (adjacency.get(n.id) ?? new Set()).size === 0).length;
  const noOrphans = clamp01(1 - orphanCount / nodes.length);
  if (orphanCount > 0) notes.push(`${orphanCount} orphan node(s)`);

  // referential integrity: dangling edges + goal reference
  const goalNode = nodes.find((n) => n.id === goal_node_id);
  const goalOk = goalNode !== undefined && goalNode.kind === "goal";
  const integrityPenalty = (edges.length > 0 ? danglingEdges / edges.length : 0) + (goalOk ? 0 : 0.5);
  const referentialIntegrity = clamp01(1 - integrityPenalty);
  if (danglingEdges > 0) notes.push(`${danglingEdges} dangling edge(s)`);
  if (!goalOk) notes.push("goal_node_id does not reference a goal node");

  // duplicates by normalized label
  const labelCounts = new Map<string, number>();
  for (const node of nodes) {
    const key = normalizeText(node.label);
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }
  const duplicateNodes = [...labelCounts.values()].reduce((sum, c) => sum + (c > 1 ? c - 1 : 0), 0);
  const noDuplicates = clamp01(1 - duplicateNodes / nodes.length);
  if (duplicateNodes > 0) notes.push(`${duplicateNodes} duplicate-label node(s)`);

  // option coverage
  let optionCoverage = 0;
  if (options.length >= 2) {
    const optionNodeIds = nodes.filter((n) => n.kind === "option").map((n) => n.id);
    const optionsWired =
      optionNodeIds.length === 0
        ? 0
        : optionNodeIds.filter((id) => edges.some((e) => e.from === id && nodeIds.has(e.to))).length /
          optionNodeIds.length;
    const countSanity = options.length <= 6 ? 1 : clamp01(1 - (options.length - 6) / 6);
    optionCoverage = clamp01(0.5 * optionsWired + 0.5 * countSanity);
    if (optionNodeIds.length === 0) notes.push("options[] present but no option nodes in graph");
  } else {
    notes.push(`only ${options.length} option(s) — a decision needs alternatives`);
  }

  // parsimony band: 4–24 nodes comfortable; smooth decay outside
  const n = nodes.length;
  let parsimony: number;
  if (n < 4) parsimony = clamp01(n / 4);
  else if (n <= 24) parsimony = 1;
  else parsimony = clamp01(1 - (n - 24) / 24);
  if (n > 24) notes.push(`graph is large (${n} nodes) — parsimony penalty`);

  const components = {
    connectivity,
    no_orphans: noOrphans,
    referential_integrity: referentialIntegrity,
    no_duplicates: noDuplicates,
    option_coverage: optionCoverage,
    parsimony,
  };
  const score =
    Object.values(components).reduce((sum, v) => sum + v, 0) / Object.keys(components).length;

  return { score: Math.round(score * 1e6) / 1e6, components, notes };
}
