/**
 * v1.5 PR L: Per-Key Quotas & Rate Limits
 *
 * Extends existing auth plugin with:
 * - Rolling window quotas (hourly/daily/monthly)
 * - Burst protection (short-term spike detection)
 * - Per-key quota configuration
 * - Automatic quota reset on window expiry
 *
 * Complements existing token bucket rate limiting with long-term quota enforcement.
 */

import { env } from "node:process";

export interface QuotaConfig {
  hourly?: number; // Max requests per hour (default: 1000)
  daily?: number; // Max requests per day (default: 10000)
  monthly?: number; // Max requests per month (default: 100000)
  burst?: number; // Max requests in 10 seconds (default: 10)
}

export interface QuotaWindow {
  count: number;
  windowStart: number;
  windowDuration: number; // milliseconds
}

export interface KeyQuotaState {
  keyId: string;
  hourly: QuotaWindow;
  daily: QuotaWindow;
  monthly: QuotaWindow;
  burst: QuotaWindow;
  totalRequests: number;
}

const quotaState = new Map<string, KeyQuotaState>();

// Default quotas (can be overridden per key or via env)
const DEFAULT_QUOTAS: QuotaConfig = {
  hourly: Number(env.QUOTA_HOURLY) || 1000,
  daily: Number(env.QUOTA_DAILY) || 10000,
  monthly: Number(env.QUOTA_MONTHLY) || 100000,
  burst: Number(env.QUOTA_BURST) || 10,
};

/**
 * Get or create quota state for an API key
 */
export function getQuotaState(keyId: string): KeyQuotaState {
  if (!quotaState.has(keyId)) {
    const now = Date.now();
    quotaState.set(keyId, {
      keyId,
      hourly: createWindow(now, 60 * 60 * 1000), // 1 hour
      daily: createWindow(now, 24 * 60 * 60 * 1000), // 24 hours
      monthly: createWindow(now, 30 * 24 * 60 * 60 * 1000), // 30 days
      burst: createWindow(now, 10 * 1000), // 10 seconds
      totalRequests: 0,
    });
  }

  return quotaState.get(keyId)!;
}

/**
 * Create a new quota window
 */
function createWindow(startTime: number, duration: number): QuotaWindow {
  return {
    count: 0,
    windowStart: startTime,
    windowDuration: duration,
  };
}

/**
 * Reset window if expired
 */
function resetWindowIfExpired(window: QuotaWindow, now: number): void {
  if (now - window.windowStart >= window.windowDuration) {
    window.count = 0;
    window.windowStart = now;
  }
}

/**
 * Check if request is allowed under quota limits
 * Returns { allowed: boolean, reason?: string, retryAfter?: number }
 */
export function checkQuota(
  keyId: string,
  config: QuotaConfig = DEFAULT_QUOTAS
): { allowed: boolean; reason?: string; retryAfter?: number } {
  const state = getQuotaState(keyId);
  const now = Date.now();

  // Reset windows if expired
  resetWindowIfExpired(state.hourly, now);
  resetWindowIfExpired(state.daily, now);
  resetWindowIfExpired(state.monthly, now);
  resetWindowIfExpired(state.burst, now);

  // Check burst limit (10 seconds)
  if (config.burst && state.burst.count >= config.burst) {
    const retryAfter = Math.ceil(
      (state.burst.windowStart + state.burst.windowDuration - now) / 1000
    );
    return {
      allowed: false,
      reason: "burst_limit_exceeded",
      retryAfter,
    };
  }

  // Check hourly quota
  if (config.hourly && state.hourly.count >= config.hourly) {
    const retryAfter = Math.ceil(
      (state.hourly.windowStart + state.hourly.windowDuration - now) / 1000
    );
    return {
      allowed: false,
      reason: "hourly_quota_exceeded",
      retryAfter,
    };
  }

  // Check daily quota
  if (config.daily && state.daily.count >= config.daily) {
    const retryAfter = Math.ceil(
      (state.daily.windowStart + state.daily.windowDuration - now) / 1000
    );
    return {
      allowed: false,
      reason: "daily_quota_exceeded",
      retryAfter,
    };
  }

  // Check monthly quota
  if (config.monthly && state.monthly.count >= config.monthly) {
    const retryAfter = Math.ceil(
      (state.monthly.windowStart + state.monthly.windowDuration - now) / 1000
    );
    return {
      allowed: false,
      reason: "monthly_quota_exceeded",
      retryAfter,
    };
  }

  // All checks passed
  return { allowed: true };
}

/**
 * Record a request in all quota windows
 */
export function recordRequest(keyId: string): void {
  const state = getQuotaState(keyId);
  const now = Date.now();

  // Reset windows if expired
  resetWindowIfExpired(state.hourly, now);
  resetWindowIfExpired(state.daily, now);
  resetWindowIfExpired(state.monthly, now);
  resetWindowIfExpired(state.burst, now);

  // Increment counters
  state.burst.count++;
  state.hourly.count++;
  state.daily.count++;
  state.monthly.count++;
  state.totalRequests++;
}

/**
 * Get quota usage for a key
 */
export function getQuotaUsage(
  keyId: string,
  config: QuotaConfig = DEFAULT_QUOTAS
): {
  burst: { used: number; limit: number; remaining: number };
  hourly: { used: number; limit: number; remaining: number };
  daily: { used: number; limit: number; remaining: number };
  monthly: { used: number; limit: number; remaining: number };
  totalRequests: number;
} {
  const state = getQuotaState(keyId);
  const now = Date.now();

  // Reset windows if expired
  resetWindowIfExpired(state.hourly, now);
  resetWindowIfExpired(state.daily, now);
  resetWindowIfExpired(state.monthly, now);
  resetWindowIfExpired(state.burst, now);

  return {
    burst: {
      used: state.burst.count,
      limit: config.burst || DEFAULT_QUOTAS.burst!,
      remaining: Math.max(0, (config.burst || DEFAULT_QUOTAS.burst!) - state.burst.count),
    },
    hourly: {
      used: state.hourly.count,
      limit: config.hourly || DEFAULT_QUOTAS.hourly!,
      remaining: Math.max(0, (config.hourly || DEFAULT_QUOTAS.hourly!) - state.hourly.count),
    },
    daily: {
      used: state.daily.count,
      limit: config.daily || DEFAULT_QUOTAS.daily!,
      remaining: Math.max(0, (config.daily || DEFAULT_QUOTAS.daily!) - state.daily.count),
    },
    monthly: {
      used: state.monthly.count,
      limit: config.monthly || DEFAULT_QUOTAS.monthly!,
      remaining: Math.max(0, (config.monthly || DEFAULT_QUOTAS.monthly!) - state.monthly.count),
    },
    totalRequests: state.totalRequests,
  };
}

/**
 * Reset quota for a specific key (admin function)
 */
export function resetQuota(keyId: string): void {
  quotaState.delete(keyId);
}

/**
 * Reset all quotas (admin function, for testing)
 */
export function resetAllQuotas(): void {
  quotaState.clear();
}

/**
 * Get per-key quota configuration from environment or defaults
 * Format: QUOTA_KEY_<KEY_ID>=hourly:1000,daily:10000,monthly:100000,burst:10
 */
export function getKeyQuotaConfig(keyId: string): QuotaConfig {
  const envKey = `QUOTA_KEY_${keyId.toUpperCase()}`;
  const configStr = env[envKey];

  if (!configStr) {
    return DEFAULT_QUOTAS;
  }

  const config: QuotaConfig = { ...DEFAULT_QUOTAS };

  // Parse config string: "hourly:1000,daily:10000,monthly:100000,burst:10"
  const parts = configStr.split(",");
  for (const part of parts) {
    const [key, value] = part.split(":");
    const num = Number(value);

    if (isNaN(num)) continue;

    switch (key.trim()) {
      case "hourly":
        config.hourly = num;
        break;
      case "daily":
        config.daily = num;
        break;
      case "monthly":
        config.monthly = num;
        break;
      case "burst":
        config.burst = num;
        break;
    }
  }

  return config;
}
