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

  /**
   * ⛔ THIS WAS A SOURCE-SHAPE ASSERTION, and it broke on a correct refactor.
   * It regex-matched `const INTERNAL_TARGET =` in proxy-v5-turn.ts, so when
   * #1695 replaced the module constant with a request-level resolver — the
   * right design, because a module constant is fixed at import and an env
   * change does not restart the process — the test went RED while the
   * behaviour it was guarding stayed correct. It also could never have caught
   * the thing it named: a raw string target smuggled in elsewhere would not
   * have matched the regex at all.
   *
   * The property it was reaching for is behavioural, so it is asserted as
   * behaviour: whatever arrives, the proxy can only ever resolve to one of the
   * two mounted turn routes, and only the closed vocabulary moves it off the
   * deployment default.
   */
  async function freshResolver(envTarget: string | undefined) {
    vi.resetModules();
    const before = process.env[ENV_KEY];
    if (envTarget === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = envTarget;
    try {
      const mod = await import('../../../routes/proxy-v5-turn.js');
      // ⛔ Force the parse HERE, while the env is still set. `config` is a lazy
      // Proxy that parses on first access and then caches; a closure that
      // first touches it after `finally` has restored the env reads the
      // default instead — which is exactly how the first draft of this helper
      // reported an `agent` deployment as conventional.
      const cfg = await import('../../../config/index.js');
      void cfg.config.proxy.proxyV5Target;
      return (mode: unknown) => mod.resolveProxyInternalTarget(mode);
    } finally {
      if (before === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = before;
    }
  }

  it('keeps the DEPLOYMENT DEFAULT when no mode is sent', async () => {
    expect((await freshResolver(undefined))(undefined)).toBe('/orchestrate/v2/turn');
    expect((await freshResolver('orchestrator'))(undefined)).toBe('/orchestrate/v2/turn');
    expect((await freshResolver('agent'))(undefined)).toBe('/agent/v1/turn');
  });

  it('lets the closed vocabulary override the default in BOTH directions', async () => {
    // The contrast pair: each explicit mode must win against the OPPOSITE
    // default, or "override" is indistinguishable from "happened to match".
    const onConventionalDefault = await freshResolver('orchestrator');
    expect(onConventionalDefault('openai')).toBe('/agent/v1/turn');
    expect(onConventionalDefault('conventional')).toBe('/orchestrate/v2/turn');
    const onAgentDefault = await freshResolver('agent');
    expect(onAgentDefault('conventional')).toBe('/orchestrate/v2/turn');
    expect(onAgentDefault('openai')).toBe('/agent/v1/turn');
  });

  it('treats anything outside the vocabulary as ABSENT, never as a route', async () => {
    const resolve = await freshResolver('orchestrator');
    const hostile: unknown[] = [
      'agent',                       // the CONFIG word, not the header word
      'OpenAI', 'OPENAI', ' openai', // near-misses must not match
      '/agent/v1/turn',              // a path must not be taken as a mode
      '/admin/internal/dangerous',
      ['openai'],                    // a duplicated header arrives as an array
      ['openai', 'conventional'],
      42, null, {}, '',
    ];
    for (const mode of hostile) {
      expect(resolve(mode), `mode ${JSON.stringify(mode)} must fall back to the default`)
        .toBe('/orchestrate/v2/turn');
    }
  });

  it('can ONLY ever resolve to one of the two mounted turn routes', async () => {
    const allowed = new Set(['/orchestrate/v2/turn', '/agent/v1/turn']);
    for (const env of [undefined, 'orchestrator', 'agent']) {
      const resolve = await freshResolver(env);
      for (const mode of [undefined, 'openai', 'conventional', 'agent', '/x', ['openai'], 7]) {
        expect(allowed.has(resolve(mode)), `env=${env} mode=${JSON.stringify(mode)}`).toBe(true);
      }
    }
  });
});
