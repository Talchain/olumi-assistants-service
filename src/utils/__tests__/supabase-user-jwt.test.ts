/**
 * Unit tests for the Supabase user-JWT verifier — ES256/JWKS ONLY.
 *
 * Every token used here is FORGED LOCALLY with a test-only generated key
 * pair — no real credentials and no real Supabase project material ever
 * appear in this file.
 *
 * The verifier's contract after the HS256 retirement:
 *
 *   - ONLY asymmetric algs (ES256/RS256) verified against the project JWKS
 *     (config.auth.supabaseJwksUrl, falling back to
 *     `<config.auth.supabaseUrl>/auth/v1/.well-known/jwks.json`).
 *   - HS256 is REFUSED outright. The legacy shared secret is retired: it was
 *     a symmetric forgery key (anyone holding it could mint a token for any
 *     `sub`), and honouring it alongside JWKS would be two verification
 *     authorities answering one question.
 *   - A verified token must carry aud "authenticated", the project issuer,
 *     and a UUID `sub`.
 *   - Failure taxonomy is DISTINCT and must not collapse:
 *       expired signature-valid token     → 'expired_token'
 *       anything wrong with the TOKEN     → 'invalid_token'
 *       JWKS not configured / unreachable → 'verification_unavailable'
 *     The last distinction is load-bearing: a JWKS outage is an INFRASTRUCTURE
 *     failure and must never be reported as "your token is bad" — the caller
 *     would be told to sign in again, which cannot help.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  FIXTURE_SUB as SUB,
  forgeHs256Token,
  forgeUserToken,
  makeEs256Key,
  startJwksFixture,
  type JwksFixture,
} from "./helpers/supabase-jwks-fixture.js";

const mockConfig = {
  auth: {
    requireUserJwt: true,
    supabaseJwksUrl: undefined as string | undefined,
    supabaseUrl: undefined as string | undefined,
  },
};

vi.mock("../../config/index.js", () => ({ config: mockConfig }));

const { verifySupabaseUserJwt, looksLikeJwt, resetSupabaseJwksCacheForTests } =
  await import("../supabase-user-jwt.js");

let fixture: JwksFixture | undefined;

async function startJwks(
  keys: Parameters<typeof startJwksFixture>[0],
  opts?: Parameters<typeof startJwksFixture>[1],
): Promise<JwksFixture> {
  fixture = await startJwksFixture(keys, opts);
  return fixture;
}

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

beforeEach(() => {
  mockConfig.auth.requireUserJwt = true;
  mockConfig.auth.supabaseJwksUrl = undefined;
  mockConfig.auth.supabaseUrl = undefined;
  resetSupabaseJwksCacheForTests();
});

/**
 * Standard fixture: a running JWKS with one ES256 key, wired into config via
 * SUPABASE_URL — the posture cee-staging actually runs, since SUPABASE_JWKS_URL
 * is NOT set there and the well-known fallback is the live code path.
 */
async function standardFixture(): Promise<{
  jwks: JwksFixture;
  privateKey: Awaited<ReturnType<typeof makeEs256Key>>["privateKey"];
}> {
  const { privateKey, jwk } = await makeEs256Key("kid-1");
  const jwks = await startJwks([jwk]);
  mockConfig.auth.supabaseUrl = jwks.base;
  resetSupabaseJwksCacheForTests();
  return { jwks, privateKey };
}

/* ------------------------------------------------------------------ */

describe("looksLikeJwt", () => {
  it("accepts a three-segment JWT", async () => {
    const { jwks, privateKey } = await standardFixture();
    expect(looksLikeJwt(await forgeUserToken(privateKey, jwks.issuer))).toBe(true);
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

describe("verifySupabaseUserJwt — ES256 happy path", () => {
  it("valid ES256 token via SUPABASE_URL well-known fallback → ok", async () => {
    const { jwks, privateKey } = await standardFixture();
    const result = await verifySupabaseUserJwt(
      await forgeUserToken(privateKey, jwks.issuer),
    );
    expect(result).toEqual({ ok: true, userId: SUB });
  });

  it("valid ES256 token via explicit SUPABASE_JWKS_URL → ok", async () => {
    const { privateKey, jwk } = await makeEs256Key("kid-1");
    const jwks = await startJwks([jwk]);
    mockConfig.auth.supabaseUrl = undefined;
    mockConfig.auth.supabaseJwksUrl = jwks.url;
    resetSupabaseJwksCacheForTests();

    const result = await verifySupabaseUserJwt(
      await forgeUserToken(privateKey, jwks.issuer),
    );
    expect(result).toEqual({ ok: true, userId: SUB });
  });
});

describe("verifySupabaseUserJwt — HS256 is RETIRED (alg confusion)", () => {
  it("HS256 token is refused as invalid_token even when its claims are perfect", async () => {
    const { jwks } = await standardFixture();
    const result = await verifySupabaseUserJwt(
      await forgeHs256Token("any-secret-at-all", jwks.issuer),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("HS256 token signed with the JWKS key material as the HMAC secret → invalid_token", async () => {
    // Classic alg-confusion: the attacker takes the PUBLIC key bytes from the
    // JWKS and uses them as a symmetric HMAC secret. Must never verify.
    const { jwk } = await makeEs256Key("kid-1");
    const jwks = await startJwks([jwk]);
    mockConfig.auth.supabaseUrl = jwks.base;
    resetSupabaseJwksCacheForTests();

    const publicKeyMaterial = `${jwk.x ?? ""}${jwk.y ?? ""}`;
    const result = await verifySupabaseUserJwt(
      await forgeHs256Token(publicKeyMaterial, jwks.issuer),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("HS256 token is refused WITHOUT contacting the JWKS endpoint", async () => {
    // A retired alg is a token-level refusal, not an availability question:
    // it must not depend on, or waste, a network round trip.
    const { jwks } = await standardFixture();
    const before = jwks.hits();
    await verifySupabaseUserJwt(await forgeHs256Token("any-secret", jwks.issuer));
    expect(jwks.hits()).toBe(before);
  });

  it('alg "none" token → invalid_token', async () => {
    const { jwks } = await standardFixture();
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "none", typ: "JWT" })}.${b64({
      sub: SUB,
      aud: "authenticated",
      iss: jwks.issuer,
      exp: Math.floor(Date.now() / 1000) + 300,
    })}.x`;
    expect(await verifySupabaseUserJwt(unsigned)).toEqual({
      ok: false,
      reason: "invalid_token",
    });
  });
});

describe("verifySupabaseUserJwt — claim enforcement", () => {
  it("expired but signature-valid token → expired_token", async () => {
    const { jwks, privateKey } = await standardFixture();
    const result = await verifySupabaseUserJwt(
      await forgeUserToken(privateKey, jwks.issuer, { expired: true }),
    );
    expect(result).toEqual({ ok: false, reason: "expired_token" });
  });

  it("missing aud → invalid_token", async () => {
    const { jwks, privateKey } = await standardFixture();
    const result = await verifySupabaseUserJwt(
      await forgeUserToken(privateKey, jwks.issuer, { aud: null }),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("wrong aud → invalid_token", async () => {
    const { jwks, privateKey } = await standardFixture();
    const result = await verifySupabaseUserJwt(
      await forgeUserToken(privateKey, jwks.issuer, { aud: "evil" }),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("legacy anon-API-key-shaped token (role claim, no sub, no user aud) → invalid_token", async () => {
    const { jwks, privateKey } = await standardFixture();
    const result = await verifySupabaseUserJwt(
      await forgeUserToken(privateKey, jwks.issuer, {
        sub: null,
        aud: null,
        extraClaims: { role: "anon", ref: "testprojectref" },
      }),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("wrong iss (another Supabase project's issuer) → invalid_token", async () => {
    const { jwks, privateKey } = await standardFixture();
    const result = await verifySupabaseUserJwt(
      await forgeUserToken(privateKey, jwks.issuer, {
        iss: "https://someone-elses-project.supabase.co/auth/v1",
      }),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("missing iss → invalid_token", async () => {
    const { jwks, privateKey } = await standardFixture();
    const result = await verifySupabaseUserJwt(
      await forgeUserToken(privateKey, jwks.issuer, { iss: null }),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("missing sub → invalid_token", async () => {
    const { jwks, privateKey } = await standardFixture();
    const result = await verifySupabaseUserJwt(
      await forgeUserToken(privateKey, jwks.issuer, { sub: null }),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("non-UUID sub → invalid_token", async () => {
    const { jwks, privateKey } = await standardFixture();
    const result = await verifySupabaseUserJwt(
      await forgeUserToken(privateKey, jwks.issuer, { sub: "not-a-uuid" }),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("garbage token → invalid_token", async () => {
    await standardFixture();
    expect(await verifySupabaseUserJwt("not.a.jwt")).toEqual({
      ok: false,
      reason: "invalid_token",
    });
  });
});

describe("verifySupabaseUserJwt — signature binding", () => {
  it("token signed by a different key than the JWKS publishes → invalid_token", async () => {
    const real = await makeEs256Key("kid-1");
    const attacker = await makeEs256Key("kid-1");
    const jwks = await startJwks([real.jwk]);
    mockConfig.auth.supabaseUrl = jwks.base;
    resetSupabaseJwksCacheForTests();

    const result = await verifySupabaseUserJwt(
      await forgeUserToken(attacker.privateKey, jwks.issuer),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("unknown kid with a REACHABLE JWKS → invalid_token, not verification_unavailable", async () => {
    // The key set was fetched successfully; the token simply names a key that
    // does not exist. That is a token fault, not an outage.
    const { jwks, privateKey } = await standardFixture();
    const result = await verifySupabaseUserJwt(
      await forgeUserToken(privateKey, jwks.issuer, { kid: "no-such-kid" }),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });
});

describe("verifySupabaseUserJwt — availability taxonomy (must not collapse)", () => {
  it("no JWKS URL and no SUPABASE_URL → verification_unavailable (fail closed)", async () => {
    const { privateKey } = await makeEs256Key("kid-1");
    const result = await verifySupabaseUserJwt(
      await forgeUserToken(privateKey, "https://example.test/auth/v1"),
    );
    expect(result).toEqual({ ok: false, reason: "verification_unavailable" });
  });

  it("REACHABLE JWKS whose URL yields no derivable issuer → verification_unavailable", async () => {
    // The one configuration where the issuer cannot be derived: an explicit
    // SUPABASE_JWKS_URL outside the well-known layout, with no SUPABASE_URL.
    // The key set here is genuinely reachable and the token genuinely valid,
    // so the ONLY thing that can refuse it is the fail-closed issuer guard.
    // It must refuse rather than let an unenforceable claim check quietly
    // become a no-op — a check that silently passes everything is worse than
    // no check, because the contract still claims it is enforced.
    const { privateKey, jwk } = await makeEs256Key("kid-1");
    const jwks = await startJwks([jwk], { extraPath: "/custom-keys" });
    mockConfig.auth.supabaseUrl = undefined;
    mockConfig.auth.supabaseJwksUrl = `${jwks.base}/custom-keys`;
    resetSupabaseJwksCacheForTests();

    expect(
      await verifySupabaseUserJwt(await forgeUserToken(privateKey, jwks.issuer)),
    ).toEqual({ ok: false, reason: "verification_unavailable" });
  });

  it("JWKS endpoint refuses the connection → verification_unavailable", async () => {
    const { privateKey, jwk } = await makeEs256Key("kid-1");
    const jwks = await startJwks([jwk]);
    const token = await forgeUserToken(privateKey, jwks.issuer);
    mockConfig.auth.supabaseUrl = jwks.base;
    resetSupabaseJwksCacheForTests();

    // Take the endpoint down BEFORE the first fetch.
    await jwks.close();

    expect(await verifySupabaseUserJwt(token)).toEqual({
      ok: false,
      reason: "verification_unavailable",
    });
  });

  it("JWKS endpoint returns HTTP 500 → verification_unavailable", async () => {
    const { jwks, privateKey } = await standardFixture();
    jwks.setMode("http_500");
    resetSupabaseJwksCacheForTests();

    expect(
      await verifySupabaseUserJwt(await forgeUserToken(privateKey, jwks.issuer)),
    ).toEqual({ ok: false, reason: "verification_unavailable" });
  });

  it("JWKS endpoint returns unparseable JSON → verification_unavailable", async () => {
    const { jwks, privateKey } = await standardFixture();
    jwks.setMode("bad_json");
    resetSupabaseJwksCacheForTests();

    expect(
      await verifySupabaseUserJwt(await forgeUserToken(privateKey, jwks.issuer)),
    ).toEqual({ ok: false, reason: "verification_unavailable" });
  });

  it("an outage does NOT downgrade to invalid_token for an otherwise-perfect token", async () => {
    // Discriminating pair: the SAME token verifies when the endpoint is up and
    // reports unavailability — never "bad token" — when it is down.
    const { jwks, privateKey } = await standardFixture();
    const token = await forgeUserToken(privateKey, jwks.issuer);

    expect(await verifySupabaseUserJwt(token)).toEqual({ ok: true, userId: SUB });

    jwks.setMode("http_500");
    resetSupabaseJwksCacheForTests();
    expect(await verifySupabaseUserJwt(token)).toEqual({
      ok: false,
      reason: "verification_unavailable",
    });
  });
});

describe("verifySupabaseUserJwt — key rotation", () => {
  it("a key added to the JWKS verifies after the key-set cache is refreshed", async () => {
    const first = await makeEs256Key("kid-old");
    const second = await makeEs256Key("kid-new");
    const jwks = await startJwks([first.jwk]);
    mockConfig.auth.supabaseUrl = jwks.base;
    resetSupabaseJwksCacheForTests();

    // Old key works, and the endpoint has been fetched at least once.
    expect(
      await verifySupabaseUserJwt(
        await forgeUserToken(first.privateKey, jwks.issuer, { kid: "kid-old" }),
      ),
    ).toEqual({ ok: true, userId: SUB });
    const hitsAfterFirst = jwks.hits();
    expect(hitsAfterFirst).toBeGreaterThan(0);

    // Rotation: the project publishes a second signing key.
    jwks.setKeys([first.jwk, second.jwk]);
    resetSupabaseJwksCacheForTests();

    const rotated = await verifySupabaseUserJwt(
      await forgeUserToken(second.privateKey, jwks.issuer, { kid: "kid-new" }),
    );
    expect(rotated).toEqual({ ok: true, userId: SUB });
    // Prove a genuine refetch happened rather than a stale cache hit.
    expect(jwks.hits()).toBeGreaterThan(hitsAfterFirst);

    // And the old key still verifies during the overlap window.
    expect(
      await verifySupabaseUserJwt(
        await forgeUserToken(first.privateKey, jwks.issuer, { kid: "kid-old" }),
      ),
    ).toEqual({ ok: true, userId: SUB });
  });
});
