/**
 * Draft token affordability — the 2026-07-20 draft-outage arithmetic, closed.
 *
 * ROOT CAUSE (recurrence RCA, `parallel-briefs/DRAFT-TIMEOUT-RCA-2026-07-20.md`):
 * `anthropic.ts` hand-set draft max_tokens (default 16,384, hard floor 8,192)
 * while the timeout was DERIVED elsewhere (`config/timeouts.ts`, 105s), with
 * nothing relating the two. At the measured ~71 tok/s, 105s affords ~7,450
 * tokens — the 8,192 FLOOR alone needed 115s, so any long generation HUNG to
 * the timeout instead of completing. Throughput was CONSTANT across both
 * outage windows and the prior day (70.8–71.2 tok/s, sd 1.7–3.0): the model
 * was never the lever; the un-derived token budget was.
 *
 * THE FIX: the affordable token budget is derived FROM the timeout
 * (`getAffordableDraftTokens`), the effective draft max_tokens can never
 * exceed it (`resolveDraftMaxTokens`), and boot asserts the relationship
 * (`validateDraftTokenAffordability`).
 *
 * These tests RECOMPUTE the invariants rather than restating the constants:
 * the load-bearing assertions derive completion time from the returned budget
 * and check it fits inside the timeout that produced it.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S,
  DRAFT_TTFB_SAFETY_OVERHEAD_S,
  getAffordableDraftTokens,
  validateDraftTokenAffordability,
  DRAFT_LLM_TIMEOUT_MS,
} from "../../src/config/timeouts.js";

describe("conservative constants — evidence-pinned, not free parameters", () => {
  it("throughput floor is 60 tok/s — below every measured window (70.8–71.2 tok/s, sd ≤ 3.0)", () => {
    // 60 is >3 standard deviations below the SLOWEST mean ever measured
    // (70.8 tok/s, 2026-07-19). A generation at the derived budget therefore
    // completes inside the timeout even at a throughput excursion worse than
    // anything observed across two days, both pods, and both builds.
    expect(DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S).toBe(60);
    expect(DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S).toBeLessThan(70.8 - 3 * 3.0);
  });

  it("safety overhead is 5s — covers TTFB + network on top of an already end-to-end throughput figure", () => {
    // The measured 71 tok/s figures are output_tokens / total wall time, so
    // TTFB and network are already folded into the rate. Reserving a further
    // 5s on top of the 15% throughput discount is deliberate double margin:
    // observed network overhead on sibling calls is ~0.2–0.45s.
    expect(DRAFT_TTFB_SAFETY_OVERHEAD_S).toBe(5);
  });
});

describe("getAffordableDraftTokens — derived from the timeout", () => {
  it("at the current 105s draft LLM timeout the budget is 6000 tokens (hand-derived: (105-5)*60)", () => {
    // Independent recomputation: 105_000ms → 105s wall − 5s overhead = 100s
    // of generation × 60 tok/s = 6,000 tokens. That is 1.45× the largest
    // draft ever observed (4,136 tokens) and needs ~89.5s at the measured
    // 71 tok/s — comfortably inside the 105s cap.
    expect(getAffordableDraftTokens(105_000)).toBe(6000);
    // And the repo's actual derived timeout (default env) is 105s, so the
    // live budget IS that value. If DRAFT_REQUEST_BUDGET_MS or the headroom
    // changes, this assertion follows the derivation, not a stale mirror.
    expect(getAffordableDraftTokens(DRAFT_LLM_TIMEOUT_MS)).toBe(
      Math.floor(
        (DRAFT_LLM_TIMEOUT_MS / 1000 - DRAFT_TTFB_SAFETY_OVERHEAD_S) *
          DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S,
      ),
    );
  });

  it("RECOMPUTED INVARIANT: emitting the full budget at the conservative floor always fits inside the timeout", () => {
    // This is the exact inequality the outage violated: the pre-fix 8,192
    // floor implied 8192/60 + 5 ≈ 141.5s against a 105s timeout. For every
    // timeout on the ladder, time-to-emit(budget) must be ≤ the timeout.
    for (const timeoutMs of [30_000, 45_000, 60_000, 90_000, 105_000, 120_000, 300_000]) {
      const affordable = getAffordableDraftTokens(timeoutMs);
      const emitSeconds =
        affordable / DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S + DRAFT_TTFB_SAFETY_OVERHEAD_S;
      expect(emitSeconds).toBeLessThanOrEqual(timeoutMs / 1000);
    }
  });

  it("is monotone in the timeout and floors at 0 for degenerate timeouts", () => {
    expect(getAffordableDraftTokens(60_000)).toBeLessThan(getAffordableDraftTokens(105_000));
    expect(getAffordableDraftTokens(5_000)).toBe(0);
    expect(getAffordableDraftTokens(0)).toBe(0);
  });
});

describe("validateDraftTokenAffordability — the boot assertion (never again)", () => {
  it("passes when draft max_tokens is unconfigured (runtime derives the affordable value)", () => {
    expect(validateDraftTokenAffordability(null)).toEqual([]);
  });

  it("passes when the configured value is affordable at the current timeout", () => {
    const affordable = getAffordableDraftTokens(DRAFT_LLM_TIMEOUT_MS);
    expect(validateDraftTokenAffordability(affordable)).toEqual([]);
    expect(validateDraftTokenAffordability(affordable - 1)).toEqual([]);
  });

  it("fails LOUD when the configured value exceeds affordability — deriving BOTH numbers, not restating them", () => {
    const affordable = getAffordableDraftTokens(DRAFT_LLM_TIMEOUT_MS);
    const errors = validateDraftTokenAffordability(affordable + 1);
    expect(errors).toHaveLength(1);
    // The message must carry the derived affordable value and the derived
    // timeout — recomputed from the real config, so an env override of
    // DRAFT_REQUEST_BUDGET_MS changes the asserted numbers with it.
    expect(errors[0]).toContain(String(affordable));
    expect(errors[0]).toContain(String(DRAFT_LLM_TIMEOUT_MS));
  });

  it("catches the exact pre-fix configuration: 16384 configured against the 105s-derived timeout", () => {
    const errors = validateDraftTokenAffordability(16_384);
    expect(errors).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// resolveDraftMaxTokens — the runtime clamp in the adapter
// ---------------------------------------------------------------------------

describe("resolveDraftMaxTokens — effective max_tokens can NEVER exceed the affordable budget", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function resolveWith(env: Record<string, string>, timeoutMs: number) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const { resolveDraftMaxTokens } = await import("../../src/adapters/llm/anthropic.js");
    return resolveDraftMaxTokens(timeoutMs);
  }

  it("unconfigured → effective equals the affordable budget derived from the timeout", async () => {
    const r = await resolveWith({}, 105_000);
    expect(r.configured).toBeNull();
    expect(r.effective).toBe(6000);
    expect(r.effective).toBe(r.affordable);
  });

  it("configured ABOVE affordability (the outage config, 16384) → clamped down to affordable", async () => {
    const r = await resolveWith({ CEE_MAX_TOKENS_DRAFT: "16384" }, 105_000);
    expect(r.configured).toBe(16384);
    expect(r.effective).toBe(6000);
  });

  it("the old 8192 floor can never exceed affordability — a very low config is floored only up to the affordable budget", async () => {
    // Pre-fix: CEE_MAX_TOKENS_DRAFT=512 was raised to the 8,192 hard floor —
    // which needed 115s against the 105s timeout. Now the floor itself is
    // capped at affordability.
    const r = await resolveWith({ CEE_MAX_TOKENS_DRAFT: "512" }, 105_000);
    expect(r.effective).toBeLessThanOrEqual(r.affordable);
    expect(r.effective).toBe(6000); // min(floor 8192, affordable 6000)
  });

  it("derivation follows the ACTUAL timeout passed at the call site, not a global", async () => {
    // 45s timeout → (45-5)*60 = 2400 affordable.
    const r = await resolveWith({}, 45_000);
    expect(r.affordable).toBe(2400);
    expect(r.effective).toBe(2400);
  });

  it("RECOMPUTED INVARIANT across timeouts and configs: effective ≤ affordable, and effective is API-valid (≥1)", async () => {
    for (const timeoutMs of [15_000, 45_000, 105_000, 240_000]) {
      for (const cfg of [undefined, "512", "8192", "16384", "32768"]) {
        const r = await resolveWith(cfg === undefined ? {} : { CEE_MAX_TOKENS_DRAFT: cfg }, timeoutMs);
        expect(r.effective).toBeLessThanOrEqual(Math.max(1, r.affordable));
        expect(r.effective).toBeGreaterThanOrEqual(1);
        const emitSeconds =
          r.effective / DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S + DRAFT_TTFB_SAFETY_OVERHEAD_S;
        expect(emitSeconds).toBeLessThanOrEqual(Math.max(timeoutMs / 1000, DRAFT_TTFB_SAFETY_OVERHEAD_S + 1));
      }
    }
  });
});
