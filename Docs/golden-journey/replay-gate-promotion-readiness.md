# Replay-gate promotion readiness packet (advisory → required)

**Date:** 2026-07-03 (T4 acceleration overnight lane, Payload 3)
**Status:** EVIDENCE ONLY — no branch-protection or merge-blocking change has been made.
Promotion is Paul's decision.

## What is being considered

Adding the `golden-journey-replay` workflow (`.github/workflows/golden-journey-replay.yml`,
which runs `scripts/ci/golden-journey-replay-gate.sh`) to the branch-protection
required checks for `staging`.

Note the enforcement that ALREADY exists: the same `replay-manifest.json` expectations
are asserted in-process by `tests/unit/golden-journey-harness/replay-fixtures.test.ts`,
which runs inside `pnpm test:required` in the required `CI / unit-tests` job. Promotion
of the workflow adds the OUT-OF-PROCESS check (real CLI, real exit codes, fail-closed
self-tests) as its own merge blocker — defence in depth, not first enforcement.

## Evidence collected

### CI history (advisory workflow, read-only; collected 2026-07-03)

- 23 runs total since first run 2026-07-02T12:40Z.
- **22 success, 1 cancelled, 0 failures.** The single `cancelled` (run 28614055688,
  staging, 2026-07-02T18:50Z) coincides with the five-PR merge wave that superseded its
  commit — concurrency cancellation, not a gate failure.
- **Observed flake rate: 0% over 22 completed runs.** (Replay mode is deterministic —
  no network, no service, no secrets — so flakes would indicate an infrastructure
  problem, not test variance.)

### Runtime

- CI wall-clock (last 8 runs): 27–35s per run end-to-end.
- Local (warm cache): full gate ≈ 2–3s; single fixture replay ≈ 0.28s.
- Runtime cost of requiring it: negligible against the existing required job.

### Determinism probe (local, this branch)

3 consecutive full gate runs: identical results (5/5 exits matched, 5/5
failing-invariant sets matched, 5/5 fail-closed self-tests held), exit 0 each time.

### Gate strength (this PR's changes)

- Per-invariant `expected_failing_invariants` pinning closes the mixed-invariant
  masking hole (proven: a simulated silent A11-classifier regression keeps exit=1 via
  gating A8 — invisible to exit-code pinning — and is caught by the set pin, both
  in-process and via the gate script).
- Manifest-integrity guards (fixture floor ≥ 5; ≥ 1 pinned-RED fixture) hold in both
  consumers; negative controls proved each goes red on its own violation.

## Proposed promotion criteria (for Paul to accept/adjust)

Promote when ALL of:
1. ≥ 25 completed advisory runs with **0 gate-logic failures** (currently 22/25 — on
   pace within a day or two of normal PR traffic);
2. ≥ 1 week of soak from the set-pinning change landing (it alters what the gate
   asserts, so the clock should restart from its merge);
3. no manifest churn in that week that was NOT explained by a deliberate classifier/
   fixture change in the same PR.

Then: add `golden-journey-replay` to required checks via branch protection (a
GitHub-settings change, no code), and update the ADVISORY comment block at the top of
`scripts/ci/golden-journey-replay-gate.sh` and the workflow name/comments.

## Rollback

De-list the check from branch protection. No code change needed in either direction.
