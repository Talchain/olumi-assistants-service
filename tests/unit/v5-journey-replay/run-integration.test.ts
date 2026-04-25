import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SENTINEL = 'SENTINEL-LEAK-CANARY-DO-NOT-MATCH-PROD-xyz123';

// Mock writeFileSync so we can inspect the evidence pack output without
// touching disk. Must be hoisted via vi.mock before the module imports.
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

// Mock process.exit to throw instead of killing the test runner.
class ProcessExitError extends Error {
  constructor(public code: number | string | null | undefined) {
    super(`process.exit(${code})`);
    this.name = 'ProcessExitError';
  }
}

interface MockResponse {
  readonly status?: number;
  readonly jsonValue?: unknown;
  /** When set, overrides the JSON-stringified jsonValue for the text() body. */
  readonly rawText?: string;
}

function stubFetchRouter(router: (url: string) => MockResponse | Error | Promise<MockResponse>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      const r = await router(u);
      if (r instanceof Error) throw r;
      const jsonBody = r.jsonValue ?? {};
      const rawText = r.rawText ?? JSON.stringify(jsonBody);
      return {
        status: r.status ?? 200,
        json: async () => jsonBody,
        text: async () => rawText,
      } as unknown as Response;
    }),
  );
}

let originalArgv: string[] = [];
let originalExit: typeof process.exit;
const consoleLogs: string[] = [];
const consoleErrs: string[] = [];

describe('full replay run (mocked staging service)', () => {
  beforeEach(() => {
    writes.length = 0;
    consoleLogs.length = 0;
    consoleErrs.length = 0;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete process.env.OLUMI_REPLAY_API_KEY;
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleLogs.push(args.map((a) => String(a)).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrs.push(args.map((a) => String(a)).join(' '));
    });
    // Intercept process.exit so the test runner survives.
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
    // Re-import to pick up fresh env. vitest caches modules per run, so
    // clear the module registry for `./index.ts`.
    vi.resetModules();
    return (await import('../../../tools/v5-journey-replay/index.js')) as typeof import('../../../tools/v5-journey-replay/index.js');
  }

  it('full green run: healthz + preflight + 6 steps, evidence pack has all expected sections', async () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      'https://cee-staging.onrender.com',
      '--out',
      '/tmp/v5-evidence-test.md',
      '--scenario-prefix',
      'staging-test',
    ];
    stubFetchRouter((url) => {
      if (url.endsWith('/healthz')) {
        return {
          status: 200,
          jsonValue: {
            ok: true,
            build: '66d1adb',
            version: '0.0.1',
            service: 'assistants',
            degraded: false,
          },
        };
      }
      if (url.endsWith('/orchestrate/v2/turn')) {
        return {
          status: 200,
          jsonValue: {
            response_version: 2,
            assistant_text: 'ok',
            suggested_actions: [
              { id: 'c1', label: 'Run analysis', message: 'run', action_type: 'chip_click' },
            ],
            stage_indicator: 'frame',
          },
        };
      }
      return { status: 404, jsonValue: {} };
    });

    const mod = await importFreshRun();
    await mod.run();

    expect(writes.length).toBe(1);
    const pack = writes[0]!.content;
    expect(pack).not.toContain(SENTINEL);
    expect(pack).toMatch(/## Executive summary/);
    expect(pack).toMatch(/Replay reached orchestrator \| yes/);
    expect(pack).toMatch(/v38\.2 confirmed \(startup \/ healthz build\) \| yes/);
    expect(pack).toMatch(/## Deploy confirmation \(Phase 2\)/);
    expect(pack).toMatch(/## Preflight \(Phase 3\)/);
    expect(pack).toMatch(/## Six-step replay/);
    expect(pack).toContain('v5-runtime');

    // No console surface should contain the sentinel.
    for (const line of [...consoleLogs, ...consoleErrs]) {
      expect(line).not.toContain(SENTINEL);
    }
  });

  it('preflight 401 halts before burning six steps; evidence pack records auth blocker; exit 3; no leak', async () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      'https://cee-staging.onrender.com',
      '--out',
      '/tmp/v5-evidence-test-halt.md',
    ];
    let turnCallCount = 0;
    stubFetchRouter((url) => {
      if (url.endsWith('/healthz')) {
        return {
          status: 200,
          jsonValue: { ok: true, build: '66d1adb', version: '0.0.1', service: 'assistants' },
        };
      }
      if (url.endsWith('/orchestrate/v2/turn')) {
        turnCallCount += 1;
        return {
          status: 401,
          jsonValue: {
            schema: 'error.v1',
            code: 'UNAUTHENTICATED',
            message: 'Missing API key.',
          },
        };
      }
      return { status: 404, jsonValue: {} };
    });

    const mod = await importFreshRun();
    await expect(mod.run()).rejects.toMatchObject({ name: 'ProcessExitError', code: 3 });

    // Exactly one POST /orchestrate/v2/turn call — the preflight. The
    // six canonical steps must NOT have run.
    expect(turnCallCount).toBe(1);

    expect(writes.length).toBe(1);
    const pack = writes[0]!.content;
    expect(pack).not.toContain(SENTINEL);
    expect(pack).toMatch(/No rows: replay halted before the canonical steps ran/);
    expect(pack).toMatch(/Auth probe status:\*\* 401/);

    // Exec summary correctly reports reached_orchestrator=no.
    expect(pack).toMatch(/Replay reached orchestrator \| no/);

    for (const line of [...consoleLogs, ...consoleErrs]) {
      expect(line).not.toContain(SENTINEL);
    }
  });

  it('fail-fast: remote base URL without env var exits 3 with MISSING_KEY_MESSAGE', async () => {
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      'https://cee-staging.onrender.com',
      '--out',
      '/tmp/v5-should-not-exist.md',
    ];
    // No fetch mock needed — we should throw before any HTTP call.
    stubFetchRouter(() => {
      throw new Error('fetch must not be called in fail-fast path');
    });

    const mod = await importFreshRun();
    await expect(mod.run()).rejects.toThrow(mod.MISSING_KEY_MESSAGE);

    // Evidence pack should NOT have been written — run() threw before
    // reaching writeEvidencePack.
    expect(writes.length).toBe(0);
  });

  it('localhost base URL without env var runs normally', async () => {
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      'http://localhost:3000',
      '--out',
      '/tmp/v5-local.md',
    ];
    stubFetchRouter((url) => {
      if (url.endsWith('/healthz')) {
        return {
          status: 200,
          jsonValue: { ok: true, build: 'localdev', version: '0', service: 'assistants' },
        };
      }
      if (url.endsWith('/orchestrate/v2/turn')) {
        return {
          status: 200,
          jsonValue: {
            response_version: 2,
            assistant_text: 'ok',
            suggested_actions: [{ id: 'c1', label: 'Chip', message: 'msg' }],
          },
        };
      }
      return { status: 404, jsonValue: {} };
    });

    const mod = await importFreshRun();
    await mod.run();

    expect(writes.length).toBe(1);
    const pack = writes[0]!.content;
    expect(pack).toMatch(/Auth mode:\*\* unauthenticated/);
  });

  it('200 with BoundaryError envelope classifies as v5-runtime failure not pass', async () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      'https://cee-staging.onrender.com',
      '--out',
      '/tmp/v5-boundary.md',
    ];
    stubFetchRouter((url) => {
      if (url.endsWith('/healthz')) {
        return { status: 200, jsonValue: { ok: true, build: '66d1adb', version: '0.0.1' } };
      }
      if (url.endsWith('/orchestrate/v2/turn')) {
        return {
          status: 200,
          jsonValue: { error: 'INTERNAL_ERROR', boundary: 'turn-executor' },
        };
      }
      return { status: 404, jsonValue: {} };
    });

    const mod = await importFreshRun();
    await expect(mod.run()).rejects.toMatchObject({ name: 'ProcessExitError', code: 1 });

    const pack = writes[0]!.content;
    expect(pack).toMatch(/v5-runtime 200 with error envelope/);
  });
});
