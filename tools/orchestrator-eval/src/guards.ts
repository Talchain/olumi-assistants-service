/**
 * orchestrator-eval — production guard surface.
 *
 * THE RULE FOR THIS FILE: it re-exports the runtime's OWN guards. It must
 * never re-specify a forbidden-term list, a mutation-language pattern, or any
 * other honesty rule. The whole point of the eval-pack is that the gate scores
 * candidate prompts with the SAME code the runtime uses to strip/replace bad
 * output — so a prompt cannot pass the eval and then fail in production (or
 * vice-versa). A re-specified copy would drift from the runtime the moment
 * either side changed; the graph-evaluator's orchestrator-scorer already
 * demonstrates that failure mode (it carries its own BANNED_TERMS array).
 *
 * If a new honesty rule is needed, add it to the runtime's single source of
 * truth (`src/orchestrator-v5/compose/forbidden-user-facing-phrases.ts` or
 * `src/orchestrator-v5/routing/mutation-language.ts`) and it flows here for
 * free.
 */

// `findForbiddenMatches` composes the runtime's FORBIDDEN_USER_FACING_PHRASES
// (imported from src) with raw-id / graph-hash / dev-phrase leak detection.
// It is the same function the v5 replay harness threads through, so eval and
// replay agree on the contradiction list.
export { findForbiddenMatches } from '../../v5-journey-replay/forbidden-terms.js';

// `containsMutationLanguage` is the runtime detector used by
// `validateExplanationAnswer` and the turn-executor STEP 6 safety check: prose
// that reads as if a graph mutation happened when none did.
export { containsMutationLanguage } from '../../../src/orchestrator-v5/routing/mutation-language.js';
