export const CEE_BIAS_FINDINGS_MAX = 10;
export const CEE_OPTIONS_MAX = 6;
export const CEE_EVIDENCE_SUGGESTIONS_MAX = 20;
export const CEE_SENSITIVITY_SUGGESTIONS_MAX = 10;

export const CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM = 5;

export function resolveCeeRateLimit(envVarName: string): number {
  // eslint-disable-next-line no-restricted-syntax -- Dynamic env var lookup by name
  const raw = process.env[envVarName];
  if (raw === undefined) {
    return CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM;
  }

  return Math.floor(parsed);
}

/**
 * Unified per-feature rate limiting for CEE endpoints.
 *
 * Uses in-memory token buckets with sliding window.
 *
 * ## Multi-Instance Limitation
 *
 * **IMPORTANT**: This is a per-process in-memory implementation. In multi-instance
 * deployments (e.g., Render with 2+ instances, Kubernetes pods), each instance
 * maintains separate rate limit buckets. This means:
 * - Effective rate limit is approximately `N × RPM` where N = number of instances
 * - Users could bypass limits by hitting different instances
 *
 * For production multi-instance deployments, consider:
 * 1. Using Redis-backed rate limiting via `utils/quota.ts`
 * 2. Implementing distributed rate limiting with Redis INCR + EXPIRE
 * 3. Using a load balancer with sticky sessions (partial mitigation)
 *
 * Usage:
 * ```typescript
 * const limiter = getCeeFeatureRateLimiter("generate_recommendation");
 * const result = limiter.tryConsume(keyId);
 * if (!result.allowed) {
 *   return reply.status(429).send({ ... });
 * }
 * ```
 */

type BucketState = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;

// Global feature buckets map: Map<featureName, Map<keyId, BucketState>>
const featureBuckets = new Map<string, Map<string, BucketState>>();

function pruneBuckets(map: Map<string, BucketState>, now: number): void {
  if (map.size <= MAX_BUCKETS) return;

  // First pass: remove stale buckets
  for (const [key, state] of map) {
    if (now - state.windowStart > MAX_BUCKET_AGE_MS) {
      map.delete(key);
    }
  }

  if (map.size <= MAX_BUCKETS) return;

  // Second pass: remove oldest if still over limit
  let toRemove = map.size - MAX_BUCKETS;
  for (const key of map.keys()) {
    if (toRemove <= 0) break;
    map.delete(key);
    toRemove -= 1;
  }
}

export interface CeeFeatureRateLimiter {
  feature: string;
  rpm: number;
  /**
   * Try to consume a rate limit token for the given key.
   * Returns allowed:true if request should proceed.
   */
  tryConsume(keyId: string): { allowed: boolean; retryAfterSeconds: number };
}

/**
 * Get or create a rate limiter for a CEE feature.
 *
 * @param feature - Feature name (e.g., "generate_recommendation")
 * @param envVarName - Environment variable for RPM config (optional)
 */
export function getCeeFeatureRateLimiter(
  feature: string,
  envVarName?: string
): CeeFeatureRateLimiter {
  const rpm = envVarName
    ? resolveCeeRateLimit(envVarName)
    : CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM;

  // Get or create bucket map for this feature
  if (!featureBuckets.has(feature)) {
    featureBuckets.set(feature, new Map());
  }
  const buckets = featureBuckets.get(feature)!;

  return {
    feature,
    rpm,
    tryConsume(keyId: string): { allowed: boolean; retryAfterSeconds: number } {
      const now = Date.now();
      pruneBuckets(buckets, now);

      let state = buckets.get(keyId);
      if (!state) {
        state = { count: 0, windowStart: now };
        buckets.set(keyId, state);
      }

      // Reset window if expired
      if (now - state.windowStart >= WINDOW_MS) {
        state.count = 0;
        state.windowStart = now;
      }

      // Check limit
      if (state.count >= rpm) {
        const resetAt = state.windowStart + WINDOW_MS;
        const diffMs = Math.max(0, resetAt - now);
        const retryAfterSeconds = Math.max(1, Math.ceil(diffMs / 1000));
        return { allowed: false, retryAfterSeconds };
      }

      // Consume token
      state.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

/**
 * Reset all rate limit buckets for a feature (for testing)
 */
export function resetCeeFeatureRateLimiter(feature: string): void {
  featureBuckets.get(feature)?.clear();
}

/**
 * Reset all rate limit buckets for all features (for testing)
 */
export function resetAllCeeFeatureRateLimiters(): void {
  featureBuckets.clear();
}
