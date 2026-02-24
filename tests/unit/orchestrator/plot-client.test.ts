import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PLoTError, PLoTTimeoutError } from "../../../src/orchestrator/plot-client.js";

describe("PLoT Error Types", () => {
  describe("PLoTError", () => {
    it("creates error with correct properties", () => {
      const error = new PLoTError("test message", 500, "run", 1234, "req-1");
      expect(error.name).toBe("PLoTError");
      expect(error.message).toBe("test message");
      expect(error.status).toBe(500);
      expect(error.operation).toBe("run");
      expect(error.elapsedMs).toBe(1234);
      expect(error.requestId).toBe("req-1");
    });

    it("converts to OrchestratorError (5xx = recoverable)", () => {
      const error = new PLoTError("Server error", 502, "run", 1000);
      const orchErr = error.toOrchestratorError();
      expect(orchErr.code).toBe("TOOL_EXECUTION_FAILED");
      expect(orchErr.recoverable).toBe(true);
      expect(orchErr.suggested_retry).toBeDefined();
    });

    it("converts to OrchestratorError (4xx = not recoverable)", () => {
      const error = new PLoTError("Bad request", 400, "run", 1000);
      const orchErr = error.toOrchestratorError();
      expect(orchErr.code).toBe("TOOL_EXECUTION_FAILED");
      expect(orchErr.recoverable).toBe(false);
      expect(orchErr.suggested_retry).toBeUndefined();
    });
  });

  describe("PLoTTimeoutError", () => {
    it("creates error with correct properties", () => {
      const error = new PLoTTimeoutError("timed out", "run", 30000, 30100);
      expect(error.name).toBe("PLoTTimeoutError");
      expect(error.operation).toBe("run");
      expect(error.timeoutMs).toBe(30000);
      expect(error.elapsedMs).toBe(30100);
    });

    it("converts to OrchestratorError (always recoverable)", () => {
      const error = new PLoTTimeoutError("timed out", "validate_patch", 5000, 5100);
      const orchErr = error.toOrchestratorError();
      expect(orchErr.code).toBe("TOOL_EXECUTION_FAILED");
      expect(orchErr.recoverable).toBe(true);
      expect(orchErr.suggested_retry).toBeDefined();
    });
  });
});
