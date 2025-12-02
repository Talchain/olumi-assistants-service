/**
 * Shadow Canary Unit Tests (v1.4.0 - PR F)
 *
 * Tests shadow canary infrastructure for safe testing of new providers/prompts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getShadowCanaryConfig,
  shouldShadow,
  executeShadow,
  createShadowWrapper,
} from "../../src/utils/shadow-canary.js";

describe("Shadow Canary (v1.4.0)", () => {
  beforeEach(() => {
    // Clear environment variables
    delete process.env.SHADOW_CANARY_ENABLED;
    delete process.env.SHADOW_CANARY_SAMPLE_RATE;
    delete process.env.SHADOW_CANARY_TIMEOUT_MS;
  });

  describe("getShadowCanaryConfig", () => {
    it("returns disabled config by default", () => {
      const config = getShadowCanaryConfig();
      expect(config.enabled).toBe(false);
      expect(config.sampleRate).toBe(0.0);
      expect(config.timeoutMs).toBe(5000);
    });

    it("returns enabled config when env vars set", () => {
      process.env.SHADOW_CANARY_ENABLED = "true";
      process.env.SHADOW_CANARY_SAMPLE_RATE = "0.1";
      process.env.SHADOW_CANARY_TIMEOUT_MS = "3000";

      const config = getShadowCanaryConfig();
      expect(config.enabled).toBe(true);
      expect(config.sampleRate).toBe(0.1);
      expect(config.timeoutMs).toBe(3000);
    });

    it("clamps sample rate to [0, 1]", () => {
      process.env.SHADOW_CANARY_ENABLED = "true";
      process.env.SHADOW_CANARY_SAMPLE_RATE = "1.5";

      const config = getShadowCanaryConfig();
      expect(config.sampleRate).toBe(1.0);
    });

    it("requires both enabled flag and sample rate > 0", () => {
      process.env.SHADOW_CANARY_ENABLED = "true";
      process.env.SHADOW_CANARY_SAMPLE_RATE = "0";

      const config = getShadowCanaryConfig();
      expect(config.enabled).toBe(false);
    });
  });

  describe("shouldShadow", () => {
    it("returns false when disabled", () => {
      const config = { enabled: false, sampleRate: 1.0, timeoutMs: 5000 };
      expect(shouldShadow(config)).toBe(false);
    });

    it("returns false when sample rate is 0", () => {
      const config = { enabled: true, sampleRate: 0.0, timeoutMs: 5000 };
      expect(shouldShadow(config)).toBe(false);
    });

    it("returns true when sample rate is 1.0", () => {
      const config = { enabled: true, sampleRate: 1.0, timeoutMs: 5000 };
      expect(shouldShadow(config)).toBe(true);
    });

    it("uses probabilistic sampling for 0 < rate < 1", () => {
      const config = { enabled: true, sampleRate: 0.5, timeoutMs: 5000 };

      // Run multiple times to test probability
      const results = Array.from({ length: 100 }, () => shouldShadow(config));
      const trueCount = results.filter(Boolean).length;

      // Should be roughly 50% (allow for variance)
      expect(trueCount).toBeGreaterThan(30);
      expect(trueCount).toBeLessThan(70);
    });
  });

  describe("executeShadow", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("does not execute shadow when sampling returns false", async () => {
      const config = { enabled: false, sampleRate: 0.0, timeoutMs: 5000 };
      const shadowFn = vi.fn().mockResolvedValue({ result: "shadow" });

      await executeShadow(
        { result: "primary" },
        shadowFn,
        config,
        { requestId: "test-123", operation: "test" }
      );

      // Should not call shadow function
      expect(shadowFn).not.toHaveBeenCalled();
    });

    it("executes shadow asynchronously when enabled", async () => {
      const config = { enabled: true, sampleRate: 1.0, timeoutMs: 5000 };
      const shadowFn = vi.fn().mockResolvedValue({ result: "shadow" });

      await executeShadow(
        { result: "primary" },
        shadowFn,
        config,
        { requestId: "test-123", operation: "test" }
      );

      // executeShadow returns immediately (async void)
      // Shadow function should be called asynchronously
      await vi.runAllTimersAsync();
      expect(shadowFn).toHaveBeenCalled();
    });

    it("handles shadow function errors gracefully", async () => {
      const config = { enabled: true, sampleRate: 1.0, timeoutMs: 5000 };
      const shadowFn = vi.fn().mockRejectedValue(new Error("Shadow failed"));

      // Should not throw
      await expect(
        executeShadow(
          { result: "primary" },
          shadowFn,
          config,
          { requestId: "test-123", operation: "test" }
        )
      ).resolves.toBeUndefined();

      await vi.runAllTimersAsync();
    });

    it("times out long-running shadow functions", async () => {
      const config = { enabled: true, sampleRate: 1.0, timeoutMs: 100 };
      const shadowFn = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200))
      );

      await executeShadow(
        { result: "primary" },
        shadowFn,
        config,
        { requestId: "test-123", operation: "test" }
      );

      // Advance timers to trigger timeout
      await vi.advanceTimersByTimeAsync(150);
      await vi.runAllTimersAsync();

      expect(shadowFn).toHaveBeenCalled();
    });
  });

  describe("createShadowWrapper", () => {
    it("returns primary result", async () => {
      const primaryFn = vi.fn().mockResolvedValue({ result: "primary" });
      const shadowFn = vi.fn().mockResolvedValue({ result: "shadow" });

      const wrapped = createShadowWrapper(primaryFn, shadowFn, "test");
      const result = await wrapped({ input: "test" }, "req-123");

      expect(result).toEqual({ result: "primary" });
      expect(primaryFn).toHaveBeenCalledWith({ input: "test" });
    });

    it("does not call shadow when disabled", async () => {
      process.env.SHADOW_CANARY_ENABLED = "false";

      const primaryFn = vi.fn().mockResolvedValue({ result: "primary" });
      const shadowFn = vi.fn().mockResolvedValue({ result: "shadow" });

      const wrapped = createShadowWrapper(primaryFn, shadowFn, "test");
      await wrapped({ input: "test" }, "req-123");

      expect(primaryFn).toHaveBeenCalled();
      expect(shadowFn).not.toHaveBeenCalled();
    });

    it("calls shadow asynchronously when enabled", async () => {
      vi.useFakeTimers();
      process.env.SHADOW_CANARY_ENABLED = "true";
      process.env.SHADOW_CANARY_SAMPLE_RATE = "1.0";

      const primaryFn = vi.fn().mockResolvedValue({ result: "primary" });
      const shadowFn = vi.fn().mockResolvedValue({ result: "shadow" });

      const wrapped = createShadowWrapper(primaryFn, shadowFn, "test");
      await wrapped({ input: "test" }, "req-123");

      expect(primaryFn).toHaveBeenCalled();

      // Shadow called asynchronously
      await vi.runAllTimersAsync();
      expect(shadowFn).toHaveBeenCalledWith({ input: "test" });

      vi.restoreAllMocks();
    });

    it("returns primary result even if shadow fails", async () => {
      vi.useFakeTimers();
      process.env.SHADOW_CANARY_ENABLED = "true";
      process.env.SHADOW_CANARY_SAMPLE_RATE = "1.0";

      const primaryFn = vi.fn().mockResolvedValue({ result: "primary" });
      const shadowFn = vi.fn().mockRejectedValue(new Error("Shadow failed"));

      const wrapped = createShadowWrapper(primaryFn, shadowFn, "test");
      const result = await wrapped({ input: "test" }, "req-123");

      expect(result).toEqual({ result: "primary" });

      await vi.runAllTimersAsync();
      vi.restoreAllMocks();
    });
  });
});
