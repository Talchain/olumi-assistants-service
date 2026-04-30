import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SENTINEL = 'SENTINEL-LEAK-CANARY-DO-NOT-MATCH-PROD-xyz123';

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

import { stubFetchRouter } from './_test-helpers.js';

let originalArgv: string[] = [];
let originalExit: typeof process.exit;

describe('dependency cascade — failed step blocks all dependents', () => {
  beforeEach(() => {
    writes.length = 0;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete process.env.OLUMI_REPLAY_API_KEY;
    // Bypass the new min-build gate (mocked /healthz uses an older SHA).
    vi.stubEnv('OLUMI_REPLAY_ALLOW_STALE_DEPLOY', 'true');
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
    delete process.env.OLUMI_REPLAY_API_KEY;
  });

  async function importFreshRun() {
    vi.resetModules();
    return (await import('../../../tools/v5-journey-replay/index.js')) as typeof import('../../../tools/v5-journey-replay/index.js');
  }

  it('step 1 fails → all dependent steps (2,3,4,6) skip; step 5 (depends on 4) also skips transitively', async () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      'https://cee-staging.onrender.com',
      '--out',
      '/tmp/v5-cascade.md',
    ];

    let postCount = 0;
    stubFetchRouter((url, _body) => {
      if (url.endsWith('/healthz')) {
        return { status: 200, jsonValue: { ok: true, build: '66d1adb', version: '1', service: 'assistants' } };
      }
      if (url.endsWith('/orchestrate/v2/turn')) {
        postCount += 1;
        // First POST is the preflight (empty body). Second POST is step 1.
        if (postCount === 1) {
          return { status: 422, jsonValue: { error: 'INVALID' } };
        }
        if (postCount === 2) {
          // Step 1 fails: empty product-shape (200 with empty body).
          return {
            status: 200,
            jsonValue: { response_version: 2, suggested_actions: [] },
          };
        }
        // No further POSTs should happen — every other step depends on
        // step 1 (directly or transitively via step 4).
        throw new Error('unexpected /orchestrate/v2/turn call after step 1 failure');
      }
      return { status: 404, jsonValue: {} };
    });

    const mod = await importFreshRun();
    await expect(mod.run()).rejects.toMatchObject({ name: 'ProcessExitError', code: 1 });

    // 1 preflight + 1 step-1 = 2 POSTs total. No POST for steps 2-6.
    expect(postCount).toBe(2);

    const pack = writes[0]!.content;
    // Step 1 failed.
    expect(pack).toMatch(/`1_draft_graph` \| \[FAIL\] failed/);
    // Steps 2, 3, 4, 6 directly depend on step 1 → must be skipped.
    expect(pack).toMatch(/`2_weakest_option` \| \[SKIP\] skipped/);
    expect(pack).toMatch(/`3_add_option` \| \[SKIP\] skipped/);
    expect(pack).toMatch(/`4_run_analysis` \| \[SKIP\] skipped/);
    expect(pack).toMatch(/`6_edit_budget` \| \[SKIP\] skipped/);
    // Step 5 depends on step 4. Step 4 was skipped (not "failed"). The
    // single-blockedBy bug would let step 5 RUN here. The Set-based
    // tracker must skip it transitively.
    expect(pack).toMatch(/`5_explain_leader` \| \[SKIP\] skipped/);
  });

  it('step 4 skipped (its prereq failed) → step 5 also skipped (transitive)', async () => {
    // Same scenario as above, but verifies the specific transitive
    // chain: 1 fails → 4 skips → 5 must skip too.
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      'https://cee-staging.onrender.com',
      '--out',
      '/tmp/v5-transitive.md',
    ];

    stubFetchRouter((url, _body) => {
      if (url.endsWith('/healthz')) {
        return { status: 200, jsonValue: { ok: true, build: '66d1adb' } };
      }
      // Preflight succeeds; step 1 fails with empty body.
      return { status: 422, jsonValue: { error: 'X' } };
    });

    const mod = await importFreshRun();
    await expect(mod.run()).rejects.toMatchObject({ name: 'ProcessExitError', code: 1 });

    const pack = writes[0]!.content;
    // Match step 5 row and confirm it skipped, with the prereq message
    // naming step 4 (the direct depends_on) — proving transitive skip.
    expect(pack).toMatch(/`5_explain_leader` \| \[SKIP\] skipped \| skipped \|.*\| skipped_dependency: prerequisite 4_run_analysis did not pass/);
  });
});
