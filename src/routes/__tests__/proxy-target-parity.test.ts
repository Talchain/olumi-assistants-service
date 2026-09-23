/**
 * BOTH browser proxies must resolve the SAME internal target from the SAME bounded resolver.
 *
 * The historical failure this guards was a deployment-wide Agent target on the buffered proxy
 * while streamed browser turns still hardcoded the conventional orchestrator. Comparison mode
 * now adds an explicit per-request override, so the invariant is no longer "one constant"; it is
 * "one resolver, one closed target vocabulary, same result on both transports".
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
  it('keeps the deployment default when no explicit comparison mode is supplied', () => {
    expect(resolveProxyInternalTarget(undefined)).toBe('/agent/v1/turn');
  });

  it('explicit Conventional can override an Agent deployment without allowing arbitrary paths', () => {
    expect(resolveProxyInternalTarget('conventional')).toBe('/orchestrate/v2/turn');
    expect(resolveProxyInternalTarget('/admin')).toBe('/agent/v1/turn');
    expect(resolveProxyInternalTarget('anything-else')).toBe('/agent/v1/turn');
  });

  it('explicit OpenAI resolves to the Agent target', () => {
    mockConfig.proxy.proxyV5Target = 'orchestrator';
    expect(resolveProxyInternalTarget('openai')).toBe('/agent/v1/turn');
    expect(resolveProxyInternalTarget(undefined)).toBe('/orchestrate/v2/turn');
  });

  it('the streamed browser route consumes the SAME resolver rather than owning another decision', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../proxy-v5-turn-stream.ts', import.meta.url), 'utf8');
    expect(src).toContain('resolveProxyInternalTarget');
    expect(src).toContain('internalTarget: resolveProxyInternalTarget(request.headers[AI_MODE_HEADER])');
  });
});
