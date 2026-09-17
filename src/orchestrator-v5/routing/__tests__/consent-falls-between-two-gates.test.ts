/**
 * KNOWN GAP, PINNED: natural consent falls between two pre-route gates.
 *
 * From Paul's manual session on staging, 17 Sep 2026
 * (`olumi-debug-6edb1cdb-20260917.json`). Three messages, all plainly consent
 * to a change the product had just offered and was HOLDING with
 * `pending_emitted: true`. One resumed; two fell through to the LLM, which
 * replied "I don't have a stored suggestion in view that matches 'make the
 * updates' cleanly."
 *
 * ── THE MECHANISM, and it is two correct predicates with a hole between them ──
 * `isClaimableByClarificationResume` refuses any message containing an edit
 * verb — deliberately, as defence in depth, so it cannot steal messages
 * belonging to the confirm / value-update pre-routes.
 * `SHORT_CONFIRM_LIKELIHOOD` is anchored `^\s*`, so consent must OPEN the
 * message.
 * A polite consent that names the action — "Please can you add this option?" —
 * is too verb-y for the first and not front-anchored for the second. Neither
 * claims it. Each gate is right about its own scope; nothing owns the overlap.
 *
 * ── WHY THIS IS A PIN AND NOT A FIX ──
 * Widening either predicate is a change to a MUTATION consent rule, where a
 * false positive applies a graph change the user did not authorise. This estate
 * oscillated four rounds on a neighbouring natural-language predicate and the
 * ruling was to stop writing rules and make the ambiguity the product. So the
 * gap is recorded here, exactly, rather than papered over: the suite stays green
 * for the right reason and REDs if the set changes in EITHER direction.
 *
 * The intended fix is a re-offer, not a wider gate: with exactly one live
 * pending, an unclaimed consent-shaped message should surface "you have one
 * change waiting: X — reply yes to apply", which costs a round trip and cannot
 * mutate anything the user did not name. That needs coordination with the CEE
 * orchestration lane, which owns the adjacent pre-route ordering.
 *
 * ⭐ THE WIRE CALLS THESE GATES BY DIFFERENT NAMES THAN THE CODE DOES, AND
 * THAT COST A ROUND TRIP. Render logs for the witnessed turn (18:12:12Z) read
 * `v5.pending_action.skipped reason=message_likely_value_update`, which looks
 * like a third mechanism and is not: `clarification-resume.ts:616` emits that
 * skip_reason FROM `EDIT_VERB_OR_QUANTITY_PATTERN` — the same predicate this
 * file pins through `isClaimableByClarificationResume`. The mapping, so nobody
 * else reads two names as two gates:
 *
 *     EDIT_VERB_OR_QUANTITY_PATTERN  -> skip_reason 'message_likely_value_update'
 *     SHORT_CONFIRM_LIKELIHOOD       -> skip_reason 'message_likely_short_confirm'
 *
 * ⭐ AND THE PENDING WAS LIVE WHEN HE ASKED, which is what makes the re-offer
 * unambiguous rather than speculative. Same logs: `pending_action_count=1
 * new=0 carried_forward=1` at 18:11:46, and the skip reason at 18:11:38 was
 * `no_pending_clarification` (nothing to claim) while at 18:12:12 it had CHANGED
 * to `message_likely_value_update` (something to claim, gate refused it). The
 * change in reason between the two turns is independent evidence that a pending
 * came into existence and was carried forward.
 */

import { describe, expect, it } from 'vitest';

import { isClaimableByClarificationResume } from '../clarification-resume.js';

/** Anchored exactly as `clarification-resume.ts` declares it. */
const SHORT_CONFIRM_LIKELIHOOD =
  /^\s*(?:yes|yep|yeah|sure|ok(?:ay)?|do(?:\s+(?:it|that))?|go(?:\s+ahead)?|apply(?:\s+it)?|confirm(?:ed)?|please\s+do)\b/i;

/** True when NEITHER pre-route will claim the message. */
function claimedByNobody(message: string): boolean {
  return !isClaimableByClarificationResume(message) && !SHORT_CONFIRM_LIKELIHOOD.test(message);
}

/** Verbatim from Paul's session; the comment is the wire outcome. */
const RESUMED = [
  "Yes, add option 'Bundle New Pro Feature at £49 (No Price Rise)'", // applied
  'Okay, add it as a separate risk then.', // front-anchored "Okay"
];

const FELL_THROUGH = [
  'This will make sense. Please can you add this option?', // 18:06 — nobody claimed it
  'Can you make the updates to reflect this?', // 18:12 — "no stored suggestion in view"
];

describe('natural consent falls between the clarification-resume and short-confirm gates', () => {
  it('KNOWN DROPPED: these real consents are claimed by NEITHER pre-route', () => {
    for (const m of FELL_THROUGH) {
      expect(claimedByNobody(m), `expected to fall through: ${m}`).toBe(true);
    }
    // Pin the SIZE of the known-dropped set. If a fix lands, this REDs and the
    // set moves to the resumed list — which is the signal to update this file,
    // not to delete it.
    expect(FELL_THROUGH.filter(claimedByNobody)).toHaveLength(2);
  });

  it('CONTRAST: front-anchored consent IS claimed, so the gap is about the anchor', () => {
    for (const m of RESUMED) {
      expect(claimedByNobody(m), `expected to be claimed: ${m}`).toBe(false);
    }
  });

  it('the discriminator is the ANCHOR, not the words — same consent, moved', () => {
    // Identical intent, identical vocabulary, only the position of the consent
    // differs. This is the whole defect in two lines.
    expect(claimedByNobody('Please can you add this option?')).toBe(true);
    expect(claimedByNobody('Yes please, add this option')).toBe(false);
  });

  it('the designed case still works — a bare label is claimable', () => {
    expect(isClaimableByClarificationResume('Engineering Time Commitment')).toBe(true);
  });
});
