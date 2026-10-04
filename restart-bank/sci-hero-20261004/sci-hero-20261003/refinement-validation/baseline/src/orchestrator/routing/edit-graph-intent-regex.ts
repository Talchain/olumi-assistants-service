/**
 * The two edit-intent regexes route-v2 gates `edit_graph` dispatch on.
 *
 * Extracted from `route-v2.ts` (ROADMAP 2.308 / S2) so the product's OWN copy
 * can be tested against the gates it must pass — without importing the whole
 * route module (and its config / telemetry / Supabase side effects) into a
 * unit test. Pure move: both patterns are byte-identical to the route-v2
 * constants they replace, and `route-v2.ts` now imports them from here, so
 * there is one definition, not a mirror.
 *
 * Why this matters concretely: the 2.308 diagnosis found the readiness chip
 * `chip_prompt_set_option_values` was blocked TWICE — NO_MATCH at
 * `detectConfigureOptionIntent`, and a hit on `EDIT_GRAPH_NEGATIVE_REGEX` via
 * the phrasal verb "set up". A copy fix that only satisfied the first gate
 * would still not have dispatched, and nothing could have proven that.
 */

/** Positive edit-intent regex for edit_graph dispatch. */
export const EDIT_GRAPH_POSITIVE_REGEX =
  /\b(change|update|edit|modify|remove|delete|add|adjust|set|reduce|increase|decrease|tweak|raise|lower)\b/i;

/**
 * Negative guard for edit_graph dispatch. If a message contains any of
 * these phrases it is a meta-question or conversational/figurative use of
 * an edit verb, NOT an edit command, and must NOT dispatch even if a
 * positive edit-verb also appears. Mutating the graph on a meta-question
 * is the worst failure mode.
 *
 * Pattern groups:
 *   1. Meta-question markers: "explain", "compare", "what would", "flip",
 *      "why", "how does", "tell me", "show me", "describe".
 *   2. Phrasal verbs that turn an edit verb into a non-mutation: "set up",
 *      "set aside" (procedural framing / deprioritisation, not delete).
 *   3. Figurative / idiomatic uses of edit verbs: "add context",
 *      "remove doubt", "change my mind", "reduce complexity",
 *      "delete this thread", "update our approach", "modify thinking".
 *      These were exposed when the frame-stage gate was removed —
 *      conversational discourse at frame stage previously fell through
 *      to Sonnet only because the stage gate blocked dispatch entirely.
 */
export const EDIT_GRAPH_NEGATIVE_REGEX =
  /\b(?:explain|compare|what would|flip|why|how does|tell me|show me|describe|set up|set aside|add (?:some |any |more )?(?:context|information|detail|details|background)|remove (?:any |the )?(?:doubt|confusion|uncertainty|ambiguity)|change (?:my |our |their )?mind|reduce (?:complexity|scope|noise|clutter)|delete (?:this |the )?(?:thread|conversation|chat|message)|update (?:my |our |their |the )?(?:approach|thinking|understanding|view|perspective)|modify (?:my |our |their )?(?:view|mind|thinking|approach))\b/i;
