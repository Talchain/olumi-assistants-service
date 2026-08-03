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
 * Overnight review F10 — the withheld-write turn's swap path leaves any
 * PREVIOUSLY-registered target intact (the append RPC skips the graph
 * UPDATE on a null graph), so a bare "the model still has no target" is
 * false whenever a persisted target survives the failed re-registration:
 * the analysis WILL still score against the old target, just not the new
 * value the user asked for.
 *
 * Branches on whether the pre-turn PERSISTED graph (the frame base the
 * swap is decided against, NOT the withheld commit graph) already
 * registers a target: names the surviving target when one exists, falls
 * back to the generic `GOAL_TARGET_NOT_SAVED_TEXT` otherwise. Tolerant
 * reader: any non-graph shape → the generic fallback (never throws).
 */
export function formatGoalTargetNotSavedText(persistedGraph: unknown): string {
  const surviving = extractPersistedGoalTarget(persistedGraph);
  if (surviving === null) return GOAL_TARGET_NOT_SAVED_TEXT;
  const valueText =
    surviving.unit !== undefined ? `${surviving.value}${surviving.unit}` : `${surviving.value}`;
  return (
    `I couldn't apply that change — your previous target of ${valueText} is ` +
    'still registered and the analysis will score against it. Restate the ' +
    'new target in one message, including the value and the goal it ' +
    'applies to — for example: "set a success target of 15%".'
  );
}

/**
 * Extract the surviving persisted goal target (raw value + optional unit)
 * from a goal-kind node carrying a finite `goal_threshold_raw` — the same
 * registration marker `graphRegistersGoalTarget` checks. Returns null for
 * any non-graph shape or a graph that does not register a target (never
 * throws).
 */
function extractPersistedGoalTarget(
  graph: unknown,
): { readonly value: number; readonly unit?: string } | null {
  if (graph === null || graph === undefined || typeof graph !== 'object') {
    return null;
  }
  const nodes = (graph as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes)) return null;
  for (const n of nodes) {
    if (n === null || typeof n !== 'object') continue;
    const node = n as Record<string, unknown>;
    if (
      node.kind === 'goal' &&
      typeof node.goal_threshold_raw === 'number' &&
      Number.isFinite(node.goal_threshold_raw)
    ) {
      return {
        value: node.goal_threshold_raw,
        ...(typeof node.goal_threshold_unit === 'string'
          ? { unit: node.goal_threshold_unit }
          : {}),
      };
    }
  }
  return null;
}

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
/**
 * Verb-first perfective claims ("I've set the success target to 15%") —
 * the highest-probability paraphrase of the original leak; covered here
 * rather than left to the line-anchored generic success-claim class
 * (review hardening, 2026-07-07).
 */
const VERB_FIRST_CLAIM_RE =
  /\b(?:i(?:'ve| have)?|we(?:'ve| have)?)\s+(?:now\s+|just\s+)?(?:set|saved|registered|recorded|updated|applied|configured)\b[^.?!\n]*\bsuccess\s+target\b/i;

/**
 * L64 — the ALREADY-REGISTERED paraphrase arms (L60 diagnosis OBS 3).
 *
 * LIVE DEFECT, persisted-truth-verified (staging, guest session
 * 2026-08-03T22:28:00Z, scenario 04f53491…): a `direct_answer` turn with
 * `handler = null` replied *"The model already has that target in place:
 * growing MRR to £250,000 is set as the goal, alongside your churn ceiling
 * (below 3%) and gross margin floor (above 80%, already recorded as a
 * constraint)."* — while the persisted goal node was BARE
 * (`{"id":"goal_mrr","kind":"goal","label":"Grow MRR to £250,000",
 * "provenance":"ai_inferred"}`, no `goal_threshold_raw`) and no churn
 * constraint existed. The people scenario said the same thing another way:
 * *"The model already has the ARR growth target built in as the goal."*
 *
 * This guard was already wired at BOTH pre-commit call sites and already ran
 * on that turn (the turn-executor STEP 7 site is not handler-gated). It did
 * not FIRE because the two arms above require the literal bigram "success
 * target": the live claims say "that target" / "the ARR growth target", and
 * one uses a verb ("built in") the list did not carry. The cost of the miss
 * is not only a false sentence — the claim CANCELLED the registration the
 * user had just asked for, so the target never reached the server at all.
 *
 * Three tightly-bound arms, deliberately narrower than "any sentence with
 * the word target":
 *
 *   A. possession — "already/currently" + a POSSESSION verb + (≤4 words) +
 *      target + … + a registration marker: "the model already has that
 *      target in place", "you currently have a target registered".
 *   B. copula, marker ADJACENT to the noun — target + copula +
 *      (already/currently)? + registration marker: "your revenue target is
 *      already registered". The adjacency is what keeps this arm off
 *      "The target is the goal node; I've already set Price sensitivity to
 *      0.75." — a free-floating marker later in the sentence cannot bind.
 *   C. registration verb applied DIRECTLY to the target — "already/currently"
 *      + a REGISTRATION verb + (≤4 words) + target: "we already recorded
 *      that target".
 *
 * The `already|currently` requirement on arms A and C is load-bearing: it is
 * what distinguishes a STATE claim about the persisted model from an ordinary
 * mutation receipt. Without it, "Updated the target factor: Price sensitivity
 * is set to 0.75." becomes a registration claim, and a truthful
 * set_factor_value receipt would be swapped AND its graph write withheld —
 * the guard's swap semantics make a false positive expensive, so recall is
 * bought only where the shape is unambiguous.
 *
 * `NON_GOAL_TARGET_NOUN` screens the "target <graph-object>" compounds
 * ("target factor/node/option/value") in every arm: those name a mutation
 * target, not a success target.
 *
 * Residual, documented rather than pre-widened (no live instance): a marker
 * that precedes the noun with no possession verb ("it's already in place as
 * your target"), and a factor whose LABEL contains the word "target". Both
 * would need the entity-resolution altitude this pure detector deliberately
 * does not have.
 */
const NON_GOAL_TARGET_NOUN =
  '(?!\\s+(?:factor|node|option|outcome|risk|edge|variable|value|field|column|id)\\b)';
const REGISTRATION_MARKER =
  '(?:in\\s+place|set|saved|registered|recorded|captured|built\\s+in|locked\\s+in)';
/** A. "already/currently <has|have|…> [≤4 words] target … <marker>". */
const ALREADY_POSSESSES_TARGET_RE = new RegExp(
  `\\b(?:already|currently)\\s+(?:has|have|had|got|carries|contains|includes|holds)\\b` +
    `(?:\\s+[\\w'’£$€%,.-]+){0,4}?\\s+targets?\\b${NON_GOAL_TARGET_NOUN}` +
    `[^.?!\\n]*\\b${REGISTRATION_MARKER}\\b`,
  'i',
);
/** B. "target <is|are|was|…> [already|currently] <marker>" — marker adjacent. */
const TARGET_COPULA_REGISTERED_RE = new RegExp(
  `\\btargets?\\b${NON_GOAL_TARGET_NOUN}\\s+(?:is|are|was|were|has\\s+been|have\\s+been)\\s+` +
    `(?:already\\s+|currently\\s+)?${REGISTRATION_MARKER}\\b`,
  'i',
);
/** C. "already/currently <set|recorded|…> [≤4 words] target". */
const ALREADY_REGISTERED_TARGET_RE = new RegExp(
  `\\b(?:already|currently)\\s+(?:set|saved|registered|recorded|captured|configured|added|applied)\\b` +
    `(?:\\s+[\\w'’£$€%,.-]+){0,4}?\\s+targets?\\b${NON_GOAL_TARGET_NOUN}`,
  'i',
);
/**
 * Negation/conditional screen (sentence-scoped): honest statements that a
 * target is NOT set, or forward-looking/conditional coaching ("once a
 * success target is set…"), are not registration claims — swapping them
 * would itself be an honesty failure.
 */
const NEGATION_CONDITIONAL_RE =
  /\b(?:no|not|never|none|isn't|hasn't|haven't|wasn't|won't|can't|cannot|couldn't|yet\s+to|still\s+needs?|once|until|unless)\b/i;

/** Split into sentences; newline is always a boundary. */
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function claimsGoalTargetRegistration(
  text: string | null | undefined,
): boolean {
  if (typeof text !== 'string' || text.trim().length === 0) return false;
  // Sentence-scoped (review hardening): the OLD whole-text question screen
  // let ANY later '?' rescue a genuine claim ("…set on the goal — shall I
  // rerun?"), and negations/conditionals in other sentences leaked in. A
  // sentence is a claim iff it matches a claim shape, is not itself a
  // question, and carries no negation/conditional marker.
  for (const sentence of sentencesOf(text)) {
    if (sentence.endsWith('?')) continue;
    if (NEGATION_CONDITIONAL_RE.test(sentence)) continue;
    if (
      GOAL_TARGET_CLAIM_RE.test(sentence) ||
      VERB_FIRST_CLAIM_RE.test(sentence) ||
      // L64 — the ALREADY-REGISTERED paraphrase class (L60 OBS 3).
      ALREADY_POSSESSES_TARGET_RE.test(sentence) ||
      TARGET_COPULA_REGISTERED_RE.test(sentence) ||
      ALREADY_REGISTERED_TARGET_RE.test(sentence)
    ) {
      return true;
    }
  }
  return false;
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
