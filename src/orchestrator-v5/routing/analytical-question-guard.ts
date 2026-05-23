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
 * grammar must be imported, never re-stated). The classifier already
 * catches `what would change the outcome` / `what would flip` /
 * `what would tip` / `what would need to change` / `how could option
 * X win`. This guard adds the narrow remaining cousins:
 *   - `what could change` (modal cousin of `what would change`)
 *   - `what (might|could|would) (shift|move|alter|affect|tip) the
 *     outcome / result / ranking / ...`
 *   - `how (could|might|can|would) the outcome (change|shift|move|...)`
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

import { classifyAnalyticalIntent } from './analytical-intent.js';

/**
 * Canonical analytical-outcome nouns. Narrow alternation: a phrase
 * like "what could change *my Pricing assumption*" deliberately does
 * NOT match because the object is a user-named factor, not one of
 * these system-level outcome words. Concrete edits stay on the edit
 * path; only outcome-level analytical questions are suppressed.
 */
const ANALYTICAL_OUTCOME_NOUNS = String.raw`(?:result|results|outcome|outcomes|leading\s+option|analysis|ranking|order|balance|things|verdict|winner|winners)`;

/**
 * Patterns specific to this guard — analytical-question shapes that
 * `classifyAnalyticalIntent` does NOT yet match. Keep narrow:
 * outcome-noun anchored on the right side, modal/interrogative
 * anchored on the left side. False positives here would block
 * legitimate edits, so when in doubt the pattern should NOT match.
 */
const ADDITIONAL_ANALYTICAL_QUESTION_PATTERNS: readonly RegExp[] = [
  // "What could change the outcome / result / ranking / ..."
  new RegExp(
    String.raw`\bwhat\s+could\s+change\s+(?:the\s+)?${ANALYTICAL_OUTCOME_NOUNS}\b`,
    'i',
  ),
  // "What (might|could|would) (shift|move|alter|affect|tip|change) (the )? outcome|result|..."
  // (we include `change` here on the modal axis — the classifier only
  // has `what would change`, so `what might change` / `what could
  // change` slip through without this entry.)
  new RegExp(
    String.raw`\bwhat\s+(?:might|could|would)\s+(?:shift|move|alter|affect|tip|change)\s+(?:the\s+)?${ANALYTICAL_OUTCOME_NOUNS}\b`,
    'i',
  ),
  // "How (could|might|can|would) the outcome (change|shift|move|flip|differ)"
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
  return false;
}
