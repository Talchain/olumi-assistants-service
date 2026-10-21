/**
 * T1 claim safety — the CONVERSATION-HISTORY input gate, at unit level.
 *
 * These are unit tests on pure functions. The behavioural proof that the gate is
 * WIRED lives at the boundary, in
 * `__tests__/claim-safety-hoist-and-input-gate-route-level.test.ts` (the
 * "prior-turn ASSISTANT PROSE in the MODEL INPUT" arm), which asserts on the
 * real `buildUserMessage` bytes — a unit test of a projection cannot tell you
 * the projection is applied, which is the distinction TESTING-DISCIPLINE rule 3
 * exists to enforce.
 *
 * What this file adds is the vocabulary register, the splitter's edge cases, and
 * the module-load probes' DISCRIMINATION — the property that makes them
 * instruments rather than decoration.
 */
/*
 * ⚠ DELETION 8 (track2, 22 Oct 2026): `withheld-history-redaction.ts` (the
 * history reader, the splitter and the marker) is deleted — no served path
 * called it. Its rows were dropped (original in
 * `evidence/track2-deletion8-20261022/deleted/`). What stays is the part that
 * pins the LIVE shared alarm, `textNamesLeadingOption`, on the captured corpus:
 * both its `seen` and its `blind` verdicts.
 */

import { describe, it, expect } from 'vitest';

import { textNamesLeadingOption } from '../../compose/leading-option-egress-guard.js';

/**
 * ⭐ THE VOCABULARY REGISTER — what the SHARED alarm reader can and cannot see
 * on the live corpus, beside what THIS reader sees.
 *
 * Every `text` is transcribed from a body an acceptance walk captured on
 * staging. The `alarm` column is the measurement that dictated the design: on
 * the sentence that actually leaked past #721 AND #723, the shared vocabulary
 * scores ZERO. A redaction gate built on it would have been theatre.
 *
 * PINNED IN BOTH DIRECTIONS. A `blind` entry that starts being seen (someone
 * widened `LEADER_CLAIM_PATTERNS` — good) and a `seen` entry that stops being
 * seen (a regression — bad) each turn this red and force a deliberate edit. And
 * `redacted` must be `true` for every row without exception: this reader's whole
 * justification is that it is a STRICT SUPERSET.
 */
const LIVE_CORPUS: ReadonlyArray<{
  readonly source: string;
  readonly text: string;
  readonly alarm: 'seen' | 'blind';
}> = [
  {
    // build b35d09de, phase-post-b35d09de-rep4/c5 — the residual leak, and the
    // reason this module exists. `\bleads\b` is present-tense; this is "led".
    source: 'b35d09de rep4 (the residual leak)',
    text: 'Double down on SMB previously led by 17 points, flagged fragile on this exact assumption from the first run.',
    alarm: 'blind',
  },
  {
    source: 'b35d09de base',
    text: 'Your stored lean is Double down on SMB, ahead by 17 percentage points, but that lean was flagged fragile from the first run.',
    alarm: 'seen',
  },
  {
    source: 'f63ccb45 stored history, 2026-07-13 user session',
    text: 'Double Down on SMB currently leads by 17 percentage points, but treat this as provisional.',
    alarm: 'seen',
  },
  {
    source: 'f63ccb45 stored history, 2026-07-13 user session',
    text: "This isn't a strong SMB win, it's a fragile one.",
    alarm: 'blind',
  },
  {
    source: 'POST-#713 walk, case5.clarify',
    text: 'The analysis currently favours Standardise on MacBook Pro, with a probability of 56%. It sits ahead of Standardise on Dell XPS by 44 percentage points.',
    alarm: 'blind',
  },
  {
    source: 'POST-#711/#712 walk, case1e',
    text: 'Standardise on MacBook Pro comes out ahead, leading in 44% of simulations, with Standardise on Dell XPS close behind at 34%.',
    alarm: 'seen',
  },
  {
    source: 'c6 stored history (the control target that never leaked)',
    text: 'Increase Engineering Budget currently leads by 39 percentage points.',
    alarm: 'seen',
  },
];

describe('the vocabulary — what the shared alarm sees on the LIVE corpus', () => {
  it('REGISTER: the shared alarm is BLIND to sentences this gate must catch', () => {
    const observed = LIVE_CORPUS.map((c) => ({
      source: c.source,
      alarm: textNamesLeadingOption(c.text) ? ('seen' as const) : ('blind' as const),
    }));
    expect(observed).toEqual(LIVE_CORPUS.map((c) => ({ source: c.source, alarm: c.alarm })));

    // Non-vacuity: the register must carry BOTH verdicts, or it is not
    // discriminating and would pass against a reader that always answers the
    // same way (rule 2).
    expect(new Set(observed.map((o) => o.alarm))).toEqual(new Set(['seen', 'blind']));
  });

  it('POSITIVE CONTROLS: the shared alarm sees the shared-only phrasing and the rejected marker wording', () => {
    expect(textNamesLeadingOption('This is the top choice on the current numbers.')).toBe(true);
    expect(textNamesLeadingOption('Do not state or imply which option is out in front.')).toBe(true);
  });
});
