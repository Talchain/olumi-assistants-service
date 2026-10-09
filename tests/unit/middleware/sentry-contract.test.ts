/**
 * Sentry reporting contract (system S-H, observability) — CEE half.
 *
 * The contract every Olumi service holds (CEE, PLoT, ISL, UI):
 *   1. environment = SENTRY_ENVIRONMENT when set, else the runtime label
 *      (here NODE_ENV). Production CEE runs with NODE_ENV=staging on purpose
 *      (behaviour is gated on it), so without the override every production
 *      event is labelled "staging".
 *   2. release = the full 40-char build SHA from the ONE build-identity owner
 *      (src/version.ts), never the package version.
 *   3. every event carries the tag service=cee.
 *   4. NO user decision content leaves the process: not in error events, not
 *      in transactions, not in breadcrumbs. Request bodies are never captured.
 *
 * Rows bind by IDENTITY: a high-entropy sentinel must be absent from the
 * serialised event, and a same-shape control value must be present (so an
 * absence cannot pass because the harness saw nothing).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scalingRatio } from '../../helpers/scaling-ratio.js';

const mockInit = vi.fn();
const mockHttpIntegration = vi.fn((opts: unknown) => ({ name: 'Http', opts }));

vi.mock('@sentry/node', () => ({
  init: mockInit,
  httpIntegration: mockHttpIntegration,
  getCurrentScope: vi.fn(() => ({ setTag: vi.fn() })),
  withIsolationScope: vi.fn((cb: (scope: unknown) => void) => cb({ setTag: vi.fn() })),
  setupFastifyErrorHandler: vi.fn(),
}));

const SENTINEL = 'SENTINEL-5e1d-acquire-northwind-for-40m';
const SHA40 = '0123456789abcdef0123456789abcdef01234567';

type Cfg = {
  environment?: string;
  release?: string;
  sendDefaultPii?: boolean;
  initialScope?: { tags?: Record<string, string> };
  integrations?: Array<{ name: string; opts?: { maxIncomingRequestBodySize?: string } }>;
  beforeSend?: (e: Record<string, unknown>) => Record<string, unknown> | null;
  beforeSendTransaction?: (e: Record<string, unknown>) => Record<string, unknown> | null;
  beforeBreadcrumb?: (b: Record<string, unknown>) => Record<string, unknown> | null;
};

async function initWith(env: Record<string, string | undefined>): Promise<Cfg> {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  const { initSentry } = await import('../../../src/middleware/sentry.js');
  initSentry();
  expect(mockInit).toHaveBeenCalledTimes(1);
  return mockInit.mock.calls[0][0] as Cfg;
}

const BASE_ENV = {
  SENTRY_DSN: 'https://test@sentry.invalid/1',
  SENTRY_ENVIRONMENT: undefined,
  NODE_ENV: 'staging',
  CEE_BUILD_HASH: undefined,
  GIT_COMMIT_SHA: undefined,
  RENDER_GIT_COMMIT: SHA40,
};

describe('CEE Sentry contract (S-H)', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    mockInit.mockClear();
    mockHttpIntegration.mockClear();
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  describe('environment label', () => {
    it('SENTRY_ENVIRONMENT wins over NODE_ENV (prod runs NODE_ENV=staging)', async () => {
      const cfg = await initWith({ ...BASE_ENV, SENTRY_ENVIRONMENT: 'production' });
      expect(cfg.environment).toBe('production');
    });

    it('control: without SENTRY_ENVIRONMENT the runtime label is used', async () => {
      const cfg = await initWith({ ...BASE_ENV });
      expect(cfg.environment).toBe('staging');
    });

    it('an empty or blank SENTRY_ENVIRONMENT counts as unset', async () => {
      const cfg = await initWith({ ...BASE_ENV, SENTRY_ENVIRONMENT: '  ' });
      expect(cfg.environment).toBe('staging');
    });
  });

  describe('release and service tag', () => {
    it('release is the 40-char build SHA, not the package version', async () => {
      const cfg = await initWith({ ...BASE_ENV, npm_package_version: '9.9.9' });
      expect(cfg.release).toBe(SHA40);
    });

    it('nothing overrides the build SHA (CEE_BUILD_HASH is not a release)', async () => {
      const cfg = await initWith({ ...BASE_ENV, CEE_BUILD_HASH: 'abc123' });
      expect(cfg.release).toBe(SHA40);
    });

    it('an underivable SHA is reported as unidentified, never another source', async () => {
      const cfg = await initWith({ ...BASE_ENV, RENDER_GIT_COMMIT: 'unknown', GIT_COMMIT_SHA: 'unknown', SENTRY_RELEASE: '9.9.9' });
      expect(cfg.release).toBe('unidentified');
    });

    it('every event carries service=cee', async () => {
      const cfg = await initWith({ ...BASE_ENV });
      expect(cfg.initialScope?.tags?.service).toBe('cee');
    });

    it('default PII sending is pinned off', async () => {
      const cfg = await initWith({ ...BASE_ENV });
      expect(cfg.sendDefaultPii).toBe(false);
    });
  });

  describe('no decision content leaves the process', () => {
    it('incoming request bodies are never captured by the HTTP integration', async () => {
      const cfg = await initWith({ ...BASE_ENV });
      const http = (cfg.integrations ?? []).find((i) => i.name === 'Http');
      expect(http?.opts?.maxIncomingRequestBodySize).toBe('none');
    });

    it('transactions are scrubbed: request body removed, control field kept', async () => {
      const cfg = await initWith({ ...BASE_ENV });
      expect(typeof cfg.beforeSendTransaction).toBe('function');
      const out = cfg.beforeSendTransaction!({
        type: 'transaction',
        transaction: 'POST /orchestrate/v2/turn',
        request: { url: '/orchestrate/v2/turn', data: { brief: SENTINEL }, cookies: { s: SENTINEL } },
      });
      const json = JSON.stringify(out);
      expect(json).not.toContain(SENTINEL);
      expect(json).toContain('POST /orchestrate/v2/turn');
    });

    it.each([
      ['node_label'],
      ['goal_text'],
      ['labels'],
      ['headline'],
      ['statement'],
      ['user_message'],
    ])('error extra key %s (decision-content class) is redacted', async (key) => {
      const cfg = await initWith({ ...BASE_ENV });
      const out = cfg.beforeSend!({
        extra: { [key]: key === 'labels' ? [SENTINEL] : SENTINEL, error_code: 'CONTROL_KEPT' },
        contexts: { turn: { [key]: SENTINEL, stage: 'CONTROL_STAGE' } },
      });
      const json = JSON.stringify(out);
      expect(json).not.toContain(SENTINEL);
      expect(json).toContain('CONTROL_KEPT');
      expect(json).toContain('CONTROL_STAGE');
    });

    it('credential headers from the logger owner list are stripped (x-share-token)', async () => {
      const cfg = await initWith({ ...BASE_ENV });
      const out = cfg.beforeSend!({
        request: { headers: { 'x-share-token': SENTINEL, 'x-request-id': 'CONTROL_RID' } },
      });
      const json = JSON.stringify(out);
      expect(json).not.toContain(SENTINEL);
      expect(json).toContain('CONTROL_RID');
    });

    it('console breadcrumbs are dropped; an http breadcrumb is kept', async () => {
      const cfg = await initWith({ ...BASE_ENV });
      expect(typeof cfg.beforeBreadcrumb).toBe('function');
      expect(cfg.beforeBreadcrumb!({ category: 'console', message: SENTINEL })).toBeNull();
      const http = cfg.beforeBreadcrumb!({ category: 'http', data: { url: 'https://plot.invalid/v2/run', method: 'POST' } });
      expect(JSON.stringify(http)).toContain('plot.invalid');
    });

    it('a non-console breadcrumb keeps only its shape: no message, no data keys, no query', async () => {
      const cfg = await initWith({ ...BASE_ENV });
      const out = cfg.beforeBreadcrumb!({
        category: 'http',
        message: SENTINEL,
        data: { url: `https://plot.invalid/v2/run?brief=${SENTINEL}`, method: 'POST', status_code: 502, node_label: SENTINEL },
      });
      const json = JSON.stringify(out);
      expect(json).not.toContain(SENTINEL);
      expect(json).toContain('https://plot.invalid/v2/run');
      expect(json).toContain('502');
    });

    it('transaction span data is redacted by the same key class', async () => {
      const cfg = await initWith({ ...BASE_ENV });
      const out = cfg.beforeSendTransaction!({
        type: 'transaction',
        contexts: { trace: { data: { goal_text: SENTINEL, 'http.route': 'CONTROL_ROUTE' } } },
        spans: [{ data: { node_label: SENTINEL, 'gen_ai.request.model': 'CONTROL_MODEL' } }],
      });
      const json = JSON.stringify(out);
      expect(json).not.toContain(SENTINEL);
      expect(json).toContain('CONTROL_ROUTE');
      expect(json).toContain('CONTROL_MODEL');
    });

    it('queries never leave: request url / query_string / referer, span url attributes and span names', async () => {
      const cfg = await initWith({ ...BASE_ENV });
      const err = JSON.stringify(
        cfg.beforeSend!({
          request: {
            url: `https://cee.invalid/assist/v1/x?brief=${SENTINEL}`,
            query_string: `brief=${SENTINEL}`,
            headers: { referer: `https://olumi.invalid/s/1?q=${SENTINEL}` },
          },
        }),
      );
      expect(err).not.toContain(SENTINEL);
      expect(err).toContain('https://cee.invalid/assist/v1/x');
      expect(err).toContain('https://olumi.invalid/s/1');
      const txn = JSON.stringify(
        cfg.beforeSendTransaction!({
          type: 'transaction',
          transaction: 'GET /assist/v1/x',
          contexts: { trace: { data: { 'url.full': `https://cee.invalid/x?brief=${SENTINEL}`, 'url.query': `brief=${SENTINEL}` } } },
          spans: [
            {
              description: `GET https://plot.invalid/v2/run?label=${SENTINEL}`,
              data: { 'http.url': `https://plot.invalid/v2/run?label=${SENTINEL}`, 'http.query': `label=${SENTINEL}` },
            },
          ],
        }),
      );
      expect(txn).not.toContain(SENTINEL);
      expect(txn).toContain('https://plot.invalid/v2/run');
      expect(txn).toContain('GET /assist/v1/x');
    });

    it('breadcrumbs already on an error event are scrubbed the same way', async () => {
      const cfg = await initWith({ ...BASE_ENV });
      const out = cfg.beforeSend!({
        breadcrumbs: [
          { category: 'console', message: SENTINEL },
          { category: 'http', data: { url: 'https://plot.invalid/v2/run' } },
        ],
      });
      const json = JSON.stringify(out);
      expect(json).not.toContain(SENTINEL);
      expect(json).toContain('plot.invalid');
    });
  });
});

describe('trace sample rate from env', () => {
  it('0 switches tracing off (was silently turned back into 0.5)', async () => {
    const { resolveTracesSampleRate } = await import('../../../src/middleware/sentry.js');
    expect(resolveTracesSampleRate('0')).toBe(0);
    expect(resolveTracesSampleRate('0.1')).toBe(0.1);
  });

  it('control: unset, blank or invalid keeps the 0.5 default', async () => {
    const { resolveTracesSampleRate } = await import('../../../src/middleware/sentry.js');
    expect(resolveTracesSampleRate(undefined)).toBe(0.5);
    expect(resolveTracesSampleRate(' ')).toBe(0.5);
    expect(resolveTracesSampleRate('2')).toBe(0.5);
    expect(resolveTracesSampleRate('abc')).toBe(0.5);
  });
});

describe('query-stripping regex scales linearly (regex budget)', () => {
  // 4x the input via the shared scalingRatio (min of 7 batches; SMALL >= ~20 ms and LARGE >= ~60 ms). The old
  // inline large-only calibration left a ~6 ms small batch and read 8.32x on a CI runner on untouched code (#2900,
  // 9 Oct): linear ~ 4x, quadratic ~ 16x, bar stays < 8x.
  const SMALL = 25_000;
  const LARGE = 100_000;
  it.each([
    ['no query', (n: number) => 'GET https://plot.invalid/' + 'a'.repeat(n)],
    ['one long query', (n: number) => 'GET https://plot.invalid/x?' + 'b'.repeat(n)],
    ['many short queries', (n: number) => '?a '.repeat(Math.ceil(n / 3)).slice(0, n)],
  ])('%s: 100k costs < 8x of 25k', async (_shape, make) => {
    const { stripQueriesInText } = await import('../../../src/middleware/sentry.js');
    const small = make(SMALL);
    const large = make(LARGE);
    expect(large.length).toBeGreaterThanOrEqual(small.length * 3.9);
    const m = scalingRatio(() => stripQueriesInText(small), () => stripQueriesInText(large));
    expect(m.ratio, m.detail).toBeLessThan(8);
  });
});
