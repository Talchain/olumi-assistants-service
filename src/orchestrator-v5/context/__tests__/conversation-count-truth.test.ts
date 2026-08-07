/**
 * The conversation's LENGTH, as the coach is told it.
 *
 * ## What was wrong
 *
 * `SessionStore.readRecent` returns a WINDOW (`SESSION_READ_WINDOW_TURNS`,
 * default 20 — confirmed ABSENT from cee-staging's 114 env vars on
 * 2026-07-25, so the default is what serves). `projectConversation` reported
 * that window's LENGTH as the conversation's length, in two fields at once
 * (`turn_count`, `window.available`). Past 20 turns both were false.
 *
 * They were false CONSISTENTLY: `window.shown` (8) plus `window.summarised`
 * (12) summed to exactly the stated total (20), so every cross-field
 * conformance check passed. Live on build `f00b8ef`, scenario
 * `e1d9b089-…` (78 rows in `v5_conversation_turns`), the coach answered a
 * direct question with:
 *
 *   "Total turn count on record for this conversation is 20, and of those I
 *    can currently read 8 verbatim … the remaining 12 sit outside my visible
 *    window"
 *
 * Positive control from the same probe: on a 10-turn scenario it answered
 * "10 turns recorded in total" — the truth. The falsehood is discriminated,
 * not assumed.
 *
 * ## Why these tests assert on the PROMPT
 *
 * The pack is not on the wire; it reaches the user only as the bytes
 * `buildUserMessage` hands the model. Asserting `pack.conversation.turn_count`
 * alone would pin an internal counter — the closest reachable surface to the
 * user-visible consequence is the serialised routing prompt, so that is what
 * is pinned here.
 *
 * ## Mutation contract
 *
 * Restore `turn_count: priorTurns.length` / `available: priorTurns.length` in
 * `projectConversation` and the FALSE-TOTAL tests below must go red — not the
 * disclosure tests alone. Delete `conversationWindowNotice`'s call and the
 * silent-drop tests must go red.
 */

import { describe, it, expect } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import {
  assembleContextPack,
  projectConversation,
  CONTEXT_PACK_RECENT_TURNS_CAP,
} from '../context-pack-assembler.js';
import { ContextPackSchema } from '../context-pack-schema.js';
import { buildUserMessage } from '../../routing/route-with-tool-use.js';
import { priorTurnsFixture } from './context-budget-fixtures.js';

const PAYLOAD = Object.freeze(makeMessagePayload());

/** The live threshold: `SESSION_READ_WINDOW_DEFAULT`. */
const READ_WINDOW = 20;
/** The live truth on the probed scenario at acceptance time. */
const TRUE_TOTAL = 78;

function packWith(totalStored: number | null | undefined, windowSize = READ_WINDOW) {
  return assembleContextPack({
    payload: PAYLOAD,
    priorTurns: priorTurnsFixture(windowSize),
    priorTurnsTotal: totalStored,
    priorFacts: [],
    analysis: null,
  });
}

describe('conversation length — the number the coach is given', () => {
  it('states the STORED total, not the read window’s size (the live falsehood)', () => {
    const pack = packWith(TRUE_TOTAL);
    expect(pack.conversation.turn_count).toBe(TRUE_TOTAL);
    expect(pack.conversation.window?.available).toBe(TRUE_TOTAL);
    // The window read is still what it was — only the CLAIM about the
    // conversation's size changed.
    expect(pack.conversation.recent_turns).toHaveLength(CONTEXT_PACK_RECENT_TURNS_CAP);
    expect(pack.conversation.window?.shown).toBe(CONTEXT_PACK_RECENT_TURNS_CAP);
  });

  it('the SERIALISED PROMPT — what the model actually reads — carries 78 and never 20', () => {
    const prompt = buildUserMessage(packWith(TRUE_TOTAL), 'How long have we been talking?');
    expect(prompt).toContain(`"turn_count": ${TRUE_TOTAL}`);
    expect(prompt).toContain(`"available": ${TRUE_TOTAL}`);
    // The exact bytes the pre-fix build emitted, which the coach then read
    // back to the user as the total.
    expect(prompt).not.toContain(`"turn_count": ${READ_WINDOW}`);
    expect(prompt).not.toContain(`"available": ${READ_WINDOW}`);
  });

  it('discloses the shortfall IN WORDS, with both numbers, inside the prompt', () => {
    const prompt = buildUserMessage(packWith(TRUE_TOTAL), 'anything');
    const notice = packWith(TRUE_TOTAL).conversation.window?.notice ?? '';
    expect(notice).not.toBe('');
    // Both numbers, because a disclosure that only says "some are missing"
    // still lets the coach count the visible turns and assert that as
    // the total — the failure this replaces.
    expect(notice).toContain(String(TRUE_TOTAL));
    expect(notice).toContain(String(CONTEXT_PACK_RECENT_TURNS_CAP));
    expect(notice).toContain('the true total is 78');
    expect(notice).toContain('Do not describe the turns above as the whole conversation');
    // 78 − 8 = 70 not shown.
    expect(notice).toContain('70 earlier ones are not shown');
    // JSON.stringify escapes nothing here, so the sentence reaches the model
    // intact.
    expect(prompt).toContain('the true total is 78');
  });

  it('says NOTHING when the pack genuinely shows the whole conversation (no noise)', () => {
    const whole = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: priorTurnsFixture(CONTEXT_PACK_RECENT_TURNS_CAP),
      priorTurnsTotal: CONTEXT_PACK_RECENT_TURNS_CAP,
      priorFacts: [],
      analysis: null,
    });
    expect(whole.conversation.window?.notice).toBeUndefined();
    expect(whole.conversation.turn_count).toBe(CONTEXT_PACK_RECENT_TURNS_CAP);
    expect(buildUserMessage(whole, 'x')).not.toContain('INCOMPLETE');
  });

  it('discloses the gap even when the whole 20-turn window fits under the store cap', () => {
    // 12 stored, 8 shown: no store cap involved at all, but four turns are
    // still not in view. Before this change nothing said so in words — the
    // asymmetry the census flagged (the 1000-turn cap discloses; this one
    // did not).
    const pack = packWith(12, 12);
    expect(pack.conversation.window?.notice).toContain('12 turns are on record');
    expect(pack.conversation.window?.notice).toContain('4 earlier ones are not shown');
  });

  describe('when the count cannot be read (degraded — must not fabricate)', () => {
    it('refuses to state a total and says so, rather than passing off the window size', () => {
      const notice = packWith(null).conversation.window?.notice ?? '';
      expect(notice).toContain('could not be read this turn');
      expect(notice).toContain('do not state a total number of turns or exchanges');
      // The load-bearing assertion: the window's own size must not appear as
      // if it were the answer.
      expect(notice).not.toContain(String(READ_WINDOW));
    });

    it('an undefined total behaves identically to a failed read', () => {
      expect(packWith(undefined).conversation.window?.notice).toBe(
        packWith(null).conversation.window?.notice,
      );
    });
  });

  it('never reports FEWER turns than the pack visibly contains', () => {
    // An incoherent/stale count (below the window length) must not make the
    // pack contradict its own contents.
    const pack = packWith(3, READ_WINDOW);
    expect(pack.conversation.turn_count).toBe(READ_WINDOW);
    expect(pack.conversation.window?.available).toBe(READ_WINDOW);
  });

  it('the enriched window still validates against the strict pack schema', () => {
    expect(() => ContextPackSchema.parse(packWith(TRUE_TOTAL))).not.toThrow();
    expect(() => ContextPackSchema.parse(packWith(null))).not.toThrow();
  });

  it('projectConversation’s 2-arg call site (edit-graph dispatch) is unchanged', () => {
    // The dispatch path reads only `recent_turns`; omitting the total must
    // not throw and must not invent one.
    const projected = projectConversation(priorTurnsFixture(READ_WINDOW), false);
    expect(projected.recent_turns).toHaveLength(CONTEXT_PACK_RECENT_TURNS_CAP);
    expect(projected.turn_count).toBe(READ_WINDOW);
  });
});
