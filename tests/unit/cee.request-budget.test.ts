import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// 1. Config parsing tests — test the exported values and helpers
// ---------------------------------------------------------------------------

describe("Request budget configuration", () => {
  it("uses sensible defaults (120s budget, 10s headroom, 110s derived LLM timeout)", async () => {
    // These are module-level constants with default values. Headroom 15s->10s
    // (2026-07-20 recalibration): measured post-LLM tail is ~1-1.5s, so 10s
    // stays >5x observed while freeing 5s of budget for the LLM window.
    const {
      DRAFT_REQUEST_BUDGET_MS,
      LLM_POST_PROCESSING_HEADROOM_MS,
      DRAFT_LLM_TIMEOUT_MS,
      MIN_TIMEOUT_MS,
    } = await import("../../src/config/timeouts.js");

    expect(DRAFT_REQUEST_BUDGET_MS).toBe(120_000);
    expect(LLM_POST_PROCESSING_HEADROOM_MS).toBe(10_000);
    expect(DRAFT_LLM_TIMEOUT_MS).toBe(110_000);
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
    const { getHandlerBudgetMs, getTurnExecutorBudgets } = await import("../../src/orchestrator-v5/budgets.js");
    const { config } = await import("../../src/config/index.js");
    // Just verify the function runs without throwing and returns an array
    const warnings = validateTimeoutRelationships({
      handlerBudgetMs: getHandlerBudgetMs(),
      turnBudgetMs: getTurnExecutorBudgets().turn_ms,
      browserProxyTimeoutMs: config.proxy.browserProxyTimeoutMs,
    });
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
    expect(DRAFT_REQUEST_BUDGET_MS).toBeLessThan(ROUTE_TIMEOUT_MS);
    expect(DRAFT_LLM_TIMEOUT_MS).toBe(DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS);

    const { getHandlerBudgetMs, getTurnExecutorBudgets } = await import("../../src/orchestrator-v5/budgets.js");
    const { config } = await import("../../src/config/index.js");

    // No warnings about budget exceeding route timeout
    const warnings = validateTimeoutRelationships({
      handlerBudgetMs: getHandlerBudgetMs(),
      turnBudgetMs: getTurnExecutorBudgets().turn_ms,
      browserProxyTimeoutMs: config.proxy.browserProxyTimeoutMs,
    });
    const budgetVsRouteWarning = warnings.find(w => w.includes("DRAFT_REQUEST_BUDGET_MS") && w.includes("ROUTE_TIMEOUT_MS"));
    expect(budgetVsRouteWarning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Error types tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Draft retry budget coherence (2026-07-20 staging outage RCA)
//
// The old draft retry handed attempt 2 a full fresh DRAFT_LLM_TIMEOUT_MS,
// giving a 211s worst case (105 + ~0.8 + 105) against a 120s request budget
// and a 125s browser-proxy deadline. Every retry outcome was unusable by
// construction: a retry timeout surfaced at ~211s, and a retry SUCCESS landed
// past the budget guard, which threw it away (observed twice in the outage
// window: cee.request_budget.exceeded at 09:51:06Z and 10:12:02Z). These pins
// make that arithmetic impossible to reintroduce silently.
// ---------------------------------------------------------------------------

describe("Draft retry budget coherence", () => {
  it("a full-window first-attempt timeout leaves NO affordable retry at defaults", async () => {
    const {
      getDraftLlmRetryBudgetMs,
      DRAFT_LLM_TIMEOUT_MS,
      MIN_DRAFT_RETRY_BUDGET_MS,
    } = await import("../../src/config/timeouts.js");

    const windowAfterFullTimeout = getDraftLlmRetryBudgetMs(DRAFT_LLM_TIMEOUT_MS);
    // 120s budget − 105s spent − 15s headroom = 0
    expect(windowAfterFullTimeout).toBe(0);
    expect(windowAfterFullTimeout).toBeLessThan(MIN_DRAFT_RETRY_BUDGET_MS);
  });

  it("retry window invariant: elapsed + window + headroom never exceeds the budget", async () => {
    const {
      getDraftLlmRetryBudgetMs,
      DRAFT_REQUEST_BUDGET_MS,
      DRAFT_LLM_TIMEOUT_MS,
      LLM_POST_PROCESSING_HEADROOM_MS,
    } = await import("../../src/config/timeouts.js");

    for (let elapsed = 0; elapsed <= 150_000; elapsed += 5_000) {
      const window = getDraftLlmRetryBudgetMs(elapsed);
      expect(window).toBeGreaterThanOrEqual(0);
      expect(window).toBeLessThanOrEqual(DRAFT_LLM_TIMEOUT_MS);
      if (window > 0) {
        expect(elapsed + window + LLM_POST_PROCESSING_HEADROOM_MS).toBeLessThanOrEqual(
          DRAFT_REQUEST_BUDGET_MS,
        );
      }
    }
  });

  it("MIN_DRAFT_RETRY_BUDGET_MS default is 55s: at or above every successful draft ever observed", async () => {
    const { MIN_DRAFT_RETRY_BUDGET_MS, DRAFT_LLM_TIMEOUT_MS } =
      await import("../../src/config/timeouts.js");
    // Empirical anchor (recurrence RCA, 2026-07-20, n=7 successful drafts):
    // min 37.9s / p50 43.4s / p95 53.7s / max 54.6s. The floor must sit AT OR
    // ABOVE the slowest success ever observed — a granted retry window smaller
    // than that can only burn provider spend on a result that cannot finish.
    // (The original 35s floor sat BELOW its own cited 38–55s anchor and below
    // the fastest draft ever observed; re-anchored per adversarial review
    // condition 1.)
    expect(MIN_DRAFT_RETRY_BUDGET_MS).toBe(55_000);
    // ≥ max observed successful draft (54.6s): any authorized window fits
    // every healthy draft in the distribution.
    expect(MIN_DRAFT_RETRY_BUDGET_MS).toBeGreaterThanOrEqual(54_600);
    expect(MIN_DRAFT_RETRY_BUDGET_MS).toBeLessThan(DRAFT_LLM_TIMEOUT_MS);
  });

  it("validateTimeoutRelationships warns when MIN_DRAFT_RETRY_BUDGET_MS makes the retry structurally unreachable", async () => {
    vi.resetModules();
    const prev = process.env.MIN_DRAFT_RETRY_BUDGET_MS;
    process.env.MIN_DRAFT_RETRY_BUDGET_MS = "200000"; // ≥ DRAFT_LLM_TIMEOUT_MS (105s)
    try {
      const { validateTimeoutRelationships } = await import("../../src/config/timeouts.js");
      const warnings = validateTimeoutRelationships({
        handlerBudgetMs: 85_000,
        turnBudgetMs: 115_000,
        browserProxyTimeoutMs: 125_000,
      });
      expect(warnings.some((w) => w.includes("MIN_DRAFT_RETRY_BUDGET_MS"))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.MIN_DRAFT_RETRY_BUDGET_MS;
      else process.env.MIN_DRAFT_RETRY_BUDGET_MS = prev;
      vi.resetModules();
    }
  });
});

// ---------------------------------------------------------------------------
// Draft request budget nested under the browser-proxy deadline (proxy-504 guard)
//
// The ladder-header comment in config/timeouts.ts long CLAIMED "the budget
// itself cannot rise without the proxy deadline rising first", but no rung in
// validateTimeoutRelationships enforced it: DRAFT_REQUEST_BUDGET_MS is a module
// constant (env-resolved), not one of the injected ladder inputs, so a bare
// DRAFT_REQUEST_BUDGET_MS=130000 override booted silently and re-opened the
// 2026-07-20 proxy-504 symptom while every default-only CI assertion stayed
// green. These pins are the positive control for the now-real rung.
//
// DRAFT_REQUEST_BUDGET_MS is read at import time, so this is an env-mutation
// test — it re-imports the module after setting the env, exactly like the
// MIN_DRAFT_RETRY_BUDGET_MS test above.
// ---------------------------------------------------------------------------

describe("Draft request budget is nested under the browser-proxy deadline", () => {
  it("is SILENT at repo defaults — the wire-composition margin is exactly met", async () => {
    vi.resetModules();
    const { validateTimeoutRelationships, DRAFT_REQUEST_BUDGET_MS, DRAFT_REQUEST_RESPONSE_HEADROOM_MS } =
      await import("../../src/config/timeouts.js");
    // Sanity: no leaked env override — otherwise the "silent" claim is vacuous.
    expect(DRAFT_REQUEST_BUDGET_MS).toBe(120_000);
    // The default proxy deadline sits exactly one margin above the budget.
    expect(125_000 - DRAFT_REQUEST_BUDGET_MS).toBe(DRAFT_REQUEST_RESPONSE_HEADROOM_MS);
    const warnings = validateTimeoutRelationships({
      handlerBudgetMs: 85_000,
      turnBudgetMs: 115_000,
      browserProxyTimeoutMs: 125_000, // repo default
    });
    const draftProxyWarning = warnings.find(
      (w) => w.includes("DRAFT_REQUEST_BUDGET_MS") && w.includes("BROWSER_PROXY_TIMEOUT_MS"),
    );
    expect(draftProxyWarning).toBeUndefined();
  });

  it("FIRES when DRAFT_REQUEST_BUDGET_MS rises to 130s without the proxy deadline rising", async () => {
    vi.resetModules();
    const prev = process.env.DRAFT_REQUEST_BUDGET_MS;
    process.env.DRAFT_REQUEST_BUDGET_MS = "130000"; // climbs past the 125s proxy deadline
    try {
      const { validateTimeoutRelationships } = await import("../../src/config/timeouts.js");
      const warnings = validateTimeoutRelationships({
        handlerBudgetMs: 85_000,
        turnBudgetMs: 115_000,
        browserProxyTimeoutMs: 125_000,
      });
      expect(
        warnings.some(
          (w) =>
            w.includes("DRAFT_REQUEST_BUDGET_MS") &&
            w.includes("DRAFT_REQUEST_RESPONSE_HEADROOM_MS"),
        ),
      ).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.DRAFT_REQUEST_BUDGET_MS;
      else process.env.DRAFT_REQUEST_BUDGET_MS = prev;
      vi.resetModules();
    }
  });
});

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
