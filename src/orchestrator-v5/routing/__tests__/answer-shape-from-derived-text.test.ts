/**
 * ⭐ THE ONE INVERSE of `deriveAnswerTextFromShape` (DL 58e392, 8 Oct: every Explain replay shipped whole while the live
 * turn was shaped). Paul's two served Explain answers (8 Oct, scenario 632b92b9; the RC6 fixture, verbatim) are the
 * composer's own derived text: their shape reads back and re-derives them byte for byte.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { answerShapeFromDerivedText, deriveAnswerTextFromShape } from '../answer-shape.js';
import { composeReplyShape } from '../../agent-lane/reply/compose-reply.js';

const served = JSON.parse(readFileSync(new URL('../../agent-lane/reply/__tests__/fixtures/paul-test-20261008-explain.json', import.meta.url), 'utf8')) as Record<string, string>;

describe('answerShapeFromDerivedText', () => {
  it.each(['explain_00_24_38', 'explain_00_30_46'])('RED (served %s): the stored words give back their shape, byte for byte', key => {
    const text = served[key]!;
    const shape = answerShapeFromDerivedText(text);
    expect(shape, 'a shape is read back').not.toBeNull();
    expect(deriveAnswerTextFromShape(shape!)).toBe(text);
    expect(shape!.bullets.length).toBe(3);
  });

  it('round trip: whatever the composer shapes, its derived text reads back to the SAME shape', () => {
    const c = composeReplyShape({ text: served.explain_00_24_38!, obligations: [] });
    expect(c.shape).not.toBeNull();
    expect(answerShapeFromDerivedText(c.text)).toEqual(c.shape);
  });

  it.each([
    ['a single paragraph', 'Just one paragraph. With two sentences.'],
    ['no bullet paragraph after the headline', 'Headline here.\n\nA second paragraph, not bullets.'],
    ['narrator "-" bullets (only the composer writes •)', 'Headline here.\n\n- one\n- two'],
    ['a mixed bullet paragraph', 'Headline here.\n\n• one\nnot a bullet'],
    ['four bullets (the face holds three)', 'Headline here.\n\n• a\n• b\n• c\n• d'],
    ['a two-sentence headline', 'First sentence. Second sentence.\n\n• a'],
  ])('%s → null (the replay ships whole, as before)', (_n, text) => {
    expect(answerShapeFromDerivedText(text)).toBeNull();
  });
});
