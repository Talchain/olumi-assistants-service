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
 *   | `'<='` or `'<'`, PROVEN (below) | `'minimise'`       | `stated_comparator`     |
 *   | `'<='` or `'<'` beside a target TYPED as a LEVEL (RT-10, below), in any unit, with or without today's level | `'minimise'` | `stated_comparator` |
 *   | `'<='` or `'<'` beside its own limit row on the goal (the approved card's pair, RT-10 B′) | `'minimise'` | `stated_comparator` |
 *   | no proven ceiling; Olumi's `goal_sense_reading` of a NEGATIVE typed change ("cut by 20%") | `'minimise'` | `typed_change_sign` |
 *   | anything else (a held floor, an unproven ceiling, none) | the label classifier, exactly as base | `derived_from_goal_label` |
 *
 * ⚠ R1 S1 (AIQ 5871459631, DL 5871433038): a held ceiling sends `minimise` only when the goal carries the current
 * level the user stated in the target's own unit (`ceilingTargetIsALevelOnItsNode`) — the one proof, before R1 types
 * the frame, that the target is a LEVEL of the node and not a change ("reduce costs by at most 10%" is a floor on
 * cost). Otherwise nothing is sent. `maximise` for a held floor waits for R1 S4 (a real draft, `cloud-0`: "costs >=
 * 20 % reduction", would otherwise be attested a false maximiser, MG 5871403407).
 * `maximise` is still never sent — the one-sided argument above is unchanged. A held floor (and an unproven ceiling)
 * reads exactly as base — the label classifier (DL E13, 5872375159); the held floor's own sense belongs to S4.
 *
 * ⛔ RT-10 (red team #87 5992802436 / 5992853052, staging AND production; Science ruling (1), 5 Oct): "Get monthly churn
 * below 2%" holds `'<'` beside 2 `%` on a target the drafter TYPED `level`, and the S1 proof above can never pass for it
 * (a percent target; no current level stated), so nothing was sent and ISL ranked the option that MAXIMISES churn
 * first. S1 waited "until S4 types the frame": the frame is typed now (the drafter must state it, `build-model.ts`), so
 * a held ceiling beside a held target typed `level` IS the user's sense, in any unit, whether or not today's level is
 * known. The sense is the comparator's; today's level matters only to the goal chance, which keeps its own gates
 * (admission, `target-testability.ts`). A target unit that itself names a change ("% reduction", a pre-R1 draft whose
 * frame defaulted to `level`) is still no level: nothing is sent for it.
 */

import { deriveGoalIntent } from '../coaching/objective-contradiction.js';
import { USER_EDIT_SOURCE } from '../../orchestrator/canonicalise-value-ops.js';
import { classifyUnitScaleClass } from '../../cee/draft/records/unit-scale-class.js';

/** The only sense this module will ever put on the wire. */
export type EmittedGoalDirection = 'minimise';

/**
 * Where a sent direction came from: the comparator the user stated, the SIGN of a target typed as a change from today,
 * or a reading of the goal's label.
 */
export type GoalDirectionProvenance = 'stated_comparator' | 'typed_change_sign' | 'derived_from_goal_label';

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
 * The comparator the USER stated for the goal's target, as held on the goal node (`goal_direction`: written by
 * construction's `holdStatedGoalAttributes`, and by the user's approved goal target card, DR row 1), or `null` when
 * none is held. A value outside the stored four is not a held comparator.
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
 * ⛔ R1 S1 (AIQ 5872082179): a ceiling's target unit that MAY be a level of the node. Not the percent family (`%`,
 * percentage points, `pp`, `bps` — `classifyUnitScaleClass`) and not points: there "reduce by at most 2%" is a change,
 * a floor on the quantity, and level and target share one unit so nothing structural tells them apart until S4 types
 * the frame. ONE predicate for the wire (`ceilingTargetIsALevelOnItsNode`) and for admission (`admitStatedGoalLevel`),
 * so a level is admitted beside a ceiling only where the run will minimise.
 */
export function ceilingTargetUnitMayBeALevel(unit: unknown): boolean {
  const t = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
  return t !== '' && classifyUnitScaleClass(t) === 'unknown' && !/\bpoints?\b/.test(t);
}

/**
 * ⭐ R1 S1 (AIQ 5871459631): the proof that a held ceiling's target is a LEVEL in the goal node's own unit family — the
 * goal carries the current level the USER stated (`observed_state`, `source` `brief_extraction` or `USER_EDIT_SOURCE`,
 * admitted by `admitStatedGoalLevel` beside that very ceiling) in the target's own unit (`goal_threshold_unit`). A target whose
 * unit is a change ("% reduction") never admits a level in another unit, so it never passes; R1 S4 types the frame.
 */
function ceilingTargetIsALevelOnItsNode(graph: unknown, goalNodeId: unknown): boolean {
  if (typeof goalNodeId !== 'string' || goalNodeId === '') return false;
  const node = readNodes(graph).find((n) => n.id === goalNodeId);
  const os = node?.observed_state;
  if (os === null || typeof os !== 'object' || Array.isArray(os)) return false;
  const level = os as Record<string, unknown>;
  const unit = (u: unknown): string | null => (typeof u === 'string' && u.trim() !== '' ? u.trim().toLowerCase() : null);
  const targetUnit = unit(node?.goal_threshold_unit);
  // ⛔ AIQ 5872082179 (ACK withdrawn until this row): on the brief route the level and the target share ONE `goal.unit`,
  // so the unit check below passes by construction — "gross margin 30%, reduce by at most 2%" would minimise a floor.
  // Until S4 types the frame, a target in the percent family (%, percentage points, pp, bps) or in points is never
  // proven a level here: nothing is sent.
  if (!ceilingTargetUnitMayBeALevel(targetUnit)) return false;
  // The user's own figure: stated in the brief (`brief_extraction`) or given in chat and approved (`USER_EDIT_SOURCE`).
  return (level.source === 'brief_extraction' || level.source === USER_EDIT_SOURCE)
    && typeof level.raw_value === 'number' && Number.isFinite(level.raw_value)
    && targetUnit !== null && unit(level.unit) === targetUnit;
}

/**
 * A target unit that makes the figure a CHANGE from today: a change noun ON a percent, points or money figure ("%
 * reduction", "percentage point increase", "£k cut"), not a level. Counted events keep their noun ("falls per month",
 * "power cuts per month": Codex buddy P1 on #2585), so the noun alone never decides.
 */
const CHANGE_UNIT = /(?:%|\bper\s?cent(?:age)?(?:\s+points?)?|\bpp\b|\bpoints?\b|[£$€]\S*)\s*(?:reductions?|decreases?|cuts?|drops?|declines?|falls?|increases?|rises?|growth|uplifts?|changes?|savings?)\b/i;

/**
 * ⭐ RT-10 (Science ruling (1), 5 Oct): the goal holds a target figure (`goal_threshold_raw`) TYPED as a level
 * (`goal_threshold_frame` `'level'`, which the drafter must state), in a unit that does not itself name a change. Beside
 * a held ceiling that is the user's own sense, in any unit (percent included), with or without today's level: since
 * #2585 construction holds a ceiling on a level only where the brief WRITES that figure as one
 * (`ceilingTheUserWroteFor`, `stated-by-user.ts`), so the drafter's own comparator never reaches here.
 */
function heldTargetIsATypedLevel(graph: unknown, goalNodeId: unknown): boolean {
  if (typeof goalNodeId !== 'string' || goalNodeId === '') return false;
  const node = readNodes(graph).find((n) => n.id === goalNodeId);
  if (node?.goal_threshold_frame !== 'level') return false;
  const raw = node.goal_threshold_raw;
  const unit = node.goal_threshold_unit;
  return typeof raw === 'number' && Number.isFinite(raw) && !(typeof unit === 'string' && CHANGE_UNIT.test(unit));
}

/**
 * ⭐ RT-10 B′ (Science 5 Oct Q1; DL ruling): the goal holds a ceiling BESIDE ITS OWN LIMIT ROW on the goal — a
 * `goal_constraints` row on the goal node that states the same comparator (`<=`, or `<` as `operator_as_stated`), on a
 * level (`value_frame` `level` or absent, never a change). The approved goal target card writes exactly that pair
 * (`add-constraint.ts`: an approved "at most" holds the ceiling and keeps the row), so "If lower is better, tell me and
 * I'll re-order" re-orders even where the goal holds no target figure of its own.
 */
function heldCeilingBesideItsLimitRow(graph: unknown, goalNodeId: unknown): boolean {
  if (typeof goalNodeId !== 'string' || goalNodeId === '') return false;
  const held = readHeldGoalComparator(graph, goalNodeId);
  if (held !== '<' && held !== '<=') return false;
  const rows = graph !== null && typeof graph === 'object' ? (graph as Record<string, unknown>).goal_constraints : undefined;
  if (!Array.isArray(rows)) return false;
  return rows.some((r) => {
    if (r === null || typeof r !== 'object') return false;
    const row = r as Record<string, unknown>;
    if (row.node_id !== goalNodeId || row.operator !== '<=') return false;
    if (row.value_frame !== undefined && row.value_frame !== 'level') return false;
    return (row.operator_as_stated === '<' ? '<' : '<=') === held;
  });
}

/** R1 S4-core: the goal's target is typed as a change from today (`goal_threshold_frame` `change_abs` | `change_rel`). */
function goalTargetIsATypedChange(graph: unknown, goalNodeId: unknown): boolean {
  if (typeof goalNodeId !== 'string' || goalNodeId === '') return false;
  const frame = readNodes(graph).find((n) => n.id === goalNodeId)?.goal_threshold_frame;
  return frame === 'change_abs' || frame === 'change_rel';
}

/**
 * ⛔ OLUMI'S TYPED READING OF A DECREASE TARGET (R3-B #72 5893233864, DL 5893260041, AIQ 5893340150, MG 5893383773).
 * Served on "cut costs by 20%": the "20%" beside "costs" was given to another node whose label says "cost", so no
 * comparator was held and the run MAXIMISED spend ("Stay on AWS" crowned, 100% "reaches the target"). Construction now
 * types Olumi's reading on the goal (`goal_sense_reading`, written only for a NEGATIVE typed change whose drafter
 * comparator is a ceiling: AIQ's floor guard) and this honours it only while the node still holds NO comparator and its
 * target is still the exact negative raw figure and frame the reading was taken from. No reading (an old graph, a floor,
 * an increase, a level) reads exactly as before.
 */
function goalHoldsOlumisDecreaseReading(graph: unknown, goalNodeId: unknown): boolean {
  if (!goalTargetIsATypedChange(graph, goalNodeId)) return false;
  const node = readNodes(graph).find((n) => n.id === goalNodeId);
  if (node === undefined) return false;
  // ⛔ PR Review 5894041769: a comparator on the node — the user's, and above all a FLOOR — is never overruled by
  // Olumi's reading. It was written only where none was held; one held since means the reading no longer speaks.
  if (node.goal_direction !== undefined && node.goal_direction !== null) return false;
  const reading = node.goal_sense_reading as { sense?: unknown; basis?: unknown; threshold?: unknown; threshold_frame?: unknown } | undefined;
  if (reading?.sense !== 'minimise' || reading.basis !== 'typed_change_sign') return false;
  // ⛔ BOUND TO THE TARGET IT READ: the exact raw figure and frame. An edited target (another figure, another frame)
  // leaves a stale reading, and a stale reading never speaks for the new one.
  const raw = node.goal_threshold_raw;
  return typeof raw === 'number' && Number.isFinite(raw) && raw < 0
    && reading.threshold === raw && reading.threshold_frame === node.goal_threshold_frame;
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
 * ⛔ THE USER HELD THE GOAL AS A FLOOR, SO HIGHER IS BETTER (AIQ #75 5901136155). True when the goal node holds the
 * user's `'>='` / `'>'` and the target is not a NEGATIVE typed change: "at least a 20% cut" is held `'>='` on a change
 * of −20%, and it points DOWN (cloud-0, MG 5871403407). PLoT still reports GOAL_DIRECTION_UNATTESTED on such a run,
 * because `maximise` is never sent (header), but the direction was not assumed: it is the user's. Nothing is sent from
 * this; the headline reads it so as not to say the direction was assumed.
 */
export function heldGoalPointsUp(graph: unknown, goalNodeId: unknown): boolean {
  const held = readHeldGoalComparator(graph, goalNodeId);
  if (held !== '>=' && held !== '>') return false;
  const node = readNodes(graph).find((n) => n.id === goalNodeId);
  const frame = node?.goal_threshold_frame;
  const raw = node?.goal_threshold_raw;
  const isChange = frame === 'change_rel' || frame === 'change_abs' || frame === 'delta';
  return !(isChange && typeof raw === 'number' && raw < 0);
}

/**
 * The direction to send, and where it came from — the user's HELD comparator when the goal node holds one (see the
 * header's table), otherwise the label classifier. `undefined` ⇒ the caller omits the key (today's maximiser).
 */
export function resolveGoalDirection(
  graph: unknown,
  goalNodeId: unknown,
): { readonly direction: EmittedGoalDirection; readonly provenance: GoalDirectionProvenance } | undefined {
  // R1 S1: the held comparator speaks ONLY for a PROVEN ceiling (AIQ 5871459631 / 5872082179: a target that is a LEVEL of
  // the node, shown by the user's stated level in the target's own non-percent, non-points unit). EVERY other goal — a
  // held floor, an unproven ceiling, no comparator — reads exactly as base: the label classifier (DL E13, 5872375159:
  // "nothing else moves"; a held floor's own sense belongs to S4, with the typed frame).
  if (heldComparatorSense(readHeldGoalComparator(graph, goalNodeId)) === 'minimise' && ceilingTargetIsALevelOnItsNode(graph, goalNodeId)) {
    return { direction: 'minimise', provenance: 'stated_comparator' };
  }
  // ⛔ RT-10 (Science ruling (1)): a held ceiling beside a target TYPED as a level is the user's sense in any unit, with
  // or without today's level ("monthly churn below 2%" was ranked by the LARGEST churn).
  if (heldComparatorSense(readHeldGoalComparator(graph, goalNodeId)) === 'minimise' && heldTargetIsATypedLevel(graph, goalNodeId)) {
    return { direction: 'minimise', provenance: 'stated_comparator' };
  }
  // ⭐ RT-10 B′: a held ceiling beside its own limit row on the goal (the approved card's pair) — no target figure needed.
  if (heldCeilingBesideItsLimitRow(graph, goalNodeId)) return { direction: 'minimise', provenance: 'stated_comparator' };
  // ⭐ R1 S4-core: a target TYPED as a change from today ("cut by 15%" → `change_rel` −0.15, held `<=`) needs no level
  // proof — the frame is the proof S1 waited for. Its held ceiling is its direction; a held floor stays today's maximiser.
  if (heldComparatorSense(readHeldGoalComparator(graph, goalNodeId)) === 'minimise' && goalTargetIsATypedChange(graph, goalNodeId)) {
    return { direction: 'minimise', provenance: 'stated_comparator' };
  }
  if (goalHoldsOlumisDecreaseReading(graph, goalNodeId)) return { direction: 'minimise', provenance: 'typed_change_sign' };
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

/**
 * ⭐ R1 S4 (B) (#72 5879133964 / 5879602608): a HELD strict floor (`'>'`, "MRR above £85k") is scored STRICTLY past its
 * target — ISL `goal_threshold_strict` (ISL #209), carried by PLoT as it stands. Only where the run MAXIMISES: a held
 * `'>'` beside a label that reads reduce is sent `minimise` from the label (DL E13), and strict there would score
 * strictly BELOW, the opposite of "above". ONE reading, shared by the wire (`resolveGoalThresholdStrict`) and by
 * admission of a stated current level beside a held `'>'` (`admitStatedGoalLevel`), so a `'>'` level is admitted only
 * where the run scores it strictly. `'<'` is not read here: its minimise sense needs the proven-ceiling rule.
 */
export function heldStrictFloorIsScoredStrictly(held: unknown, goalLabel: unknown): boolean {
  if (held !== '>') return false;
  return typeof goalLabel !== 'string' || goalLabel.trim() === '' || directionFromLabelText(goalLabel) === undefined;
}

/**
 * `true` ⇒ the caller sends `goal_threshold_strict: true`; `false` ⇒ it omits the key (ISL's `>=`, byte-identical).
 * ⛔ Only beside a finite `goal_threshold` on the goal node: ISL answers 422 to strict without a threshold. (PLoT, the
 * last hop, forwards the flag only beside the threshold it forwards.)
 */
export function resolveGoalThresholdStrict(graph: unknown, goalNodeId: unknown): boolean {
  if (typeof goalNodeId !== 'string' || goalNodeId === '') return false;
  const node = readNodes(graph).find((n) => n.id === goalNodeId);
  const threshold = node?.goal_threshold;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) return false;
  const held = readHeldGoalComparator(graph, goalNodeId);
  // ⭐ D3 step 1 (Science #87 6005138341 (4)): a held STRICT ceiling ("below 400") on a run that minimises is scored
  // strictly too — ISL counts a draw AT the threshold as met unless `goal_threshold_strict` (ISL #209, either direction).
  if (held === '<') return resolveGoalDirection(graph, goalNodeId)?.direction === 'minimise';
  return heldStrictFloorIsScoredStrictly(held, readGoalLabel(graph, goalNodeId));
}

/** The label classifier alone: `'minimise'` when the goal label attests a REDUCE aim, otherwise `undefined`. */
function directionFromGoalLabel(
  graph: unknown,
  goalNodeId: unknown,
): EmittedGoalDirection | undefined {
  const label = readGoalLabel(graph, goalNodeId);
  if (label === null) return undefined;
  return directionFromLabelText(label);
}

/** The label classifier on the label's own text — `directionFromGoalLabel` and `heldStrictFloorIsScoredStrictly` share it. */
function directionFromLabelText(label: string): EmittedGoalDirection | undefined {
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
