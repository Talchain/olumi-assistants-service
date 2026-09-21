/**
 * Integration tests for OPTIONS preflight on /proxy/v5/turn.
 *
 * Regression cover for the 2026-05 staging-blocker: @fastify/cors handles
 * preflight by short-circuiting with reply.send() (no body), so subsequent
 * onSend hooks receive `payload === undefined`. The original
 * responseHashPlugin computed `computeResponseHash(undefined)` which calls
 * `createHash().update(undefined)` → ERR_INVALID_ARG_TYPE → Fastify's
 * default error handler emits HTTP 500 (with the CORS headers still
 * attached). This blocked every browser preflight to /proxy/v5/turn.
 *
 * The fix in plugins/response-hash.ts adds three independent skip-guards:
 *   1. payload === undefined / null
 *   2. request.method === 'OPTIONS'
 *   3. reply.statusCode === 204
 *
 * Test stack (mirrors the production server.ts registration order exactly
 * — cors → authPlugin → responseHashPlugin → boundaryLoggingPlugin →
 * route — see server.ts:296, 421, 424, 427):
 *   - @fastify/cors                — preflight handler (the source of
 *                                    the empty payload that broke
 *                                    responseHashPlugin)
 *   - authPlugin                   — public-route check + preParsing /
 *                                    preHandler hooks. A regression
 *                                    that drops /proxy/v5/turn out of
 *                                    `isPublicRoute` would surface here
 *                                    as 401/403 on POST.
 *   - responseHashPlugin           — onSend hook with the three guards
 *                                    under test. MUST run after auth so
 *                                    a 401/403 reply path also exercises
 *                                    the hash-skip guards.
 *   - boundaryLoggingPlugin        — onSend / onResponse hooks; reads
 *                                    response-hash markers via the
 *                                    typed accessor. Last so its hooks
 *                                    see the final reply state.
 *   - proxy route                  — the actual /proxy/v5/turn handler
 *
 * Plugins NOT registered (deliberate): helmet / rate-limit / compression.
 * None of those add `onSend` hooks that consume the payload, so they
 * cannot trigger the regression under test. Adding them would couple
 * this regression test to unrelated plugin-version drift.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

// ---------------------------------------------------------------------------
// Mocks — registered before the proxy / plugin imports so config-dependent
// modules see the test config.
// ---------------------------------------------------------------------------

const TEST_ASSIST_KEY = 'test-assist-key-zzz';
const STAGING_ORIGIN = 'https://staging--olumi.netlify.app';
const DISALLOWED_ORIGIN = 'https://evil.example.com';

const mockConfig = {
  proxy: {
    browserProxyEnabled: true,
    browserProxyAllowedOrigins: STAGING_ORIGIN,
    browserProxyTimeoutMs: 5_000,
  },
  auth: {
    assistApiKey: TEST_ASSIST_KEY,
  },
  features: {},
  // tryConsumeToken in utils/quota.ts reads these fields. The proxy's
  // internal app.inject('/orchestrate/v2/turn') goes through authPlugin
  // which calls tryConsumeToken with the injected key, so the mock must
  // supply rate-limit and redis config. Generous limits keep the test
  // deterministic (one POST per test run).
  rateLimits: {
    defaultRpm: 1000,
    sseRpm: 1000,
  },
  redis: {
    quotaEnabled: false, // Force memory-mode bucket; no Redis dependency.
  },
};

vi.mock('../../src/config/index.js', () => ({ config: mockConfig }));

vi.mock('../../src/utils/telemetry.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/telemetry.js')>(
    '../../src/utils/telemetry.js',
  );
  return {
    ...actual,
    emit: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

// Imports after mocks
const { proxyV5TurnRoute } = await import('../../src/routes/proxy-v5-turn.js');
const { responseHashPlugin } = await import('../../src/plugins/response-hash.js');
const { boundaryLoggingPlugin } = await import('../../src/plugins/boundary-logging.js');
const { authPlugin } = await import('../../src/plugins/auth.js');

// ---------------------------------------------------------------------------
// App builder — mirrors the relevant portion of server.ts wiring around the
// preflight path. Excludes helmet / rate-limit / compression because those
// plugins do not emit onSend hooks that read the payload.
// ---------------------------------------------------------------------------

interface BuildAppOpts {
  /** Override the internal /orchestrate/v2/turn handler the proxy app.inject's into. */
  readonly internalHandler?: (req: unknown, reply: { send: (b: unknown) => unknown; header: (k: string, v: string) => unknown; code: (n: number) => unknown }) => unknown;
}

async function buildApp(opts: BuildAppOpts = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // CORS — exact-match allowlist mirroring server.ts allowedOrigins.
  await app.register(cors, {
    origin: [STAGING_ORIGIN, 'http://localhost:5173'],
    allowedHeaders: ['Content-Type', 'X-Olumi-Assist-Key'],
  });

  // Production server.ts order: auth (line 421) → responseHash (line
  // 424) → boundaryLogging (line 427). authPlugin must run for POSTs
  // (validating X-Olumi-Assist-Key) but MUST NOT block OPTIONS
  // preflight — the route is in `isPublicRoute` (auth.ts:52), and the
  // preParsing hook short-circuits for public routes
  // (auth.ts:122-124). responseHashPlugin sits between auth and
  // boundaryLogging so its hash-skip guards run on every reply path
  // including 401/403 short-circuits. boundaryLoggingPlugin reads
  // response-hash markers via the typed accessor in
  // plugins/response-hash.ts, so it MUST register last to see the
  // final reply state.
  await app.register(authPlugin);
  await app.register(responseHashPlugin);
  await app.register(boundaryLoggingPlugin);

  // Internal route the proxy injects into. Mock by default; tests can
  // override with internalHandler.
  app.post('/orchestrate/v2/turn', async (req, reply) => {
    if (opts.internalHandler) {
      // Cast to the structural-typed handler shape used in test overrides.
      // Real Fastify reply has more methods; the test handler only needs send/header/code.
      return opts.internalHandler(req, reply as unknown as { send: (b: unknown) => unknown; header: (k: string, v: string) => unknown; code: (n: number) => unknown });
    }
    return reply
      .code(200)
      .header('content-type', 'application/json')
      .header('x-olumi-service', 'cee')
      .header('x-olumi-service-build', 'test-build-zzz')
      .send({
        response_version: 2,
        assistant_text: 'ok',
        blocks: [],
        suggested_actions: [],
        insights: [],
        stage_indicator: 'frame',
      });
  });

  await app.register(proxyV5TurnRoute);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OPTIONS /proxy/v5/turn — preflight regression cover', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('allowed origin → not 500 (regression: was ERR_INVALID_ARG_TYPE 500)', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/proxy/v5/turn',
      headers: {
        origin: STAGING_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, x-olumi-assist-key',
      },
    });

    expect(res.statusCode).not.toBe(500);
    // @fastify/cors typically responds 204 No Content for preflight.
    expect([200, 204]).toContain(res.statusCode);

    // CORS headers present.
    expect(res.headers['access-control-allow-origin']).toBe(STAGING_ORIGIN);
    // Strengthened (P1 fix 2026-05): allow-methods MUST advertise POST so
    // the browser permits the actual proxy request after preflight.
    const allowMethods = res.headers['access-control-allow-methods'];
    expect(allowMethods).toBeDefined();
    expect(String(allowMethods).toUpperCase()).toContain('POST');
  });

  it('preflight does NOT require auth (no X-Olumi-Assist-Key header sent)', async () => {
    // Regression check: if /proxy/v5/turn ever drops out of
    // `isPublicRoute` (src/plugins/auth.ts:52), authPlugin would
    // intercept the OPTIONS request and reject with 401/403. The CORS
    // plugin runs first (registered before auth), so the preflight
    // SHOULD succeed before authPlugin's onRequest hook fires. This
    // test pins both paths: no auth header is sent, and we still get a
    // 2xx preflight response.
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/proxy/v5/turn',
      headers: {
        origin: STAGING_ORIGIN,
        'access-control-request-method': 'POST',
        // Note: no X-Olumi-Assist-Key, no Authorization, no HMAC headers.
      },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
    expect([200, 204]).toContain(res.statusCode);
  });

  it('allowed origin preflight does NOT emit x-olumi-response-hash', async () => {
    // Empty preflight responses are explicitly skipped by responseHashPlugin
    // — there is nothing meaningful to hash, and historically attempting it
    // caused the 500.
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/proxy/v5/turn',
      headers: {
        origin: STAGING_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.headers['x-olumi-response-hash']).toBeUndefined();
  });

  it('disallowed origin → not 500; CORS-allow-origin absent', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/proxy/v5/turn',
      headers: {
        origin: DISALLOWED_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    // The exact status @fastify/cors emits for a disallowed-origin
    // preflight is intentionally not pinned (varies between 200 and 204
    // across plugin versions) — we ONLY pin "not a 500" plus the absence
    // of an allow-origin header so the browser correctly blocks the POST.
    expect(res.statusCode).not.toBe(500);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('preflight does NOT call the proxy app.inject internal handler', async () => {
    const internalSpy = vi.fn();
    const localApp = await buildApp({
      internalHandler: (_req, reply) => {
        internalSpy();
        return reply.code(200).header('content-type', 'application/json').send({ ok: true });
      },
    });

    try {
      await localApp.inject({
        method: 'OPTIONS',
        url: '/proxy/v5/turn',
        headers: {
          origin: STAGING_ORIGIN,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      });
      expect(internalSpy).not.toHaveBeenCalled();
    } finally {
      await localApp.close();
    }
  });

  it('normal POST round-trip still hashes JSON body', async () => {
    // The proxy is in `isPublicRoute` so auth is bypassed at the
    // /proxy/v5/turn surface (the proxy injects its own
    // X-Olumi-Assist-Key into the internal /orchestrate/v2/turn call).
    // No need for a client-supplied auth header on this POST.
    const res = await app.inject({
      method: 'POST',
      url: '/proxy/v5/turn',
      headers: {
        origin: STAGING_ORIGIN,
        'content-type': 'application/json',
      },
      payload: {
        kind: 'message',
        turn_id: 'turn-zzz',
        scenario_id: 'scen-zzz',
        message: 'Hello',
        stage: 'frame',
        turn_class: 'frame',
        source: 'composer',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    // The proxy parses then re-serialises — Fastify will emit a hash on
    // the JSON response body. Hash header is always present for non-empty
    // JSON bodies.
    expect(res.headers['x-olumi-response-hash']).toMatch(/^[0-9a-f]{12}$/);
    // Body shape is preserved.
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toBe('ok');
  });

  it('204-status responses on the internal route are NOT hashed (statusCode guard)', async () => {
    // Direct test of the statusCode === 204 guard in responseHashPlugin
    // by hitting an internal route that emits 204 (rather than going
    // through the proxy, which has its own JSON-parse-on-internal-body
    // contract that is unrelated to the response-hash fix).
    const probeApp = Fastify({ logger: false });
    await probeApp.register(cors, { origin: [STAGING_ORIGIN] });
    await probeApp.register(responseHashPlugin);
    probeApp.post('/no-content', async (_req, reply) => reply.code(204).send());
    try {
      const res = await probeApp.inject({
        method: 'POST',
        url: '/no-content',
        headers: { origin: STAGING_ORIGIN, 'content-type': 'application/json' },
        payload: { x: 1 },
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers['x-olumi-response-hash']).toBeUndefined();
    } finally {
      await probeApp.close();
    }
  });

  it('responseHashPlugin does NOT throw on undefined payload (unit-level smoke)', async () => {
    // Direct probe: stand up Fastify with cors + responseHashPlugin alone
    // and send OPTIONS. Pre-fix this returned 500 with ERR_INVALID_ARG_TYPE.
    const probeApp = Fastify({ logger: false });
    await probeApp.register(cors, { origin: [STAGING_ORIGIN] });
    await probeApp.register(responseHashPlugin);
    probeApp.post('/x', async () => ({ ok: true }));

    try {
      const res = await probeApp.inject({
        method: 'OPTIONS',
        url: '/x',
        headers: {
          origin: STAGING_ORIGIN,
          'access-control-request-method': 'POST',
        },
      });
      expect(res.statusCode).not.toBe(500);
      expect(res.headers['x-olumi-response-hash']).toBeUndefined();
    } finally {
      await probeApp.close();
    }
  });
});
