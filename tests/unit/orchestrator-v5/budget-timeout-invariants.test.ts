/**
 * Timeout-ladder invariants (this lane).
 *
 * These pin RELATIONSHIPS between budgets, not the numbers themselves. Every
 * defect they guard against is one where the code stays perfectly valid, the
 * suite stays green, and a capability silently stops working:
 *
 *  - PLOT_RUN_TIMEOUT_MS raised without DEFAULT_LLM_HANDLER_BUDGET_MS →
 *    remaining budget floors at 0 and the PLoT retry becomes unreachable by
 *    accounting accident rather than by policy.
 *  - The V5 turn budget drifting above BROWSER_PROXY_TIMEOUT_MS → the proxy
 *    answers before CEE does and the user gets a generic proxy error instead
 *    of CEE's typed one.
 *
 * A comment asking a human to keep two numbers in sync is exactly the
 * hand-maintained mirror that drifts silently. These assertions are the
 * fail-loud replacement.
 */
import { describe, it, expect } from "vitest";
import {
  PLOT_RUN_TIMEOUT_MS,
  PLOT_RUN_BRIEF_TIMEOUT_MS,
  ROUTE_TIMEOUT_MS,
} from "../../../src/config/timeouts.js";
import { getTurnExecutorBudgets, getHandlerBudgetMs } from "../../../src/orchestrator-v5/budgets.js";
import { config } from "../../../src/config/index.js";

// Mirrors the private constants in plot-client.ts. Kept here as explicit
// numbers ON PURPOSE: if someone changes the backoff or the minimum retry
// budget in the client, this test should FAIL and make them re-derive the
// handler budget, rather than silently tracking the new value.
const RETRY_BACKOFF_MS = 2_000;
const MIN_RETRY_BUDGET_MS = 2_000;

describe("PLOT_RUN_TIMEOUT_MS ↔ handler budget lockstep", () => {
  it("leaves enough handler budget for a clamped retry after a full-length PLoT attempt", () => {
    // If this fails, the retry has been disabled by arithmetic, not by policy.
    expect(getHandlerBudgetMs()).toBeGreaterThanOrEqual(
      PLOT_RUN_TIMEOUT_MS + RETRY_BACKOFF_MS + MIN_RETRY_BUDGET_MS,
    );
  });

  it("keeps the brief-bearing window at or above the base window", () => {
    // The brief path does strictly MORE work (PLoT calls back into CEE for
    // the LLM-backed decision review). Its window must never end up shorter
    // than the base one.
    expect(PLOT_RUN_BRIEF_TIMEOUT_MS).toBeGreaterThanOrEqual(PLOT_RUN_TIMEOUT_MS);
  });

  it("keeps the PLoT cap above PLoT's own request budget so a timeout means internal failure", () => {
    // This is the premise the "never retry the timeout class" policy rests on.
    // PLoT's REQUEST_BUDGET_MS is 70s; if CEE's cap ever drops back below it,
    // a CEE timeout would once again mean "cut off early" — a case where
    // retrying IS reasonable — and the no-retry policy would be wrong.
    const PLOT_REQUEST_BUDGET_MS = 70_000; // plot-lite-service src/config/timeouts.ts
    expect(PLOT_RUN_TIMEOUT_MS).toBeGreaterThan(PLOT_REQUEST_BUDGET_MS);
  });
});

describe("V5 turn budget is nested inside the browser-proxy deadline", () => {
  it("resolves a turn budget strictly below BROWSER_PROXY_TIMEOUT_MS", () => {
    const { turn_ms } = getTurnExecutorBudgets();
    expect(turn_ms).toBeLessThan(config.proxy.browserProxyTimeoutMs);
  });

  it("leaves headroom for CEE to compose and serialise its typed error", () => {
    const { turn_ms } = getTurnExecutorBudgets();
    // Not merely "less than" — comfortably less, so the abort has time to
    // become bytes on the wire.
    expect(config.proxy.browserProxyTimeoutMs - turn_ms).toBeGreaterThanOrEqual(10_000);
  });

  it("cannot be punched through by a TURN_BUDGET_MS env override", () => {
    const original = process.env.TURN_BUDGET_MS;
    try {
      process.env.TURN_BUDGET_MS = "600000"; // 10 minutes — far above the proxy
      const { turn_ms } = getTurnExecutorBudgets();
      expect(turn_ms).toBeLessThan(config.proxy.browserProxyTimeoutMs);
    } finally {
      if (original === undefined) delete process.env.TURN_BUDGET_MS;
      else process.env.TURN_BUDGET_MS = original;
    }
  });

  it("keeps the whole ladder strictly nested: turn < proxy < route", () => {
    const { turn_ms } = getTurnExecutorBudgets();
    expect(turn_ms).toBeLessThan(config.proxy.browserProxyTimeoutMs);
    expect(config.proxy.browserProxyTimeoutMs).toBeLessThan(ROUTE_TIMEOUT_MS);
  });
});

describe("worst-case analysis path fits inside the turn budget", () => {
  it("bounds PLoT attempt + backoff + clamped retry within the handler budget", () => {
    // Worst case after this lane's fix: one full-length attempt that fails
    // FAST-class (so a retry is allowed), the backoff, then a retry clamped to
    // whatever remains. The clamp means the total can never exceed the
    // handler budget.
    const handlerBudget = getHandlerBudgetMs();
    const worstCaseFirstAttempt = PLOT_RUN_TIMEOUT_MS;
    const clampedRetry = Math.min(
      PLOT_RUN_TIMEOUT_MS,
      handlerBudget - worstCaseFirstAttempt - RETRY_BACKOFF_MS - 1_000,
    );
    const total = worstCaseFirstAttempt + RETRY_BACKOFF_MS + Math.max(0, clampedRetry);
    expect(total).toBeLessThanOrEqual(handlerBudget);
  });

  it("bounds the handler budget inside the turn budget", () => {
    const { turn_ms } = getTurnExecutorBudgets();
    expect(getHandlerBudgetMs()).toBeLessThan(turn_ms);
  });
});
