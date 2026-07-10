/**
 * runPreFlight × flag-gated Supabase-JWT verification (CEE_REQUIRE_USER_JWT,
 * login 3.4 CEE-half, ships dark).
 *
 * Pins the four behaviour claims at the shared pre-flight chokepoint that
 * every /orchestrate/v2/turn dispatch branch runs through:
 *
 *   1. Flag OFF  → byte-identical legacy behaviour: client-supplied body
 *      `user_id` reaches the scenario pre-flight untouched; no verification
 *      runs even when a proxy marker / garbage Authorization is present.
 *   2. Flag ON + valid JWT → identity DERIVED from the token's `sub`; the
 *      client-supplied `user_id` is IGNORED (mismatch emits telemetry only).
 *   3. Flag ON + missing/invalid/expired JWT on the browser-proxy path →
 *      typed recoverable 401 sign_in_required BoundaryError; the session
 *      store is never touched.
 *   4. Flag ON + no JWT from a direct (key-authed) service caller →
 *      legacy client-supplied identity still accepted (harness carve-out;
 *      never available to proxy paths).
 *
 * All JWTs are forged locally with a test-only secret.
 *
 * Companion dormancy pin: tests/unit/orchestrator/route-v2-preflight.test.ts
 * runs against the REAL config (flag default false) and is unchanged by this
 * feature — its passing is the flag-off wire-contract pin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

const TEST_SECRET = 'test-only-supabase-jwt-secret-0123456789abcdef';
const JWT_SUB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const FIXED_REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';
const BODY_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mockConfig = {
  auth: {
    requireUserJwt: false,
    supabaseJwtSecret: TEST_SECRET as string | undefined,
    supabaseJwksUrl: undefined as string | undefined,
    supabaseUrl: undefined as string | undefined,
  },
};

const emitSpy = vi.fn();
const ensureScenarioExistsSpy = vi.fn();

vi.mock('../../../src/config/index.js', () => ({ config: mockConfig }));
vi.mock('../../../src/utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: (...args: unknown[]) => emitSpy(...args),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    ensureScenarioExists: ensureScenarioExistsSpy,
    append: async () => ({ id: 'unused' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({
      scope,
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const { runPreFlight } = await import('../../../src/orchestrator/route-v2-preflight.js');
const { BROWSER_PROXY_SOURCE_HEADER, BROWSER_PROXY_SOURCE_VALUE } = await import(
  '../../../src/utils/browser-proxy-source.js'
);

async function forgeJwt(opts?: { expired?: boolean; secret?: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  let jwt = new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(JWT_SUB)
    .setAudience('authenticated');
  if (opts?.expired) {
    jwt = jwt.setIssuedAt(now - 7200).setExpirationTime(now - 3600);
  } else {
    jwt = jwt.setIssuedAt().setExpirationTime('5m');
  }
  return jwt.sign(new TextEncoder().encode(opts?.secret ?? TEST_SECRET));
}

function makeBody(userId?: string): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '11111111-1111-4111-8111-111111111111',
    scenario_id: SCENARIO_ID,
    message: 'test',
    turn_class: 'frame',
    stage: 'frame',
    source: 'composer',
    ...(userId !== undefined ? { user_id: userId } : {}),
  };
}

function makeReq(
  body: unknown,
  headers: Record<string, string> = {},
): { body: unknown; headers: Record<string, string> } {
  return { body, headers: { 'x-request-id': FIXED_REQUEST_ID, ...headers } };
}

beforeEach(() => {
  mockConfig.auth.requireUserJwt = true;
  mockConfig.auth.supabaseJwtSecret = TEST_SECRET;
  emitSpy.mockReset();
  ensureScenarioExistsSpy.mockReset();
  ensureScenarioExistsSpy.mockResolvedValue({ user_id: null });
});

describe('runPreFlight — flag OFF (dormancy pin)', () => {
  it('client-supplied user_id reaches the store untouched; garbage Authorization + proxy marker are inert', async () => {
    mockConfig.auth.requireUserJwt = false;
    const req = makeReq(makeBody(BODY_USER_ID), {
      authorization: 'Bearer garbage.garbage.garbage',
      [BROWSER_PROXY_SOURCE_HEADER]: BROWSER_PROXY_SOURCE_VALUE,
    });

    const result = await runPreFlight(req as never);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.context.extensions.userId).toBe(BODY_USER_ID);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledWith(SCENARIO_ID, BODY_USER_ID);
  });
});

describe('runPreFlight — flag ON', () => {
  it('valid JWT: identity derived from sub; client body user_id IGNORED (mismatch telemetry only)', async () => {
    const req = makeReq(makeBody(BODY_USER_ID), {
      authorization: `Bearer ${await forgeJwt()}`,
    });

    const result = await runPreFlight(req as never);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.context.extensions.userId).toBe(JWT_SUB);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledWith(SCENARIO_ID, JWT_SUB);
    expect(emitSpy.mock.calls.map((c) => c[0])).toContain('UserJwtIdentityMismatch');
  });

  it('valid JWT with no body user_id: identity derived from sub, no mismatch telemetry', async () => {
    const req = makeReq(makeBody(), { authorization: `Bearer ${await forgeJwt()}` });

    const result = await runPreFlight(req as never);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.context.extensions.userId).toBe(JWT_SUB);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledWith(SCENARIO_ID, JWT_SUB);
    expect(emitSpy.mock.calls.map((c) => c[0])).not.toContain('UserJwtIdentityMismatch');
  });

  it('missing JWT on browser-proxy path: typed recoverable 401; store never touched', async () => {
    const req = makeReq(makeBody(BODY_USER_ID), {
      [BROWSER_PROXY_SOURCE_HEADER]: BROWSER_PROXY_SOURCE_VALUE,
    });

    const result = await runPreFlight(req as never);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(401);
    expect(result.error).toMatchInlineSnapshot(`
      {
        "boundary": "B1",
        "details": {
          "auth_reason": "missing_token",
          "code": "sign_in_required",
          "reason": "sign_in_required",
          "recoverable": true,
        },
        "direction": "ingress",
        "error": "INGRESS_CONTRACT_VIOLATION",
        "request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "retryable": false,
        "validator": "user_jwt",
      }
    `);
    expect(ensureScenarioExistsSpy).not.toHaveBeenCalled();
  });

  it('expired JWT: 401 with auth_reason expired_token', async () => {
    const req = makeReq(makeBody(BODY_USER_ID), {
      authorization: `Bearer ${await forgeJwt({ expired: true })}`,
    });

    const result = await runPreFlight(req as never);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(401);
    expect((result.error.details as { auth_reason?: string }).auth_reason).toBe(
      'expired_token',
    );
    expect(ensureScenarioExistsSpy).not.toHaveBeenCalled();
  });

  it('invalid-signature JWT: 401 with auth_reason invalid_token', async () => {
    const req = makeReq(makeBody(BODY_USER_ID), {
      authorization: `Bearer ${await forgeJwt({ secret: 'another-test-only-secret-000' })}`,
    });

    const result = await runPreFlight(req as never);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(401);
    expect((result.error.details as { auth_reason?: string }).auth_reason).toBe(
      'invalid_token',
    );
    expect(ensureScenarioExistsSpy).not.toHaveBeenCalled();
  });

  it('no JWT from a direct key-authed caller: legacy client identity accepted (service carve-out)', async () => {
    const req = makeReq(makeBody(BODY_USER_ID));

    const result = await runPreFlight(req as never);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.context.extensions.userId).toBe(BODY_USER_ID);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledWith(SCENARIO_ID, BODY_USER_ID);
  });

  it('auth precedes body validation: unauthenticated proxy request with an invalid body gets 401, not 422', async () => {
    const req = makeReq(
      { kind: 'message', message: 'no scenario_id here' },
      { [BROWSER_PROXY_SOURCE_HEADER]: BROWSER_PROXY_SOURCE_VALUE },
    );

    const result = await runPreFlight(req as never);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(401);
  });
});
