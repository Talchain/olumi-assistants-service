/**
 * Unit tests for `resolveUserIdentity` + `buildSignInRequiredError` —
 * the flag-gated (CEE_REQUIRE_USER_JWT, default OFF) Supabase-JWT identity
 * resolution for /orchestrate/v2/turn (login 3.4 CEE-half, ships dark).
 *
 * Resolution matrix under test:
 *
 *   flag OFF                                → mode 'off' (legacy behaviour,
 *                                             headers never consulted)
 *   flag ON + valid Supabase JWT            → mode 'verified' (identity = sub)
 *   flag ON + no JWT + browser-proxy marker → mode 'refused' missing_token
 *   flag ON + no JWT + direct caller        → mode 'service_legacy'
 *                                             (key-authed service carve-out)
 *   flag ON + invalid/expired JWT           → mode 'refused' (any path — a
 *                                             caller that presented a JWT
 *                                             asked to be verified)
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

const {
  resolveUserIdentity,
  buildSignInRequiredError,
  BROWSER_PROXY_SOURCE_HEADER,
  BROWSER_PROXY_SOURCE_VALUE,
} = await import("../user-identity.js");

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

describe("resolveUserIdentity — flag OFF (dormancy)", () => {
  it("returns mode 'off' and emits no telemetry, even with a proxy marker and garbage token", async () => {
    mockConfig.auth.requireUserJwt = false;
    const req = makeReq({
      authorization: "Bearer garbage.garbage.garbage",
      [BROWSER_PROXY_SOURCE_HEADER]: BROWSER_PROXY_SOURCE_VALUE,
    });
    const result = await resolveUserIdentity(req as never, FIXED_REQUEST_ID);
    expect(result).toEqual({ mode: "off" });
    expect(emitSpy).not.toHaveBeenCalled();
  });
});

describe("resolveUserIdentity — flag ON", () => {
  it("valid JWT → mode 'verified' with userId from sub (direct caller)", async () => {
    const req = makeReq({ authorization: `Bearer ${await forgeJwt()}` });
    const result = await resolveUserIdentity(req as never, FIXED_REQUEST_ID);
    expect(result).toEqual({ mode: "verified", userId: SUB });
  });

  it("valid JWT → mode 'verified' (browser-proxy path)", async () => {
    const req = makeReq({
      authorization: `Bearer ${await forgeJwt()}`,
      [BROWSER_PROXY_SOURCE_HEADER]: BROWSER_PROXY_SOURCE_VALUE,
    });
    const result = await resolveUserIdentity(req as never, FIXED_REQUEST_ID);
    expect(result).toEqual({ mode: "verified", userId: SUB });
  });

  it("no Authorization + browser-proxy marker → refused missing_token", async () => {
    const req = makeReq({ [BROWSER_PROXY_SOURCE_HEADER]: BROWSER_PROXY_SOURCE_VALUE });
    const result = await resolveUserIdentity(req as never, FIXED_REQUEST_ID);
    expect(result).toEqual({ mode: "refused", reason: "missing_token" });
  });

  it("no Authorization + direct caller → mode 'service_legacy' (key-authed carve-out)", async () => {
    const req = makeReq({});
    const result = await resolveUserIdentity(req as never, FIXED_REQUEST_ID);
    expect(result).toEqual({ mode: "service_legacy" });
  });

  it("Bearer token that is not JWT-shaped (assist key) + direct caller → service_legacy", async () => {
    const req = makeReq({ authorization: "Bearer test-assist-key-abc123" });
    const result = await resolveUserIdentity(req as never, FIXED_REQUEST_ID);
    expect(result).toEqual({ mode: "service_legacy" });
  });

  it("Bearer token that is not JWT-shaped + browser-proxy marker → refused missing_token", async () => {
    const req = makeReq({
      authorization: "Bearer test-assist-key-abc123",
      [BROWSER_PROXY_SOURCE_HEADER]: BROWSER_PROXY_SOURCE_VALUE,
    });
    const result = await resolveUserIdentity(req as never, FIXED_REQUEST_ID);
    expect(result).toEqual({ mode: "refused", reason: "missing_token" });
  });

  it("invalid-signature JWT → refused invalid_token, even for a direct caller", async () => {
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
