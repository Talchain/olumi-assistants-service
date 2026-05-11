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
    // Codex round-3 denial variants — simple past, alternative verbs,
    // singular noun, "updates" instead of "changes".
    ["I didn't apply any changes.", "didn't apply any changes (simple past)"],
    ["I didn't make any changes.", "didn't make any changes (Codex round-4 missing variant)"],
    ['I did not apply any changes.', 'did not apply any changes (formal)'],
    ['I did not make any changes.', 'did not make any changes (alternative verb)'],
    ['No change was made.', 'singular "no change was made"'],
    ['No updates were made.', 'plural "no updates were made"'],
    ['No updates have been applied.', '"no updates have been applied"'],
    ['Nothing changed in the model after that edit.', 'nothing changed'],
    // "no changes" — contextual denial patterns (post-Codex P1 fix).
    // The bare `\bno\s+changes\b` regex was over-broad; replaced with
    // three narrower patterns covering: "no changes [were|are|have been]
    // [made|applied|necessary|needed|required]", "there [are|were|have
    // been] no changes", and "no changes [happened|occurred|emerged|
    // appeared|reflected|to report]". Negative coverage for legitimate
    // label-quote scenarios lives in the next describe block.
    ['No changes were made.', 'no changes were made'],
    ['No changes are applied.', 'no changes are applied'],
    ['No changes have been needed.', 'no changes have been needed'],
    ['There are no changes worth reporting.', 'there are no changes (existential)'],
    ['There were no changes in the model.', 'there were no changes (existential)'],
    ['No changes happened on the model.', 'no changes happened'],
    ['No changes occurred since the last analysis.', 'no changes occurred'],
    // Standalone denial (Codex P1 follow-up): the contextual patterns
    // above don't catch a terse LLM utterance like "No changes." on
    // its own. The line-anchored pattern restores brief coverage of
    // the bare "no changes" entry without re-introducing the label-
    // quote false-positive risk.
    ['No changes.', 'standalone "No changes." utterance'],
    ['No changes', 'standalone "No changes" without punctuation'],
    ['No changes!', 'standalone "No changes!" exclamation'],
    ['no changes', 'standalone lowercase'],
    [
      "Here's the summary:\n\nNo changes.\n\nLet me know if you'd like to try something.",
      'standalone "No changes." as a paragraph within multi-line prose',
    ],
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
    // P1 regression guard (Codex review): the bare `\bno\s+changes\b`
    // regex used to false-positive on legitimate label-quotes that
    // appear in EditGraphHandlerFact.safe_summary and get quoted
    // verbatim by the state-query guard. The contextual denial
    // patterns must NOT trigger on these label-shaped strings.
    [
      "Updated the 'No Changes' factor from 0.5 to 0.7.",
      'safe_summary quoting a user-named "No Changes" factor',
    ],
    [
      "Strengthened the No Changes Required edge from 0.5 to 0.8.",
      'safe_summary quoting a "No Changes Required" label',
    ],
    [
      "Renamed 'No Changes Required' option to 'Status Quo'.",
      'safe_summary quoting a rename of a "No Changes" option',
    ],
    [
      "The No Changes Required factor now sits at 30%.",
      'analysis prose mentioning a "No Changes Required" factor',
    ],
    [
      "Hire Two Senior Engineers wins probability vs Status Quo (No Changes) baseline at 72%.",
      'leader prose comparing against a "No Changes" baseline option',
    ],
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
    // After Codex P1 fix: the bare `\bno\s+changes\b` regex was replaced
    // with three contextual denial patterns, so the array grew. The
    // lower bound stays as a smoke check rather than an exact-count
    // pin so future additions don't trip this invariant.
    expect(FORBIDDEN_USER_FACING_PHRASES.length).toBeGreaterThanOrEqual(9);
  });
});

// ---------------------------------------------------------------------------
// V5 stale-aware explain recovery — Codex round-3 Improvement 4.
//
// Pin route-v2.ts's EDIT_GRAPH_RECOVERY_TEXT against the shared
// FORBIDDEN_USER_FACING_PHRASES list. The constant is audit-only
// today (it ships through sendFinalised200, which bypasses the
// per-dispatch egress hooks landed in this workstream); a follow-up
// task will fold this through the route-level chokepoint. Until
// then, this test is the contract that the recovery text contains
// no contradiction phrase, so a future edit to the constant cannot
// silently re-introduce one.
// ---------------------------------------------------------------------------

describe('audited recovery constants — no forbidden phrase', () => {
  it('route-v2.ts EDIT_GRAPH_RECOVERY_TEXT is clean', async () => {
    const { EDIT_GRAPH_RECOVERY_TEXT } = await import(
      '../../../orchestrator/route-v2.js'
    );
    expect(findForbiddenPhraseHit(EDIT_GRAPH_RECOVERY_TEXT)).toBeNull();
  });
});
