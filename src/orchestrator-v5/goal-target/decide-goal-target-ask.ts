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
import { randomUUID } from 'node:crypto';
import type { GoalTargetCandidate } from '../../cee/factor-extraction/goal-label-target.js';
import {
  PENDING_ACTION_DEFAULT_TURN_TTL,
  PENDING_ACTION_DEFAULT_WALL_TTL_MS,
  type PendingAction,
} from '../session/pending-action.js';

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
 * ⛔⛔ THE FIGURE IS NEVER QUOTED. NO VALUE OF `binding` LICENSES IT.
 *
 * I first wrote `binding === 'governed'` as the licence, reading the producer's
 * docstring ("how well the user's own words bind the figure"). **That reading was
 * wrong and the producer's own corpus proves it:** its S20 case pins
 * `"We rejected the proposal to reach £64k MRR."` as **`governed`** — because
 * `governed` means *the round-5 governor would have minted this*, NOT *the user
 * established this as their target*. **The rejected proposal is the canonical
 * member of that class.** So a consumer quoting on `governed` quotes back the one
 * figure the brief explicitly refused — exactly what Codex's ruling forbids.
 *
 * ⭐ Caught by Codex against the REAL producer output after my own hostile-case
 * test passed — because that test FABRICATED `present_unbound` for the £64k brief
 * rather than composing from what the producer actually returns. A fixture I wrote
 * myself was not evidence about the producer.
 */
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
export function composeGoalTargetQuestion(_candidate: GoalTargetCandidate): string {
  return 'What target should this goal be scored against? Reply with an amount.';
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

/**
 * ⭐ BUILD THE PENDING, OR NULL. The draft-turn twin of the turn executor's
 * swap-route arming, using the SAME `chip_id` so a re-ask SUPERSEDES its
 * predecessor by key rather than accumulating a row per turn.
 *
 * ⚠ `graphNodes` IS THE GRAPH BEING COMMITTED, and on this path that is the
 * graph the next turn will load — `graphHash` is computed from it, so the
 * precondition is verifiable. This is deliberately a DIFFERENT question from
 * the producer's first-writer-wins check: the producer reads the graph at
 * ENRICH time, before repair and projection; this reads what is actually
 * persisted. They can differ, and the one that binds the resume is this one.
 *
 * Returns `null` — never a partial pending — when no question is warranted, so
 * the caller's `pending_actions` array stays absent rather than empty.
 */
export function buildGoalTargetAskPending(input: {
  readonly candidate: GoalTargetCandidate | undefined;
  readonly graphNodes: readonly PersistedGoalView[];
  readonly scenarioId: string;
  readonly graphHash: string;
  readonly emittedAtIso: string;
}): PendingAction | null {
  const decision = decideGoalTargetAsk(input.candidate, input.graphNodes);
  if (!decision.ask) return null;
  return {
    id: randomUUID(),
    scenario_id: input.scenarioId,
    // Server-only pending (no rendered chip), matching the executor's route.
    chip_id: 'chip_elicit_goal_target',
    action: {
      kind: 'elicit_goal_target',
      goal_node_id: decision.goal_node_id,
      question: decision.question,
      ...(decision.unit !== undefined ? { unit: decision.unit } : {}),
    },
    preconditions: { graph_hash: input.graphHash },
    expires_at_turn_count: PENDING_ACTION_DEFAULT_TURN_TTL,
    expires_at_iso: new Date(
      Date.parse(input.emittedAtIso) + PENDING_ACTION_DEFAULT_WALL_TTL_MS,
    ).toISOString(),
    emitted_at_iso: input.emittedAtIso,
  } as PendingAction;
}
