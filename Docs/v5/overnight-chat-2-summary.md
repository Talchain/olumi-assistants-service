# Slice B overnight summary

**Date:** 2026-04-18
**Branch:** `claude/v5-slice-b` (off `staging`, branch-base `a08f651a`)
**Head commit:** latest on this branch after this doc commits
**Status:** All 10 deliverables complete; no pushes overnight.

---

## What shipped

Every commit is **local** on `claude/v5-slice-b`. Ordered chronologically:

| # | Commit | D | Description |
|---|---|---|---|
| 1 | `3d0bf0ff` | D1 | Plan + precondition evidence (validator exit 0, tsc clean, scoped 178/178 baseline) |
| 2 | `1b2698e2` | D2 | Schemas audit — `@talchain/schemas@0.5.1` covers Slice B; no bump |
| 3 | `cd7ac47f` | D3 | Session store module (5 files: store, supabase-store, cache, invalidation, index) |
| 4 | `5a767a67` | D4 | Commit RPC + readRecent integration (commit.ts / build-turn-context.ts / turn-executor.ts surgical edits) |
| 5 | `899ff046` | D5 | 55 new unit tests across session/ + build-turn-context |
| 6 | `0549d551` | D6 | 11 integration tests against staging Supabase |
| 7 | `55be069b` | D7 | State-write invariant script + prepush wiring |
| 8 | `1dd945c3` | D8 | Audit §4.4 RPC grant validation test |
| 9 | `8a83f889` | D9 | Slice B evidence pack |
| 10 | (this doc) | D10 | This handoff |

See [Docs/v5/slice-b-evidence-pack.md](slice-b-evidence-pack.md) for the full artefact + gate matrix.

---

## What halted

**Nothing.** Every deliverable reached `proceed` on both self-review rounds. One mid-work blocker surfaced and was resolved without Paul input:

- D4 initially broke two A0/A1/A2 integration fixture tests because they transitively hit a real `getSessionStore()` via the HTTP route. Root cause: `vi.mock('../session/index.js')` needed to be added to those test files — matching the existing pattern for LLM router / prompt loader mocks. Fixed in the D4 commit itself; 4 failed → 0 passed before commit.

---

## Metrics

### Test count trajectory

| Gate | Scoped (no env) | Full (with env) |
|---|---|---|
| D1 baseline | 178 / 178 | — |
| D4 | 183 / 183 | — |
| D5 | 238 / 238 | — |
| D6 | 238 / 238 | 249 / 249 |
| D8 | 238 / 238 | 250 / 250 |

Monotonic up at every deliverable boundary. No A0/A1/A2 regression.

### Supabase round-trip observations (from D6 integration tests)

| Test | RPC calls | SELECT calls | DELETE calls (cleanup) |
|---|---|---|---|
| persistence — two-turn flow | 1 | 2 | 1 |
| persistence — order preserved | 3 | 1 | 3 (batch) |
| invalidation — scoped | 1 | 3 | 1 |
| invalidation — full | 1 | 2 | 1 |
| commit-failure — invalid scenario | 1 | 0 | 0 |
| concurrent-writes — Promise.all (DoD) | 2 | 1 | 1 |
| concurrent-writes — sequential 3× | 3 | 1 | 1 |
| RPC grant (audit §4.4) | 1 | 0 | 0 |

All 11 D6 + D8 integration tests completed in ~8.5s cumulative tests-runtime. Average RPC latency against `etmmuzwxtcjipwphdola.supabase.co`: ~390ms per call (includes network + RPC body).

### Cache behaviour observed in unit tests

- LRU eviction: confirmed oldest-first eviction with access-time bump on `getScenario`
- Per-scenario bounding: confirmed at 2, 3, 5-turn caps
- Deep-freeze: mutation attempts on returned snapshot throw (recursive freeze verified)
- `complete`-flag: short-history cache serves large-limit reads when authoritative

No cache hit-rate measurements yet — that's a Slice C concern when real handler traffic starts flowing.

---

## Questions for Paul

Nothing blocking, but two decisions that would inform Slice C:

1. **StatsD counter wire for `session.read_degraded`** — the event is emitted with `severity: 'warning'`; the counter hook is named in the telemetry comment but not actually incremented via `statsd.increment(...)`. Do you want me to add the counter increment in a follow-up commit for ops alerting? The risk otherwise is that session-read failures are observable only in logs, not in Grafana/Datadog dashboards that oncall uses. Context: the pressure-test flagged this as the "silent session-loss mitigation" — I emit the event but don't yet wire the metric.
   - **Recommendation:** Wire it now (5-minute change in `src/utils/telemetry.ts`). Low-risk, closes the loop.
2. **Integration-test concurrency hardening** — one flaky `TypeError: fetch failed` observed on a full-gate run (250/250 clean on retry). Worth lowering `--maxConcurrency` on the slice-b-* integration test files, or adding a lightweight retry wrapper on the Supabase client for CI robustness?
   - **Recommendation:** Defer until CI sees it. A one-in-N local flake isn't worth complicating hermetic test design.

---

## Blockers

**None** outside your review. All external state is in place:

- Migration applied (you did this yesterday)
- Env exported in this shell session (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `TEST_SCENARIO_ID`)
- `TEST_SCENARIO_ID=f5a9fa2b-3aae-4562-96e9-7589a4ae85a5` still valid in `public.scenarios`

---

## Deferred items — carried to Slice C

Named in [slice-b-evidence-pack.md §8](slice-b-evidence-pack.md) — summary:

1. Handler-fact RPC-shape adapter (`serialiseHandlerFacts` exists; first fact-emitting handler exercises it)
2. Scoped invalidation refinement — fact-indexed eviction once facts exist
3. `GraphInvalidationSchema` ↔ internal `InvalidationScope` mapper at any PLoT→CEE wire boundary
4. StatsD counter wire for `session.read_degraded` (Question 1 above)
5. Session-read retry/concurrency hardening (Question 2 above)
6. Schema 0.5.2 bump — no pressure yet; revisit when Slice C handlers land

---

## Operational follow-ups

1. **Rotate staging `service_role` key.** Audit §9 + plan deferred this until D8's grant test passed. Green light as of `1dd945c3` / this branch. You do this via the Supabase dashboard.
2. **Production migration application** happens before Slice C ships any handler that writes via the RPC. Staging-only for Slice B.

---

## Push recommendation

Commits are **all local**. Nothing has been pushed. Suggested order once you approve:

```bash
# 1. Confirm you're on claude/v5-slice-b
git branch --show-current    # expect claude/v5-slice-b

# 2. Re-run the full gate locally (optional — already green on 8a83f889)
pnpm exec tsc -p tsconfig.build.json --noEmit
bash scripts/validate-state-write-invariant.sh
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
  TEST_SCENARIO_ID=f5a9fa2b-3aae-4562-96e9-7589a4ae85a5 \
  pnpm exec vitest run src/orchestrator-v5 tests/integration/slice-b-*

# 3. Push the branch (single push, all 10 commits)
git push -u origin claude/v5-slice-b

# 4. Open PR against staging
gh pr create --base staging --title "v5 slice B: session persistence layer" \
  --body "$(cat Docs/v5/slice-b-evidence-pack.md)"
```

**No force-push, no rebase of shared history.** The branch is clean linear history from `a08f651a`.

---

## One-sentence summary

Slice B is complete: SessionStore interface with Supabase + LRU, `append_turn_atomic` wired through commit.ts, `readRecent` in build-turn-context with graceful degradation, all three DoD items have passing integration tests against staging, audit §4.4 obligation closed, invariant script guards the write surface, 72 new tests landed, zero A0/A1/A2 regression, zero pushes overnight — awaiting your review.
