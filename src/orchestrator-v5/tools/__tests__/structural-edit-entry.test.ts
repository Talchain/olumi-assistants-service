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
  isEditShapedUtterance,
  rulebookClaimedTurn,
} from '../structural-edit-entry.js';
import {
  EDIT_GRAPH_NEGATIVE_REGEX,
  EDIT_GRAPH_POSITIVE_REGEX,
} from '../../../orchestrator/routing/edit-graph-intent-regex.js';
import { detectStructuralRestructureIntent } from '../../routing/structural-restructure-intent.js';

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

describe('edit-shaped — DERIVED from the rulebook’s own regexes (trap 12)', () => {
  it('an edit verb with no meta marker is edit-shaped', () => {
    expect(isEditShapedUtterance('remove the churn factor')).toBe(true);
    expect(isEditShapedUtterance('add a referral factor')).toBe(true);
  });

  it('THE HEADLINE SENTENCE carries no edit verb at all — and is still edit-shaped', () => {
    // Measured at this tip: "give each option its own driver" matches NOTHING
    // in EDIT_GRAPH_POSITIVE_REGEX. A regex-only entry gate would have refused
    // the exact sentence the tool exists to serve; the rulebook's separate
    // structural-restructure detector is what claims it.
    const headline = 'give each option its own driver';
    expect(EDIT_GRAPH_POSITIVE_REGEX.test(headline)).toBe(false);
    expect(detectStructuralRestructureIntent(headline).matched).toBe(true);
    expect(isEditShapedUtterance(headline)).toBe(true);
  });

  it('a META-QUESTION is NOT edit-shaped, even carrying an edit verb', () => {
    // Direction matters: a second path that mutates the graph on a
    // meta-question is worse than the dead-end it replaces.
    expect(isEditShapedUtterance('explain why I should add a risk')).toBe(false);
    expect(isEditShapedUtterance('what would change if I remove churn?')).toBe(false);
    expect(isEditShapedUtterance('compare the options and tell me what to update')).toBe(false);
  });

  it('a sentence with no edit verb at all is not edit-shaped', () => {
    expect(isEditShapedUtterance('I am worried about the timeline')).toBe(false);
    expect(isEditShapedUtterance('')).toBe(false);
    expect(isEditShapedUtterance('   ')).toBe(false);
  });

  it('the judgement is the rulebook’s, not a second copy of it — both branches', () => {
    // If these ever disagreed, the tool and the rulebook would disagree about
    // which turns are edits. Asserted against the imported detectors, combined
    // exactly as route-v2 combines them, over a corpus that exercises BOTH
    // branches and both vetoes (12d: derivation proves agreement; the corpus is
    // what would notice the combination itself being wrong).
    const corpus = [
      'update the marketing spend',
      'remove the churn factor',
      'give each option its own driver',
      'split the shared factor into per-option links',
      'explain why I should add a risk',
      'what would change if I remove churn?',
      'I am worried about the timeline',
      'set up a meeting',
    ];
    for (const message of corpus) {
      const rulebook =
        detectStructuralRestructureIntent(message).matched ||
        (EDIT_GRAPH_POSITIVE_REGEX.test(message) && !EDIT_GRAPH_NEGATIVE_REGEX.test(message));
      expect({ message, shaped: isEditShapedUtterance(message) }).toEqual({
        message,
        shaped: rulebook,
      });
    }
  });
});

describe('the entry decision', () => {
  const editShaped = 'add a referral factor and link it to profit';

  it('ENGAGES on the dead-end: edit-shaped, rulebook produced nothing, grounding available', () => {
    expect(
      decideStructuralEditEntry({
        message: editShaped,
        rulebook: { wasRejected: false, operations: [] },
        groundingAvailable: true,
      }),
    ).toEqual({ engage: true });
  });

  it('stands DOWN when the rulebook claimed the turn — one composer per turn', () => {
    expect(
      decideStructuralEditEntry({
        message: editShaped,
        rulebook: { wasRejected: false, operations: [{ op: 'add_node' }] },
        groundingAvailable: true,
      }),
    ).toEqual({ engage: false, reason: 'rulebook_claimed' });
  });

  it('stands DOWN on a meta-question', () => {
    expect(
      decideStructuralEditEntry({
        message: 'explain what would change if I add a driver',
        rulebook: { wasRejected: false, operations: [] },
        groundingAvailable: true,
      }),
    ).toEqual({ engage: false, reason: 'not_edit_shaped' });
  });

  it('stands DOWN when the model cannot be read — A5(a): decline, never ground on nothing', () => {
    expect(
      decideStructuralEditEntry({
        message: editShaped,
        rulebook: { wasRejected: false, operations: [] },
        groundingAvailable: false,
      }),
    ).toEqual({ engage: false, reason: 'no_grounding' });
  });

  it('stands DOWN on re-entry — exactly one tool composition per turn, never a repair loop', () => {
    expect(
      decideStructuralEditEntry({
        message: editShaped,
        rulebook: { wasRejected: false, operations: [] },
        groundingAvailable: true,
        alreadyEngaged: true,
      }),
    ).toEqual({ engage: false, reason: 'already_engaged' });
  });

  it('the claim check precedes the shape check — a claimed turn is never re-examined', () => {
    // Ordering is the contract, not an accident: a rulebook that claimed a
    // turn owns it regardless of how the sentence reads.
    expect(
      decideStructuralEditEntry({
        message: 'explain the model',
        rulebook: { wasRejected: false, operations: [{ op: 'update_node' }] },
        groundingAvailable: true,
      }),
    ).toEqual({ engage: false, reason: 'rulebook_claimed' });
  });
});
