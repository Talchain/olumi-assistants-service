/**
 * ⭐⭐ THE PIPELINE INVENTED THE GOAL, THEN REJECTED THE DRAFT FOR NOT REACHING IT.
 *
 * ── THE MECHANISM, MEASURED ────────────────────────────────────────────────
 * When a brief designates no objective, `ensureGoalNode` mints a goal node
 * carrying `DEFAULT_GOAL_LABEL` — *"Achieve the best outcome for this
 * decision"* (`cee/structure/goal-inference.ts:87`). It is CEE-authored prose
 * with no content: it names no metric, no direction and no horizon. The
 * post-enforcement validator then requires every non-decision node to reach the
 * goal (`NO_PATH_TO_GOAL`, `graph-validator.ts:698-713`) and every option to
 * own a controllable factor that reaches it (`NO_EFFECT_PATH`, `:947-965`).
 *
 * So the pipeline mints a goal nothing can meaningfully connect to, and then
 * fails the whole draft for failing to connect to it.
 *
 * Measured against the served build `2212ae0`, n=40, zero excluded attempts:
 *
 *   short brief ("Should we increase the Pro plan price from £49 to £59?")
 *     15 attempts, 11 failures (73%)
 *   the same brief plus ONE sentence naming the outcome
 *     10 attempts,  0 failures
 *
 * Fisher two-sided p = 5.45e-04, at the SAME graph-size band (9-13 nodes both
 * ways) — so size is held constant and naming the outcome flips the result.
 * Across all 11 captured failures the blocking set is exactly
 * `{NO_PATH_TO_GOAL, NO_EFFECT_PATH}` and nothing else.
 *
 * ── WHAT THIS MODULE IS, AND WHAT IT DELIBERATELY IS NOT ───────────────────
 * It answers ONE question: *"is this block the pipeline's own doing?"* It does
 * NOT decide what to do about it. Two consumers ask it, for two different
 * purposes, and neither restates the predicate (trap 12 — derive, don't mirror):
 *
 *   `graph-enforcement.ts`  → stamp `goal_never_stated` on the block body
 *   `draft-auto-retry.ts`   → do not fund a re-draft that cannot possibly help
 *
 * ⛔⛔ IT IS NOT A DEMOTE, AND A DEMOTE IS THE WRONG FIX — DERIVED, NOT ASSUMED.
 * The obvious repair is to demote these two codes to the projector's existing
 * `detail_not_connected` disposition (`model-building-notices.ts:108-114`),
 * which drops an unconnected record and discloses the drop. That disposition is
 * correct for what it covers and MUST NOT be widened to here:
 *
 *   · Pass 3b already applies it, and applies it ONLY to `factor` and
 *     `constraint` (`projector.ts:3134-3136`). Its own doctrine says why an
 *     option is excluded, in terms: *"an option the user named must appear even
 *     if the model failed to connect it; dropping options also trips
 *     `INSUFFICIENT_OPTIONS` and silently narrows the user's own choice set,
 *     which is the one thing a decision tool may never do."*
 *   · `NO_EFFECT_PATH` is raised PER OPTION. So the material a demote would
 *     drop here is exactly the material pass 3b refuses to drop.
 *   · And the captured evidence says the same thing from the other side: in the
 *     four SHORT-brief drafts that SUCCEEDED, `detail_not_connected` fires
 *     **zero** times (the rich-brief arm fires it 4-11 times per draft). A short
 *     brief states almost no detail, so there is no detail to strand — whatever
 *     is orphaned on a failing short brief is STRUCTURE, not detail. A demote
 *     would drop an alternative out of the comparison and call the result a
 *     finished model.
 *
 * So the fence stops the pipeline PUNISHING the user for its own placeholder.
 * It does not drop, it does not invent an edge, and it does not ship a gutted
 * model. The consumer that acts on it asks the user the question whose absence
 * caused the failure.
 *
 * ── THE PREDICATE IS WRITTEN AGAINST THE SPEC, NOT AGAINST THE SYMPTOM ──────
 * The spec is *"the goal is one WE invented and it carries no objective, and the
 * ONLY thing wrong with this graph is reaching it."* Both conjuncts are
 * necessary and both fail CLOSED — anything unrecognised leaves today's block
 * exactly as it is.
 */

import type { GraphT, NodeT } from "../../../../schemas/graph.js";
import type { ValidationErrorCode } from "../../../../validators/graph-validator.types.js";
import { DEFAULT_GOAL_LABEL } from "../../../structure/goal-inference.js";

/**
 * The blocking codes that mean "this does not reach the goal" and nothing else.
 *
 * `satisfies ValidationErrorCode` is the guard, and it is the same device
 * `graph-enforcement.ts` uses for `OPTION_NO_OP_VALIDATION_CODE`: if the
 * validator renames or drops either code, this fails TYPECHECK rather than
 * silently ceasing to match.
 *
 * ⚠ THIS SET IS A CLOSED LIST ON PURPOSE, and that is the opposite of the
 * block signature one file over. `isEnforcementBlockedResult` is deliberately
 * CODE-BLIND because it answers *"should the server re-draft this?"* for
 * present and future codes alike. This answers *"is the goal the only thing
 * unreachable?"*, which is a claim ABOUT SPECIFIC CODES and cannot be
 * code-blind without asserting something it has not checked. Two questions,
 * named apart rather than reconciled (trap 21).
 */
export const GOAL_CONNECTIVITY_CODES: ReadonlySet<string> = new Set<string>([
  "NO_PATH_TO_GOAL" satisfies ValidationErrorCode,
  "NO_EFFECT_PATH" satisfies ValidationErrorCode,
]);

/**
 * Read a node's user verbatim, wherever it sits.
 *
 * `RecordProvenance.source_quote` is documented "Present iff `stated`"
 * (`projector.ts:251`), i.e. it is exactly the marker for "the user's own words
 * are behind this". The V3 projection lifts it to the node's top level, and
 * `Node` is `.passthrough()`, so at this stage it can legitimately appear in
 * either place. Both are read because missing one would fail OPEN — the
 * dangerous direction here.
 */
function userVerbatimOf(node: NodeT): string | undefined {
  const top = (node as { source_quote?: unknown }).source_quote;
  if (typeof top === "string" && top.trim().length > 0) return top;
  const prov = (node as { provenance?: unknown }).provenance;
  if (prov !== null && typeof prov === "object" && !Array.isArray(prov)) {
    const nested = (prov as { source_quote?: unknown }).source_quote;
    if (typeof nested === "string" && nested.trim().length > 0) return nested;
  }
  return undefined;
}

/**
 * Is this graph's goal the contentless placeholder CEE mints for itself?
 *
 * TWO conjuncts, and the second is not redundant:
 *
 *  1. The label IS `DEFAULT_GOAL_LABEL` — bound by IDENTITY to the producer's
 *     exported constant, never by a copied string (trap 19), so a reword at the
 *     producer moves this predicate with it.
 *
 *  2. The node carries NO user verbatim. `MINTED_GOAL_PROVENANCE` badges BOTH
 *     limbs of `ensureGoalNode` identically (`goal-inference.ts:47-51`) — the
 *     regex-derived label AND the pure placeholder — so provenance CANNOT tell
 *     them apart and this predicate does not ask it to. What separates "we
 *     invented this" from "the user's words are behind this" is the verbatim.
 *     It also covers the case the label check alone would get wrong: a user who
 *     literally writes this sentence has STATED it, and their draft must keep
 *     failing loudly rather than being quietly re-routed.
 *
 * A graph with no goal, or with more than one, returns false: `MISSING_GOAL`
 * owns the first and a multi-goal graph is not the shape this was measured on.
 */
export function hasContentlessMintedGoal(graph: GraphT | undefined): boolean {
  const nodes = (graph as { nodes?: unknown } | undefined)?.nodes;
  if (!Array.isArray(nodes)) return false;
  const goals = (nodes as NodeT[]).filter((n) => n?.kind === "goal");
  if (goals.length !== 1) return false;
  const goal = goals[0]!;
  if (goal.label !== DEFAULT_GOAL_LABEL) return false;
  return userVerbatimOf(goal) === undefined;
}

/**
 * Is this post-enforcement block the pipeline's own doing?
 *
 * TRUE iff the goal is CEE's contentless placeholder AND every blocking code is
 * a goal-connectivity code.
 *
 * ⚠ EMPTY CODES RETURN FALSE. An empty array means "nothing told us what
 * blocked", and `every()` over an empty array is vacuously true — which would
 * fence a block we know nothing about. That is the one input where the
 * convenient answer and the safe answer differ, so it is named and tested
 * rather than left to `every`'s default.
 *
 * ⚠ AND THE SECOND CONJUNCT IS `every`, NOT `some`, WHICH IS THE WHOLE FENCE.
 * `some` would fence a graph that ALSO failed `MISSING_DECISION` or
 * `CYCLE_DETECTED` — real defects this says nothing about — and would route a
 * genuinely broken draft into a question about the user's goal. The block must
 * stand whenever anything other than goal-reachability is wrong.
 */
export function isSelfInflictedGoalGap(
  graph: GraphT | undefined,
  blockingCodes: readonly string[],
): boolean {
  if (blockingCodes.length === 0) return false;
  if (!blockingCodes.every((code) => GOAL_CONNECTIVITY_CODES.has(code))) return false;
  return hasContentlessMintedGoal(graph);
}
