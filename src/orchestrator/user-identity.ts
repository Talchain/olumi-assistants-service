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
 * Resolution matrix (see LOGIN-CEE-HALF-SPEC-2026-07-10):
 *
 *   flag OFF                      → 'off' — legacy behaviour, headers never
 *                                   consulted, zero new telemetry (dormant).
 *   flag ON + valid Supabase JWT  → 'verified' — user_id := token sub;
 *                                   caller-supplied user_id is IGNORED.
 *   flag ON + no JWT, via the CEE browser proxy (unspoofable marker header,
 *     see src/utils/browser-proxy-source.ts)
 *                                 → 'refused' missing_token — typed
 *                                   recoverable 401 (sign_in_required).
 *   flag ON + no JWT, direct caller
 *                                 → 'service_legacy' — key-authed service
 *                                   callers (internal harnesses; the service
 *                                   auth layer has already vetted them) may
 *                                   keep supplying user_id. NEVER available
 *                                   to proxy paths.
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
import {
  BROWSER_PROXY_SOURCE_HEADER,
  BROWSER_PROXY_SOURCE_VALUE,
} from "../utils/browser-proxy-source.js";
import { looksLikeJwt, verifySupabaseUserJwt } from "../utils/supabase-user-jwt.js";

export { BROWSER_PROXY_SOURCE_HEADER, BROWSER_PROXY_SOURCE_VALUE };

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
 * Resolve the caller's user identity from the request headers.
 * Reads ONLY `authorization` and the browser-proxy marker header; never
 * logs token contents.
 */
export async function resolveUserIdentity(
  req: FastifyRequest,
  requestId: string,
): Promise<UserIdentityResolution> {
  if (!config.auth.requireUserJwt) {
    return { mode: "off" };
  }

  const viaBrowserProxy =
    req.headers[BROWSER_PROXY_SOURCE_HEADER] === BROWSER_PROXY_SOURCE_VALUE;

  const authHeader = req.headers.authorization;
  const bearer =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.substring(7).trim()
      : null;
  const jwtCandidate = bearer !== null && looksLikeJwt(bearer) ? bearer : null;

  if (jwtCandidate === null) {
    if (viaBrowserProxy) {
      emit(TelemetryEvents.UserJwtRefused, {
        request_id: requestId,
        reason: "missing_token",
        via_browser_proxy: true,
      });
      return { mode: "refused", reason: "missing_token" };
    }
    // Direct key-authed service caller (internal harness / pre-migration
    // edge function): the service-auth layer has already vetted the caller.
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
      via_browser_proxy: viaBrowserProxy,
    });
    return { mode: "refused", reason: result.reason };
  }

  emit(TelemetryEvents.UserJwtVerified, {
    request_id: requestId,
    via_browser_proxy: viaBrowserProxy,
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
