/**
 * Value-update negative gate for `edit_graph` dispatch (P0 fix, 2026-05).
 *
 * Suppresses `edit_graph` LLM dispatch for clear value-update phrasings so
 * they reach TurnExecutor + Sonnet's tool-use path (set_factor_value /
 * add_constraint / adjust_edge_strength) instead of the fragile
 * `edit_graph` LLM JSON path. The gate is intentionally narrow — when in
 * doubt, the message stays on the existing edit_graph route.
 *
 * Four layers of protection:
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
 *   4. CONSTRAINT DIRECT-OBJECT CLAUSE (clause D) — `add/apply/put/place`
 *      + optional article/adjective + `constraint(s)` is an unambiguous
 *      `add_constraint` intent. Required because the V4 edit_graph lane
 *      has no constraint operation whatsoever. `set` is excluded on
 *      purpose (deterministic pre-route collision — see
 *      CONSTRAINT_INTENT_VERBS).
 *
 *   Matches (suppressed → routed to TurnExecutor):
 *     "set churn to 5%"
 *     "update existing team maturity to mid-weight developers"
 *     "update the existing team maturity to be mid-weight developers"
 *     "increase price by 10%"
 *     "decrease the cost by half"
 *     "add a constraint on Key Talent Attrition"            (clause D)
 *     "place a hard constraint on headcount"                (clause D)
 *
 *   Does NOT match (kept on the edit_graph LLM route):
 *     "add a factor for budget constraint"   (add_node; label ≠ intent)
 *     "remove the constraint on churn"       (add_constraint cannot remove)
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
 * Verbs deliberately excluded from clauses A/B:
 *   - `add` and `remove`: structural (add_node / remove_node).
 *   - `change`: ambiguous (could be value or kind change).
 *   - `tweak` / `modify` / `edit`: too vague to determine intent.
 *
 * NOTE: clause D (constraint phrasings) re-admits `add` ONLY when its
 * direct object is the noun "constraint" — an unambiguous add_constraint
 * intent, never an add_node one. The exclusion above still holds for every
 * other `add` shape.
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

import { decomposeEditMessage } from '../../orchestrator-v5/routing/edit-part-decomposition.js';

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

/**
 * Clause C — goal-target phrasings (lane 20). Verbs that may drive the
 * explicit "success target" noun phrase. Broader than the clause-A verb set
 * (the noun disambiguates: "raise the success target" is unambiguously a
 * value intent, unlike bare "raise X").
 */
const GOAL_TARGET_VERBS: ReadonlyArray<string> = Object.freeze([
  ...VALUE_UPDATE_VERBS_TO,
  ...VALUE_UPDATE_VERBS_BY,
  'change',
  'adjust',
  'make',
]);

/**
 * Clause C — `<verb> … success target …` (lane 20).
 *
 * The live staging leak (scenario 55df6984…, turn fac8dc19…, 2026-07-07):
 * "Set a success target OF a 15% cost reduction …" carries no ` to `, so
 * clause A never fired, the message dispatched to the edit_graph LLM, and
 * the edit stamped non-contract fields (`value`/`type`/`description`) onto
 * the goal node under a false "Success target … set" receipt — while the
 * canonical goal-threshold contract (`goal_threshold_raw`/`_unit`/`_cap`/
 * `goal_threshold`, the ONLY fields `has_goal_target` / the UI goal chip /
 * PLoT's explicit-threshold path read) stayed unwritten. Goal-target
 * registration is `add_constraint`'s contract (router tool-schema teaches
 * it; validation-registry accepts entity kind 'goal'; the lane-15 join
 * stamps the quad in the same validated write), so these phrasings MUST
 * reach the TurnExecutor tool-use path.
 *
 * Shape: gate verb, then at most 4 tokens (articles/adjectives — "a new",
 * "our", "the current"), then the literal noun phrase. The tight token
 * window keeps figurative distant co-occurrence ("update the model and
 * describe the success target") out of the gate; the preposition is
 * deliberately unconstrained (of/to/at/…) — that variance is exactly what
 * clause A missed.
 */
const GOAL_TARGET_PATTERN_SOURCE =
  String.raw`\b(?:${GOAL_TARGET_VERBS.join('|')})\b(?:\s+\S+){0,4}?\s+success\s+target\b`;

/**
 * Clause D — constraint phrasings (add_constraint dead-letter closure).
 *
 * Verbs that drive an ADD-a-constraint intent.
 *
 * Excludes `remove` / `delete`: `add_constraint` only adds (there is no
 * remove_constraint handler), so routing a removal to the TurnExecutor
 * tool-use path would trade one dead end for another. Removals keep their
 * existing edit_graph route.
 *
 * Excludes `set` — DELIBERATELY, and this exclusion is load-bearing.
 * Suppressing edit_graph routes the message to TurnExecutor, whose FIRST
 * stop is the deterministic value-update pre-route
 * (`orchestrator-v5/routing/deterministic-value-update.ts`). That module's
 * `EDIT_VERB_PATTERN` is `increase|decrease|reduce|raise|lower|set|change|
 * update|make|adjust` — it contains `set` but NOT `add`/`apply`/`put`/
 * `place` (measured) — and it has NO notion of "constraint" / "at most" /
 * "at least" anywhere in the module. So "Set a constraint on churn of at
 * most 5%" would satisfy its verb + quantity (5%) + factor-candidate
 * (churn) predicates and be claimed as a VALUE update, silently setting
 * churn's value to 5% when the user asked for a 5% CEILING. That is a
 * wrong mutation — strictly worse than the dead end this clause exists to
 * fix. `add` (the verb the #464 refusal actually promises, and the verb
 * its `chip_prompt_refuse_constraint` chip replays) does not collide, so
 * it falls through to the tool-use path and reaches `add_constraint`.
 * Omitting `set` leaves "set a constraint …" exactly where it is today
 * (edit_graph) — no regression, no new harm. Re-admitting `set` here
 * REQUIRES teaching the deterministic pre-route to stand down on
 * constraint phrasings first.
 */
const CONSTRAINT_INTENT_VERBS: ReadonlyArray<string> = Object.freeze([
  'add',
  'apply',
  'put',
  'place',
]);

/**
 * Adjectives tolerated between the article and the constraint noun
 * ("a hard constraint", "an upper constraint"). A closed list rather than
 * an open token window — see CONSTRAINT_PATTERN_SOURCE.
 */
const CONSTRAINT_ADJECTIVES: ReadonlyArray<string> = Object.freeze([
  'hard',
  'soft',
  'new',
  'additional',
  'upper',
  'lower',
  'maximum',
  'minimum',
  'max',
  'min',
]);

/**
 * Clause D — `<add-intent verb> [article] [adjective] constraint(s)`.
 *
 * The live dead letter (3 probes, 2026-07-15, all `exit_path: edit_graph`,
 * 0 blocks, no constraint EVER added): PR #464 ships an honest refusal for
 * value-edits on non-factor nodes whose closing sentence promises "If you
 * want to hold <label> to a limit, ask me to add a constraint on it" and
 * renders a `chip_prompt_refuse_constraint` chip replaying "Add a
 * constraint on <label>." That text matches EDIT_GRAPH_POSITIVE_REGEX via
 * `add`, is caught by NO clause here (`add` is excluded from clauses A/B as
 * structural — see "Verbs deliberately excluded" above), and so dispatches
 * to the V4 edit_graph LLM. That lane has NO constraint operation at all:
 * it no-ops and emits `buildEditClarifyFallbackParts`' "factor, edge,
 * option, or value" clarifier — whose vocabulary tellingly has no
 * "constraint" in it. A fully specified probe ("...of at most 0.5")
 * returned byte-identical copy, proving under-specification was never the
 * cause. #464 thus fixed a 1-hop dead end and shipped a 2-hop one.
 *
 * Everything downstream already exists and is tested: `add_constraint` is
 * registered (`tools/registry.ts`), the router tool-schema teaches it
 * (`orchestrator-v5/routing/tool-schema.ts`), and risk-kind targets are in
 * `ALLOWED_TARGET_KINDS` with proven PLoT forwarding
 * (`add-constraint-risk-forwarding.test.ts`). ONLY the route was missing —
 * the same defect, in the same file, as clause C above, which exists
 * verbatim because "Goal-target registration is add_constraint's contract
 * ... so these phrasings MUST reach the TurnExecutor tool-use path".
 *
 * Shape — DIRECT OBJECT, not a token window. Clause C's looser
 * `(?:\s+\S+){0,4}?` window was tried first and measured to match "Add a
 * factor for budget constraint" / "Add a risk called supply constraint" —
 * structural add_node requests whose NEW NODE merely has "constraint" in
 * its label. Stealing those from edit_graph would be a fresh defect, so
 * clause D requires the constraint noun to be the verb's direct object
 * (optional article + closed adjective list only). Locked by the
 * `NON_SUPPRESS_CASES` regression rows.
 */
const CONSTRAINT_PATTERN_SOURCE =
  String.raw`\b(?:${CONSTRAINT_INTENT_VERBS.join('|')})\s+${ARTICLE_PREFIX}` +
  `(?:(?:${CONSTRAINT_ADJECTIVES.join('|')})\\s+){0,2}constraints?\\b`;

// Whole-regex with the meta-noun guard at position 0. Use the multi-line
// `String.raw` literal-free composition so the structure is auditable.
const VALUE_UPDATE_REGEX = new RegExp(
  `${META_NOUN_GUARD}(?:${SET_UPDATE_TO_PATTERN_SOURCE}|${NUMERIC_BY_PATTERN_SOURCE}|${GOAL_TARGET_PATTERN_SOURCE}|${CONSTRAINT_PATTERN_SOURCE})`,
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
 * Route-v2's ACTUAL suppression predicate (part-accounting conservation
 * law, rehearsal defect A, 2026-07-20).
 *
 * `isValueUpdatePhrasing` alone suppressed edit_graph dispatch for ANY
 * message containing a value-update clause — including MIXED messages
 * ("Set Support cost to 30 and add a new factor called Shipping costs")
 * whose structural half the deterministic value lane then silently
 * swallowed: the single-substring auto-dispatch consumed the whole
 * message, applied the value part, and the add-factor part terminated
 * NOWHERE. That is the same silent half-drop class the 2026-07-20
 * rehearsal exposed on the LLM lane.
 *
 * The fix stands the suppressor DOWN when intake decomposition finds a
 * value part mixed with a structural/link part: the whole message then
 * reaches the edit_graph lane — the only lane that can serve both halves
 * in one batch — where the part-accounting law (edit-graph-dispatch.ts)
 * guarantees every part terminates visibly. Pure value updates (including
 * #549's value+value compounds) and single-part messages are unchanged:
 * `decomposeEditMessage` reports mixedValueStructural=false for them.
 *
 * NOTE: `isValueUpdatePhrasing` itself is deliberately untouched — its
 * other consumer (vague-edit-guard) must keep seeing mixed messages as
 * value-bearing so it never claims them as vague edits.
 */
export function shouldSuppressEditDispatchForValueUpdate(message: string): boolean {
  if (!isValueUpdatePhrasing(message)) return false;
  return !decomposeEditMessage(message).mixedValueStructural;
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
  GOAL_TARGET_VERBS,
  CONSTRAINT_INTENT_VERBS,
  CONSTRAINT_ADJECTIVES,
});
