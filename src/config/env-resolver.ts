/**
 * Environment Resolver
 *
 * Single source of truth for runtime environment detection.
 * Used for security policy enforcement (raw IO, dev escape hatches, config validation).
 */

export type RuntimeEnv = "local" | "test" | "staging" | "prod";

/**
 * Get the runtime environment.
 *
 * @returns One of: "local", "test", "staging", "prod"
 *
 * Resolution order (highest priority first):
 * 1. **OLUMI_ENV** - Explicit override
 *    - Valid values: "local", "test", "staging", "prod" (case-insensitive, trimmed)
 *    - Use this to override auto-detection in any environment
 *
 * 2. **RENDER_SERVICE_NAME** - Render.com deployment detection
 *    - Contains "staging" (case-insensitive) → "staging"
 *    - Set but doesn't contain "staging" → "prod"
 *    - Assumed naming: "olumi-assistants-staging", "olumi-assistants-production"
 *
 * 3. **NODE_ENV** - Standard Node.js fallback
 *    - "test" → "test"
 *    - "production" → "prod"
 *    - "development" or other → "local"
 *
 * 4. **Default**: "local" (no env vars set)
 *
 * @example
 * // Render.com production: RENDER_SERVICE_NAME="olumi-assistants-production"
 * getRuntimeEnv(); // → "prod"
 *
 * @example
 * // Local override for testing prod behavior: OLUMI_ENV="prod"
 * getRuntimeEnv(); // → "prod"
 */
export function getRuntimeEnv(): RuntimeEnv {
  // Use process.env directly for testability (allows runtime changes)
  const env = process.env;

  // 1. Explicit override takes precedence
  const olumiEnv = env.OLUMI_ENV?.toLowerCase().trim();
  if (olumiEnv === "local" || olumiEnv === "test" || olumiEnv === "staging" || olumiEnv === "prod") {
    return olumiEnv;
  }

  // 2. Derive from Render service name (staging vs prod)
  const renderServiceName = env.RENDER_SERVICE_NAME;
  if (renderServiceName) {
    // If service name contains "staging", it's staging; otherwise it's prod
    if (renderServiceName.toLowerCase().includes("staging")) {
      return "staging";
    }
    return "prod";
  }

  // 3. Fallback to NODE_ENV
  const nodeEnv = env.NODE_ENV?.toLowerCase().trim();
  if (nodeEnv === "test") {
    return "test";
  }
  if (nodeEnv === "production") {
    return "prod";
  }

  // Default to local for development
  return "local";
}

/**
 * Check if running in production environment
 */
export function isProduction(): boolean {
  return getRuntimeEnv() === "prod";
}

/**
 * Check if running in staging environment
 */
export function isStaging(): boolean {
  return getRuntimeEnv() === "staging";
}

/**
 * Check if running in test environment
 */
export function isTest(): boolean {
  return getRuntimeEnv() === "test";
}

/**
 * Check if running in local development environment
 */
export function isLocal(): boolean {
  return getRuntimeEnv() === "local";
}
