/**
 * ⛔ A FALSE POSITIVE HERE APPLIES A MUTATION THE USER DID NOT ASK FOR, so every
 * arm of the conjunction gets its own discriminating pair: the case that
 * authorises, and the neighbouring case that must NOT.
 *
 * The decision is also a correctness fix, not only a latency one — `proposal.ts`
 * records an approval EVAPORATING on the deployed build because the model had no
 * id to bind to.
 */
import { describe, expect, it } from 'vitest';
import {
  decideApprovalFastPath,
  type OutstandingProposal,
} from '../approval-fast-path.js';
import { APPROVE, APPROVE_CHIP_MESSAGES } from '../approval-chips.js';
import {
  PROPOSAL_CONFIRM_PATTERN,
  SHORT_CONFIRM_PATTERN,
} from '../../routing/deterministic-short-confirm.js';

const ONE: readonly OutstandingProposal[] = [
  { proposal_id: 'prop_a00c29b4449cfe329f052f756332d34e', public_label: 'a starting point' },
];
const TWO: readonly OutstandingProposal[] = [
  ...ONE,
  { proposal_id: 'prop_b11d30c555adf43a063f867e6443e45f', public_label: 'an option level' },
];

describe('the fast path authorises only when it is certain', () => {
  it.each([...APPROVE_CHIP_MESSAGES])(
    '⛔ authorises on the product\'s own chip message %j with exactly one outstanding',
    (message) => {
      const d = decideApprovalFastPath({ message, outstanding: ONE });
      expect(d.kind).toBe('authorise');
      // Identity binding: it returns the id of the ONE outstanding proposal, not
      // a fabricated or defaulted one.
      expect(d.kind === 'authorise' && d.proposal_id).toBe(ONE[0].proposal_id);
      expect(d.kind === 'authorise' && d.matched).toBe('chip_message');
    },
  );

  it('authorises on anchored free text the shared recognisers already accept', () => {
    const d = decideApprovalFastPath({ message: 'Yes, go ahead', outstanding: ONE });
    expect(d.kind).toBe('authorise');
    expect(d.kind === 'authorise' && d.matched).toBe('free_text');
  });
});

describe('⛔ every arm of the conjunction, each with its discriminating neighbour', () => {
  it('ARM 1 — TWO outstanding defers, because "yes" cannot name one', () => {
    // Same message that authorises above. Only the count differs.
    const d = decideApprovalFastPath({ message: 'Yes, use those.', outstanding: TWO });
    expect(d).toEqual({ kind: 'defer', reason: 'multiple_outstanding_proposals' });
  });

  it('ARM 1 — ZERO outstanding defers, because there is nothing to authorise', () => {
    const d = decideApprovalFastPath({ message: 'Yes, use those.', outstanding: [] });
    expect(d).toEqual({ kind: 'defer', reason: 'no_outstanding_proposal' });
  });

  it('ARM 2 — an unrecognised message defers even with exactly one outstanding', () => {
    const d = decideApprovalFastPath({
      message: 'What would happen if we cut prices instead?',
      outstanding: ONE,
    });
    expect(d).toEqual({ kind: 'defer', reason: 'message_not_a_confirmation' });
  });

  it('⛔ ARM 2 — the AMEND chip must NEVER authorise; it is the opposite intent', () => {
    // 'Before you apply it, I want to change some of it.' contains "apply it".
    // If the recogniser were unanchored this would fire and apply a proposal the
    // user explicitly asked to change first.
    const d = decideApprovalFastPath({
      message: 'Before you apply it, I want to change some of it.',
      outstanding: ONE,
    });
    expect(d).toEqual({ kind: 'defer', reason: 'message_not_a_confirmation' });
  });

  it('a proposal with no id defers rather than authorising a fabricated one', () => {
    const d = decideApprovalFastPath({
      message: 'Yes, use those.',
      outstanding: [{ proposal_id: '', public_label: 'broken' }],
    });
    expect(d).toEqual({ kind: 'defer', reason: 'empty_proposal_id' });
  });
});

describe('⭐ the measurement that makes the chip half necessary', () => {
  /**
   * The load-bearing evidence for this design. If the shared free-text patterns
   * covered the chips, the exact-match half would be redundant and should be
   * deleted. They do not — and the ones they miss include the chip on the
   * measured approve journey.
   */
  it('⛔ the shared recognisers do NOT accept "Yes, use those." — hence the chip set', () => {
    expect(SHORT_CONFIRM_PATTERN.test('Yes, use those.')).toBe(false);
    expect(PROPOSAL_CONFIRM_PATTERN.test('Yes, use those.')).toBe(false);
    // POSITIVE CONTROL: the patterns are not inert — they DO accept one chip.
    expect(PROPOSAL_CONFIRM_PATTERN.test('Yes, make that change.')).toBe(true);
  });

  it('and "Yes, use those." is the message for the starting-point chip specifically', () => {
    // Identity-bound to the map, so a copy edit that renames the message REDs
    // here rather than silently narrowing the fast path.
    expect(APPROVE.propose_starting_point.message).toBe('Yes, use those.');
    expect(APPROVE_CHIP_MESSAGES.has('Yes, use those.')).toBe(true);
  });

  it('⛔ NON-VACUITY — the derived chip set is not empty', () => {
    // Without this, a rename in approval-chips.ts could empty the allowlist and
    // every authorise test above would fail loudly — but an `it.each` over an
    // EMPTY set silently runs zero cases and reports green.
    expect(APPROVE_CHIP_MESSAGES.size).toBeGreaterThan(0);
    expect(Object.keys(APPROVE).length).toBeGreaterThanOrEqual(4);
  });
});
