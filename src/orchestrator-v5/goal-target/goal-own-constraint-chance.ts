/**
 * ⭐ RECOVERY BATCH B, DL (b1) + AIE 6125204695, 12 Oct 2026: A DEADLINE GOAL'S CHANCE IS THE ENGINE'S OWN APPROXIMATE POINT,
 * READ PER OPTION OFF THE GOAL'S OWN CONSTRAINT WHEN PLoT GIVES NO `probability_of_goal` AT THRESHOLD 1.
 *
 * PLoT 6ec01e8 sends no `probability_of_goal` for a goal threshold at the top of [0,1] (`src/routes/v2/run.ts`,
 * `goal_threshold_degenerate_refused`). A deadline goal (all of the deliverable done by the date: ≥ 1) is exactly that case, so
 * on the real engine every event-by-date chance was withheld (`recovery/bB/ebd-law/DIAGNOSIS.md`, side blocker). For a goal
 * whose threshold it was SENT in the samples' frame ('delta'), PLoT synthesises the goal's OWN constraint,
 * `auto_goal_threshold`, from exactly what CEE sent: the goal node, its threshold, and the operator from the sent direction
 * and strictness. ISL scores it on the same draws with the same comparison, and each option's row carries it as
 * `constraint_probabilities.auto_goal_threshold` (83.01 / 95.15 / 41.58 % on Paul's request).
 *
 * Read only when ALL of these hold; otherwise the record is returned unchanged (AIE 6125204695: "a finite constraint value
 * alone is not a licence"):
 *   · THE SENT RUN qualifies: CEE sent this goal node with a finite threshold in the 'delta' frame, and the operator PLoT
 *     derives from the sent direction and strictness is the goal's own held comparator;
 *   · PER OPTION: the option is one CEE sent; its OWN row carries no `probability_of_goal` at all; its own
 *     `goal_fit_basis.node_ids` is exactly this goal; its own `constraint_probabilities.auto_goal_threshold` is a chance;
 *   · no goal-figures withhold names the option or the whole Run. A CEE withhold is never undone: absent stays absent.
 * NEVER the Run's top-level `constraint_results` (it holds one selected option only), never the joint of several
 * (`probability_of_joint_goal`), never a win share or another constraint. The figure's own precision (the same key's
 * `n_informative`, the same draws) becomes the 95% Wilson block the licence already reads. When the precision is absent or
 * malformed there is no block, so the step is whole %. An exact 0/1 still needs the Run to have earned it (the licence).
 * Pure: it returns copies and never edits the Run.
 */
import { GOAL_FIGURES_SHARE_APPROXIMATION, GOAL_FIGURES_WITHHELD_CODES, readOptionResultSources } from '../../orchestrator/context/option-result-source.js';
import { withholdOptionGoalFigures } from '../../orchestrator/context/constraint-feasibility.js';
import { WILSON_Z_95 } from './goal-chance-driver.js';
import { readGoalRecord } from './goal-record.js';
import { shareByDateGoalForChanceOf } from './share-by-date-run.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const unit01 = (v: unknown): v is number => finite(v) && v >= 0 && v <= 1;

/** PLoT's id for the constraint it synthesises from the goal's own threshold (`run.ts`, `auto_from_goal_threshold`). */
export const GOAL_OWN_CONSTRAINT_ID = 'auto_goal_threshold';

/** What CEE sent PLoT for this Run (`run-analysis.ts` `plotPayload`): the graph, and the top-level direction and strictness. */
export interface SentRunInputs {
  readonly graph?: unknown;
  readonly goal_direction?: unknown;
  readonly goal_threshold_strict?: unknown;
}

export interface GoalOwnConstraintRead {
  /** The Run's records, with each engine-read option's figure (and its precision) where `probability_of_goal` would sit. */
  readonly records: readonly Rec[];
  /** The options whose figure was read off the goal's own constraint. */
  readonly engineRead: ReadonlySet<string>;
}

/**
 * ⭐ B2 (independent check BLOCKING 3, CHECK.md on 91405cb2): THE SENT RUN TESTED THE HELD TARGET, OR NOTHING IS READ. A finite
 * sent threshold is not enough: a sent delta 0.5 for the held ≥ 100% would quote another threshold's probability as the chance
 * of meeting the goal. The held target in the held frame is what CEE's one Run-frame writer makes of it (`withShareByDateFrame`:
 * a share-by-date goal holds its target as a level of % done with no observed baseline, so it is sent as `threshold_raw / 100`
 * in the samples' 'delta' frame). The sent goal must be this goal node, with exactly that threshold, in that frame, and the
 * operator PLoT derives from the sent direction and strictness must be the goal's held comparator.
 */
export function sentRunTestsHeldTarget(sent: SentRunInputs | undefined, graph: unknown, goalId: unknown): boolean {
  if (sent === undefined || typeof goalId !== 'string' || !isRec(sent.graph) || !Array.isArray(sent.graph.nodes)) return false;
  const sentGoal = sent.graph.nodes.filter(isRec).find((n) => n.id === goalId && n.kind === 'goal');
  const sentOperator = sent.goal_direction === 'minimise'
    ? (sent.goal_threshold_strict === true ? '<' : '<=') : (sent.goal_threshold_strict === true ? '>' : '>=');
  const share = shareByDateGoalForChanceOf(graph), threshold = sentGoal?.goal_threshold;
  return sentGoal !== undefined && share !== null && share.goal.id === goalId && finite(threshold)
    && threshold === share.threshold_raw / 100 && sentGoal.goal_threshold_frame === 'delta'
    && readGoalRecord(graph, goalId)?.target?.comparator === sentOperator;
}

/** AIE 6129564354 (AMENDED), verbatim: a deadline Run that did not test the target saved in the model shows no option's chance. */
export const SENT_TARGET_NOT_HELD_WORDS = 'Not shown. This analysis did not test the target saved in your model, so its figures cannot describe your chance of reaching that target.';
/** AIE 6129564354: appended ONLY where revision evidence proves the saved target changed after that analysis. */
export const SENT_TARGET_CHANGED_SUFFIX = 'Run the analysis again.';
/** AIE 6129564354: appended otherwise; the mismatch is Olumi's to resolve, never the user's to re-run. */
export const SENT_TARGET_MISMATCH_SUFFIX = 'Olumi needs to resolve this analysis mismatch before showing a chance.';
/**
 * Revision evidence: the target the analysis was sent with, as it was saved then (the sent goal node's own raw target), is
 * not the target saved in the model now. Anything else (a frame, comparator or conversion that does not match the same saved
 * target) is a mismatch of Olumi's.
 */
export function savedTargetChangedSince(sent: SentRunInputs | undefined, graph: unknown, goalId: unknown): boolean {
  if (sent === undefined || typeof goalId !== 'string' || !isRec(sent.graph) || !Array.isArray(sent.graph.nodes)) return false;
  const sentRaw = sent.graph.nodes.filter(isRec).find((n) => n.id === goalId && n.kind === 'goal')?.goal_threshold_raw;
  const held = shareByDateGoalForChanceOf(graph);
  return held !== null && held.goal.id === goalId && finite(sentRaw) && finite(held.threshold_raw) && sentRaw !== held.threshold_raw;
}
/** The withhold's words for this Run: the AIE's sentence, then the one suffix the revision evidence supports. */
export function sentTargetNotHeldWords(sent: SentRunInputs | undefined, graph: unknown, goalId: unknown): string {
  return `${SENT_TARGET_NOT_HELD_WORDS} ${savedTargetChangedSince(sent, graph, goalId) ? SENT_TARGET_CHANGED_SUFFIX : SENT_TARGET_MISMATCH_SUFFIX}`;
}

/**
 * At Run time, before the licence: a deadline goal's Run whose sent target is not the held one withholds EVERY option's goal
 * figures with words (`sentTargetNotHeldWords`), so the cell says why instead of falling silent. Any other goal, or no sent
 * run, is returned unchanged.
 */
export function withSentTargetWithheld<E>(envelope: E, graph: unknown, goalId: unknown, sent: SentRunInputs | undefined): E {
  if (!isRec(envelope) || sent === undefined || typeof goalId !== 'string' || shareByDateGoalForChanceOf(graph)?.goal.id !== goalId
    || sentRunTestsHeldTarget(sent, graph, goalId)) return envelope;
  const ids = new Set((readOptionResultSources(envelope).find((s) => s.length > 0) ?? []).flatMap((r) => {
    const id = r.option_id ?? r.id; return typeof id === 'string' ? [id] : [];
  }));
  return withholdOptionGoalFigures(envelope, ids, { code: GOAL_FIGURES_SHARE_APPROXIMATION, severity: 'warning',
    option_ids: [...ids], message: sentTargetNotHeldWords(sent, graph, goalId) }, { keepOutcome: true, keepOrdering: true });
}

export function goalOwnConstraintChanceRecords(
  envelope: unknown, graph: unknown, goalId: unknown, records: readonly Rec[], sent: SentRunInputs | undefined,
): GoalOwnConstraintRead {
  const none: GoalOwnConstraintRead = { records, engineRead: new Set() };
  if (!isRec(envelope) || typeof goalId !== 'string' || sent === undefined || !isRec(sent.graph) || !Array.isArray(sent.graph.nodes)) return none;
  // The sent run: PLoT synthesises the goal's own constraint from these, and from nothing else (`run.ts`, autoConstraint). It must
  // have tested the HELD target: this node, its own threshold in the samples' frame, the held comparator (`sentRunTestsHeldTarget`).
  const sentNodes = sent.graph.nodes.filter(isRec);
  if (!sentRunTestsHeldTarget(sent, graph, goalId)) return none;
  const sentOptions = new Set(sentNodes.filter((n) => n.kind === 'option').map((n) => n.id));
  const warnings = (Array.isArray(envelope.inference_warnings) ? envelope.inference_warnings : []).filter(isRec);
  const withheld = (id: string): boolean => warnings.some((w) => typeof w.code === 'string' && GOAL_FIGURES_WITHHELD_CODES.has(w.code)
    && (!Array.isArray(w.option_ids) || w.option_ids.length === 0 || w.option_ids.includes(id)));
  const engineRead = new Set<string>();
  const out = records.map((r) => {
    const id = typeof r.option_id === 'string' ? r.option_id : typeof r.id === 'string' ? r.id : undefined;
    if (id === undefined || !sentOptions.has(id) || 'probability_of_goal' in r || withheld(id)) return r;
    // This option's OWN row is scored on this goal node and carries this goal's own constraint.
    const basis = isRec(r.goal_fit_basis) ? r.goal_fit_basis.node_ids : undefined;
    if (!Array.isArray(basis) || basis.length !== 1 || basis[0] !== goalId) return r;
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
