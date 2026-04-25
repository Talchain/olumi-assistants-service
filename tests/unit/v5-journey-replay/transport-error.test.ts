import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stubFetchRouter } from './_test-helpers.js';

const SENTINEL = 'SENTINEL-LEAK-CANARY-DO-NOT-MATCH-PROD-xyz123';
const STAGING = 'https://cee-staging.onrender.com';
const EXPECTED_BUILD = '66d1adb';

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

describe('mid-replay transport error → attempted row fails, dependents skip, exit 1', () => {
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

  it('step 1 throws ECONNREFUSED → row failed (not skipped), exit 1, dependents skip', async () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      STAGING,
      '--out',
      '/tmp/v5-transport.md',
    ];
    let orchestrateCalls = 0;
    stubFetchRouter((url) => {
      if (url.endsWith('/healthz')) {
        return { status: 200, jsonValue: { ok: true, build: EXPECTED_BUILD, service: 'assistants' } };
      }
      orchestrateCalls += 1;
      // Preflight (call #1) succeeds with 422; step 1 (call #2) throws.
      if (orchestrateCalls === 1) {
        return { status: 422, jsonValue: { error: 'INVALID' } };
      }
      if (orchestrateCalls === 2) {
        return new Error('connect ECONNREFUSED 1.2.3.4:443');
      }
      // No further calls expected — every other step depends on step 1.
      throw new Error('unexpected /orchestrate/v2/turn call after step 1 transport failure');
    });

    const mod = await importFreshRun();
    // CRITICAL: must exit 1 (failure), NOT 0. Pre-fix, transport errors
    // marked rows as "skipped" and the failed-count-only exit check
    // would let CI stay green on a broken run.
    await expect(mod.run()).rejects.toMatchObject({ name: 'ProcessExitError', code: 1 });

    const pack = writes[0]!.content;
    // Step 1: must be FAILED (not skipped) — the request was attempted.
    expect(pack).toMatch(/`1_draft_graph` \| \[FAIL\] failed/);
    expect(pack).toMatch(/transport error/);
    // Dependents: must be SKIPPED — they were not attempted.
    expect(pack).toMatch(/`2_weakest_option` \| \[SKIP\] skipped/);
    expect(pack).toMatch(/`4_run_analysis` \| \[SKIP\] skipped/);
    // Step 5 depends on step 4 (transitive) — must also skip.
    expect(pack).toMatch(/`5_explain_leader` \| \[SKIP\] skipped/);
  });

  it('step 4 throws mid-replay → row failed, step 5 skips transitively, exit 1', async () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      STAGING,
      '--out',
      '/tmp/v5-transport-mid.md',
    ];
    let orchestrateCalls = 0;
    stubFetchRouter((url) => {
      if (url.endsWith('/healthz')) {
        return { status: 200, jsonValue: { ok: true, build: EXPECTED_BUILD, service: 'assistants' } };
      }
      orchestrateCalls += 1;
      // Preflight = 422 (call #1). Steps 1,2,3 = 200 with valid shape (calls #2-#4).
      // Step 4 = transport error (call #5). Step 6 still attempts (no dep on 4).
      if (orchestrateCalls === 1) {
        return { status: 422, jsonValue: {} };
      }
      if (orchestrateCalls === 5) {
        return new Error('fetch failed: socket hang up mid-stream');
      }
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
    await expect(mod.run()).rejects.toMatchObject({ name: 'ProcessExitError', code: 1 });

    const pack = writes[0]!.content;
    // Steps 1-3 pass.
    expect(pack).toMatch(/`1_draft_graph` \| \[PASS\] passed/);
    expect(pack).toMatch(/`2_weakest_option` \| \[PASS\] passed/);
    expect(pack).toMatch(/`3_add_option` \| \[PASS\] passed/);
    // Step 4 must be FAILED (attempted, transport failed).
    expect(pack).toMatch(/`4_run_analysis` \| \[FAIL\] failed[\s\S]*transport error/);
    // Step 5 must skip (depends on 4).
    expect(pack).toMatch(/`5_explain_leader` \| \[SKIP\] skipped/);
    // Step 6 has no dependency on step 4 — should pass.
    expect(pack).toMatch(/`6_edit_budget` \| \[PASS\] passed/);
  });
});
