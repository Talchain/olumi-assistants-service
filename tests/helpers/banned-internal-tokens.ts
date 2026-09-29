/**
 * Test-side re-export of the canonical repair-vocabulary denylist used by
 * production scrubbers and leak-protection tests.
 *
 * The canonical list lives at
 * `src/orchestrator/shared/repair-vocabulary-denylist.ts` so production
 * scrubbers and tests share one source of truth. This file exists so
 * test imports stay short and don't reach into deep src/ paths.
 *
 * Update the canonical list in src/orchestrator/shared/ when a new
 * repair / enforcement code or operator-language string enters the
 * codebase.
 */
import { REPAIR_VOCABULARY_DENYLIST } from '../../src/orchestrator/shared/repair-vocabulary-denylist.js';

export const BANNED_INTERNAL_TOKENS: ReadonlyArray<RegExp> = REPAIR_VOCABULARY_DENYLIST;

/**
 * Assert that a user-facing string contains no banned internal vocabulary.
 * Calls the supplied `matchAssertion` callback once per (text, pattern)
 * pair — typically the test's `expect(...).not.toMatch(...)`.
 */
export function assertNoBannedInternalTokens(
  text: string,
  matchAssertion: (text: string, re: RegExp) => void,
): void {
  for (const re of BANNED_INTERNAL_TOKENS) {
    matchAssertion(text, re);
  }
}
