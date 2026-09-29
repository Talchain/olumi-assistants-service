/**
 * Canonical per-handler user-safe recovery copy for D1 mutation handlers.
 *
 * P1.1 follow-up (P1.2): every `D1HandlerError` thrown by a D1 mutation
 * handler must set `userGuidance` to its handler's canonical phrase so
 * that the recoverable composer can surface it as `assistant_text`
 * without leaking handler IDs (`add_constraint`, `set_factor_value`,
 * `adjust_edge_strength`), quoted parameter names (`"value"`,
 * `"constraint_type"`, `"strength"`), enum literals (`at_least`,
 * `at_most`), or other internal field names.
 *
 * War-Room locked phrases — do not edit without authorisation. Adding a
 * phrase for a fourth D1 handler requires a War Room decision, NOT
 * inventing wording inline.
 *
 * Why per-handler (not per-cause-kind): the canonical phrase is a
 * product-voice generalisation of "I tried to do X and could not." The
 * cause-kind (`parameter_invalid_at_execute`,
 * `entity_not_found_in_graph`, etc.) is internal taxonomy that the
 * user does not need; the handler's *intent* is what the user
 * understands. The composer in
 * `src/orchestrator-v5/compose/handler-failure-responses.ts` reads
 * `details.specific_issue` and uses it as the full assistant_text when
 * present, so the per-cause hardcoded copy is the fallback for throws
 * that did not set `userGuidance`.
 */

export const ADD_CONSTRAINT_USER_GUIDANCE =
  'I could not apply that constraint because the target or constraint details were not valid.';

export const SET_FACTOR_VALUE_USER_GUIDANCE =
  'I could not update that value because the target or value was not valid.';

export const ADJUST_EDGE_STRENGTH_USER_GUIDANCE =
  'I could not apply that edit because it no longer matched the current model.';

/**
 * ⭐ THE ONE USER-VOICED REFUSAL IN `add-constraint.ts` THAT IS SHOWN AS-IS.
 *
 * Every other failure on that handler gets {@link ADD_CONSTRAINT_USER_GUIDANCE}
 * — deliberately, because the precise messages leak node ids and schema jargon.
 * This one passes both gates and is therefore routed to the user instead:
 *
 *   VOCABULARY — every term is one the product has already shown. "Success
 *   target value" is a labelled field in the interface and "Get help defining
 *   the success target" is its help copy. The test is whether the user has MET
 *   the term, not whether the sentence reads well; a sentence can be flawless
 *   English and still name a concept the product invented and never taught.
 *
 *   BUDGET — 76 characters against `sanitiseForUser`'s 100. Exported rather
 *   than inlined at the throw precisely so the budget guard's union assertion
 *   sees it: a `*_USER_GUIDANCE` constant is covered automatically, an inline
 *   string is not.
 */
export const SUCCESS_TARGET_POSITIVE_USER_GUIDANCE =
  'A success target must be a positive number — tell me the target value again.';
