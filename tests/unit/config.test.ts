/**
 * Configuration Module Tests
 *
 * Tests the centralized configuration module with Zod validation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("Configuration Module", () => {
  // Store original env
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear module cache to force re-evaluation
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  describe("Default Configuration", () => {
    it("should load with minimal environment variables", async () => {
      process.env = {
        NODE_ENV: "test",
        LLM_PROVIDER: "fixtures",
      };

      const { config } = await import("../../src/config/index.js");

      expect(config.server.nodeEnv).toBe("test");
      expect(config.server.port).toBe(3000); // default
      expect(config.llm.provider).toBe("fixtures");
      expect(config.features.grounding).toBe(true); // default
    });

    it("should apply sensible defaults for optional values", async () => {
      process.env = {
        NODE_ENV: "development",
      };

      const { config } = await import("../../src/config/index.js");

      // Server defaults
      expect(config.server.port).toBe(3000);
      expect(config.server.logLevel).toBe("info");

      // Feature defaults
      expect(config.features.grounding).toBe(true);
      expect(config.features.critique).toBe(true);
      expect(config.features.clarifier).toBe(true);
      expect(config.features.piiGuard).toBe(false);

      // Performance defaults
      expect(config.performance.metricsEnabled).toBe(true);
      expect(config.performance.slowThresholdMs).toBe(30000);
    });
  });

  describe("Type Coercion", () => {
    it("should coerce numeric string values to numbers", async () => {
      process.env = {
        PORT: "8080",
        GRAPH_MAX_NODES: "150",
        SSE_RESUME_TTL_MS: "7200000",
      };

      const { config } = await import("../../src/config/index.js");

      expect(config.server.port).toBe(8080);
      expect(config.graph.maxNodes).toBe(150);
      expect(config.sse.resumeTtlMs).toBe(7200000);
    });

    it("should coerce boolean string values to booleans", async () => {
      process.env = {
        GROUNDING_ENABLED: "false",
        CRITIQUE_ENABLED: "true",
        PII_GUARD_ENABLED: "1",
        REDIS_TLS: "0",
      };

      const { config } = await import("../../src/config/index.js");

      expect(config.features.grounding).toBe(false);
      expect(config.features.critique).toBe(true);
      expect(config.features.piiGuard).toBe(true);
      expect(config.redis.tls).toBe(false);
    });
  });

  describe("Array Transformation", () => {
    it("should split comma-separated API keys", async () => {
      process.env = {
        ASSIST_API_KEYS: "key1,key2,key3",
      };

      const { config } = await import("../../src/config/index.js");

      expect(config.auth.assistApiKeys).toEqual(["key1", "key2", "key3"]);
    });

    it("should trim whitespace from comma-separated values", async () => {
      process.env = {
        ASSIST_API_KEYS: " key1 , key2 , key3 ",
        LLM_FAILOVER_PROVIDERS: "anthropic, openai",
      };

      const { config } = await import("../../src/config/index.js");

      expect(config.auth.assistApiKeys).toEqual(["key1", "key2", "key3"]);
      expect(config.llm.failoverProviders).toEqual(["anthropic", "openai"]);
    });
  });

  describe("Validation", () => {
    it("should validate port as positive integer", async () => {
      process.env = {
        PORT: "-1",
      };

      await expect(async () => {
        await import("../../src/config/index.js");
      }).rejects.toThrow("Invalid configuration");
    });

    it("should validate LLM provider enum", async () => {
      process.env = {
        LLM_PROVIDER: "invalid-provider",
      };

      await expect(async () => {
        await import("../../src/config/index.js");
      }).rejects.toThrow("Invalid configuration");
    });

    it("should validate URL format for ISL base URL", async () => {
      process.env = {
        ISL_BASE_URL: "not-a-valid-url",
      };

      await expect(async () => {
        await import("../../src/config/index.js");
      }).rejects.toThrow("Invalid configuration");
    });

    it("should accept valid URL for ISL base URL", async () => {
      process.env = {
        ISL_BASE_URL: "https://isl.example.com",
      };

      const { config } = await import("../../src/config/index.js");

      expect(config.isl.baseUrl).toBe("https://isl.example.com");
    });
  });

  describe("Environment Detection", () => {
    it("isProduction() should return true in production", async () => {
      process.env = {
        NODE_ENV: "production",
      };

      const { isProduction, isDevelopment, isTest } = await import("../../src/config/index.js");

      expect(isProduction()).toBe(true);
      expect(isDevelopment()).toBe(false);
      expect(isTest()).toBe(false);
    });

    it("isDevelopment() should return true in development", async () => {
      process.env = {
        NODE_ENV: "development",
      };

      const { isProduction, isDevelopment, isTest } = await import("../../src/config/index.js");

      expect(isProduction()).toBe(false);
      expect(isDevelopment()).toBe(true);
      expect(isTest()).toBe(false);
    });

    it("isTest() should return true when NODE_ENV=test", async () => {
      process.env = {
        NODE_ENV: "test",
      };

      const { isTest } = await import("../../src/config/index.js");

      expect(isTest()).toBe(true);
    });

    it("isTest() should return true when VITEST is set", async () => {
      process.env = {
        NODE_ENV: "development",
        VITEST: "true",
      };

      const { isTest } = await import("../../src/config/index.js");

      expect(isTest()).toBe(true);
    });
  });

  describe("Complete Configuration", () => {
    it("should parse a complete production-like configuration", async () => {
      process.env = {
        // Server
        PORT: "8080",
        NODE_ENV: "production",
        LOG_LEVEL: "warn",
        SERVICE_VERSION: "1.2.3",

        // Auth
        ASSIST_API_KEYS: "prod-key-1,prod-key-2",
        HMAC_SECRET: "secret123",

        // LLM
        LLM_PROVIDER: "anthropic",
        LLM_MODEL: "claude-3-5-sonnet-20241022",
        ANTHROPIC_API_KEY: "sk-ant-123",

        // Features
        GROUNDING_ENABLED: "true",
        CRITIQUE_ENABLED: "true",
        PII_GUARD_ENABLED: "true",

        // Redis
        REDIS_URL: "redis://localhost:6379",
        REDIS_TLS: "false",

        // Performance
        PERF_SLOW_THRESHOLD_MS: "45000",
        PERF_P99_THRESHOLD_MS: "40000",
      };

      const { config } = await import("../../src/config/index.js");

      // Verify key values
      expect(config.server.port).toBe(8080);
      expect(config.server.nodeEnv).toBe("production");
      expect(config.auth.assistApiKeys).toEqual(["prod-key-1", "prod-key-2"]);
      expect(config.llm.provider).toBe("anthropic");
      expect(config.llm.model).toBe("claude-3-5-sonnet-20241022");
      expect(config.features.piiGuard).toBe(true);
      expect(config.redis.url).toBe("redis://localhost:6379");
      expect(config.performance.slowThresholdMs).toBe(45000);
    });
  });

  describe("getConfig()", () => {
    it("should return the same config instance", async () => {
      process.env = {
        NODE_ENV: "test",
      };

      const { config, getConfig } = await import("../../src/config/index.js");

      expect(getConfig()).toBe(config);
    });
  });
});
