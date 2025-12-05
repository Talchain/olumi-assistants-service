/**
 * SSE Resume Token - HMAC-signed tokens for resumable streaming
 *
 * Tokens encode {request_id, step, seq, expires_at} and are signed with HMAC-SHA256
 * to prevent tampering and ensure secure resumption.
 *
 * Environment:
 * - SSE_RESUME_SECRET: HMAC secret for token signing (falls back to HMAC_SECRET)
 * - SSE_RESUME_TTL_MS: Token validity duration (default: 900000 = 15 minutes)
 *
 * Token format: base64url({request_id}:{step}:{seq}:{expires_at}:{signature})
 */

import { hmacSha256, verifyHmacSha256 } from "./hash.js";
import { log } from "./telemetry.js";
import { config } from "../config/index.js";

/**
 * Get SSE resume TTL from centralized config (deferred for testability)
 */
function getResumeTtlMs(): number {
  return config.sse.resumeTtlMs || 900000; // 15 minutes default
}

/**
 * Get resume secret (falls back to HMAC_SECRET for convenience)
 */
function getResumeSecret(): string {
  const secret = config.sse.resumeSecret || config.auth.hmacSecret;
  if (!secret) {
    throw new Error("SSE_RESUME_SECRET or HMAC_SECRET must be configured");
  }
  return secret;
}

/**
 * Resume token payload
 */
export interface ResumeTokenPayload {
  request_id: string;
  step: string; // "DRAFTING" | "COMPLETE" | "ERROR"
  seq: number; // Last sequence number delivered
  expires_at: number; // Unix timestamp (ms)
}

/**
 * Generate HMAC-signed resume token
 */
export function generateResumeToken(payload: ResumeTokenPayload): string {
  const secret = getResumeSecret();

  // Build canonical string
  const canonical = `${payload.request_id}:${payload.step}:${payload.seq}:${payload.expires_at}`;

  // Compute HMAC signature
  const signature = hmacSha256(canonical, secret);

  // Build token: canonical:signature
  const token = `${canonical}:${signature}`;

  // Encode as base64url (URL-safe, no padding)
  const encoded = Buffer.from(token, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  log.debug(
    {
      request_id: payload.request_id,
      step: payload.step,
      seq: payload.seq,
      expires_in_ms: payload.expires_at - Date.now(),
    },
    "Generated SSE resume token"
  );

  return encoded;
}

/**
 * Verify and decode resume token
 */
export function verifyResumeToken(
  token: string
): { valid: true; payload: ResumeTokenPayload } | { valid: false; error: string } {
  try {
    const secret = getResumeSecret();

    // Decode from base64url
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf-8");

    // Parse token: request_id:step:seq:expires_at:signature
    const parts = decoded.split(":");
    if (parts.length !== 5) {
      return { valid: false, error: "INVALID_FORMAT" };
    }

    const [request_id, step, seqStr, expiresAtStr, providedSignature] = parts;

    // Reconstruct canonical string and verify signature
    const canonical = `${request_id}:${step}:${seqStr}:${expiresAtStr}`;

    // Constant-time comparison to prevent timing attacks
    if (!verifyHmacSha256(canonical, providedSignature, secret)) {
      log.warn(
        { request_id, token_prefix: token.substring(0, 12) },
        "SSE resume token signature mismatch"
      );
      return { valid: false, error: "INVALID_SIGNATURE" };
    }

    // Parse payload
    const seq = parseInt(seqStr, 10);
    const expires_at = parseInt(expiresAtStr, 10);

    if (isNaN(seq) || isNaN(expires_at)) {
      return { valid: false, error: "INVALID_FORMAT" };
    }

    // Check expiration
    const now = Date.now();
    if (now > expires_at) {
      log.info(
        {
          request_id,
          expired_ms_ago: now - expires_at,
        },
        "SSE resume token expired"
      );
      return { valid: false, error: "TOKEN_EXPIRED" };
    }

    const payload: ResumeTokenPayload = {
      request_id,
      step,
      seq,
      expires_at,
    };

    // Ensure the token is a canonical encoding of the payload produced by
    // generateResumeToken. This protects against any base64-level tampering
    // that might otherwise decode into a self-consistent but altered
    // canonical/signature pair.
    const expectedToken = generateResumeToken(payload);
    if (expectedToken !== token) {
      log.warn(
        { request_id, token_prefix: token.substring(0, 12) },
        "SSE resume token canonical mismatch",
      );
      return { valid: false, error: "INVALID_SIGNATURE" };
    }
    log.debug(
      {
        request_id,
        step,
        seq,
        expires_in_ms: expires_at - now,
      },
      "Verified SSE resume token"
    );

    return { valid: true, payload };
  } catch (error) {
    log.error({ error, token_prefix: token.substring(0, 12) }, "Failed to verify resume token");
    return { valid: false, error: "DECODE_ERROR" };
  }
}

/**
 * Create resume token for current stream state
 */
export function createResumeToken(
  requestId: string,
  step: string,
  seq: number
): string {
  const expiresAt = Date.now() + getResumeTtlMs();
  return generateResumeToken({
    request_id: requestId,
    step,
    seq,
    expires_at: expiresAt,
  });
}
