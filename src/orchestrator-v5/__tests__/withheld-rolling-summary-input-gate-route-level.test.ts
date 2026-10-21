/**
 * G-CEE-1 — THE ROLLING SUMMARY's leader sentence vs the shared alarm vocabulary.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS LEFT, AND WHY.
 *
 * This file used to pin the rolling-summary input gate: `inject.ts` rendered
 * `scenarios.rolling_summary` into `ContextPack.conversation_summary.text`, and
 * `withheld-history-redaction.ts` redacted leader claims out of it on a
 * withheld turn. Both modules were deleted in deletion 8 (22 Oct 2026) as
 * unreachable from `src/server.ts`, together with every row that exercised
 * them. Verbatim copies: `evidence/track2-deletion8-20261022/deleted/`.
 *
 * What survives is the two INSTRUMENT rows' assertions on the LIVE shared
 * alarm reading `textNamesLeadingOption`, on the live bytes of historic
 * scenario `f63ccb45`'s `RESOLVED` slot:
 *
 *   "Current analysis shows Double Down on SMB leading 52% vs Enterprise 35%,
 *    but result is fragile and sensitive to sales win rate assumptions."
 *
 * ⚠ The shared alarm is BLIND to that sentence — measured. `\bleads\b` is
 * present-tense; the live string is the bare participle "leading 52%", which
 * `leading_option` and `leading_in` both require a following word for. If
 * someone widens LEADER_CLAIM_PATTERNS (good), the first row goes red and this
 * characterisation must be re-derived rather than inherited.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';

import { textNamesLeadingOption } from '../compose/leading-option-egress-guard.js';

/**
 * ⭐ THE LIVE BYTES. Transcribed verbatim from the `RESOLVED` slot of
 * `scenarios.rolling_summary` on historic scenario `f63ccb45`.
 */
const LIVE_SUMMARY_LEADER_SENTENCE =
  'Current analysis shows Double Down on SMB leading 52% vs Enterprise 35%, but ' +
  'result is fragile and sensitive to sales win rate assumptions.';

/** The summary's OWN contradicting sentence, three below the claim in the live slot. */
const LIVE_SUMMARY_NO_RANKING_SENTENCE =
  'No ranking can be put forward until the sales win rate link is verified.';

/** A third claim-free sentence from the same slot — the blocker the coach needs. */
const LIVE_SUMMARY_BLOCKER_SENTENCE =
  'The blocker is the unverified link from sales win rate to revenue growth.';

describe('G-CEE-1 — the ROLLING SUMMARY sentences under the shared alarm vocabulary', () => {
  it('INSTRUMENT: the live summary sentence is INVISIBLE to the shared alarm vocabulary', () => {
    // ⭐ THE MEASUREMENT, asserted rather than asserted about.
    expect(textNamesLeadingOption(LIVE_SUMMARY_LEADER_SENTENCE)).toBe(false);
  });

  it('INSTRUMENT: the control sentences are claim-free under the shared alarm vocabulary', () => {
    // False-positive controls: claim-free sentences from the same live slot
    // must not read as naming a leading option.
    for (const sentence of [LIVE_SUMMARY_NO_RANKING_SENTENCE, LIVE_SUMMARY_BLOCKER_SENTENCE]) {
      expect(textNamesLeadingOption(sentence)).toBe(false);
    }
  });
});
