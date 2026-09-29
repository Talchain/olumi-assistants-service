/**
 * ROADMAP 2.474 / A9 — ENTRY LOGIC: rulebook first, tool second, SAME TURN.
 *
 * The defect this exists to kill is measured, not theoretical: the
 * deterministic composer returns zero operations with `wasRejected: false`,
 * the user gets clarify copy, rephrases, and gets it again — four turns and
 * nothing applies. So the load-bearing assertion here is the one about the
 * shape of a NON-claim: a predicate keyed on `wasRejected` alone would read
 * "claimed" on exactly the turns this path exists to rescue.
 */
import { describe, expect, it } from 'vitest';

import {
  decideStructuralEditEntry,
  holdSpineActiveForMode,
  rulebookClaimedTurn,
  type StructuralEditEntryInput,
} from '../structural-edit-entry.js';

/** The engaging case, varied one field at a time. */
function entry(over: Partial<StructuralEditEntryInput> = {}): StructuralEditEntryInput {
  return {
    rulebook: { wasRejected: false, operations: [] },
    editIntentDetectedByRulebook: true,
    holdSpineActive: true,
    groundingAvailable: true,
    ...over,
  };
}

describe('A9 — what counts as the rulebook CLAIMING the utterance', () => {
  it('operations produced, not rejected ⇒ CLAIMED (the gate will apply or hold them)', () => {
    expect(
      rulebookClaimedTurn({ wasRejected: false, operations: [{ op: 'update_node' }] }),
    ).toBe(true);
  });

  it('THE MEASURED DEAD-END: zero operations with wasRejected FALSE ⇒ NOT claimed', () => {
    // This is the whole point. `wasRejected` is false here — the composer did
    // not refuse, it simply produced nothing — so a rejection-keyed predicate
    // would call this a claim and leave the user in the loop.
    expect(rulebookClaimedTurn({ wasRejected: false, operations: [] })).toBe(false);
    expect(rulebookClaimedTurn({ wasRejected: false })).toBe(false);
    expect(rulebookClaimedTurn({ wasRejected: false, operations: undefined })).toBe(false);
  });

  it('an outright refusal is NOT a claim either, even carrying operations', () => {
    expect(
      rulebookClaimedTurn({ wasRejected: true, operations: [{ op: 'update_node' }] }),
    ).toBe(false);
  });
});

describe('⚠ the kill switch — a mode turned DOWN must disable the tool, not de-fang its guard', () => {
  it.each([
    ['live', true],
    ['shadow', false],
    ['off', false],
  ] as const)('mode %s ⇒ holdSpineActive %s', (mode, expected) => {
    // The whole closed set, not a sample: 'shadow' is the one that matters
    // most, because it is what PRODUCTION resolves to (the standing lockdown
    // downgrades 'live' there) and it is the mode that looks safest by name
    // while routing no holds at all.
    expect(holdSpineActiveForMode(mode)).toBe(expected);
  });

  it('stands DOWN when the hold spine is inactive', () => {
    // In 'shadow'/'off' the gate returns blockApply:false BY CONSTRUCTION, so
    // engaging would strip the hold and leave an LLM-composed structural batch
    // auto-applying. That is strictly more dangerous than the tool being on.
    expect(decideStructuralEditEntry(entry({ holdSpineActive: false }))).toEqual({
      engage: false,
      reason: 'hold_spine_inactive',
    });
  });

  it('the safety gate OUTRANKS every other reason — it is checked first', () => {
    // Ordering is the contract. If a later gate could answer first, the
    // decision's reason would depend on which failure happened to be evaluated
    // sooner, and the kill switch would become a coincidence.
    expect(
      decideStructuralEditEntry(
        entry({
          holdSpineActive: false,
          alreadyEngaged: true,
          rulebook: { wasRejected: false, operations: [{ op: 'add_node' }] },
          editIntentDetectedByRulebook: false,
          groundingAvailable: false,
        }),
      ),
    ).toEqual({ engage: false, reason: 'hold_spine_inactive' });
  });
});

describe('the entry decision', () => {
  it('ENGAGES on the dead-end: intent detected, rulebook produced nothing, grounding available', () => {
    expect(decideStructuralEditEntry(entry())).toEqual({ engage: true });
  });

  it('stands DOWN when the rulebook claimed the turn — one composer per turn', () => {
    expect(
      decideStructuralEditEntry(
        entry({ rulebook: { wasRejected: false, operations: [{ op: 'add_node' }] } }),
      ),
    ).toEqual({ engage: false, reason: 'rulebook_claimed' });
  });

  it('stands DOWN when the rulebook did not detect edit intent', () => {
    expect(
      decideStructuralEditEntry(entry({ editIntentDetectedByRulebook: false })),
    ).toEqual({ engage: false, reason: 'not_edit_shaped' });
  });

  it('stands DOWN when the model cannot be read — A5(a): decline, never ground on nothing', () => {
    expect(decideStructuralEditEntry(entry({ groundingAvailable: false }))).toEqual({
      engage: false,
      reason: 'no_grounding',
    });
  });

  it('stands DOWN on re-entry — exactly one tool composition per turn, never a repair loop', () => {
    expect(decideStructuralEditEntry(entry({ alreadyEngaged: true }))).toEqual({
      engage: false,
      reason: 'already_engaged',
    });
  });

  it('the claim check precedes the intent check — a claimed turn is never re-examined', () => {
    expect(
      decideStructuralEditEntry(
        entry({
          rulebook: { wasRejected: false, operations: [{ op: 'update_node' }] },
          editIntentDetectedByRulebook: false,
        }),
      ),
    ).toEqual({ engage: false, reason: 'rulebook_claimed' });
  });

  it('EDIT INTENT IS INHERITED, NOT RE-DERIVED — an edit-verb-FREE utterance still engages', () => {
    // The under-trigger this module used to have, pinned as a positive. A
    // configure-option turn ("configure Plan A") carries NO verb from
    // EDIT_GRAPH_POSITIVE_REGEX, yet route-v2 dispatches it as an edit-lane
    // candidate in its own right. The old local re-derivation answered
    // `not_edit_shaped` and refused entry on exactly the dead-end class 2.474
    // exists to rescue.
    expect(
      decideStructuralEditEntry(entry({ editIntentDetectedByRulebook: true })),
    ).toEqual({ engage: true });
  });
});
