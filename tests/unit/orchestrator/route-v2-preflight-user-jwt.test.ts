/**
 * runPreFlight × flag-gated Supabase-JWT verification (CEE_REQUIRE_USER_JWT,
 * login 3.4 CEE-half, ships dark).
 *
 * Pins the behaviour claims at the shared pre-flight chokepoint that every
 * /orchestrate/v2/turn dispatch branch runs through:
 *
 *   1. Flag OFF  → byte-identical legacy behaviour: client-supplied body
 *      `user_id` reaches the scenario pre-flight untouched; no verification
 *      runs even when a garbage Authorization header is present.
 *   2. Flag ON + valid JWT → identity DERIVED from the token's `sub`; the
 *      client-supplied `user_id` is IGNORED (mismatch emits telemetry only).
 *   3. Flag ON + invalid/expired JWT → typed recoverable 401
 *      sign_in_required BoundaryError; the session store is never touched.
 *      (The MISSING-token refusal for browser traffic lives at the proxy
 *      front door — see proxy-v5-turn.test.ts.)
 *   4. Flag ON + no JWT → legacy client-supplied identity still accepted
 *      (key-authed service-caller carve-out; service auth is enforced by
 *      the auth plugin before the route, and the browser proxy refuses
 *      JWT-less turns before forwarding).
 *
 * All JWTs are forged locally with a test-only secret.
 *
 * Companion dormancy pin: tests/unit/orchestrator/route-v2-preflight.test.ts
 * runs against the REAL config (flag default false) and is unchanged by this
 * feature — its passing is the flag-off wire-contract pin.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  FIXTURE_SUB as JWT_SUB,
  forgeUserToken,
  makeEs256Key,
  startJwksFixture,
  type JwksFixture,
} from '../../../src/utils/__tests__/helpers/supabase-jwks-fixture.js';
import { attachCallerContext } from '../../../src/context/index.js';

const FIXED_REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';
const BODY_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mockConfig = {
  auth: {
    requireUserJwt: false,
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
const { resetSupabaseJwksCacheForTests } = await import(
  '../../../src/utils/supabase-user-jwt.js'
);

/** The project's real signing key, and an attacker's key of the same shape. */
let projectKey: Awaited<ReturnType<typeof makeEs256Key>>;
let attackerKey: Awaited<ReturnType<typeof makeEs256Key>>;
let jwks: JwksFixture;

async function forgeJwt(opts?: {
  expired?: boolean;
  /** Sign with a key the project's JWKS does NOT publish. */
  wrongKey?: boolean;
}): Promise<string> {
  return forgeUserToken(
    opts?.wrongKey === true ? attackerKey.privateKey : projectKey.privateKey,
    jwks.issuer,
    { expired: opts?.expired },
  );
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

/**
 * A SHARED-KEY caller: past the auth plugin, but not individually identified.
 * No caller context, so `admissibleClaimedUserId` discards any body `user_id`.
 */
function makeReq(
  body: unknown,
  headers: Record<string, string> = {},
): { body: unknown; headers: Record<string, string> } {
  return { body, headers: { 'x-request-id': FIXED_REQUEST_ID, ...headers } };
}

/**
 * A VERIFIED HMAC service caller — the only kind entitled to name the user it
 * acts as (`admissibleClaimedUserId`, route-v2-preflight.ts). Several pins in
 * this file are about what happens to an ADMITTED claim (does the verified sub
 * override it? does the mismatch telemetry fire?), and those questions only
 * exist for a caller whose claim is admissible in the first place.
 */
function makeHmacReq(
  body: unknown,
  headers: Record<string, string> = {},
): { body: unknown; headers: Record<string, string> } {
  const req = makeReq(body, headers);
  attachCallerContext(req as never, { keyId: 'user-jwt-suite-hmac', hmacAuth: true });
  return req;
}

beforeEach(async () => {
  projectKey = await makeEs256Key('kid-1');
  attackerKey = await makeEs256Key('kid-1');
  jwks = await startJwksFixture([projectKey.jwk]);
  mockConfig.auth.requireUserJwt = true;
  mockConfig.auth.supabaseJwksUrl = undefined;
  mockConfig.auth.supabaseUrl = jwks.base;
  resetSupabaseJwksCacheForTests();
  emitSpy.mockReset();
  ensureScenarioExistsSpy.mockReset();
  ensureScenarioExistsSpy.mockResolvedValue({ user_id: null });
});

afterEach(async () => {
  await jwks.close();
});

describe('runPreFlight — flag OFF (dormancy pin)', () => {
  // ⚠ SPLIT 28 Aug 2026. This was ONE test asserting that with the flag off a
  // client-supplied `user_id` "reaches the store untouched". That is now true
  // only for a caller entitled to send one — the untouched-claim half was the
  // staging IDOR (an anonymous browser reached this route through an edge that
  // injected the shared assist key and named a victim). The dormancy half of
  // the pin — that a garbage Authorization header is INERT when the flag is
  // off — is orthogonal to admissibility and is kept in both halves.
  it('a SHARED-KEY caller: client-supplied user_id is DISCARDED; garbage Authorization is inert', async () => {
    mockConfig.auth.requireUserJwt = false;
    const req = makeReq(makeBody(BODY_USER_ID), {
      authorization: 'Bearer garbage.garbage.garbage',
    });

    const result = await runPreFlight(req as never);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.context.extensions.userId).toBeNull();
    expect(ensureScenarioExistsSpy).toHaveBeenCalledWith(SCENARIO_ID, null);
    // Dormancy is unchanged: the flag is off, so the header is never verified.
    expect(emitSpy.mock.calls.map((c) => c[0])).not.toContain('UserJwtVerified');
    expect(emitSpy.mock.calls.map((c) => c[0])).not.toContain('UserJwtRefused');
  });

  it('an HMAC caller: client-supplied user_id reaches the store untouched; garbage Authorization is inert', async () => {
    mockConfig.auth.requireUserJwt = false;
    const req = makeHmacReq(makeBody(BODY_USER_ID), {
      authorization: 'Bearer garbage.garbage.garbage',
    });

    const result = await runPreFlight(req as never);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.context.extensions.userId).toBe(BODY_USER_ID);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledWith(SCENARIO_ID, BODY_USER_ID);
    expect(emitSpy.mock.calls.map((c) => c[0])).not.toContain('UserJwtVerified');
    expect(emitSpy.mock.calls.map((c) => c[0])).not.toContain('UserJwtRefused');
  });
});

describe('runPreFlight — flag ON', () => {
  // Uses an HMAC caller so the body claim is ADMISSIBLE and therefore actually
  // reaches the comparison. That is the whole subject of this pin: when a claim
  // could have been honoured, the verified `sub` still wins, and the discrepancy
  // is reported. For a shared-key caller the claim is discarded before this
  // point, so the mismatch event does not fire — see the note in
  // `admissibleClaimedUserId` on the observability delta.
  it('valid JWT: identity derived from sub; client body user_id IGNORED (mismatch telemetry only)', async () => {
    const req = makeHmacReq(makeBody(BODY_USER_ID), {
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

  it('expired JWT: typed recoverable 401; store never touched', async () => {
    const req = makeReq(makeBody(BODY_USER_ID), {
      authorization: `Bearer ${await forgeJwt({ expired: true })}`,
    });

    const result = await runPreFlight(req as never);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(401);
    expect(result.error).toMatchInlineSnapshot(`
      {
        "boundary": "B1",
        "details": {
          "auth_reason": "expired_token",
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

  it('invalid-signature JWT: 401 with auth_reason invalid_token', async () => {
    const req = makeReq(makeBody(BODY_USER_ID), {
      authorization: `Bearer ${await forgeJwt({ wrongKey: true })}`,
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

  // ⚠ NARROWED 28 Aug 2026 — the carve-out is now HMAC-ONLY.
  // `user-identity.ts` describes `service_legacy` as "reachable by key-authed
  // service callers (internal harnesses) only, never browser paths". That
  // sentence was true about the JWT flag and false about reachability: the edge
  // injected the shared assist key, so a browser DID reach it, and the carve-out
  // handed it a victim's identity. A shared bearer key cannot distinguish its
  // holders, so it cannot carry this entitlement. HMAC can.
  it('no JWT from an HMAC caller: legacy client identity accepted (service carve-out)', async () => {
    const req = makeHmacReq(makeBody(BODY_USER_ID));

    const result = await runPreFlight(req as never);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.context.extensions.userId).toBe(BODY_USER_ID);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledWith(SCENARIO_ID, BODY_USER_ID);
    expect(emitSpy.mock.calls.map((c) => c[0])).toContain('UserJwtServiceCallerLegacy');
  });

  it('no JWT from a SHARED-KEY caller: the claim is discarded, service_legacy or not', async () => {
    const req = makeReq(makeBody(BODY_USER_ID));

    const result = await runPreFlight(req as never);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.context.extensions.userId).toBeNull();
    expect(ensureScenarioExistsSpy).toHaveBeenCalledWith(SCENARIO_ID, null);
    // The mode is still `service_legacy` — admissibility is a SEPARATE question
    // from identity resolution, and this pins that the two stayed separate.
    expect(emitSpy.mock.calls.map((c) => c[0])).toContain('UserJwtServiceCallerLegacy');
  });

  it('auth precedes body validation: an invalid JWT on an invalid body gets 401, not 422', async () => {
    const req = makeReq(
      { kind: 'message', message: 'no scenario_id here' },
      { authorization: `Bearer ${await forgeJwt({ expired: true })}` },
    );

    const result = await runPreFlight(req as never);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(401);
  });
});
