/**
 * ⭐⭐ THE REPLY CANNOT CLAIM A SAVE THE TURN CANNOT PROVE — the guarantee,
 * not the telemetry floor.
 *
 * `unbacked-change-claim.test.ts` pins what the pattern detectors CAN see and
 * says plainly that a zero there means "no pattern matched", never "the reply
 * was honest". This file pins the enforcement, and it is deliberately built so
 * that it would still hold if every detector were deleted: the outcome is read
 * off the STRUCTURED TRACE, so phrasing is irrelevant to it.
 *
 * ⭐ The load-bearing case is `a value claim the detectors CANNOT see`. That
 * sentence is drawn from the known-missed set of the file above — it is a real
 * unbacked claim that both detectors fail to match. If this suite ever starts
 * depending on detection, that case goes red.
 */
import { describe, expect, it } from 'vitest';

import {
  constrainProseToWriteOutcome,
  proseForWriteOutcome,
  writeTruthfulnessOf,
  type WriteTruthfulness,
} from '../write-truthfulness.js';

type TraceLike = Parameters<typeof writeTruthfulnessOf>[0];

const trace = (over: Partial<TraceLike> = {}): TraceLike => ({
  write_attempted: false,
  write_committed: false,
  receipt_id: null,
  refusals: [],
  ...over,
} as TraceLike);

const REFUSED = proseForWriteOutcome({ kind: 'refused' })!;
const UNKNOWN = proseForWriteOutcome({ kind: 'unknown' })!;

describe('the outcome is derived from the trace, never from the prose', () => {
  it('a receipt is the commit proof — the reply passes through untouched', () => {
    const o = writeTruthfulnessOf(trace({ write_attempted: true, write_committed: true, receipt_id: 'rcp-1' }));
    expect(o).toEqual({ kind: 'committed', receiptId: 'rcp-1' });
    expect(constrainProseToWriteOutcome("I've updated the model.", o)).toBe("I've updated the model.");
  });

  it('no write attempted — the reply passes through untouched', () => {
    const o = writeTruthfulnessOf(trace());
    expect(o).toEqual({ kind: 'no_write' });
    expect(constrainProseToWriteOutcome('Here is what I think.', o)).toBe('Here is what I think.');
  });

  it.each(['write_failed', 'checkpoint_refused', 'no_checkpoint'])(
    'REFUSED — %s means nothing changed, and the reply says exactly that',
    (code) => {
      const o = writeTruthfulnessOf(trace({ write_attempted: true, refusals: [code] as never }));
      expect(o).toEqual({ kind: 'refused' });
      expect(constrainProseToWriteOutcome('anything at all', o)).toBe(REFUSED);
    },
  );

  it.each(['write_outcome_unknown', 'no_receipt'])(
    'UNKNOWN — %s means it may have landed, and the reply must not decide',
    (code) => {
      const o = writeTruthfulnessOf(trace({ write_attempted: true, refusals: [code] as never }));
      expect(o).toEqual({ kind: 'unknown' });
      expect(constrainProseToWriteOutcome('anything at all', o)).toBe(UNKNOWN);
    },
  );

  /**
   * ⭐ THE DISCRIMINATING PAIR. `no_receipt` and `write_failed` are both
   * refusals and both receipt-less; collapsing them would tell a user nothing
   * changed when a change may well be in their model. The two must produce
   * DIFFERENT bytes, and the difference must be the unknown/definite one.
   */
  it('unknown and refused are different claims and produce different bytes', () => {
    const unknown = constrainProseToWriteOutcome('x', writeTruthfulnessOf(
      trace({ write_attempted: true, refusals: ['no_receipt'] as never })));
    const refused = constrainProseToWriteOutcome('x', writeTruthfulnessOf(
      trace({ write_attempted: true, refusals: ['write_failed'] as never })));
    expect(unknown).not.toBe(refused);
    expect(refused).toMatch(/nothing in your model has changed/i);
    expect(unknown).toMatch(/cannot tell you whether it saved/i);
    expect(unknown).not.toMatch(/nothing in your model has changed/i);
  });

  it('an UNCLASSIFIED refusal code fails toward "I cannot tell you"', () => {
    // A code minted later and never classified must not silently become a
    // confident sentence in either direction.
    const o = writeTruthfulnessOf(trace({ write_attempted: true, refusals: ['a_code_added_next_year'] as never }));
    expect(o).toEqual({ kind: 'unknown' });
  });

  it('a blank receipt is not a commit proof', () => {
    for (const receipt of ['', '   ']) {
      const o = writeTruthfulnessOf(trace({ write_attempted: true, write_committed: true, receipt_id: receipt }));
      expect(o.kind, `receipt ${JSON.stringify(receipt)} must not read as committed`).not.toBe('committed');
    }
  });
});

describe('the lie this exists to stop', () => {
  const refused: WriteTruthfulness = { kind: 'refused' };

  it('a phrase the detectors DO match never reaches the user', () => {
    expect(constrainProseToWriteOutcome("That's saved.", refused)).toBe(REFUSED);
  });

  /**
   * ⭐⭐ THE ONE THAT PROVES THIS IS NOT DETECTOR-BASED. This sentence is from
   * the KNOWN_MISSED set in `unbacked-change-claim.test.ts` — a real unbacked
   * claim that BOTH pattern detectors fail to see. A guard built on them ships
   * it. This one cannot, because it never reads the sentence.
   */
  it('a value claim the detectors CANNOT see never reaches the user either', () => {
    expect(constrainProseToWriteOutcome('The budget is now set to £50k.', refused)).toBe(REFUSED);
  });

  it('the constrained bytes carry no success claim of their own', () => {
    for (const bytes of [REFUSED, UNKNOWN]) {
      expect(bytes).not.toMatch(/\b(saved|updated|applied|done)\b(?!.*(not|whether|cannot))/i);
    }
  });
});
