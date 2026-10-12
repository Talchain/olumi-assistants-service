/**
 * ⭐ RECOVERY BATCH B, DL (b1) 12 Oct 2026 — A DEADLINE GOAL'S CHANCE IS THE ENGINE'S OWN, READ OFF THE GOAL'S OWN CONSTRAINT
 * WHEN PLoT GIVES NO `probability_of_goal` AT THRESHOLD 1.
 *
 * PLoT 6ec01e8 sends no `probability_of_goal` for a goal threshold at the top of [0,1] (`src/routes/v2/run.ts`,
 * `goal_threshold_degenerate_refused`). A deadline goal (all of the deliverable done by the date: ≥ 1) is exactly that case, so
 * on the real engine every event-by-date chance was withheld (`recovery/bB/ebd-law/DIAGNOSIS.md`, side blocker). PLoT still
 * synthesises the goal's OWN constraint (`auto_goal_threshold` on the goal node, with the goal's operator and threshold), and
 * ISL scores it on the same draws with the same comparison (ISL I-2): 83.01 / 95.15 / 41.58 % on Paul's request.
 *
 * Read only when ALL of these hold; otherwise the record is returned unchanged:
 *   · the option's record carries no `probability_of_goal` at all;
 *   · no goal-figures withhold names the option or the whole Run. A CEE withhold is never undone: absent stays absent;
 *   · the Run's `constraint_results` carry `auto_goal_threshold`, and EVERY such entry sits on this goal node with the goal's
 *     own operator and threshold. It is bound by identity, never by a value another constraint could share;
 *   · the record's `constraint_probabilities.auto_goal_threshold` is a chance.
 * Never another constraint, and never the joint of several (`probability_of_joint_goal`). The figure's precision
 * (`n_informative`, the same draws) becomes the 95% Wilson block the licence already reads. When the precision is absent or
 * malformed there is no block, so the step is whole %, as for any record without one.
 * Pure: it returns copies and never edits the Run.
 */
import { GOAL_FIGURES_WITHHELD_CODES } from '../../orchestrator/context/option-result-source.js';
import { WILSON_Z_95 } from './goal-chance-driver.js';
import { statedGoalTargetOf } from './stated-goal-target.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const unit01 = (v: unknown): v is number => finite(v) && v >= 0 && v <= 1;

/** PLoT's id for the constraint it synthesises from the goal's own threshold (`run.ts`, `auto_from_goal_threshold`). */
export const GOAL_OWN_CONSTRAINT_ID = 'auto_goal_threshold';

export interface GoalOwnConstraintRead {
  /** The Run's records, with each engine-read option's figure (and its precision) where `probability_of_goal` would sit. */
  readonly records: readonly Rec[];
  /** The options whose figure was read off the goal's own constraint (DL (b1)(ii): the 2-point share gate is not applied). */
  readonly engineRead: ReadonlySet<string>;
}

export function goalOwnConstraintChanceRecords(
  envelope: unknown, graph: unknown, goalId: unknown, records: readonly Rec[],
): GoalOwnConstraintRead {
  const none: GoalOwnConstraintRead = { records, engineRead: new Set() };
  if (!isRec(envelope) || !isRec(graph) || typeof goalId !== 'string' || !Array.isArray(graph.nodes)) return none;
  const goal = graph.nodes.filter(isRec).find((n) => n.id === goalId && n.kind === 'goal');
  if (goal === undefined || !finite(goal.goal_threshold)) return none;
  const operator = statedGoalTargetOf(graph, goal)?.held;
  if (operator === undefined) return none;
  const own = (Array.isArray(envelope.constraint_results) ? envelope.constraint_results : [])
    .filter(isRec).filter((c) => c.constraint_id === GOAL_OWN_CONSTRAINT_ID);
  if (own.length === 0 || !own.every((c) => c.node_id === goalId && c.operator === operator && c.value === goal.goal_threshold)) return none;
  const warnings = (Array.isArray(envelope.inference_warnings) ? envelope.inference_warnings : []).filter(isRec);
  const withheld = (id: string): boolean => warnings.some((w) => typeof w.code === 'string' && GOAL_FIGURES_WITHHELD_CODES.has(w.code)
    && (!Array.isArray(w.option_ids) || w.option_ids.length === 0 || w.option_ids.includes(id)));
  const engineRead = new Set<string>();
  const out = records.map((r) => {
    const id = typeof r.option_id === 'string' ? r.option_id : typeof r.id === 'string' ? r.id : undefined;
    if (id === undefined || 'probability_of_goal' in r || withheld(id)) return r;
    const p = isRec(r.constraint_probabilities) ? r.constraint_probabilities[GOAL_OWN_CONSTRAINT_ID] : undefined;
    if (!unit01(p)) return r;
    engineRead.add(id);
    const block = wilsonBlockOf(p, isRec(r.constraint_probabilities_precision)
      ? r.constraint_probabilities_precision[GOAL_OWN_CONSTRAINT_ID] : undefined);
    return { ...r, probability_of_goal: p, ...(block === null ? {} : { probability_of_goal_precision: block }) };
  });
  return engineRead.size === 0 ? none : { records: out, engineRead };
}

/** `{n_informative, standard_error}` of the figure's own draws as the licence's 95% Wilson block, or null. */
function wilsonBlockOf(p: number, precision: unknown): Rec | null {
  if (!isRec(precision)) return null;
  const n = precision.n_informative, se = precision.standard_error;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0 || !finite(se) || se < 0 || se > 0.5) return null;
  const z2 = WILSON_Z_95 * WILSON_Z_95;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (WILSON_Z_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { basis: 'simulation_precision', method: 'wilson_score', confidence_level: 0.95, n_informative: n,
    n_met: Math.round(p * n), interval_lower: Math.max(0, centre - half), interval_upper: Math.min(1, centre + half) };
}
