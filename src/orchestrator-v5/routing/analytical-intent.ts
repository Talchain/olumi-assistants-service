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
  /\bwhat\s+would\s+need\s+to\s+change\b/i,
  /\bhow\s+(?:could|can|would)\s+(?:another\s+)?option\s+(?:win|look\s+better|come\s+(?:out\s+)?ahead)\b/i,
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
 *   - `rerun_question`  — "is this stale", "do I need to re-run", "is
 *                          this still valid", "should I rerun analysis"
 */
export type AnalyticalIntentClass =
  | 'explain'
  | 'what_drove'
  | 'what_would_flip'
  | 'rerun_question';

interface IntentPattern {
  readonly cls: AnalyticalIntentClass;
  readonly pattern: RegExp;
}

const INTENT_PATTERNS: readonly IntentPattern[] = [
  // ── rerun_question (most specific — anchored on rerun/stale vocabulary) ─
  { cls: 'rerun_question', pattern: /\bdo\s+(?:i|we)\s+need\s+to\s+(?:re-?run|rerun|run\s+again)\b/i },
  { cls: 'rerun_question', pattern: /\bshould\s+(?:i|we)\s+(?:re-?run|rerun|run\s+again)\b/i },
  { cls: 'rerun_question', pattern: /\b(?:is|are)\s+(?:this|these|the|that|those)(?:\s+(?:result|results|analysis|outcome|outcomes))?\s+(?:still\s+)?(?:stale|out\s*of\s*date|outdated|valid|fresh|current)\b/i },
  { cls: 'rerun_question', pattern: /\bdoes\s+(?:this|the\s+(?:analysis|result))\s+need\s+(?:a\s+)?(?:re-?run|rerun|refresh)\b/i },
  { cls: 'rerun_question', pattern: /\bis\s+(?:the\s+)?(?:analysis|result)\s+out\s*of\s*date\b/i },

  // ── what_would_flip ──────────────────────────────────────────────
  { cls: 'what_would_flip', pattern: /\bwhat\s+would\s+flip\b/i },
  { cls: 'what_would_flip', pattern: /\bwhat\s+would\s+change\s+(?:the\s+(?:result|outcome|leading\s+option|analysis|ranking|order)|things)\b/i },
  { cls: 'what_would_flip', pattern: /\bwhat\s+would\s+tip\b/i },
  { cls: 'what_would_flip', pattern: /\bwhat\s+would\s+it\s+take\s+to\s+(?:change|flip|reverse|move)\b/i },
  { cls: 'what_would_flip', pattern: /\bwhat\s+would\s+need\s+to\s+change\b/i },
  { cls: 'what_would_flip', pattern: /\bhow\s+(?:could|can|would)\s+(?:another\s+)?option\s+(?:win|look\s+better|come\s+(?:out\s+)?ahead)\b/i },

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
