/**
 * Value-update negative gate for `edit_graph` dispatch (P0 fix, 2026-05).
 *
 * Suppresses `edit_graph` LLM dispatch for clear value-update phrasings so
 * they reach TurnExecutor + Sonnet's tool-use path (set_factor_value /
 * add_constraint / adjust_edge_strength) instead of the fragile
 * `edit_graph` LLM JSON path. The gate is intentionally narrow — when in
 * doubt, the message stays on the existing edit_graph route.
 *
 * Three layers of protection:
 *
 *   1. META-NOUN GUARD — if the verb's object is "model" / "graph" /
 *      "diagram" (e.g. "update the model to ..."), the request is a
 *      whole-graph quality / structural change, NEVER a value update.
 *      The gate bypasses these entirely so they reach edit_graph LLM.
 *
 *   2. STRUCTURAL / KIND-CHANGE LOOKAHEAD (within a 0-3 token scan
 *      window after `to `) — adverbial fillers like "also include",
 *      "better reflect", "be a factor", "become an outcome" must NOT
 *      let a structural / kind-change request fall through the gate.
 *
 *   3. NUMERIC `by` PATTERN — `(increase|decrease|reduce|raise|lower)
 *      X by Y` is unambiguously a quantity update; suppressed without
 *      the meta-noun guard (no kind/structural ambiguity exists with
 *      `by`).
 *
 *   Matches (suppressed → routed to TurnExecutor):
 *     "set churn to 5%"
 *     "update existing team maturity to mid-weight developers"
 *     "update the existing team maturity to be mid-weight developers"
 *     "increase price by 10%"
 *     "decrease the cost by half"
 *
 *   Does NOT match (kept on the edit_graph LLM route):
 *     "update the model to include market dynamics"
 *     "update the model to also include market dynamics"   (filler)
 *     "update the model to better reflect market dynamics"  (filler)
 *     "update the model to be more realistic"              (meta-noun)
 *     "update the graph to be more complete"               (meta-noun)
 *     "update the model to better represent churn"         (meta-noun + represent)
 *     "set goal to a factor"                               (kind target)
 *     "set goal to be a factor"                            (kind filler)
 *     "update risk X to be an outcome"                     (kind filler)
 *     "set X to be risks"                                  (plural kind)
 *     "update nodes to become options"                     (plural kind)
 *
 * Verbs deliberately excluded from this gate:
 *   - `add` and `remove`: structural (add_node / remove_node).
 *   - `change`: ambiguous (could be value or kind change).
 *   - `tweak` / `modify` / `edit`: too vague to determine intent.
 *
 * Failure modes handled:
 *   - "set X to Y" with no resolvable factor → Sonnet returns a
 *     clarification text response.
 *   - "set X to Y" with type mismatch → Sonnet picks set_factor_value
 *     and the validator catches it via the recoverable path.
 *
 * Both are preferable to the legacy edit_graph LLM JSON-parse failure
 * + "Something went wrong" UX.
 */

// ---------------------------------------------------------------------------
// Tunable subpatterns (table-driven so future edits are localised).
// ---------------------------------------------------------------------------

/**
 * Verbs of inclusion / structural composition / model representation.
 * When one of these follows `to ` (within the scan window) the message
 * is a structural edit and must remain on the edit_graph route.
 */
const STRUCTURAL_KEYWORDS: ReadonlyArray<string> = Object.freeze([
  'include',
  'add',
  'contain',
  'cover',
  'incorporate',
  'comprise',
  'encompass',
  'capture',
  'reflect',
  // 'represent' covers "update the model to better represent churn"
  // — even though the meta-noun guard already rejects "the model"
  // requests, this catches "update X to better represent Y" forms
  // where X is a labelled factor.
  'represent',
]);

/**
 * Canonical `NodeKindV3` keywords plus their plurals. When one of these
 * follows `to ` (within the scan window, with or without an article) the
 * message is a kind-change ("set X to be a factor", "set X to be risks")
 * and must remain on the edit_graph route.
 */
const KIND_KEYWORDS: ReadonlyArray<string> = Object.freeze([
  'factor',
  'factors',
  'risk',
  'risks',
  'outcome',
  'outcomes',
  'option',
  'options',
  'decision',
  'decisions',
  'node',
  'nodes',
  'edge',
  'edges',
]);

/**
 * Whole-graph meta-nouns. When the verb's object is one of these, the
 * request is a model-level quality / structural change and the gate
 * bypasses suppression entirely — even if the rest of the phrasing
 * superficially looks like a value update.
 */
const META_NOUNS: ReadonlyArray<string> = Object.freeze([
  'model',
  'graph',
  'diagram',
]);

/**
 * Verbs that signal a value-update intent in the `<verb> X to Y` form.
 * `add` and `remove` are structural and excluded. `change` is ambiguous
 * (could be value or kind change) and excluded.
 */
const VALUE_UPDATE_VERBS_TO: ReadonlyArray<string> = Object.freeze(['set', 'update']);

/**
 * Verbs that signal a quantity-by-amount intent in the `<verb> X by Y`
 * form. All take a numeric or fuzzy-quantitative `Y`.
 */
const VALUE_UPDATE_VERBS_BY: ReadonlyArray<string> = Object.freeze([
  'increase',
  'decrease',
  'reduce',
  'raise',
  'lower',
]);

/**
 * Tokens between the verb and `to` / `by`. Mirrors common English
 * determiners + possessives that prefix a factor label.
 */
const ARTICLE_PREFIX = String.raw`(?:the\s+|an?\s+|existing\s+|my\s+|our\s+|their\s+)?`;

/**
 * Inter-token allowance between the verb's object and `to` / `by`.
 * Caps at 5 / 3 tokens so the gate stays narrow. Named for what they
 * describe (the span of words covering the verb's object) rather than
 * an arbitrary token-run.
 */
const OBJECT_WINDOW_TO = String.raw`\S+(?:\s+\S+){0,5}`;
const OBJECT_WINDOW_BY = String.raw`\S+(?:\s+\S+){0,3}`;

/**
 * Look-ahead scan window after `to ` — 0-3 tokens of filler tolerated
 * before the structural / kind keyword. This catches adverbial fillers
 * like "also include", "better reflect", "be a factor", "become an
 * outcome" so structural/kind-change requests are NOT swept into the
 * value-update gate.
 */
const SCAN_WINDOW = String.raw`(?:\S+\s+){0,3}`;

// ---------------------------------------------------------------------------
// Composed regexes
// ---------------------------------------------------------------------------

/**
 * Whole-message guard — when the verb's object is a meta-noun (model /
 * graph / diagram), the request is a structural change and the gate
 * MUST NOT match. Implemented as a top-level negative lookahead at
 * position 0 of the regex (case-insensitive flag covers `Model`).
 *
 * Example matches that this guard rejects:
 *   "update the model to be more realistic"
 *   "update the graph to be more complete"
 *   "update model to better represent churn"     (no article)
 */
const META_NOUN_GUARD =
  `(?!\\s*(?:${VALUE_UPDATE_VERBS_TO.join('|')})\\s+${ARTICLE_PREFIX}` +
  `(?:${META_NOUNS.join('|')})\\b)`;

const STRUCTURAL_OR_KIND_LOOKAHEAD =
  // Verbs of inclusion within the scan window
  `(?!${SCAN_WINDOW}(?:${STRUCTURAL_KEYWORDS.join('|')})\\b)` +
  // Kind target with optional article within the scan window. The
  // article-and-kind alternation handles both "to a factor" and
  // "to be a factor" / "to factor" by allowing the scan window to
  // consume the bridge ("be" / "become") and the optional article.
  `(?!${SCAN_WINDOW}(?:a|an|the)\\s+(?:${KIND_KEYWORDS.join('|')})\\b)` +
  `(?!${SCAN_WINDOW}(?:${KIND_KEYWORDS.join('|')})\\b)`;

const SET_UPDATE_TO_PATTERN_SOURCE =
  String.raw`\b(?:${VALUE_UPDATE_VERBS_TO.join('|')})\s+${ARTICLE_PREFIX}` +
  `${OBJECT_WINDOW_TO}\\s+to\\s+` +
  `${STRUCTURAL_OR_KIND_LOOKAHEAD}\\S`;

const NUMERIC_BY_PATTERN_SOURCE =
  String.raw`\b(?:${VALUE_UPDATE_VERBS_BY.join('|')})\s+${ARTICLE_PREFIX}` +
  `${OBJECT_WINDOW_BY}\\s+by\\s+\\S`;

// Whole-regex with the meta-noun guard at position 0. Use the multi-line
// `String.raw` literal-free composition so the structure is auditable.
const VALUE_UPDATE_REGEX = new RegExp(
  `${META_NOUN_GUARD}(?:${SET_UPDATE_TO_PATTERN_SOURCE}|${NUMERIC_BY_PATTERN_SOURCE})`,
  'i',
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the message is a clear value-update phrasing that
 * should bypass `edit_graph` and be handled by the deterministic D1 /
 * Sonnet tool-use path. Returns `false` for everything else (including
 * structural edits, kind changes, model-quality updates, and ambiguous
 * requests).
 *
 * The meta-noun guard fires BEFORE the gate's internal lookaheads — when
 * the verb's object is "model" / "graph" / "diagram", any `to <Y>` /
 * `by <Y>` phrasing in the message stays on the edit_graph route, even
 * if the rest of the structure superficially looks like a value update.
 * For example: "update the model to be more realistic" is structural,
 * not a value update.
 */
export function isValueUpdatePhrasing(message: string): boolean {
  return VALUE_UPDATE_REGEX.test(message);
}

/**
 * Test-only export of the composed regex and frozen keyword arrays so
 * unit tests can also assert directly on the regex without invoking the
 * predicate. Production code should call `isValueUpdatePhrasing`.
 *
 * Arrays are `Object.freeze`'d at module scope so tests cannot mutate
 * module state by accident.
 */
export const __testOnly = Object.freeze({
  VALUE_UPDATE_REGEX,
  STRUCTURAL_KEYWORDS,
  KIND_KEYWORDS,
  META_NOUNS,
  VALUE_UPDATE_VERBS_TO,
  VALUE_UPDATE_VERBS_BY,
});
