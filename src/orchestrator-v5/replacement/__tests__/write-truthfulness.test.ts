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


/**
 * ⭐⭐ A RECEIPT FOR ONE WRITE MUST NEVER LICENSE A CLAIM ABOUT ANOTHER.
 *
 * THE DEFECT: `writeTruthfulnessOf` tested `write_committed && receipt_id`
 * FIRST and returned immediately, so `refusals` was never read on a turn that
 * held a receipt. A turn that saved change A and had change B refused returned
 * `committed`, the prose passed through untouched, and the model's "Done — I
 * have made those changes." was published verbatim about BOTH.
 *
 * This is the worst shape in the whole module: it is not a missing
 * qualification, it is a TRUE receipt used as evidence for a FALSE claim, and
 * the user has a citable id to point at if they doubt it.
 *
 * ⚠ THE WEAKER RESIDUAL WINS. If one other write is definitely refused and a
 * third is unknown, the turn may NOT say the others failed — it does not know
 * that. `unknown` dominates `refused` for exactly the reason the module's
 * header gives: "it did not save" and "I cannot tell whether it saved" are
 * different claims, and only one of them is honest here.
 */
describe('mixed outcomes — a receipt does not short-circuit the judgement', () => {
  const committedWith = (refusals: string[]): WriteTruthfulness =>
    writeTruthfulnessOf(
      trace({
        write_attempted: true,
        write_committed: true,
        receipt_id: 'rcp-1',
        refusals: refusals as never,
      }),
    );

  it('a receipt alongside a DEFINITE refusal is mixed, never committed', () => {
    const o = committedWith(['write_failed']);
    expect(o.kind, 'a refused sibling write must not be reported as committed').toBe('mixed');
    expect(o).toMatchObject({ receiptId: 'rcp-1', residual: 'refused' });
  });

  it('a receipt alongside an UNKNOWN-outcome write cannot claim the other failed', () => {
    const o = committedWith(['write_outcome_unknown']);
    expect(o).toMatchObject({ kind: 'mixed', residual: 'unknown' });
  });

  it('when both a definite refusal and an unknown are present, the WEAKER residual wins', () => {
    expect(committedWith(['write_failed', 'no_receipt'])).toMatchObject({
      kind: 'mixed',
      residual: 'unknown',
    });
  });

  it('the prose is REPLACED, so a model sentence claiming both saved cannot survive', () => {
    const claim = 'Done — I have made those changes.';
    for (const refusals of [['write_failed'], ['no_receipt']]) {
      const out = constrainProseToWriteOutcome(claim, committedWith(refusals));
      expect(out, `mixed outcome must not publish ${JSON.stringify(claim)}`).not.toBe(claim);
      expect(out.length).toBeGreaterThan(0);
    }
  });

  /**
   * ⭐ THE FAIL-SAFE FOR CODES THAT DO NOT EXIST YET. The module's stated
   * default is `unknown` so that any refusal code added later lands on "I
   * cannot tell you" rather than on a confident sentence. That guarantee has
   * to hold beside a receipt too — otherwise every code added after today
   * re-opens the short-circuit this block exists to close.
   */
  it('an UNRECOGNISED refusal code beside a receipt is still mixed, never committed', () => {
    expect(committedWith(['some_code_invented_after_today'])).toMatchObject({
      kind: 'mixed',
      residual: 'unknown',
    });
  });

  /** ⭐ CONTRAST CONTROL. A clean commit must STILL pass through untouched —
   *  a "fix" that simply stopped trusting receipts would pass every case above
   *  and destroy the one behaviour this module exists to permit. */
  it('a clean commit with NO refusals still passes through untouched', () => {
    const o = committedWith([]);
    expect(o).toMatchObject({ kind: 'committed', receiptId: 'rcp-1' });
    const prose = 'Done — I have made that change.';
    expect(constrainProseToWriteOutcome(prose, o)).toBe(prose);
  });
});
