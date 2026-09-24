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

import { isRepairAuthoredOptionFactorEdge } from '../../graph/repair-authored-edge.js';

export interface GraphNodeLike {
  readonly id: string;
  readonly kind?: string;
  readonly label?: string;
  readonly observed_state?: { value?: unknown } | undefined;
  /** What an OPTION sets, keyed by factor id. An option with none does nothing. */
  readonly interventions?: Record<string, unknown> | undefined;
  readonly changes?: unknown;
}
export interface GraphEdgeLike {
  readonly from: string;
  readonly to: string;
  /** Read only to recognise a repair-authored edge (`isRepairAuthoredOptionFactorEdge`). */
  readonly origin?: unknown;
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
  /**
   * ⭐ OPTIONS THAT SET NOTHING — the blocker that survives every value being
   * filled in.
   *
   * Measured live on 22 Sep at served 877ae800: after adopting eight
   * assumptions the model had 0 value-less factors and the analysis was STILL
   * refused, because one of three options carried `interventions: null`. An
   * option that changes no factor cannot be compared with one that does, so a
   * single inert option blocks the whole comparison — and nothing the user
   * could see said so until they asked for the analysis and waited.
   *
   * Reported here so the Agent raises it from `get_canonical_state`, at the
   * moment the model is described, rather than at the end of the journey.
   */
  readonly options_that_change_nothing: readonly string[];
  /**
   * ⭐ A HELD STATUS QUO — carrying on as now, each factor at its starting value
   * (Paul's ruling; admission, MG #1838). An option that sets nothing, whose
   * option→factor edges (at least one) are ALL repair-authored. It is complete with
   * no level, so it is NOT in `options_that_change_nothing` and is never asked for one.
   */
  readonly status_quo_held: readonly string[];
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
  const kinds = new Map(nodes.flatMap((n) => (typeof n.kind === 'string' ? [[n.id, n.kind] as const] : [])));
  const isHeld = (optionId: string): boolean => {
    const out = edges.filter((e) => e.from === optionId && kinds.get(e.to) === 'factor');
    return out.length > 0 && out.every((e) => isRepairAuthoredOptionFactorEdge(e, kinds));
  };
  const setsNothing = nodes
    .filter((n) => n.kind === 'option')
    .filter((n) => {
      const iv = n.interventions;
      const hasInterventions = iv !== null && iv !== undefined && Object.keys(iv).length > 0;
      const hasChanges = Array.isArray(n.changes) && n.changes.length > 0;
      return !hasInterventions && !hasChanges;
    });

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
    options_that_change_nothing: setsNothing.filter((n) => !isHeld(n.id)).map((n) => labelOf(n.id)),
    status_quo_held: setsNothing.filter((n) => isHeld(n.id)).map((n) => labelOf(n.id)),
    goal_label: goal?.label ?? null,
  };
}
