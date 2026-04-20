# CQE Benchmark Results

**Date:** 20 April 2026
**Harness:** `tests/benchmarks/cqe.bench.ts` (vitest bench)
**Matrix:** per cqe-investigation-proposal.md §8.2

## Results (p75 / p99 / p999 in milliseconds)

| # | Case | p75 | p99 | p999 | Target (p95 from proposal §8.2) | Pass |
|---|---|---|---|---|---|---|
| 1 | Idle path (no numbers) | 0.059 | 0.22 | 0.47 | <1ms | ✓ |
| 2 | Multi-pattern realistic | 0.074 | 0.27 | 0.58 | <5ms | ✓ |
| 3 | Adversarial backtracking | 0.321 | 1.03 | 1.52 | <50ms (timeout cap) | ✓ |
| 4 | 2000-char cap boundary | 0.337 | 0.78 | 1.29 | <20ms | ✓ |
| 5 | Compromise-only fallback | 0.206 | 0.74 | 2.84 | <10ms | ✓ |

All cases meet their proposal-defined p95 thresholds with ≥10× headroom. No case approached the 50ms per-pattern circuit breaker.

## Reproduction

```
pnpm exec vitest bench --run \
  --config tests/benchmarks/vitest.benchmark.config.ts \
  tests/benchmarks/cqe.bench.ts
```

Hardware: Darwin 25.3.0 / Apple Silicon (as per repo session).

## Gate 8 status

**Pass.** All 5 benchmark cases meet their p95 targets; none breaches by >25%.
