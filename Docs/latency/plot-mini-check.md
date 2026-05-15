# PLoT / `run_analysis` Variance — Mini-Check

**Date:** 2026-05-14
**Trigger:** Phase 0 live samples showed `run_analysis` wall clock 4.4–19.5 s (mean 13.1 s, n=9) — wider than expected for a non-LLM handler. This note answers three short questions on whether the variance is plausibly infrastructure rather than code.

> No infrastructure changes recommended. This is a read-only note. The deferred actions live in the observability PR.

## What we know now

- The V5 `run_analysis` handler makes **zero LLM calls** ([src/orchestrator-v5/tools/handlers/run-analysis.ts](../../src/orchestrator-v5/tools/handlers/run-analysis.ts) — confirmed by `llm_calls_used: 0` and the inventory at [Docs/v5/v5-llm-call-site-inventory.md](../v5/v5-llm-call-site-inventory.md)).
- The only outbound dependency on the handler critical path is `plotClient.run(...)` — the HTTP round-trip to the PLoT service. Everything else is sub-second deterministic work (scenario read, Zod parse, hash compute, commit).
- Local tests of the handler itself complete in <100 ms with a mocked PLoT client. The 4–20 s range is entirely outside the handler's CPU envelope.

## Q1 — Is PLoT staging on a free/sleeping Render tier?

**Unverified from this repo.** The PLoT service is hosted separately; this repo does not contain Render dashboard URLs or plan metadata. The CEE service has `degraded: false` on `/healthz` (confirmed during Phase 0 sampling against build `7872102`), but `/healthz` reports CEE deploy state, not PLoT.

**To answer authoritatively** (outside this PR):
- Check the Render dashboard for the PLoT service. Free / individual / cron tiers sleep after idle; "Standard" and up stay warm.
- If PLoT is on a sleep-eligible tier, a cold start can easily account for 5–15 s of warm-up before any compute begins.

## Q2 — Is there evidence of cold starts in the Phase 0 data?

**Suggestive, not conclusive.** The 5-canonical-run / 5-dl7-run sample distribution shows:

| Source | `run_analysis` elapsed (ms) |
|--------|------------------------------|
| canonical-1 | 5832 |
| canonical-2 | 11565 |
| canonical-3 | 4357 |
| canonical-4 | 17315 |
| canonical-5 | 16238 |
| dl7-1 | 16730 |
| dl7-2 | 16263 |
| dl7-3 | 19545 |
| dl7-5 | 9760 |

The fast samples (4.4 s, 5.8 s) cluster at the beginning of the staggered batch; later samples skew high. That's the opposite of a classic "first call cold, then warm" pattern — which suggests **concurrency contention** more than cold start. Ten concurrent PLoT runs against the same staging instance is unusual for the day-to-day workload and likely starves a single-instance worker pool.

Counter-evidence: canonical-3 (4.4 s) ran *after* canonical-1 and canonical-2 (both >5.8 s) — the 4.4 s isn't a first-hit cold. So the pattern is noisy, not strictly serial.

Without per-call PLoT-side metrics, we cannot disambiguate (a) PLoT compute time vs. (b) Render dyno wake-up vs. (c) HTTP queueing inside Render. The observability PR adds `plot_request_ms` and a `plot_slow_likely` heuristic to the response envelope so this distinction becomes routinely visible in future replay runs. (The field was originally named `plot_cold_likely` in the first draft; renamed during review to avoid implying a definitive cold-start diagnosis — the heuristic only knows "above/below 8 s".)

## Q3 — Would a keep-warm ping or plan change likely reduce the variance?

**Probably yes, with caveats:**

- **If PLoT is on a sleep-eligible tier:** a periodic `/healthz` ping (60–90 s interval) is the cheapest fix. Eliminates dyno spin-down. Cost: negligible on Render's pricing; saves 5–15 s on the first request after idle.
- **If PLoT is on Standard or higher and never sleeps:** the variance is more likely PLoT-internal (e.g. Monte Carlo iteration count varying with graph size, or a slow Supabase read inside PLoT). Keep-warm doesn't help; the fix is on the PLoT side.
- **Plan change to Pro/Performance:** more headroom for concurrency, but only justified if observed concurrency contention is real and recurring. Phase 0's 10 parallel runs is a synthetic stress; production traffic per second is likely lower.

**Recommendation:** wait until the observability PR ships and re-run Phase 0 with `V5_TIMING_DEBUG=true` on staging. Then the `_timings.run_analysis.{plot_request_ms, plot_slow_likely}` fields tell us directly whether the dominant time is the HTTP round-trip or something on this side. Only then make an infrastructure decision.

## What this audit does NOT recommend (and why)

| Tempting action | Why we are NOT recommending it |
|-----------------|---------------------------------|
| Move PLoT to a paid tier today | Variance is real but unattributed. Wait for `plot_request_ms` signal. |
| Add a keep-warm cron now | Same as above — easy win IF cold start is the cause, but we don't know yet. |
| Add a client-side timeout to fail-fast on PLoT >15 s | A handler-level cap exists ([budgets.ts: handler 45 s, turn 180 s](../../src/orchestrator-v5/budgets.ts)). Tightening it without data risks legitimate slow runs failing. |
| Parallelise the V5 turn so commit overlaps with PLoT | Separate brief — touches the commit-deferred consistency contract. |

## Action items for the next pass (after observability PR ships)

1. Re-run Phase 0 with `V5_TIMING_DEBUG=true` on staging. Expect `_timings.run_analysis.plot_request_ms` in every evidence row.
2. If `plot_request_ms` is consistently >70% of handler total, the variance is PLoT-side. If <30%, it's CEE-side commit/Supabase.
3. Cross-check `plot_slow_likely:true` rate. Above ~20% → ask whether the PLoT Render service is on a sleeping tier (cold start) or struggling with concurrency / large graphs (the heuristic doesn't disambiguate these — investigate which).
4. Once attributed, open the appropriate brief (keep-warm cron, PLoT optimisation, or commit-deferral analysis).
