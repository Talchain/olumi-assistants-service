/**
 * Unit tests for the Supabase user-JWT verifier (login 3.4 CEE-half).
 *
 * Every token used here is FORGED LOCALLY with a test-only secret or a
 * test-only generated key pair — no real credentials, no real Supabase
 * project material. The verifier's contract:
 *
 *   - HS256 tokens verify against config.auth.supabaseJwtSecret.
 *   - ES256/RS256 tokens verify against the project JWKS
 *     (config.auth.supabaseJwksUrl, falling back to
 *     `<config.auth.supabaseUrl>/auth/v1/.well-known/jwks.json`).
 *   - A verified token must carry aud "authenticated" AND a UUID `sub` —
 *     this is what rejects Supabase's legacy anon/service API keys, which
 *     are themselves HS256 JWTs signed with the SAME project secret but
 *     carry no sub and no "authenticated" audience.
 *   - Expired → 'expired_token'; any other failure → 'invalid_token';
 *     verification material missing → 'verification_unavailable'
 *     (fail closed — never fall back to trusting the caller).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, type KeyLike } from "jose";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const TEST_SECRET = "test-only-supabase-jwt-secret-0123456789abcdef";
const OTHER_SECRET = "a-completely-different-test-only-secret-xyz";
const SUB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const mockConfig = {
  auth: {
    requireUserJwt: true,
    supabaseJwtSecret: TEST_SECRET as string | undefined,
    supabaseJwksUrl: undefined as string | undefined,
    supabaseUrl: undefined as string | undefined,
  },
};

vi.mock("../../config/index.js", () => ({ config: mockConfig }));

const { verifySupabaseUserJwt, looksLikeJwt, resetSupabaseJwksCacheForTests } =
  await import("../supabase-user-jwt.js");

function hs256Key(secret: string = TEST_SECRET): Uint8Array {
  return new TextEncoder().encode(secret);
}

async function forgeHs256(opts?: {
  sub?: string | null;
  aud?: string | null;
  expiresIn?: string;
  expired?: boolean;
  secret?: string;
  extraClaims?: Record<string, unknown>;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  let jwt = new SignJWT({ ...(opts?.extraClaims ?? {}) }).setProtectedHeader({
    alg: "HS256",
    typ: "JWT",
  });
  if (opts?.sub !== null) jwt = jwt.setSubject(opts?.sub ?? SUB);
  if (opts?.aud !== null) jwt = jwt.setAudience(opts?.aud ?? "authenticated");
  if (opts?.expired) {
    jwt = jwt.setIssuedAt(now - 7200).setExpirationTime(now - 3600);
  } else {
    jwt = jwt.setIssuedAt().setExpirationTime(opts?.expiresIn ?? "5m");
  }
  return jwt.sign(hs256Key(opts?.secret ?? TEST_SECRET));
}

beforeEach(() => {
  mockConfig.auth.requireUserJwt = true;
  mockConfig.auth.supabaseJwtSecret = TEST_SECRET;
  mockConfig.auth.supabaseJwksUrl = undefined;
  mockConfig.auth.supabaseUrl = undefined;
  resetSupabaseJwksCacheForTests();
});

describe("looksLikeJwt", () => {
  it("accepts a locally-forged three-segment JWT", async () => {
    expect(looksLikeJwt(await forgeHs256())).toBe(true);
  });

  it("rejects an assist-key-shaped opaque token", () => {
    expect(looksLikeJwt("test-assist-key-abc123")).toBe(false);
  });

  it("rejects two-segment and empty-segment strings", () => {
    expect(looksLikeJwt("a.b")).toBe(false);
    expect(looksLikeJwt("a..c")).toBe(false);
    expect(looksLikeJwt("")).toBe(false);
  });
});

describe("verifySupabaseUserJwt — HS256 (legacy shared secret)", () => {
  it("valid token → ok with userId derived from sub", async () => {
    const result = await verifySupabaseUserJwt(await forgeHs256());
    expect(result).toEqual({ ok: true, userId: SUB });
  });

  it("expired token → expired_token", async () => {
    const result = await verifySupabaseUserJwt(await forgeHs256({ expired: true }));
    expect(result).toEqual({ ok: false, reason: "expired_token" });
  });

  it("wrong-secret signature → invalid_token", async () => {
    const result = await verifySupabaseUserJwt(
      await forgeHs256({ secret: OTHER_SECRET }),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("missing aud → invalid_token", async () => {
    const result = await verifySupabaseUserJwt(await forgeHs256({ aud: null }));
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("wrong aud → invalid_token", async () => {
    const result = await verifySupabaseUserJwt(await forgeHs256({ aud: "evil" }));
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("missing sub → invalid_token", async () => {
    const result = await verifySupabaseUserJwt(await forgeHs256({ sub: null }));
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("non-UUID sub → invalid_token", async () => {
    const result = await verifySupabaseUserJwt(
      await forgeHs256({ sub: "not-a-uuid" }),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("legacy anon-API-key-shaped JWT (same secret, role claim, no sub/aud) → invalid_token", async () => {
    // Supabase's legacy anon/service_role API keys are HS256 JWTs signed
    // with the SAME project secret. They must never verify as a user.
    const result = await verifySupabaseUserJwt(
      await forgeHs256({
        sub: null,
        aud: null,
        extraClaims: { iss: "supabase", ref: "testprojectref", role: "anon" },
      }),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it('alg "none" token → invalid_token', async () => {
    const b64 = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "none", typ: "JWT" })}.${b64({
      sub: SUB,
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 300,
    })}.x`;
    const result = await verifySupabaseUserJwt(unsigned);
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("garbage token → invalid_token", async () => {
    const result = await verifySupabaseUserJwt("not.a.jwt");
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("HS256 token with no secret configured → verification_unavailable (fail closed)", async () => {
    mockConfig.auth.supabaseJwtSecret = undefined;
    const result = await verifySupabaseUserJwt(await forgeHs256());
    expect(result).toEqual({ ok: false, reason: "verification_unavailable" });
  });
});

describe("verifySupabaseUserJwt — ES256 (JWKS signing keys)", () => {
  let server: Server | undefined;

  async function serveJwks(
    jwks: unknown,
    path = "/jwks",
  ): Promise<{ url: string; base: string }> {
    server = createServer((req, res) => {
      if (req.url === path) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(jwks));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server!.address() as AddressInfo;
    return {
      url: `http://127.0.0.1:${port}${path}`,
      base: `http://127.0.0.1:${port}`,
    };
  }

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server!.close((e) => (e ? reject(e) : resolve())),
      );
      server = undefined;
    }
  });

  async function forgeEs256(privateKey: KeyLike, kid: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: "ES256", typ: "JWT", kid })
      .setSubject(SUB)
      .setAudience("authenticated")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  }

  it("valid ES256 token against configured SUPABASE_JWKS_URL → ok", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwk = await exportJWK(publicKey);
    const { url } = await serveJwks({
      keys: [{ ...jwk, kid: "test-kid-1", use: "sig", alg: "ES256" }],
    });
    mockConfig.auth.supabaseJwksUrl = url;
    resetSupabaseJwksCacheForTests();

    const result = await verifySupabaseUserJwt(
      await forgeEs256(privateKey, "test-kid-1"),
    );
    expect(result).toEqual({ ok: true, userId: SUB });
  });

  it("JWKS URL derived from SUPABASE_URL when SUPABASE_JWKS_URL unset → ok", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwk = await exportJWK(publicKey);
    const { base } = await serveJwks(
      { keys: [{ ...jwk, kid: "test-kid-2", use: "sig", alg: "ES256" }] },
      "/auth/v1/.well-known/jwks.json",
    );
    mockConfig.auth.supabaseUrl = base;
    resetSupabaseJwksCacheForTests();

    const result = await verifySupabaseUserJwt(
      await forgeEs256(privateKey, "test-kid-2"),
    );
    expect(result).toEqual({ ok: true, userId: SUB });
  });

  it("ES256 token signed by a DIFFERENT key than the JWKS → invalid_token", async () => {
    const real = await generateKeyPair("ES256");
    const attacker = await generateKeyPair("ES256");
    const jwk = await exportJWK(real.publicKey);
    const { url } = await serveJwks({
      keys: [{ ...jwk, kid: "test-kid-3", use: "sig", alg: "ES256" }],
    });
    mockConfig.auth.supabaseJwksUrl = url;
    resetSupabaseJwksCacheForTests();

    const result = await verifySupabaseUserJwt(
      await forgeEs256(attacker.privateKey, "test-kid-3"),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("ES256 token with no JWKS URL and no SUPABASE_URL → verification_unavailable (fail closed)", async () => {
    const { privateKey } = await generateKeyPair("ES256");
    const result = await verifySupabaseUserJwt(
      await forgeEs256(privateKey, "test-kid-4"),
    );
    expect(result).toEqual({ ok: false, reason: "verification_unavailable" });
  });
});
