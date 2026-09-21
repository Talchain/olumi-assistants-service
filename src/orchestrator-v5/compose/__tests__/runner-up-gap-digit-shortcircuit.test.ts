/**
 * THE TWO PREMISES `findRunnerUpGapCodes`' DIGIT SHORT-CIRCUIT RESTS ON.
 *
 * The reader returns `[]` immediately for a string with no digit. That is a
 * SHORT-CIRCUIT, not a discriminator: it is sound only because
 *
 *   (a) every one of the eight `GAP_CLAIM_PATTERNS` embeds `QTY_SRC`, which
 *       opens with `\d+`, so a match requires at least one digit; and
 *   (b) `neutralise` only ever REPLACES spans with `'#'`, so it cannot
 *       INTRODUCE a digit into a string that had none.
 *
 * Both were read at the bytes before the guard was added. They are pinned here
 * because a future pattern with no quantity — or a neutralisation replacement
 * that carried a digit — would silently turn this optimisation into a hole in
 * the redactor, and the redactor's failure mode is a wrong statistic reaching
 * the user (CLAUDE.md trap 13: an absence claim needs a positive control).
 *
 * ⚠ THE CORPUS IS THE MODULE'S OWN MUST-TRIP CORPUS WITH ITS DIGITS REMOVED,
 * not sentences of this lane's invention (trap 22). Stripping the digits is
 * precisely the transformation the premise claims is decisive, so the corpus
 * tests the premise rather than the author's imagination.
 */

import { describe, it, expect } from 'vitest';

import {
  findRunnerUpGapCodes,
  redactRunnerUpGapStatistic,
  unitStatesRunnerUpGap,
} from '../runner-up-gap-statistic.js';

/** Real gap sentences this estate has emitted — every one MUST trip. */
const GAP_SENTENCES: readonly string[] = [
  'HubSpot currently leads by 33 percentage points.',
  'It holds a 20-point lead over Salesforce.',
  'The margin between the two options is 6 percentage points.',
  'It sits ahead of Standardise on Dell XPS by 44 percentage points.',
  'HubSpot is 33 percentage points better than Salesforce.',
  '51 percentage points ahead of the runner-up.',
  'The lead is 14 percentage points.',
  'a narrow lead of about 7 percentage points',
];

/** The same sentences with every digit removed — nothing may trip. */
const DIGIT_FREE = GAP_SENTENCES.map((s) => s.replace(/\d/g, ''));

describe('findRunnerUpGapCodes — the digit short-circuit', () => {
  it('POSITIVE CONTROL: the corpus really does trip the reader with its digits', () => {
    // Trap 13: an absence assertion is vacuous unless the same corpus can be
    // shown to produce a PRESENCE. Without this, a reader that matched nothing
    // at all would pass every assertion below.
    for (const s of GAP_SENTENCES) {
      expect(findRunnerUpGapCodes(s).length, `must trip: ${s}`).toBeGreaterThan(0);
    }
  });

  it('premise (a): no digit ⇒ no codes, on the same corpus', () => {
    for (const s of DIGIT_FREE) {
      expect(findRunnerUpGapCodes(s), `must not trip without a digit: ${s}`).toEqual([]);
      expect(unitStatesRunnerUpGap(s)).toBe(false);
    }
  });

  it('premise (b): a digit-free string is still digit-free after redaction runs', () => {
    // `neutralise` is module-private, so its no-digit-introduced property is
    // asserted through the one public surface that runs it: a digit-free input
    // must come back BYTE-IDENTICAL, with nothing replaced. A replacement token
    // that carried a digit would break the short-circuit's soundness, and it
    // would show up here as an edited field.
    for (const s of DIGIT_FREE) {
      const out = redactRunnerUpGapStatistic({ narrative_summary: s });
      expect(out.fields, `a digit-free string must never be edited: ${s}`).toBe(0);
      expect(out.value.narrative_summary).toBe(s);
    }
  });

  it('ordinary digit-free prose, and the empty cases, return []', () => {
    for (const s of [
      '',
      'Option A leads the field.',
      'The margin of error is small.',
      'gross margin fell sharply this quarter',
      'ahead of schedule',
    ]) {
      expect(findRunnerUpGapCodes(s)).toEqual([]);
    }
  });

  it('a digit ANYWHERE lets the reader run — the guard is not a content filter', () => {
    // The discriminating half: the short-circuit must key on the presence of a
    // digit and nothing else, or it would be a second, undeclared predicate.
    const withIrrelevantDigit = 'By Q4 2027 HubSpot currently leads by 33 percentage points.';
    expect(findRunnerUpGapCodes(withIrrelevantDigit).length).toBeGreaterThan(0);
  });
});
