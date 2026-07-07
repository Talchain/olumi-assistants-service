/**
 * Lane 20 — goal-target receipt honesty guard (STEP 6.6-class discipline
 * for success-target claims).
 *
 * Live defect (staging build 7ae388b5, scenario 55df6984…, turn fac8dc19…,
 * 2026-07-07T13:50:29Z): the turn "Set a success target of a 15% cost
 * reduction on the goal Reduce Operating Costs" dispatched to the edit_graph
 * pipeline (route-v2 edit-verb intercept), whose LLM stamped
 * `{value, type, description}` onto the goal node — NOT the canonical
 * goal-threshold contract (`goal_threshold_raw` / `_unit` / `_cap` /
 * `goal_threshold`). The graph write succeeded, but `has_goal_target`
 * derives EXCLUSIVELY from `goal_threshold_raw`/`_unit` on the goal node
 * (decision-context.ts via goal_translation.user_scale_target), the UI goal
 * chip and PLoT's explicit-threshold path read the same fields, and none
 * were written — yet the wire shipped "Success target of 15% cost reduction
 * set on the Reduce Operating Costs goal. Rerun the simulation to evaluate
 * which options meet this threshold." A rerun would NOT have evaluated
 * options against any threshold. False registration claim = structural
 * honesty P0.
 *
 * Invariant enforced by this module's callers (edit-graph-dispatch pre-commit
 * and turn-executor STEP 7 pre-commit):
 *
 *   Assistant text claiming a success-target registration may ship ONLY when
 *   a graph that REGISTERS the target (a goal-kind node carrying a finite
 *   `goal_threshold_raw`) backs the claim — either the graph being committed
 *   this turn, or (for non-mutating turns describing existing state) the
 *   already-persisted graph. Otherwise the text is swapped for the honest
 *   fallback BEFORE commit, so the stored `assistant_message` equals the
 *   honest wire copy (no post-commit divergence).
 *
 * Registration marker deliberately = `goal_threshold_raw` alone:
 * `build-turn-context.ts` derives `has_goal_target` from
 * `goal_translation.user_scale_target`, which `decision-context.ts` reads
 * ONLY from `goal_threshold_raw` (+ `_unit` for display). A graph carrying
 * only the normalised `goal_threshold` without `_raw` does not register a
 * target for the conversational surface, so it must not license the claim.
 *
 * All user-facing wording in this file: provisional_doctrine_v0. The
 * fallback copy is swept against findForbiddenPhraseHit / findSuccessClaimHit
 * in goal-target-receipt-guard tests; the embedded example phrasing is
 * mid-sentence (never line-leading) so the line-anchored success-claim
 * pattern `^Set …` cannot fire on it.
 */

/**
 * Honest fallback shipped instead of a false registration receipt.
 * The example phrasing routes to the sanctioned add_constraint path on the
 * next turn (value-update-gate goal-target subpattern), closing the loop the
 * failed turn opened. provisional_doctrine_v0.
 */
export const GOAL_TARGET_NOT_SAVED_TEXT =
  "I couldn't register that success target, so the model still has no " +
  'target for the analysis to score against. Tell me it again in one ' +
  'message, including the value and the goal it applies to — for example: ' +
  '"set a success target of 15%".';

/**
 * Conservative detector for success-target registration/description claims.
 * Both live emitters are covered:
 *   - formatGoalTargetSet (add_constraint receipt): "Success target set:
 *     <Goal> at least 15%. …"
 *   - LLM-authored edit_graph ack (captured live): "Success target of 15%
 *     cost reduction set on the <Goal> goal. …"
 *
 * Shape required: the "success target" noun phrase followed — WITHIN THE
 * SAME SENTENCE — by a registration/commit verb ("…success target … set/
 * saved/registered…"). Verb-BEFORE-noun forms ("you could set a success
 * target", the fallback's own example "set a success target of 15%") are
 * deliberately NOT claims: they are offers/suggestions, and erasing honest
 * coaching copy would be its own honesty failure. Perfective verb-first
 * claims ("I've set a success target") belong to the generic success-claim
 * class (SUCCESS_CLAIM_PATTERNS) — documented residual, out of this guard's
 * narrow scope.
 *
 * Question screen: a sentence that ASKS about the target ("Should the
 * success target be set to 15%?") is an offer, not a claim.
 */
const GOAL_TARGET_CLAIM_RE =
  /\bsuccess\s+target\b[^.?!\n]*\b(?:set|saved|registered|recorded|added|updated|applied|configured|in\s+place)\b/i;
/** Offer/question screen: noun phrase inside an interrogative sentence. */
const OFFER_QUESTION_RE = /\bsuccess\s+target\b[^.!]*\?/i;

export function claimsGoalTargetRegistration(
  text: string | null | undefined,
): boolean {
  if (typeof text !== 'string' || text.trim().length === 0) return false;
  if (!GOAL_TARGET_CLAIM_RE.test(text)) return false;
  if (OFFER_QUESTION_RE.test(text)) return false;
  return true;
}

/**
 * Does this graph REGISTER a success target? True iff a goal-kind node
 * carries a finite numeric `goal_threshold_raw` — the exact field
 * `has_goal_target` / the UI goal chip / PLoT's explicit-threshold path key
 * on. Tolerant reader: any non-graph shape → false (never throws).
 */
export function graphRegistersGoalTarget(graph: unknown): boolean {
  if (graph === null || graph === undefined || typeof graph !== 'object') {
    return false;
  }
  const nodes = (graph as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes)) return false;
  return nodes.some((n) => {
    if (n === null || typeof n !== 'object') return false;
    const node = n as Record<string, unknown>;
    return (
      node.kind === 'goal' &&
      typeof node.goal_threshold_raw === 'number' &&
      Number.isFinite(node.goal_threshold_raw)
    );
  });
}

export interface GoalTargetReceiptDecision {
  readonly verdict: 'pass' | 'swap';
  /** Why the guard passed/swapped — closed enum for logs (never raw text). */
  readonly reason:
    | 'no_claim'
    | 'backed_by_commit_graph'
    | 'backed_by_persisted_graph'
    | 'unbacked_claim';
}

/**
 * Decide whether a composed assistant text may ship as-is.
 *
 * @param assistantText  The outbound composed text (pre-commit).
 * @param commitGraph    The graph being committed THIS turn (null/undefined
 *                       when the turn writes no graph).
 * @param persistedGraph The pre-turn persisted `scenarios.graph`, consulted
 *                       ONLY when no graph is written this turn — a
 *                       non-mutating turn may honestly DESCRIBE an
 *                       already-registered target. When a graph IS written
 *                       this turn, that write is the sole authority: a
 *                       mutation that fails to register the target must not
 *                       borrow honesty from stale state.
 */
export function decideGoalTargetReceipt(args: {
  readonly assistantText: string | null | undefined;
  readonly commitGraph: unknown;
  readonly persistedGraph: unknown;
}): GoalTargetReceiptDecision {
  if (!claimsGoalTargetRegistration(args.assistantText)) {
    return { verdict: 'pass', reason: 'no_claim' };
  }
  const wroteGraphThisTurn =
    args.commitGraph !== null && args.commitGraph !== undefined;
  if (wroteGraphThisTurn) {
    return graphRegistersGoalTarget(args.commitGraph)
      ? { verdict: 'pass', reason: 'backed_by_commit_graph' }
      : { verdict: 'swap', reason: 'unbacked_claim' };
  }
  return graphRegistersGoalTarget(args.persistedGraph)
    ? { verdict: 'pass', reason: 'backed_by_persisted_graph' }
    : { verdict: 'swap', reason: 'unbacked_claim' };
}
