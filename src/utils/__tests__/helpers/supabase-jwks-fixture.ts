/**
 * Shared test fixture for Supabase user-JWT verification (JWKS/ES256).
 *
 * NOT a spec — this file has no `.test.` segment, so vitest's default include
 * glob does not collect it.
 *
 * Every spec that exercises the real `verifySupabaseUserJwt` needs the same
 * three things: a throwaway ES256 key pair, an in-process JWKS endpoint that
 * publishes it, and a token forger. They live here ONCE. Three hand-kept
 * copies of a mock key server is exactly the drifting-mirror defect that bites
 * this codebase, and a copy that silently stops matching the verifier's
 * expectations reads as a green suite.
 *
 * All key material is generated per-call and never leaves the process. No real
 * Supabase project material appears here or in any consumer.
 */
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from "jose";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** Path Supabase publishes its JWKS at, relative to the project URL. */
export const WELL_KNOWN_PATH = "/auth/v1/.well-known/jwks.json";

/** A UUID-shaped `sub`, matching Supabase's auth.users primary key shape. */
export const FIXTURE_SUB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** How the fixture endpoint should behave on the next request. */
export type JwksMode = "ok" | "http_500" | "bad_json";

export interface JwksFixture {
  /** Origin, e.g. http://127.0.0.1:54321 — the SUPABASE_URL stand-in. */
  readonly base: string;
  /** Full well-known JWKS URL — the SUPABASE_JWKS_URL stand-in. */
  readonly url: string;
  /** The issuer the verifier must require for tokens from this project. */
  readonly issuer: string;
  /** Republish a different key set (key rotation). */
  setKeys(keys: readonly JWK[]): void;
  /** Switch the endpoint's failure mode (outage simulation). */
  setMode(mode: JwksMode): void;
  /** Requests served — lets a spec prove a refetch really happened. */
  hits(): number;
  /** Shut the endpoint down. Idempotent. */
  close(): Promise<void>;
}

/** Generate a throwaway ES256 key pair and its public JWK. */
export async function makeEs256Key(
  kid: string,
): Promise<{ privateKey: KeyLike; jwk: JWK }> {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  return { privateKey, jwk: { ...jwk, kid, use: "sig", alg: "ES256" } };
}

export interface JwksFixtureOpts {
  /**
   * Additionally serve the key set at this path. Lets a spec configure an
   * explicit SUPABASE_JWKS_URL that is REACHABLE but sits outside the
   * well-known layout — the only configuration in which the issuer cannot be
   * derived from the JWKS URL.
   */
  readonly extraPath?: string;
}

/** Start an in-process JWKS endpoint publishing `keys`. */
export async function startJwksFixture(
  keys: readonly JWK[],
  opts: JwksFixtureOpts = {},
): Promise<JwksFixture> {
  let currentKeys: readonly JWK[] = keys;
  let mode: JwksMode = "ok";
  let hits = 0;
  let closed = false;

  const server: Server = createServer((req, res) => {
    const served =
      req.url === WELL_KNOWN_PATH ||
      (opts.extraPath !== undefined && req.url === opts.extraPath);
    if (!served) {
      res.writeHead(404);
      res.end();
      return;
    }
    hits += 1;
    if (mode === "http_500") {
      res.writeHead(500);
      res.end("boom");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      mode === "bad_json"
        ? "this is not json"
        : JSON.stringify({ keys: currentKeys }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  return {
    base,
    url: `${base}${WELL_KNOWN_PATH}`,
    issuer: `${base}/auth/v1`,
    setKeys: (k) => {
      currentKeys = k;
    },
    setMode: (m) => {
      mode = m;
    },
    hits: () => hits,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    },
  };
}

export interface ForgeOpts {
  readonly kid?: string;
  readonly alg?: string;
  /** `null` omits the claim entirely. */
  readonly sub?: string | null;
  readonly aud?: string | null;
  readonly iss?: string | null;
  readonly expired?: boolean;
  readonly extraClaims?: Record<string, unknown>;
}

/** Forge a Supabase-shaped user access token signed with an asymmetric key. */
export async function forgeUserToken(
  key: KeyLike,
  issuer: string,
  opts: ForgeOpts = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  let jwt = new SignJWT({ ...(opts.extraClaims ?? {}) }).setProtectedHeader({
    alg: opts.alg ?? "ES256",
    typ: "JWT",
    kid: opts.kid ?? "kid-1",
  });
  if (opts.sub !== null) jwt = jwt.setSubject(opts.sub ?? FIXTURE_SUB);
  if (opts.aud !== null) jwt = jwt.setAudience(opts.aud ?? "authenticated");
  if (opts.iss !== null) jwt = jwt.setIssuer(opts.iss ?? issuer);
  jwt = opts.expired
    ? jwt.setIssuedAt(now - 7200).setExpirationTime(now - 3600)
    : jwt.setIssuedAt().setExpirationTime("5m");
  return jwt.sign(key);
}

/**
 * Forge an HS256 token — the RETIRED verification path.
 * Kept so specs can assert the shared-secret forgery is refused.
 */
export async function forgeHs256Token(
  secret: string,
  issuer: string,
  opts: { readonly sub?: string } = {},
): Promise<string> {
  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(opts.sub ?? FIXTURE_SUB)
    .setAudience("authenticated")
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret));
}
