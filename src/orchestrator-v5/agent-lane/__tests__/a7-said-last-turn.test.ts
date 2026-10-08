/**
 * ⭐ A7 SAID LAST TURN → MORE DETAIL (DL 58e392 follow-up after RC6). Paul's test, 8 Oct (scenario 632b92b9): "This model
 * doesn't yet say whether any option gets there within 12 months." sat on the FACE of the Explain reply at 00:24:38 after
 * the reply before had already said it. Stored replies are the RC6 fixture (verbatim). When the latest answer said A7 word
 * for word, the route types it `detail`: still said, under More detail, never removed.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { composeReplyShape, type FaceObligation } from '../reply/compose-reply.js';
import { withA7AsDetail } from '../../../routes/agent-v1-turn.js';

const served = JSON.parse(readFileSync(new URL('../reply/__tests__/fixtures/paul-test-20261008-explain.json', import.meta.url), 'utf8')) as {
  explain_00_24_38: string; no_leader_with_reason: string; withhold_sentence: string;
};
const A7 = 'This model doesn\'t yet say whether any option gets there within 12 months.';
const TEXT = served.explain_00_24_38;
// The route's own typing of this reply (RC6 rows): the gate's closing and its bare reason.
const ROUTE: FaceObligation[] = [
  { role: 'withheld_reason', text: served.no_leader_with_reason },
  { role: 'withheld_reason', text: served.withhold_sentence.replace(/\.$/, '') },
];

describe('A7 said last turn', () => {
  it('CONTROL (served today): untyped, A7 is a FACE bullet of the 00:24:38 Explain', () => {
    expect(TEXT).toContain(A7);
    const c = composeReplyShape({ text: TEXT, obligations: ROUTE });
    expect(c.shape, 'the reply shapes').not.toBeNull();
    expect(c.shape!.bullets.join('\n')).toContain(A7);
  });

  it('RED: typed `detail` (the latest answer said it), A7 moves under More detail and is still said once', () => {
    const c = composeReplyShape({ text: TEXT, obligations: withA7AsDetail(ROUTE, A7, TEXT) });
    expect(c.shape, 'the reply still shapes').not.toBeNull();
    expect(c.shape!.bullets.join('\n')).not.toContain(A7);
    expect(c.shape!.headline).not.toContain(A7);
    expect(c.shape!.detail).toContain(A7);
    expect(c.text.split(A7).length - 1).toBe(1);
  });

  it('withA7AsDetail: no repeat / not in this text → obligations unchanged; one role per unit', () => {
    expect(withA7AsDetail(ROUTE, null, TEXT)).toEqual(ROUTE);
    expect(withA7AsDetail(ROUTE, A7, 'Another reply.')).toEqual(ROUTE);
    const hosted = [...ROUTE, { role: 'host' as const, text: A7 }];
    expect(withA7AsDetail(hosted, A7, TEXT).filter((o) => o.text === A7)).toEqual([{ role: 'detail', text: A7 }]);
  });
});
