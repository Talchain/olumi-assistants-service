/**
 * V5 routing — shared low-level analytical-intent predicates.
 *
 * Single source of truth for two question-shape signals used by multiple
 * deterministic guards:
 *
 *   1. Mutation-signal detection — does the user's message contain a
 *      concrete graph-edit instruction (set X to N, add a Y, remove Z,
 *      adjust strength from A to B, etc.)? If yes, no analytical guard
 *      should short-circuit — let the normal edit-graph routing run.
 *
 *   2. Analytical-intent classification — is this message asking to
 *      understand, explain, or interrogate analysis results (or asking
 *      whether the analysis is still valid)? Lower-level than the
 *      post-analysis-advice-gate's 9-class taxonomy: this returns one
 *      of four broad shapes that downstream guards (stale-rerun,
 *      no-analysis, edit_graph no-op recovery) use to decide what to
 *      do when the gate's fresh-only short-circuit does not apply.
 *
 * The existing `tryPostAnalysisAdviceGate` keeps its 9-class taxonomy
 * and its fresh-path composers untouched — it imports
 * `MUTATION_SIGNAL_PATTERNS` from this module to avoid duplication, but
 * its decision tree and per-class data-availability checks are
 * preserved. The fresh-path tests must remain unchanged.
 *
 * Privacy: this module is pure pattern-matching. It contains no
 * telemetry, no copy, no graph or analysis content. All inputs are the
 * raw user message string.
 */

/**
 * Mutation-signal patterns. Hoisted from post-analysis-advice-gate.ts
 * (PR #173 + P0 deterministic post-analysis router) so every guard
 * shares the same negative gate. Patterns are written narrowly so
 * coaching questions that happen to use a mutation verb without a
 * concrete target ("What should we update based on this?") still pass
 * through to advice paths.
 */
export const MUTATION_SIGNAL_PATTERNS: readonly RegExp[] = [
  /\b(?:set|change|update|adjust|modify|raise|lower|increase|decrease|bump)\b[^.?!\n]{0,80}\bto\s+\S+/i,
  /\b(?:set|change|update|adjust|modify|raise|lower|increase|decrease|bump)\b[^.?!\n]{0,80}\b\d+(?:\.\d+)?%?\b/i,
  /\b(?:add|insert|create)\s+(?:a|an|new|another)\s+\S+/i,
  /\b(?:remove|delete|drop)\s+(?:the|that|this|my|our)\s+\S+/i,
  /\bfrom\s+\S+\s+to\s+\S+/i,
  /^\s*(?:set|remove|delete|drop|add|create|insert)\b/im,
];

/**
 * Does the message carry a concrete graph-mutation signal? When this
 * returns true, downstream analytical guards must NOT short-circuit —
 * the message is an edit request and should reach the edit-graph
 * dispatch path.
 */
export function hasMutationSignal(message: string): boolean {
  for (const re of MUTATION_SIGNAL_PATTERNS) {
    if (re.test(message)) return true;
  }
  return false;
}

/**
 * Mutation patterns split into two groups for the fresh-analysis
 * follow-up guard's `what_would_flip` exception:
 *
 *   1. `ALWAYS_INDEPENDENT_MUTATION_PATTERNS` — patterns whose matches
 *      cannot be false positives from analytical-flip phrasing. A hit
 *      proves an independent concrete-edit clause exists somewhere in
 *      the message:
 *        - verb + numeric value          ("Set Pricing to 0.7")
 *        - add / insert / create + det   ("Add a new constraint")
 *        - remove / delete / drop + the  ("Remove the demand factor")
 *        - from <X> to <Y>               ("Change from low to high")
 *        - bare imperative at line start ("Set ...", "Add ...")
 *
 *   2. `VERB_TO_X_MUTATION_PATTERN` — the only mutation regex that can
 *      false-positive on `what_would_flip` phrasing. Fires on
 *      `<verb> [...] to <X>` shape. Real edits use it ("Change
 *      marketing channel to TikTok"), but it ALSO fires inside
 *      sensitivity questions ("what would need to change for another
 *      option to look better").
 *
 * `hasIndependentMutationSignal` resolves the ambiguity by stripping
 * the matched `what_would_flip` span from the message and re-testing
 * only `VERB_TO_X_MUTATION_PATTERN` on the remainder. If it still
 * fires, the message carries an independent edit clause separate from
 * the flip phrasing.
 */
const ALWAYS_INDEPENDENT_MUTATION_PATTERNS: readonly RegExp[] = [
  /\b(?:set|change|update|adjust|modify|raise|lower|increase|decrease|bump)\b[^.?!\n]{0,80}\b\d+(?:\.\d+)?%?\b/i,
  /\b(?:add|insert|create)\s+(?:a|an|new|another)\s+\S+/i,
  /\b(?:remove|delete|drop)\s+(?:the|that|this|my|our)\s+\S+/i,
  /\bfrom\s+\S+\s+to\s+\S+/i,
  /^\s*(?:set|remove|delete|drop|add|create|insert)\b/im,
];

const VERB_TO_X_MUTATION_PATTERN =
  /\b(?:set|change|update|adjust|modify|raise|lower|increase|decrease|bump)\b[^.?!\n]{0,80}\bto\s+\S+/i;

/**
 * `what_would_flip` patterns mirrored here so the strip-and-recheck in
 * `hasIndependentMutationSignal` can reference them without depending
 * on the order of `INTENT_PATTERNS` declarations later in the module.
 * Keep in sync with the `cls: 'what_would_flip'` entries in
 * `INTENT_PATTERNS`; the analytical-intent unit tests pin the
 * canonical list so drift between the two surfaces shows up as a test
 * failure rather than silently degrading the guard.
 */
const WHAT_WOULD_FLIP_STRIP_PATTERNS: readonly RegExp[] = [
  /\bwhat\s+would\s+flip\b/i,
  /\bwhat\s+would\s+change\s+(?:the\s+(?:result|outcome|leading\s+option|analysis|ranking|order)|things)\b/i,
  /\bwhat\s+would\s+tip\b/i,
  /\bwhat\s+would\s+it\s+take\s+to\s+(?:change|flip|reverse|move)\b/i,
  // V5 post-analysis contract v1 (review round-4) — widened from
  // `\bwhat\s+would\s+need\s+to\s+change\b` to the broader
  // `(would|does|might) (need|have) to (change|happen|move|shift|differ)`
  // shape that already lives in post-analysis-advice-gate.ts's
  // `what_would_flip_free_text` class. Round-3 missed this drift:
  // phrases like "What might need to change?" / "What does need to
  // happen?" / "What would have to change?" matched the advice gate on
  // the fresh path but slipped the classifier on the stale path,
  // falling through stale-rerun-guard to broad routing.
  /\bwhat\s+(?:would|do(?:es)?|might)\s+(?:need|have)\s+to\s+(?:change|happen|move|shift|differ)\b/i,
  /\bhow\s+(?:could|can|would)\s+(?:another\s+)?option\s+(?:win|look\s+better|come\s+(?:out\s+)?ahead)\b/i,
  // V5 post-analysis contract v1 (review rounds 2 + 3) — `could/might/would`
  // modal cousins that previously lived only in
  // analytical-question-guard.ts ADDITIONAL_ANALYTICAL_QUESTION_PATTERNS,
  // so the stale-rerun-guard / no-analysis-guard / V5 routeWithToolUse
  // path missed them while V4 route-v2 caught them. Lifted into the SSOT
  // here so every guard inherits them via classifyAnalyticalIntent.
  //
  // Round-3 widening: every alternation includes `would` alongside
  // `could/might`. The original `would change [outcome]` narrow pattern
  // above is preserved (first-match returns the same class) but the new
  // patterns also cover the broader noun set (results/outcomes/balance/
  // verdict/winners) and the alternate verbs (shift|move|alter|affect|tip)
  // and the `how would [outcome] (change|shift|...)` shape that no
  // existing pattern caught.
  //
  // Keep in sync with the matching `cls: 'what_would_flip'` entries
  // below; the strip-and-recheck logic in `hasIndependentMutationSignal`
  // depends on this list covering every flip-shape pattern so a phrase
  // like "what could change the outcome — change pricing to 100" still
  // exposes the standalone mutation after the flip span is stripped.
  /\bwhat\s+(?:could|might|would)\s+change\s+(?:the\s+(?:result|results|outcome|outcomes|leading\s+option|analysis|ranking|order|balance|verdict|winner|winners)|things)\b/i,
  /\bwhat\s+(?:might|could|would)\s+(?:shift|move|alter|affect|tip|change)\s+(?:the\s+)?(?:result|results|outcome|outcomes|leading\s+option|analysis|ranking|order|balance|things|verdict|winner|winners)\b/i,
  /\bhow\s+(?:could|might|can|would)\s+(?:the\s+)?(?:result|results|outcome|outcomes|leading\s+option|analysis|ranking|order|balance|things|verdict|winner|winners)\s+(?:change|shift|move|flip|differ|reverse)\b/i,
];

/**
 * Does the message carry a mutation signal from a clause that is
 * independent of `what_would_flip` analytical phrasing?
 *
 * Returns true iff:
 *
 *   - any pattern in `ALWAYS_INDEPENDENT_MUTATION_PATTERNS` fires
 *     (these are unambiguous concrete edits regardless of any
 *     surrounding analytical phrasing), OR
 *
 *   - the `verb [...] to <X>` mutation pattern still fires AFTER all
 *     `what_would_flip` pattern spans are removed from the message
 *     (proving the verb-to-X edit clause is separate from any flip
 *     phrasing).
 *
 * Used by the fresh-analysis follow-up guard so its narrow
 * `what_would_flip` exception applies ONLY when the mutation signal
 * is fully explained by flip-pattern overlap. An independent textual
 * edit such as `"Change marketing channel to TikTok then what would
 * need to change ..."` is detected even though it has no numeric value
 * or imperative-at-line-start.
 */
export function hasIndependentMutationSignal(message: string): boolean {
  for (const re of ALWAYS_INDEPENDENT_MUTATION_PATTERNS) {
    if (re.test(message)) return true;
  }
  let stripped = message;
  for (const re of WHAT_WOULD_FLIP_STRIP_PATTERNS) {
    stripped = stripped.replace(re, (matchText) => ' '.repeat(matchText.length));
  }
  return VERB_TO_X_MUTATION_PATTERN.test(stripped);
}

/**
 * Broad analytical-intent classes used by the stale-rerun guard, the
 * no-analysis guard, and the edit_graph no-op recovery branch.
 *
 *   - `explain`         — "walk me through the analysis", "explain the
 *                          result", "what does this mean", "help me
 *                          understand", "interpret this"
 *   - `what_drove`      — "what drove this", "why did X win", "what
 *                          made the result go this way"
 *   - `what_would_flip` — "what would flip this", "what would change
 *                          the result", "what would tip the balance"
 *   - `what_changed`    — past-tense result comparison: "what changed",
 *                          "why did the result change", "did the leading
 *                          option change". Distinct from `what_would_flip`
 *                          (future/hypothetical) and from the state-query
 *                          guard's graph-edit sense of "what changed".
 *   - `rerun_question`  — "is this stale", "do I need to re-run", "is
 *                          this still valid", "should I rerun analysis"
 */
export type AnalyticalIntentClass =
  | 'explain'
  | 'what_drove'
  | 'what_would_flip'
  | 'what_changed'
  | 'rerun_question';

interface IntentPattern {
  readonly cls: AnalyticalIntentClass;
  readonly pattern: RegExp;
}

const INTENT_PATTERNS: readonly IntentPattern[] = [
  // ── rerun_question (most specific — anchored on rerun/stale vocabulary) ─
  { cls: 'rerun_question', pattern: /\bdo\s+(?:i|we)\s+need\s+to\s+(?:re-?run|rerun|run\s+again)\b/i },
  { cls: 'rerun_question', pattern: /\bshould\s+(?:i|we)\s+(?:re-?run|rerun|run\s+again)\b/i },
  // ROADMAP 2.229 fix 1 — SPLIT IN TWO so the SUBJECT group is REQUIRED
  // whenever the terminal word is one of the three that carry no staleness
  // sense on their own: `valid` / `fresh` / `current`.
  //
  // This was ONE pattern with the subject group OPTIONAL:
  //   /\b(?:is|are)\s+(?:this|these|the|that|those)
  //     (?:\s+(?:result|results|analysis|outcome|outcomes))?
  //     \s+(?:still\s+)?(?:stale|out\s*of\s*date|outdated|valid|fresh|current)\b/i
  // which made "…and what IS THE CURRENT value?" read as "is this still
  // current?" — and `rerun_question` is FIRST in precedence, so it beat the
  // flip intent that dominated the rest of that sentence. Measured collision
  // surface (diagnosis 2.229 §4): 3 false positives, 4 true positives.
  // Both halves are pinned in `analytical-intent.test.ts`.
  //
  // (a) subject PRESENT → the full terminal set, including the three
  //     ambiguous words. "Are these results still valid?" is a real
  //     staleness question and keeps classifying.
  { cls: 'rerun_question', pattern: /\b(?:is|are)\s+(?:this|these|the|that|those)\s+(?:result|results|analysis|outcome|outcomes)\s+(?:still\s+)?(?:stale|out\s*of\s*date|outdated|valid|fresh|current)\b/i },
  // (b) subject ABSENT → only the unambiguous staleness vocabulary. "Is this
  //     stale?" still classifies; "Is that valid input for the model?" and
  //     "what is the current value?" no longer do.
  // (b) subject ABSENT. The unambiguous staleness words are always accepted;
  //     `valid|fresh|current` are accepted ONLY behind an explicit `still`.
  //
  //     ⚠ AS FIRST SHIPPED THIS BRANCH OMITTED `valid|fresh|current`
  //     ENTIRELY, and that killed the MOST IDIOMATIC staleness phrasing
  //     there is: "Is this still current?", "Is this still valid?",
  //     "Are these still valid?" all became `null`. That is not a
  //     cosmetic loss — `cls === null` makes BOTH `tryStaleRerunGuard`
  //     and `tryNoAnalysisGuard` decline, so on a STALE analysis the
  //     canonical question lost its deterministic stale answer AND its
  //     re-run chip. The original 7 controls all carried a subject noun
  //     or an unambiguous staleness word, so the shape was untested in
  //     both directions; the diagnosis shared the blind spot.
  //
  //     `still` is what carries the staleness sense when the subject is
  //     elided: "is this still current?" asks about currency over time;
  //     "what is the current value?" does not, and stays out.
  { cls: 'rerun_question', pattern: /\b(?:is|are)\s+(?:this|these|the|that|those)\s+(?:(?:still\s+)?(?:stale|out\s*of\s*date|outdated)|still\s+(?:valid|fresh|current))\b/i },
  { cls: 'rerun_question', pattern: /\bdoes\s+(?:this|the\s+(?:analysis|result))\s+need\s+(?:a\s+)?(?:re-?run|rerun|refresh)\b/i },
  { cls: 'rerun_question', pattern: /\bis\s+(?:the\s+)?(?:analysis|result)\s+out\s*of\s*date\b/i },

  // ── what_would_flip ──────────────────────────────────────────────
  { cls: 'what_would_flip', pattern: /\bwhat\s+would\s+flip\b/i },
  { cls: 'what_would_flip', pattern: /\bwhat\s+would\s+change\s+(?:the\s+(?:result|outcome|leading\s+option|analysis|ranking|order)|things)\b/i },
  { cls: 'what_would_flip', pattern: /\bwhat\s+would\s+tip\b/i },
  { cls: 'what_would_flip', pattern: /\bwhat\s+would\s+it\s+take\s+to\s+(?:change|flip|reverse|move)\b/i },
  // Round-4: broader need/have shape, mirrors the same pattern in
  // post-analysis-advice-gate.ts's what_would_flip_free_text class so
  // the classifier and the advice gate cover identical phrasings.
  // Keep this entry in lock-step with the strip-patterns list above.
  // Parity is now locked by the curated phrase test in
  // `__tests__/post-analysis-contract.test.ts`.
  { cls: 'what_would_flip', pattern: /\bwhat\s+(?:would|do(?:es)?|might)\s+(?:need|have)\s+to\s+(?:change|happen|move|shift|differ)\b/i },
  { cls: 'what_would_flip', pattern: /\bhow\s+(?:could|can|would)\s+(?:another\s+)?option\s+(?:win|look\s+better|come\s+(?:out\s+)?ahead)\b/i },
  // V5 post-analysis contract v1 (review rounds 2 + 3) — `could/might/would`
  // modal cousins previously caught only by analytical-question-guard.ts.
  // Stale-rerun-guard / no-analysis-guard / V5 routeWithToolUse delegate
  // to classifyAnalyticalIntent, so phrases like "What could change the
  // outcome?", "What would move the result?", "What might shift the
  // analysis?", or "How would the outcome change?" used to fall through
  // to the broad LLM on the stale path (V4 route-v2 caught them via
  // analytical-question-guard, V5 did not). Round-3 widening includes
  // `would` in every modal alternation so the SSOT genuinely covers the
  // full grammar in analytical-question-guard.ts. Mirrored shape with
  // WHAT_WOULD_FLIP_STRIP_PATTERNS above so mutation precedence stays
  // symmetric.
  { cls: 'what_would_flip', pattern: /\bwhat\s+(?:could|might|would)\s+change\s+(?:the\s+(?:result|results|outcome|outcomes|leading\s+option|analysis|ranking|order|balance|verdict|winner|winners)|things)\b/i },
  { cls: 'what_would_flip', pattern: /\bwhat\s+(?:might|could|would)\s+(?:shift|move|alter|affect|tip|change)\s+(?:the\s+)?(?:result|results|outcome|outcomes|leading\s+option|analysis|ranking|order|balance|things|verdict|winner|winners)\b/i },
  { cls: 'what_would_flip', pattern: /\bhow\s+(?:could|might|can|would)\s+(?:the\s+)?(?:result|results|outcome|outcomes|leading\s+option|analysis|ranking|order|balance|things|verdict|winner|winners)\s+(?:change|shift|move|flip|differ|reverse)\b/i },

  // ── what_changed (past-tense result comparison) ──────────────────
  // MUST precede what_drove so "why did the result change?" routes to
  // comparison, not driver-explanation. Disjoint from what_would_flip
  // above (future/hypothetical "what WOULD change ...") because every
  // pattern here is anchored on past-tense "changed"/"did ... change".
  // The bare "what changed" form is shared with the state-query guard's
  // allowlist by design: run-comparison-gate runs first and claims it
  // only when a genuine run comparison exists or the model is stale,
  // otherwise the state-query guard answers the graph-edit sense.
  { cls: 'what_changed', pattern: /\bwhat(?:'s|\s+(?:has|just))?\s+changed\b/i },
  { cls: 'what_changed', pattern: /\bwhy\s+(?:did|has|have)\s+(?:the\s+)?(?:result|results|outcome|outcomes|analysis|ranking|leading\s+option|numbers?)\s+chang/i },
  { cls: 'what_changed', pattern: /\bhow\s+(?:did|has|have)\s+(?:the\s+)?(?:result|results|outcome|outcomes|analysis|ranking|leading\s+option)\s+chang/i },
  { cls: 'what_changed', pattern: /\bdid\s+(?:the\s+)?(?:result|outcome|ranking|leading\s+option|winner)\s+chang/i },
  { cls: 'what_changed', pattern: /\bwhat[''']?s\s+different\s+(?:now|in\s+(?:the\s+)?(?:result|results|outcome|analysis|ranking))\b/i },

  // ── what_drove ───────────────────────────────────────────────────
  { cls: 'what_drove', pattern: /\bwhat\s+drove\b/i },
  { cls: 'what_drove', pattern: /\bwhy\s+did\s+(?:this|that|the\s+(?:result|analysis|outcome))\b/i },
  { cls: 'what_drove', pattern: /\bwhat\s+made\s+(?:this|that|the\s+(?:result|analysis|outcome))\b/i },
  { cls: 'what_drove', pattern: /\bwhat[''']?s\s+driving\b/i },
  { cls: 'what_drove', pattern: /\bwhich\s+(?:factor|driver)s?\s+(?:drove|drive|pushed)\b/i },
  // Why is X ahead / leading / in front — present-state reason questions
  // about the current ranking. The "why did" patterns above match past-
  // tense forms ("why did this win"); this matches the present-state form
  // ("why is this option ahead?", "why is Option A leading?"). "leading"
  // joins the predicate alongside the narrower set so the sibling guards
  // (stale-rerun, no-analysis, edit_graph no-op recovery) all classify
  // the brief's canonical phrasing consistently. Surviving call sites
  // that use "Why is the leading option winning?" are either handler-
  // direct (no classifier routing) or scenarios that are themselves
  // analytical-intent turns the sibling guards should now own.
  { cls: 'what_drove', pattern: /\bwhy\s+is\b[^.?!\n]{1,40}\b(?:ahead|leading|in\s+front|on\s+top|the\s+leader|the\s+favourite|the\s+favorite)\b/i },

  // ── explain (broadest, evaluated last) ───────────────────────────
  { cls: 'explain', pattern: /\bexplain\s+(?:the|these|those|this|that)\s+(?:results?|analysis|outcomes?|findings?)\b/i },
  { cls: 'explain', pattern: /\bwalk\s+me\s+through\s+(?:the|these|those|this|that)\s+(?:results?|analysis|outcomes?|findings?)\b/i },
  { cls: 'explain', pattern: /\bwalk\s+me\s+through\b/i },
  { cls: 'explain', pattern: /\btell\s+me\s+about\s+(?:the|these|those|this|that)\s+(?:results?|analysis|outcomes?|findings?)\b/i },
  { cls: 'explain', pattern: /\bwhat\s+do(?:es)?\s+(?:this|that|it|the\s+(?:analysis|result|outcome|number|score|finding|chart))\s+mean\b/i },
  { cls: 'explain', pattern: /\bhow\s+(?:should|do)\s+(?:i|we)\s+(?:read|interpret|understand)\b/i },
  { cls: 'explain', pattern: /\bhelp\s+me\s+(?:interpret|understand|make\s+sense\s+of|read)\b/i },
  { cls: 'explain', pattern: /\bexplain\s+(?:this|that|what[''']?s\s+going\s+on|what\s+happened|the\s+(?:reasoning|logic))\b/i },
  { cls: 'explain', pattern: /\bsummarise\s+(?:the|these|those|this|that)\s+(?:results?|analysis|outcomes?|findings?)\b/i },
  { cls: 'explain', pattern: /\bsummarize\s+(?:the|these|those|this|that)\s+(?:results?|analysis|outcomes?|findings?)\b/i },
  // V5 post-analysis contract v1 — imperative change-advice family.
  // Mirrors the patterns added to `post-analysis-advice-gate.ts` so the
  // stale-rerun-guard, no-analysis-guard, and edit_graph no-op recovery
  // surfaces fire on the same phrases the fresh-path advice gate owns.
  // Class is `explain` only to satisfy the analytical-intent precondition
  // of the sibling guards (which use class-blind static copy); the
  // fresh-path advice gate owns the actual `update_advice`/`advice`
  // class differentiation for telemetry.
  { cls: 'explain', pattern: /\btell\s+me\s+what\s+(?:to|i\s+(?:should|need\s+to|can|could|might))\s+(?:change|update|adjust|fix|improve|edit)\b/i },
  { cls: 'explain', pattern: /\bshow\s+me\s+what\s+(?:to|i\s+should)\s+(?:change|update|adjust|fix|improve|edit)\b/i },
  { cls: 'explain', pattern: /\bwhat\s+do\s+(?:i|we)\s+(?:change|update|adjust|fix|edit)\b/i },
  { cls: 'explain', pattern: /\bwhat\s+needs\s+(?:to\s+(?:change|be\s+(?:changed|updated|adjusted|fixed))|changing|updating|adjusting)\b/i },
  // Round-4: narrow stale-path coverage for the brief's row 5
  // ("What should I change?"). The advice gate matches this on the
  // fresh path via its broad `\bwhat\s+should\s+(?:we|i|you)\b/i`
  // pattern (`advice` class), but the classifier had no equivalent so
  // stale + "What should I change?" fell through to broad routing.
  //
  // Intentionally NARROW: verb list is restricted to change-advice
  // verbs (change|update|adjust|fix|improve|edit). Does NOT include:
  //   - `do` — too broad ("What should I do tonight?" is off-topic)
  //   - value-edit verbs (set|increase|decrease|raise|lower|reduce|bump)
  //     — those carry their own mutation precedence in
  //     analytical-question-guard's pattern #4 and the value-update
  //     pre-route; including them here could conflict with mutation
  //     semantics on the stale path.
  //
  // Mutation precedence stays intact via `hasMutationSignal` —
  // "What should I change to 100?" / "What should I update by 5%?"
  // both trigger MUTATION_SIGNAL_PATTERNS before this classifier
  // entry can short-circuit (the stale-rerun-guard checks
  // hasMutationSignal first).
  { cls: 'explain', pattern: /\bwhat\s+should\s+(?:i|we|you)\s+(?:change|update|adjust|fix|improve|edit)\b/i },
  { cls: 'explain', pattern: /\bhelp\s+me\s+(?:figure\s+out|decide|work\s+out)\s+what\s+to\s+(?:change|update|adjust|fix|improve|edit)\b/i },
  { cls: 'explain', pattern: /\bgive\s+me\s+(?:something|a\s+starting\s+point|a\s+place\s+to\s+start)\s+to\s+(?:change|update|adjust|fix|improve)\b/i },
  { cls: 'explain', pattern: /\bwhat[’']?s\s+worth\s+(?:changing|updating|adjusting|fixing|improving|editing)\b/i },
];

/**
 * Classify a user message into one of four broad analytical-intent
 * shapes, or null when no analytical intent is detected.
 *
 * Order of precedence (rerun_question > what_would_flip > what_drove >
 * explain) is preserved by the order of INTENT_PATTERNS so a message
 * like "should I rerun before I explain the result" matches
 * `rerun_question` rather than `explain`.
 */
export function classifyAnalyticalIntent(
  message: string,
): AnalyticalIntentClass | null {
  const trimmed = message.trim();
  if (trimmed.length === 0) return null;
  for (const entry of INTENT_PATTERNS) {
    if (entry.pattern.test(trimmed)) return entry.cls;
  }
  return null;
}

/**
 * ROADMAP 2.229 fix 4 — imperative re-run recognition.
 *
 * Every `rerun_question` pattern above is INTERROGATIVE ("do I need to
 * re-run", "should we re-run", "is this still stale", "does this need a
 * re-run", "is the analysis out of date"). There was NO imperative form, so a
 * direct instruction — "Please run the analysis again on this same model." —
 * matched nothing, fell through every deterministic guard, and was classified
 * by the LLM, which is nondeterministic between `run_analysis` and a mutation
 * handler. That is the intermittency the walk recorded (diagnosis 2.229 §8,
 * anomaly 4): sometimes honoured, sometimes read as an edit.
 *
 * This is DELIBERATELY a separate predicate rather than another
 * `INTENT_PATTERNS` entry:
 *
 *   - `rerun_question` means "the user is ASKING whether a re-run is needed",
 *     and an ANSWER is the right treatment. Folding an instruction into that
 *     class would route an instruction to an answer.
 *   - the diagnosis's ORDERING HAZARD (§8) was precisely that: an imperative
 *     added to the classifier would have been claimed by the fresh-analysis
 *     follow-up guard and answered with its frozen recap — converting an
 *     intermittent misroute into a CONSISTENT refusal to re-run. Keeping the
 *     recogniser out of the classifier means that hazard cannot recur even if
 *     a future guard re-appears.
 *
 * Consumed by the deterministic `run_analysis` pre-route in turn-executor.ts,
 * which additionally requires no mutation signal and a graph with at least one
 * option node before it synthesises a proposal.
 */

/**
 * Questions ABOUT re-running. Checked FIRST and veto the imperative reading —
 * "Do I need to re-run the analysis?" contains the substring "re-run the
 * analysis" but is a question, and executing an analysis in reply to a
 * question is a worse failure than the one being fixed.
 *
 * Deliberately keyed on a FIRST-PERSON or state-query subject: "Can you re-run
 * the analysis?" is a polite instruction and must NOT be vetoed, whereas "Can
 * we re-run?" is the user asking whether it is possible.
 */
/**
 * ⚠ NEGATION VETO — checked FIRST, and required SEPARATELY from the object-group
 * repair above. "Do not re-run **the analysis**" carries a valid object and
 * survives that repair intact, so without this veto the most explicit possible
 * refusal — the user telling the product NOT to do the thing — executed it.
 *
 * Measured before this existed, every one routing to a real `run_analysis`
 * dispatch with `llm_calls_used: 0`:
 *   "Do not re-run the analysis."        "Don't re-run it."
 *   "Never re-run this automatically."   "I do not want to re-run anything."
 *
 * The asymmetry that makes this a veto rather than a scored signal: refusing to
 * act on an ambiguous sentence costs a clarification; acting on a refusal
 * destroys the user's computed result. `stop` / `avoid` / `without` are included
 * for the same reason — they are cheap to honour and expensive to miss.
 *
 * ⚠ KNOWN, ACCEPTED OVER-REACH — this is a bare word-PRESENCE test, not a
 * scoped one. A negator ANYWHERE in the sentence vetoes it, so a genuine
 * instruction that merely CONTAINS one is declined too: `"Re-run the analysis
 * without the outlier."` is not recognised and falls through to the LLM router,
 * exactly as it did before this pre-route existed. That is the SAFE direction
 * and it is deliberate — a declined instruction costs the user a clarification;
 * an honoured refusal destroys their computed result. Scoping it properly needs
 * clause structure, which is the same problem that made the doctrine guard's
 * negation scope unshippable (#780, 9 false negatives). Do not attempt it with
 * a wider regex.
 */
const RERUN_NEGATION_VETO_PATTERNS: readonly RegExp[] = [
  /\b(?:do\s+not|don['’]?t|never|no\s+need\s+to|rather\s+not|stop|avoid|without)\b/i,
];

const RERUN_INTERROGATIVE_VETO_PATTERNS: readonly RegExp[] = [
  /\b(?:do|did|does|should|must|would|will|can|could|need)\s+(?:i|we)\b/i,
  /\bis\s+(?:it|there)\b/i,
  /\b(?:is|are|does|do)\s+(?:this|these|that|those|the)\b/i,
  /\bworth\s+(?:re-?running|rerunning|running|analysing|analyzing)\b/i,
  /\bhow\s+often\b/i,
  /\bwhen\s+(?:should|do|does|would|will)\b/i,
];

/**
 * The imperative shapes themselves. Each is anchored on re-run vocabulary
 * PLUS an explicit repetition marker or the `re-` prefix, so an ordinary
 * graph edit that happens to contain "again" ("Set the marketing budget to
 * 200 again.") matches none of them.
 */
const IMPERATIVE_RERUN_PATTERNS: readonly RegExp[] = [
  // "re-run the analysis", "rerun it", "re-run this".
  //
  // ⚠ THE OBJECT GROUP IS REQUIRED, AND THAT IS THE WHOLE PATTERN.
  // As first shipped the group carried a trailing `?`, which made this
  // regex equivalent to a bare `/\bre-?run\b/i` — ANY occurrence of the
  // token, anywhere, in any grammatical role. Measured consequence, in the
  // integration harness, all executing a real analysis with 0 LLM calls:
  //   "What changed in the re-run?"          → EXECUTED a re-run
  //   "Show me the re-run results."          → EXECUTED a re-run
  //   "How long did the rerun take?"         → EXECUTED a re-run
  //   "Was the rerun better?"                → EXECUTED a re-run
  // `run_analysis` is not a no-op: it forwards the graph to PLoT→ISL for
  // real compute, writes a new fact and `graph_hash_at_run`, and REPLACES
  // the user's existing result. A question ABOUT a past run was answered by
  // destroying it. Never restore the `?`.
  //
  // ⚠ THE LEADING LOOKBEHIND IS THE SECOND HALF, AND IT IS NOT OPTIONAL.
  // Requiring an object closed the MEASURED CORPUS, not the CLASS: it never
  // required `re-?run` to be in VERB position, so the ATTRIBUTIVE-MODIFIER
  // reading survived. "the re-run analysis" parses as determiner + modifier +
  // noun, and "analysis" is itself in the object list — so the pattern matched
  // on the very words that prove it is NOT an instruction. Measured at path
  // level with real dispatch (invocations=1) before this lookbehind existed:
  //   "What did the re-run analysis show?"    "Tell me about the rerun model."
  //   "Summarise the re-run analysis for me." "Was the re-run analysis different?"
  //   "The rerun scenario looked odd, why?"
  // Same defect class as the original blocker, and NEW relative to `staging`
  // (this pre-route does not exist there), so leaving it would have converted
  // an intermittent LLM misroute into a deterministic destruction for this
  // shape.
  //
  // WHAT IS ACTUALLY CLOSED, stated precisely so the next reader does not
  // inherit an overclaim: `re-?run` must carry an object AND must not be
  // preceded by a determiner or possessive. Between them those two structural
  // requirements cover the verb-less noun reading ("in the re-run") and the
  // attributive reading ("the re-run analysis"). This is NOT a proof that no
  // nominal reading survives. Treat a new counterexample as expected.
  /(?<!\b(?:the|a|an|that|this|these|those|its|their)\s)\bre-?run\b\s+(?:the|this|that|my|our)?\s*(?:analysis|analyses|model|numbers|scenario|it|this|that)\b/i,
  // "run the analysis again", "run the numbers once more"
  /\brun\s+(?:the\s+|this\s+|that\s+|my\s+|our\s+)?(?:analysis|analyses|model|numbers|scenario)\s+(?:again|once\s+more|one\s+more\s+time|a\s+second\s+time)\b/i,
  // "run it again", "run this again"
  /\brun\s+(?:it|this|that)\s+(?:again|once\s+more|one\s+more\s+time)\b/i,
  // "analyse it again", "analyze the model again", "re-analyse this"
  /\bre-?analy[sz]e\b/i,
  /\banaly[sz]e\s+(?:it|this|that|the\s+(?:model|scenario|decision|graph|numbers))\s+(?:again|once\s+more|one\s+more\s+time)\b/i,
  /\banaly[sz]e\s+(?:again|once\s+more)\b/i,
];

/**
 * True when the message INSTRUCTS a re-run of the analysis (as opposed to
 * asking whether one is needed). See the block comment above.
 */
export function looksLikeImperativeRerun(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length === 0) return false;
  // Negation first: an explicit refusal outranks every other reading.
  for (const re of RERUN_NEGATION_VETO_PATTERNS) {
    if (re.test(trimmed)) return false;
  }
  for (const re of RERUN_INTERROGATIVE_VETO_PATTERNS) {
    if (re.test(trimmed)) return false;
  }
  for (const re of IMPERATIVE_RERUN_PATTERNS) {
    if (re.test(trimmed)) return true;
  }
  return false;
}

/**
 * Positive vague-edit signal. True when the message is shaped like an
 * edit request that lacks a specific target — typical phrasings: "Update
 * something", "Change this", "Make a change", "Adjust the model",
 * "Fix the model". The `hasMutationSignal` patterns above catch
 * concrete edits with explicit targets/values; this predicate catches
 * the abstract-target shape that warrants a clarification ask rather
 * than the generic safe fallback.
 *
 * Must remain narrow: any general conversational message that does NOT
 * match this predicate falls back to ambiguous (preserve existing copy).
 */
const VAGUE_EDIT_PATTERNS: readonly RegExp[] = [
  // Imperative edit verb + abstract object: "Change something",
  // "Update things", "Adjust this", "Modify the model", "Fix the graph".
  /\b(?:update|change|adjust|modify|fix|improve|edit|tweak|revise|amend|tune)\s+(?:something|things?|stuff|anything|this|that|it|the\s+(?:model|graph|decision|setup|analysis))\b/i,
  // "Make/do a change/update/adjustment/edit".
  /\b(?:make|do)\s+(?:a|an|some)\s+(?:change|changes|update|updates|adjustment|adjustments|edit|edits|tweak|tweaks)\b/i,
  // Bare imperative edit verb alone, optionally with trailing
  // punctuation. "Update.", "Change.", "Adjust". A previous version
  // of this pattern also matched `verb + up to 40 chars` (e.g.
  // "Change pricing factor"), which mis-classified concrete-target
  // imperatives as vague-edit even when they had a named factor.
  // Tightened: a concrete or value-less target ("Change pricing
  // factor") falls through to ambiguous and preserves the existing
  // safe fallback rather than asking for a different factor.
  /^\s*(?:update|change|adjust|modify|fix|improve|edit|tweak|revise|amend|tune)\s*\.?\s*$/i,
  // "Can you change/update/adjust …" without a concrete factor/value.
  /\bcan\s+you\s+(?:update|change|adjust|modify|fix|improve|edit|tweak|revise|amend|tune)\s+(?:something|things?|this|that|it|the\s+(?:model|graph|decision))\b/i,
];

/**
 * Negation-prefix patterns. If any fires, the message is rejecting an
 * edit ("Don't change anything", "I don't want to update", "Won't make
 * a change", "No need to update the model") rather than asking for one.
 * `looksLikeVagueEdit` consults these BEFORE the positive
 * `VAGUE_EDIT_PATTERNS` so negated statements never trigger the
 * clarification ask.
 *
 * The verb list at the tail mirrors the verbs in `VAGUE_EDIT_PATTERNS`
 * plus `make` and `do` (which appear as auxiliaries in the
 * "make a change" / "do an update" branch), so every shape the
 * positive patterns recognise is paired with a negated rejection.
 */
const NEGATED_EDIT_PATTERNS: readonly RegExp[] = [
  // "don't change", "I don't want to change", "won't update",
  // "can't change", "shouldn't update", "please don't change", etc.
  /\b(?:don['']?t|dont|do\s+not|doesn['']?t|does\s+not|won['']?t|wont|will\s+not|can['']?t|cant|cannot|shouldn['']?t|should\s+not|wouldn['']?t|would\s+not|never|please\s+don['']?t)\b[^.?!\n]{0,40}\b(?:update|change|adjust|modify|fix|improve|edit|tweak|revise|amend|tune|make|do)\b/i,
  // "no need to change", "no point making an update", "no reason to adjust".
  /\bno\s+(?:need|point|reason)\b[^.?!\n]{0,40}\b(?:update|change|adjust|modify|fix|improve|edit|tweak|revise|amend|tune|make|do)\b/i,
];

export function looksLikeVagueEdit(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length === 0) return false;
  // Negations are rejected before positive matching: "Don't change
  // anything" must not trigger the clarification ask.
  for (const re of NEGATED_EDIT_PATTERNS) {
    if (re.test(trimmed)) return false;
  }
  for (const re of VAGUE_EDIT_PATTERNS) {
    if (re.test(trimmed)) return true;
  }
  return false;
}
