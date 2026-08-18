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
  /\bwhat\s+would\s+change\s+(?:(?:the|this|that)\s+(?:result|outcome|leading\s+option|analysis|ranking|order)|things)\b/i,
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
  /\bwhat\s+(?:could|might|would)\s+change\s+(?:(?:the|this|that)\s+(?:result|results|outcome|outcomes|leading\s+option|analysis|ranking|order|balance|verdict|winner|winners)|things)\b/i,
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
  { cls: 'what_would_flip', pattern: /\bwhat\s+would\s+change\s+(?:(?:the|this|that)\s+(?:result|outcome|leading\s+option|analysis|ranking|order)|things)\b/i },
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
  { cls: 'what_would_flip', pattern: /\bwhat\s+(?:could|might|would)\s+change\s+(?:(?:the|this|that)\s+(?:result|results|outcome|outcomes|leading\s+option|analysis|ranking|order|balance|verdict|winner|winners)|things)\b/i },
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
  //
  // ⚠ THIS LIST HAS DIVERGED FROM ITS SIBLING IN THIS SAME FILE.
  // `NEGATED_EDIT_PATTERNS` (below) expresses the same concept — the user is
  // REFUSING — and carries four contracted negators this list does not:
  // `won't` · `shouldn't` · `wouldn't` · `doesn't`. Two hand-maintained lists
  // of one idea, one fuller than the other, is the mirror defect this estate
  // keeps paying for.
  //
  // ⚠⚠ AND `didn't` IS ABSENT FROM BOTH — including from the first draft of
  // this very note, which claimed it was present in the sibling. A note written
  // to record a hand-maintained-mirror defect drifted at birth. Corrected
  // against the bytes; if you extend either list, extend both and re-check this
  // sentence rather than trusting it.
  //
  // NOT load-bearing for the re-run pre-route: the contracted refusals it
  // misses ("We didn't want to re-run the analysis.") are declined by POSITION
  // — there is no `to` left context at all — not by polarity. Verified: under a
  // mutant that restores `to`, all five go RED with this veto untouched.
  // Unifying the two lists changes the vague-edit clarifier's behaviour, so it
  // belongs in its own lane, not here.
  // ⚠ ADDED alongside the matrix-verb allowlist, which has SINCE BEEN DELETED —
  // this entry outlived it deliberately. "Nobody wants to re-run the analysis."
  // was the one shape that allowlist could not reach, because `wants to` IS
  // genuinely instruction-shaped: the refusal lives in the SUBJECT, not the
  // verb. It stays because it is about refusal, not about grammar, and refusal
  // is what this list is for. It belongs here rather than in the grammar rule: this list is about
  // explicit refusal, and "nobody wants to" is a refusal however well-formed
  // the verb phrase is. Same accepted over-reach as the rest of this list — a
  // message merely CONTAINING one of these declines, in the safe direction.
  /\b(?:nobody|no\s+one|no-one|none\s+of\s+us)\b/i,
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
 * ⭐ VERB-POSITION ALLOWLIST — the left contexts in which the token that
 * follows is genuinely a VERB rather than a noun or a modifier.
 *
 * This is the inversion of the blocklist that failed twice. The property that
 * matters is not "which words could precede a noun" — that set is all of
 * English and cannot be enumerated — but "which left contexts license an
 * imperative", which is a small, closed, checkable list.
 *
 * FAILS SAFE BY CONSTRUCTION. An unrecognised left context DECLINES, so the
 * turn falls through to the LLM router exactly as it did before this pre-route
 * existed. Every gap in this list therefore costs a clarification, never a
 * destroyed result — which is the correct direction for a route whose action
 * REPLACES the user's computed analysis.
 *
 * Applied to EVERY imperative pattern, not just the `re-?run` one. The
 * "<verb> … again" patterns look immune because `again` is adverbial, but
 * `\brun\b` matches inside "re-run", so "The re-run analysis again showed X."
 * would have matched pattern 2 on exactly the nominal reading this exists to
 * exclude. Uniform application closes that without a second special case.
 *
 * Each entry is anchored to the END of the left context with `$`.
 *
 * ⚠ KNOWN DECLINES — measured, and disclosed rather than discovered later. All
 * of these are genuine instructions that this list does NOT recognise, so they
 * fall through to the LLM router:
 *
 *   "Start / Kick off / Trigger / Perform / Repeat the re-run analysis."
 *   "Go ahead with the re-run analysis."   "I want the re-run analysis."
 *   "…was odd, SO re-run the model."       (connective absent from the list)
 *
 * ⚠ AND THE DECLINE SET IS WIDER THAN THOSE EIGHT — stated because the list
 * above previously read as the complete measured set, which it was not. Any
 * sentence-initial discourse marker or modal that is not on the allowlist also
 * declines, including several common phrasings:
 *   "So / Also / First / Next / Finally / OK / Yes / Just / Instead / Maybe /
 *    Actually re-run the analysis."
 *   "You should re-run the analysis."
 *   "Here is what I need: re-run the analysis."
 * All fail SAFE (fall through to the LLM router) and all are IDENTICAL to
 * `staging`, where this pre-route does not exist — so there is no user-visible
 * loss against the deployed baseline. `Just re-run the analysis.` and `You
 * should re-run the analysis.` are the two most likely to be typed; if live
 * telemetry shows the pre-route declining often, widen the allowlist THERE
 * first, and never by relaxing the object rule.
 *
 * The first seven are also genuinely AMBIGUOUS — "the re-run analysis" there is
 * determiner + modifier + noun, the very construction this list exists to
 * refuse — so declining them is arguably the correct parse and not merely the
 * safe one. Widening the list to catch them would re-admit the nominal reading
 * they share with "Review the previous re-run analysis.", which must keep
 * declining. Not worth trading a destroyed result for a saved clarification.
 */
const VERB_POSITION_LEFT_CONTEXTS: readonly RegExp[] = [
  /^\s*$/,                                          // start of the message
  /[.!?;\n]\s*$/,                                   // start of a new sentence
  /,\s*$/,                                          // after a comma
  /\band\s+$/i,                                     // "…, and re-run the model."
  /\bthen\s+$/i,                                    // "…, then re-run the model."
  /\bplease\s+$/i,                                  // "Please re-run the analysis."
  // ⚠⚠ THERE IS DELIBERATELY NO `to` ENTRY HERE, AND ADDING ONE BACK IS A
  // REGRESSION. Two forms have now been tried and both shipped a defect:
  //
  //   bare  /\bto\s+$/i                → licensed EVERY infinitival `to`.
  //                                      8 non-instruction readings executed a
  //                                      real analysis, incl. "We decided NOT
  //                                      to re-run the analysis."
  //   matrix-verb allowlist            → `(want|need|like|ask|tell|going|try)
  //                                      … to$`. Closed those 8 and opened 22
  //                                      more, incl. "We didn't want to…",
  //                                      "We won't need to…", "He doesn't want
  //                                      to…", reported speech ("She told me to
  //                                      re-run the analysis."), questions with
  //                                      a non-first-person subject ("Do they
  //                                      want to…?"), `need`/`ask` as NOUNS
  //                                      ("The need to re-run … is unclear."),
  //                                      and conditionals ("If you need to…").
  //
  // WHY NO THIRD REGEX. The distinguishing information for "directive vs not"
  // is NOT IN THE VERB. `want/need/ask/tell/try/going` are precisely the verbs
  // that also head reports, questions, conditionals and refusals. What decides
  // it is SUBJECT PERSON, TENSE, POLARITY and CLAUSE EMBEDDING — none of which
  // a fixed-width left-context regex can see. A third list would arrive with a
  // seventh round for the same reason the first six did.
  //
  // COST OF OMITTING IT — SEVEN forms, measured, not four. This is the number
  // to weigh if you are here to re-add `to`, so it is stated in full:
  //
  //   "I want you to re-run the analysis."   "I need you to re-run the analysis."
  //   "I'd like you to re-run the analysis." "I am going to re-run the analysis."
  //   "Try to re-run the analysis."          "Ask them to re-run the analysis."
  //   "Tell it to re-run the analysis."
  //
  // All fall through to the LLM router — EXACTLY what staging does today, zero
  // regression — whereas every `to` entry tried so far turned a refusal into a
  // destroyed analysis.
  //
  // ⚠ AND THE USABILITY COST IS SMALLER THAN SEVEN. Only the first three are a
  // genuine loss. "I am going to re-run the analysis." is the user announcing
  // their OWN intent, and "Ask them to re-run…" instructs a THIRD PARTY — the
  // deleted entry fired WRONGLY on both, so losing them is a small correctness
  // GAIN. For scale, the pre-existing decline set already contains commoner
  // phrasings than any of the seven ("Just re-run the analysis.", "You should
  // re-run the analysis.").
  //
  // The real fix is not a better pattern: it is to change the PAYOFF, so the
  // deterministic route lands on a CONFIRMATION rather than a dispatch. A false
  // positive then costs one click instead of the user's computed result, and
  // the allowlist can be widened freely. Rowed as its own lane; CEE already has
  // the machinery (`pending_actions` at commit, `tryShortConfirmResume`).
  /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?$/i, // "Could you re-run …?"
  /\blet['’]?s\s+$/i,                               // "Let's re-run this."
  /\bnow\s+$/i,                                     // "Now re-run the analysis."
];

/** Is the match at `matchStart` in a licensed VERB position? */
function isVerbPosition(message: string, matchStart: number): boolean {
  const left = message.slice(0, matchStart);
  for (const re of VERB_POSITION_LEFT_CONTEXTS) {
    if (re.test(left)) return true;
  }
  return false;
}

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
  // ⚠ VERB POSITION IS ENFORCED SEPARATELY, BY AN ALLOWLIST. See
  // `VERB_POSITION_LEFT_CONTEXTS` below. Requiring an object closed the
  // measured CORPUS twice and the CLASS neither time:
  //
  //   round 2 — the object group was OPTIONAL, so this was a bare
  //             `/\brerun\b/i`: "What changed in the re-run?" executed.
  //   round 3 — object required, plus a lookbehind BLOCKLIST of nine tokens
  //             (`the|a|an|that|this|these|those|its|their`). Twenty of
  //             twenty-one ordinary sentences walked straight through it:
  //             `your/our/my/his/her` (absent from the list — and `my`/`our`
  //             appear in this very regex's own object group), possessive-'s
  //             ("Paul's rerun analysis"), `the`+adjective ("The failed
  //             re-run analysis"), `the` + TWO spaces (`\s` is one char),
  //             `every/each/which/some/any/both/two`, and the bare plural
  //             ("Rerun analyses showed…").
  //
  // A blocklist of "things that could precede a noun" is a hand-maintained
  // mirror of ENGLISH (CLAUDE.md trap 12) and it drifted at birth. It is
  // replaced by a POSITIVE allowlist of left contexts in which a following
  // token is genuinely a verb, which fails SAFE by construction: an
  // unrecognised left context declines and the turn falls through to the LLM
  // router — the behaviour before this pre-route existed.
  //
  // The shapes an allowlist cannot reach on its own are the ones whose left
  // context legitimately IS a licensed position — a sentence start, a comma, an
  // `and`, a `now` — while the words after it are a noun phrase, not a command.
  // Those are closed structurally instead, in the object group below: EVERY
  // BARE NOUN OBJECT REQUIRES A DETERMINER; only PRONOUN objects (it / this /
  // that) may stand alone.
  //
  // ⚠ THE RULE WAS ONE INFLECTION TOO NARROW WHEN FIRST WRITTEN, and the pin
  // that introduced it contradicted itself: it required a determiner for the
  // PLURAL ("Rerun analyses showed a different leader." → declined) while the
  // SINGULAR, one letter different, still EXECUTED ("Rerun analysis showed a
  // different leader." → invocations=1 at path level). The rationale given for
  // the plural rule — "Re-run the analyses" is an instruction, "Rerun analyses"
  // is a heading — applies verbatim to the singular; it was simply not carried
  // across. Fifteen nominal readings were measured still reaching the handler,
  // among them:
  //   "Rerun analysis showed a different leader."  "Rerun model was stale."
  //   "As noted, rerun analysis was inconclusive."
  //   "According to rerun analysis, capacity was higher."
  //   "Right now rerun analysis is queued."
  //   "Both the baseline and rerun analysis showed the same leader."
  // Each has a LICENSED left context (sentence start, comma, `and`, `now`) and
  // a bare noun after it, which is exactly the gap a left-context rule cannot
  // see. Requiring the determiner is a strict TIGHTENING, so every must-decline
  // pin stays green by construction; measured cost to the must-fire set: zero.
  //
  // Pronouns are deliberately exempt: "Re-run it." / "Re-run this." are
  // complete instructions and have no nominal reading to confuse them with.
  //
  // WHAT IS ACTUALLY CLAIMED, stated so nobody inherits a third overclaim: the
  // token must carry an object AND sit in one of the ten left contexts on the
  // allowlist. This is NOT a proof that no nominal reading survives — it is a
  // change of DEFAULT. Under the blocklist an unlisted context EXECUTED; under
  // the allowlist an unlisted context DECLINES. So a new counterexample is
  // still expected, but it now costs a fallen-through turn instead of a
  // destroyed analysis. Treat a new counterexample as expected; treat a new
  // EXECUTION as a serious defect.
  /\bre-?run\b\s+(?:(?:the|this|that|my|our)\s+(?:analysis|analyses|model|scenario|numbers)|(?:it|this|that))\b/i,
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
  // Every OCCURRENCE is checked, not merely the first: one message can carry a
  // nominal use AND a real instruction — "The re-run analysis was odd. Re-run
  // the model." and "Check the re-run analysis, then re-run the model." both
  // dispatch (verified), and stopping at the first match would decline them
  // because the first occurrence is the nominal one.
  //
  // ⚠ The connective must itself be on the allowlist. "…was odd, SO re-run the
  // model." DECLINES, because `so` is not listed. That is a real gap, and it is
  // in the safe direction (fall through to the LLM). Listed among the declines
  // documented on the allowlist above rather than papered over here.
  for (const re of IMPERATIVE_RERUN_PATTERNS) {
    const scanner = new RegExp(
      re.source,
      re.flags.includes('g') ? re.flags : `${re.flags}g`,
    );
    let m: RegExpExecArray | null;
    while ((m = scanner.exec(trimmed)) !== null) {
      if (m[0].length === 0) {
        scanner.lastIndex += 1;
        continue;
      }
      if (isVerbPosition(trimmed, m.index)) return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// EXPLICIT-ANALYSIS-REQUEST — the admission half of the analysis-election
// gate (`analysis-election-gate.ts`).
// ─────────────────────────────────────────────────────────────────────────
//
// ⭐ DERIVED FROM THE PRODUCER, NOT FROM A CORPUS (preamble P7). The rule this
// predicate enforces is not invented here: it is the sentence the SERVED
// routing prompt already states to the model. Read at the bytes on
// `src/orchestrator-v5/context/__tests__/fixtures/served-orchestrator-prompt.txt`,
// whose sha256 is `adcc5128d4e6e6bc…` — byte-identical to
// `Prompts/canonical/manifest.json`'s `routing` v120 `cee_content_hash_16`,
// i.e. the prompt identity observed on the wire (`routing=120#adcc5128`):
//
//   line 134  "COMPUTATION:
//              - run_analysis: only for explicit requests to run, rerun,
//                simulate or analyse. Target the goal. Never use it to explain
//                results, drivers, robustness or what would change."
//
// The four verbs below ARE that sentence's four verbs. The gate makes an
// instruction the model is already given, and violates on a measured ~43.8% of
// turn-2 follow-ups, ENFORCING instead of advisory.
//
// ⚠⚠ WHY THIS IS A SECOND PREDICATE AND NOT A WIDENING OF
// `looksLikeImperativeRerun` (CLAUDE.md trap 21 — two questions under one
// name). The two answer DIFFERENT QUESTIONS and therefore have OPPOSITE safe
// directions:
//
//   `looksLikeImperativeRerun`  "may I EXECUTE an analysis with no LLM call?"
//                               A false positive DESTROYS the user's computed
//                               result, so it must fail CLOSED. Its four
//                               oscillation rounds and its determiner rule all
//                               exist to keep it narrow.
//
//   `looksLikeExplicitAnalysisRequest`
//                               "may I HONOUR an analysis the LLM already
//                               elected?" A false NEGATIVE demotes a genuine
//                               request to a conversational answer that still
//                               offers the analysis as a chip — one extra
//                               click. A false POSITIVE reproduces today's
//                               staging behaviour EXACTLY and adds no new harm
//                               class, because the election was going to be
//                               honoured anyway. So it may fail OPEN.
//
// Merging them would force one window to serve two opposite defaults, which is
// the precise shape trap 22b bans. They share the SAFETY ENVELOPE
// (`RERUN_NEGATION_VETO_PATTERNS`, `RERUN_INTERROGATIVE_VETO_PATTERNS`,
// `isVerbPosition`) by REUSE rather than by copy, so there is no second
// hand-maintained mirror of English (trap 12).
//
// ⚠ ON THE DETERMINER. `IMPERATIVE_RERUN_PATTERNS` requires a determiner on a
// bare noun object, because a nominal reading there costs a destroyed
// analysis. Here the determiner is OPTIONAL, and that is a deliberate
// asymmetry with a measured reason: the product's own most-emitted run chip
// says exactly `"Run analysis."` (`no-analysis-guard.ts`,
// `draft-graph-dispatch.ts`, `edit-graph-dispatch.ts`, and `chip-generator`'s
// `executableChip` via `USER_FACING_LABELS.run_analysis`). A user who types
// back the sentence the product printed must be honoured — preamble P8, the
// repair-binding invariant: never emit an affordance whose direct answer the
// system then refuses. Admitting the nominal reading alongside it costs
// nothing this gate is responsible for, per the fail-open argument above.
//
// ⚠ KNOWN-DROPPED, pinned by test rather than papered over (trap 22f's honest
// -gap rule). The left-context allowlist is REUSED unchanged, so every shape
// it declines for the re-run predicate is declined here too — "Just run the
// analysis.", "You should run the analysis.", "I want you to analyse this."
// Each costs one click on the offered chip, never a wrong action. The set is
// pinned EXACTLY in `analysis-election-gate.test.ts`, so it REDs if it grows
// OR shrinks.

/**
 * The four verbs the served routing prompt names at line 134, plus their
 * `re-` inflections. Single-sourced so the pattern list below and any future
 * consumer cannot drift from the prompt sentence they encode.
 */
const ANALYSIS_REQUEST_VERB_SOURCE =
  String.raw`(?:re-?)?(?:run|simulate|analy[sz]e)`;

/**
 * Objects that make the verb an analysis instruction rather than an unrelated
 * imperative ("run the numbers" vs "run the shop"). Pronoun objects are
 * admitted bare, exactly as in `IMPERATIVE_RERUN_PATTERNS`; noun objects take
 * an OPTIONAL determiner (see the determiner note above).
 */
const ANALYSIS_REQUEST_OBJECT_SOURCE = String.raw`(?:(?:the|this|that|my|our|a|an)\s+)?(?:provisional\s+)?(?:analysis|analyses|simulation|model|scenario|numbers|decision|graph)|(?:it|this|that)`;

const EXPLICIT_ANALYSIS_REQUEST_PATTERNS: readonly RegExp[] = [
  // "Run analysis.", "Run the analysis.", "Simulate the model.",
  // "Analyse this decision.", "Re-run the numbers.", "Analyse it."
  new RegExp(
    String.raw`\b${ANALYSIS_REQUEST_VERB_SOURCE}\s+(?:${ANALYSIS_REQUEST_OBJECT_SOURCE})\b`,
    'i',
  ),
  // Bare `re-`-prefixed instruction with no object: "Re-analyse.", "Rerun."
  // is deliberately NOT here — a bare `rerun` is the nominal shape that cost
  // the sibling predicate two rounds. Only the explicit re-analysis verb,
  // which has no common nominal reading, stands alone.
  /\bre-?analy[sz]e\b/i,
];

/**
 * True when the message is an EXPLICIT request to run, rerun, simulate or
 * analyse — the admission condition the served routing prompt already states
 * for `run_analysis` (see the block comment above).
 *
 * Pure and total. No LLM. Shares the negation veto, the interrogative veto and
 * the verb-position allowlist with {@link looksLikeImperativeRerun} by reuse.
 *
 * Deliberately returns TRUE for messages {@link looksLikeImperativeRerun} also
 * matches: this predicate is a superset, and the re-run predicate remains the
 * only one authorised to DISPATCH without an LLM.
 */
export function looksLikeExplicitAnalysisRequest(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length === 0) return false;
  // Refusal outranks everything: "Don't run the analysis yet."
  for (const re of RERUN_NEGATION_VETO_PATTERNS) {
    if (re.test(trimmed)) return false;
  }
  // A question ABOUT whether to analyse is not a request to analyse. The
  // prompt's own word is "explicit requests"; "Should I run the analysis?" is
  // a `rerun_question` for `classifyAnalyticalIntent`, not an instruction.
  for (const re of RERUN_INTERROGATIVE_VETO_PATTERNS) {
    if (re.test(trimmed)) return false;
  }
  for (const re of EXPLICIT_ANALYSIS_REQUEST_PATTERNS) {
    const scanner = new RegExp(
      re.source,
      re.flags.includes('g') ? re.flags : `${re.flags}g`,
    );
    let m: RegExpExecArray | null;
    while ((m = scanner.exec(trimmed)) !== null) {
      if (m[0].length === 0) {
        scanner.lastIndex += 1;
        continue;
      }
      if (isVerbPosition(trimmed, m.index)) return true;
    }
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
  // ⚠ SIBLING-LIST DIVERGENCE, recorded at BOTH sites. This list carries four
  // contracted negators that `RERUN_NEGATION_VETO_PATTERNS` (above) does not —
  // `won't` · `shouldn't` · `wouldn't` · `doesn't` — while both express "the
  // user is refusing". `didn't` is absent from BOTH. If you extend either list,
  // extend both; see the fuller note on the veto list for why this one is not
  // load-bearing for the re-run pre-route.
  //
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
