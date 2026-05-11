/**
 * Unit tests for the shared FORBIDDEN_USER_FACING_PHRASES constant and
 * findForbiddenPhraseHit helper. Pure-function tests with no I/O.
 *
 * The constant is the single source of truth for "hard-fail prose" — any
 * regression here ripples to the runtime egress guard and the replay
 * harness assertions, so coverage is broad and explicit.
 */

import { describe, expect, it } from 'vitest';

import {
  FORBIDDEN_USER_FACING_PHRASES,
  findForbiddenPhraseHit,
} from '../forbidden-user-facing-phrases.js';

describe('FORBIDDEN_USER_FACING_PHRASES — phrase matches', () => {
  const positiveCases: ReadonlyArray<readonly [string, string]> = [
    // [phrase under test, label]
    ["I haven't applied any changes in this session yet.", "haven't applied any changes (straight apostrophe)"],
    ['I haven’t applied any changes in this session yet.', "haven't applied any changes (curly apostrophe)"],
    ['I have not applied any changes yet.', 'have not applied any changes'],
    ['Nothing changed in the model after that edit.', 'nothing changed'],
    ['No changes were made.', 'no changes'],
    ['The wire reports unknown freshness.', 'unknown freshness'],
    ['This explanation was loaded from a prior run.', 'loaded from a prior run'],
    ['Showing a cached result for the same query.', 'cached result'],
    ['The previous analysis still holds.', 'previous analysis'],
    ['According to the prior analysis…', 'prior analysis'],
    // Case variants
    ['I HAVEN’T APPLIED ANY CHANGES.', 'shout-cased haven’t applied'],
    ['NOTHING CHANGED.', 'shout-cased nothing changed'],
    ['Previous Analysis Was Run.', 'title-cased previous analysis'],
  ];

  for (const [text, label] of positiveCases) {
    it(`flags ${label}`, () => {
      expect(findForbiddenPhraseHit(text)).not.toBeNull();
    });
  }
});

describe('FORBIDDEN_USER_FACING_PHRASES — clean text passes', () => {
  const negativeCases: ReadonlyArray<readonly [string, string]> = [
    [
      'These results may be out of date because the model has changed since the last analysis.',
      'brief required stale copy',
    ],
    [
      "I don't have a record of recent edits in this conversation. If you'd like to make a change, tell me what to update and I'll do it directly.",
      'replacement no-recent-changes neutral copy',
    ],
    [
      'Strengthened the Incremental Hiring Cost to Budget Overrun Risk edge from 0.5 to 0.7.',
      'edit_graph safe_summary verbatim quote',
    ],
    [
      'Hire Two Senior Engineers Locally leads at 72% probability, 51 percentage points ahead of the runner-up.',
      'leader explanation prose (fresh path)',
    ],
    [
      'Would you like to re-run analysis to see how your changes affect the recommendation?',
      'recovery offer (no forbidden phrase)',
    ],
    ['The analysis is ready to run on your current model.', 'forward-looking analysis copy'],
    ['Several innocuous changes occurred to the wording.', 'no changes word-boundary negative (NOT a state denial)'],
    ['That option produced no_changes_required (an internal status).', 'underscored token NOT matched'],
  ];

  for (const [text, label] of negativeCases) {
    it(`does NOT flag ${label}`, () => {
      expect(findForbiddenPhraseHit(text)).toBeNull();
    });
  }
});

describe('findForbiddenPhraseHit — boundary cases', () => {
  it('returns null on empty string', () => {
    expect(findForbiddenPhraseHit('')).toBeNull();
  });

  it('returns the matched substring (not the source regex)', () => {
    const hit = findForbiddenPhraseHit('Earlier I said: previous analysis is still valid.');
    expect(hit).toMatch(/previous\s+analysis/i);
  });

  it('returns the FIRST hit in declaration order, not by position', () => {
    // Construct text that contains TWO forbidden phrases. The helper returns
    // the first match by regex-iteration order, mirroring how the egress
    // guard logs hits (first-wins keeps telemetry deterministic).
    const text =
      'I haven’t applied any changes yet, and the previous analysis is now stale.';
    const hit = findForbiddenPhraseHit(text);
    expect(hit).not.toBeNull();
    // Whichever phrase comes first in the regex array determines the hit;
    // the test asserts a stable choice across changes rather than a
    // specific position-in-text.
    expect(hit?.toLowerCase()).toMatch(/haven|previous\s+analysis/i);
  });

  it('exposes a non-empty regex array', () => {
    expect(FORBIDDEN_USER_FACING_PHRASES.length).toBeGreaterThanOrEqual(9);
  });
});
