/**
 * ROADMAP 2.920 — the user's ATTESTED objective sense, forwarded to the engine.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED ON DEPLOYED STAGING (21 Sep 2026)
 *
 * ISL's request contract carries `goal_direction: 'maximise' | 'minimise' |
 * 'target'` and HONOURS it. Neither CEE nor PLoT sent it, so ISL ran the
 * maximiser UNATTESTED on every analysis — which for a goal that is a quantity
 * to REDUCE means the engine crowned the WORST option. ISL says so in terms:
 * "required whenever the goal is a quantity to reduce (cost, churn, risk),
 * where the historical rule crowned the worst option."
 *
 * Measured against `isl-staging` (`build c00f507`), goal node "Monthly churn",
 * one variable, seed 7, 400 samples:
 *
 *     absent      : opt_high 0.98125   <- the option that MAXIMISES churn leads
 *     'minimise'  : opt_low  0.98125   <- the ranking flips
 *     'maximise'  : opt_high 0.98125   <- byte-identical to absent (the CONTROL)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## ⭐ WHY THIS EMITS 'minimise' AND NOTHING ELSE
 *
 * The `maximise` arm above is byte-identical to sending nothing. So stamping
 * `maximise` cannot improve a single answer, while a MISCLASSIFIED `maximise`
 * would newly break an increase-goal that is correct today. It is pure downside,
 * and this module therefore never emits it.
 *
 * That makes the exposure ONE-SIDED, which is the whole safety argument:
 *
 *   | goal class   | today      | after                        | new exposure      |
 *   |--------------|------------|------------------------------|-------------------|
 *   | increase     | correct    | UNCHANGED                    | none              |
 *   | undetermined | unattested | UNCHANGED                    | none              |
 *   | decrease     | 100% WRONG | right when the classifier is | a false `decrease`|
 *
 * The bar this must clear is not "be accurate". It is "beat ALWAYS WRONG on the
 * decrease class", because that is today's behaviour there.
 *
 * ## THE CLASSIFIER IS NOT NEW, AND THAT IS DELIBERATE
 *
 * `deriveGoalIntent` already exists for the objective-contradiction surface and
 * is guarded by three corpus suites, including a full confusion matrix over 73
 * REAL goal labels harvested by script from fixtures and live captures, plus
 * opposite-direction twins ("DECREASE goals do not trigger the increase logic"
 * and its mirror), ambiguity-is-undetermined, and stasis-is-never-increase.
 * Inventing a second direction classifier here would be a second thing to be
 * wrong, drifting from the surface that DISCLOSES the contradiction — the two
 * must never disagree about which way a goal points.
 *
 * ⚠ A WRONG DIRECTION INVERTS THE RANKING. `undetermined` is the classifier's
 * default and is mapped to "send nothing", which reproduces today's behaviour
 * byte-for-byte — so silence is always the safe failure here, never a guess.
 *
 * ## ⭐ THE USER'S STATED COMPARATOR COMES FIRST (MG #72 5870097103, AIQ defect 1)
 *
 * The label classifier reads nothing for "Monthly cloud spend", "Monthly spend", "Cloud costs", "Hiring cost" or
 * "Monthly churn" (measured), so a brief that asks to CUT a cost had the most expensive option crowned. Yet the user's
 * own comparator is on the goal node: construction holds `goal_direction` (`'<='`, `'<'`, `'>='`, `'>'`) ONLY beside a
 * target the user wrote (`holdStatedGoalAttributes`, G1). That is attested, where the label is a reading of words, so:
 *
 *   | the goal node holds  | sent                          | provenance              |
 *   |----------------------|-------------------------------|-------------------------|
 *   | `'<='` or `'<'`      | `'minimise'`                  | `stated_comparator`     |
 *   | `'>='` or `'>'`      | nothing (today's maximiser)   | —                       |
 *   | nothing              | the label classifier, as before | `derived_from_goal_label` |
 *
 * `maximise` is still never sent — the one-sided argument above is unchanged. A held floor wins over a label that
 * reads "reduce" (the quantity it measures is then the reduction, which the user wants to rise).
 */

import { deriveGoalIntent } from '../coaching/objective-contradiction.js';

/** The only sense this module will ever put on the wire. */
export type EmittedGoalDirection = 'minimise';

/** Where a sent direction came from: the comparator the user stated, or a reading of the goal's label. */
export type GoalDirectionProvenance = 'stated_comparator' | 'derived_from_goal_label';

/** The comparators `NodeV3.goal_direction` stores (the candidate contract's own four). */
type HeldComparator = '>=' | '<=' | '>' | '<';
const HELD_COMPARATORS: readonly string[] = ['>=', '<=', '>', '<'];

function readNodes(graph: unknown): readonly Record<string, unknown>[] {
  if (graph === null || typeof graph !== 'object') return [];
  const nodes = (graph as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.filter(
    (n): n is Record<string, unknown> =>
      n !== null && typeof n === 'object' && !Array.isArray(n),
  );
}

/**
 * The goal node's label, or `null`. Defensive over the graph shape on purpose:
 * this reads a persisted snapshot, and a missing label must degrade to "send
 * nothing" rather than throw inside the analysis path.
 */
export function readGoalLabel(graph: unknown, goalNodeId: unknown): string | null {
  if (typeof goalNodeId !== 'string' || goalNodeId === '') return null;
  for (const node of readNodes(graph)) {
    if (node.id !== goalNodeId) continue;
    const label = node.label;
    return typeof label === 'string' && label.trim() !== '' ? label : null;
  }
  return null;
}

/**
 * The comparator the USER stated for the goal's target, as construction held it on the goal node
 * (`goal_direction`, written only by `holdStatedGoalAttributes`), or `null` when none is held. A value outside the
 * stored four is not a held comparator.
 */
export function readHeldGoalComparator(graph: unknown, goalNodeId: unknown): HeldComparator | null {
  if (typeof goalNodeId !== 'string' || goalNodeId === '') return null;
  for (const node of readNodes(graph)) {
    if (node.id !== goalNodeId) continue;
    const held = node.goal_direction;
    return typeof held === 'string' && HELD_COMPARATORS.includes(held) ? (held as HeldComparator) : null;
  }
  return null;
}

/**
 * The sense a HELD comparator attests: `'minimise'` for a ceiling (`'<='`, `'<'`), otherwise `undefined` (a floor
 * is today's maximiser, never sent). ONE reading, shared by the wire (`resolveGoalDirection`) and by admission of a
 * stated current level beside a ceiling (`admitStatedGoalLevel`), so a level is admitted only where the run minimises.
 */
export function heldComparatorSense(held: unknown): EmittedGoalDirection | undefined {
  return held === '<=' || held === '<' ? 'minimise' : undefined;
}

/**
 * The direction to send, and where it came from — the user's HELD comparator when the goal node holds one (see the
 * header's table), otherwise the label classifier. `undefined` ⇒ the caller omits the key (today's maximiser).
 */
export function resolveGoalDirection(
  graph: unknown,
  goalNodeId: unknown,
): { readonly direction: EmittedGoalDirection; readonly provenance: GoalDirectionProvenance } | undefined {
  const held = readHeldGoalComparator(graph, goalNodeId);
  if (held !== null) {
    const sense = heldComparatorSense(held);
    return sense === undefined ? undefined : { direction: sense, provenance: 'stated_comparator' };
  }
  const derived = directionFromGoalLabel(graph, goalNodeId);
  return derived === undefined ? undefined : { direction: derived, provenance: 'derived_from_goal_label' };
}

/**
 * The estate's one direction authority, as a bare answer: `'minimise'` when the goal attests a REDUCE aim — its
 * held comparator when it holds one, else its label — otherwise `undefined` (⇒ the caller omits the key ⇒ ISL's
 * unattested maximiser, exactly as today).
 *
 * Never returns `'maximise'`: see the header. Never returns `'target'` — that
 * sense needs a threshold and frame ISL refuses to run without, and it is not
 * derivable from a label.
 */
export function deriveEmittedGoalDirection(
  graph: unknown,
  goalNodeId: unknown,
): EmittedGoalDirection | undefined {
  return resolveGoalDirection(graph, goalNodeId)?.direction;
}

/** The label classifier alone: `'minimise'` when the goal label attests a REDUCE aim, otherwise `undefined`. */
function directionFromGoalLabel(
  graph: unknown,
  goalNodeId: unknown,
): EmittedGoalDirection | undefined {
  const label = readGoalLabel(graph, goalNodeId);
  if (label === null) return undefined;

  // ⚠ CONSUMED IN ITS VALIDATED CONJUNCTION, NOT BY `.direction` ALONE.
  // The incumbent surface this classifier was built for
  // (`objective-contradiction.ts`) requires `subject !== null` before it acts
  // on a direction. Reading `.direction` alone consumed the classifier OUTSIDE
  // the conjunction its corpus suites validate: measured, a bare `"Reduce"` and
  // `"Cost reduced"` both yield `subject: null` and would have emitted
  // `minimise` on a label that names no quantity at all. Two surfaces must not
  // disagree about which way a goal points, and that includes the gate.
  const intent = deriveGoalIntent(label);
  if (intent.subject === null) return undefined;
  return intent.direction === 'decrease' ? 'minimise' : undefined;
}
