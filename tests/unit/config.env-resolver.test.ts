/**
 * Environment Resolver Tests (Stream F)
 *
 * Tests the getRuntimeEnv() function for all environment detection paths.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRuntimeEnv, isProduction, isStaging, isTest, isLocal } from "../../src/config/env-resolver.js";

describe("Environment Resolver", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    // Clear environment variables that affect getRuntimeEnv()
    delete process.env.OLUMI_ENV;
    delete process.env.RENDER_SERVICE_NAME;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe("getRuntimeEnv()", () => {
    it("returns 'prod' when OLUMI_ENV=prod", () => {
      process.env.OLUMI_ENV = "prod";
      expect(getRuntimeEnv()).toBe("prod");
    });

    it("returns 'staging' when OLUMI_ENV=staging", () => {
      process.env.OLUMI_ENV = "staging";
      expect(getRuntimeEnv()).toBe("staging");
    });

    it("returns 'test' when OLUMI_ENV=test", () => {
      process.env.OLUMI_ENV = "test";
      expect(getRuntimeEnv()).toBe("test");
    });

    it("returns 'local' when OLUMI_ENV=local", () => {
      process.env.OLUMI_ENV = "local";
      expect(getRuntimeEnv()).toBe("local");
    });

    it("handles case-insensitive OLUMI_ENV values", () => {
      process.env.OLUMI_ENV = "PROD";
      expect(getRuntimeEnv()).toBe("prod");

      process.env.OLUMI_ENV = "Staging";
      expect(getRuntimeEnv()).toBe("staging");
    });

    it("trims whitespace from OLUMI_ENV", () => {
      process.env.OLUMI_ENV = "  prod  ";
      expect(getRuntimeEnv()).toBe("prod");
    });

    it("derives 'staging' from RENDER_SERVICE_NAME containing 'staging'", () => {
      delete process.env.OLUMI_ENV;
      process.env.RENDER_SERVICE_NAME = "olumi-assistants-staging";
      expect(getRuntimeEnv()).toBe("staging");
    });

    it("derives 'prod' from RENDER_SERVICE_NAME without 'staging'", () => {
      delete process.env.OLUMI_ENV;
      process.env.RENDER_SERVICE_NAME = "olumi-assistants-production";
      expect(getRuntimeEnv()).toBe("prod");
    });

    it("derives 'test' from NODE_ENV=test", () => {
      delete process.env.OLUMI_ENV;
      delete process.env.RENDER_SERVICE_NAME;
      process.env.NODE_ENV = "test";
      expect(getRuntimeEnv()).toBe("test");
    });

    it("derives 'prod' from NODE_ENV=production", () => {
      delete process.env.OLUMI_ENV;
      delete process.env.RENDER_SERVICE_NAME;
      process.env.NODE_ENV = "production";
      expect(getRuntimeEnv()).toBe("prod");
    });

    it("defaults to 'local' when no environment variables are set", () => {
      delete process.env.OLUMI_ENV;
      delete process.env.RENDER_SERVICE_NAME;
      delete process.env.NODE_ENV;
      expect(getRuntimeEnv()).toBe("local");
    });

    it("defaults to 'local' for NODE_ENV=development", () => {
      delete process.env.OLUMI_ENV;
      delete process.env.RENDER_SERVICE_NAME;
      process.env.NODE_ENV = "development";
      expect(getRuntimeEnv()).toBe("local");
    });

    it("OLUMI_ENV takes precedence over RENDER_SERVICE_NAME", () => {
      process.env.OLUMI_ENV = "local";
      process.env.RENDER_SERVICE_NAME = "olumi-assistants-production";
      expect(getRuntimeEnv()).toBe("local");
    });

    it("RENDER_SERVICE_NAME takes precedence over NODE_ENV", () => {
      delete process.env.OLUMI_ENV;
      process.env.RENDER_SERVICE_NAME = "olumi-assistants-staging";
      process.env.NODE_ENV = "production";
      expect(getRuntimeEnv()).toBe("staging");
    });
  });

  describe("Helper functions", () => {
    it("isProduction() returns true when env is prod", () => {
      process.env.OLUMI_ENV = "prod";
      expect(isProduction()).toBe(true);
      expect(isStaging()).toBe(false);
      expect(isTest()).toBe(false);
      expect(isLocal()).toBe(false);
    });

    it("isStaging() returns true when env is staging", () => {
      process.env.OLUMI_ENV = "staging";
      expect(isStaging()).toBe(true);
      expect(isProduction()).toBe(false);
      expect(isTest()).toBe(false);
      expect(isLocal()).toBe(false);
    });

    it("isTest() returns true when env is test", () => {
      process.env.OLUMI_ENV = "test";
      expect(isTest()).toBe(true);
      expect(isProduction()).toBe(false);
      expect(isStaging()).toBe(false);
      expect(isLocal()).toBe(false);
    });

    it("isLocal() returns true when env is local", () => {
      process.env.OLUMI_ENV = "local";
      expect(isLocal()).toBe(true);
      expect(isProduction()).toBe(false);
      expect(isStaging()).toBe(false);
      expect(isTest()).toBe(false);
    });
  });
});
