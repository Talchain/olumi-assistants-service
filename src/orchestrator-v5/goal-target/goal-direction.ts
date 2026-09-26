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
 * ## THE STAMP (#1971), AND WHEN IT IS SET ASIDE
 *
 * The label derivation above still emits `minimise` and nothing else. A goal the
 * USER stated carries a construction-time stamp (`NodeV3.goal_direction`), which
 * `resolveRequestGoalDirection` sends in either sense — but only while neither the
 * goal's label nor a current `goal_constraints` row on the goal says otherwise.
 * When one does, the label derivation runs exactly as it did before the stamp
 * existed, so the stamp can never send a sense base would not have sent.
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
 * `'minimise'` when this goal LABEL attests a REDUCE aim, otherwise `undefined`.
 *
 * The one label reading, shared by the forwarder below and by construction's stamp
 * site (`admit-model.ts` `attestedGoalDirection`), so the two can never disagree
 * about which way a label points.
 */
export function deriveGoalDirectionFromLabel(label: string | null): EmittedGoalDirection | undefined {
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
  return intent.direction === 'decrease' ? 'minimise' : undefined;
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

function senseOfOperator(operator: string): StampedGoalDirection | undefined {
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
  /** The goal label's reading (`deriveEmittedGoalDirection`), whether or not it was sent. */
  readonly label_derived: EmittedGoalDirection | undefined;
  /** Set aside: the goal's own label reads the other way from the stamp. */
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
 * ⛔ THE STAMP IS SET ASIDE, AND SOURCE 2 RUNS EXACTLY AS BASE DID, WHEN (review
 * 5844286953):
 *  · the label reads the other way. The label classifier emits only `minimise`, so
 *    this is always a stamped `maximise` on a goal whose words say REDUCE — the
 *    "reduce/cut X by at least N" read as `>=` fingerprint (ROADMAP 1.52). Sending
 *    that `maximise` would invert the ranking AND remove ISL's
 *    `GOAL_DIRECTION_UNATTESTED` disclosure, with only a log line to show for it;
 *  · a CURRENT `goal_constraints` row on the goal states the other sense (NB2): the
 *    stamp is a construction-time copy, and a later success-target edit rewrites the
 *    threshold and writes its own operator without touching it.
 * Setting aside can therefore never send a sense base would not have sent.
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
  const labelDerived = deriveEmittedGoalDirection(args.graph, args.goalNodeId);

  const labelDisagrees = stamped !== undefined && labelDerived !== undefined && labelDerived !== stamped;
  const disagreeingRows = stamped === undefined
    ? []
    : goalRowOperators(args.goalConstraints, args.goalNodeId).filter((op) => senseOfOperator(op) !== stamped);

  if (stamped !== undefined && !labelDisagrees && disagreeingRows.length === 0) {
    return {
      goal_direction: stamped, provenance: 'attested_from_goal_operator', stamped, label_derived: labelDerived,
      label_disagrees: false, disagreeing_goal_row_operators: [],
    };
  }
  return {
    goal_direction: labelDerived,
    provenance: labelDerived !== undefined ? 'derived_from_goal_label' : undefined,
    stamped,
    label_derived: labelDerived,
    label_disagrees: labelDisagrees,
    disagreeing_goal_row_operators: disagreeingRows,
  };
}
