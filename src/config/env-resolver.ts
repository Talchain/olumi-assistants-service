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
  return getRuntimeEnvResolution().env;
}

/**
 * Which input produced the {@link getRuntimeEnv} verdict.
 *
 * This matters because the signals are NOT equally trustworthy for telling
 * the staging deployment apart from the production one:
 *
 * - `olumi_env` / `render_service_name` are DISCRIMINATING. They take
 *   different values on the two Render services, so a "prod" verdict from
 *   either is a positive identification of production.
 * - `node_env` is AMBIGUOUS. Both `render.yaml` (production) and
 *   `render-staging.yaml` (staging) set `NODE_ENV=production`, so a "prod"
 *   verdict derived from NODE_ENV alone means only "not local/test" — it
 *   cannot rule out that this is the staging service with
 *   `RENDER_SERVICE_NAME` missing.
 * - `default` is the no-signal case (local development).
 *
 * Callers that take a DESTRUCTIVE action on a "prod" verdict (e.g. refusing
 * readiness) must require a discriminating source; callers that merely
 * restrict behaviour (e.g. the graph-management live→shadow lockdown) can
 * treat any "prod" verdict as prod, because over-restricting staging is
 * harmless while under-restricting production is not.
 */
export type RuntimeEnvSource =
  | "olumi_env"
  | "render_service_name"
  | "node_env"
  | "default";

export interface RuntimeEnvResolution {
  env: RuntimeEnv;
  source: RuntimeEnvSource;
  /**
   * True when `source` distinguishes the staging deployment from the
   * production one. False for the `node_env` fallback and `default`.
   */
  discriminating: boolean;
}

/**
 * {@link getRuntimeEnv} plus the provenance of the verdict.
 *
 * Additive: `getRuntimeEnv()` delegates here and its behaviour is unchanged
 * (same order, same values, same defaults).
 */
export function getRuntimeEnvResolution(): RuntimeEnvResolution {
  // Use process.env directly for testability (allows runtime changes)
  const env = process.env;

  // 1. Explicit override takes precedence
  const olumiEnv = env.OLUMI_ENV?.toLowerCase().trim();
  if (olumiEnv === "local" || olumiEnv === "test" || olumiEnv === "staging" || olumiEnv === "prod") {
    return { env: olumiEnv, source: "olumi_env", discriminating: true };
  }

  // 2. Derive from Render service name (staging vs prod)
  const renderServiceName = env.RENDER_SERVICE_NAME;
  if (renderServiceName) {
    // If service name contains "staging", it's staging; otherwise it's prod
    if (renderServiceName.toLowerCase().includes("staging")) {
      return { env: "staging", source: "render_service_name", discriminating: true };
    }
    return { env: "prod", source: "render_service_name", discriminating: true };
  }

  // 3. Fallback to NODE_ENV — NOT discriminating on Render (see above).
  const nodeEnv = env.NODE_ENV?.toLowerCase().trim();
  if (nodeEnv === "test") {
    return { env: "test", source: "node_env", discriminating: false };
  }
  if (nodeEnv === "production") {
    return { env: "prod", source: "node_env", discriminating: false };
  }

  // Default to local for development
  return { env: "local", source: "default", discriminating: false };
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
