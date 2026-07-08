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

// `findSuccessClaimHit` is the runtime detector (mutation-receipt honesty
// class): prose that claims "done / updated / applied" before a confirmation
// exists. Used by D6 — false-success claim.
export { findSuccessClaimHit } from '../../../src/orchestrator-v5/compose/forbidden-user-facing-phrases.js';

// NOTE on D5 (held-science vocabulary): the runtime's
// `HELD_SCIENCE_VOCABULARY_PATTERN` is deliberately NOT re-exported here.
// Verified 2026-07-08 (prompt-workstream co-owner, corroborated independently
// while building this fixture): that pattern bans `influence` and
// `vulnerable` — but the orchestrator terminology map MANDATES those exact
// words as the required plain-language replacement for driver/sensitivity
// prose ("has the biggest influence on the outcome", "the most vulnerable
// assumption"). Importing it wholesale would fail every compliant orchestrator
// response. The runtime pattern was built for a different surface (Cap-1/
// Cap-2A held-science REJECTION copy, where the words are banned outright,
// not replaced) — it is the wrong source of truth for this dimension. D5 is
// therefore an EVAL-ASSERTION (see held-science.ts), not a production-guard
// re-export, scoped to the raw-metric-token / raw-decimal leak the
// terminology map actually forbids.
