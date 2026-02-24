import { describe, it, expect, beforeEach } from "vitest";
import {
  getIdempotentResponse,
  setIdempotentResponse,
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
