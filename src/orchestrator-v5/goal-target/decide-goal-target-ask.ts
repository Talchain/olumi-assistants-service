/**
 * ⭐⭐ THE CONSUMER SEAM FOR `goal_target_candidate` — decides whether to ASK,
 * and composes the sentence. It NEVER writes and never proposes a value.
 *
 * ⛔ CODEX'S RULING IS THE SPEC, NOT A GUIDELINE (#1328, 14 Sep 2026):
 * "`binding: governed` is a legacy parser result, NOT evidence of adoption — no
 * consumer may mint, preselect or assert a stated target from it; a neutral
 * amount question must not present a rejected or unrelated amount as the user's
 * choice."
 *
 * So this module does exactly three things and refuses the fourth:
 *   1. decides whether a question is warranted at all,
 *   2. binds it to a goal that exists in the PERSISTED graph,
 *   3. composes a sentence that asks for an AMOUNT,
 *   4. it does NOT preselect, default, or pre-fill a value — ever.
 *
 * ⚠ WHY THE AMOUNT CONTRACT AND NOT A YES/NO CONFIRMATION. `elicit_goal_target`
 * carries `goal_node_id`, `question` and `unit?` — and NO VALUE FIELD. The value
 * written comes from parsing the USER'S ANSWER at resume (`add_constraint`
 * `at_least` -> `isSuccessTargetTurn` -> `stampGoalThreshold`, the one canonical
 * path). A wrong candidate therefore CANNOT be written by a careless "yes": the
 * user supplies the number or nothing happens. That safety is structural, which
 * is why this route was chosen over a candidate-bound proposal + bare "yes".
 * Measured case it defends: "We rejected the proposal to reach £64k MRR." mints
 * 64000 in the legacy parser.
 */
import type { GoalTargetCandidate } from '../../cee/factor-extraction/goal-label-target.js';

/** Why no question is put. Every arm is a REFUSAL, never a silent no-op. */
export type GoalTargetAskRefusal =
  /** Nothing arrived from the producer: the brief states no figure the label names. */
  | 'no_candidate'
  /**
   * The candidate names a goal the PERSISTED graph does not carry. The producer
   * reads the DRAFT graph; the resume binds against the graph the next turn
   * loads. Binding to a goal that is about to be discarded fails the answer
   * turn's divergence gate every time — the same reason the existing swap route
   * arms against the persisted graph and never the withheld commit graph.
   */
  | 'goal_absent_from_persisted_graph'
  /**
   * The persisted goal already carries a registered target. The producer
   * already excludes this against the DRAFT graph; this is the SAME QUESTION
   * ASKED OF A DIFFERENT GRAPH, not a duplicated authority — the two can differ
   * on a turn that withholds its write.
   */
  | 'target_already_registered';

export type GoalTargetAskDecision =
  | { readonly ask: false; readonly refusal: GoalTargetAskRefusal }
  | {
      readonly ask: true;
      readonly goal_node_id: string;
      readonly question: string;
      readonly unit?: string;
    };

/**
 * ⛔ THE FIGURE IS QUOTED ONLY WHEN THE PARSER FOUND A TARGET CONSTRUCTION
 * GOVERNING IT. Every `present_unbound` reason means, by its own definition,
 * that the figure was NOT stated as this goal's target — it is a current level,
 * a price, a past achievement, a change amount, a competitor's number, a
 * negation, a hypothetical, or a different metric. Quoting any of those invites
 * the user to adopt a number the brief did not offer, which is precisely what
 * Codex's ruling forbids.
 *
 * ⭐ FAIL-CLOSED BY CONSTRUCTION: this is a single positive predicate on
 * `binding`, not an allowlist of reasons. A new refusal reason added upstream is
 * silently UNQUOTED rather than silently quoted — the safe direction — so this
 * cannot rot into a short list (CLAUDE.md trap 12d).
 */
const QUOTES_THE_FIGURE = (c: GoalTargetCandidate): boolean => c.binding === 'governed';

/**
 * `count` is what the producer emits for a BARE figure, so it is NOT a
 * user-established unit and must not be carried. The pending action's own field
 * says the unit is "already established, when one was. Never guessed."
 */
const isUserEstablishedUnit = (unit: string | undefined): unit is string =>
  typeof unit === 'string' && unit.length > 0 && unit !== 'count';

/** Minimal persisted-graph shape this module reads. Nothing else is touched. */
interface PersistedGoalView {
  readonly id: string;
  readonly kind?: string;
  readonly goal_threshold?: unknown;
  readonly goal_threshold_raw?: unknown;
}

const hasRegisteredTarget = (goal: PersistedGoalView): boolean => {
  if (typeof goal.goal_threshold === 'number' && Number.isFinite(goal.goal_threshold)) return true;
  const raw = goal.goal_threshold_raw;
  return typeof raw === 'number' && Number.isFinite(raw);
};

/**
 * Compose the sentence. **No proposed value in the ask itself, ever** — the
 * request is always for an amount, and the figure (when quoted at all) appears
 * only as a separate statement of fact about the brief.
 *
 * ⚠ "mentions" is load-bearing and survives the hostile cases: it stays TRUE of
 * a brief that rejects the figure, where "Is £64k your target?" would be a lie.
 */
export function composeGoalTargetQuestion(candidate: GoalTargetCandidate): string {
  const ask = 'What target should this goal be scored against? Reply with an amount.';
  if (!QUOTES_THE_FIGURE(candidate)) return ask;
  return `Your brief mentions ${candidate.brief_span.trim()} — ${ask}`;
}

export function decideGoalTargetAsk(
  candidate: GoalTargetCandidate | undefined,
  persistedGoals: readonly PersistedGoalView[],
): GoalTargetAskDecision {
  if (candidate === undefined) return { ask: false, refusal: 'no_candidate' };

  const goal = persistedGoals.find((n) => n.id === candidate.goal_node_id);
  if (goal === undefined) return { ask: false, refusal: 'goal_absent_from_persisted_graph' };
  if (hasRegisteredTarget(goal)) return { ask: false, refusal: 'target_already_registered' };

  return {
    ask: true,
    goal_node_id: goal.id,
    question: composeGoalTargetQuestion(candidate),
    ...(isUserEstablishedUnit(candidate.unit) ? { unit: candidate.unit } : {}),
  };
}
