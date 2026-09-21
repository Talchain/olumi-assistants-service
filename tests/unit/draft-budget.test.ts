/**
 * Provider-independent draft budget seam (ROADMAP 2.90).
 *
 * The two root-cause attacks that make Paul's model/thinking lever safe:
 *  - THINKING CLAMP (Codex #8): when extended thinking is enabled, the TOTAL
 *    request (thinking budget + reserved visible output) must fit the affordable
 *    envelope. `resolveDraftThinking` clamps the budget DOWN — it must never
 *    resurrect the unaffordable budget the 2026-07-20 outage fix removed.
 *  - TERMINAL-COMPLETION POLICY (Codex #9): `isDraftTruncated` normalises the
 *    provider truncation signal (Anthropic max_tokens / OpenAI length) so both
 *    draft paths share one policy.
 *
 * These tests RECOMPUTE the invariants from the returned budgets rather than
 * restating the constants — the load-bearing assertions derive the total request
 * and check it against the affordable value that produced it.
 */

import { describe, it, expect } from "vitest";
import {
  resolveDraftThinking,
  isDraftTruncated,
  validateDraftThinkingAffordability,
  MIN_DRAFT_VISIBLE_OUTPUT_TOKENS,
  ANTHROPIC_MIN_THINKING_BUDGET_TOKENS,
} from "../../src/adapters/llm/draft-budget.js";
import {
  getAffordableDraftTokens,
  DRAFT_LLM_TIMEOUT_MS,
} from "../../src/config/timeouts.js";

// ---------------------------------------------------------------------------
// resolveDraftThinking — the clamp; the effective request is NEVER > affordable
// ---------------------------------------------------------------------------

describe("resolveDraftThinking — total request (thinking + visible output) never exceeds affordable", () => {
  it("thinking-on + the DEFAULT unaffordable config clamps the budget DOWN, not up (the Codex #8 regression)", () => {
    // The outage-resurrecting config: default CEE_DRAFT_GRAPH_THINKING_BUDGET
    // (10000) at the default affordable window (8550). Pre-2.90 this RAISED
    // max_tokens to 10000 + 1024 = 11024 > 8550 and warned-but-continued.
    const affordable = 8550;
    const r = resolveDraftThinking({ requestedBudget: 10000, affordable, derivedMaxTokens: affordable });
    expect(r.enabled).toBe(true);
    expect(r.disabled).toBe(false);
    expect(r.clamped).toBe(true);
    // Recomputed invariant: the effective request is within the affordable budget.
    expect(r.maxTokens).toBeLessThanOrEqual(affordable);
    // And thinking is a strict subset of max_tokens (Anthropic's API constraint).
    expect(r.maxTokens).toBeGreaterThan(r.budget);
    // The budget was reduced below what was requested.
    expect(r.budget).toBeLessThan(10000);
    // Recompute the reserved-output relationship rather than pinning a number.
    expect(r.budget).toBe(affordable - MIN_DRAFT_VISIBLE_OUTPUT_TOKENS);
    expect(r.maxTokens).toBe(r.budget + MIN_DRAFT_VISIBLE_OUTPUT_TOKENS);
  });

  it("a budget that already fits is passed through UNCLAMPED, max_tokens stays the derived value", () => {
    const affordable = 8550;
    const r = resolveDraftThinking({ requestedBudget: 4000, affordable, derivedMaxTokens: affordable });
    expect(r.enabled).toBe(true);
    expect(r.clamped).toBe(false);
    expect(r.disabled).toBe(false);
    expect(r.budget).toBe(4000);
    // 4000 + 1024 = 5024 < 8550, so max_tokens is left at the derived value.
    expect(r.maxTokens).toBe(affordable);
    expect(r.maxTokens).toBeGreaterThan(r.budget);
  });

  it("when affordability cannot fit the minimum thinking budget + a real answer, thinking is DISABLED (not shipped unaffordable)", () => {
    // affordable 1500 → max thinking budget 476 < the 1024 Anthropic minimum.
    const derivedMaxTokens = 1500;
    const r = resolveDraftThinking({ requestedBudget: 4000, affordable: 1500, derivedMaxTokens });
    expect(r.enabled).toBe(false);
    expect(r.disabled).toBe(true);
    expect(r.budget).toBe(0);
    // Falls back to the plain (thinking-off) derived budget, still ≤ affordable.
    expect(r.maxTokens).toBe(derivedMaxTokens);
    expect(r.maxTokens).toBeLessThanOrEqual(1500);
  });

  it("the affordability boundary is exact: minimum thinking budget fits iff affordable >= min + reserved", () => {
    const boundary = ANTHROPIC_MIN_THINKING_BUDGET_TOKENS + MIN_DRAFT_VISIBLE_OUTPUT_TOKENS;
    const justFits = resolveDraftThinking({ requestedBudget: 999999, affordable: boundary, derivedMaxTokens: boundary });
    expect(justFits.enabled).toBe(true);
    expect(justFits.budget).toBe(ANTHROPIC_MIN_THINKING_BUDGET_TOKENS);
    expect(justFits.maxTokens).toBeLessThanOrEqual(boundary);

    const justUnder = resolveDraftThinking({ requestedBudget: 999999, affordable: boundary - 1, derivedMaxTokens: boundary - 1 });
    expect(justUnder.enabled).toBe(false);
    expect(justUnder.disabled).toBe(true);
  });

  it("RECOMPUTED INVARIANT across affordable budgets and requested budgets: enabled ⇒ max_tokens ≤ affordable AND > budget", () => {
    for (const affordable of [1000, 2048, 2049, 4050, 8550, 20000]) {
      for (const requestedBudget of [1024, 4000, 10000, 32000]) {
        // derivedMaxTokens is always ≤ affordable (resolveDraftMaxTokens guarantee);
        // exercise both a tight and a full derived value.
        for (const derivedMaxTokens of [Math.min(affordable, 4096), affordable]) {
          const r = resolveDraftThinking({ requestedBudget, affordable, derivedMaxTokens });
          if (r.enabled) {
            // The load-bearing guarantee — the exact 2026-07-20 outage arithmetic
            // (effective request > affordable) is impossible.
            expect(r.maxTokens).toBeLessThanOrEqual(affordable);
            expect(r.maxTokens).toBeGreaterThan(r.budget);
            expect(r.budget).toBeGreaterThanOrEqual(ANTHROPIC_MIN_THINKING_BUDGET_TOKENS);
          } else {
            expect(r.disabled).toBe(true);
            expect(r.budget).toBe(0);
            expect(r.maxTokens).toBe(derivedMaxTokens);
            expect(r.maxTokens).toBeLessThanOrEqual(affordable);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// isDraftTruncated — one truncation policy for both providers
// ---------------------------------------------------------------------------

describe("isDraftTruncated — normalises the provider truncation signal", () => {
  it("Anthropic stop_reason=max_tokens is truncation", () => {
    expect(isDraftTruncated("max_tokens")).toBe(true);
  });
  it("OpenAI finish_reason=length is truncation", () => {
    expect(isDraftTruncated("length")).toBe(true);
  });
  it("healthy finishes are NOT truncation", () => {
    for (const ok of ["end_turn", "stop", "tool_use", "content_filter", "", null, undefined]) {
      expect(isDraftTruncated(ok)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// validateDraftThinkingAffordability — the boot-check
// ---------------------------------------------------------------------------

describe("validateDraftThinkingAffordability — fires at boot on an unaffordable ENABLED thinking config", () => {
  const affordable = getAffordableDraftTokens(DRAFT_LLM_TIMEOUT_MS);

  it("is silent when thinking is disabled, regardless of budget", () => {
    expect(validateDraftThinkingAffordability(false, 999999)).toEqual([]);
  });

  it("is silent when the enabled budget + reserved output fits the affordable envelope", () => {
    const maxFits = affordable - MIN_DRAFT_VISIBLE_OUTPUT_TOKENS;
    expect(validateDraftThinkingAffordability(true, maxFits)).toEqual([]);
    expect(validateDraftThinkingAffordability(true, maxFits - 1)).toEqual([]);
  });

  it("fires exactly at the boundary — one error carrying the DERIVED affordable value", () => {
    const overBy1 = affordable - MIN_DRAFT_VISIBLE_OUTPUT_TOKENS + 1;
    const errors = validateDraftThinkingAffordability(true, overBy1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(String(affordable));
    expect(errors[0]).toContain(String(overBy1));
  });

  it("fires on the default outage-resurrecting config (budget 10000 at the default window)", () => {
    // Guard against the specific Codex #8 config, recomputing that it is in fact
    // unaffordable at the current derived window rather than assuming it.
    if (10000 > affordable - MIN_DRAFT_VISIBLE_OUTPUT_TOKENS) {
      expect(validateDraftThinkingAffordability(true, 10000)).toHaveLength(1);
    } else {
      expect(validateDraftThinkingAffordability(true, 10000)).toEqual([]);
    }
  });
});
