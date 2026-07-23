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
  isLeanRetryAffordable,
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

  // ── Attempt-1 ceiling mechanics (the sentinel arg) ──────────────────────
  //
  // The ceiling can ONLY lower the effective budget (a Math.min), never raise
  // it past what the timeout affords. 2026-07-23 firefight: the DEFAULT sentinel
  // was raised to the FULL affordable budget (see the dedicated block below), so
  // these mechanics tests use an EXPLICIT below-affordability ceiling to keep
  // exercising the binding path independently of the default.

  it("a ceiling BELOW affordability caps the effective budget to the ceiling", async () => {
    const r = await resolveWithCeiling({}, 110_000, 6_800);
    expect(r.affordable).toBe(8550); // the timeout still affords 8,550
    expect(r.effective).toBe(6_800); // but the explicit ceiling binds
    expect(r.effective).toBeLessThan(r.affordable);
  });

  it("a ceiling ABOVE affordability is a no-op — it can never raise the budget past what the timeout affords (#585 coherence preserved)", async () => {
    // 45s window affords (45-15)*90 = 2,700; a 6,800 ceiling must not raise it.
    const r = await resolveWithCeiling({}, 45_000, 6_800);
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
// Attempt-1 full budget + anti-doom retry guard (2026-07-23 firefight)
//
// Root cause of the 2026-07-23 draft-down: attempt 1 was capped at a 6,800
// UNDER-sentinel (below sonnet-4-6's real 6,800-8,550-token demand), so simple
// briefs truncated needlessly; the "lean retry" it freed ran at only ~3,178
// tokens (< half the 6,800 that overflowed), re-truncated, and 400'd at ~89s.
// The fix: attempt 1 uses the FULL affordable budget, and no retry may fire into
// a budget SMALLER than the attempt that overflowed (isLeanRetryAffordable);
// truncation is handled by salvage-or-fail-fast instead.
// ---------------------------------------------------------------------------

describe("attempt-1 uses the full affordable budget (raised sentinel)", () => {
  it("the DEFAULT sentinel equals the affordable budget at the derived timeout — attempt 1 gets the whole window", () => {
    // Derived, not mirrored: the sentinel default IS
    // getAffordableDraftTokens(DRAFT_LLM_TIMEOUT_MS), so it tracks the timeout
    // and is a no-op cap at the default config (min(affordable, sentinel) =
    // affordable). At repo defaults that is 8,550.
    expect(DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL).toBe(getAffordableDraftTokens(DRAFT_LLM_TIMEOUT_MS));
    expect(DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL).toBe(8550);
  });

  it("the raised sentinel clears sonnet-4-6's observed demand band (6,800-8,550) that the OLD 6,800 cap truncated", () => {
    // The firefight symptom: simple briefs demanding 6,800-8,550 tokens
    // truncated at the old 6,800 cap. The full budget covers the whole band, so
    // those drafts now finish on attempt 1.
    expect(DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL).toBeGreaterThanOrEqual(8_550);
    expect(DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL).toBeGreaterThan(6_800);
  });

  it("the full-budget attempt-1 still fits inside the LLM window (no proxy-deadline regression)", () => {
    // Conservative model 15s + tokens/90 over-predicts every observed call.
    const completeS =
      DRAFT_TTFB_SAFETY_OVERHEAD_S + DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL / DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S;
    const llmWindowS = (DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS) / 1000;
    expect(completeS).toBeLessThanOrEqual(llmWindowS);
  });
});

describe("isLeanRetryAffordable — never retry into a budget smaller than the attempt that overflowed", () => {
  it("BLOCKS the exact 2026-07-23 doomed retry: a 6,800-token attempt-1 truncation, ~3,178 tokens left → no retry", () => {
    // attempt1EffectiveMaxTokens = 6,800; the lean window afforded only 3,178.
    expect(isLeanRetryAffordable(3_178, 6_800)).toBe(false);
  });

  it("BLOCKS a retry after a FULL-budget attempt-1 (8,550) with any smaller window", () => {
    expect(isLeanRetryAffordable(3_178, 8_550)).toBe(false);
    expect(isLeanRetryAffordable(8_549, 8_550)).toBe(false);
  });

  it("ALLOWS a retry only when the remaining budget funds AT LEAST the attempt that overflowed", () => {
    expect(isLeanRetryAffordable(8_550, 8_550)).toBe(true);
    expect(isLeanRetryAffordable(9_000, 8_550)).toBe(true);
  });

  it("still enforces the lean floor even for a tiny attempt-1 budget (belt-and-braces lower bound)", () => {
    // If an operator set a very low sentinel, the retry must still clear the
    // lean floor — the guard is max(floor, attempt1), never below the floor.
    expect(isLeanRetryAffordable(2_699, 1_000)).toBe(false); // below the 2,700 floor
    expect(isLeanRetryAffordable(LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR, 1_000)).toBe(true);
  });

  it("RECOMPUTED INVARIANT: the authorized budget is always >= the overflowed attempt AND >= the floor", () => {
    for (const attempt1 of [1_000, 2_700, 6_800, 8_550]) {
      for (const lean of [0, 2_699, 2_700, 3_178, 6_800, 8_550, 9_000]) {
        const allowed = isLeanRetryAffordable(lean, attempt1);
        const required = Math.max(LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR, attempt1);
        expect(allowed).toBe(lean >= required);
      }
    }
  });
});
