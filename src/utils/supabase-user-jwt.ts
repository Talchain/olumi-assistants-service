/**
 * Supabase user-JWT verification — ES256/RS256 via the project JWKS ONLY.
 *
 * Verifies a caller's Supabase ACCESS TOKEN (`Authorization: Bearer <jwt>`)
 * and derives the user identity from its `sub` claim. Consumed by the
 * always-on owner guards on the collaboration-round and decision-record
 * routes, and by the flag-gated identity resolution in
 * src/orchestrator/user-identity.ts.
 *
 * ─── Why there is exactly ONE verification authority ────────────────────
 *
 * This module previously ALSO accepted HS256 tokens signed with the project's
 * legacy shared secret (SUPABASE_JWT_SECRET). That path is retired, and the
 * reason is not tidiness:
 *
 *   A shared HMAC secret is a SYMMETRIC key. Anyone who can read it can MINT
 *   a token for any `sub` they like — the verifier cannot distinguish a token
 *   Supabase issued from one an attacker forged. Holding the secret is
 *   equivalent to holding every user's session.
 *
 * The JWKS path has no such property: the project publishes only PUBLIC keys,
 * so possession of the key set confers no ability to sign. Keeping both would
 * also have left two authorities answering one question ("is this token
 * valid?"), where the weaker one silently decides every token it accepts.
 *
 * Verification material (asymmetric, public):
 *   - env SUPABASE_JWKS_URL, falling back to
 *     `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`.
 *   - The remote key set is cached in-process by jose (createRemoteJWKSet),
 *     which also handles rotation: an unrecognised `kid` triggers a refetch,
 *     rate-limited by jose's own cooldown.
 *
 * Acceptance requires ALL of:
 *   - signature valid under an ASYMMETRIC alg from a fixed allowlist. The
 *     allowlist is a constant — it is never taken from the token's own header,
 *     so a token cannot nominate the algorithm used to check it;
 *   - issuer equals the project's `<supabase-url>/auth/v1`;
 *   - audience contains "authenticated" — Supabase stamps user access tokens
 *     with this. Load-bearing: the project's legacy anon/service_role API keys
 *     are themselves JWTs, but carry no "authenticated" audience and no `sub`;
 *   - not expired (exp enforced, 5 s clock tolerance);
 *   - `sub` is a UUID (Supabase auth.users primary key shape) — the user_id.
 *
 * ─── Failure taxonomy (stable strings; the three are NOT interchangeable) ──
 *   - 'expired_token'            — signature-valid but expired. The UI can
 *                                  refresh the session and retry.
 *   - 'invalid_token'            — something is wrong with the TOKEN: bad
 *                                  signature, wrong issuer/audience, absent or
 *                                  non-UUID sub, retired or unsupported alg,
 *                                  unknown `kid` against a key set we DID
 *                                  fetch, malformed JWS.
 *   - 'verification_unavailable' — something is wrong with US: no JWKS URL
 *                                  configured, or the JWKS endpoint could not
 *                                  be reached / did not answer 200 / did not
 *                                  parse. FAIL CLOSED — never fall back to
 *                                  trusting caller-supplied identity.
 *
 * That last distinction is the point of the taxonomy and must not collapse.
 * Reporting an outage as 'invalid_token' tells a user with a perfectly good
 * session to sign in again, which cannot help; it also hides an infrastructure
 * failure inside a metric that looks like ordinary auth noise.
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

/**
 * Accepted signature algorithms — ASYMMETRIC ONLY, and a fixed constant.
 * Passed verbatim to jose so the token's own `alg` header can never widen it.
 * HS256 is deliberately absent (see the module header).
 */
const ACCEPTED_ALGS = ["ES256", "RS256"] as const;
const ACCEPTED_ALG_SET: ReadonlySet<string> = new Set(ACCEPTED_ALGS);

/** Supabase stamps user access tokens with this audience. */
const SUPABASE_USER_AUDIENCE = "authenticated";

/** Path Supabase publishes its JWKS at, relative to the project URL. */
const JWKS_WELL_KNOWN_PATH = "/auth/v1/.well-known/jwks.json";

/** Supabase's issuer is the project URL plus this suffix. */
const ISSUER_PATH = "/auth/v1";

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

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveJwksUrl(): string | undefined {
  const explicit = config.auth.supabaseJwksUrl;
  if (explicit && explicit.length > 0) return explicit;
  const base = config.auth.supabaseUrl;
  if (base && base.length > 0) {
    return `${stripTrailingSlashes(base)}${JWKS_WELL_KNOWN_PATH}`;
  }
  return undefined;
}

/**
 * The issuer we require on every token.
 *
 * Derived from SUPABASE_URL when set; otherwise recovered from an explicit
 * SUPABASE_JWKS_URL by stripping the well-known suffix (the two are different
 * spellings of the same project). If neither yields an issuer we refuse as
 * 'verification_unavailable' rather than silently skipping the check — an
 * unenforceable claim check must fail loudly, not quietly become a no-op.
 */
function resolveExpectedIssuer(): string | undefined {
  const base = config.auth.supabaseUrl;
  if (base && base.length > 0) {
    return `${stripTrailingSlashes(base)}${ISSUER_PATH}`;
  }
  const jwksUrl = config.auth.supabaseJwksUrl;
  if (jwksUrl && jwksUrl.length > 0) {
    const trimmed = stripTrailingSlashes(jwksUrl);
    if (trimmed.endsWith(JWKS_WELL_KNOWN_PATH)) {
      return `${trimmed.slice(0, -JWKS_WELL_KNOWN_PATH.length)}${ISSUER_PATH}`;
    }
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
 * Map a thrown verification error onto the refusal taxonomy.
 *
 * The classification below is derived from jose 5.x's observed behaviour, not
 * assumed: transport failures surface as PLAIN Node errors (ECONNREFUSED,
 * ENOTFOUND) because jose does not wrap them, while a non-200 or unparseable
 * JWKS response surfaces as a bare JOSEError with code ERR_JOSE_GENERIC. Every
 * token-level fault is a JOSEError SUBCLASS. The specs exercise each of these
 * paths end to end, so a change in the library's error shapes fails loudly
 * here rather than silently re-collapsing the taxonomy.
 */
function classifyVerifyError(err: unknown): SupabaseUserJwtRefusalReason {
  // The one token fault the caller can actually act on.
  if (err instanceof joseErrors.JWTExpired) return "expired_token";

  // Not a jose error at all ⇒ the network/runtime failed, not the token.
  if (!(err instanceof joseErrors.JOSEError)) return "verification_unavailable";

  // JWKS retrieval problems that jose does wrap.
  if (err instanceof joseErrors.JWKSTimeout) return "verification_unavailable";
  if (err instanceof joseErrors.JWKSInvalid) return "verification_unavailable";
  if (err.code === "ERR_JOSE_GENERIC") return "verification_unavailable";

  // Everything else is a statement about the token — including
  // JWKSNoMatchingKey, where the key set WAS fetched and simply does not
  // contain the key the token named.
  return "invalid_token";
}

/**
 * Verify a Supabase user access token and derive the user identity.
 * Never throws; never logs. See module doc for the acceptance contract.
 */
export async function verifySupabaseUserJwt(
  token: string,
): Promise<SupabaseUserJwtResult> {
  // Read the alg from the header purely to refuse retired/unsupported ones
  // WITHOUT a network round trip. The value is never used to select the
  // algorithm jose verifies with — that is the fixed ACCEPTED_ALGS constant.
  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    return { ok: false, reason: "invalid_token" };
  }
  if (alg === undefined || !ACCEPTED_ALG_SET.has(alg)) {
    // Includes HS256 (retired shared secret) and "none".
    return { ok: false, reason: "invalid_token" };
  }

  const jwksUrl = resolveJwksUrl();
  const expectedIssuer = resolveExpectedIssuer();
  if (!jwksUrl || !expectedIssuer) {
    return { ok: false, reason: "verification_unavailable" };
  }

  try {
    const { payload } = await jwtVerify(token, getRemoteJwks(jwksUrl), {
      algorithms: [...ACCEPTED_ALGS],
      issuer: expectedIssuer,
      audience: SUPABASE_USER_AUDIENCE,
      clockTolerance: 5,
    });

    const sub = payload.sub;
    if (typeof sub !== "string" || !UUID_RE.test(sub)) {
      return { ok: false, reason: "invalid_token" };
    }
    return { ok: true, userId: sub };
  } catch (err) {
    return { ok: false, reason: classifyVerifyError(err) };
  }
}
