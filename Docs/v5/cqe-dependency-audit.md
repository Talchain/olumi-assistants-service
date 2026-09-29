# CQE Dependency Audit (Gate 11)

**Date:** 20 April 2026
**Brief:** cqe-implementation-v1.1 §6 Gate 11

Three new dependencies introduced by CQE Phase 1. Each checked against the Gate 11 criteria: licence compatibility, vulnerability scan, Node runtime compatibility, bundle-size impact.

## Summary

| Package | Version | Licence | Scope | Node engine | CQE-dep vulns (high/critical) | Installed size |
|---|---|---|---|---|---|---|
| `compromise` | 14.15.0 | MIT | runtime | `>=12.0.0` | 0 | ~8.3 MB |
| `compromise-numbers` | 1.4.0 | MIT | runtime | `>=12.0.0` (inherits) | 0 | ~7.9 MB |
| `fast-check` | 3.23.2 | MIT | dev | `>=8.0.0` | 0 | ~8.8 MB |

**All three pass Gate 11.**

## Licence compatibility

All three are MIT-licensed. CEE's license terms are UNLICENSED per package.json but the internal policy (proposal §3.1) accepts MIT/Apache-2.0/ISC/BSD. MIT is green.

## Vulnerability scan

`pnpm audit --prod --json` filtered to the three new deps: **zero advisories** across all severities. The repo's existing 20 advisories (9 moderate + 11 high) are pre-existing and unrelated to CQE (fastify, artillery, etc).

## Node runtime compatibility

CEE pins `engines.node: >=20.0.0`. All three deps require `>=8.0.0` or `>=12.0.0`. Fully compatible.

## Bundle-size impact

Installed sizes (disk, via `.pnpm` store):
- compromise: 8,464 KB
- compromise-numbers: 8,104 KB (bundles compromise grammar assets)
- fast-check: 9,064 KB (dev-only, not in production bundle)

Production runtime impact (compromise + compromise-numbers) is the material number. The per-turn CPU cost was benchmarked in `tests/benchmarks/cqe-results.md` at p99 under 1ms across all five proposal §8.2 cases, well under the <5ms CQE target for sub-500-char messages. Cold-start import cost is one-time at server boot and not counted in per-turn p95.

## Verdict

Gate 11 passes. No blocking concerns.
