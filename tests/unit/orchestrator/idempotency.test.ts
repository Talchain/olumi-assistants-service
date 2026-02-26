import { describe, it, expect, beforeEach } from "vitest";
import {
  getIdempotentResponse,
  setIdempotentResponse,
  getInflightRequest,
  registerInflightRequest,
  _clearIdempotencyCache,
  _getIdempotencyCacheSize,
} from "../../../src/orchestrator/idempotency.js";
import type { OrchestratorResponseEnvelope } from "../../../src/orchestrator/types.js";

function makeEnvelope(overrides?: Partial<OrchestratorResponseEnvelope>): OrchestratorResponseEnvelope {
  return {
    turn_id: "test-turn",
    assistant_text: "Hello",
    blocks: [],
    lineage: { context_hash: "abc123" },
    ...overrides,
  };
}

describe("Idempotency Cache", () => {
  beforeEach(() => {
    _clearIdempotencyCache();
  });

  it("returns null for uncached turn", () => {
    const result = getIdempotentResponse("scenario-1", "turn-1");
    expect(result).toBeNull();
  });

  it("returns cached response for successful turn", () => {
    const envelope = makeEnvelope();
    setIdempotentResponse("scenario-1", "turn-1", envelope);

    const result = getIdempotentResponse("scenario-1", "turn-1");
    expect(result).toEqual(envelope);
  });

  it("separates by scenario_id", () => {
    const envelope = makeEnvelope();
    setIdempotentResponse("scenario-1", "turn-1", envelope);

    expect(getIdempotentResponse("scenario-2", "turn-1")).toBeNull();
  });

  it("separates by client_turn_id", () => {
    const envelope = makeEnvelope();
    setIdempotentResponse("scenario-1", "turn-1", envelope);

    expect(getIdempotentResponse("scenario-1", "turn-2")).toBeNull();
  });

  it("does NOT cache INVALID_REQUEST errors", () => {
    const envelope = makeEnvelope({
      error: {
        code: "INVALID_REQUEST",
        message: "Bad request",
        recoverable: false,
      },
    });

    setIdempotentResponse("scenario-1", "turn-1", envelope);
    expect(getIdempotentResponse("scenario-1", "turn-1")).toBeNull();
    expect(_getIdempotencyCacheSize()).toBe(0);
  });

  it("caches permanent errors", () => {
    const envelope = makeEnvelope({
      error: {
        code: "TOOL_EXECUTION_FAILED",
        message: "Failed",
        recoverable: false,
      },
    });

    setIdempotentResponse("scenario-1", "turn-1", envelope);
    expect(getIdempotentResponse("scenario-1", "turn-1")).toEqual(envelope);
  });

  it("caches transient errors (short TTL)", () => {
    const envelope = makeEnvelope({
      error: {
        code: "LLM_TIMEOUT",
        message: "Timeout",
        recoverable: true,
      },
    });

    setIdempotentResponse("scenario-1", "turn-1", envelope);
    // Should be retrievable immediately
    expect(getIdempotentResponse("scenario-1", "turn-1")).toEqual(envelope);
  });

  it("clear removes all entries", () => {
    setIdempotentResponse("s1", "t1", makeEnvelope());
    setIdempotentResponse("s1", "t2", makeEnvelope());
    expect(_getIdempotencyCacheSize()).toBe(2);

    _clearIdempotencyCache();
    expect(_getIdempotencyCacheSize()).toBe(0);
  });
});

// ============================================================================
// Concurrent dedup (in-flight promises)
// ============================================================================

describe("Concurrent idempotency dedup", () => {
  beforeEach(() => {
    _clearIdempotencyCache();
  });

  it("returns null for no inflight request", () => {
    expect(getInflightRequest("s1", "t1")).toBeNull();
  });

  it("returns the registered promise for inflight request", async () => {
    const envelope = makeEnvelope({ turn_id: "inflight-test" });
    const promise = Promise.resolve(envelope);

    registerInflightRequest("s1", "t1", promise);

    const inflight = getInflightRequest("s1", "t1");
    expect(inflight).not.toBeNull();

    const result = await inflight!;
    expect(result.turn_id).toBe("inflight-test");
  });

  it("concurrent calls to same key await the same promise — work runs once", async () => {
    let callCount = 0;
    let resolveWork!: (value: OrchestratorResponseEnvelope) => void;

    const workPromise = new Promise<OrchestratorResponseEnvelope>((resolve) => {
      resolveWork = resolve;
    });

    // Simulate first request doing work
    const doWork = async (): Promise<OrchestratorResponseEnvelope> => {
      callCount++;
      return workPromise;
    };

    // First request registers
    const firstWork = doWork();
    registerInflightRequest("s1", "concurrent-turn", firstWork);

    // Second request finds the inflight promise
    const inflight = getInflightRequest("s1", "concurrent-turn");
    expect(inflight).not.toBeNull();

    // Resolve the work
    const envelope = makeEnvelope({ turn_id: "concurrent-result" });
    resolveWork(envelope);

    // Both get the same result
    const result1 = await firstWork;
    const result2 = await inflight!;

    expect(result1.turn_id).toBe("concurrent-result");
    expect(result2.turn_id).toBe("concurrent-result");

    // Work was only done once
    expect(callCount).toBe(1);
  });

  it("cleans up inflight entry after promise resolves", async () => {
    const envelope = makeEnvelope();
    let resolveWork!: (value: OrchestratorResponseEnvelope) => void;
    const promise = new Promise<OrchestratorResponseEnvelope>((resolve) => {
      resolveWork = resolve;
    });

    registerInflightRequest("s1", "cleanup-turn", promise);
    expect(getInflightRequest("s1", "cleanup-turn")).not.toBeNull();

    resolveWork(envelope);
    await promise;

    // Allow microtask for .finally() to run
    await new Promise((r) => setTimeout(r, 0));

    expect(getInflightRequest("s1", "cleanup-turn")).toBeNull();
  });

  it("_clearIdempotencyCache clears inflight entries too", () => {
    const promise = new Promise<OrchestratorResponseEnvelope>(() => {});
    registerInflightRequest("s1", "t1", promise);

    expect(getInflightRequest("s1", "t1")).not.toBeNull();

    _clearIdempotencyCache();
    expect(getInflightRequest("s1", "t1")).toBeNull();
  });
});
