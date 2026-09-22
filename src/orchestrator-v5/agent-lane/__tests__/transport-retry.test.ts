/**
 * One retry, for a transport failure only.
 *
 * ⛔ MEASURED, NOT PRECAUTIONARY. In a six-turn head-to-head against current
 * CEE, one Agent turn died with `TypeError: fetch failed` after 196 ms — a
 * connection-level failure to the model API — and the route answered 502. The
 * user's turn was simply lost. One in six turns makes any journey witness a
 * coin toss, which is why this is a blocker and not hardening.
 */

import { describe, it, expect } from 'vitest';
import { onceMoreOnTransportFailure } from '../runtime/transport-retry.js';

describe('onceMoreOnTransportFailure', () => {
  it('does not call twice when the first call works', async () => {
    let calls = 0;
    const r = await onceMoreOnTransportFailure('t', async () => { calls += 1; return 'ok'; });
    expect(r).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries a thrown transport failure once, and succeeds', async () => {
    let calls = 0;
    const r = await onceMoreOnTransportFailure('t', async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return 'recovered';
    });
    expect(r).toBe('recovered');
    expect(calls).toBe(2);
  });

  it('REFUSES to repeat an HTTP answer — the contrast control', async () => {
    // A 4xx is a decision the API made about this request; repeating it changes
    // nothing and a 5xx may already have been charged. If this retried too, the
    // test above would not be measuring the distinction that matters.
    let calls = 0;
    await expect(onceMoreOnTransportFailure('t', async () => {
      calls += 1;
      throw new Error('openai_429: rate limited');
    })).rejects.toThrow('openai_429');
    expect(calls, 'an HTTP status must not be retried').toBe(1);
  });

  it('gives up after ONE retry, so a real outage still fails fast', async () => {
    let calls = 0;
    await expect(onceMoreOnTransportFailure('t', async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    })).rejects.toThrow('fetch failed');
    expect(calls).toBe(2);
  });

  it('reports the retry rather than hiding it', async () => {
    const seen: string[] = [];
    let calls = 0;
    await onceMoreOnTransportFailure('construction', async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return 'ok';
    }, (label, err) => seen.push(`${label}:${err}`));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('construction');
  });
});
