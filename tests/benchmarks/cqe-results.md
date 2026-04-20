# CQE Benchmark Results

**Date:** 20 April 2026
**Harness (primary):** `tests/benchmarks/cqe.bench.ts` (vitest bench)
**Harness (p95 explicit):** `tests/benchmarks/cqe-p95-bench.ts` (programmatic — vitest bench reports p75 and p99 but not p95)
**Matrix:** per cqe-investigation-proposal.md §8.2

---

## Explicit p95 results (addresses brief §8 Gate 8 + ChatGPT review P1.3)

| # | Case | samples | p50 | p75 | **p95** | p99 | p999 | target p95 | breach % | pass |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Idle path (no numbers) | 2000 | 0.078 | 0.088 | **0.120** | 0.285 | 0.633 | <1ms | -88.0% | ✓ |
| 2 | Multi-pattern realistic | 1000 | 0.097 | 0.107 | **0.163** | 0.419 | 1.373 | <5ms | -96.7% | ✓ |
| 3 | Adversarial backtracking | 1500 | 0.287 | 0.311 | **0.432** | 0.546 | 0.782 | <50ms | -99.1% | ✓ |
| 4 | 2000-char cap boundary | 400 | 0.321 | 0.451 | **0.475** | 0.599 | 0.667 | <20ms | -97.6% | ✓ |
| 5 | Compromise-only fallback | 400 | 0.202 | 0.211 | **0.304** | 0.364 | 0.462 | <10ms | -97.0% | ✓ |

All times in milliseconds. **Breach %** = `(p95 - target) / target × 100`. Negative means margin of safety below target; positive would mean a breach.

**Gate 8 status: pass.** Every case's p95 sits more than 88% below its target. Worst-case observed is Case 4 at 47.5% of its 20ms budget; everything else is under 10% of its budget.

## Vitest-bench cross-check

Vitest `bench` output for the same five cases (truncated p-metrics, different timer resolution). Same harness, different instrument:

| # | Case | vitest-p99 | p999 | Reconciles with p95 table? |
|---|---|---|---|---|
| 1 | Idle path | 0.22 ms | 0.47 ms | ✓ (p99 > p95) |
| 2 | Multi-pattern | 0.27 ms | 0.58 ms | ✓ |
| 3 | Adversarial | 1.03 ms | 1.52 ms | ✓ |
| 4 | 2000-char cap | 0.78 ms | 1.29 ms | ✓ |
| 5 | Compromise-only | 0.74 ms | 2.84 ms | ✓ |

## Reproduction

```
# Vitest bench (emits hz + p75/p99/p995/p999):
pnpm exec vitest bench --run \
  --config tests/benchmarks/vitest.benchmark.config.ts \
  tests/benchmarks/cqe.bench.ts

# Explicit-p95 harness (tabulated output for paste-in):
pnpm exec tsx tests/benchmarks/cqe-p95-bench.ts
```

Hardware: Darwin 25.3.0 / Apple Silicon.

## Gate 8 verdict

**Pass.** All five cases meet their proposal §8.2 p95 targets with ≥88% headroom. No breach, no case approaches the 50ms per-pattern circuit breaker, and the 25% breach tolerance defined in the brief is not engaged on any case.
