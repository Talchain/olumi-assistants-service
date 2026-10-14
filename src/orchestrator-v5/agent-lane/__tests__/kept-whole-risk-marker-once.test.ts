/**
 * Capacity e2e c0998b2e, judge row 4: the served build turn's reply was kept whole (no face, no detail), and it read both
 * "Risks Olumi added aren't in the chance yet, so it may be too high." and the face marker "Leaves out Olumi's added
 * risks; may be too high". A reply kept whole says the full note once and drops the marker; a shaped reply keeps both,
 * each in its own place (r13 rows in `one-reply-build-contract.route.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { composeReplyShape, WIDENED_RISK_MARKER_TOO_HIGH } from '../reply/compose-reply.js';
import { widenedRiskNote } from '../runtime/widen-draft.js';

const SERVED = (JSON.parse(readFileSync(new URL('./fixtures/served-capacity-e2e-c0998b2e-turn01-text.json', import.meta.url), 'utf8')) as {
  assistant_text: string }).assistant_text;
const NOTE = widenedRiskNote({ options: 0, risks: 2 })!;
const count = (text: string, part: string): number => text.split(part).length - 1;

describe('a reply kept whole says the widened-risk note once, without its face marker', () => {
  it('PRECONDITION: the served turn-01 reply carries the note and the marker, once each', () => {
    expect(count(SERVED, NOTE)).toBe(1);
    expect(count(SERVED, WIDENED_RISK_MARKER_TOO_HIGH)).toBe(1);
  });

  it('⭐ RED (served turn 01): kept whole, the note stays once and the marker goes; nothing else moves', () => {
    const out = composeReplyShape({ text: SERVED, keepWhole: 'ai_answer', faceContract: 'draft',
      widenedRiskNote: NOTE, widenedRiskMarker: WIDENED_RISK_MARKER_TOO_HIGH });
    expect(out.outcome).toBe('kept_whole');
    expect(count(out.text, NOTE)).toBe(1);
    expect(out.text).not.toContain(WIDENED_RISK_MARKER_TOO_HIGH);
    expect(out.text).toBe(SERVED.replace(`\n\n${WIDENED_RISK_MARKER_TOO_HIGH}`, ''));
  });

  it('CONTRAST: with no note in the reply, the marker is the only statement of it, so it stays', () => {
    const withoutNote = SERVED.replace(NOTE, '').replace(/\n{3,}/g, '\n\n');
    const out = composeReplyShape({ text: withoutNote, keepWhole: 'ai_answer', faceContract: 'draft',
      widenedRiskMarker: WIDENED_RISK_MARKER_TOO_HIGH });
    expect(count(out.text, WIDENED_RISK_MARKER_TOO_HIGH)).toBe(1);
  });
});
