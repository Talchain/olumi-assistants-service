/**
 * ⭐ CUT 6 — THE WITHHELD GATE SEES "THE MOST-SUPPORTED OPTION" (WORDING BATCH; Science d5 #87 6008249324).
 *
 * The leader-framing copy now names the run-share leader as "the most-supported option" where it said "which option
 * leads" / "the leading option". That phrase presupposes a leader exactly as the old one did, so the leader egress guard
 * gains `most_supported_option` — or every reworded sentence would ship unredacted on a withheld turn.
 *
 * DL 0df0e1 (#2639 6008917488, after two Review Desk rounds): enumerating verb forms is whack-a-mole, and this PR's own
 * copy primes the paraphrases. So the ADJECTIVE is the trigger — most/best/more-supported, "the most support",
 * "supported most" — and the gate fails closed. LEAVE only when a negated OPTION subject opens the same clause before
 * the trigger (no option / no single option / none / neither / not one), or "there is no" stands right before it.
 *
 * d5's order: the LEAVE twins first (lines with no leader must PASS on a withheld Run; a guard that eats them is
 * over-suppression), PARITY for lines the gate already saw through older vocabulary, then the CATCH twins.
 */
import { describe, expect, it } from 'vitest';
import { textAssertsLeadingOption, textNamesLeadingOption } from '../leading-option-egress-guard.js';
import {
  ATTESTED_NO_FLIP_SENTENCE,
  ATTESTED_NO_FLIP_SENTENCE_LEADER_FREE,
} from '../../tools/handlers/explanation-fallback.js';

describe('LEAVE: a negated option subject opens the clause, so no option is named', () => {
  it.each([
    ['structural: identical arms', '- Without the link, no option is the most supported: every option comes out the same, so the choice between them makes no difference in that version.'],
    ['the leader-free no-flip line (derived)', ATTESTED_NO_FLIP_SENTENCE_LEADER_FREE],
    ['no single option', 'In that version, no single option is the most supported.'],
    ['none', 'None is the most supported once the link is removed.'],
    ['neither', 'Neither option is the most supported.'],
    ['there is no', 'There is no most-supported option in this model.'],
    ['no option … yet', 'No option is the most-supported option yet.'],
    // Review Desk round 3 (#2639 @1c3c70b6): the negator binds only a copula/adverb span, and these keep passing.
    ['there is no single', 'There is no single most-supported option.'],
    ["there's no clear", "There's no clear most supported option yet."],
    ['bulleted no option', '- No option is the most supported.'],
    ['none of the options', 'None of the options is the most supported.'],
    ['not a single … clearly', 'Not a single option is clearly the most supported.'],
  ])('%s', (_name, text) => {
    expect(textNamesLeadingOption(text), text).toBe(false);
    expect(textAssertsLeadingOption(text), text).toBe(false);
  });
});

/**
 * PARITY, not LEAVE: "Which option most runs support…" trips the PRE-EXISTING `runs_supported` pattern, exactly as
 * "Which option leads…" tripped `leads`. The rewording must not change what the gate does with these lines in either
 * direction, so each row asserts the old and new forms get the same verdict.
 */
describe('PARITY: the structural lines get the same gate verdict as before the rewording', () => {
  it.each([
    ['Which option leads cannot be compared. At least one run withheld its comparison.',
      'Which option most runs support cannot be compared. At least one run withheld its comparison.'],
    ['Which option leads is too close to call in at least one version.',
      'Which option most runs support is too close to tell apart in at least one version.'],
    ['- Without the link, A and B come out the same, so which option leads isn\'t compared for that version.',
      '- Without the link, A and B come out the same, so which option most runs support isn\'t compared for that version.'],
  ])('%s', (before, after) => {
    expect(textNamesLeadingOption(after)).toBe(textNamesLeadingOption(before));
    expect(textAssertsLeadingOption(after)).toBe(textAssertsLeadingOption(before));
  });
});

describe('CATCH: the adjective names a leader on a withheld turn, whatever the verb or noun', () => {
  it.each([
    // d5's twin.
    'Hire Marketing Manager is the most-supported option in this model.',
    'Hire Marketing Manager is the most supported option in this model.',
    // Review Desk round 1 (#2639 @7bb08501).
    'Hire Marketing Manager is the most supported in this model.',
    'The two most-supported options are Hire Marketing Manager and Hold.',
    'Hire Marketing Manager was the most-supported one.',
    'The most supported is Hire Marketing Manager.',
    // DL 0df0e1 (#2639 6008917488), measured passing at 37c9f0bf.
    'Hire Marketing Manager is most supported in this model.',
    'Hire Marketing Manager remains the most supported.',
    'Hire Marketing Manager comes out most supported.',
    'Hire Marketing Manager comes out as the most supported.',
    'Hire Marketing Manager ends up the most-supported.',
    'Most supported: Hire Marketing Manager.',
    'The most-supported choice is Hire Marketing Manager.',
    'Hire Marketing Manager stays the most-supported choice.',
    'The most supported here is Hire Marketing Manager.',
    'Hire Marketing Manager is the best-supported option.',
    'Hire Marketing Manager has the most support in this model.',
    'Hire Marketing Manager is the more supported of the two.',
    'Hire Marketing Manager is supported most often.',
    // Review Desk round 2 (#2639 @37c9f0bf).
    'Hire Marketing Manager is now the most supported.',
    'Of the options, Hire Marketing Manager is most supported.',
    'Hire Marketing Manager is the most strongly supported option.',
    'The option most supported by the runs is Hire Marketing Manager.',
    "Hire Marketing Manager's the most supported.",
    // The negator binds an OPTION subject, not a label that happens to open with "No".
    'No New Hire is the most supported in this model.',
    'No single factor would change the most-supported option.',
    // Review Desk round 3 (#2639 @1c3c70b6): a negated subject that opens the clause but is not the trigger's subject.
    'No option beats Hire Marketing Manager as the most supported option.',
    'Neither option changes much and Hire Marketing Manager is the most supported.',
    'None of them come close so Hire Marketing Manager is the most supported.',
    // …and the adverb and comparative slots.
    'Hire Marketing Manager is the most well supported option.',
    'Hire Marketing Manager is the most well-supported option.',
    'Hire Marketing Manager is better supported than Outsource.',
    'Hire Marketing Manager is the option with the most support.',
    // Accepted over-block (DL): no CEE emitter or prompt puts the adjective on a non-option noun (grep, #2639 body).
    'The most-supported assumption in your model is the delivery estimate.',
  ])('%s', (text) => {
    expect(textNamesLeadingOption(text)).toBe(true);
    expect(textAssertsLeadingOption(text)).toBe(true);
  });
});

/**
 * The roster-aware reader classifies the PREDICATE with one grammar for every code: a direct "is X the …?" question and
 * an adjacent postfix condition are spared for "the leading option", so they are spared for "the most-supported option".
 * The trigger's span covers a following option noun for that reason: without it the question and "if" checks read
 * " option?" / " option if …" and fire. (Measured at 37c9f0bf: the question was spared, the postfix row was CAUGHT via
 * its "is the most-supported" alternative, so the old/new pairs below are the parity, not that head.)
 */
describe('PARITY (roster-aware reader): the new vocabulary gets the old vocabulary\'s verdict', () => {
  const context = { optionLabels: ['Hire Marketing Manager', 'Hold'] };
  it.each([
    ['direct question', 'Is Hire Marketing Manager the leading option?', 'Is Hire Marketing Manager the most-supported option?', false],
    ['postfix condition', 'Hire Marketing Manager is the leading option if hiring costs fall.',
      'Hire Marketing Manager is the most-supported option if hiring costs fall.', false],
    ['CONTROL: the assertion', 'Hire Marketing Manager is the leading option in this model.',
      'Hire Marketing Manager is the most-supported option in this model.', true],
  ] as const)('%s', (_name, before, after, expected) => {
    expect(textAssertsLeadingOption(before, context), before).toBe(expected);
    expect(textAssertsLeadingOption(after, context), after).toBe(expected);
  });
  it('CONTROL: the adjective with no noun is still caught by the roster-aware reader', () => {
    expect(textAssertsLeadingOption('Hire Marketing Manager remains the most supported.', context)).toBe(true);
  });
});

describe('the shipped presupposing sentences stay visible to the gate', () => {
  it('ATTESTED_NO_FLIP_SENTENCE names the presupposition ("no single FACTOR" negates no option); its leader-free slice does not', () => {
    expect(ATTESTED_NO_FLIP_SENTENCE.endsWith(' that would change the most-supported option.')).toBe(true);
    expect(textAssertsLeadingOption(ATTESTED_NO_FLIP_SENTENCE)).toBe(true);
    expect(ATTESTED_NO_FLIP_SENTENCE_LEADER_FREE).toBe('Within the tested range, no single factor on its own reached a tipping point.');
  });

  it('POSITIVE CONTROL: the retired phrasing is still caught (the old patterns stay)', () => {
    expect(textNamesLeadingOption('Small adjustments could change which option leads.')).toBe(true);
  });
});
