/**
 * Centralized Logger Configuration
 *
 * Single source of truth for Pino logger redaction paths.
 * Used by both server.ts (Fastify) and telemetry.ts (standalone Pino).
 *
 * SECURITY: All sensitive fields must be listed here to prevent
 * accidental exposure in logs. Update this file when adding new
 * secret headers or PII fields.
 */

/**
 * Paths to redact from all log output.
 * Uses Pino's path syntax with wildcards.
 */
export const REDACT_PATHS = [
  // Auth secrets (at any depth)
  "*.password",
  "*.secret",
  "*.token",
  "*.apiKey",
  "*.api_key",
  "*.apikey",
  "*.authorization",
  "*.credentials",
  "*.accessToken",
  "*.access_token",
  "*.refreshToken",
  "*.refresh_token",
  "*.privateKey",
  "*.private_key",

  // Common header names - authentication
  "*.headers.authorization",
  "*.headers.x-api-key",
  "*.headers.x-olumi-assist-key",
  "*.headers.x-admin-key",
  "*.headers.x-hmac-signature",
  "*.headers.x-share-token",
  "*.headers.cookie",
  // HMAC auth headers (timing attack vectors if exposed)
  "*.headers.x-olumi-signature",
  "*.headers.x-olumi-nonce",
  "*.headers.x-olumi-timestamp",

  // PII fields
  "*.email",
  "*.phone",
  "*.ssn",
  "*.creditCard",
  "*.credit_card",
] as const;

/**
 * Redaction censor string
 */
export const REDACT_CENSOR = "[REDACTED]";

/**
 * Create a Pino-compatible redact configuration
 */
export function createRedactConfig() {
  return {
    paths: [...REDACT_PATHS],
    censor: REDACT_CENSOR,
  };
}

/**
 * Create full Pino logger options
 */
export function createLoggerConfig(level: string) {
  return {
    level,
    redact: createRedactConfig(),
  };
}
