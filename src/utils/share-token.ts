/**
 * Share Token Generation (v1.5.0 - PR I)
 *
 * Creates signed, time-limited tokens for sharing decision graphs:
 * - HMAC-SHA256 signing for integrity
 * - Configurable expiration (default 7 days)
 * - Token revocation support
 * - URL-safe base64 encoding
 */

import { createHmac, randomBytes } from "node:crypto";
import { env } from "node:process";

// Token expiration duration in milliseconds (default 7 days)
const DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// Secret key for HMAC signing (should be set in production)
function getSecretKey(): string {
  const secret = env.SHARE_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SHARE_TOKEN_SECRET must be set and at least 32 characters");
  }
  return secret;
}

/**
 * Share token payload
 */
export interface SharePayload {
  /** Unique identifier for this share */
  share_id: string;
  /** Graph ID being shared */
  graph_id?: string;
  /** Expiration timestamp (Unix milliseconds) */
  expires_at: number;
  /** Creation timestamp (Unix milliseconds) */
  created_at: number;
}

/**
 * Generate a signed share token
 *
 * @param graphId Optional graph ID to embed in token
 * @param expiryMs Expiration duration in milliseconds
 * @returns URL-safe share token
 */
export function generateShareToken(
  graphId?: string,
  expiryMs: number = DEFAULT_EXPIRY_MS
): { token: string; payload: SharePayload } {
  const now = Date.now();

  const payload: SharePayload = {
    share_id: randomBytes(16).toString("hex"),
    graph_id: graphId,
    expires_at: now + expiryMs,
    created_at: now,
  };

  // Serialize payload
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson).toString("base64url");

  // Sign with HMAC-SHA256
  const secret = getSecretKey();
  const signature = createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64url");

  // Combine: payload.signature
  const token = `${payloadB64}.${signature}`;

  return { token, payload };
}

/**
 * Verify and decode a share token
 *
 * @param token Share token to verify
 * @returns Decoded payload if valid
 * @throws Error if token is invalid, expired, or tampered
 */
export function verifyShareToken(token: string): SharePayload {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new Error("invalid_token: Malformed token structure");
  }

  const [payloadB64, signature] = parts;

  // Verify signature
  const secret = getSecretKey();
  const expectedSignature = createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64url");

  if (signature !== expectedSignature) {
    throw new Error("invalid_token: Signature verification failed");
  }

  // Decode payload
  let payload: SharePayload;
  try {
    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf-8");
    payload = JSON.parse(payloadJson);
  } catch (error) {
    throw new Error("invalid_token: Failed to decode payload");
  }

  // Validate payload structure
  if (
    !payload.share_id ||
    typeof payload.expires_at !== "number" ||
    typeof payload.created_at !== "number"
  ) {
    throw new Error("invalid_token: Invalid payload structure");
  }

  // Check expiration
  if (Date.now() > payload.expires_at) {
    throw new Error("token_expired: Share link has expired");
  }

  return payload;
}

/**
 * Extract share ID from token without full verification
 * Useful for lookups before checking revocation.
 *
 * @param token Share token
 * @returns Share ID or null if malformed
 */
export function extractShareId(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const payloadJson = Buffer.from(parts[0], "base64url").toString("utf-8");
    const payload = JSON.parse(payloadJson);

    return payload.share_id || null;
  } catch {
    return null;
  }
}

/**
 * In-memory revocation store
 * Production should use Redis or database
 */
const revokedShareIds = new Set<string>();

/**
 * Revoke a share by ID
 *
 * @param shareId Share ID to revoke
 */
export function revokeShare(shareId: string): void {
  revokedShareIds.add(shareId);
}

/**
 * Check if a share is revoked
 *
 * @param shareId Share ID to check
 * @returns true if revoked
 */
export function isShareRevoked(shareId: string): boolean {
  return revokedShareIds.has(shareId);
}

/**
 * Clear all revoked shares (for testing)
 */
export function clearRevokedShares(): void {
  revokedShareIds.clear();
}
