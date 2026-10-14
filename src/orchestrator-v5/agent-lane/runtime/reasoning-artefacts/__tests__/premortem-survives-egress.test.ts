/**
 * P02 (DL 8 Oct 03:4xZ): the pre-mortem worksheet survived only when the final reply was BYTE-EQUAL to the method reply
 * (agent-v1-turn.ts `premortemReply === wireBody.assistant_text`). On a quantified_provisional Run the leading-option
 * egress PREPENDS its admission paragraph (USER_STATED_PARAMETERS_NOT_MATERIAL), so every pre-mortem over a provisional
 * Run lost its worksheet (joined witness jw-j1, turn 353c4921: PREMORTEM_WORKSHEET_WITHHELD exit not_passed).
 * Class rule: egress may ADD whole paragraphs around the method reply; it may never EDIT it. Fixture = jw-j1's served
 * assistant_text (CEE cf535a7), split at its own paragraph boundary.
 */
import { describe, it, expect } from 'vitest';
import j1 from './fixtures/premortem-j1-provisional-egress.json';
import { methodReplySurvives } from '../premortem.js';

const { final_assistant_text: FINAL, egress_caveat: CAVEAT, method_reply: METHOD } = j1;

describe('P02: the method reply survives egress unchanged inside the final text', () => {
  it('RED (jw-j1 shape): the provisional admission paragraph prepended → the method reply still survives', () => {
    expect(FINAL.startsWith(CAVEAT)).toBe(true);
    expect(methodReplySurvives(METHOD, FINAL)).toBe(true);
  });

  it('a caveat paragraph appended after the method reply → survives', () => {
    expect(methodReplySurvives(METHOD, `${METHOD}\n\n${CAVEAT}`)).toBe(true);
  });

  it('CONTROL: identical text survives (today’s only passing case)', () => {
    expect(methodReplySurvives(METHOD, METHOD)).toBe(true);
  });

  it('CONTROL: egress that EDITS a story (a word changed inside story 1) → does NOT survive (no worksheet)', () => {
    const edited = FINAL.replace('1. Imagine', '1. Suppose');
    expect(edited).not.toBe(FINAL);
    expect(methodReplySurvives(METHOD, edited)).toBe(false);
  });

  it('CONTROL: a paragraph inserted BETWEEN stories → does NOT survive (only whole paragraphs before or after)', () => {
    const stories = METHOD.split('\n\n');
    const inserted = [stories[0], stories[1], CAVEAT, ...stories.slice(2)].join('\n\n');
    expect(methodReplySurvives(METHOD, inserted)).toBe(false);
  });

  it('CONTROL: text glued to the reply with no paragraph break → does NOT survive', () => {
    expect(methodReplySurvives(METHOD, `${CAVEAT} ${METHOD}`)).toBe(false);
    expect(methodReplySurvives(METHOD, `${METHOD} Extra words.`)).toBe(false);
  });

  it('CONTROL: an empty method reply never survives', () => {
    expect(methodReplySurvives('', FINAL)).toBe(false);
  });
});
