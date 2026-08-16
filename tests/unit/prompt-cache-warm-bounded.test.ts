/**
 * ROADMAP 2.1253 — the prompt-cache warm cannot black out a deploy.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * `warmPromptCacheFromStore()` is awaited inside `build()`, which is awaited
 * before `app.listen()`. Every millisecond it spends is a millisecond during
 * which the deploying instance answers nothing at all — health checks included.
 * It walked its ~22 task ids SERIALLY with NO per-fetch timeout, which measured
 * as a multi-minute deploy blackout when the store was slow, and made
 * `POST /assist/v1/prompts/warm` take 12.5–13.2 s against a UI that gives up at
 * 5 s.
 *
 * ── WHY THE TEST ASSERTS CONCURRENCY AND NOT JUST THE TIMEOUT ──────────────
 * A per-fetch bound on a serial loop bounds the warm at `N × timeout`. With
 * N ≈ 22 and the shipped 5 s timeout that is ~110 s — still a blackout, and a
 * test that only asserted "each fetch is bounded" would call it fixed. The
 * property worth having is that the WHOLE warm is bounded by ONE timeout, and
 * that is only true if the fetches overlap. The threshold below is chosen to
 * separate the two implementations by more than an order of magnitude, in both
 * directions, so a starved runner cannot flip the verdict:
 *
 *     serial     ≥ N × 40 ms   (N is derived below, never hardcoded — ≥ 800 ms)
 *     concurrent ≈ 40 ms
 *     threshold    400 ms
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const FETCH_TIMEOUT_MS = 40;

vi.mock("../../src/config/timeouts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/config/timeouts.js")>()),
  PROMPT_STORE_FETCH_TIMEOUT_MS: FETCH_TIMEOUT_MS,
}));

vi.mock("../../src/prompts/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/prompts/index.js")>();
  return { ...actual, loadPrompt: vi.fn() };
});

vi.mock("../../src/utils/telemetry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/telemetry.js")>();
  return {
    ...actual,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emit: vi.fn(),
  };
});

const { warmPromptCacheFromStore, clearPromptCache } = await import(
  "../../src/adapters/llm/prompt-loader.js"
);
const { loadPrompt } = await import("../../src/prompts/index.js");
const { OPERATION_TO_TASK_ID } = await import("../../src/prompts/operations.js");

/** Derived, never hardcoded — the count is what makes serial vs concurrent measurable. */
const TASK_COUNT = new Set(Object.values(OPERATION_TO_TASK_ID)).size;

/** A fetch that never settles. The bound is the only thing that can end it. */
const NEVER = () => new Promise<never>(() => {});

function storePrompt(taskId: string) {
  return {
    content: `system prompt body for ${taskId}, long enough to be real`,
    source: "store" as const,
    promptId: `${taskId}_default`,
    version: 1,
    isStaging: false,
    modelConfig: undefined,
  };
}

describe("ROADMAP 2.1253 — warmPromptCacheFromStore is bounded by ONE timeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPromptCache();
  });

  afterEach(() => {
    clearPromptCache();
  });

  it("has enough tasks for the serial/concurrent distinction to be meaningful", () => {
    // A positive control on the test itself. If the task list ever shrank to a
    // handful, the timing assertion below would stop discriminating and would
    // pass for BOTH implementations — silently, which is the failure mode this
    // whole suite exists to catch one level down.
    expect(TASK_COUNT).toBeGreaterThanOrEqual(10);
    expect(TASK_COUNT * FETCH_TIMEOUT_MS).toBeGreaterThan(400);
  });

  it("returns within ~one timeout even when EVERY fetch hangs forever", async () => {
    (loadPrompt as any).mockImplementation(NEVER);

    const startedAt = Date.now();
    const result = await warmPromptCacheFromStore();
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(400);
    // Serial would need at least this long; stated explicitly so the failure
    // message names the mechanism rather than just a number.
    expect(elapsed).toBeLessThan(TASK_COUNT * FETCH_TIMEOUT_MS);
    expect(result.failed).toBe(TASK_COUNT);
  });

  it("counts a timed-out fetch as FAILED, never as skipped", async () => {
    // `skipped` means "no managed prompt exists" — a settled answer that reads
    // as healthy. Folding an unknown into it is how a store outage comes to
    // look like a clean warm.
    (loadPrompt as any).mockImplementation(NEVER);

    const result = await warmPromptCacheFromStore();

    expect(result.skipped).toBe(0);
    expect(result.warmed).toBe(0);
  });

  it("a fetch that REJECTS after the bound has passed does not become an unhandled rejection", async () => {
    // The losing side of the race keeps running. Without an absorber attached
    // at dispatch time this crashes the process long after the warm returned —
    // during boot, on a slow store, which is precisely when it is least
    // debuggable.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      (loadPrompt as any).mockImplementation(
        () =>
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error("store died late")), FETCH_TIMEOUT_MS * 3),
          ),
      );

      await warmPromptCacheFromStore();
      await new Promise((r) => setTimeout(r, FETCH_TIMEOUT_MS * 6));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toHaveLength(0);
  });

  it("still warms every task when the store is healthy — the bound is not a bypass", async () => {
    // The opposite-direction twin. An implementation that simply gave up on the
    // store would pass every test above.
    (loadPrompt as any).mockImplementation(async (taskId: string) => storePrompt(taskId));

    const result = await warmPromptCacheFromStore();

    expect(result.warmed).toBe(TASK_COUNT);
    expect(result.failed).toBe(0);
  });

  it("a slow-but-inside-the-bound store still warms — bounded, not impatient", async () => {
    (loadPrompt as any).mockImplementation(async (taskId: string) => {
      await new Promise((r) => setTimeout(r, FETCH_TIMEOUT_MS / 4));
      return storePrompt(taskId);
    });

    const result = await warmPromptCacheFromStore();

    expect(result.warmed).toBe(TASK_COUNT);
    expect(result.failed).toBe(0);
  });
});
