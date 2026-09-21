# V5 Step 4 — root cause hypothesis (DRAFT, pending Supabase introspection)

**Status:** Phase 3 read-only evidence gathering complete. Top hypothesis identified with high confidence from file-level analysis. **One Supabase query is required from Paul to confirm or refute before fix authorisation.**

**Companion:** [v5-step4-trace.md](v5-step4-trace.md) — full call chain, RPC contract, and table schemas.

## Top hypothesis (H1) — guest-mode NOT NULL violation in v5_handler_facts.user_id

**Mechanism:**

1. The replay harness sends NO `user_id` in its turn payloads ([sweep result: `grep -rn "user_id" tools/v5-journey-replay/`](../..) returned zero hits). It runs in guest mode.
2. `preflightEnsureScenario(scenarioId, null, …)` creates a `scenarios` row with `user_id = NULL`. This requires migration `20260422000000_v5_guest_mode_nullable_user_id.sql` to have run on staging.
3. `append_turn_atomic` reads `v_user_id := scenarios.user_id` (= NULL for guest rows).
4. **For Step 4 only**, `handler_facts` is non-empty (the run_analysis handler emits exactly one `RunAnalysisHandlerFact` — see `src/orchestrator-v5/tools/handlers/run-analysis.ts:398` and the schema in `vendor/package/dist/orchestrator/handler-fact.d.ts:48`). Steps 1–3 and Step 6 all pass `handler_facts: []` and bypass the inner FOR LOOP.
5. The inner loop (`supabase/migrations/20260422210000_v5_append_turn_atomic_graph_idempotency_fix.sql:113–129`) runs `INSERT INTO v5_handler_facts (..., user_id, ...) VALUES (..., v_user_id, ...)`. If `v5_handler_facts.user_id` still has its original `NOT NULL` constraint (per `20260417160000`), this raises Postgres `23502 not_null_violation`, the whole transaction rolls back, the RPC returns an error, `supabase-store.ts:90-95` raises `StateCommitFailedError`, `chip-click-dispatch.ts:226-235` returns `outcome: 'commit_failed'`, `route-v2.ts:288-296` returns HTTP 500 with `reason=chip_click_run_analysis_commit_failed`.

**Why this fits 100% of the evidence:**

| Evidence | Fit |
|---|---|
| Failure reproducible across all runs | ✅ Schema state is deterministic per row creation |
| Steps 1–3 pass, Step 4 fails | ✅ Only Step 4 has non-empty `handler_facts` |
| Step 6 passes after Step 4 fails | ✅ Step 6 also has empty `handler_facts` and runs after the rollback |
| `validator=turn_commit`, `boundary=B1`, `INTERNAL_ERROR` | ✅ Exact mapping of `StateCommitFailedError` from the Supabase RPC |
| `retryable: true` | ✅ Generic for any transient-looking commit failure; the underlying constraint violation is actually deterministic, but the harness/orchestrator can't tell |
| `ensureScenarioExists` succeeds (Steps 1–3 commit) | ✅ scenarios.user_id IS nullable on staging → 20260422000000 was at least partially applied to `scenarios` |

**Why I am NOT 100% certain without introspection:**

- File-level evidence shows migration `20260422000000` lines 59–60 explicitly drop NOT NULL on both `v5_conversation_turns.user_id` and `v5_handler_facts.user_id`.
- If that migration was fully applied to staging, my hypothesis is refuted and we need another mechanism.
- It is possible (and consistent with all evidence) that the migration was **partially applied** — the `scenarios.user_id` change landed but the dependent table changes did not. Postgres migrations are typically all-or-nothing within a single SQL file, but tooling errors (Supabase CLI partial failures, manual editor runs that paused mid-file, rollback that missed columns) can leave the schema in an inconsistent state.

## Read-only introspection to confirm/refute (gating evidence)

**Paul to run in Supabase SQL editor on the staging project**, paste the result back:

```sql
-- A. Column nullability on the three tables.
SELECT table_name, column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('scenarios', 'v5_conversation_turns', 'v5_handler_facts')
  AND column_name = 'user_id'
ORDER BY table_name;

-- Expected if H1 confirmed:
--   scenarios            | user_id | YES | uuid
--   v5_conversation_turns | user_id | YES | uuid
--   v5_handler_facts     | user_id | NO  | uuid     ← the smoking gun

-- B. Installed RPC body (sanity check on signature drift).
SELECT pg_get_functiondef('append_turn_atomic'::regprocedure);

-- C. Recent v5_handler_facts INSERT failures (if log retention is on).
-- (Skip if Supabase log search is unavailable.)
```

**Decision tree:**
- **A.v5_handler_facts.user_id = `NO`** → H1 confirmed. Proposed fix below.
- **A.v5_handler_facts.user_id = `YES`** AND **A.v5_conversation_turns.user_id = `YES`** → H1 refuted. Need Render server log line for the `request_id` (see "Phase 0.3 ask" in the handback) — the `<postgres error>` text from `supabase-store.ts:91` will name the next-most-likely cause (H2 below).
- **B** shows a body materially different from migration `20260422210000` → H1.5 (RPC drift) — fix is to re-apply the migration.

## Secondary hypotheses (queued, lower probability)

| # | Hypothesis | Evidence path |
|---|---|---|
| H2 | Some other `v5_handler_facts` column has a NOT NULL or CHECK constraint we missed (e.g. `payload` JSONB shape, `action_type` enum, `handler_id` enum) | Same staging log line — Postgres will name the column in the error message |
| H3 | Service-role `GRANT EXECUTE` was revoked on the `append_turn_atomic` 10-arg signature when migration 20260422210000 ran — the comment at line 135-137 says the GRANT carries forward, but a manual GRANT cleanup could have removed it | RPC error would be `42501 insufficient_privilege` — distinct from the 23502 we expect |
| H4 | `serialiseHandlerFacts` produces a JSONB shape rejected by some implicit type cast (e.g. `noop` field is missing in some path) | `supabase-store.ts:321-329` — schema enforcement on the application side makes this unlikely |
| H1.5 | Migration `20260422210000` itself was not applied; staging is still on `20260422200000` (which had the graph-update-before-INSERT idempotency bug) | Compare introspection `B` output to both migration files |

## Proposed fix (conditional on H1 confirmation)

**Type:** Versioned Supabase migration (same-repo, in `supabase/migrations/`).

**File:** `supabase/migrations/202604261300XX_v5_handler_facts_nullable_user_id_repair.sql` (timestamp pinned at run time).

**Body** (idempotent, narrowly scoped):

```sql
-- ============================================================
-- V5 Step 4 fix: ensure v5_handler_facts.user_id and
-- v5_conversation_turns.user_id are nullable on staging.
--
-- Migration 20260422000000 stated this change but staging shows
-- v5_handler_facts.user_id is still NOT NULL — likely a partial
-- application of that migration. This migration is idempotent and
-- safe to re-run if the prior one took effect.
-- ============================================================

ALTER TABLE v5_conversation_turns ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE v5_handler_facts      ALTER COLUMN user_id DROP NOT NULL;
```

**Why a fresh migration rather than re-running 20260422000000:**
- Migrations are append-only by Supabase convention; re-running an existing one is a manual operation the migration runner can't reproduce.
- A new migration with `ALTER ... DROP NOT NULL` is a no-op on columns already nullable, so it is safe regardless of staging state — including in production once promoted.

**Required test (must accompany the fix):**

`tests/integration/slice-c2-handler-facts-guest-mode.test.ts` — a test that:
1. Stubs the SupabaseSessionStore to mock the RPC layer.
2. Asserts that `commitDirectAnswer` with `handler_facts: [aRunAnalysisHandlerFact]` and a guest-mode metadata (no user_id implied) calls `append_turn_atomic` with the expected serialised payload.
3. Adds a SQL-level migration test (or, if migration tests don't exist in this repo, a runtime invariant assertion in `supabase-store.test.ts` that the RPC error does not include `not_null_violation`).

**Alternative fix (rejected):** application-side guard that drops `handler_facts` when `user_id` is null.
- Rejected because it silently loses the analysis facts — which is a regression of the "no workaround that compromises commit integrity" rule.

## Discoveries (deferred — do not bundle into this branch)

1. **API-key naming inconsistency** (Paul flagged): server side uses `ASSIST_API_KEY`, client/harness uses `OLUMI_REPLAY_API_KEY`. Both refer to the same secret. The deliberate-divergence rationale in `tools/v5-journey-replay/README.md:32` is sound for the rotation case, but the names are confusing on first encounter. Recommend a short rename — separate brief.
2. **Pre-flight `ensureScenarioExists` is fail-open** ([build-turn-context.ts:232-243](../../src/orchestrator-v5/build-turn-context.ts#L232-L243)). On RPC error this returns `{ok:true, skipped:true}` and the turn proceeds. This is documented but means a pre-existing scenario with subtle drift can pass pre-flight and fail at commit. Not a fix priority but worth tracking — separate brief.

## Halt position

**Approval gate 4a.** Awaiting:
1. Paul's introspection result (queries A, B above).
2. Optionally, the staging log line for one of the failed `request_id`s — confirms the `<postgres error>` text and discriminates H1 from H2/H3.
3. Authorisation to write the migration + test (Phase 4).
