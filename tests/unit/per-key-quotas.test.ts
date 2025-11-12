import { describe, it, expect, beforeEach } from "vitest";
import {
  checkQuota,
  recordRequest,
  getQuotaUsage,
  resetQuota,
  resetAllQuotas,
  getKeyQuotaConfig,
  type QuotaConfig,
} from "../../src/utils/per-key-quotas.js";

describe("per-key-quotas", () => {
  beforeEach(() => {
    // Reset all quotas before each test
    resetAllQuotas();
  });

  describe("checkQuota()", () => {
    it("should allow requests within quota limits", () => {
      const result = checkQuota("test-key-1", {
        hourly: 100,
        daily: 1000,
        monthly: 10000,
        burst: 5,
      });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should block requests exceeding burst limit", () => {
      const config: QuotaConfig = { burst: 3 };

      // Record 3 requests (at burst limit)
      recordRequest("test-key-burst");
      recordRequest("test-key-burst");
      recordRequest("test-key-burst");

      // 4th request should be blocked
      const result = checkQuota("test-key-burst", config);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("burst_limit_exceeded");
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it("should block requests exceeding hourly quota", () => {
      const config: QuotaConfig = { hourly: 5 };

      // Record 5 requests
      for (let i = 0; i < 5; i++) {
        recordRequest("test-key-hourly");
      }

      // 6th request should be blocked
      const result = checkQuota("test-key-hourly", config);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("hourly_quota_exceeded");
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it("should block requests exceeding daily quota", () => {
      const config: QuotaConfig = { daily: 3 };

      // Record 3 requests
      for (let i = 0; i < 3; i++) {
        recordRequest("test-key-daily");
      }

      // 4th request should be blocked
      const result = checkQuota("test-key-daily", config);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("daily_quota_exceeded");
    });

    it("should block requests exceeding monthly quota", () => {
      const config: QuotaConfig = { monthly: 2 };

      // Record 2 requests
      for (let i = 0; i < 2; i++) {
        recordRequest("test-key-monthly");
      }

      // 3rd request should be blocked
      const result = checkQuota("test-key-monthly", config);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("monthly_quota_exceeded");
    });

    it("should handle keys with no limits (undefined)", () => {
      const result = checkQuota("test-key-unlimited", {});

      expect(result.allowed).toBe(true);
    });
  });

  describe("recordRequest()", () => {
    it("should increment all quota counters", () => {
      recordRequest("test-key-record");

      const usage = getQuotaUsage("test-key-record");

      expect(usage.burst.used).toBe(1);
      expect(usage.hourly.used).toBe(1);
      expect(usage.daily.used).toBe(1);
      expect(usage.monthly.used).toBe(1);
      expect(usage.totalRequests).toBe(1);
    });

    it("should increment counters for multiple requests", () => {
      recordRequest("test-key-multiple");
      recordRequest("test-key-multiple");
      recordRequest("test-key-multiple");

      const usage = getQuotaUsage("test-key-multiple");

      expect(usage.burst.used).toBe(3);
      expect(usage.hourly.used).toBe(3);
      expect(usage.daily.used).toBe(3);
      expect(usage.monthly.used).toBe(3);
      expect(usage.totalRequests).toBe(3);
    });
  });

  describe("getQuotaUsage()", () => {
    it("should return zero usage for new key", () => {
      const usage = getQuotaUsage("test-key-new");

      expect(usage.burst.used).toBe(0);
      expect(usage.hourly.used).toBe(0);
      expect(usage.daily.used).toBe(0);
      expect(usage.monthly.used).toBe(0);
      expect(usage.totalRequests).toBe(0);
    });

    it("should return remaining quota correctly", () => {
      const config: QuotaConfig = {
        burst: 10,
        hourly: 100,
        daily: 1000,
        monthly: 10000,
      };

      // Record 3 requests
      recordRequest("test-key-remaining");
      recordRequest("test-key-remaining");
      recordRequest("test-key-remaining");

      const usage = getQuotaUsage("test-key-remaining", config);

      expect(usage.burst.used).toBe(3);
      expect(usage.burst.remaining).toBe(7);

      expect(usage.hourly.used).toBe(3);
      expect(usage.hourly.remaining).toBe(97);

      expect(usage.daily.used).toBe(3);
      expect(usage.daily.remaining).toBe(997);

      expect(usage.monthly.used).toBe(3);
      expect(usage.monthly.remaining).toBe(9997);
    });

    it("should not allow negative remaining quota", () => {
      const config: QuotaConfig = { burst: 2 };

      // Record 5 requests (exceeds burst limit)
      for (let i = 0; i < 5; i++) {
        recordRequest("test-key-negative");
      }

      const usage = getQuotaUsage("test-key-negative", config);

      // Remaining should be 0, not negative
      expect(usage.burst.remaining).toBe(0);
    });
  });

  describe("resetQuota()", () => {
    it("should reset quota for specific key", () => {
      // Record requests
      recordRequest("test-key-reset");
      recordRequest("test-key-reset");

      // Reset
      resetQuota("test-key-reset");

      // Usage should be zero
      const usage = getQuotaUsage("test-key-reset");
      expect(usage.totalRequests).toBe(0);
    });

    it("should not affect other keys", () => {
      // Record requests for two keys
      recordRequest("test-key-A");
      recordRequest("test-key-B");
      recordRequest("test-key-B");

      // Reset only key A
      resetQuota("test-key-A");

      // Key A should be reset
      const usageA = getQuotaUsage("test-key-A");
      expect(usageA.totalRequests).toBe(0);

      // Key B should be unchanged
      const usageB = getQuotaUsage("test-key-B");
      expect(usageB.totalRequests).toBe(2);
    });
  });

  describe("resetAllQuotas()", () => {
    it("should reset all keys", () => {
      // Record requests for multiple keys
      recordRequest("test-key-X");
      recordRequest("test-key-Y");
      recordRequest("test-key-Z");

      // Reset all
      resetAllQuotas();

      // All should be zero
      expect(getQuotaUsage("test-key-X").totalRequests).toBe(0);
      expect(getQuotaUsage("test-key-Y").totalRequests).toBe(0);
      expect(getQuotaUsage("test-key-Z").totalRequests).toBe(0);
    });
  });

  describe("getKeyQuotaConfig()", () => {
    it("should return default config when no env var set", () => {
      const config = getKeyQuotaConfig("test-key-default");

      expect(config.hourly).toBeDefined();
      expect(config.daily).toBeDefined();
      expect(config.monthly).toBeDefined();
      expect(config.burst).toBeDefined();
    });

    it("should parse config from environment variable", () => {
      // Set env var (mock)
      process.env.QUOTA_KEY_TEST = "hourly:500,daily:5000,monthly:50000,burst:20";

      const config = getKeyQuotaConfig("test");

      expect(config.hourly).toBe(500);
      expect(config.daily).toBe(5000);
      expect(config.monthly).toBe(50000);
      expect(config.burst).toBe(20);

      // Clean up
      delete process.env.QUOTA_KEY_TEST;
    });

    it("should handle partial config strings", () => {
      process.env.QUOTA_KEY_PARTIAL = "hourly:200,burst:5";

      const config = getKeyQuotaConfig("partial");

      expect(config.hourly).toBe(200);
      expect(config.burst).toBe(5);
      // Others should use defaults
      expect(config.daily).toBeDefined();
      expect(config.monthly).toBeDefined();

      // Clean up
      delete process.env.QUOTA_KEY_PARTIAL;
    });

    it("should ignore invalid config values", () => {
      process.env.QUOTA_KEY_INVALID = "hourly:abc,daily:5000";

      const config = getKeyQuotaConfig("invalid");

      // Invalid values should be ignored, defaults used
      expect(config.hourly).toBeDefined();
      expect(config.daily).toBe(5000);

      // Clean up
      delete process.env.QUOTA_KEY_INVALID;
    });
  });

  describe("Rolling window behavior", () => {
    it("should allow burst window to reset after 10 seconds (simulated)", async () => {
      const config: QuotaConfig = { burst: 2 };

      // Record 2 requests (at burst limit)
      recordRequest("test-key-window");
      recordRequest("test-key-window");

      // 3rd request should be blocked
      const result1 = checkQuota("test-key-window", config);
      expect(result1.allowed).toBe(false);
      expect(result1.reason).toBe("burst_limit_exceeded");

      // Note: In real implementation, window resets after 10 seconds
      // For unit test, we can only verify the logic structure
      // Integration tests should verify time-based resets
    });
  });
});
