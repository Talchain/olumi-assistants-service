import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WELL_FORMED_BUILD,
  evaluateDeployGate,
  isStaleDeployOverrideEnabled,
  parseArgs,
  readExpectedBuildEnv,
} from '../../../tools/v5-journey-replay/index.js';
import type { HealthzResult } from '../../../tools/v5-journey-replay/types.js';
import { stubFetchRouter, REPLAY_FIXTURE_ANALYSIS_READY } from './_test-helpers.js';

const SENTINEL = 'SENTINEL-LEAK-CANARY-DO-NOT-MATCH-PROD-xyz123';

const STAGING = 'https://cee-staging.onrender.com';
const SAMPLE_BUILD = '4d7e6c3';
const OTHER_BUILD = 'deadbee';

function healthz(overrides: Partial<HealthzResult['body']> = {}): HealthzResult {
  return {
    status: 200,
    elapsed_ms: 100,
    body: {
      ok: true,
      build: SAMPLE_BUILD,
      version: '1.12.0',
      service: 'assistants',
      degraded: false,
      ...overrides,
    },
  };
}

describe('WELL_FORMED_BUILD', () => {
  it.each([
    ['4d7e6c3', true],
    ['66d1adb', true],
    ['1234567', true],
    ['abcdef0123456789', true],
    ['ABCDEF1', true],
    ['unknown', false],
    ['', false],
    ['12345', false],
    ['short', false],
    ['ghijklm', false], // not hex
  ])('build=%j → %p', (build, expected) => {
    expect(WELL_FORMED_BUILD.test(build)).toBe(expected);
  });
});

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

describe('readExpectedBuildEnv', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.OLUMI_REPLAY_EXPECTED_BUILD;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('unset → undefined', () => {
    expect(readExpectedBuildEnv()).toBeUndefined();
  });

  it('empty / whitespace-only → undefined', () => {
    vi.stubEnv('OLUMI_REPLAY_EXPECTED_BUILD', '');
    expect(readExpectedBuildEnv()).toBeUndefined();
    vi.stubEnv('OLUMI_REPLAY_EXPECTED_BUILD', '   ');
    expect(readExpectedBuildEnv()).toBeUndefined();
  });

  it('returns the trimmed value when set', () => {
    vi.stubEnv('OLUMI_REPLAY_EXPECTED_BUILD', '  4d7e6c3  ');
    expect(readExpectedBuildEnv()).toBe('4d7e6c3');
  });
});

describe('parseArgs (expected-build resolution)', () => {
  let originalArgv: string[];
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.OLUMI_REPLAY_EXPECTED_BUILD;
    delete process.env.OLUMI_REPLAY_API_KEY;
    originalArgv = process.argv;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    process.argv = originalArgv;
  });

  it('--expected-build SHA wins over OLUMI_REPLAY_EXPECTED_BUILD', () => {
    vi.stubEnv('OLUMI_REPLAY_EXPECTED_BUILD', 'envvalue');
    process.argv = ['node', 'script', '--base-url', STAGING, '--expected-build', 'cliwins'];
    expect(parseArgs().expectedBuild).toBe('cliwins');
  });

  it('--expected-build=SHA (= form) is parsed', () => {
    process.argv = ['node', 'script', '--base-url', STAGING, '--expected-build=eqform'];
    expect(parseArgs().expectedBuild).toBe('eqform');
  });

  it('falls back to env var when CLI flag is absent', () => {
    vi.stubEnv('OLUMI_REPLAY_EXPECTED_BUILD', 'envvalue');
    process.argv = ['node', 'script', '--base-url', STAGING];
    expect(parseArgs().expectedBuild).toBe('envvalue');
  });

  it('returns undefined when neither is set (default mode)', () => {
    process.argv = ['node', 'script', '--base-url', STAGING];
    expect(parseArgs().expectedBuild).toBeUndefined();
  });

  it('empty CLI value falls through to env var', () => {
    vi.stubEnv('OLUMI_REPLAY_EXPECTED_BUILD', 'envvalue');
    process.argv = ['node', 'script', '--base-url', STAGING, '--expected-build', '   '];
    expect(parseArgs().expectedBuild).toBe('envvalue');
  });
});

describe('evaluateDeployGate (default mode — no expectedBuild)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.OLUMI_REPLAY_ALLOW_STALE_DEPLOY;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes when build is well-formed and not degraded', () => {
    expect(evaluateDeployGate(STAGING, healthz()).halt).toBe(false);
  });

  it('passes for any well-formed SHA (no comparison)', () => {
    expect(evaluateDeployGate(STAGING, healthz({ build: OTHER_BUILD })).halt).toBe(false);
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

  it('halts when build is missing', () => {
    const v = evaluateDeployGate(STAGING, healthz({ build: undefined }));
    expect(v.halt).toBe(true);
    expect(v.reason).toMatch(/well-formed short SHA/);
  });

  it('halts when build is malformed (too short)', () => {
    const v = evaluateDeployGate(STAGING, healthz({ build: 'abc' }));
    expect(v.halt).toBe(true);
    expect(v.reason).toMatch(/build=abc/);
    expect(v.reason).toMatch(/well-formed short SHA/);
  });

  it('halts when build is malformed (non-hex)', () => {
    const v = evaluateDeployGate(STAGING, healthz({ build: 'ghijklm' }));
    expect(v.halt).toBe(true);
    expect(v.reason).toMatch(/well-formed short SHA/);
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
});

describe('evaluateDeployGate (strict mode — expectedBuild supplied)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.OLUMI_REPLAY_ALLOW_STALE_DEPLOY;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes when build matches expectedBuild', () => {
    expect(evaluateDeployGate(STAGING, healthz(), SAMPLE_BUILD).halt).toBe(false);
  });

  it('halts when build does not match expectedBuild', () => {
    const v = evaluateDeployGate(STAGING, healthz({ build: OTHER_BUILD }), SAMPLE_BUILD);
    expect(v.halt).toBe(true);
    expect(v.reason).toMatch(new RegExp(`build=${OTHER_BUILD}`));
    expect(v.reason).toMatch(new RegExp(`requires ${SAMPLE_BUILD}`));
  });

  it('still halts on malformed build before checking expectedBuild', () => {
    const v = evaluateDeployGate(STAGING, healthz({ build: 'abc' }), SAMPLE_BUILD);
    expect(v.halt).toBe(true);
    expect(v.reason).toMatch(/well-formed short SHA/);
  });

  it('halts on degraded even when build matches expectedBuild', () => {
    const v = evaluateDeployGate(STAGING, healthz({ degraded: true }), SAMPLE_BUILD);
    expect(v.halt).toBe(true);
    expect(v.reason).toMatch(/degraded=true/);
  });
});

describe('evaluateDeployGate (localhost short-circuit)', () => {
  it('skips the gate entirely for localhost — no SHA check, no degraded check', () => {
    expect(
      evaluateDeployGate('http://localhost:3000', healthz({ build: 'localdev' })).halt,
    ).toBe(false);
    expect(evaluateDeployGate('http://127.0.0.1:8080', undefined).halt).toBe(false);
    expect(
      evaluateDeployGate('http://localhost:3000', healthz({ degraded: true }), SAMPLE_BUILD).halt,
    ).toBe(false);
  });
});

describe('evaluateDeployGate (OLUMI_REPLAY_ALLOW_STALE_DEPLOY override)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('OLUMI_REPLAY_ALLOW_STALE_DEPLOY', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('bypasses missing-healthz halt', () => {
    expect(evaluateDeployGate(STAGING, undefined).halt).toBe(false);
  });

  it('bypasses malformed-build halt', () => {
    expect(evaluateDeployGate(STAGING, healthz({ build: 'abc' })).halt).toBe(false);
  });

  it('bypasses strict-mode mismatch halt', () => {
    expect(
      evaluateDeployGate(STAGING, healthz({ build: OTHER_BUILD }), SAMPLE_BUILD).halt,
    ).toBe(false);
  });

  it('bypasses degraded halt', () => {
    expect(evaluateDeployGate(STAGING, healthz({ degraded: true })).halt).toBe(false);
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
    delete process.env.OLUMI_REPLAY_EXPECTED_BUILD;
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

  it('default mode + malformed build halts before preflight, exits 3', async () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      STAGING,
      '--out',
      '/tmp/v5-malformed.md',
    ];
    let orchestrateCalls = 0;
    stubFetchRouter((url) => {
      if (url.endsWith('/healthz')) {
        return {
          status: 200,
          jsonValue: { ok: true, build: 'abc', version: '0', service: 'assistants', degraded: false },
        };
      }
      orchestrateCalls += 1;
      return { status: 422, jsonValue: {} };
    });

    const mod = await importFreshRun();
    await expect(mod.run()).rejects.toMatchObject({ name: 'ProcessExitError', code: 3 });

    expect(orchestrateCalls).toBe(0);
    expect(writes.length).toBe(1);
    const pack = writes[0]!.content;
    expect(pack).toMatch(/Deploy metadata unverifiable|build .* is well-formed/);
  });

  it('strict mode + mismatched build halts before preflight, exits 3', async () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      STAGING,
      '--expected-build',
      SAMPLE_BUILD,
      '--out',
      '/tmp/v5-strict-mismatch.md',
    ];
    let orchestrateCalls = 0;
    stubFetchRouter((url) => {
      if (url.endsWith('/healthz')) {
        return {
          status: 200,
          jsonValue: {
            ok: true,
            build: OTHER_BUILD,
            version: '0',
            service: 'assistants',
            degraded: false,
          },
        };
      }
      orchestrateCalls += 1;
      return { status: 422, jsonValue: {} };
    });

    const mod = await importFreshRun();
    await expect(mod.run()).rejects.toMatchObject({ name: 'ProcessExitError', code: 3 });

    expect(orchestrateCalls).toBe(0);
    const pack = writes[0]!.content;
    expect(pack).toMatch(/Deploy MISMATCH/);
    expect(pack).toMatch(new RegExp(OTHER_BUILD));
  });

  it('default mode + well-formed build proceeds (no SHA check)', async () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      STAGING,
      '--out',
      '/tmp/v5-default-pass.md',
    ];
    let orchestrateCalls = 0;
    stubFetchRouter((url) => {
      if (url.endsWith('/healthz')) {
        return {
          status: 200,
          jsonValue: { ok: true, build: SAMPLE_BUILD, version: '1', service: 'assistants' },
        };
      }
      orchestrateCalls += 1;
      return {
        status: 200,
        jsonValue: {
          response_version: 2,
          assistant_text: 'ok',
          suggested_actions: [{ id: 'c', label: 'L', message: 'M' }],
          // Step 4 hard-fails when analysis_ready is absent. Including
          // it on every step is harmless (schema-optional) and lets the
          // shared fixture serve all 6 canonical steps.
          analysis_ready: REPLAY_FIXTURE_ANALYSIS_READY,
        },
      };
    });

    const mod = await importFreshRun();
    await mod.run();
    // 1 preflight + 6 canonical steps = 7 POSTs.
    expect(orchestrateCalls).toBe(7);
    const pack = writes[0]!.content;
    expect(pack).toMatch(/well-formed/);
  });

  it('strict mode + matching build proceeds and reports MATCH in evidence', async () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      STAGING,
      '--expected-build',
      SAMPLE_BUILD,
      '--out',
      '/tmp/v5-strict-match.md',
    ];
    stubFetchRouter((url) => {
      if (url.endsWith('/healthz')) {
        return {
          status: 200,
          jsonValue: { ok: true, build: SAMPLE_BUILD, version: '1', service: 'assistants' },
        };
      }
      return {
        status: 200,
        jsonValue: {
          response_version: 2,
          assistant_text: 'ok',
          suggested_actions: [{ id: 'c', label: 'L', message: 'M' }],
          // Step 4 hard-fails when analysis_ready is absent. Including
          // it on every step is harmless (schema-optional) and lets the
          // shared fixture serve all 6 canonical steps.
          analysis_ready: REPLAY_FIXTURE_ANALYSIS_READY,
        },
      };
    });

    const mod = await importFreshRun();
    await mod.run();
    const pack = writes[0]!.content;
    expect(pack).toMatch(/Deploy confirmed/);
    expect(pack).toMatch(new RegExp(`matches.*${SAMPLE_BUILD}`));
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
            build: SAMPLE_BUILD,
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

  it('OLUMI_REPLAY_ALLOW_STALE_DEPLOY=true bypasses the gate even on malformed build', async () => {
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
        return { status: 200, jsonValue: { ok: true, build: 'abc', version: '0', service: 'assistants' } };
      }
      orchestrateCalls += 1;
      return {
        status: 200,
        jsonValue: {
          response_version: 2,
          assistant_text: 'ok',
          suggested_actions: [{ id: 'c', label: 'L', message: 'M' }],
          // Step 4 hard-fails when analysis_ready is absent. Including
          // it on every step is harmless (schema-optional) and lets the
          // shared fixture serve all 6 canonical steps.
          analysis_ready: REPLAY_FIXTURE_ANALYSIS_READY,
        },
      };
    });

    const mod = await importFreshRun();
    await mod.run();
    // Override allowed the run to proceed: 1 preflight + 6 canonical steps = 7 POSTs.
    expect(orchestrateCalls).toBe(7);
  });
});
