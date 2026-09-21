/**
 * PLoT client — timeout + retry bounding (this lane).
 *
 * Covers the three defects this PR fixes on the CEE→PLoT inner hop:
 *
 *  1. The retry re-armed the FULL configured timeout on a fresh
 *     AbortController, so one slow request could cost
 *     `timeout + backoff + timeout` of wall clock and put TWO expensive
 *     PLoT+ISL runs in flight concurrently.
 *  2. `turnSignal` never reached `fetch`, so aborting the turn did not
 *     cancel PLoT's work — the socket stayed open holding an ISL run
 *     nobody was waiting for.
 *  3. The TIMEOUT class was retried on `/v2/run`. Now that CEE's cap sits
 *     ABOVE PLoT's own REQUEST_BUDGET_MS (70s), a timeout means PLoT failed
 *     internally, so a retry near-certainly repeats it at double cost.
 *
 * The asymmetry in (3) is load-bearing and is pinned by an explicit
 * POSITIVE CONTROL: a fast-failing 5xx must STILL retry exactly once. A fix
 * that silently disabled all retries would pass a naive "no double-run"
 * assertion, so that assertion alone is not evidence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PLOT_RUN_TIMEOUT_MS } from "../../../src/config/timeouts.js";

vi.mock("../../../src/config/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/config/index.js")>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === "plot") {
          return { baseUrl: "http://plot-test:3002", authToken: "test-token-secret" };
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { createPLoTClient } = await import("../../../src/orchestrator/plot-client.js");

const VALID_OPT = { id: "a", option_id: "a", interventions: { fac_1: 0.5 } };
const VALID_RUN = { graph: { nodes: [], edges: [] }, options: [VALID_OPT], goal_node_id: "g1" };
const VALID_RUN_RESPONSE = {
  meta: { seed_used: 42, n_samples: 100, response_hash: "h" },
  results: [{ option_id: "a" }],
};

/**
 * A fetch stand-in that never resolves on its own and records the wall-clock
 * (fake-timer) moment its AbortSignal fires. This is how we OBSERVE the
 * timeout a given attempt was armed with — the value is not otherwise
 * exposed, and asserting on a log line would couple the test to phrasing.
 */
function hangingFetchRecordingAbort(record: { abortedAtMs: number | null }) {
  return (_url: string, init: { signal: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      const started = Date.now();
      init.signal.addEventListener("abort", () => {
        record.abortedAtMs = Date.now() - started;
        reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
      });
    });
}

describe("PLoT /v2/run — timeout + retry bounding", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Defect 3 — no retry on the TIMEOUT class
  // -------------------------------------------------------------------------

  it("does NOT retry /v2/run on a timeout, even with ample remaining budget", async () => {
    const record = { abortedAtMs: null as number | null };
    fetchSpy.mockImplementation(hangingFetchRecordingAbort(record));

    const client = createPLoTClient()!;
    // Budget deliberately far larger than the cap, so the ONLY thing that can
    // suppress the retry is the timeout-class policy — not budget accounting.
    // Pre-fix this combination retried deterministically.
    const promise = client.run(VALID_RUN, "req-timeout", {
      turnStartedAt: Date.now(),
      turnBudgetMs: PLOT_RUN_TIMEOUT_MS * 4,
    });
    const assertion = expect(promise).rejects.toThrow(/timed out/);

    await vi.advanceTimersByTimeAsync(PLOT_RUN_TIMEOUT_MS + 5_000);
    await assertion;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // POSITIVE CONTROL — the retry must still fire for the fast-fail class
  // -------------------------------------------------------------------------

  it("POSITIVE CONTROL: still retries once on a fast-failing 503 and succeeds", async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ message: "Service Unavailable" }),
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(VALID_RUN_RESPONSE) });

    const client = createPLoTClient()!;
    const promise = client.run(VALID_RUN, "req-503", {
      turnStartedAt: Date.now(),
      turnBudgetMs: PLOT_RUN_TIMEOUT_MS * 4,
    });

    await vi.advanceTimersByTimeAsync(3_000); // clear the 2s backoff
    const result = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.meta.seed_used).toBe(42);
  });

  it("POSITIVE CONTROL: still retries once on a fast network error", async () => {
    fetchSpy
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(VALID_RUN_RESPONSE) });

    const client = createPLoTClient()!;
    const promise = client.run(VALID_RUN, "req-net", {
      turnStartedAt: Date.now(),
      turnBudgetMs: PLOT_RUN_TIMEOUT_MS * 4,
    });

    await vi.advanceTimersByTimeAsync(3_000);
    const result = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.meta.seed_used).toBe(42);
  });

  // -------------------------------------------------------------------------
  // Defect 1 — the retry window is CLAMPED to the remaining budget
  // -------------------------------------------------------------------------

  it("clamps the retry timeout to the remaining budget instead of re-arming the full cap", async () => {
    const retryRecord = { abortedAtMs: null as number | null };

    fetchSpy
      // Attempt 1: fast 503 → retryable, and fast enough to leave budget.
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ message: "Service Unavailable" }),
      })
      // Attempt 2: hangs, so we can observe the timeout it was armed with.
      .mockImplementationOnce(hangingFetchRecordingAbort(retryRecord));

    const REMAINING_BUDGET_MS = 20_000;
    // clamped = min(base, remaining - backoff(2s) - safety(1s)) = 17_000,
    // which is strictly less than the base cap — that gap is the assertion.
    const EXPECTED_CLAMPED_MS = REMAINING_BUDGET_MS - 2_000 - 1_000;

    const client = createPLoTClient()!;
    const promise = client.run(VALID_RUN, "req-clamp", {
      turnStartedAt: Date.now(),
      turnBudgetMs: REMAINING_BUDGET_MS,
    });
    const assertion = expect(promise).rejects.toThrow();

    await vi.advanceTimersByTimeAsync(PLOT_RUN_TIMEOUT_MS + 5_000);
    await assertion;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(retryRecord.abortedAtMs).toBe(EXPECTED_CLAMPED_MS);
    // The whole point: the retry did NOT get a fresh full window.
    expect(retryRecord.abortedAtMs).toBeLessThan(PLOT_RUN_TIMEOUT_MS);
  });

  // -------------------------------------------------------------------------
  // Defect 2 — turnSignal reaches fetch, so CEE's abort cancels PLoT's work
  // -------------------------------------------------------------------------

  it("aborts the in-flight PLoT request when the turn signal fires", async () => {
    const record = { abortedAtMs: null as number | null };
    fetchSpy.mockImplementation(hangingFetchRecordingAbort(record));

    const turnController = new AbortController();
    const client = createPLoTClient()!;
    const promise = client.run(VALID_RUN, "req-turnabort", {
      turnSignal: turnController.signal,
      turnStartedAt: Date.now(),
      turnBudgetMs: PLOT_RUN_TIMEOUT_MS * 4,
    });
    const assertion = expect(promise).rejects.toThrow();

    // Abort the TURN well before the per-attempt timeout would have fired.
    await vi.advanceTimersByTimeAsync(1_000);
    turnController.abort();
    await vi.advanceTimersByTimeAsync(10);
    await assertion;

    // Pre-fix, turnSignal never reached fetch: the request would have kept
    // running until the per-attempt cap, so abortedAtMs would be the cap
    // (or null within this window) rather than the moment the turn aborted.
    expect(record.abortedAtMs).toBe(1_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("classifies a turn-signal abort as NOT a PLoT timeout", async () => {
    const record = { abortedAtMs: null as number | null };
    fetchSpy.mockImplementation(hangingFetchRecordingAbort(record));

    const turnController = new AbortController();
    const client = createPLoTClient()!;
    const promise = client.run(VALID_RUN, "req-turnabort-class", {
      turnSignal: turnController.signal,
      turnStartedAt: Date.now(),
      turnBudgetMs: PLOT_RUN_TIMEOUT_MS * 4,
    });

    // Misattributing this to PLoT would both blame the wrong service in
    // telemetry and feed the timeout class into the retry policy for a turn
    // that is already over.
    const assertion = expect(promise).rejects.toThrow(
      expect.objectContaining({ name: "AbortError" }),
    );

    await vi.advanceTimersByTimeAsync(500);
    turnController.abort();
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });
});
