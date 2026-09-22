# AI Coaching / Core Correctness — lane state

**Updated 22 Sep 2026 14:13Z · deployed staging `a459d23aa8c19efcf6aee2de427dec835c46aa7c`**

## STATE: active — blocked only on release-control verdicts, not on work

## CURRENT TASK
Land the three remaining spine fixes and re-witness on the deployed build.
Baseline to beat: **19 PASS · 6 FAIL · 0 SKIP** (25 assertions, `BASELINE-CURRENT.md`).

## The gate, exact heads

| PR | head | required CI | needs |
|---|---|---|---|
| **#1679** single-snapshot | `41915bf3e6d84b5a8ec5288f91da3e9db9730664` | **success ×2** | exact-head verdict |
| **#1685** replay reconciliation | `4cd3ee29020694476bbe780dd13664aa447d6542` | **success** | exact-head verdict |
| **#1688** reused operation id | `b9108b0b306c552275346c924edeb12724bd3261` | queued | verdict; **merges after #1685** (stacked) |
| **#1680** goal-direction | `02627c475de45041f434c3902c62f3ceb0ab6165` | in progress | verdict; PLoT half already merged |

**#1686 is done** — merged 13:38:55Z, deployed, JOURNEY-WITNESSED with a
discriminating pair (`DEPLOYED-WITNESS-a459d23.md`).

Protection derived, not assumed: `contexts=["Lint, TypeCheck, Unit Tests"] ·
strict=false · reviews=null`. `strict:false` ⇒ `behind=1` does **not** gate.
#1679/#1685 are deliberately **not** rebased: it would invalidate the head under
review and restart ~32min of CI.

## NEXT ACTIONS (in order, once a verdict lands)
1. Merge in the order **#1685 → #1688**, then #1679, #1680 independently.
   Foreground pushes only; verify the remote with `ls-remote` **and** `gh api`.
2. Wait for the Render deploy, confirm `/healthz` `build` changed.
3. Re-run `witness/spine.mjs` signed-in. **All 25 must pass**, not just the 6.
4. Watch two rows specifically: `a CAPPED scale factor does NOT swallow a bare
   0.8` (a careless unit change turns it red) and `a reused turn_id writes
   nothing` (#1688 must fix the narration without weakening the key).

## BLOCKERS
- **Release-control exact-head verdicts.** All four PRs are NOT LOW RISK by the
  rubric (wire/commit-path changes), so self-merge is not available. Requests are
  posted on each PR and on #63. Nothing else is blocked.

## Settled — do NOT re-derive
- Priority 4 (**revision → freshness → readiness → displayed result**) **holds
  end to end**; no build work needed. CEE emits `freshness` fresh→stale with
  reason `graph_hash_match`→`graph_hash_diverged`; the UI renders it on **four
  flag-free surfaces**. `readiness` deliberately does **not** demote on
  staleness — never use `status`/`may_run` as a freshness signal.
- `freshness_reason` has **no user-facing route**; the UI's copy table has 0
  production call sites, gated on the unruled `FRESHNESS_RECEIPT_D1_MODE`.
  Release control's ruling, not this lane's.
- CEE persists `observed_state.value` for **observable/external** factors
  identically to controllable — **no CEE branch reads `category`**. The
  read-only-ness is UI-side and total. Answered to the Canvas lane on #63.
- Goal-direction reach is **1.3% of live boards**, not "every reduce-goal
  ranking". PLoT #365 landing alone is a **no-op**, not a live inversion.
- The spine witness has been wrong **three times, always optimistically**. Its
  history is in `BASELINE-CURRENT.md`. Re-read that before trusting any number.
