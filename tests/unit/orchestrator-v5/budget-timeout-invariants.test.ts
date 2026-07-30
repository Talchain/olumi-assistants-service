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
  // IMPORTED, not hand-copied. A local `const RETRY_BACKOFF_MS = 2_000` here
  // could not do what its comment claimed: raise the client's backoff to 10s
  // and the real requirement becomes 87s > the 85s budget, yet a test carrying
  // its own stale 2_000 still passes. Importing the source is what makes this
  // suite track the product instead of a snapshot of it.
  RETRY_BACKOFF_MS,
  MIN_RETRY_BUDGET_MS,
  RETRY_SAFETY_MARGIN_MS,
  TURN_RESPONSE_HEADROOM_MS,
  DRAFT_REQUEST_RESPONSE_HEADROOM_MS,
  validateTimeoutRelationships,
  getResolvedTimeouts,
} from "../../../src/config/timeouts.js";
import { getTurnExecutorBudgets, getHandlerBudgetMs } from "../../../src/orchestrator-v5/budgets.js";
import { resolveDecisionReviewHardBudgetMs } from "../../../src/orchestrator-v5/coaching/decision-review-enricher.js";
import { config } from "../../../src/config/index.js";

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

/**
 * The rungs above run at REPO DEFAULTS only — that is all a unit test can do.
 * Every relationship they pin has BOTH ends env-overridable, so the deployed
 * instance is the only place the real values exist. `validateTimeoutRelationships()`
 * is where they are checked against those values, at boot.
 *
 * These tests are the CI-side POSITIVE CONTROL for that boot check: they prove
 * the rung can SEE a break. Without them the boot validator is an assertion
 * nobody has ever watched fail.
 */
describe("boot validator carries the ladder rungs (positive control)", () => {
  const healthyLadder = () => ({
    handlerBudgetMs: getHandlerBudgetMs(),
    turnBudgetMs: getTurnExecutorBudgets().turn_ms,
    browserProxyTimeoutMs: config.proxy.browserProxyTimeoutMs,
    // ROADMAP 2.180-B: resolved through the SAME single-source function the
    // boot path uses, against the live decompose posture — not a literal.
    decisionReviewHardBudgetMs: resolveDecisionReviewHardBudgetMs(
      config.cee.decisionReviewDecompose,
    ),
  });

  it("is silent on the resolved default ladder", () => {
    const warnings = validateTimeoutRelationships(healthyLadder());
    const ladderWarnings = warnings.filter(
      (w) => w.includes("LLM_BUDGET_HANDLER_MS") || w.includes("V5 turn budget") || w.includes("BROWSER_PROXY_TIMEOUT_MS"),
    );
    expect(ladderWarnings).toEqual([]);
  });

  it("FIRES when the handler budget can no longer afford a clamped retry", () => {
    // This is the exact accounting accident the lane exists to prevent, and
    // the exact case the CI-only assertion could not see: an operator raises
    // PLOT_RUN_TIMEOUT_MS on Render without raising the handler budget.
    const warnings = validateTimeoutRelationships({
      ...healthyLadder(),
      handlerBudgetMs: PLOT_RUN_TIMEOUT_MS + RETRY_BACKOFF_MS + MIN_RETRY_BUDGET_MS - 1,
    });
    expect(warnings.some((w) => w.includes("UNREACHABLE"))).toBe(true);
  });

  it("FIRES when the handler budget escapes the turn budget", () => {
    const { turn_ms } = getTurnExecutorBudgets();
    const warnings = validateTimeoutRelationships({
      ...healthyLadder(),
      handlerBudgetMs: turn_ms,
    });
    expect(warnings.some((w) => w.includes("not nested inside the outer turn budget"))).toBe(true);
  });

  it("FIRES when the turn budget reaches the proxy deadline", () => {
    const warnings = validateTimeoutRelationships({
      ...healthyLadder(),
      turnBudgetMs: config.proxy.browserProxyTimeoutMs,
    });
    expect(warnings.some((w) => w.includes("browser proxy will answer before CEE does"))).toBe(true);
  });

  it("FIRES when too little headroom remains to serialise the typed error", () => {
    const warnings = validateTimeoutRelationships({
      ...healthyLadder(),
      turnBudgetMs: config.proxy.browserProxyTimeoutMs - (TURN_RESPONSE_HEADROOM_MS - 1),
    });
    expect(warnings.some((w) => w.includes("TURN_RESPONSE_HEADROOM_MS"))).toBe(true);
  });

  it("FIRES when the proxy deadline escapes the Fastify route timeout", () => {
    const warnings = validateTimeoutRelationships({
      ...healthyLadder(),
      browserProxyTimeoutMs: ROUTE_TIMEOUT_MS,
    });
    expect(warnings.some((w) => w.includes("no longer strictly nested"))).toBe(true);
  });
});

describe("the ladder rung is registered in the diagnostic snapshot", () => {
  it("exposes the proxy-headroom rungs and the PLoT retry constants", () => {
    // getResolvedTimeouts() is the estate's single view of the ladder. A rung
    // absent from it is a rung nobody can see when diagnosing a live instance.
    const resolved = getResolvedTimeouts();
    expect(resolved.TURN_RESPONSE_HEADROOM_MS).toBe(TURN_RESPONSE_HEADROOM_MS);
    expect(resolved.DRAFT_REQUEST_RESPONSE_HEADROOM_MS).toBe(DRAFT_REQUEST_RESPONSE_HEADROOM_MS);
    expect(resolved.RETRY_BACKOFF_MS).toBe(RETRY_BACKOFF_MS);
    expect(resolved.MIN_RETRY_BUDGET_MS).toBe(MIN_RETRY_BUDGET_MS);
    expect(resolved.RETRY_SAFETY_MARGIN_MS).toBe(RETRY_SAFETY_MARGIN_MS);
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
      handlerBudget - worstCaseFirstAttempt - RETRY_BACKOFF_MS - RETRY_SAFETY_MARGIN_MS,
    );
    const total = worstCaseFirstAttempt + RETRY_BACKOFF_MS + Math.max(0, clampedRetry);
    expect(total).toBeLessThanOrEqual(handlerBudget);
  });

  it("bounds the handler budget inside the turn budget", () => {
    const { turn_ms } = getTurnExecutorBudgets();
    expect(getHandlerBudgetMs()).toBeLessThan(turn_ms);
  });
});
