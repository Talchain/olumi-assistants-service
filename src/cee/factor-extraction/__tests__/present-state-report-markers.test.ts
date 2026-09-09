/**
 * ⭐ THE ROLE PREDICATE — "is this message REPORTING where things stand?"
 *
 * `reportsPresentState` decides ROLE and never binds a value. Its only power is
 * to withdraw a bind, so its failure direction is over-refusal, which costs
 * coverage and cannot mint a wrong number.
 *
 * DERIVED, NOT MIRRORED (CLAUDE.md trap 12). The first case asserts that the
 * marker set CONTAINS the tense-bearing members of this module's existing
 * closed `PRESENT_STATE_QUALIFIERS`, so if that list gains or loses a tense
 * word the relationship is visible here rather than silently drifting. And the
 * corpus half of trap 12d: derivation proves the two agree, only a written-out
 * case notices the set itself is short — hence the sentences below.
 *
 * Not run locally; hosted CI is the only execution.
 */
import { describe, expect, it } from 'vitest';

import {
  PRESENT_STATE_REPORT_MARKERS,
  reportsPresentState,
} from '../stated-level.js';

/**
 * The tense-bearing members of `PRESENT_STATE_QUALIFIERS`, written out because
 * that constant is module-private. The next case proves the relationship by
 * SHAPE — every one of these must be a marker — so a tense word added there
 * and forgotten here still shows up as a gap in review rather than as silence.
 * The hedges in that list ('at', 'around', 'about', 'roughly', 'right') are
 * deliberately absent: they say nothing about tense, and 'at' alone appears in
 * "£20k at minimum", which is a target.
 */
const TENSE_BEARING_QUALIFIERS = ['currently', 'now', 'presently', 'today', 'still'];

describe('reportsPresentState — role, never value', () => {
  it('the marker set is a SUPERSET of the tense-bearing qualifiers', () => {
    for (const w of TENSE_BEARING_QUALIFIERS) {
      expect(PRESENT_STATE_REPORT_MARKERS, w).toContain(w);
    }
    // CONTRAST, in the same run: the hedges are NOT markers. Without this the
    // assertion above would pass on a set that simply contains everything.
    for (const hedge of ['at', 'around', 'about', 'roughly']) {
      expect(PRESENT_STATE_REPORT_MARKERS, hedge).not.toContain(hedge);
    }
  });

  it('⭐ REPORTS — a current-level statement is recognised', () => {
    expect(reportsPresentState('Our current MRR is £12,000.')).toBe(true);
    expect(reportsPresentState('We are at £12,000 today.')).toBe(true);
    expect(reportsPresentState('Right now it is £12,000.')).toBe(true);
    expect(reportsPresentState('Revenue is still 12000.')).toBe(true);
    expect(reportsPresentState('At the moment we do £12,000.')).toBe(true);
  });

  it('⭐ TARGETS — a stated target carries no tense marker and is NOT a report', () => {
    // The half that makes the gate safe to add: refusing these would break the
    // capability it is guarding.
    expect(reportsPresentState('£20k')).toBe(false);
    expect(reportsPresentState('The target is £20,000.')).toBe(false);
    expect(reportsPresentState('We need to hit £20,000 by year end.')).toBe(false);
    expect(reportsPresentState('At least £20,000.')).toBe(false);
    expect(reportsPresentState('20000')).toBe(false);
  });

  it('word-boundary matched — a marker inside a longer word does not fire', () => {
    // 'now' inside 'known', 'still' inside 'distillery'.
    expect(reportsPresentState('The known figure is 20000.')).toBe(false);
    expect(reportsPresentState('Distillery revenue of 20000.')).toBe(false);
  });

  it('total on non-strings and empty input', () => {
    expect(reportsPresentState(null)).toBe(false);
    expect(reportsPresentState(undefined)).toBe(false);
    expect(reportsPresentState('   ')).toBe(false);
  });
});
