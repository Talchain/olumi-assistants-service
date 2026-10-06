/**
 * ⭐ CUT 6 — THE WITHHELD GATE SEES "THE MOST-SUPPORTED OPTION" (WORDING BATCH; Science d5 #87 6008249324).
 *
 * The leader-framing copy now names the run-share leader as "the most-supported option" where it said "which option
 * leads" / "the leading option". That phrase presupposes a leader exactly as the old one did, so the leader egress guard
 * gains `most_supported_option` — or every reworded sentence would ship unredacted on a withheld turn.
 *
 * d5's order: the LEAVE twins first (lines with no leader must PASS on a withheld Run; a guard that eats them is
 * over-suppression, the worse defect), PARITY for lines the gate already saw through older vocabulary, then the CATCH
 * twin ("X is the most-supported option" is blocked), then the shipped sentences that name the presupposition.
 */
import { describe, expect, it } from 'vitest';
import { textAssertsLeadingOption, textNamesLeadingOption } from '../leading-option-egress-guard.js';
import {
  ATTESTED_NO_FLIP_SENTENCE,
  ATTESTED_NO_FLIP_SENTENCE_LEADER_FREE,
} from '../../tools/handlers/explanation-fallback.js';

describe('LEAVE: the adjective in a negated or non-option clause does not trip the gate', () => {
  it.each([
    ['structural: identical arms', '- Without the link, no option is the most supported: every option comes out the same, so the choice between them makes no difference in that version.'],
    ['the leader-free no-flip line (derived)', ATTESTED_NO_FLIP_SENTENCE_LEADER_FREE],
    // The widened class keeps its negated twins: no option is named as the most supported.
    ['negated: no single option', 'In that version, no single option is the most supported.'],
    ['negated: none', 'None is the most supported once the link is removed.'],
    // The adjective on a non-option noun names no leader.
    ['another noun', 'The most-supported assumption in your model is the delivery estimate.'],
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

describe('CATCH: an option named as the most-supported one is blocked on a withheld turn', () => {
  it.each([
    'Hire Marketing Manager is the most-supported option in this model.',
    'Hire Marketing Manager is the most supported option in this model.',
    // Review Desk (#2639 @7bb08501): the same claim without "option" after the adjective passed the gate.
    'Hire Marketing Manager is the most supported in this model.',
    'The two most-supported options are Hire Marketing Manager and Hold.',
    'Hire Marketing Manager was the most-supported one.',
    'The most supported is Hire Marketing Manager.',
  ])('%s', (text) => {
    expect(textNamesLeadingOption(text)).toBe(true);
    expect(textAssertsLeadingOption(text)).toBe(true);
  });
});

describe('the shipped presupposing sentences stay visible to the gate', () => {
  it('ATTESTED_NO_FLIP_SENTENCE names the presupposition; its leader-free slice does not', () => {
    expect(ATTESTED_NO_FLIP_SENTENCE.endsWith(' that would change the most-supported option.')).toBe(true);
    expect(textAssertsLeadingOption(ATTESTED_NO_FLIP_SENTENCE)).toBe(true);
    expect(ATTESTED_NO_FLIP_SENTENCE_LEADER_FREE).toBe('Within the tested range, no single factor on its own reached a tipping point.');
  });

  it('POSITIVE CONTROL: the retired phrasing is still caught (the old patterns stay)', () => {
    expect(textNamesLeadingOption('Small adjustments could change which option leads.')).toBe(true);
  });
});
