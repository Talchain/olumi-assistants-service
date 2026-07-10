/**
 * Unit tests for `resolveUserIdentity` + `buildSignInRequiredError` —
 * the flag-gated (CEE_REQUIRE_USER_JWT, default OFF) Supabase-JWT identity
 * resolution for /orchestrate/v2/turn (login 3.4 CEE-half, ships dark).
 *
 * Resolution matrix under test (missing-token refusal for the browser path
 * lives at the proxy front door — see proxy-v5-turn.test.ts):
 *
 *   flag OFF                      → mode 'off' (legacy behaviour,
 *                                   headers never consulted)
 *   flag ON + valid Supabase JWT  → mode 'verified' (identity = sub)
 *   flag ON + no JWT              → mode 'service_legacy' (key-authed
 *                                   service carve-out — service auth was
 *                                   enforced before the route)
 *   flag ON + invalid/expired JWT → mode 'refused' (a caller that
 *                                   presented a JWT asked to be verified;
 *                                   no downgrade-to-carve-out by sending
 *                                   garbage)
 *
 * All tokens are forged locally with a test-only secret.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SignJWT } from "jose";

const TEST_SECRET = "test-only-supabase-jwt-secret-0123456789abcdef";
const SUB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FIXED_REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const mockConfig = {
  auth: {
    requireUserJwt: false,
    supabaseJwtSecret: TEST_SECRET as string | undefined,
    supabaseJwksUrl: undefined as string | undefined,
    supabaseUrl: undefined as string | undefined,
  },
};

const emitSpy = vi.fn();

vi.mock("../../config/index.js", () => ({ config: mockConfig }));
vi.mock("../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: (...args: unknown[]) => emitSpy(...args),
  TelemetryEvents: new Proxy(
    {},
    { get: (_t, prop) => String(prop) },
  ),
}));

const { resolveUserIdentity, buildSignInRequiredError, extractJwtCandidate } =
  await import("../user-identity.js");

async function forgeJwt(opts?: {
  expired?: boolean;
  secret?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  let jwt = new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(SUB)
    .setAudience("authenticated");
  if (opts?.expired) {
    jwt = jwt.setIssuedAt(now - 7200).setExpirationTime(now - 3600);
  } else {
    jwt = jwt.setIssuedAt().setExpirationTime("5m");
  }
  return jwt.sign(new TextEncoder().encode(opts?.secret ?? TEST_SECRET));
}

function makeReq(headers: Record<string, string>): { headers: Record<string, string> } {
  return { headers };
}

beforeEach(() => {
  mockConfig.auth.requireUserJwt = true;
  mockConfig.auth.supabaseJwtSecret = TEST_SECRET;
  emitSpy.mockReset();
});

describe("extractJwtCandidate", () => {
  it("extracts a JWT-shaped Bearer token", async () => {
    const token = await forgeJwt();
    expect(extractJwtCandidate(`Bearer ${token}`)).toBe(token);
  });

  it("returns null for absent / non-Bearer / opaque-key values", () => {
    expect(extractJwtCandidate(undefined)).toBeNull();
    expect(extractJwtCandidate("Basic dXNlcjpwdw==")).toBeNull();
    expect(extractJwtCandidate("Bearer test-assist-key-abc123")).toBeNull();
  });
});

describe("resolveUserIdentity — flag OFF (dormancy)", () => {
  it("returns mode 'off' and emits no telemetry, even with a garbage token present", async () => {
    mockConfig.auth.requireUserJwt = false;
    const req = makeReq({ authorization: "Bearer garbage.garbage.garbage" });
    const result = await resolveUserIdentity(req as never, FIXED_REQUEST_ID);
    expect(result).toEqual({ mode: "off" });
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it("returns mode 'off' when the auth config section is absent entirely (partial config mocks)", async () => {
    // Regression pin: several route-v2 integration tests stub src/config
    // with only the sections they exercise (no `auth` at all). The dormant
    // path must treat a missing section as OFF, not throw a 500.
    const savedAuth = mockConfig.auth;
    try {
      (mockConfig as { auth?: typeof savedAuth }).auth = undefined;
      const req = makeReq({ authorization: "Bearer garbage.garbage.garbage" });
      const result = await resolveUserIdentity(req as never, FIXED_REQUEST_ID);
      expect(result).toEqual({ mode: "off" });
      expect(emitSpy).not.toHaveBeenCalled();
    } finally {
      (mockConfig as { auth?: typeof savedAuth }).auth = savedAuth;
    }
  });
});

describe("resolveUserIdentity — flag ON", () => {
  it("valid JWT → mode 'verified' with userId from sub", async () => {
    const req = makeReq({ authorization: `Bearer ${await forgeJwt()}` });
    const result = await resolveUserIdentity(req as never, FIXED_REQUEST_ID);
    expect(result).toEqual({ mode: "verified", userId: SUB });
  });

  it("no Authorization → mode 'service_legacy' (key-authed carve-out)", async () => {
    const req = makeReq({});
    const result = await resolveUserIdentity(req as never, FIXED_REQUEST_ID);
    expect(result).toEqual({ mode: "service_legacy" });
    expect(emitSpy.mock.calls.map((c) => c[0])).toContain("UserJwtServiceCallerLegacy");
  });

  it("Bearer token that is not JWT-shaped (assist key) → service_legacy", async () => {
    const req = makeReq({ authorization: "Bearer test-assist-key-abc123" });
    const result = await resolveUserIdentity(req as never, FIXED_REQUEST_ID);
    expect(result).toEqual({ mode: "service_legacy" });
  });

  it("invalid-signature JWT → refused invalid_token (no downgrade to carve-out)", async () => {
    const req = makeReq({
      authorization: `Bearer ${await forgeJwt({ secret: "another-test-only-secret-000" })}`,
    });
    const result = await resolveUserIdentity(req as never, FIXED_REQUEST_ID);
    expect(result).toEqual({ mode: "refused", reason: "invalid_token" });
  });

  it("expired JWT → refused expired_token", async () => {
    const req = makeReq({ authorization: `Bearer ${await forgeJwt({ expired: true })}` });
    const result = await resolveUserIdentity(req as never, FIXED_REQUEST_ID);
    expect(result).toEqual({ mode: "refused", reason: "expired_token" });
  });

  it("JWT present but no verification material configured → refused verification_unavailable (fail closed)", async () => {
    mockConfig.auth.supabaseJwtSecret = undefined;
    const req = makeReq({ authorization: `Bearer ${await forgeJwt()}` });
    const result = await resolveUserIdentity(req as never, FIXED_REQUEST_ID);
    expect(result).toEqual({ mode: "refused", reason: "verification_unavailable" });
  });
});

describe("buildSignInRequiredError — wire shape", () => {
  it("emits the typed recoverable sign_in_required BoundaryError envelope", () => {
    expect(buildSignInRequiredError("missing_token", FIXED_REQUEST_ID))
      .toMatchInlineSnapshot(`
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
  });
});
