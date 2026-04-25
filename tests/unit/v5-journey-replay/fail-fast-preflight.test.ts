import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MISSING_KEY_MESSAGE,
  assertAuthForBaseUrl,
  readApiKey,
  runHealthz,
  runPreflight,
} from '../../../tools/v5-journey-replay/index.js';
import { createRedactor } from '../../../tools/v5-journey-replay/redact.js';

const SENTINEL = 'SENTINEL-LEAK-CANARY-DO-NOT-MATCH-PROD-xyz123';

import { stubFetchRouter } from './_test-helpers.js';

// Thin alias — existing test bodies pass closures that return
// `{ status, jsonValue }` objects, which are shape-compatible with
// `FetchMockInit`. Wrapping `stubFetchRouter` keeps those bodies
// untouched.
const mockFetch = stubFetchRouter;

describe('readApiKey', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.OLUMI_REPLAY_API_KEY;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns undefined when env var is not set', () => {
    expect(readApiKey()).toBeUndefined();
  });

  it('returns undefined when env var is empty string', () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', '');
    expect(readApiKey()).toBeUndefined();
  });

  it('returns undefined when env var is whitespace-only', () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', '   \t\n  ');
    expect(readApiKey()).toBeUndefined();
  });

  it('returns the raw key (including surrounding whitespace-safe characters) when set', () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    expect(readApiKey()).toBe(SENTINEL);
  });
});

describe('assertAuthForBaseUrl (fail-fast gate)', () => {
  it('passes for localhost without a key', () => {
    expect(() =>
      assertAuthForBaseUrl({
        baseUrl: 'http://localhost:3000',
        outPath: 'x',
        scenarioPrefix: 'local',
      }),
    ).not.toThrow();
  });

  it('passes for 127.0.0.1 without a key', () => {
    expect(() =>
      assertAuthForBaseUrl({
        baseUrl: 'http://127.0.0.1:8080',
        outPath: 'x',
        scenarioPrefix: 'local',
      }),
    ).not.toThrow();
  });

  it('passes for remote host when key is present', () => {
    expect(() =>
      assertAuthForBaseUrl({
        baseUrl: 'https://cee-staging.onrender.com',
        outPath: 'x',
        scenarioPrefix: 'staging',
        apiKey: SENTINEL,
      }),
    ).not.toThrow();
  });

  it('throws with the exact brief message when remote + no key', () => {
    expect(() =>
      assertAuthForBaseUrl({
        baseUrl: 'https://cee-staging.onrender.com',
        outPath: 'x',
        scenarioPrefix: 'staging',
      }),
    ).toThrow(MISSING_KEY_MESSAGE);
  });

  it('throws MISSING_KEY_MESSAGE for example.com (adversarial default test URL)', () => {
    expect(() =>
      assertAuthForBaseUrl({
        baseUrl: 'https://example.com',
        outPath: 'x',
        scenarioPrefix: 'staging',
      }),
    ).toThrow(MISSING_KEY_MESSAGE);
  });

  it('throws for invalid URL with a non-missing-key message', () => {
    expect(() =>
      assertAuthForBaseUrl({
        baseUrl: 'not-a-url',
        outPath: 'x',
        scenarioPrefix: 'x',
      }),
    ).toThrow(/Invalid --base-url/);
  });

  it('never leaks the key in error messages (remote + no key path)', () => {
    try {
      assertAuthForBaseUrl({
        baseUrl: 'https://cee-staging.onrender.com',
        outPath: 'x',
        scenarioPrefix: 'staging',
      });
      expect.fail('should throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toBe(MISSING_KEY_MESSAGE);
      expect(msg).toContain('OLUMI_REPLAY_API_KEY');
    }
  });
});

describe('runHealthz', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns result when /healthz is reachable', async () => {
    mockFetch(() => ({
      status: 200,
      jsonValue: { ok: true, build: '66d1adb', version: '1', service: 'assistants', degraded: false },
    }));
    const redact = createRedactor(undefined);
    const out = await runHealthz(
      { baseUrl: 'https://cee-staging.onrender.com', outPath: 'x', scenarioPrefix: 's' },
      redact,
    );
    expect(out.result?.status).toBe(200);
    expect(out.result?.body?.build).toBe('66d1adb');
    expect(out.note).toContain('status=200');
  });

  it('returns undefined result and a note when /healthz throws', async () => {
    mockFetch(() => new Error('fetch failed'));
    const redact = createRedactor(undefined);
    const out = await runHealthz(
      { baseUrl: 'https://cee-staging.onrender.com', outPath: 'x', scenarioPrefix: 's' },
      redact,
    );
    expect(out.result).toBeUndefined();
    expect(out.note).toMatch(/healthz unreachable/);
  });

  it('redacts secret from healthz exception note', async () => {
    mockFetch(() => new Error(`fetch failed with ${SENTINEL}`));
    const redact = createRedactor(SENTINEL);
    const out = await runHealthz(
      { baseUrl: 'https://cee-staging.onrender.com', outPath: 'x', scenarioPrefix: 's', apiKey: SENTINEL },
      redact,
    );
    expect(out.note).not.toContain(SENTINEL);
  });
});

describe('runPreflight outcomes', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('advances on 400 (auth accepted, body rejected)', async () => {
    mockFetch(() => ({ status: 400, jsonValue: { error: 'INVALID_REQUEST' } }));
    const redact = createRedactor(SENTINEL);
    const v = await runPreflight(
      { baseUrl: 'https://example.com', outPath: 'x', scenarioPrefix: 's', apiKey: SENTINEL },
      redact,
    );
    expect(v.kind).toBe('advance');
    if (v.kind === 'advance') expect(v.status).toBe(400);
  });

  it('advances on 422 (Zod rejected)', async () => {
    mockFetch(() => ({ status: 422, jsonValue: {} }));
    const redact = createRedactor(SENTINEL);
    const v = await runPreflight(
      { baseUrl: 'https://example.com', outPath: 'x', scenarioPrefix: 's', apiKey: SENTINEL },
      redact,
    );
    expect(v.kind).toBe('advance');
  });

  it('advances on 200 with note about unexpected permissive accept', async () => {
    mockFetch(() => ({ status: 200, jsonValue: { ok: true } }));
    const redact = createRedactor(SENTINEL);
    const v = await runPreflight(
      { baseUrl: 'https://example.com', outPath: 'x', scenarioPrefix: 's', apiKey: SENTINEL },
      redact,
    );
    expect(v.kind).toBe('advance');
    if (v.kind === 'advance') expect(v.note).toMatch(/unexpected 200/);
  });

  it('halts on 401', async () => {
    mockFetch(() => ({
      status: 401,
      jsonValue: { schema: 'error.v1', code: 'UNAUTHENTICATED', message: 'Missing API key.' },
    }));
    const redact = createRedactor(SENTINEL);
    const v = await runPreflight(
      { baseUrl: 'https://example.com', outPath: 'x', scenarioPrefix: 's', apiKey: SENTINEL },
      redact,
    );
    expect(v.kind).toBe('halt');
    if (v.kind === 'halt') {
      expect(v.status).toBe(401);
      expect(v.reason).toMatch(/auth rejected/);
      expect(v.reason).not.toContain(SENTINEL);
    }
  });

  it('halts on 403', async () => {
    mockFetch(() => ({ status: 403, jsonValue: {} }));
    const redact = createRedactor(SENTINEL);
    const v = await runPreflight(
      { baseUrl: 'https://example.com', outPath: 'x', scenarioPrefix: 's', apiKey: SENTINEL },
      redact,
    );
    expect(v.kind).toBe('halt');
    if (v.kind === 'halt') expect(v.status).toBe(403);
  });

  it('halts on 500 (pre-replay server error)', async () => {
    mockFetch(() => ({ status: 500, jsonValue: { error: 'INTERNAL' } }));
    const redact = createRedactor(SENTINEL);
    const v = await runPreflight(
      { baseUrl: 'https://example.com', outPath: 'x', scenarioPrefix: 's', apiKey: SENTINEL },
      redact,
    );
    expect(v.kind).toBe('halt');
    if (v.kind === 'halt') {
      expect(v.status).toBe(500);
      expect(v.reason).toMatch(/server error/);
    }
  });

  it('halts on transport exception with redacted message', async () => {
    mockFetch(() => new Error(`connection failed with ${SENTINEL}`));
    const redact = createRedactor(SENTINEL);
    const v = await runPreflight(
      { baseUrl: 'https://example.com', outPath: 'x', scenarioPrefix: 's', apiKey: SENTINEL },
      redact,
    );
    expect(v.kind).toBe('halt');
    if (v.kind === 'halt') {
      expect(v.reason).not.toContain(SENTINEL);
      expect(v.reason).toMatch(/preflight exception/);
    }
  });
});
