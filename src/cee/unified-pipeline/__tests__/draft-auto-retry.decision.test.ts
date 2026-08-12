/**
 * ROADMAP 2.1086 — the pure auto-retry decision + exhausted-copy transform.
 *
 * The trigger is bound to the PRODUCER'S OWN emitted signature (422 +
 * CEE_GRAPH_INVALID + retryable:true + details.last_phase =
 * "deterministic_enforcement") — shared constants with the emitter in
 * graph-enforcement.ts, never a hand-list of validator codes. The validator
 * code SET is inherited by derivation: the gate fires iff
 * `validateGraphDeterministic(...).errors.length > 0` at phase
 * post_enforcement, so every blocking code that validator can emit — present
 * or future — rides this envelope and therefore this trigger.
 *
 * The budget cut-off is DERIVED from the same primitives the draft path
 * already enforces (getDraftLlmRetryBudgetMs / MIN_DRAFT_RETRY_BUDGET_MS),
 * asserted here via the real functions rather than re-encoded numbers.
 *
 * RED at pristine 335a9380: this module does not exist yet.
 */

import { describe, it, expect } from "vitest";

import {
  decideEnforcementAutoRetry,
  applyEnforcementRetryExhaustedCopy,
} from "../draft-auto-retry.js";
import {
  isEnforcementBlockedResult,
  ENFORCEMENT_BLOCK_STATUS_CODE,
  ENFORCEMENT_BLOCK_ERROR_CODE,
  ENFORCEMENT_BLOCK_LAST_PHASE,
} from "../stages/repair/graph-enforcement.js";
import {
  getDraftLlmRetryBudgetMs,
  MIN_DRAFT_RETRY_BUDGET_MS,
} from "../../../config/timeouts.js";
import { buildCeeErrorResponse } from "../../validation/pipeline.js";

/** The producer's body, built by the REAL envelope builder with the REAL
 *  shared constants — this fixture cannot drift from the emitter's signature
 *  without the constants moving with it. */
function blockedResult(overrides?: { retryable?: boolean; lastPhase?: string; code?: string; statusCode?: number }) {
  const body = buildCeeErrorResponse(
    (overrides?.code ?? ENFORCEMENT_BLOCK_ERROR_CODE) as never,
    "Graph failed post-enforcement validation (1 topology error(s))",
    {
      requestId: "req-decision-spec",
      retryable: overrides?.retryable ?? true,
      recovery: {
        suggestion:
          "Part of the drafted decision model was left unconnected to your goal, so it was rejected instead of being shown to you — this is usually transient. Try again.",
        hints: [
          "Retrying the same brief usually succeeds",
          "If it keeps happening, state the outcome you are optimising for explicitly",
        ],
      },
      details: {
        validation_error_codes: ["NO_PATH_TO_GOAL"],
        enforcement_repairs: 2,
        last_phase: overrides?.lastPhase ?? ENFORCEMENT_BLOCK_LAST_PHASE,
      },
    },
  );
  return { statusCode: overrides?.statusCode ?? ENFORCEMENT_BLOCK_STATUS_CODE, body: body as unknown };
}

describe("isEnforcementBlockedResult — the trigger recognises exactly the producer's signature", () => {
  it("recognises the enforcement gate's own emission", () => {
    expect(isEnforcementBlockedResult(blockedResult())).toBe(true);
  });

  it.each([
    ["a different status code", blockedResult({ statusCode: 400 })],
    ["a different error code", blockedResult({ code: "CEE_LLM_VALIDATION_FAILED" })],
    ["producer-declared retryable: false", blockedResult({ retryable: false })],
    ["a different last_phase (orchestrator_validation)", blockedResult({ lastPhase: "orchestrator_validation" })],
    ["an undefined result", undefined],
    ["a null body", { statusCode: 422, body: null }],
    ["a bodiless 422", { statusCode: 422, body: {} }],
  ])("rejects %s", (_name, result) => {
    expect(isEnforcementBlockedResult(result as never)).toBe(false);
  });
});

describe("decideEnforcementAutoRetry — budget gate derived from the draft path's own primitives", () => {
  it("funds the retry at the BASELINE worst case (28.3s elapsed)", () => {
    const d = decideEnforcementAutoRetry(blockedResult(), 28_300);
    expect(d.retry).toBe(true);
    if (d.retry) {
      expect(d.retryBudgetMs).toBe(getDraftLlmRetryBudgetMs(28_300));
      expect(d.retryBudgetMs).toBeGreaterThanOrEqual(MIN_DRAFT_RETRY_BUDGET_MS);
    }
  });

  it("the cut-off is EXACTLY where the derived window crosses MIN_DRAFT_RETRY_BUDGET_MS", () => {
    // Find the boundary (the LARGEST affordable elapsed) from the real
    // primitives, not a re-encoded 55s: coarse steps, then fine.
    let boundary = 0;
    while (getDraftLlmRetryBudgetMs(boundary + 1_000) >= MIN_DRAFT_RETRY_BUDGET_MS) boundary += 1_000;
    while (getDraftLlmRetryBudgetMs(boundary + 1) >= MIN_DRAFT_RETRY_BUDGET_MS) boundary += 1;
    // At the boundary: still affordable.
    expect(decideEnforcementAutoRetry(blockedResult(), boundary).retry).toBe(true);
    // One millisecond past it: refused, with the reason named.
    const past = decideEnforcementAutoRetry(blockedResult(), boundary + 1);
    expect(past.retry).toBe(false);
    if (!past.retry) expect(past.reason).toBe("budget_unaffordable");
  });

  it("a non-enforcement result is never retried, even with the whole budget remaining", () => {
    const d = decideEnforcementAutoRetry(blockedResult({ lastPhase: "orchestrator_validation" }), 0);
    expect(d.retry).toBe(false);
    if (!d.retry) expect(d.reason).toBe("not_enforcement_blocked");
  });
});

describe("applyEnforcementRetryExhaustedCopy — honest copy after the server has already retried", () => {
  it("replaces the stale 'usually succeeds' claim, discloses the retry, and preserves the diagnostics", () => {
    const second = blockedResult();
    const before = JSON.stringify(second.body);

    const adjusted = applyEnforcementRetryExhaustedCopy(second as never);
    const body = adjusted.body as Record<string, any>;

    // Unchanged mechanics: still the same typed failure.
    expect(adjusted.statusCode).toBe(ENFORCEMENT_BLOCK_STATUS_CODE);
    expect(body.code).toBe(ENFORCEMENT_BLOCK_ERROR_CODE);
    expect(body.retryable).toBe(true);
    expect(body.details.validation_error_codes).toEqual(["NO_PATH_TO_GOAL"]);
    expect(body.details.enforcement_repairs).toBe(2);
    expect(body.details.last_phase).toBe(ENFORCEMENT_BLOCK_LAST_PHASE);

    // The wire-visible retry disclosure.
    expect(body.details.auto_retry).toEqual({ attempted: true, attempts: 2 });

    // Honest copy: no "usually succeeds" / "usually transient" after two
    // consecutive identical failures (BASELINE: S3 0/3, M2 0/2); the copy
    // must disclose the automatic second attempt and promote strengthening
    // the brief over blind retrying.
    const recovery = JSON.stringify(body.recovery).toLowerCase();
    expect(recovery).not.toContain("usually succeeds");
    expect(recovery).not.toContain("usually transient");
    expect(recovery).toMatch(/second draft|automatically/);
    expect(recovery).toContain("outcome you are optimising for");

    // Pure transform: the input result was not mutated.
    expect(JSON.stringify(second.body)).toBe(before);
  });
});
