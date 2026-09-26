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
 * ## THE STAMP (#1971), AND THE ONE RULE THAT DECIDES WHETHER IT IS ATTESTED
 *
 * The label derivation above still emits `minimise` and nothing else. A goal the
 * USER stated carries a construction-time stamp (`NodeV3.goal_direction`), which
 * `resolveRequestGoalDirection` sends in either sense — but only while it is
 * ATTESTED, and ONE rule decides that, in BOTH directions, at BOTH seams (reviews
 * 5844286953 and its mirror 5844849510):
 *
 *   A stamp is attested only when its sense does NOT CONTRADICT the goal label's
 *   own reading (`readGoalLabelSense`: a reduction-worded label reads `minimise`,
 *   an increase-worded one `maximise`, any other label reads nothing).
 *
 *  · CONSTRUCTION (`admit-model.ts` `attestedGoalDirection`) does not stamp a sense
 *    the label contradicts: "reduce churn" read as `>=`, "grow revenue" read as `<=`.
 *  · THE FORWARDER re-applies the rule to a STORED stamp against the CURRENT label
 *    (a goal renamed after construction), and also sets a stamp aside when a current
 *    `goal_constraints` row on the goal states another sense (a later success-target
 *    edit). Set aside, it sends exactly what base sent — the label's `minimise` for a
 *    reduction-worded label, nothing for any other — and warns.
 *
 * So a stamp never sends a sense the goal's own words contradict. What it adds over
 * base is bounded: the stated sense of a label that names NO direction ("Monthly
 * churn rate" `<=` → `minimise`: the case #1971 exists for), `maximise` on a label
 * that agrees (ranks as absent does; ends a disclosure that was untrue), or the same
 * `minimise` base derives from a reduction-worded label.
 */

import { deriveGoalIntent } from '../coaching/objective-contradiction.js';

/** The only sense this module will ever put on the wire. */
export type EmittedGoalDirection = 'minimise';

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
 * Which way a goal LABEL's own words point, in EITHER sense: `'minimise'` for a
 * reduction-worded label, `'maximise'` for an increase-worded one, otherwise
 * `undefined` (no direction word, both, stasis, ambiguity, negation, no subject).
 *
 * ⛔ A READING, NEVER A SENSE TO SEND. Nothing puts this value on the wire; it only
 * JUDGES a stamp (`labelContradictsSense`). What base sends from a label is
 * `deriveGoalDirectionFromLabel` below — `minimise` only, for the reasons in the header.
 *
 * The ONE label reading, shared by construction's stamp site (`admit-model.ts`
 * `attestedGoalDirection`) and the forwarder (`resolveRequestGoalDirection`), so the
 * two can never disagree about which way a label points, in either direction.
 */
export function readGoalLabelSense(label: string | null): StampedGoalDirection | undefined {
  if (label === null || label.trim() === '') return undefined;

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
  if (intent.direction === 'decrease') return 'minimise';
  if (intent.direction === 'increase') return 'maximise';
  return undefined;
}

/**
 * `'minimise'` when this goal LABEL attests a REDUCE aim, otherwise `undefined`:
 * base's label derivation, the only sense a label alone may put on the wire.
 */
export function deriveGoalDirectionFromLabel(label: string | null): EmittedGoalDirection | undefined {
  return readGoalLabelSense(label) === 'minimise' ? 'minimise' : undefined;
}

/**
 * ⭐ THE ONE RULE (header): `true` when the goal label's own reading contradicts this
 * sense. A label that reads no direction contradicts nothing, so the stated operator
 * stands there. Applied at the stamp site AND to a stored stamp at the forwarder.
 */
export function labelContradictsSense(label: string | null, sense: StampedGoalDirection): boolean {
  const labelSense = readGoalLabelSense(label);
  return labelSense !== undefined && labelSense !== sense;
}

/**
 * `'minimise'` when the goal label attests a REDUCE aim, otherwise `undefined`
 * (⇒ the caller omits the key ⇒ ISL's unattested maximiser, exactly as today).
 *
 * Never returns `'maximise'`: see the header. Never returns `'target'` — that
 * sense needs a threshold and frame ISL refuses to run without, and it is not
 * derivable from a label.
 */
export function deriveEmittedGoalDirection(
  graph: unknown,
  goalNodeId: unknown,
): EmittedGoalDirection | undefined {
  return deriveGoalDirectionFromLabel(readGoalLabel(graph, goalNodeId));
}

/** A goal node's stamped sense (`NodeV3.goal_direction`), CEE-minted at construction. */
export type StampedGoalDirection = 'maximise' | 'minimise';

/**
 * The operators of the goal's CURRENT `goal_constraints` rows, read at REQUEST time.
 *
 * A success-target edit (`add_constraint` on the goal, directly or through
 * `goal_target_edit`) writes a row with its own operator and rewrites the
 * threshold, but never touches the construction-time stamp. The rows are the
 * current statement; the stamp is a persisted copy, and a persisted copy goes stale.
 */
function goalRowOperators(goalConstraints: unknown, goalNodeId: unknown): string[] {
  if (!Array.isArray(goalConstraints) || typeof goalNodeId !== 'string' || goalNodeId === '') return [];
  const operators: string[] = [];
  for (const row of goalConstraints) {
    if (row === null || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (r.node_id !== goalNodeId) continue;
    operators.push(typeof r.operator === 'string' ? r.operator : String(r.operator));
  }
  return operators;
}

/**
 * The sense a goal comparator states: `>=`/`>` → `maximise`, `<=`/`<` → `minimise`
 * (strictness is not a sense). Shared by the stamp site and the goal-row check.
 */
export function senseOfGoalOperator(operator: unknown): StampedGoalDirection | undefined {
  if (operator === '>=' || operator === '>') return 'maximise';
  if (operator === '<=' || operator === '<') return 'minimise';
  return undefined;
}

/** What `run_analysis` sends as PLoT's request-level `goal_direction`, and why. */
export interface RequestGoalDirection {
  /** The value to send; `undefined` ⇒ omit the key (ISL's unattested maximiser, disclosed). */
  readonly goal_direction: StampedGoalDirection | undefined;
  readonly provenance: 'attested_from_goal_operator' | 'derived_from_goal_label' | undefined;
  /** The goal node's stamp, whether or not it was sent. */
  readonly stamped: StampedGoalDirection | undefined;
  /** Base's label derivation (`deriveEmittedGoalDirection`, minimise only), whether or not it was sent. */
  readonly label_derived: EmittedGoalDirection | undefined;
  /** The goal label's own reading in EITHER sense (`readGoalLabelSense`). Judges the stamp; never sent. */
  readonly label_sense: StampedGoalDirection | undefined;
  /** Set aside: the goal's CURRENT label contradicts the stamp (`labelContradictsSense`), in either direction. */
  readonly label_disagrees: boolean;
  /** Set aside: a current goal row states the other sense (or one that has none). The rows' operators. */
  readonly disagreeing_goal_row_operators: readonly string[];
}

/**
 * ROADMAP 2.920 — the request-level objective sense, from TWO sources, in order:
 *
 *  1. ATTESTED — the goal node's stamp (`NodeV3.goal_direction`), CEE-minted at
 *     construction from the operator the USER stated. Sent in BOTH senses when it
 *     stands: `maximise` ranks as absent does, but it is what the user said, and it
 *     ends ISL's "unattested" disclosure for a goal whose sense WAS stated.
 *  2. DERIVED — `deriveEmittedGoalDirection`, the label classifier, MINIMISE ONLY
 *     and unchanged, for every goal whose stamp is absent or set aside.
 *
 * ⛔ THE STAMP IS SET ASIDE, AND SOURCE 2 RUNS EXACTLY AS BASE DID, WHEN:
 *  · the goal's CURRENT label contradicts it — THE ONE RULE (header), in BOTH
 *    directions (reviews 5844286953 and 5844849510). A stamped `maximise` on a label
 *    that reads REDUCE ("reduce/cut X by at least N" read as `>=`, ROADMAP 1.52), or a
 *    stamped `minimise` on a label that reads INCREASE ("grow revenue" read as `<=`,
 *    or a `<=` goal renamed to a growth goal): either would invert the ranking AND
 *    remove ISL's `GOAL_DIRECTION_UNATTESTED` disclosure. Construction already
 *    refuses to stamp these; this re-check covers a label edited after construction;
 *  · a CURRENT `goal_constraints` row on the goal states the other sense (NB2): the
 *    stamp is a construction-time copy, and a later success-target edit rewrites the
 *    threshold and writes its own operator without touching it.
 * Set aside, the request carries base's label derivation: `minimise` for a
 * reduction-worded label, and NO key for any other (ISL's disclosure stands). So a
 * stamp is never sent where the goal's own words contradict it.
 */
export function resolveRequestGoalDirection(args: {
  readonly graph: unknown;
  readonly goalNodeId: unknown;
  readonly goalConstraints: unknown;
}): RequestGoalDirection {
  const goal = readNodes(args.graph).find(
    (n) => typeof args.goalNodeId === 'string' && n.id === args.goalNodeId && n.kind === 'goal',
  );
  const stamped: StampedGoalDirection | undefined =
    goal?.goal_direction === 'maximise' || goal?.goal_direction === 'minimise' ? goal.goal_direction : undefined;
  const label = readGoalLabel(args.graph, args.goalNodeId);
  const labelDerived = deriveGoalDirectionFromLabel(label);
  const labelSense = readGoalLabelSense(label);

  const labelDisagrees = stamped !== undefined && labelContradictsSense(label, stamped);
  const disagreeingRows = stamped === undefined
    ? []
    : goalRowOperators(args.goalConstraints, args.goalNodeId).filter((op) => senseOfGoalOperator(op) !== stamped);

  if (stamped !== undefined && !labelDisagrees && disagreeingRows.length === 0) {
    return {
      goal_direction: stamped, provenance: 'attested_from_goal_operator', stamped, label_derived: labelDerived,
      label_sense: labelSense, label_disagrees: false, disagreeing_goal_row_operators: [],
    };
  }
  return {
    goal_direction: labelDerived,
    provenance: labelDerived !== undefined ? 'derived_from_goal_label' : undefined,
    stamped,
    label_derived: labelDerived,
    label_sense: labelSense,
    label_disagrees: labelDisagrees,
    disagreeing_goal_row_operators: disagreeingRows,
  };
}
