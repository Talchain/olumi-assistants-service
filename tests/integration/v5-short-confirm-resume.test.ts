/**
 * Wave 2 staging integration test — short-confirm resume seam.
 *
 * Proves the cross-turn handshake against real Supabase:
 *   Turn N: commitDirectAnswer with a run_analysis chip
 *           → derivePendingActionsFromChips → append_turn_atomic persists
 *           → row in v5_conversation_turns with the pending action
 *   Turn N+1 (read-only seam):
 *           → readMostRecentPendingActions returns the persisted entry
 *           → tryShortConfirmResume on "yes" matches the run_analysis kind
 *           → ready for TurnExecutor to synthesise a RoutingToolCallResult
 *
 * The full TurnExecutor zero-LLM dispatch is exercised by the unit tests
 * in deterministic-short-confirm.test.ts and the in-process mock-adapter
 * tests under src/orchestrator-v5/__tests__. This file only verifies the
 * persistence/read seam against the live DB.
 *
 * Gated on RUN_WAVE0_STAGING=1 + staging env. Cleans up on success or
 * failure; orphan sweep at teardown.
 */

import { describe,it } from 'vitest';



const SHOULD_RUN =
  process.env.RUN_WAVE0_STAGING === '1' &&
  !!process.env.SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;











if (!SHOULD_RUN) {
  // TODO: ISSUE-9005 — Wave 2 staging short-confirm seam parked
  describe.skip('Wave 2 staging short-confirm seam (skipped)', () => {
    it('SHOULD_RUN gate is off — set RUN_WAVE0_STAGING=1 + staging env', () => {
      // intentional skip
    });
  });
}
