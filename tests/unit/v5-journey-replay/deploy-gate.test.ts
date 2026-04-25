import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EXPECTED_STAGING_BUILD,
  evaluateDeployGate,
  isStaleDeployOverrideEnabled,
} from '../../../tools/v5-journey-replay/index.js';
import type { HealthzResult } from '../../../tools/v5-journey-replay/types.js';
import { stubFetchRouter } from './_test-helpers.js';

const SENTINEL = 'SENTINEL-LEAK-CANARY-DO-NOT-MATCH-PROD-xyz123';

const STAGING = 'https://cee-staging.onrender.com';

function healthz(overrides: Partial<HealthzResult['body']> = {}): HealthzResult {
  return {
    status: 200,
    elapsed_ms: 100,
    body: {
      ok: true,
      build: EXPECTED_STAGING_BUILD,
      version: '1.12.0',
      service: 'assistants',
      degraded: false,
      ...overrides,
    },
  };
}

describe('isStaleDeployOverrideEnabled', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.OLUMI_REPLAY_ALLOW_STALE_DEPLOY;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['yes', true],
    ['  true  ', true],
    ['false', false],
    ['0', false],
    ['', false],
  ])('env=%j → %p', (val, expected) => {
    vi.stubEnv('OLUMI_REPLAY_ALLOW_STALE_DEPLOY', val);
    expect(isStaleDeployOverrideEnabled()).toBe(expected);
  });

  it('unset → false', () => {
    expect(isStaleDeployOverrideEnabled()).toBe(false);
  });
});

describe('evaluateDeployGate', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.OLUMI_REPLAY_ALLOW_STALE_DEPLOY;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes for matching build, not degraded, on staging', () => {
    expect(evaluateDeployGate(STAGING, healthz()).halt).toBe(false);
  });

  it('halts when healthz is missing on a remote URL', () => {
    const v = evaluateDeployGate(STAGING, undefined);
    expect(v.halt).toBe(true);
    expect(v.reason).toMatch(/healthz unreachable/);
  });

  it('halts when healthz body is undefined on a remote URL', () => {
    const v = evaluateDeployGate(STAGING, { status: 500, elapsed_ms: 10, body: undefined });
    expect(v.halt).toBe(true);
  });

  it('halts when build does not match expected staging SHA', () => {
    const v = evaluateDeployGate(STAGING, healthz({ build: 'deadbee' }));
    expect(v.halt).toBe(true);
    expect(v.reason).toMatch(/build=deadbee/);
    expect(v.reason).toMatch(/expected 66d1adb/);
  });

  it('halts when degraded === true', () => {
    const v = evaluateDeployGate(
      STAGING,
      healthz({ degraded: true, degraded_reasons: ['supabase down', 'plot timeout'] }),
    );
    expect(v.halt).toBe(true);
    expect(v.reason).toMatch(/degraded=true/);
    expect(v.reason).toMatch(/supabase down, plot timeout/);
  });

  it('skips the gate entirely for localhost (local builds use arbitrary SHAs)', () => {
    expect(
      evaluateDeployGate('http://localhost:3000', healthz({ build: 'localdev' })).halt,
    ).toBe(false);
    expect(evaluateDeployGate('http://127.0.0.1:8080', undefined).halt).toBe(false);
  });

  describe('OLUMI_REPLAY_ALLOW_STALE_DEPLOY override', () => {
    it('bypasses missing-healthz halt', () => {
      vi.stubEnv('OLUMI_REPLAY_ALLOW_STALE_DEPLOY', 'true');
      expect(evaluateDeployGate(STAGING, undefined).halt).toBe(false);
    });

    it('bypasses build-mismatch halt', () => {
      vi.stubEnv('OLUMI_REPLAY_ALLOW_STALE_DEPLOY', 'true');
      expect(evaluateDeployGate(STAGING, healthz({ build: 'deadbee' })).halt).toBe(false);
    });

    it('bypasses degraded halt', () => {
      vi.stubEnv('OLUMI_REPLAY_ALLOW_STALE_DEPLOY', 'true');
      expect(evaluateDeployGate(STAGING, healthz({ degraded: true })).halt).toBe(false);
    });
  });
});

// Full integration: confirm a stale deploy halts run() before
// preflight, exits 3, and writes an evidence pack documenting the halt.

const writes: Array<{ path: string; content: string }> = [];
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    writeFileSync: vi.fn((path: string, content: string) => {
      writes.push({ path: String(path), content: String(content) });
    }),
  };
});

class ProcessExitError extends Error {
  constructor(public code: number | string | null | undefined) {
    super(`process.exit(${code})`);
    this.name = 'ProcessExitError';
  }
}

let originalArgv: string[] = [];
let originalExit: typeof process.exit;

describe('run() honours the deploy gate', () => {
  beforeEach(() => {
    writes.length = 0;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete process.env.OLUMI_REPLAY_API_KEY;
    delete process.env.OLUMI_REPLAY_ALLOW_STALE_DEPLOY;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    originalArgv = process.argv;
    originalExit = process.exit;
    process.exit = ((code?: number | string | null | undefined) => {
      throw new ProcessExitError(code);
    }) as typeof process.exit;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    process.argv = originalArgv;
    process.exit = originalExit;
  });

  async function importFreshRun() {
    vi.resetModules();
    return (await import('../../../tools/v5-journey-replay/index.js')) as typeof import('../../../tools/v5-journey-replay/index.js');
  }

  it('stale build halts before preflight, exits 3, no /orchestrate calls made', async () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      STAGING,
      '--out',
      '/tmp/v5-stale.md',
    ];
    let orchestrateCalls = 0;
    stubFetchRouter((url) => {
      if (url.endsWith('/healthz')) {
        return { status: 200, jsonValue: { ok: true, build: 'staleee', version: '0', service: 'assistants', degraded: false } };
      }
      orchestrateCalls += 1;
      return { status: 422, jsonValue: {} };
    });

    const mod = await importFreshRun();
    await expect(mod.run()).rejects.toMatchObject({ name: 'ProcessExitError', code: 3 });

    expect(orchestrateCalls).toBe(0);
    expect(writes.length).toBe(1);
    const pack = writes[0]!.content;
    expect(pack).toMatch(/Deploy MISMATCH/);
    expect(pack).toMatch(/staleee/);
  });

  it('degraded healthz halts before preflight, exits 3', async () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      STAGING,
      '--out',
      '/tmp/v5-degraded.md',
    ];
    let orchestrateCalls = 0;
    stubFetchRouter((url) => {
      if (url.endsWith('/healthz')) {
        return {
          status: 200,
          jsonValue: {
            ok: true,
            build: EXPECTED_STAGING_BUILD,
            version: '1',
            service: 'assistants',
            degraded: true,
            degraded_reasons: ['supabase unreachable'],
          },
        };
      }
      orchestrateCalls += 1;
      return { status: 200, jsonValue: {} };
    });

    const mod = await importFreshRun();
    await expect(mod.run()).rejects.toMatchObject({ name: 'ProcessExitError', code: 3 });
    expect(orchestrateCalls).toBe(0);
    const pack = writes[0]!.content;
    expect(pack).toMatch(/degraded:\*\* true/);
  });

  it('OLUMI_REPLAY_ALLOW_STALE_DEPLOY=true bypasses the gate even on stale build', async () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    vi.stubEnv('OLUMI_REPLAY_ALLOW_STALE_DEPLOY', 'true');
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      STAGING,
      '--out',
      '/tmp/v5-override.md',
    ];
    let orchestrateCalls = 0;
    stubFetchRouter((url) => {
      if (url.endsWith('/healthz')) {
        return { status: 200, jsonValue: { ok: true, build: 'staleee', version: '0', service: 'assistants' } };
      }
      orchestrateCalls += 1;
      // 200 with valid product shape so steps pass.
      return {
        status: 200,
        jsonValue: {
          response_version: 2,
          assistant_text: 'ok',
          suggested_actions: [{ id: 'c', label: 'L', message: 'M' }],
        },
      };
    });

    const mod = await importFreshRun();
    await mod.run();
    // Override allowed the run to proceed: 1 preflight + 6 canonical steps = 7 POSTs.
    expect(orchestrateCalls).toBe(7);
  });
});
