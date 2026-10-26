/**
 * BOTH browser proxies must resolve the SAME internal target from the SAME bounded resolver.
 *
 * The historical failure this guards was a deployment-wide Agent target on the buffered proxy
 * while streamed browser turns still hardcoded the conventional orchestrator. Comparison mode
 * added an explicit per-request override; since inventory F1b every mode is the core route's, and the invariant is "one
 * resolver, one target, the same on both transports".
 */

import { describe, it, expect, vi } from 'vitest';

const mockConfig = {
  proxy: {
    proxyV5Target: 'agent',
  },
};

vi.mock('../../config/index.js', () => ({ config: mockConfig }));

const { resolveProxyInternalTarget } = await import('../proxy-v5-turn.js');

describe('browser proxy target parity', () => {
  it('F1b: one target on either deployment default, for every mode and none: the core route', () => {
    for (const target of ['agent', 'orchestrator']) {
      mockConfig.proxy.proxyV5Target = target;
      for (const mode of [undefined, 'conventional', 'openai', 'core', 'core-route', '/admin', 'anything-else']) {
        expect(resolveProxyInternalTarget(mode), `${target} ${String(mode)}`).toBe('/agent/v1/core-turn');
      }
    }
  });

  it('the streamed browser route consumes the SAME resolver rather than owning another decision', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../proxy-v5-turn-stream.ts', import.meta.url), 'utf8');
    expect(src).toContain('resolveProxyInternalTarget');
    expect(src).toContain('internalTarget: resolveProxyInternalTarget(request.headers[AI_MODE_HEADER])');
  });
});
