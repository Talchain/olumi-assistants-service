/**
 * ROADMAP 2.1265 — the blocker/claim mutual-exclusion invariant.
 *
 * ⭐⭐ EVERY RULE HERE HAS AN OPPOSITE-DIRECTION TWIN, because this predicate has
 * already produced a defect AND ITS EXACT INVERSE in consecutive rounds, each
 * under a fully green suite (CLAUDE.md trap 22b). The catch direction is cheap
 * to satisfy and worthless alone.
 *
 * THE TRUE-PROSE CORPUS COMES FROM OUTSIDE THIS AUTHOR'S HEAD. It is 688 real
 * `assistant_text` strings, harvested from live wire captures in
 * `olumi-docs/{PHASE0-EVIDENCE-2026-07-28, witness-998-2026-08-16,
 * witness-acceptance-2026-08-17, regression-shield-2026-08-16}` — every reply in
 * those captures that contains a digit, out of 1,323 distinct replies total.
 *
 * ⚠ THE 635 NO-DIGIT REPLIES ARE EXCLUDED BY DERIVATION, NOT BY CONVENIENCE:
 * stage 1 requires `readClaimedNumbers(unit).length > 0`, so a reply with no
 * digit anywhere cannot anchor and cannot be touched. The shipped fixture is
 * therefore the COMPLETE set of live replies the guard could possibly alter.
 * (All 1,323 were also run locally, with the same result.)
 *
 * ⚠ THE FIXTURES ARE HISTORIC RECORDS — APPEND ONLY, NEVER EDIT (trap 14b).
 * They are what the product actually said on dated builds. Rewriting one to
 * keep a test green would falsify the record.
 */

import { describe,expect,it } from 'vitest';

// ⚠ PLAIN JSON IMPORTS, deliberately. The `with { type: 'json' }` form raises
// TS2823 under the repo's test tsconfig (`module` is not esnext/nodenext) — the
// one existing user of that syntax sits in `scripts/ci/typecheck-baseline.txt`
// for exactly this reason, and adding to a baseline is not a fix.
import digitBearingReplies from './fixtures/live-assistant-text-corpus-2026-08-17/digit-bearing-replies.json';
import witness from './fixtures/live-assistant-text-corpus-2026-08-17/j4-t2-fabrication.json';



const FABRICATION: string = witness.assistant_text;

/** The witnessed blocked pair, by id — the anchor for every case below. */






describe('blocked-slot claim guard — OPPOSITE DIRECTION (true prose must survive)', () => {














  it('the witnessed fabrication IS a member of that corpus', () => {
    // Otherwise the exclusion above would be hiding a miss rather than
    // acknowledging the one true positive (positive control for the sweep).
    expect(digitBearingReplies as string[]).toContain(FABRICATION);
  });
});
