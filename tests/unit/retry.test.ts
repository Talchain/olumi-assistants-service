/**
 * Retry Utility Unit Tests
 *
 * Tests exponential backoff, jitter calculation, error detection,
 * and telemetry emission for LLM retry logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import {
  withRetry,
  isRetryableError,
  calculateBackoffDelay,
  DEFAULT_RETRY_CONFIG,
} from "../../src/utils/retry.js";
import * as telemetry from "../../src/utils/telemetry.js";

describe("Retry Utility", () => {
  describe("isRetryableError", () => {
    it("returns true for 408 timeout", () => {
      const error = { statusCode: 408, message: "Request timeout" };
      expect(isRetryableError(error)).toBe(true);
    });

    it("returns true for 429 rate limit", () => {
      const error = { statusCode: 429, message: "Rate limited" };
      expect(isRetryableError(error)).toBe(true);
    });

    it("returns true for 500 internal server error", () => {
      const error = { statusCode: 500, message: "Internal error" };
      expect(isRetryableError(error)).toBe(true);
    });

    it("returns true for 502 bad gateway", () => {
      const error = { statusCode: 502, message: "Bad gateway" };
      expect(isRetryableError(error)).toBe(true);
    });

    it("returns true for 503 service unavailable", () => {
      const error = { statusCode: 503, message: "Service unavailable" };
      expect(isRetryableError(error)).toBe(true);
    });

    it("returns true for 504 gateway timeout", () => {
      const error = { statusCode: 504, message: "Gateway timeout" };
      expect(isRetryableError(error)).toBe(true);
    });

    it("returns true for timeout error message", () => {
      const error = new Error("Connection timeout");
      expect(isRetryableError(error)).toBe(true);
    });

    it("returns true for rate limit error message", () => {
      const error = new Error("Rate limit exceeded");
      expect(isRetryableError(error)).toBe(true);
    });

    it("returns true for overloaded error message", () => {
      const error = new Error("Server is overloaded");
      expect(isRetryableError(error)).toBe(true);
    });

    it("returns false for 400 bad request", () => {
      const error = { statusCode: 400, message: "Bad request" };
      expect(isRetryableError(error)).toBe(false);
    });

    it("returns false for 401 unauthorized", () => {
      const error = { statusCode: 401, message: "Unauthorized" };
      expect(isRetryableError(error)).toBe(false);
    });

    it("returns false for 403 forbidden", () => {
      const error = { statusCode: 403, message: "Forbidden" };
      expect(isRetryableError(error)).toBe(false);
    });

    it("returns false for 404 not found", () => {
      const error = { statusCode: 404, message: "Not found" };
      expect(isRetryableError(error)).toBe(false);
    });

    it("returns false for non-retryable error message", () => {
      const error = new Error("Invalid input");
      expect(isRetryableError(error)).toBe(false);
    });

    it("returns false for unknown error type", () => {
      const error = { foo: "bar" };
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe("calculateBackoffDelay", () => {
    it("calculates exponential backoff for attempt 1", () => {
      // Attempt 1: 250ms * 2^0 = 250ms
      // With ±20% jitter: 200ms - 300ms
      const delay = calculateBackoffDelay(1, DEFAULT_RETRY_CONFIG);
      expect(delay).toBeGreaterThanOrEqual(200);
      expect(delay).toBeLessThanOrEqual(300);
    });

    it("calculates exponential backoff for attempt 2", () => {
      // Attempt 2: 250ms * 2^1 = 500ms
      // With ±20% jitter: 400ms - 600ms
      const delay = calculateBackoffDelay(2, DEFAULT_RETRY_CONFIG);
      expect(delay).toBeGreaterThanOrEqual(400);
      expect(delay).toBeLessThanOrEqual(600);
    });

    it("calculates exponential backoff for attempt 3", () => {
      // Attempt 3: 250ms * 2^2 = 1000ms
      // With ±20% jitter: 800ms - 1200ms
      const delay = calculateBackoffDelay(3, DEFAULT_RETRY_CONFIG);
      expect(delay).toBeGreaterThanOrEqual(800);
      expect(delay).toBeLessThanOrEqual(1200);
    });

    it("caps delay at maxDelayMs", () => {
      // Attempt 10: 250ms * 2^9 = 128000ms (exceeds 5000ms max)
      // Should be capped at 5000ms ±20% = 4000ms - 6000ms
      const delay = calculateBackoffDelay(10, DEFAULT_RETRY_CONFIG);
      expect(delay).toBeGreaterThanOrEqual(4000);
      expect(delay).toBeLessThanOrEqual(6000);
    });

    it("applies jitter to prevent thundering herd", () => {
      // Run multiple calculations and ensure variance
      const delays = Array.from({ length: 10 }, () =>
        calculateBackoffDelay(1, DEFAULT_RETRY_CONFIG)
      );
      const uniqueDelays = new Set(delays);

      // With jitter, we should get different values (high probability)
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });

    it("respects custom retry config", () => {
      const customConfig = {
        maxAttempts: 5,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        backoffFactor: 3,
        jitterPercent: 10,
      };

      // Attempt 1: 1000ms * 3^0 = 1000ms
      // With ±10% jitter: 900ms - 1100ms
      const delay = calculateBackoffDelay(1, customConfig);
      expect(delay).toBeGreaterThanOrEqual(900);
      expect(delay).toBeLessThanOrEqual(1100);
    });
  });

  describe("withRetry", () => {
    let emitSpy: MockInstance;

    beforeEach(() => {
      emitSpy = vi.spyOn(telemetry, "emit");
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("succeeds on first attempt without retry", async () => {
      const fn = vi.fn().mockResolvedValue("success");

      const promise = withRetry(fn, {
        adapter: "anthropic",
        model: "claude-3-5-sonnet",
        operation: "test",
      });

      // Fast-forward through any pending timers
      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it("retries on retryable error and succeeds", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce({ statusCode: 503, message: "Service unavailable" })
        .mockResolvedValue("success");

      const promise = withRetry(fn, {
        adapter: "anthropic",
        model: "claude-3-5-sonnet",
        operation: "test",
      });

      // Fast-forward through retry delay
      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);

      // Should emit retry event (first attempt failed)
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.LlmRetry,
        expect.objectContaining({
          adapter: "anthropic",
          model: "claude-3-5-sonnet",
          operation: "test",
          attempt: 1,
        })
      );

      // Should emit retry success event (second attempt succeeded)
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.LlmRetrySuccess,
        expect.objectContaining({
          adapter: "anthropic",
          total_attempts: 2, // Total attempts = 2 (1 retry + 1 success)
        })
      );
    });

    it("does not retry on non-retryable error", async () => {
      const fn = vi
        .fn()
        .mockRejectedValue({ statusCode: 400, message: "Bad request" });

      const promise = withRetry(fn, {
        adapter: "anthropic",
        model: "claude-3-5-sonnet",
        operation: "test",
      }).catch((err) => err); // Handle rejection to prevent unhandled promise warning

      await vi.runAllTimersAsync();

      const error = await promise;

      expect(error).toMatchObject({
        statusCode: 400,
        message: "Bad request",
      });

      expect(fn).toHaveBeenCalledTimes(1);
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it("exhausts retries and emits exhausted event", async () => {
      const fn = vi
        .fn()
        .mockRejectedValue({ statusCode: 503, message: "Service unavailable" });

      const promise = withRetry(fn, {
        adapter: "anthropic",
        model: "claude-3-5-sonnet",
        operation: "test",
      }).catch((err) => err); // Handle rejection to prevent unhandled promise warning

      await vi.runAllTimersAsync();

      const error = await promise;

      expect(error).toMatchObject({
        statusCode: 503,
        message: "Service unavailable",
      });

      // Should attempt 3 times (default maxAttempts)
      expect(fn).toHaveBeenCalledTimes(3);

      // Should emit retry events for attempts 1 and 2
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.LlmRetry,
        expect.objectContaining({ attempt: 1 })
      );
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.LlmRetry,
        expect.objectContaining({ attempt: 2 })
      );

      // Should emit exhausted event
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.LlmRetryExhausted,
        expect.objectContaining({
          adapter: "anthropic",
          total_attempts: 3,
        })
      );
    });

    it("respects custom retry config", async () => {
      const fn = vi
        .fn()
        .mockRejectedValue({ statusCode: 503, message: "Service unavailable" });

      const customConfig = {
        maxAttempts: 2,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        backoffFactor: 2,
        jitterPercent: 10,
      };

      const promise = withRetry(
        fn,
        {
          adapter: "anthropic",
          model: "claude-3-5-sonnet",
          operation: "test",
        },
        customConfig
      ).catch((err) => err); // Handle rejection to prevent unhandled promise warning

      await vi.runAllTimersAsync();

      const error = await promise;

      expect(error).toMatchObject({
        statusCode: 503,
      });

      // Should attempt only 2 times (custom maxAttempts)
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("includes delay_ms in telemetry", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce({ statusCode: 503, message: "Service unavailable" })
        .mockResolvedValue("success");

      const promise = withRetry(fn, {
        adapter: "anthropic",
        model: "claude-3-5-sonnet",
        operation: "test",
      });

      await vi.runAllTimersAsync();
      await promise;

      // Check that delay_ms is included in telemetry
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.LlmRetry,
        expect.objectContaining({
          delay_ms: expect.any(Number),
        })
      );
    });

    it("handles errors without statusCode field", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("Connection timeout"))
        .mockResolvedValue("success");

      const promise = withRetry(fn, {
        adapter: "anthropic",
        model: "claude-3-5-sonnet",
        operation: "test",
      });

      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
