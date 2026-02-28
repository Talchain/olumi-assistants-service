/**
 * Tests for PLoT client retry logic (H.4) and outbound structural validation (H.5).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PLoTError, PLoTTimeoutError } from "../../../src/orchestrator/plot-client.js";

// ============================================================================
// Mocks
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

const { createPLoTClient, _validateRunPayload, _validatePatchPayload, _isRetryableError, _cancellableSleep } =
  await import("../../../src/orchestrator/plot-client.js");

// ============================================================================
// H.5: Outbound Structural Validation
// ============================================================================

describe("Outbound Structural Validation (H.5)", () => {
  describe("validateRunPayload", () => {
    it("throws INTERNAL_PAYLOAD_ERROR when graph is missing", () => {
      expect(() =>
        _validateRunPayload({ options: [{ option_id: "a" }], goal_node_id: "g1" }),
      ).toThrow(/graph/);

      try {
        _validateRunPayload({ options: [{ option_id: "a" }], goal_node_id: "g1" });
      } catch (e: any) {
        expect(e.orchestratorError.code).toBe("INTERNAL_PAYLOAD_ERROR");
      }
    });

    it("throws INTERNAL_PAYLOAD_ERROR when graph is null", () => {
      expect(() =>
        _validateRunPayload({ graph: null, options: [{ option_id: "a" }], goal_node_id: "g1" }),
      ).toThrow(/graph/);
    });

    it("throws INTERNAL_PAYLOAD_ERROR when options is missing", () => {
      expect(() =>
        _validateRunPayload({ graph: {}, goal_node_id: "g1" }),
      ).toThrow(/options/);
    });

    it("throws INTERNAL_PAYLOAD_ERROR when options is empty array", () => {
      expect(() =>
        _validateRunPayload({ graph: {}, options: [], goal_node_id: "g1" }),
      ).toThrow(/options/);
    });

    it("throws INTERNAL_PAYLOAD_ERROR when option is missing option_id", () => {
      expect(() =>
        _validateRunPayload({ graph: {}, options: [{ label: "A" }], goal_node_id: "g1" }),
      ).toThrow(/option_id/);
    });

    it("throws INTERNAL_PAYLOAD_ERROR when goal_node_id is missing", () => {
      expect(() =>
        _validateRunPayload({ graph: {}, options: [{ option_id: "a" }] }),
      ).toThrow(/goal_node_id/);
    });

    it("throws INTERNAL_PAYLOAD_ERROR when goal_node_id is empty string", () => {
      expect(() =>
        _validateRunPayload({ graph: {}, options: [{ option_id: "a" }], goal_node_id: "" }),
      ).toThrow(/goal_node_id/);
    });

    it("passes valid payload through without error", () => {
      expect(() =>
        _validateRunPayload({
          graph: { nodes: [], edges: [] },
          options: [{ option_id: "opt_1", label: "A", interventions: {} }],
          goal_node_id: "goal_1",
        }),
      ).not.toThrow();
    });

    it("passes through extra unexpected fields (no false positives)", () => {
      expect(() =>
        _validateRunPayload({
          graph: { nodes: [], edges: [] },
          options: [{ option_id: "opt_1", label: "A" }],
          goal_node_id: "goal_1",
          extra_field: "unexpected",
          n_samples: 1000,
        }),
      ).not.toThrow();
    });
  });

  describe("validatePatchPayload", () => {
    it("throws INTERNAL_PAYLOAD_ERROR when graph is missing", () => {
      expect(() =>
        _validatePatchPayload({ operations: [{ op: "add_node" }] }),
      ).toThrow(/graph/);
    });

    it("throws INTERNAL_PAYLOAD_ERROR when operations is empty array", () => {
      expect(() =>
        _validatePatchPayload({ graph: {}, operations: [] }),
      ).toThrow(/operations/);
    });

    it("throws INTERNAL_PAYLOAD_ERROR when operations is missing", () => {
      expect(() =>
        _validatePatchPayload({ graph: {} }),
      ).toThrow(/operations/);
    });

    it("passes valid payload through without error", () => {
      expect(() =>
        _validatePatchPayload({
          graph: { nodes: [], edges: [] },
          operations: [{ op: "add_node", path: "x" }],
        }),
      ).not.toThrow();
    });

    it("passes through extra unexpected fields", () => {
      expect(() =>
        _validatePatchPayload({
          graph: { nodes: [], edges: [] },
          operations: [{ op: "add_node", path: "x" }],
          scenario_id: "s1",
          base_graph_hash: "abc123",
        }),
      ).not.toThrow();
    });
  });

  describe("outbound validation prevents HTTP call", () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("run: missing graph → INTERNAL_PAYLOAD_ERROR before HTTP call", async () => {
      const client = createPLoTClient()!;

      await expect(
        client.run({ options: [{ option_id: "a" }], goal_node_id: "g1" }, "req-1"),
      ).rejects.toThrow(/graph/);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("validatePatch: empty operations → INTERNAL_PAYLOAD_ERROR before HTTP call", async () => {
      const client = createPLoTClient()!;

      await expect(
        client.validatePatch({ graph: {}, operations: [] }, "req-1"),
      ).rejects.toThrow(/operations/);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("run: valid payload → HTTP call made normally", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ meta: { seed_used: 42, n_samples: 100, response_hash: "h" }, results: [] }),
      });

      const client = createPLoTClient()!;
      await client.run(
        { graph: { nodes: [], edges: [] }, options: [{ option_id: "a" }], goal_node_id: "g1" },
        "req-1",
      );

      expect(fetchSpy).toHaveBeenCalledOnce();
    });
  });
});

// ============================================================================
// H.4: Retry Logic
// ============================================================================

describe("PLoT Client Retry Logic (H.4)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("isRetryableError", () => {
    it("returns true for PLoTError with 5xx status", () => {
      expect(_isRetryableError(new PLoTError("fail", 503, "run", 100))).toBe(true);
      expect(_isRetryableError(new PLoTError("fail", 500, "run", 100))).toBe(true);
    });

    it("returns false for PLoTError with 4xx status", () => {
      expect(_isRetryableError(new PLoTError("fail", 422, "run", 100))).toBe(false);
      expect(_isRetryableError(new PLoTError("fail", 400, "run", 100))).toBe(false);
    });

    it("returns true for PLoTTimeoutError", () => {
      expect(_isRetryableError(new PLoTTimeoutError("timeout", "run", 30000, 30100))).toBe(true);
    });
  });

  describe("cancellableSleep", () => {
    it("completes when no abort signal", async () => {
      const result = await _cancellableSleep(10);
      expect(result).toBe(true);
    });

    it("returns false when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const result = await _cancellableSleep(10, controller.signal);
      expect(result).toBe(false);
    });

    it("returns false when signal aborts during sleep", async () => {
      const controller = new AbortController();
      const promise = _cancellableSleep(5000, controller.signal);
      controller.abort();
      const result = await promise;
      expect(result).toBe(false);
    });
  });

  describe("run — retry on transient 503", () => {
    it("retries once on 503 and succeeds on retry", async () => {
      const successResponse = {
        meta: { seed_used: 42, n_samples: 100, response_hash: "h" },
        results: [],
      };

      fetchSpy
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: () => Promise.resolve({ message: "Service Unavailable" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(successResponse),
        });

      const client = createPLoTClient()!;
      const result = await client.run(
        { graph: {}, options: [{ option_id: "a" }], goal_node_id: "g1" },
        "req-1",
      );

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.meta.seed_used).toBe(42);
    });

    it("fails after retry exhausted on persistent 503", async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ message: "Service Unavailable" }),
      });

      const client = createPLoTClient()!;

      await expect(
        client.run(
          { graph: {}, options: [{ option_id: "a" }], goal_node_id: "g1" },
          "req-1",
        ),
      ).rejects.toThrow(PLoTError);

      // 1 original + 1 retry = 2 calls
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("run — no retry on 422 (client error)", () => {
    it("422 fails immediately without retry", async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ analysis_status: "blocked", status_reason: "Bad input" }),
      });

      const client = createPLoTClient()!;

      await expect(
        client.run(
          { graph: {}, options: [{ option_id: "a" }], goal_node_id: "g1" },
          "req-1",
        ),
      ).rejects.toThrow(PLoTError);

      // Only 1 call — no retry
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("run — budget-aware retry", () => {
    it("skips retry when remaining budget < 2s after backoff", async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ message: "Service Unavailable" }),
      });

      const client = createPLoTClient()!;
      const now = Date.now();

      await expect(
        client.run(
          { graph: {}, options: [{ option_id: "a" }], goal_node_id: "g1" },
          "req-1",
          {
            turnStartedAt: now - 58_000, // 58s elapsed of 60s budget
            turnBudgetMs: 60_000, // 2s remaining — after 2s backoff = 0s left < 2s min
          },
        ),
      ).rejects.toThrow(PLoTError);

      // Only 1 call — retry skipped due to budget
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("run — abort during retry backoff", () => {
    it("abandons retry when turn is aborted during backoff sleep", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ message: "Service Unavailable" }),
      });

      const controller = new AbortController();
      const client = createPLoTClient()!;

      const promise = client.run(
        { graph: {}, options: [{ option_id: "a" }], goal_node_id: "g1" },
        "req-1",
        { turnSignal: controller.signal },
      );

      // Abort during the backoff sleep
      setTimeout(() => controller.abort(), 100);

      await expect(promise).rejects.toThrow(PLoTError);
      // Only 1 fetch call — retry abandoned
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("run — timeout retry with remaining budget", () => {
    it("retries once on PLoT timeout", async () => {
      const controller = new AbortController();

      // First call: abort (simulating timeout)
      fetchSpy
        .mockImplementationOnce(() => {
          return Promise.reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ meta: { seed_used: 42, n_samples: 100, response_hash: "h" }, results: [] }),
        });

      const client = createPLoTClient()!;
      const result = await client.run(
        { graph: {}, options: [{ option_id: "a" }], goal_node_id: "g1" },
        "req-1",
      );

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.meta.seed_used).toBe(42);
    });
  });

  describe("run — idempotency preservation", () => {
    it("retry uses same requestId", async () => {
      fetchSpy
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: () => Promise.resolve({ message: "Service Unavailable" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ meta: { seed_used: 42, n_samples: 100, response_hash: "h" }, results: [] }),
        });

      const client = createPLoTClient()!;
      await client.run(
        { graph: {}, options: [{ option_id: "a" }], goal_node_id: "g1" },
        "req-unique-123",
      );

      // Both calls use the same requestId in headers
      const firstCallHeaders = fetchSpy.mock.calls[0][1].headers;
      const secondCallHeaders = fetchSpy.mock.calls[1][1].headers;
      expect(firstCallHeaders["X-Request-Id"]).toBe("req-unique-123");
      expect(secondCallHeaders["X-Request-Id"]).toBe("req-unique-123");
    });
  });

  describe("validatePatch — retry on transient 500", () => {
    it("retries once on 500 and succeeds on retry", async () => {
      fetchSpy
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Internal Server Error"),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ verdict: "accepted", applied_graph: {} }),
        });

      const client = createPLoTClient()!;
      const result = await client.validatePatch(
        { graph: {}, operations: [{ op: "add_node" }] },
        "req-1",
      );

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.kind).toBe("success");
    });

    it("does NOT retry 422 rejection (deterministic client error)", async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ status: "rejected", code: "CYCLE", message: "Cycle detected" }),
      });

      const client = createPLoTClient()!;
      const result = await client.validatePatch(
        { graph: {}, operations: [{ op: "add_edge" }] },
        "req-1",
      );

      // 422 is not retried — returns structured rejection
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(result.kind).toBe("rejection");
    });
  });
});
