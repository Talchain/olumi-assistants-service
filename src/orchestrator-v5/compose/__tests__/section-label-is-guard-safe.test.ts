/**
 * ⭐⭐ MARKING A LABEL MUST NOT CHANGE WHAT THE REDACTOR SEES.
 *
 * `enforceLeadingOptionClaimsAtWire` finds a leader claim IN ORDER TO REMOVE IT
 * when the claim is withheld. Copy the guard cannot see is a LEAK, not a
 * cosmetic miss: the product withholds the claim in its record and names a
 * leader in the prose beside it.
 *
 * ⛔ THIS SUITE RUNS THE LIVE MATCHER, NOT A LOOKALIKE. I first wrote a
 * syntactic `splitsAPhrase()` predicate and it was WRONG on the measured cases —
 * it rejected `**the lead** is not stable`, a whole phrase that must be allowed.
 * The premise was the error, not the regex: whether markup splits a phrase
 * depends on the GUARD'S spans, which no predicate over characters can know. So
 * the property is asserted by parity against the real function.
 */
import { describe, expect, it } from 'vitest';

import { textNamesLeadingOption } from '../leading-option-egress-guard.js';
import { sectionHeader, sectionLabel } from '../section-label.js';

/** Every label this lane emits, from the composers themselves. */
const LABELS = [
  'Key consideration',
  'Assumption to check',
  'One assumption worth checking',
  'Worth a look',
  'Limit to confirm',
  'Tell me more about',
  'This is a close call',
] as const;

/** Bodies the guard DOES see (positive controls) and ones it does not. */
const SEEN_BODIES = [
  'the lead is not stable across the runs we sampled.',
  'this is the leading option on the current model.',
];
const UNSEEN_BODIES = [
  'churn is doing most of the work in this model.',
  'the delivery date depends on two unknowns.',
];

describe('marking a label leaves the redactor’s verdict unchanged', () => {
  it.each(LABELS)('%s — parity on bodies the guard SEES', (label) => {
    for (const body of SEEN_BODIES) {
      const plain = `${label}: ${body}`;
      const marked = `${sectionLabel(label)} ${body}`;
      expect(
        textNamesLeadingOption(plain),
        `precondition: the plain form must trip the guard, or this case proves nothing`,
      ).toBe(true);
      expect(
        textNamesLeadingOption(marked),
        `marking "${label}" hid a leader claim from the redactor — that is a LEAK`,
      ).toBe(textNamesLeadingOption(plain));
    }
  });

  it.each(LABELS)('%s — parity on bodies the guard does NOT see', (label) => {
    for (const body of UNSEEN_BODIES) {
      const plain = `${label}: ${body}`;
      const marked = `${sectionLabel(label)} ${body}`;
      expect(textNamesLeadingOption(marked)).toBe(textNamesLeadingOption(plain));
    }
  });

  /**
   * ⭐ THE DISCRIMINATING CASE. Without it, a matcher that returned a constant
   * would pass every parity assertion above and this suite would be vacuous.
   * Splitting a phrase the guard spans MUST change the verdict — that is the
   * harm, demonstrated rather than asserted.
   */
  it('a phrase-splitting mark DOES change the verdict — so parity means something', () => {
    // ⚠ THE CASE MUST TRIP EXACTLY ONE PATTERN. My first attempt used
    // "...is ahead on this model", which trips BOTH `leading_option` AND
    // `is ahead` — so splitting one left the other carrying the match and the
    // test read as "the guard is robust to splitting". It is not: measured at
    // the live function, the isolated pair below reads true / false.
    const whole = 'This is the leading option for now.';
    const split = 'This is the **leading** option for now.';
    expect(textNamesLeadingOption(whole), 'the unmarked phrase must be seen').toBe(true);
    expect(
      textNamesLeadingOption(split),
      'splitting the span the guard matches must blind it — if this is still true, ' +
        'the matcher is not sensitive to markup and every parity case above is vacuous',
    ).toBe(false);
  });

  it('sectionLabel wraps the WHOLE label and owns the colon', () => {
    expect(sectionLabel('Limit to confirm')).toBe('**Limit to confirm:**');
    // A caller that already typed the colon must not produce a double one.
    expect(sectionLabel('Limit to confirm:')).toBe('**Limit to confirm:**');
    expect(sectionLabel('  Worth a look  ')).toBe('**Worth a look:**');
  });
});

/**
 * ⭐ THE SAME PARITY PROPERTY FOR HEADERS, RUN THROUGH THE SAME LIVE MATCHER.
 *
 * `sectionHeader` differs from `sectionLabel` only by omitting the colon, and a
 * colon is not what makes markup safe — wrapping a COMPLETE phrase is. Asserting
 * that here rather than reasoning it from the diff, because the one time this
 * lane reasoned about marker safety instead of running the matcher, the
 * conclusion was wrong (see the header of this file).
 */
const HEADERS = [
  'Options on the canvas',
  'What the model is weighing',
  'Where this could turn',
] as const;

describe('marking a HEADER leaves the redactor’s verdict unchanged', () => {
  it.each(HEADERS)('%s — parity on bodies the guard SEES', (header) => {
    for (const body of SEEN_BODIES) {
      const plain = `${header} ${body}`;
      const marked = `${sectionHeader(header)} ${body}`;
      expect(textNamesLeadingOption(marked)).toBe(textNamesLeadingOption(plain));
    }
  });

  it.each(HEADERS)('%s — parity on bodies the guard does NOT see', (header) => {
    for (const body of UNSEEN_BODIES) {
      const plain = `${header} ${body}`;
      const marked = `${sectionHeader(header)} ${body}`;
      expect(textNamesLeadingOption(marked)).toBe(textNamesLeadingOption(plain));
    }
  });

  // ⛔ THE POINT OF THE WHOLE VARIANT: a header must render bold WITHOUT
  // acquiring punctuation its author never wrote. `sectionLabel` would say
  // "Options on the canvas:" — different copy, not different styling.
  it('emits no colon, where sectionLabel would add one', () => {
    expect(sectionHeader('Options on the canvas')).toBe('**Options on the canvas**');
    expect(sectionLabel('Options on the canvas')).toBe('**Options on the canvas:**');
  });

  it('is idempotent about a colon the caller already typed', () => {
    expect(sectionHeader('Options on the canvas:')).toBe('**Options on the canvas**');
    expect(sectionHeader('  Options on the canvas::  ')).toBe('**Options on the canvas**');
  });

  // CONTROL: the positive controls must actually fire, or every parity
  // assertion above passes for the wrong reason (nothing is ever seen).
  it('CONTROL: the guard genuinely sees the SEEN bodies', () => {
    for (const body of SEEN_BODIES) expect(textNamesLeadingOption(body)).toBe(true);
    for (const body of UNSEEN_BODIES) expect(textNamesLeadingOption(body)).toBe(false);
  });
});
