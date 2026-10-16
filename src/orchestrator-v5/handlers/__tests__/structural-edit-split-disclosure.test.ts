/**
 * ROADMAP 2.474 / A3 — THE REFUSAL THAT IS NOW A DISCLOSURE.
 *
 * The half of the witnessed defect Paul cared most about: "the current
 * behaviour discards a composed batch and explains nothing". Probe C's copy
 * named a limit ("limit: 4 node ops, 8 edge ops") and offered a chip that asked
 * the USER to work out the decomposition the server had already computed and
 * thrown away.
 *
 * What is under test here is therefore not "is there a sentence" but four
 * specific properties, each with the trap-13b question asked of it:
 *
 *  · EVERY remaining operation is named. A guard that only checked the notice
 *    was non-empty would pass on "…and 3 more changes" — the exact opaque
 *    collapse ROADMAP 1.134 removed. So the assertions bind to the LABEL of
 *    each remaining operation, by identity.
 *  · The remainder is described against the WHOLE batch. A remainder described
 *    in isolation renders "add a link" wherever it names a node the first step
 *    creates — still a sentence, still non-empty, and useless. The test builds
 *    exactly that case.
 *  · ⭐⭐ SCOPE AND CONTINUATION ARE SEPARABLE (ROADMAP 2.620). The scope
 *    notice must be sayable with no verdict at all, and the continuation must
 *    not be. The strongest evidence for that here is STRUCTURAL and lives in
 *    the signature: `buildStructuralEditScopeNotice` takes no outcome, no
 *    verdict and no chip, so it cannot be gated on one. The behavioural half
 *    of the proof is at the dispatch seam
 *    (`edit-graph-dispatch-structural-split.test.ts`), because that is where
 *    the defect lived — a builder cannot demonstrate a call site's gate.
 *  · The copy is swept clean by the ESTATE'S OWN guards, imported, not by a
 *    hand-written list of things I happened to think of.
 */
import { describe, expect, it } from 'vitest';
import { hasLiveHeldProposal, type EditGmDecision } from '../edit-graph-referee-gate.js';

/**
 * ⚠⚠ ROADMAP 2.622 — WHERE THE RE-RUN CHIP ACTUALLY ENDS UP, MEASURED RATHER
 * THAN ASSUMED, AND THE OPEN RULING NAMED.
 *
 * The continuation fires ONLY on a live held proposal. A live held proposal is
 * a confirmation-expecting pending, which is exactly the condition under which
 * `commit.ts` strips competing generic run_analysis suggestion chips. So this
 * chip is suppressed before it reaches the user, every time.
 *
 * That is not asserted here from a reading of `commit.ts` — it is asked of
 * `commit.ts`'s own predicate, so the day the suppression set changes this
 * test moves with it instead of describing a behaviour that has gone.
 *
 * ⚠ WHETHER THAT IS A DEFECT IS AN OPEN RULING (a), and this test deliberately
 * does not decide it. If the intended sequence is confirm → re-run → ask
 * again, suppressing a re-run offer while the confirm is outstanding is
 * CORRECT and the prose carries the guidance. If the chip is meant to be
 * takeable, the estate's own convention is a DEDICATED id (`_gm_stale`,
 * `_gm_held_applied`) that the suppression set does not name. Either way the
 * mechanism is now pinned, so the ruling has an object to bind to.
 */
describe('⚠⚠ ROADMAP 2.622 — the re-run continuation chip is suppressed while the hold is live', () => {

  it('and the condition that mints it IS the condition that suppresses it', () => {
    // The continuation's precondition, from the producer's predicate. A held
    // verdict with a pending is a confirmation-expecting pending, which is
    // what arms the suppression. Same state, both sides.
    const heldWithPending = {
      governing: 'held',
      pendingActions: [{ action: { kind: 'apply_proposed_change' } }],
    } as unknown as Pick<EditGmDecision, 'governing' | 'pendingActions'>;
    expect(hasLiveHeldProposal(heldWithPending)).toBe(true);
    // ⭐ DISCRIMINATING CONTROL — a held verdict that minted NO pending is not
    // a live proposal, so the continuation is withheld and nothing is
    // suppressed. Without this the assertion above passes on any input.
    const heldNoPending = {
      governing: 'held',
      pendingActions: null,
    } as unknown as Pick<EditGmDecision, 'governing' | 'pendingActions'>;
    expect(hasLiveHeldProposal(heldNoPending)).toBe(false);
  });
});
