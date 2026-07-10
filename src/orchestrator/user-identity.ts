/**
 * Flag-gated user-identity resolution for /orchestrate/v2/turn
 * (CEE_REQUIRE_USER_JWT, default OFF — login 3.4 CEE-half, ships dark).
 *
 * Closes the verified IDOR-class hole from PLATFORM-LOGIN-AUDIT-2026-07-10:
 * CEE executes turns with service-role privileges against a CALLER-SUPPLIED
 * user identity (the `user_id` body extension; the browser `x-user-id`
 * header is proxy-forwarded but read by nothing) — so any allowed-origin
 * browser can act as any user. When the flag is ON, identity is DERIVED
 * from a verified Supabase JWT (`sub`) and client-supplied identity is
 * dead input on browser paths.
 *
 * Two-layer enforcement (see LOGIN-CEE-HALF-SPEC-2026-07-10):
 *
 *   - The CEE browser proxy (/proxy/v5/turn, the only browser-facing turn
 *     surface in this process) refuses turns WITHOUT a JWT-shaped
 *     Authorization header at its own front door when the flag is on —
 *     "this is a browser request" is structural truth there, so no
 *     request-header trust is involved. See proxy-v5-turn.ts.
 *   - This module runs inside the shared /orchestrate/v2/turn pre-flight
 *     and VERIFIES any presented JWT, deriving identity from it.
 *
 * Resolution matrix at this seam:
 *
 *   flag OFF                      → 'off' — legacy behaviour, headers never
 *                                   consulted, zero new telemetry (dormant).
 *   flag ON + valid Supabase JWT  → 'verified' — user_id := token sub;
 *                                   caller-supplied user_id is IGNORED.
 *   flag ON + no JWT              → 'service_legacy' — the caller may keep
 *                                   supplying user_id. Reaching this route
 *                                   without a JWT means the caller passed
 *                                   service auth (assist key / HMAC,
 *                                   enforced by the auth plugin BEFORE the
 *                                   route) or came through the browser
 *                                   proxy — and the proxy has already
 *                                   refused JWT-less turns when the flag is
 *                                   on. So this carve-out is reachable by
 *                                   key-authed service callers (internal
 *                                   harnesses) only, never browser paths.
 *   flag ON + present-but-invalid JWT
 *                                 → 'refused' — a caller that presented a
 *                                   JWT asked to be verified; failing open
 *                                   would let an attacker downgrade to the
 *                                   service carve-out by sending garbage.
 *
 * A Bearer token that is not JWT-shaped (e.g. `Authorization: Bearer
 * <assist key>`, the documented alternative to X-Olumi-Assist-Key) is
 * treated as NO user JWT — service callers using Bearer key auth are not
 * broken by the flip.
 *
 * The refusal envelope is BoundaryErrorSchema-valid (the UI parses every
 * non-OK /orchestrate/v2/turn response as a BoundaryError) and carries the
 * stable `sign_in_required` code — the same honesty pattern as MV001/DR001
 * — so the UI can route it to the sign-in prompt.
 */

import type { FastifyRequest } from "fastify";
import type { BoundaryError } from "@talchain/schemas/boundary";

import { config } from "../config/index.js";
import { emit, log, TelemetryEvents } from "../utils/telemetry.js";
import { looksLikeJwt, verifySupabaseUserJwt } from "../utils/supabase-user-jwt.js";

export type UserIdentityRefusalReason =
  | "missing_token"
  | "invalid_token"
  | "expired_token"
  | "verification_unavailable";

export type UserIdentityResolution =
  | { readonly mode: "off" }
  | { readonly mode: "verified"; readonly userId: string }
  | { readonly mode: "service_legacy" }
  | { readonly mode: "refused"; readonly reason: UserIdentityRefusalReason };

/**
 * Extract a JWT-shaped Bearer token from an Authorization header value.
 * Returns null for absent headers, non-Bearer schemes, and opaque
 * (non-JWT-shaped) tokens such as assist keys.
 */
export function extractJwtCandidate(
  authorizationHeader: string | string[] | undefined,
): string | null {
  const bearer =
    typeof authorizationHeader === "string" && authorizationHeader.startsWith("Bearer ")
      ? authorizationHeader.substring(7).trim()
      : null;
  return bearer !== null && looksLikeJwt(bearer) ? bearer : null;
}

/**
 * Resolve the caller's user identity from the request headers.
 * Reads ONLY the `authorization` header; never logs token contents.
 */
export async function resolveUserIdentity(
  req: FastifyRequest,
  requestId: string,
): Promise<UserIdentityResolution> {
  if (!config.auth.requireUserJwt) {
    return { mode: "off" };
  }

  const jwtCandidate = extractJwtCandidate(req.headers.authorization);

  if (jwtCandidate === null) {
    // No user JWT presented. The browser proxy has already refused
    // JWT-less turns at its front door (flag on), so this caller is a
    // key-authed service caller (internal harness / pre-migration edge
    // function) that the service-auth layer has already vetted.
    emit(TelemetryEvents.UserJwtServiceCallerLegacy, {
      request_id: requestId,
    });
    return { mode: "service_legacy" };
  }

  const result = await verifySupabaseUserJwt(jwtCandidate);
  if (!result.ok) {
    if (result.reason === "verification_unavailable") {
      // Operator misconfiguration: flag on without verification material.
      // Fail closed and say so loudly (reason code only — no secrets).
      log.error(
        { request_id: requestId },
        "CEE_REQUIRE_USER_JWT is on but no verification material is configured " +
          "(SUPABASE_JWT_SECRET / SUPABASE_JWKS_URL / SUPABASE_URL) — refusing turn",
      );
    }
    emit(TelemetryEvents.UserJwtRefused, {
      request_id: requestId,
      reason: result.reason,
    });
    return { mode: "refused", reason: result.reason };
  }

  emit(TelemetryEvents.UserJwtVerified, {
    request_id: requestId,
  });
  return { mode: "verified", userId: result.userId };
}

/**
 * Typed recoverable refusal for unauthenticated turns (401 body).
 *
 * BoundaryErrorSchema-valid. The stable UI mapping key is
 * `details.code === 'sign_in_required'` (+ `details.recoverable: true`);
 * `details.auth_reason` carries the refusal cause for observability and
 * lets the UI distinguish "session expired — refresh/re-login" from
 * "never signed in". `retryable: false` — retrying the same request
 * unchanged cannot succeed; recovery is signing in.
 *
 * Emitted from two sites, same bytes: the browser proxy (missing_token)
 * and the /orchestrate/v2/turn pre-flight (invalid/expired/unavailable).
 */
export function buildSignInRequiredError(
  reason: UserIdentityRefusalReason,
  requestId: string,
): BoundaryError {
  return {
    error: "INGRESS_CONTRACT_VIOLATION",
    boundary: "B1",
    direction: "ingress",
    validator: "user_jwt",
    details: {
      reason: "sign_in_required",
      code: "sign_in_required",
      recoverable: true,
      auth_reason: reason,
    },
    request_id: requestId,
    retryable: false,
  };
}
