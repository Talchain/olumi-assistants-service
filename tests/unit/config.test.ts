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
      vi.resetModules();
      process.env = {
        PORT: "-1",
      };

      await expect(async () => {
        const { config } = await import("../../src/config/index.js");
        // Access property to trigger validation
        const _port = config.server.port;
      }).rejects.toThrow("Invalid configuration");
    });

    it("should validate LLM provider enum", async () => {
      vi.resetModules();
      process.env = {
        LLM_PROVIDER: "invalid-provider",
      };

      await expect(async () => {
        const { config } = await import("../../src/config/index.js");
        // Access property to trigger validation
        const _provider = config.llm.provider;
      }).rejects.toThrow("Invalid configuration");
    });

    it("should validate URL format for ISL base URL", async () => {
      vi.resetModules();
      process.env = {
        ISL_BASE_URL: "not-a-valid-url",
      };

      await expect(async () => {
        const { config } = await import("../../src/config/index.js");
        // Access property to trigger validation
        const _url = config.isl.baseUrl;
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

  describe("Lazy Initialization", () => {
    it("should defer parsing until first property access", async () => {
      vi.resetModules();

      // Set env vars AFTER import
      const { config, _resetConfigCache } = await import("../../src/config/index.js");

      // Reset cache to simulate fresh import
      _resetConfigCache();

      // Set environment variables (ensure BASE_URL is unset or valid)
      delete process.env.BASE_URL;
      process.env.NODE_ENV = "production";
      process.env.PORT = "4000";

      // First access triggers parsing
      const env = config.server.nodeEnv;

      expect(env).toBe("production");
    });

    it("should cache config after first access", async () => {
      vi.resetModules();
      process.env = {
        NODE_ENV: "test",
        PORT: "5000",
      };

      const { config } = await import("../../src/config/index.js");

      // First access
      const port1 = config.server.port;
      expect(port1).toBe(5000);

      // Change env var (should not affect cached config)
      process.env.PORT = "6000";

      // Second access (should return cached value)
      const port2 = config.server.port;
      expect(port2).toBe(5000); // Still the original value
    });

    it("should support _resetConfigCache() for testing", async () => {
      vi.resetModules();
      process.env = {
        NODE_ENV: "test",
        PORT: "7000",
      };

      const { config, _resetConfigCache } = await import("../../src/config/index.js");

      // First access
      expect(config.server.port).toBe(7000);

      // Change env and reset cache
      process.env.PORT = "8000";
      _resetConfigCache();

      // Should use new value after reset
      expect(config.server.port).toBe(8000);
    });

    it("should work with Object.keys()", async () => {
      vi.resetModules();
      process.env = {
        NODE_ENV: "test",
      };

      const { config } = await import("../../src/config/index.js");

      const keys = Object.keys(config);

      expect(keys).toContain("server");
      expect(keys).toContain("auth");
      expect(keys).toContain("llm");
      expect(keys).toContain("features");
    });

    it("should work with 'in' operator", async () => {
      vi.resetModules();
      process.env = {
        NODE_ENV: "test",
      };

      const { config } = await import("../../src/config/index.js");

      expect("server" in config).toBe(true);
      expect("auth" in config).toBe(true);
      expect("nonexistent" in config).toBe(false);
    });

    it("should work with destructuring", async () => {
      vi.resetModules();
      process.env = {
        NODE_ENV: "development",
        PORT: "9000",
      };

      const { config } = await import("../../src/config/index.js");

      const { server, features } = config;

      expect(server.port).toBe(9000);
      expect(server.nodeEnv).toBe("development");
      expect(features.grounding).toBe(true);
    });

    it("should handle nested property access", async () => {
      vi.resetModules();
      process.env = {
        NODE_ENV: "test",
        GROUNDING_ENABLED: "false",
        RATE_LIMIT_RPM: "200",
      };

      const { config } = await import("../../src/config/index.js");

      // Deep property access
      expect(config.features.grounding).toBe(false);
      expect(config.rateLimits.defaultRpm).toBe(200);
      expect(config.server.nodeEnv).toBe("test");
    });

    it("should parse config only once even with multiple accesses", async () => {
      vi.resetModules();
      process.env = {
        NODE_ENV: "test",
        PORT: "3000",
      };

      const { config } = await import("../../src/config/index.js");

      // Multiple accesses to different properties
      const port = config.server.port;
      const env = config.server.nodeEnv;
      const grounding = config.features.grounding;
      const redis = config.redis.url;

      // All should work correctly
      expect(port).toBe(3000);
      expect(env).toBe("test");
      expect(grounding).toBe(true);
      expect(redis).toBeUndefined();
    });
  });
});
