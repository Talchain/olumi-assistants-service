import { canReachAnyGoal, type ReachabilityEdge } from "../graph/reachability.js";
import { isDecisionFreeGraph } from "./decision-free-shape.js";

interface RetentionNode {
  readonly id: string;
  readonly kind: string;
  readonly data?: unknown;
  readonly observed_state?: unknown;
  readonly prior?: unknown;
  readonly value?: unknown;
  readonly raw_value?: unknown;
}

interface RetentionGraph {
  readonly nodes: readonly RetentionNode[];
  readonly edges: readonly ReachabilityEdge[];
}

function hasLevel(record: unknown): boolean {
  if (record === null || typeof record !== "object") return false;
  return ("value" in record && record.value !== undefined)
    || ("raw_value" in record && record.raw_value !== undefined);
}

/**
 * Numberless factors may remain unresolved reasoning in the existing
 * decision-free shape. This is retention eligibility, never run admission.
 *
 * The first slice requires one existing goal and an already connected
 * outcome/risk spine whose terminals already reach the goal. Quantities (including
 * real 0 and 0.5), distributions, constraints and action graphs keep their
 * existing rules. No role or origin is inferred from labels or provenance.
 */
export function retainedDecisionFreeFactorIds(graph: RetentionGraph): Set<string> {
  const retained = new Set<string>();
  if (!isDecisionFreeGraph(graph)) return retained;

  const goals = graph.nodes.filter((node) => node.kind === "goal");
  const terminals = graph.nodes.filter((node) => node.kind === "outcome" || node.kind === "risk");
  if (goals.length !== 1 || terminals.length === 0) return retained;

  const goalIds = new Set(goals.map((node) => node.id));
  if (terminals.some((node) => !canReachAnyGoal(node.id, graph.edges, goalIds))) return retained;

  for (const node of graph.nodes) {
    if (node.kind !== "factor") continue;
    // Connected factors already survive normally and remain valid existing
    // feeders. Only the unresolved population needs the shared exception.
    if (canReachAnyGoal(node.id, graph.edges, goalIds)) continue;
    if (hasLevel(node) || hasLevel(node.data) || hasLevel(node.observed_state)) continue;
    if (node.prior !== undefined && node.prior !== null) continue;
    retained.add(node.id);
  }
  return retained;
}
