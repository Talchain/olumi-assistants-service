# CI at SHA — PR #957 (2026-08-14)

Head SHA queried EXACTLY (trap 24: never a cached rollup, never an unpinned read):
`4e4559dcd9be5e2f7904e9f0ae428c99b70e6435`
`mergeable=MERGEABLE` (not DIRTY) · base `staging`.

Polled to conclusion in the FOREGROUND. Filter reads `.status == "completed"`
FIRST, then `.conclusion`, so an in-flight check is never bucketed as a failure
(trap 24b).

## Required contexts — DERIVED, not assumed
```
gh api repos/Talchain/olumi-assistants-service/branches/staging/protection \
  --jq '.required_status_checks.contexts'
=> ["Lint, TypeCheck, Unit Tests"]
```
**Exactly one required context. It is SUCCESS.**

## Result: 18 completed success · 1 completed failure · 0 running
`Lint, TypeCheck, Unit Tests` **success** (the required gate) ·
`Full Test Suite (advisory)` **success** · `Live LLM Integration Tests` success ·
`Golden Journey Replay (advisory)` success · `Typecheck Drift (ratchet)` success ·
CodeQL, Snyk, Dependency Review, OpenAPI, check-schemas, validate-event-names,
Performance Gate, SSE gate, Test-skip inventory — all success.

## The one failure is a PRE-EXISTING STANDING RED, proven by control
`Security Audit` — **NOT a required context**, and read at the job rather than
re-stated from the registry (trap 7b: the registry's one-line label for this job
has been wrong before and taught lanes to stop looking).

**CONTROL (the decisive evidence):** the same job is `completed / failure` on the
**pristine staging head `ae0b4af8e403de5b1663c27425cfe5a140f65f32`** — a commit
this PR did not touch. Pre-existing, not introduced.

**Second, independent control:** this PR's diff contains **zero** dependency-surface
files (`git diff --name-only origin/staging...HEAD` → no `package.json`,
`pnpm-lock`, `pnpm-workspace`, `vendor/`), so a dependency-advisory red cannot
originate here. Diff is 4 source/doc files + 2 evidence docs.

⚠ Deliberately NOT recording this job's advisory counts: per CLAUDE.md they are
stale the moment written. Read the job log at your head.

## Local gate (the fast proxy — necessary, never sufficient)
`pnpm test:required` 1682 files / **29,225 passed / 0 failed** ·
`pnpm typecheck` clean · `pnpm lint` **0 errors** (2 warnings, both pre-existing
in files outside this lane's diff) · `pnpm build` clean.
Run as the required check's STEP SEQUENCE (lint → typecheck → tests), not tests
alone (trap 22e).
