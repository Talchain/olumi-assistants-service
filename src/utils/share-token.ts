/**
 * Share Token Generation & Verification
 *
 * HMAC-SHA256 signed tokens for secure, revocable share URLs
 */

import { randomBytes } from "node:crypto";
import { hmacSha256, verifyHmacSha256 } from "./hash.js";
import { config } from "../config/index.js";

export interface ShareTokenPayload {
  share_id: string;
  created_at: number;
  expires_at: number;
}

/**
 * Get share signing secret from centralized config.
 *
 * SECURITY: Requires dedicated SHARE_SECRET - does NOT fall back to API keys.
 * This prevents coupling authentication secrets to share-token signing.
 */
function getShareSecret(): string {
  const secret = config.auth.shareSecret;
  if (!secret) {
    throw new Error(
      "SHARE_SECRET must be set for share token signing. " +
      "Do not reuse ASSIST_API_KEYS for this purpose."
    );
  }
  return secret;
}

/**
 * Generate cryptographically random share ID
 */
export function generateShareId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Sign share token with HMAC-SHA256
 */
export function signShareToken(payload: ShareTokenPayload): string {
  const secret = getShareSecret();
  const data = JSON.stringify(payload);
  const signature = hmacSha256(data, secret);

  // Format: base64(payload).signature
  const encodedPayload = Buffer.from(data).toString("base64url");
  return `${encodedPayload}.${signature}`;
}

/**
 * Verify and decode share token
 * Returns null if invalid or expired
 */
export function verifyShareToken(token: string): ShareTokenPayload | null {
  try {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) {
      return null;
    }

    // Decode payload
    const data = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const payload = JSON.parse(data) as ShareTokenPayload;

    // Verify signature (constant-time comparison to prevent timing attacks)
    const secret = getShareSecret();
    if (!verifyHmacSha256(data, signature, secret)) {
      return null;
    }

    // Check expiry
    if (Date.now() > payload.expires_at) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Hash share ID for telemetry (privacy)
 */
export function hashShareId(shareId: string): string {
  return hmacSha256(shareId, getShareSecret(), "hex", 16);
}
