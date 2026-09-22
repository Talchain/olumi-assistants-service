/**
 * `PROXY_V5_TARGET` — the one variable that moves the whole product onto the
 * Agent lane, and the reason it is an ENUM.
 *
 * ⛔ A FREE-FORM PATH HERE WOULD BE A CONFIG-CONTROLLED INTERNAL ROUTE. The
 * browser proxy injects the assist key server-side and forwards to whatever
 * this resolves to, so "whatever the environment says" would let a config
 * change aim unauthenticated browser traffic at any internal route.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const ENV_KEY = 'PROXY_V5_TARGET';

async function freshConfig(value: string | undefined) {
  vi.resetModules();
  const before = process.env[ENV_KEY];
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
  try {
    const mod = await import('../../../config/index.js');
    // Touch it: the export is a lazy Proxy that parses on first access.
    return { target: mod.config.proxy.proxyV5Target as string, error: null as unknown };
  } catch (err) {
    return { target: null, error: err };
  } finally {
    if (before === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = before;
  }
}

describe('PROXY_V5_TARGET', () => {
  beforeEach(() => { vi.resetModules(); });

  it('defaults to the orchestrator, so deploying this changes nothing', async () => {
    expect((await freshConfig(undefined)).target).toBe('orchestrator');
  });

  it('accepts the two routes that exist', async () => {
    expect((await freshConfig('agent')).target).toBe('agent');
    expect((await freshConfig('orchestrator')).target).toBe('orchestrator');
  });

  it('REFUSES an arbitrary path rather than forwarding browser traffic to it', async () => {
    const r = await freshConfig('/admin/internal/dangerous');
    expect(r.target, 'a free-form path must not resolve to a target').not.toBe('/admin/internal/dangerous');
    expect(r.error, 'config must refuse it outright').not.toBeNull();
  });

  it('is the ONLY thing that selects the agent route in the proxy', () => {
    // Binds to the call site: if someone reintroduces a raw string target, the
    // enum above stops being the control and this test stops being true.
    const proxy = readFileSync(new URL('../../../routes/proxy-v5-turn.ts', import.meta.url), 'utf8');
    const decl = /const INTERNAL_TARGET =[\s\S]{0,400}?;/.exec(proxy);
    expect(decl, 'INTERNAL_TARGET must still be a single resolved constant').not.toBeNull();
    expect(decl![0]).toContain('config.proxy.proxyV5Target');
    expect(decl![0]).toContain('/agent/v1/turn');
    expect(decl![0]).toContain('/orchestrate/v2/turn');
  });
});
