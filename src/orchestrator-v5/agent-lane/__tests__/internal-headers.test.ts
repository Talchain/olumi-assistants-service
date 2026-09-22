/**
 * ⛔ MEASURED AGAINST DEPLOYED STAGING, with a contrast control in the same run:
 *   OWNED scenario + assist key only -> 404
 *   GUEST scenario + assist key only -> 200
 * An internal dispatch carrying only the key works on guests — which is what
 * local testing used — and fails on every signed-in user's own model.
 */

import { describe, it, expect } from 'vitest';
import { internalHeaders } from '../internal-headers.js';

describe('internalHeaders', () => {
  it('FORWARDS the caller authorization, or an owned scenario reads as 404', () => {
    const h = internalHeaders('k', 'Bearer abc.def.ghi');
    expect(h.authorization).toBe('Bearer abc.def.ghi');
    expect(h['x-olumi-assist-key']).toBe('k');
  });

  it('omits authorization entirely when the caller had none', () => {
    // Not an empty string: an empty Authorization header is not the same as no
    // header, and some parsers treat it as a malformed credential.
    const h = internalHeaders('k', undefined);
    expect('authorization' in h).toBe(false);
  });

  it('treats an empty authorization as absent — the contrast control', () => {
    const h = internalHeaders('k', '');
    expect('authorization' in h).toBe(false);
  });

  it('always carries the assist key, which the internal routes still require', () => {
    for (const a of [undefined, '', 'Bearer x']) {
      expect(internalHeaders('the-key', a)['x-olumi-assist-key']).toBe('the-key');
    }
  });
});
