/**
 * ⭐ THE ONE TARGET READER (RT-10 B′ R3, Science #87 5999608477; DL e8).
 *
 * The goal's stated target is its own raw threshold, else the goal's OWN non-deadline limit row, WITH that row's
 * operator. Served (red team #87 5999041843): the user set "at most 400" through the goal panel, which writes ONLY the
 * `<=` goal_constraints row (add-constraint never stamps `goal_threshold_raw` for `<=`: that channel is ISL's ≥
 * probability, so stamping it would compute P(goal ≥ 400)). Target-testability already read the row, but the receipt,
 * the context-pack record and the chat's one question read only the node's fields, so the Model row said "Not set" and
 * the chat asked "What is the most that … can be?" for the target the user had just given.
 *
 * Leaf module (one import, itself import-free) so every reader — target-testability, the receipt guard, the decision-input
 * ask — reads the same answer without an import cycle.
 */
import { statedOperatorOf } from '../agent-lane/limit-operator-words.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface StatedGoalTarget {
  readonly value: number;
  readonly unit?: string;
  /** `level` / `change_rel` / … as the carrier holds it. */
  readonly frame?: string;
  /**
   * The held comparator: the node's `goal_direction` for a raw threshold; for a limit row, the comparator the row STATES
   * (`statedOperatorOf`: "below 400" is stored `<=` + `operator_as_stated: '<'` and read `<`, Codex r1 #2606).
   */
  readonly held?: string;
}

/**
 * The goal's own limit row: the target when the node carries no raw threshold. A DEADLINE on the goal ("within 18
 * months") is a time limit, not the target: skipped, detected by `deadline_metadata` PRESENCE (`compound-goals.ts`).
 */
export function goalOwnLimitRow(graph: Rec, goal: Rec): Rec | undefined {
  return goalOwnLimitRows(graph, goal)[0];
}

/** Every one of the goal's own non-deadline limit rows, in stored order. */
function goalOwnLimitRows(graph: Rec, goal: Rec): Rec[] {
  const rows = Array.isArray(graph.goal_constraints) ? graph.goal_constraints.filter(isRec) : [];
  return rows.filter((c) => c.node_id === goal.id && finite(c.value) && !isRec(c.deadline_metadata));
}

/**
 * The goal's own limit row that IS its target: the own row when the node holds no raw figure, or the own row stating
 * the SAME figure as the raw one (the goal panel writes the pair). A row stating another figure beside a raw target is a
 * separate limit, never the target (Codex r1 #2606: raw £1.2m beside its own "<= £1.4m" read as "<= £1.2m").
 */
export function goalTargetRow(graph: Rec, goal: Rec): Rec | undefined {
  if (!finite(goal.goal_threshold_raw)) return goalOwnLimitRow(graph, goal);
  // Beside a raw target: the own row stating THAT figure, wherever it is stored (Codex r2 #2606: order-independent).
  const raw = goal.goal_threshold_raw;
  return goalOwnLimitRows(graph, goal).find((r) => r.value === raw);
}

const rowComparator = (row: Rec | undefined): string | undefined => {
  if (row === undefined) return undefined;
  const c = statedOperatorOf(row) ?? row.operator;
  return typeof c === 'string' ? c : undefined;
};

/** The goal's stated target, or null when the goal states none. */
export function statedGoalTargetOf(graph: Rec, goal: Rec): StatedGoalTarget | null {
  if (finite(goal.goal_threshold_raw)) {
    // The comparator the node HOLDS, else the one its target row states (the pair: "at least £1.2m" is raw + `>=` row).
    const held = typeof goal.goal_direction === 'string' ? goal.goal_direction : rowComparator(goalTargetRow(graph, goal));
    return {
      value: goal.goal_threshold_raw,
      ...(typeof goal.goal_threshold_unit === 'string' ? { unit: goal.goal_threshold_unit } : {}),
      ...(typeof goal.goal_threshold_frame === 'string' ? { frame: goal.goal_threshold_frame } : {}),
      ...(held !== undefined ? { held } : {}),
    };
  }
  const row = goalOwnLimitRow(graph, goal);
  if (row === undefined) return null;
  return {
    value: row.value as number,
    ...(typeof row.unit === 'string' ? { unit: row.unit } : {}),
    ...(typeof row.value_frame === 'string' ? { frame: row.value_frame } : {}),
    ...(rowComparator(row) !== undefined ? { held: rowComparator(row)! } : {}),
  };
}
