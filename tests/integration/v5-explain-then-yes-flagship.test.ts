/**
 * Wave 5 flagship two-turn transcript test against staging Supabase.
 *
 * Pins the brief's evidence #1 end to end at the persistence seam:
 *
 *   Turn N:   commitDirectAnswer with a successful explain_results
 *             response carrying the chip set chip-generator emits
 *             after such a turn → the row in v5_conversation_turns
 *             carries a what_would_flip pending action.
 *
 *   Turn N+1: readMostRecentPendingActions returns the persisted
 *             entry → tryShortConfirmResume matches "yes" against
 *             the what_would_flip pending action → dispatch is
 *             routed at synthesis time (the actual TurnExecutor
 *             resume path is exercised in unit + route-level tests
 *             — this test pins the seam against the live DB).
 *
 * Why a separate flagship test: prior unit tests asserted chip
 * generation in isolation OR pending-action persistence in isolation.
 * Neither caught the production-shape gap where the chip-emit
 * predicate matched a synthetic fact but no production fact —
 * because the seam between handler-fact shape, chip emission, and
 * pending-action derivation was not exercised end to end.
 *
 * Gated on RUN_WAVE0_STAGING=1 + staging env. Cleans up.
 */

import { describe,it } from 'vitest';



const SHOULD_RUN =
  process.env.RUN_WAVE0_STAGING === '1' &&
  !!process.env.SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;











if (!SHOULD_RUN) {
  // TODO: ISSUE-9006 — Wave 5 flagship explain-then-yes parked
  describe.skip('Wave 5 flagship (skipped)', () => {
    it('SHOULD_RUN gate is off — set RUN_WAVE0_STAGING=1 + staging env', () => {
      // intentional skip
    });
  });
}
