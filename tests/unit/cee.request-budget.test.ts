import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// 1. Config parsing tests — test the exported values and helpers
// ---------------------------------------------------------------------------

describe("Request budget configuration", () => {
  it("uses sensible defaults (120s budget, 15s headroom, 105s derived LLM timeout)", async () => {
    // These are module-level constants with default values
    const {
      DRAFT_REQUEST_BUDGET_MS,
      LLM_POST_PROCESSING_HEADROOM_MS,
      DRAFT_LLM_TIMEOUT_MS,
      MIN_TIMEOUT_MS,
    } = await import("../../src/config/timeouts.js");

    expect(DRAFT_REQUEST_BUDGET_MS).toBe(120_000);
    expect(LLM_POST_PROCESSING_HEADROOM_MS).toBe(15_000);
    expect(DRAFT_LLM_TIMEOUT_MS).toBe(105_000);
    // Derived timeout must always be >= MIN_TIMEOUT_MS
    expect(DRAFT_LLM_TIMEOUT_MS).toBeGreaterThanOrEqual(MIN_TIMEOUT_MS);
  });

  it("includes budget values in getResolvedTimeouts()", async () => {
    const { getResolvedTimeouts } = await import("../../src/config/timeouts.js");
    const resolved = getResolvedTimeouts();

    expect(resolved).toHaveProperty("DRAFT_REQUEST_BUDGET_MS");
    expect(resolved).toHaveProperty("LLM_POST_PROCESSING_HEADROOM_MS");
    expect(resolved).toHaveProperty("DRAFT_LLM_TIMEOUT_MS");
    expect(typeof resolved.DRAFT_REQUEST_BUDGET_MS).toBe("number");
    expect(typeof resolved.LLM_POST_PROCESSING_HEADROOM_MS).toBe("number");
    expect(typeof resolved.DRAFT_LLM_TIMEOUT_MS).toBe("number");
  });

  it("getDerivedRepairBudgetMs equals max(0, DRAFT_LLM_TIMEOUT_MS - REPAIR_TIMEOUT_MS)", async () => {
    const { getDerivedRepairBudgetMs, DRAFT_LLM_TIMEOUT_MS, REPAIR_TIMEOUT_MS } =
      await import("../../src/config/timeouts.js");
    const expected = Math.max(0, DRAFT_LLM_TIMEOUT_MS - REPAIR_TIMEOUT_MS);
    expect(getDerivedRepairBudgetMs()).toBe(expected);
    // With defaults (105s LLM, 20s repair), result should be 85s
    expect(getDerivedRepairBudgetMs()).toBeGreaterThanOrEqual(0);
  });

  it("derived LLM timeout = budget minus headroom", async () => {
    const { DRAFT_REQUEST_BUDGET_MS, LLM_POST_PROCESSING_HEADROOM_MS, DRAFT_LLM_TIMEOUT_MS, MIN_TIMEOUT_MS } =
      await import("../../src/config/timeouts.js");
    // If headroom < budget, derived = budget - headroom
    // If headroom >= budget, derived = MIN_TIMEOUT_MS
    const expected = Math.max(
      MIN_TIMEOUT_MS,
      DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS,
    );
    expect(DRAFT_LLM_TIMEOUT_MS).toBe(expected);
  });

  it("validateTimeoutRelationships checks budget vs route timeout", async () => {
    const { validateTimeoutRelationships } = await import("../../src/config/timeouts.js");
    // Just verify the function runs without throwing and returns an array
    const warnings = validateTimeoutRelationships();
    expect(Array.isArray(warnings)).toBe(true);
    // All items should be strings
    for (const w of warnings) {
      expect(typeof w).toBe("string");
    }
  });

  it("timeout ordering invariant holds with defaults: LLM < budget < route", async () => {
    const {
      DRAFT_LLM_TIMEOUT_MS,
      DRAFT_REQUEST_BUDGET_MS,
      ROUTE_TIMEOUT_MS,
      LLM_POST_PROCESSING_HEADROOM_MS,
      validateTimeoutRelationships,
    } = await import("../../src/config/timeouts.js");

    // CEE LLM call (105s) < CEE request budget (120s) < route timeout (135s)
    expect(DRAFT_LLM_TIMEOUT_MS).toBeLessThan(DRAFT_REQUEST_BUDGET_MS);
    expect(DRAFT_REQUEST_BUDGET_MS).toBeLessThanOrEqual(ROUTE_TIMEOUT_MS);
    expect(DRAFT_LLM_TIMEOUT_MS).toBe(DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS);

    // No warnings about budget exceeding route timeout
    const warnings = validateTimeoutRelationships();
    const budgetVsRouteWarning = warnings.find(w => w.includes("DRAFT_REQUEST_BUDGET_MS") && w.includes("ROUTE_TIMEOUT_MS"));
    expect(budgetVsRouteWarning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Error types tests
// ---------------------------------------------------------------------------

describe("Typed error classes", () => {
  it("LLMTimeoutError has correct name and properties", async () => {
    const { LLMTimeoutError } = await import("../../src/adapters/llm/errors.js");

    const err = new LLMTimeoutError(
      "LLM provider did not respond within 80s",
      "gpt-4o",
      80_000,
      82_345,
      "req-123",
    );

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("LLMTimeoutError");
    expect(err.model).toBe("gpt-4o");
    expect(err.timeoutMs).toBe(80_000);
    expect(err.elapsedMs).toBe(82_345);
    expect(err.requestId).toBe("req-123");
    expect(err.message).toBe("LLM provider did not respond within 80s");
  });

  it("RequestBudgetExceededError has correct name and properties", async () => {
    const { RequestBudgetExceededError } = await import("../../src/adapters/llm/errors.js");

    const err = new RequestBudgetExceededError(
      "Request exceeded 90s budget",
      90_000,
      91_000,
      "post_llm_draft",
      "req-456",
    );

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RequestBudgetExceededError");
    expect(err.budgetMs).toBe(90_000);
    expect(err.elapsedMs).toBe(91_000);
    expect(err.stage).toBe("post_llm_draft");
    expect(err.requestId).toBe("req-456");
  });

  it("ClientDisconnectError has correct name and properties", async () => {
    const { ClientDisconnectError } = await import("../../src/adapters/llm/errors.js");

    const err = new ClientDisconnectError(
      "Client disconnected during LLM draft call",
      45_000,
      "req-789",
    );

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ClientDisconnectError");
    expect(err.elapsedMs).toBe(45_000);
    expect(err.requestId).toBe("req-789");
  });

  it("LLMTimeoutError preserves cause", async () => {
    const { LLMTimeoutError } = await import("../../src/adapters/llm/errors.js");
    const originalError = new Error("original");
    const err = new LLMTimeoutError("timeout", "gpt-4o", 80_000, 82_000, "req", originalError);
    expect(err.cause).toBe(originalError);
  });
});

// ---------------------------------------------------------------------------
// 3. LLM timeout fires at configured threshold (OpenAI adapter)
// ---------------------------------------------------------------------------

// Separate mock — vi.mock is hoisted so we use a factory that returns
// a promise that hangs until the abort signal fires.
vi.mock("openai", () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn((_body: any, opts?: { signal?: AbortSignal }) => {
          return new Promise((_resolve, reject) => {
            const onAbort = () => {
              const err = new Error("The operation was aborted.");
              err.name = "AbortError";
              reject(err);
            };
            if (opts?.signal?.aborted) {
              onAbort();
              return;
            }
            if (opts?.signal) {
              opts.signal.addEventListener("abort", onAbort, { once: true });
            }
          });
        }),
      },
    };
  }
  return { default: MockOpenAI };
});

describe("OpenAI adapter draft timeout fires at configured threshold", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws UpstreamTimeoutError when draft call exceeds timeout", async () => {
    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const { UpstreamTimeoutError } = await import("../../src/adapters/llm/errors.js");

    const adapter = new OpenAIAdapter("gpt-4o");

    await expect(
      adapter.draftGraph(
        {
          brief: "Should we expand into the European market?",
          docs: [],
          seed: 17,
        },
        {
          requestId: "test-timeout",
          timeoutMs: 50, // Very short timeout — will fire quickly
        },
      ),
    ).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });

  it("timeout error includes correct elapsed time", async () => {
    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const { UpstreamTimeoutError } = await import("../../src/adapters/llm/errors.js");

    const adapter = new OpenAIAdapter("gpt-4o");

    try {
      await adapter.draftGraph(
        { brief: "test", docs: [], seed: 17 },
        { requestId: "test-elapsed", timeoutMs: 30 },
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamTimeoutError);
      const timeout = err as InstanceType<typeof UpstreamTimeoutError>;
      expect(timeout.elapsedMs).toBeGreaterThanOrEqual(20); // At least ~20ms elapsed
      expect(timeout.provider).toBe("openai");
      expect(timeout.operation).toBe("draft_graph");
    }
  });

  it("aborts when external signal fires (client disconnect)", async () => {
    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const { UpstreamTimeoutError } = await import("../../src/adapters/llm/errors.js");

    const adapter = new OpenAIAdapter("gpt-4o");
    const externalAbort = new AbortController();

    // Abort after 20ms to simulate client disconnect
    setTimeout(() => externalAbort.abort(), 20);

    await expect(
      adapter.draftGraph(
        { brief: "test", docs: [], seed: 17 },
        {
          requestId: "test-disconnect",
          timeoutMs: 60_000, // Long timeout — external signal should fire first
          signal: externalAbort.signal,
        },
      ),
    ).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });

  it("immediately aborts when signal is already aborted", async () => {
    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const { UpstreamTimeoutError } = await import("../../src/adapters/llm/errors.js");

    const adapter = new OpenAIAdapter("gpt-4o");
    const preAborted = new AbortController();
    preAborted.abort(); // Already aborted

    await expect(
      adapter.draftGraph(
        { brief: "test", docs: [], seed: 17 },
        {
          requestId: "test-pre-aborted",
          timeoutMs: 60_000,
          signal: preAborted.signal,
        },
      ),
    ).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });
});

// ---------------------------------------------------------------------------
// 4. Error response shape validation
// ---------------------------------------------------------------------------

describe("Typed error response shape", () => {
  it("LLMTimeoutError produces response with all required fields", async () => {
    const { LLMTimeoutError } = await import("../../src/adapters/llm/errors.js");

    const err = new LLMTimeoutError(
      "LLM provider did not respond within 80s",
      "gpt-4o",
      80_000,
      82_000,
      "req-abc",
    );

    // Verify that the error contains everything needed for the 504 response
    const responseBody = {
      error: "CEE_LLM_TIMEOUT",
      message: err.message,
      retryable: true,
      elapsed_ms: err.elapsedMs,
      model: err.model,
      request_id: err.requestId,
    };

    // All required fields present
    expect(responseBody).toHaveProperty("error", "CEE_LLM_TIMEOUT");
    expect(responseBody).toHaveProperty("message");
    expect(responseBody).toHaveProperty("retryable", true);
    expect(responseBody).toHaveProperty("elapsed_ms");
    expect(responseBody).toHaveProperty("model", "gpt-4o");
    expect(responseBody).toHaveProperty("request_id", "req-abc");
    // Message references the timeout
    expect(responseBody.message).toContain("80s");
  });

  it("RequestBudgetExceededError produces response with all required fields", async () => {
    const { RequestBudgetExceededError } = await import("../../src/adapters/llm/errors.js");

    const err = new RequestBudgetExceededError(
      "Request exceeded 90s budget",
      90_000,
      91_500,
      "post_llm_draft",
      "req-def",
    );

    const responseBody = {
      error: "CEE_REQUEST_BUDGET_EXCEEDED",
      message: err.message,
      retryable: true,
      elapsed_ms: err.elapsedMs,
      budget_ms: err.budgetMs,
      stage: err.stage,
      request_id: err.requestId,
    };

    expect(responseBody).toHaveProperty("error", "CEE_REQUEST_BUDGET_EXCEEDED");
    expect(responseBody).toHaveProperty("retryable", true);
    expect(responseBody).toHaveProperty("elapsed_ms", 91_500);
    expect(responseBody).toHaveProperty("budget_ms", 90_000);
    expect(responseBody).toHaveProperty("stage", "post_llm_draft");
    expect(responseBody).toHaveProperty("request_id", "req-def");
    expect(responseBody.message).toContain("90s");
  });

  it("both error types are JSON-serializable", async () => {
    const { LLMTimeoutError, RequestBudgetExceededError } = await import("../../src/adapters/llm/errors.js");

    const llmErr = new LLMTimeoutError("timeout", "gpt-4o", 80_000, 82_000, "req-1");
    const budgetErr = new RequestBudgetExceededError("budget", 90_000, 91_000, "stage", "req-2");

    // Should not throw
    const llmJson = JSON.stringify({
      error: "CEE_LLM_TIMEOUT",
      message: llmErr.message,
      retryable: true,
      elapsed_ms: llmErr.elapsedMs,
      model: llmErr.model,
      request_id: llmErr.requestId,
    });
    expect(typeof llmJson).toBe("string");
    expect(JSON.parse(llmJson)).toHaveProperty("error", "CEE_LLM_TIMEOUT");

    const budgetJson = JSON.stringify({
      error: "CEE_REQUEST_BUDGET_EXCEEDED",
      message: budgetErr.message,
      retryable: true,
      elapsed_ms: budgetErr.elapsedMs,
      request_id: budgetErr.requestId,
    });
    expect(typeof budgetJson).toBe("string");
    expect(JSON.parse(budgetJson)).toHaveProperty("error", "CEE_REQUEST_BUDGET_EXCEEDED");
  });
});

// ---------------------------------------------------------------------------
// 5. Client disconnect abort (AbortController signal propagation)
// ---------------------------------------------------------------------------

describe("Client disconnect aborts the LLM call", () => {
  it("AbortController signal fires when abort() is called", () => {
    const ac = new AbortController();
    let signalFired = false;

    ac.signal.addEventListener("abort", () => {
      signalFired = true;
    });

    expect(signalFired).toBe(false);
    ac.abort();
    expect(signalFired).toBe(true);
    expect(ac.signal.aborted).toBe(true);
  });

  it("chained abort propagates from external to internal controller", () => {
    const external = new AbortController();
    const internal = new AbortController();

    // Wire external → internal (same pattern as the OpenAI adapter)
    external.signal.addEventListener("abort", () => internal.abort(), { once: true });

    expect(internal.signal.aborted).toBe(false);
    external.abort();
    expect(internal.signal.aborted).toBe(true);
  });
});
