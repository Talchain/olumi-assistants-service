/**
 * Structural facts about the persisted model — derived, never invented.
 *
 * ⭐ WHY THIS EXISTS. In a head-to-head on the same 29-node model, current CEE
 * gave better answers than the Agent lane on two of three questions, and the
 * reason was not reasoning quality: CEE could say "every option reaches the
 * goal", "twelve factors still lack values", "one factor is not connected to
 * anything", and the Agent could not, because nothing ever told it. It had the
 * entity list and the edge list and was left to infer topology from them.
 *
 * Every field here is computed from the persisted graph by traversal. Nothing
 * is estimated and nothing is asked of a model, so these are facts the Agent
 * may repeat to the user as facts.
 */

export interface GraphNodeLike {
  readonly id: string;
  readonly kind?: string;
  readonly label?: string;
  readonly observed_state?: { value?: unknown } | undefined;
}
export interface GraphEdgeLike {
  readonly from: string;
  readonly to: string;
}

export interface StructuralFacts {
  /** Option labels with a directed path to the goal. */
  readonly options_reaching_goal: readonly string[];
  /** Option labels with none — they cannot appear in any comparison. */
  readonly options_not_reaching_goal: readonly string[];
  /** Labels of entities with no edge at all, in either direction. */
  readonly entities_with_no_connections: readonly string[];
  /** Entities that are connected but from which the goal is unreachable. */
  readonly entities_that_cannot_reach_goal: readonly string[];
  /**
   * How many VALUE-BEARING entities carry no stored value. Unknown is not zero.
   *
   * ⛔ COUNT ONLY WHAT COULD HOLD A VALUE. This counted every node, so on a
   * 29-node model it reported "28 entities have no value" — and the Agent said
   * exactly that to the user. Technically true and materially misleading: a
   * goal, an option, a risk and an outcome do not carry an observed value, so
   * 26 of those 28 were never gaps at all. Current CEE says "twelve factors
   * still lack values" on the same model, and that is the number a user can
   * act on.
   */
  readonly factors_without_a_value: number;
  readonly goal_label: string | null;
}

/** Directed reachability. Iterative: a deep model must not blow the stack. */
function reachable(adjacency: Map<string, string[]>, from: string): Set<string> {
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const next of adjacency.get(node) ?? []) {
      if (!seen.has(next)) { seen.add(next); stack.push(next); }
    }
  }
  return seen;
}

export function structuralFacts(
  nodes: readonly GraphNodeLike[],
  edges: readonly GraphEdgeLike[],
): StructuralFacts {
  const adjacency = new Map<string, string[]>();
  const touched = new Set<string>();
  for (const e of edges) {
    adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);
    touched.add(e.from);
    touched.add(e.to);
  }
  const labelOf = (id: string): string => nodes.find((n) => n.id === id)?.label ?? id;
  const goal = nodes.find((n) => n.kind === 'goal') ?? null;

  const reaching: string[] = [];
  const notReaching: string[] = [];
  const strandedNonOptions: string[] = [];
  if (goal !== null) {
    for (const n of nodes) {
      if (n.id === goal.id) continue;
      const hit = reachable(adjacency, n.id).has(goal.id);
      if (n.kind === 'option') (hit ? reaching : notReaching).push(labelOf(n.id));
      else if (!hit && touched.has(n.id)) strandedNonOptions.push(labelOf(n.id));
    }
  }

  return {
    options_reaching_goal: reaching,
    options_not_reaching_goal: notReaching,
    entities_with_no_connections: nodes.filter((n) => !touched.has(n.id)).map((n) => labelOf(n.id)),
    entities_that_cannot_reach_goal: strandedNonOptions,
    factors_without_a_value: nodes.filter(
      (n) => n.kind === 'factor' && typeof n.observed_state?.value !== 'number',
    ).length,
    goal_label: goal?.label ?? null,
  };
}
