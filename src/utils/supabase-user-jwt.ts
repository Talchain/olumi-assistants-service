/**
 * Supabase user-JWT verification (login 3.4 CEE-half, ships dark).
 *
 * Verifies a caller's Supabase ACCESS TOKEN (`Authorization: Bearer <jwt>`)
 * and derives the user identity from its `sub` claim. Consumed by the
 * flag-gated (CEE_REQUIRE_USER_JWT, default OFF) identity resolution in
 * src/orchestrator/user-identity.ts — see LOGIN-CEE-HALF-SPEC-2026-07-10.
 *
 * Two verification mechanisms, selected by the token's own `alg` header:
 *
 *   - HS256 → the project's legacy shared JWT secret (env SUPABASE_JWT_SECRET,
 *     config.auth.supabaseJwtSecret). Classic Supabase projects sign access
 *     tokens with this secret.
 *   - ES256 / RS256 → the project JWKS (env SUPABASE_JWKS_URL, falling back
 *     to `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`). Newer Supabase
 *     projects use asymmetric signing keys published at that endpoint. The
 *     remote key set is cached in-process by jose (createRemoteJWKSet).
 *
 * Acceptance requires ALL of:
 *   - signature valid for an allowlisted alg (never "none");
 *   - not expired (exp enforced, 5 s clock tolerance);
 *   - audience contains "authenticated" — Supabase stamps user access tokens
 *     with aud "authenticated". This is a load-bearing guard: the project's
 *     legacy anon/service_role API KEYS are themselves HS256 JWTs signed with
 *     the SAME shared secret, but carry no "authenticated" audience (and no
 *     sub), so they can never verify as a user;
 *   - `sub` is a UUID (Supabase auth.users primary key shape) — this is the
 *     derived user_id.
 *
 * Failure taxonomy (stable strings, consumed by the 401 refusal envelope):
 *   - 'expired_token'            — signature-valid but expired; the UI can
 *                                  refresh the session and retry.
 *   - 'invalid_token'            — anything structurally or cryptographically
 *                                  wrong (bad signature, wrong aud, no sub,
 *                                  unsupported alg, garbage).
 *   - 'verification_unavailable' — the flag is on but the verification
 *                                  material (secret / JWKS URL) is not
 *                                  configured. FAIL CLOSED: never fall back
 *                                  to trusting the caller-supplied identity.
 *
 * Security invariants:
 *   - No secret VALUES appear in code or logs — configuration is by env var
 *     name only, and this module logs nothing (callers log reason codes).
 *   - Token contents are never logged.
 */

import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  errors as joseErrors,
  jwtVerify,
} from "jose";

import { config } from "../config/index.js";

export type SupabaseUserJwtRefusalReason =
  | "expired_token"
  | "invalid_token"
  | "verification_unavailable";

export type SupabaseUserJwtResult =
  | { readonly ok: true; readonly userId: string }
  | { readonly ok: false; readonly reason: SupabaseUserJwtRefusalReason };

/** Algs accepted from the asymmetric (JWKS) path. */
const ASYMMETRIC_ALGS: ReadonlySet<string> = new Set(["ES256", "RS256"]);

/** Supabase stamps user access tokens with this audience. */
const SUPABASE_USER_AUDIENCE = "authenticated";

/** auth.users primary keys are UUIDs; the derived user_id must look like one. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Base64url segment (JWS compact serialization member). */
const BASE64URL_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Cheap structural test: does this Bearer token even look like a JWT?
 * Used by the identity resolver to distinguish a Supabase access token from
 * an opaque service key sent as `Authorization: Bearer <assist key>` —
 * non-JWT-shaped tokens are NOT treated as failed user JWTs.
 */
export function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  return (
    parts.length === 3 &&
    parts.every((p) => p.length > 0 && BASE64URL_SEGMENT_RE.test(p))
  );
}

// Remote JWKS resolver cache, keyed by URL so a config change (tests, reload)
// invalidates it. jose's createRemoteJWKSet does its own HTTP-level caching
// and key-rotation refetching behind this handle.
let cachedRemoteJwks: {
  url: string;
  resolver: ReturnType<typeof createRemoteJWKSet>;
} | null = null;

/** Test seam: drop the cached remote JWKS resolver. */
export function resetSupabaseJwksCacheForTests(): void {
  cachedRemoteJwks = null;
}

function resolveJwksUrl(): string | undefined {
  const explicit = config.auth.supabaseJwksUrl;
  if (explicit && explicit.length > 0) return explicit;
  const base = config.auth.supabaseUrl;
  if (base && base.length > 0) {
    return `${base.replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`;
  }
  return undefined;
}

function getRemoteJwks(url: string): ReturnType<typeof createRemoteJWKSet> {
  if (cachedRemoteJwks && cachedRemoteJwks.url === url) {
    return cachedRemoteJwks.resolver;
  }
  const resolver = createRemoteJWKSet(new URL(url));
  cachedRemoteJwks = { url, resolver };
  return resolver;
}

/**
 * Verify a Supabase user access token and derive the user identity.
 * Never throws; never logs. See module doc for the acceptance contract.
 */
export async function verifySupabaseUserJwt(
  token: string,
): Promise<SupabaseUserJwtResult> {
  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    return { ok: false, reason: "invalid_token" };
  }

  try {
    let payload: import("jose").JWTPayload;
    if (alg === "HS256") {
      const secret = config.auth.supabaseJwtSecret;
      if (!secret || secret.length === 0) {
        return { ok: false, reason: "verification_unavailable" };
      }
      ({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        algorithms: ["HS256"],
        audience: SUPABASE_USER_AUDIENCE,
        clockTolerance: 5,
      }));
    } else if (alg !== undefined && ASYMMETRIC_ALGS.has(alg)) {
      const jwksUrl = resolveJwksUrl();
      if (!jwksUrl) {
        return { ok: false, reason: "verification_unavailable" };
      }
      ({ payload } = await jwtVerify(token, getRemoteJwks(jwksUrl), {
        algorithms: [alg],
        audience: SUPABASE_USER_AUDIENCE,
        clockTolerance: 5,
      }));
    } else {
      // Unsupported or absent alg — includes "none". Refuse.
      return { ok: false, reason: "invalid_token" };
    }

    const sub = payload.sub;
    if (typeof sub !== "string" || !UUID_RE.test(sub)) {
      return { ok: false, reason: "invalid_token" };
    }
    return { ok: true, userId: sub };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      return { ok: false, reason: "expired_token" };
    }
    // JWKS fetch failures land here too (JWKSNoMatchingKey, timeout, DNS).
    // Refusing as invalid_token keeps the fail-closed posture; a persistent
    // JWKS outage surfaces as elevated user_jwt.refused telemetry.
    return { ok: false, reason: "invalid_token" };
  }
}
