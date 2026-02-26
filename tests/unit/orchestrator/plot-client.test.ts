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

    it("maps operation to orchestrator tool name", () => {
      const runErr = new PLoTError("fail", 500, "run", 100);
      expect(runErr.toOrchestratorError().tool).toBe("run_analysis");

      const vpErr = new PLoTError("fail", 500, "validate_patch", 100);
      expect(vpErr.toOrchestratorError().tool).toBe("edit_graph");
    });

    it("falls back to raw operation for unknown operations", () => {
      const err = new PLoTError("fail", 500, "unknown_op", 100);
      expect(err.toOrchestratorError().tool).toBe("unknown_op");
    });

    it("returns orchestratorErrorOverride when set", () => {
      const error = new PLoTError("Server error", 500, "run", 1000);
      const override = {
        code: "TOOL_EXECUTION_FAILED" as const,
        message: "overridden",
        tool: "run_analysis",
        recoverable: false,
      };
      error.orchestratorErrorOverride = override;
      expect(error.toOrchestratorError()).toBe(override);
    });

    it("returns default conversion when orchestratorErrorOverride is not set", () => {
      const error = new PLoTError("Server error", 500, "run", 1000);
      expect(error.orchestratorErrorOverride).toBeUndefined();
      const orchErr = error.toOrchestratorError();
      expect(orchErr.recoverable).toBe(true);
      expect(orchErr.tool).toBe("run_analysis");
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

    it("maps operation to orchestrator tool name", () => {
      const runErr = new PLoTTimeoutError("timed out", "run", 30000, 30100);
      expect(runErr.toOrchestratorError().tool).toBe("run_analysis");

      const vpErr = new PLoTTimeoutError("timed out", "validate_patch", 5000, 5100);
      expect(vpErr.toOrchestratorError().tool).toBe("edit_graph");
    });
  });
});

// ============================================================================
// PLoT Client Integration Tests (using fetch mocking)
// ============================================================================

vi.mock("../../../src/config/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/config/index.js")>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === "plot") {
          return {
            baseUrl: "http://plot-test:3002",
            authToken: "test-token-secret",
          };
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { createPLoTClient } = await import("../../../src/orchestrator/plot-client.js");

describe("PLoTClient", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("auth headers", () => {
    it("attaches Authorization: Bearer header when authToken configured", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ meta: { seed_used: 42, n_samples: 100, response_hash: "h" }, results: [] }),
      });

      const client = createPLoTClient()!;
      expect(client).not.toBeNull();

      await client.run({ graph: {} }, "req-1");

      const [, opts] = fetchSpy.mock.calls[0];
      expect(opts.headers.Authorization).toBe("Bearer test-token-secret");
    });

    it("does not leak auth token in log output", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ meta: { seed_used: 42, n_samples: 100, response_hash: "h" }, results: [] }),
      });

      const client = createPLoTClient()!;
      await client.run({ graph: {} }, "req-1");

      // Auth token should not appear in the request payload or logged URL
      const [url] = fetchSpy.mock.calls[0];
      expect(url).not.toContain("test-token-secret");
    });
  });

  describe("run — V2RunError (422)", () => {
    it("parses 422 V2RunError with status_reason and critiques", async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({
          analysis_status: "blocked",
          status_reason: "Graph has no options defined",
          critiques: [{ message: "At least 2 options are required" }],
        }),
      });

      const client = createPLoTClient()!;

      await expect(client.run({ graph: {} }, "req-1")).rejects.toThrow(PLoTError);

      try {
        await client.run({ graph: {} }, "req-2");
      } catch (e) {
        const err = e as PLoTError;
        expect(err.status).toBe(422);
        expect(err.message).toContain("Graph has no options defined");
        expect(err.message).toContain("At least 2 options are required");
      }
    });

    it("422 V2RunError without critiques uses status_reason only", async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({
          analysis_status: "blocked",
          status_reason: "Insufficient data",
        }),
      });

      const client = createPLoTClient()!;

      try {
        await client.run({ graph: {} }, "req-1");
      } catch (e) {
        const err = e as PLoTError;
        expect(err.message).toContain("Insufficient data");
        expect(err.message).not.toContain("undefined");
      }
    });
  });

  describe("run — error.v1 envelope (5xx)", () => {
    it("parses error.v1 envelope from 500 response", async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({
          schema: "error.v1",
          code: "INTERNAL_ERROR",
          message: "Monte Carlo engine crashed",
          retryable: true,
          source: "plot",
        }),
      });

      const client = createPLoTClient()!;

      try {
        await client.run({ graph: {} }, "req-1");
      } catch (e) {
        const err = e as PLoTError;
        expect(err.status).toBe(500);
        expect(err.message).toContain("Monte Carlo engine crashed");
      }
    });

    it("handles malformed response body gracefully", async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("invalid json")),
      });

      const client = createPLoTClient()!;

      try {
        await client.run({ graph: {} }, "req-1");
      } catch (e) {
        const err = e as PLoTError;
        expect(err.status).toBe(500);
        // Should fallback to generic message
        expect(err.message).toContain("500");
      }
    });
  });

  describe("validatePatch — typed results", () => {
    it("returns success result on 2xx", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ verdict: "accepted", applied_graph: {} }),
      });

      const client = createPLoTClient()!;
      const result = await client.validatePatch({ graph: {} }, "req-1");

      expect(result.kind).toBe("success");
      if (result.kind === "success") {
        expect(result.data.verdict).toBe("accepted");
      }
    });

    it("returns rejection on 422", async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({
          status: "rejected",
          code: "CYCLE_DETECTED",
          message: "Cycle between A and B",
          violations: [{ code: "CYCLE", path: "A->B" }],
        }),
      });

      const client = createPLoTClient()!;
      const result = await client.validatePatch({ graph: {} }, "req-1");

      expect(result.kind).toBe("rejection");
      if (result.kind === "rejection") {
        expect(result.code).toBe("CYCLE_DETECTED");
        expect(result.message).toBe("Cycle between A and B");
        expect(result.violations).toHaveLength(1);
      }
    });

    it("returns feature_disabled on 501", async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 501,
        json: () => Promise.resolve({ status: "rejected", code: "FEATURE_DISABLED" }),
      });

      const client = createPLoTClient()!;
      const result = await client.validatePatch({ graph: {} }, "req-1");

      expect(result.kind).toBe("feature_disabled");
    });

    it("throws PLoTError on 500 server error", async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      const client = createPLoTClient()!;

      await expect(client.validatePatch({ graph: {} }, "req-1")).rejects.toThrow(PLoTError);
    });
  });
});
