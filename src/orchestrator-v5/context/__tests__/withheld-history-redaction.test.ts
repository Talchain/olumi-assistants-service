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
import { describe, it, expect } from 'vitest';

import {
  WITHHELD_HISTORY_REDACTION_MARKER,
  historyAssertsLeaderClaim,
  projectConversationForWithheldClaim,
  projectConversationTurnForWithheldClaim,
  redactLeaderClaimsFromHistoryMessage,
} from '../withheld-history-redaction.js';
import {
  findLeaderClaims,
  textNamesLeadingOption,
} from '../../compose/leading-option-egress-guard.js';
import type {
  ContextPackConversation,
  ContextPackConversationTurn,
} from '../context-pack-assembler.js';

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

/**
 * Prose that MUST SURVIVE. Over-suppression is weighted equally with the leak,
 * and a reader that redacts everything would pass every absence assertion in
 * this file and in the route-level arm.
 *
 * `sales win rate` is the sharp one: it is a FACTOR NAME on the very scenario
 * that leaks, and `win probability` is a computed value the withheld doctrine
 * explicitly KEEPS (designation vs data).
 */
const MUST_SURVIVE: readonly string[] = [
  'The connection from sales win rate to revenue growth is still unverified against real pipeline numbers.',
  'Each option keeps its win probability, which you are entitled to see.',
  'What would firm this up is real enterprise figures from your pipeline.',
  'You have asked this several times now, and the blocker has not changed.',
  'Is the hesitation about how reversible the enterprise move is once you start?',
  'The reasoning behind this is that the edge was never verified.',
  'There are three points to consider before you commit.',
];

function turn(assistant: string | null, id = 't1'): ContextPackConversationTurn {
  return {
    turn_id: id,
    turn_class: 'clarify',
    handler_id: null,
    created_at: '2026-07-27T10:00:00.000Z',
    user_message: 'Which one should we go with?',
    assistant_message: assistant,
  };
}

function conversation(turns: readonly ContextPackConversationTurn[]): ContextPackConversation {
  return {
    recent_turns: turns,
    turn_count: turns.length,
    last_tool_used: null,
    pending_confirmation: false,
    window: { shown: turns.length, available: turns.length },
  } as unknown as ContextPackConversation;
}

describe('the vocabulary — what each reader sees on the LIVE corpus', () => {
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

  it('this reader is a STRICT SUPERSET: every live leak sentence is caught', () => {
    for (const { source, text } of LIVE_CORPUS) {
      expect(historyAssertsLeaderClaim(text), `${source}: not seen by the redaction reader`).toBe(
        true,
      );
      expect(
        redactLeaderClaimsFromHistoryMessage(text),
        `${source}: seen but not redacted — the splitter and the reader disagree`,
      ).not.toBe(text);
    }
  });

  it('the superset holds by CALLING the shared reader, not by copying it', () => {
    // The single-source property. A phrasing added to LEADER_CLAIM_PATTERNS must
    // be in this reader on the same commit, with no list to keep in step
    // (CLAUDE.md trap #12). Exercised on a string only the shared set knows.
    const sharedOnly = 'This is the top choice on the current numbers.';
    expect(textNamesLeadingOption(sharedOnly)).toBe(true);
    expect(historyAssertsLeaderClaim(sharedOnly)).toBe(true);
  });

  it('ANTI-OVER-SUPPRESSION: ordinary coaching prose is left alone', () => {
    for (const text of MUST_SURVIVE) {
      expect(historyAssertsLeaderClaim(text), `flagged ordinary prose: ${text}`).toBe(false);
      expect(redactLeaderClaimsFromHistoryMessage(text)).toBe(text);
    }
  });
});

describe('the marker', () => {
  it('does not trip the ALARM vocabulary (it must not inject the residue it removes)', () => {
    expect(textNamesLeadingOption(WITHHELD_HISTORY_REDACTION_MARKER)).toBe(false);
    expect(findLeaderClaims({ assistant_text: WITHHELD_HISTORY_REDACTION_MARKER } as never)).toEqual(
      [],
    );
  });

  it('does not trip THIS reader either — redaction is IDEMPOTENT', () => {
    expect(historyAssertsLeaderClaim(WITHHELD_HISTORY_REDACTION_MARKER)).toBe(false);
    const once = redactLeaderClaimsFromHistoryMessage(LIVE_CORPUS[0]!.text)!;
    expect(redactLeaderClaimsFromHistoryMessage(once)).toBe(once);
  });

  it('POSITIVE CONTROL: the module-load probes can FAIL', () => {
    // Rule 2 — an instrument that returns the same answer for "inert" and
    // "could not look" is not an instrument. The probes assert
    // `!textNamesLeadingOption(marker)` and `!historyAssertsLeaderClaim(marker)`;
    // prove BOTH predicates discriminate by running them against the wording
    // the projection's own docstring records as rejected during development.
    const rejectedWording = 'Do not state or imply which option is out in front.';
    expect(textNamesLeadingOption(rejectedWording)).toBe(true);
    expect(historyAssertsLeaderClaim(rejectedWording)).toBe(true);
    // And the non-inertness probe: a reader that saw nothing would make the
    // whole gate a no-op, which is the failure this control exists to exclude.
    expect(historyAssertsLeaderClaim(LIVE_CORPUS[0]!.text)).toBe(true);
  });
});

describe('redactLeaderClaimsFromHistoryMessage — the sentence-level projection', () => {
  it('replaces ONLY the claiming sentence and keeps the rest byte-identical', () => {
    const message =
      'The blocker is unchanged and narrow. ' +
      'Double down on SMB previously led by 17 percentage points. ' +
      'Two things would move this forward.';
    const out = redactLeaderClaimsFromHistoryMessage(message)!;
    expect(out).toContain('The blocker is unchanged and narrow.');
    expect(out).toContain('Two things would move this forward.');
    expect(out).not.toContain('previously led');
    expect(out).not.toContain('17 percentage points');
    expect(out).toContain(WITHHELD_HISTORY_REDACTION_MARKER);
    // The sentence's own trailing space rides with the marker, so the surviving
    // prose is not run together with it.
    expect(out).toContain(`${WITHHELD_HISTORY_REDACTION_MARKER} Two things`);
  });

  it('bounds a hit to its own LINE in a bullet list', () => {
    const message =
      '• The blocker is unchanged and narrow.\n' +
      '• Double down on SMB previously led by 17 points.\n' +
      '• Something else may be holding this up.';
    const out = redactLeaderClaimsFromHistoryMessage(message)!;
    expect(out).toContain('• The blocker is unchanged and narrow.');
    expect(out).toContain('• Something else may be holding this up.');
    expect(out).not.toContain('previously led');
    // Line structure survives — the answer still reads as a list.
    expect(out.split('\n')).toHaveLength(3);
  });

  it('collapses a contiguous run of claims into ONE marker', () => {
    const message =
      'SMB previously led by 17 points. It sits ahead of enterprise. The margin was 17pp. Now the useful part.';
    const out = redactLeaderClaimsFromHistoryMessage(message)!;
    expect(out.split(WITHHELD_HISTORY_REDACTION_MARKER)).toHaveLength(2);
    expect(out).toContain('Now the useful part.');
  });

  it('returns the SAME REFERENCE when nothing is redacted (byte-identity)', () => {
    const clean = MUST_SURVIVE[0]!;
    expect(redactLeaderClaimsFromHistoryMessage(clean)).toBe(clean);
  });

  it('null and empty pass through untouched', () => {
    expect(redactLeaderClaimsFromHistoryMessage(null)).toBeNull();
    expect(redactLeaderClaimsFromHistoryMessage('')).toBe('');
  });

  it('a message that is ENTIRELY claim survives as a single marker, never as nothing', () => {
    // Never-silent. A blank assistant_message would tell the model the turn had
    // no answer, which is a different falsehood from the one being removed.
    const out = redactLeaderClaimsFromHistoryMessage(LIVE_CORPUS[2]!.text)!;
    expect(out.trim()).toBe(WITHHELD_HISTORY_REDACTION_MARKER);
  });
});

describe('projectConversationForWithheldClaim — the section-level projection', () => {
  it('redacts every turn in the window, not just the most recent (self-reinforcement)', () => {
    const section = conversation([
      turn(LIVE_CORPUS[0]!.text, 'newest'),
      turn('Nothing has changed since.', 'middle'),
      turn(LIVE_CORPUS[2]!.text, 'oldest'),
    ]);
    const out = projectConversationForWithheldClaim(section);
    expect(out.recent_turns[0]!.assistant_message).toContain(WITHHELD_HISTORY_REDACTION_MARKER);
    expect(out.recent_turns[1]!.assistant_message).toBe('Nothing has changed since.');
    expect(out.recent_turns[2]!.assistant_message).toContain(WITHHELD_HISTORY_REDACTION_MARKER);
    expect(historyAssertsLeaderClaim(JSON.stringify(out))).toBe(false);
  });

  it('NEVER touches user_message — the user’s own words are not CEE’s claim', () => {
    const user = 'So SMB leads by 17 points, right?';
    const section = conversation([{ ...turn(LIVE_CORPUS[0]!.text), user_message: user }]);
    const out = projectConversationForWithheldClaim(section);
    expect(out.recent_turns[0]!.user_message).toBe(user);
  });

  it('keeps turn_count, last_tool_used and the window disclosure intact', () => {
    const section = conversation([turn(LIVE_CORPUS[0]!.text)]);
    const out = projectConversationForWithheldClaim(section);
    expect(out.turn_count).toBe(section.turn_count);
    expect(out.last_tool_used).toBe(section.last_tool_used);
    expect(out.window).toEqual(section.window);
  });

  it('returns the SAME OBJECT when no turn changed', () => {
    const section = conversation([turn(MUST_SURVIVE[0]!), turn(null, 't2')]);
    expect(projectConversationForWithheldClaim(section)).toBe(section);
  });

  it('an empty window is a no-op', () => {
    const section = conversation([]);
    expect(projectConversationForWithheldClaim(section)).toBe(section);
  });

  it('the per-turn projection preserves every other member of the turn', () => {
    const original = turn(LIVE_CORPUS[0]!.text);
    const out = projectConversationTurnForWithheldClaim(original);
    expect(out.turn_id).toBe(original.turn_id);
    expect(out.turn_class).toBe(original.turn_class);
    expect(out.handler_id).toBe(original.handler_id);
    expect(out.created_at).toBe(original.created_at);
    expect(out.assistant_message).not.toBe(original.assistant_message);
  });
});
