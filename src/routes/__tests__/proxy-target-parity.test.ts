/**
 * BOTH browser proxies must resolve the SAME internal target from the SAME key.
 *
 * ⛔ THE FAILURE THIS EXISTS TO PREVENT, MEASURED ON DEPLOYED STAGING.
 * `PROXY_V5_TARGET=agent` was set and verified. The buffered `/proxy/v5/turn`
 * honoured it and reached `/agent/v1/turn`. But the UI's CONVERSATIONAL traffic
 * goes through `/proxy/v5/turn/stream`, whose target was a hardcoded
 * `"/orchestrate/v2/turn"` — so every real turn went to the other engine while
 * the flag read as active.
 *
 * Nothing errored. The product answered well, in CEE's voice, with CEE's
 * invented numbers, and a 64-73 s model build. That is why a parity test is the
 * right shape: the defect is invisible from either side alone, and only the
 * RELATIONSHIP between the two constants is wrong.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { STREAMED_TURN_INTERNAL_TARGET } from '../streamed-turn-sse.js';
import { config } from '../../config/index.js';

const bufferedSource = (): string =>
  readFileSync(new URL('../proxy-v5-turn.ts', import.meta.url), 'utf8');

describe('browser proxy target parity', () => {
  it('the streamed target follows the SAME config key as the buffered one', () => {
    const expected =
      config.proxy.proxyV5Target === 'agent' ? '/agent/v1/turn' : '/orchestrate/v2/turn';
    expect(STREAMED_TURN_INTERNAL_TARGET).toBe(expected);
  });

  it('the buffered route resolves its target from that key too, not a literal', () => {
    // Derived from the source because the buffered constant is module-private.
    // The assertion is about the DECISION, not the string.
    const src = bufferedSource();
    const decl = /const INTERNAL_TARGET =[\s\S]{0,400}?;/.exec(src);
    expect(decl, 'INTERNAL_TARGET must still be a single resolved constant').not.toBeNull();
    expect(decl![0], 'the buffered route must read proxyV5Target').toContain('config.proxy.proxyV5Target');
    expect(decl![0]).toContain('/agent/v1/turn');
    expect(decl![0]).toContain('/orchestrate/v2/turn');
  });

  it('neither target is a bare literal — the contrast control', () => {
    // If the streamed constant were hardcoded again, it would still EQUAL the
    // buffered one whenever the flag happened to be unset. That is precisely
    // how this shipped: green in the default configuration, wrong in the one
    // that matters. So assert the SOURCE resolves from config, not just that
    // today's values agree.
    const streamSrc = readFileSync(new URL('../streamed-turn-sse.ts', import.meta.url), 'utf8');
    const decl = /export const STREAMED_TURN_INTERNAL_TARGET =[\s\S]{0,300}?;/.exec(streamSrc);
    expect(decl, 'the streamed target must be a single resolved constant').not.toBeNull();
    expect(
      decl![0],
      'the streamed target must be DERIVED from config.proxy.proxyV5Target, not hardcoded',
    ).toContain('config.proxy.proxyV5Target');
  });
});
