/**
 * ⭐ IS THE GOAL'S TARGET TESTABLE, BEFORE ANY RUN (DECISION-REPRESENTATION-v1 row 4; PTL A #77 5912737934).
 *
 * Paul's test (4276f3f9, 30 Sep): "at least £1.2m within 2 months" was stored, readiness said `may_run: true`, and three
 * Runs then answered with no chance, no leader and "no goal direction was recorded". His goal had no today's level and
 * sat on a scale derived from the target itself (`goal_threshold_cap_provenance: target_derived_headroom`), so no Run
 * could test it. The engine already emits the matching refusals after a Run (R3 #77 5912916965 P1–P6). This verdict
 * computes them BEFORE the Run, over the admitted graph, with no model call.
 *
 * It fails toward saying less:
 * - `not_testable` is said only on a precondition this module actually checks;
 * - it never answers "testable" while any precondition is unchecked (`unchecked` names them).
 * P5, a quantified path from an option into the goal's own unit, is MODEL GENERATION's `sizeLink` question and is not
 * checked here yet. Words: AIQ #77 5912882031. Pure and total.
 */
import { readHeldGoalComparator } from '../goal-target/goal-direction.js';
import { sameUnit } from '../agent-lane/reconciling-product.js';
import { sayFigure } from '../agent-lane/say-figure.js';

/** R3's preconditions (#77 5912916965). */
export type TargetPrecondition = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6';
/** AIQ's cases (#77 5912882031): (a) no today's level · (b) an unscorable comparator · (c) no quantified path · (d) a target-derived scale. */
export type TargetCase = 'a' | 'b' | 'c' | 'd';

export interface TargetTestabilityFailure {
  readonly precondition: TargetPrecondition;
  readonly case: TargetCase;
  readonly code: 'missing_goal_baseline' | 'threshold_off_scale' | 'comparator_unscorable' | 'threshold_unit_mismatch';
}

export type TargetTestability =
  /** No goal node (or an unreadable graph): nothing to test. */
  | { readonly kind: 'no_goal' }
  /** A goal with no stated target: this verdict has no subject (the direction question is row 1's). */
  | { readonly kind: 'no_target'; readonly goal_id: string }
  | { readonly kind: 'not_testable'; readonly goal_id: string; readonly failures: readonly TargetTestabilityFailure[] }
  /** Every checked precondition holds; the listed ones are not checked yet, so this is never a "testable" claim. */
  | { readonly kind: 'unchecked'; readonly goal_id: string; readonly unchecked: readonly TargetPrecondition[] };

/**
 * Preconditions this module does not check yet: P5, the quantified £ path (MODEL GENERATION's `sizeLink`), and P6, a
 * target that sits only on an internal index. A target-derived cap with no today's level is P1's failure, not a second one.
 */
const NOT_CHECKED: readonly TargetPrecondition[] = ['P5', 'P6'];

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The goal's own limit row: the same statement as its target (DECISION-REPRESENTATION row 1). */
function ownLimitRow(graph: Rec, goal: Rec): Rec | undefined {
  const rows = Array.isArray(graph.goal_constraints) ? graph.goal_constraints.filter(isRec) : [];
  return rows.find((c) => c.node_id === goal.id && finite(c.value));
}

/** The goal's stated target figure: the node's own raw threshold, else the goal's own limit row's value. */
function statedTarget(graph: Rec, goal: Rec): number | null {
  if (finite(goal.goal_threshold_raw)) return goal.goal_threshold_raw;
  const own = ownLimitRow(graph, goal);
  return own !== undefined ? (own.value as number) : null;
}

const PRECONDITION_ORDER: readonly TargetPrecondition[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

export function targetTestabilityOf(graph: unknown): TargetTestability {
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return { kind: 'no_goal' };
  const goal = graph.nodes.filter(isRec).find((n) => n.kind === 'goal' && typeof n.id === 'string');
  if (goal === undefined) return { kind: 'no_goal' };
  const goalId = goal.id as string;
  if (statedTarget(graph, goal) === null) return { kind: 'no_target', goal_id: goalId };

  const failures: TargetTestabilityFailure[] = [];
  const today = isRec(goal.observed_state) ? goal.observed_state : undefined;
  // P1 — today's level on the goal, as science reads it (`observed_state.baseline`, the schema-v3 goal limb's
  // condition). Never derived from the target.
  const hasToday = today !== undefined && finite(today.baseline);
  if (!hasToday) failures.push({ precondition: 'P1', case: 'a', code: 'missing_goal_baseline' });
  // P2 — a level target normalises strictly inside (0, 1) (ISL clips at the edges). Change frames normalise elsewhere.
  if ((goal.goal_threshold_frame ?? 'level') === 'level' && finite(goal.goal_threshold) && !(goal.goal_threshold > 0 && goal.goal_threshold < 1)) {
    failures.push({ precondition: 'P2', case: 'd', code: 'threshold_off_scale' });
  }
  // P3 — a comparator science can score: `>=` / `<=`, and a strict `>` (it travels as `goal_threshold_strict`).
  if (readHeldGoalComparator(graph, goalId) === '<') failures.push({ precondition: 'P3', case: 'b', code: 'comparator_unscorable' });
  // P4 — the target's unit is the goal level's own (currency AND period).
  if (today !== undefined && typeof goal.goal_threshold_unit === 'string' && typeof today.unit === 'string'
    && !sameUnit(goal.goal_threshold_unit, today.unit)) {
    failures.push({ precondition: 'P4', case: 'd', code: 'threshold_unit_mismatch' });
  }
  return failures.length > 0
    ? { kind: 'not_testable', goal_id: goalId, failures: [...failures].sort((x, y) => PRECONDITION_ORDER.indexOf(x.precondition) - PRECONDITION_ORDER.indexOf(y.precondition)) }
    : { kind: 'unchecked', goal_id: goalId, unchecked: NOT_CHECKED };
}

const COMPARATOR_WORDS: Readonly<Record<string, string>> = { '>=': 'at least', '>': 'more than', '<=': 'at most', '<': 'below' };

/**
 * AIQ's words (#77 5912882031) for a `not_testable` verdict, under AIQ's two rules (#75 5913502854): the reason names
 * EVERY case measured failing (naming one would imply answering it makes the target testable), and the one question is
 * the first failing case, in R3's order, that has one ((b) is a capability gap: named, never asked). `null` otherwise.
 */
export function notTargetTestableSentence(graph: unknown, verdict: TargetTestability): string | null {
  if (verdict.kind !== 'not_testable' || !isRec(graph) || !Array.isArray(graph.nodes)) return null;
  const goal = graph.nodes.filter(isRec).find((n) => n.id === verdict.goal_id);
  const raw = goal === undefined ? null : statedTarget(graph, goal);
  if (goal === undefined || raw === null) return null;
  const name = typeof goal.label === 'string' && goal.label.trim() !== '' ? goal.label.trim() : 'your goal';
  const unit = typeof goal.goal_threshold_unit === 'string' ? goal.goal_threshold_unit
    : typeof ownLimitRow(graph, goal)?.unit === 'string' ? ownLimitRow(graph, goal)!.unit as string : '';
  const comparator = readHeldGoalComparator(graph, verdict.goal_id) ?? ownLimitRow(graph, goal)?.operator;
  const figure = unit !== '' ? sayFigure(raw, unit) : raw.toLocaleString('en-GB');
  const target = [typeof comparator === 'string' ? COMPARATOR_WORDS[comparator] : undefined, figure].filter(Boolean).join(' ');
  const said = (c: TargetCase): readonly [string, string | null] => c === 'a' ? [`it needs today's level of ${name}`, `What is ${name} today?`]
    : c === 'b' ? [`it can't yet test a '${typeof comparator === 'string' ? comparator : ''} ${figure}' target on ${name}`, null]
    : [`your target is in ${unit || 'its own units'}, but the model measures ${name} only relative to that target`, `What is ${name} today${unit !== '' ? `, in ${unit}` : ''}?`];
  const cases = [...new Set(verdict.failures.map((f) => f.case))];
  const reasons = cases.map((c) => said(c)[0]);
  const question = cases.map((c) => said(c)[1]).find((q): q is string => q !== null);
  const because = reasons.length === 1 ? reasons[0] : `${reasons.slice(0, -1).join(', ')} and ${reasons[reasons.length - 1]}`;
  return `Olumi can compare your options, but can't yet test them against your target (${target}), because ${because}.${question !== undefined ? ` ${question}` : ''}`;
}
