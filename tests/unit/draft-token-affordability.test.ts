/**
 * Draft token affordability — the 2026-07-20 draft-outage arithmetic, closed;
 * constants recalibrated 2026-07-20 (same day) after the live probe proved the
 * original calibration survivor-biased.
 *
 * ROOT CAUSE (recurrence RCA, `parallel-briefs/DRAFT-TIMEOUT-RCA-2026-07-20.md`):
 * `anthropic.ts` hand-set draft max_tokens (default 16,384, hard floor 8,192)
 * while the timeout was DERIVED elsewhere (`config/timeouts.ts`), with nothing
 * relating the two — any generation longer than the timeout affords HUNG to
 * the timeout and 504'd. #585 fixed the MECHANISM (derive max_tokens from the
 * timeout). Its CONSTANTS, however, were sized against completed drafts only —
 * the big generations were exactly the ones that hung and never entered the
 * sample — and the live probe (S-AUDIT-2026-07-20/probe-draft-affordability.md)
 * showed 3 of 4 ordinary briefs failing at the 6,000-token budget.
 *
 * RECALIBRATION EVIDENCE (n=84 completed draft calls, Render logs 07-17..07-20,
 * both builds, plus 3 token-capped calls): duration fits
 * `13.26s + output_tokens / 101.5 tok/s` (residual sd 1.74s, max +5.17s).
 * The old flat-rate view (~71 tok/s "constant throughput") conflated the fixed
 * ~13s overhead with the marginal decode rate — effective rate RISES with
 * output size, and the three capped 6,000-token calls ran at 112–115 tok/s
 * end-to-end. Constants: overhead 15s (> fitted 13.26s + p99 residual),
 * floor 90 tok/s (fitted marginal 101.5; every one of the 84 observed calls
 * emitted its tokens FASTER than the 15s+90tok/s model requires — 0/84
 * violations — and the capped calls ran ≥111.9 effective).
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
  DRAFT_REQUEST_BUDGET_MS,
  LLM_POST_PROCESSING_HEADROOM_MS,
  DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL,
  LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR,
  getDraftLlmRetryBudgetMs,
} from "../../src/config/timeouts.js";

describe("recalibrated constants — evidence-pinned against the settled two-parameter model, not free parameters", () => {
  it("throughput floor is 90 tok/s — below the fitted marginal rate (101.5) and every capped-call rate (111.9-115.1)", () => {
    expect(DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S).toBe(90);
    // Defensible against the settled distribution: under the fitted marginal
    // rate, and under the slowest END-TO-END rate of any generation observed
    // running at the token cap.
    expect(DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S).toBeLessThan(101.5);
    expect(DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S).toBeLessThan(111.9);
  });

  it("safety overhead is 15s — above the fitted fixed overhead (13.26s) plus the worst observed residual (+5.17s at mid-size)", () => {
    // The 84-call fit puts the fixed (TTFB + prompt-processing + early slow
    // decode) overhead at 13.26s with residual sd 1.74s. 15s covers the
    // intercept; combined with the floor's margin (90 vs 101.5 marginal),
    // the model `15s + tokens/90` was SLOWER than every one of the 84
    // observed calls — the empirical p0, stronger than the p10 requirement.
    expect(DRAFT_TTFB_SAFETY_OVERHEAD_S).toBe(15);
    expect(DRAFT_TTFB_SAFETY_OVERHEAD_S).toBeGreaterThan(13.26);
  });

  it("post-LLM headroom is 10s — >5x the measured post-LLM tail (~1-2s), freeing 5s of budget for the LLM window", () => {
    // Probe measurement: success total 50.3s vs provider 48.8s (~1.5s tail);
    // failure tails ~1s. 10s remains generous for validation+repair+persist
    // spikes while raising the derived LLM window 105s -> 110s.
    expect(LLM_POST_PROCESSING_HEADROOM_MS).toBe(10_000);
  });

  it("derived DRAFT_LLM_TIMEOUT_MS is 110s at repo defaults — budget 120s minus headroom, NOT hand-set", () => {
    expect(DRAFT_REQUEST_BUDGET_MS).toBe(120_000);
    expect(DRAFT_LLM_TIMEOUT_MS).toBe(DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS);
    expect(DRAFT_LLM_TIMEOUT_MS).toBe(110_000);
  });

  it("ladder guarantee: LLM timeout + measured-generous tail stays inside the 125s browser-proxy deadline with real margin", () => {
    // 110s LLM abort + ~1.5s pre-LLM routing + ~1s typed-error tail ≈ 112.5s
    // observed-worst; the guarantee below allows 5s for each and still clears
    // the 125,000ms proxy deadline. This is the derivation of "safe max" —
    // raising the LLM window further requires either a bigger proxy deadline
    // or eating the pre-LLM/tail margin.
    const PROXY_DEADLINE_MS = 125_000;
    const PRE_LLM_ALLOWANCE_MS = 5_000;
    const TYPED_ERROR_TAIL_ALLOWANCE_MS = 5_000;
    expect(
      PRE_LLM_ALLOWANCE_MS + DRAFT_LLM_TIMEOUT_MS + TYPED_ERROR_TAIL_ALLOWANCE_MS,
    ).toBeLessThanOrEqual(PROXY_DEADLINE_MS);
  });
});

describe("getAffordableDraftTokens — derived from the timeout", () => {
  it("at the derived 110s draft LLM timeout the budget is 8550 tokens (hand-derived: (110-15)*90)", () => {
    // Independent recomputation: 110_000ms → 110s wall − 15s overhead = 95s
    // of generation × 90 tok/s = 8,550 tokens. That is comfortably above the
    // proven demand floor (three ordinary briefs capped at exactly 6,000) and
    // 1.66× the largest COMPLETED draft in the 84-call sample (5,148).
    expect(getAffordableDraftTokens(110_000)).toBe(8550);
    // And the repo's actual derived timeout (default env) IS 110s, so the
    // live budget IS that value. If DRAFT_REQUEST_BUDGET_MS or the headroom
    // changes, this assertion follows the derivation, not a stale mirror.
    expect(getAffordableDraftTokens(DRAFT_LLM_TIMEOUT_MS)).toBe(
      Math.floor(
        (DRAFT_LLM_TIMEOUT_MS / 1000 - DRAFT_TTFB_SAFETY_OVERHEAD_S) *
          DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S,
      ),
    );
  });

  it("the recalibrated budget clears the PROVEN demand: every truncated live draft demanded more than 6,000 tokens", () => {
    // The probe's three failures all stopped at output_tokens == 6,000 ==
    // the old cap; demand is >= 6,000 with no observed ceiling. The budget
    // must sit comfortably above that floor, per the standing ruling
    // ("increase them significantly so this is not an issue ever again").
    expect(getAffordableDraftTokens(DRAFT_LLM_TIMEOUT_MS)).toBeGreaterThan(6_000 * 1.4);
  });

  it("RECOMPUTED INVARIANT: emitting the full budget at the conservative floor always fits inside the timeout", () => {
    // The exact inequality the outage violated: time-to-emit(budget) must be
    // ≤ the timeout, for every timeout on the ladder.
    for (const timeoutMs of [30_000, 45_000, 60_000, 90_000, 105_000, 110_000, 120_000, 300_000]) {
      const affordable = getAffordableDraftTokens(timeoutMs);
      const emitSeconds =
        affordable / DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S + DRAFT_TTFB_SAFETY_OVERHEAD_S;
      expect(emitSeconds).toBeLessThanOrEqual(timeoutMs / 1000);
    }
  });

  it("is monotone in the timeout and floors at 0 for degenerate timeouts", () => {
    expect(getAffordableDraftTokens(60_000)).toBeLessThan(getAffordableDraftTokens(110_000));
    expect(getAffordableDraftTokens(15_000)).toBe(0);
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

  it("catches the exact pre-#585 configuration: 16384 configured against the derived timeout", () => {
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
    const r = await resolveWith({}, 110_000);
    expect(r.configured).toBeNull();
    expect(r.effective).toBe(8550);
    expect(r.effective).toBe(r.affordable);
  });

  it("configured ABOVE affordability (the outage config, 16384) → clamped down to affordable", async () => {
    const r = await resolveWith({ CEE_MAX_TOKENS_DRAFT: "16384" }, 110_000);
    expect(r.configured).toBe(16384);
    expect(r.effective).toBe(8550);
  });

  it("the old 8192 floor can never exceed affordability — a very low config is floored only up to min(floor, affordable)", async () => {
    // At the recalibrated 110s window the affordable budget (8,550) now
    // exceeds the 8,192 guard floor, so a too-low config lands at the floor.
    const r = await resolveWith({ CEE_MAX_TOKENS_DRAFT: "512" }, 110_000);
    expect(r.effective).toBeLessThanOrEqual(r.affordable);
    expect(r.effective).toBe(8192); // min(floor 8192, affordable 8550)
    // And at a window the floor does NOT fit, affordability still caps it —
    // the exact 2026-07-20 outage arithmetic stays impossible.
    const tight = await resolveWith({ CEE_MAX_TOKENS_DRAFT: "512" }, 60_000);
    expect(tight.effective).toBe(tight.affordable); // (60-15)*90 = 4050 < 8192
    expect(tight.effective).toBe(4050);
  });

  it("derivation follows the ACTUAL call-site timeout (opts.timeoutMs), not a global", async () => {
    // 45s timeout → (45-15)*90 = 2700 affordable.
    const r = await resolveWith({}, 45_000);
    expect(r.affordable).toBe(2700);
    expect(r.effective).toBe(2700);
  });

  it("RECOMPUTED INVARIANT across timeouts and configs: effective ≤ affordable, and effective is API-valid (≥1)", async () => {
    for (const timeoutMs of [20_000, 45_000, 110_000, 240_000]) {
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

  // ── Runaway sentinel (design i, lean-retry reachability 2026-07-21) ──────
  //
  // The ceiling caps the attempt-1 max_tokens ABOVE the observed convergent
  // demand and BELOW the affordable budget, so a runaway truncates earlier
  // while healthy drafts are untouched. The ceiling can ONLY lower the budget.

  it("a ceiling BELOW affordability caps the effective budget to the ceiling (attempt-1 sentinel binds)", async () => {
    const r = await resolveWithCeiling({}, 110_000, DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL);
    expect(r.affordable).toBe(8550); // the timeout still affords 8,550
    expect(r.effective).toBe(DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL); // but the sentinel binds
    expect(r.effective).toBeLessThan(r.affordable);
  });

  it("a ceiling ABOVE affordability is a no-op — it can never raise the budget past what the timeout affords (#585 coherence preserved)", async () => {
    // 45s window affords (45-15)*90 = 2,700; a 6,800 ceiling must not raise it.
    const r = await resolveWithCeiling({}, 45_000, DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL);
    expect(r.affordable).toBe(2700);
    expect(r.effective).toBe(2700);
    expect(r.effective).toBeLessThanOrEqual(r.affordable);
  });

  it("a zero/negative ceiling is treated as absent (>0 guard) → no cap; a tiny positive ceiling still floors to the API-valid minimum of 1", async () => {
    // A non-positive ceiling means "no sentinel" — falls back to affordable.
    const rNone = await resolveWithCeiling({}, 110_000, 0);
    expect(rNone.effective).toBe(rNone.affordable);
    const rNeg = await resolveWithCeiling({}, 110_000, -5);
    expect(rNeg.effective).toBe(rNeg.affordable);
    // A positive ceiling of 1 binds, but never drops below the API minimum.
    const rOne = await resolveWithCeiling({}, 110_000, 1);
    expect(rOne.effective).toBe(1);
  });

  it("RECOMPUTED INVARIANT: effective ≤ min(affordable, ceiling) for every ceiling/timeout combination", async () => {
    for (const timeoutMs of [30_000, 60_000, 110_000, 240_000]) {
      for (const ceiling of [1_000, 6_800, 8_000, 50_000]) {
        const r = await resolveWithCeiling({}, timeoutMs, ceiling);
        expect(r.effective).toBeLessThanOrEqual(r.affordable);
        expect(r.effective).toBeLessThanOrEqual(ceiling);
        expect(r.effective).toBeGreaterThanOrEqual(1);
      }
    }
  });

  async function resolveWithCeiling(env: Record<string, string>, timeoutMs: number, ceiling: number) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const { resolveDraftMaxTokens } = await import("../../src/adapters/llm/anthropic.js");
    return resolveDraftMaxTokens(timeoutMs, ceiling);
  }
});

// ---------------------------------------------------------------------------
// Lean-retry reachability arithmetic (2026-07-21) — the inequality must close
// ---------------------------------------------------------------------------

describe("lean-retry reachability — the sentinel frees a window the retry can complete in", () => {
  // Observed demand facts (S-AUDIT-2026-07-20 + 21-Jul HANDOVER):
  const WORST_CONVERGENT_TOKENS = 6_365; // largest converged draft observed ("long")
  const CONVERGED_BAND_TOP_TOKENS = 2_601; // top of the healthy converged band (12-14 nodes)
  const OBSERVED_RUNAWAY_TOK_PER_S = 112; // runaway-regime decode rate (8,550 truncated ~76s)
  const OBSERVED_TTFB_S = 2;
  const BUDGET_MINUS_HEADROOM_S =
    (DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS) / 1000; // 110s LLM window

  it("the sentinel does NOT truncate the worst observed convergent draft, and IS below the affordable budget", () => {
    // Above the worst healthy draft (with margin) → healthy drafts unharmed.
    expect(DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL).toBeGreaterThan(WORST_CONVERGENT_TOKENS);
    // Below the affordable budget at the default window → it is the binding cap
    // for the runaway class (otherwise it would be a no-op).
    expect(DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL).toBeLessThan(getAffordableDraftTokens(DRAFT_LLM_TIMEOUT_MS));
  });

  it("the worst convergent draft (6,365 tok) still COMPLETES on attempt 1 inside the LLM window", () => {
    // Conservative model 15s + tokens/90 (over-predicts every observed call).
    const completeS = DRAFT_TTFB_SAFETY_OVERHEAD_S + WORST_CONVERGENT_TOKENS / DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S;
    expect(completeS).toBeLessThanOrEqual(BUDGET_MINUS_HEADROOM_S);
  });

  it("a runaway truncates at the sentinel EARLY enough that the freed window affords the lean floor, and the lean draft completes inside the budget", () => {
    // When a runaway hits the sentinel at the observed runaway decode rate:
    const truncS = OBSERVED_TTFB_S + DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL / OBSERVED_RUNAWAY_TOK_PER_S;
    // The runtime gate (conservative) recomputes the freed window from elapsed:
    const window = getDraftLlmRetryBudgetMs(Math.round(truncS * 1000));
    const affordable = getAffordableDraftTokens(window);
    // (a) the retry FIRES: freed window affords at least the recalibrated floor.
    expect(affordable).toBeGreaterThanOrEqual(LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR);
    // (b) the lean draft (sized to the floor) COMPLETES within the total LLM
    //     window, so the Step-11 budget guard does not discard it. Conservative
    //     completion time for a floor-sized lean draft:
    const leanCompleteS =
      DRAFT_TTFB_SAFETY_OVERHEAD_S + LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR / DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S;
    expect(truncS + leanCompleteS).toBeLessThanOrEqual(BUDGET_MINUS_HEADROOM_S);
  });

  it("REGRESSION GUARD: at the SAME sentinel truncation the PRE-recalibration 4,500 floor could NOT be met — the fix is load-bearing", () => {
    const truncS = OBSERVED_TTFB_S + DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL / OBSERVED_RUNAWAY_TOK_PER_S;
    const affordable = getAffordableDraftTokens(getDraftLlmRetryBudgetMs(Math.round(truncS * 1000)));
    // The retry is reachable now (affordable ≈ 2,906 ≥ the 2,700 floor) but
    // would have been unreachable at the old 4,500 floor — the recalibration is
    // what closes the inequality.
    expect(affordable).toBeGreaterThanOrEqual(LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR);
    expect(affordable).toBeLessThan(4_500);
    expect(LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR).toBe(2_700);
  });

  it("PIN: the floor sits just ABOVE the converged-band top (2,601) so a boundary-authorized retry cannot re-truncate on band-typical output", () => {
    // The reason the floor was raised 2,500 -> 2,700: a retry authorized at
    // EXACTLY the floor is sized to the floor. A floor BELOW the converged-band
    // top (2,601) could re-truncate a band-typical lean draft; pinned above it,
    // the boundary-authorized retry is sized above band-typical output. (This
    // assertion also fails RED at the old 2,500, since 2,500 < 2,601.)
    expect(LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR).toBeGreaterThan(CONVERGED_BAND_TOP_TOKENS);
  });
});
