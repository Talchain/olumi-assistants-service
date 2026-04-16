import { describe, it, expect } from 'vitest';
import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';

describe('commitDirectAnswer (A1 no-op per Paul constraint 11)', () => {
  it('returns the composed response unchanged', () => {
    const composed = composeDirectAnswerResponse({
      assistant_text: 'hi',
      stage: 'frame',
    });
    const result = commitDirectAnswer(composed);
    expect(result.response).toBe(composed);
    expect(result.performed).toBe(true);
  });

  it('throws on falsy response (invariant guard)', () => {
    // @ts-expect-error — deliberately invalid for invariant assertion
    expect(() => commitDirectAnswer(null)).toThrow(/invariant/i);
  });
});
