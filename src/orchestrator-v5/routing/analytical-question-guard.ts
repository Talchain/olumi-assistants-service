/**
 * V5 edit lifecycle recovery v1 — pre-edit analytical-question guard.
 *
 * Sits in route-v2.ts BEFORE `editIntentDetected` is computed. When a
 * user-typed message is an analytical / hypothetical question about
 * the model's outcome (rather than a concrete edit instruction), this
 * guard returns `true` and the route suppresses
 * `dispatchEditGraph` — the message falls through to TurnExecutor
 * where the post-analysis advice gate / `what_would_flip` handler
 * owns the right response.
 *
 * Why this is necessary: a question like
 *   "What could change the outcome?"
 * matches `EDIT_GRAPH_POSITIVE_REGEX` via the bare verb `change`,
 * clears `EDIT_GRAPH_NEGATIVE_REGEX` (which only catches `what would`,
 * not `what could`), and `isValueUpdatePhrasing` is false (no
 * `to <X>` / `by <X>`). With nothing else gating the path, the
 * message dispatches to the V4 `edit_graph` LLM — exactly the
 * failure class this PR #194 exists to prevent.
 *
 * The fix layers ONTO `classifyAnalyticalIntent` rather than
 * duplicating its regex grammar (PR #192 round-4 lesson: shared
 * grammar must be imported, never re-stated).
 *
 * History note: rounds 1–3 of PR #200 progressively lifted what-would-
 * flip grammar into the classifier — first the existing `what would
 * change [outcome]` / `what would flip` / `what would tip` / `what
 * would need to change` set, then the `could/might` modal cousins
 * (round-2), then `would` parity for the `shift|move|alter|affect|tip`
 * verbs and the `how would [outcome] (change|...)` shape (round-3).
 * As of round-3, the first three patterns in
 * ADDITIONAL_ANALYTICAL_QUESTION_PATTERNS below are now ALSO covered by
 * the shared classifier via isAnalyticalQuestion's delegation. They are
 * kept here as harmless defence-in-depth (zero runtime cost; one less
 * place to forget if the classifier is ever narrowed in future). The
 * fourth pattern (`what should I/we VERB`) remains uniquely owned by
 * this guard because it routes to the `advice`/`update_advice` class
 * via the post-analysis advice gate, not via `classifyAnalyticalIntent`.
 *
 * Privacy / safety contract:
 *  - Pure function. No I/O, no telemetry, no side effects.
 *  - The guard NEVER inspects the graph or any persisted state — it
 *    operates on the raw user message alone. The message is the
 *    canonical authority on intent for this purpose.
 *  - Concrete edit instructions (`Change X to £100,000`, `Set Y to
 *    1`, `Add a risk for Z`, `Change X from A to B`) MUST NOT match
 *    — they don't start with what/how interrogative shapes and don't
 *    use the analytical-outcome nouns.
 *  - Chip-click traffic with `chip.action_type === 'what_would_flip'`
 *    is ALREADY handled by route-v2's deterministic chip-click
 *    branch (dispatched via `dispatchDeterministicChipClick` BEFORE
 *    `editIntentDetected` runs). This guard exists to close the
 *    free-text typed path, which the chip-click branch does not
 *    cover.
 */

import { classifyAnalyticalIntent, hasMutationSignal } from './analytical-intent.js';

/**
 * Canonical analytical-outcome nouns. Narrow alternation: a phrase
 * like "what could change *my Pricing assumption*" deliberately does
 * NOT match because the object is a user-named factor, not one of
 * these system-level outcome words. Concrete edits stay on the edit
 * path; only outcome-level analytical questions are suppressed.
 */
const ANALYTICAL_OUTCOME_NOUNS = String.raw`(?:result|results|outcome|outcomes|leading\s+option|analysis|ranking|order|balance|things|verdict|winner|winners)`;

/**
 * Patterns historically specific to this guard. As of PR #200 round-3,
 * the first three entries are now redundantly covered by
 * `classifyAnalyticalIntent` (via this guard's delegation to it on
 * line 134 below); they are retained as harmless defence-in-depth.
 * The fourth entry (`what should I/we VERB`) remains uniquely owned
 * by this guard — the post-analysis advice gate routes it via the
 * `advice`/`update_advice` class rather than via the analytical-intent
 * classifier, so the classifier delegation does not catch it here.
 *
 * Keep narrow: outcome-noun anchored on the right side,
 * modal/interrogative anchored on the left side. False positives here
 * would block legitimate edits, so when in doubt the pattern should
 * NOT match.
 */
const ADDITIONAL_ANALYTICAL_QUESTION_PATTERNS: readonly RegExp[] = [
  // "What could change the outcome / result / ranking / ..."
  // (Defence-in-depth; covered by classifier's what_would_flip class
  // since round-2.)
  new RegExp(
    String.raw`\bwhat\s+could\s+change\s+(?:the\s+)?${ANALYTICAL_OUTCOME_NOUNS}\b`,
    'i',
  ),
  // "What (might|could|would) (shift|move|alter|affect|tip|change) (the )? outcome|result|..."
  // (Defence-in-depth; covered by classifier's what_would_flip class
  // since round-3 — the `would` parity that previously lived only
  // here is now in analytical-intent.ts.)
  new RegExp(
    String.raw`\bwhat\s+(?:might|could|would)\s+(?:shift|move|alter|affect|tip|change)\s+(?:the\s+)?${ANALYTICAL_OUTCOME_NOUNS}\b`,
    'i',
  ),
  // "How (could|might|can|would) the outcome (change|shift|move|flip|differ)"
  // (Defence-in-depth; covered by classifier's what_would_flip class
  // since round-3.)
  new RegExp(
    String.raw`\bhow\s+(?:could|might|can|would)\s+(?:the\s+)?${ANALYTICAL_OUTCOME_NOUNS}\s+(?:change|shift|move|flip|differ|reverse)\b`,
    'i',
  ),
  // "What should I/we VERB" — advice-seeking question, NOT an edit
  // instruction. Without this pattern, "What should I change?" hits
  // EDIT_GRAPH_POSITIVE_REGEX (via `change`), clears the negative
  // regex (`what should` is not in it), and dispatches to edit_graph.
  //
  // PR #194 review-3 correction — the alternation now includes the
  // value-edit verbs (set / increase / decrease / raise / lower /
  // reduce / bump). The prior pattern only had structural-edit verbs,
  // so phrases like "What should I set X to?" or "What should I
  // increase Revenue by?" without a concrete value slipped through
  // (verified by direct execution: `isValueUpdatePhrasing` requires
  // a non-whitespace token after `to\s+` / `by\s+` — "to?" / "by?"
  // fail it because there's no space between the preposition and
  // the punctuation).
  //
  // Concrete value-edit clarifications WITH a value
  // ("What should I set X to 100?") are deflected upstream by
  // `isValueUpdatePhrasing`. The tighter
  // `analytical_question_suppressed` emit condition
  // (`!valueUpdate`) ensures this analytical pattern doesn't double-
  // count those cases in telemetry.
  /\bwhat\s+should\s+(?:i|we)\s+(?:change|update|edit|adjust|modify|fix|tweak|improve|simplify|do|set|increase|decrease|raise|lower|reduce|bump)\b/i,
];


/**
 * ⚠⚠ THESE TWO ARE VETOED BY `hasMutationSignal`, AND THE VETO IS THE WHOLE
 * DIFFERENCE BETWEEN THEM AND THE ARRAY ABOVE.
 *
 * Both patterns are UNANCHORED: they match wherever the phrase appears in the
 * message. Shipped without a veto that was a blanket mutation stop, and an
 * independent route-level comparison (CX-20260916-42, executed through the real
 * Fastify route) found three explicit commands newly losing the edit lane:
 *
 *   Add a factor called "Should we hire contractors?"     — inside a QUOTED NAME
 *   Add a risk for churn. Should we hire a tech lead?     — command THEN question
 *   How do you recommend we manage morale? Add a factor…  — question THEN command
 *
 * In all three the user issued a real instruction and would have watched it do
 * nothing. My own suite asserted "both directions" and still missed them,
 * because its opposite-direction half held pure edits and polite requests but
 * no message that MIXED a command with a question — the obvious adversarial
 * class, and the one a corpus written beside the fix does not think of.
 *
 * The fix is not more verb exceptions. `hasMutationSignal` is the existing
 * authority for "this message carries a concrete edit clause", and its own
 * docstring already says downstream analytical guards must not short-circuit
 * when it holds. A message that asks for advice AND issues a command is an
 * instruction; only a message that just asks is a question.
 */
const ADVICE_SEEKING_QUESTION_PATTERNS: readonly RegExp[] = [
  // "How do you recommend we add it to the decision?" — captured turn 9 of the
  // hiring session (CEE request 8a366af6, 15 Sep 2026 22:20 UTC), the
  // ASSESSMENT's top-ranked failure, and confirmed through the real route as
  // the one intended edit→coaching improvement of this change. The edit verb is
  // the OBJECT of the recommendation being sought, not an instruction to
  // perform it. Anchored on the ADVICE VERB, so "Can you add a risk for churn?"
  // never matches.
  /\bhow\s+(?:do|does|would|should|can|could)\s+(?:you|we|i)\s+(?:recommend|suggest|advise|propose)\b/i,
  // "Should I hire a Tech lead or two developers to increase productivity?" —
  // captured turns 12/13, the user's central decision question, trips the gate
  // on the real-world verb `increase`. Generalises the `what should I/we VERB`
  // entry above, whose closed verb list is what let this phrasing through.
  // "we should add the risk" is a commitment and does NOT match; only
  // "should we" / "should I" does.
  /\bshould\s+(?:i|we)\b/i,
];

/**
 * Returns `true` when the message is an analytical / hypothetical
 * question about the model's outcome (and therefore must NOT be
 * routed to `edit_graph`). Returns `false` for concrete edit
 * instructions and for any other message shape the guard does not
 * recognise.
 *
 * Implementation: delegates to the canonical
 * `classifyAnalyticalIntent` first (single source of truth for the
 * existing analytical taxonomy), then tests the narrow additions
 * specific to this guard. The order means a future addition to
 * `classifyAnalyticalIntent` automatically tightens this guard with
 * zero edits here.
 */
export function isAnalyticalQuestion(message: string): boolean {
  if (typeof message !== 'string') return false;
  const trimmed = message.trim();
  if (trimmed.length === 0) return false;
  if (classifyAnalyticalIntent(trimmed) !== null) return true;
  for (const re of ADDITIONAL_ANALYTICAL_QUESTION_PATTERNS) {
    if (re.test(trimmed)) return true;
  }
  // Checked LAST and behind the veto. A message carrying a concrete edit clause
  // is an instruction even when it also asks something — see the block above.
  if (!hasMutationSignal(trimmed)) {
    for (const re of ADVICE_SEEKING_QUESTION_PATTERNS) {
      if (re.test(trimmed)) return true;
    }
  }
  return false;
}
