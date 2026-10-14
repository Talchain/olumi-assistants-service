# Phase 2(a) TS derivation rehearsal

These are **unexecuted proposals**. Use an isolated, quiescent local copy of the deployed V5 schema with `append_turn_atomic_v4` and Supabase roles present. Phase 2(a) and its sweep index must be absent before either rehearsal. **no trigger, no write-blocking DDL; one concurrent index allowed (DL 87114 amendment)**. Apply the main migration inside an explicit transaction; apply the separate concurrent-index file alone, outside a transaction. Both only add objects. There are no foreign keys to existing tables, so adding typed records installs no automatic work on the shared writer. Source UUIDs are logical references; typed audit rows survive source deletion.

```sh
psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -f scripts/phase2/rehearse-a.sql
bash scripts/phase2/rehearse-a-lock.sh -h 127.0.0.1 -p 54322 -U postgres -d postgres
```

Supply passwords through `PGPASSWORD`/pgpass. The SQL rehearsal snapshots the catalogue, applies the proposal, proves every old entry is unchanged, checks RLS/grants, idempotent storage, a 25-fact historical workload, fifth-attempt poison quarantine and bounded watermark advancement, then rolls back and compares the catalogue exactly. The lock rehearsal commits the proposal temporarily, holds ACCESS EXCLUSIVE on all five new tables, and requires a real append to commit within statement_timeout 2s. It also seeds 5,000 local fact rows and ANALYZEs the source, then prints `EXPLAIN (FORMAT JSON)` of the actual stored claim query: absent-index contrast must show a facts Seq Scan; after the separate concurrent apply, the normal planner must use `analysis_run_facts_sweep_idx` and show no facts Seq Scan. No planner settings are disabled. Afterwards an anti-join finds the legacy append. It removes its synthetic scenario/data and drops the concurrent index FIRST outside a transaction, then rolls back the main proposal inside a transaction; exact catalogue comparison is required.

The durable singleton stores `(processed_at, processed_id)`, a 30-second lease token and the current window boundary. Claims inspect at most 20 source facts after that cursor, in created_at/id order, then anti-join typed/quarantine dispositions. Finish advances only the contiguous terminal prefix; a failure retains the cursor, and a stale worker cannot finish a newer lease. A crashed worker's lease expires. Timestamp ties use UUID order. Each window and its finish inspect at most 20 source rows; depth is the pending count in that window, a lower-bound estimate, not an all-history count.

Existing append writers use DEFAULT now() timestamps. The normal claim horizon stops before other open transactions' start times, protecting late commits; prepared transactions pause advancement entirely. Hourly reconciliation and operator `--reconcile` recover facts imported or clock-skewed behind the cursor. Their anti-join has no watermark, uses the partial index's exact `action_type = 'run_analysis' AND NOT noop` predicate, orders by created_at/id and returns at most 20 missing dispositions per pass. It can walk older terminal index entries; the result cap does not bound that scan work. Reconciliation shares the durable lease and releases it without updating either watermark column. No explicit existing-table locks or writes are needed by either sweep. The SQL rehearsal imports a backdated fact after advancement, proves the normal sweep skips it and reconciliation returns/stores it with the watermark unchanged.

The ONE mapper is `typed-run-rows.ts`. Every stored Run remains `scenario_revision=NULL, revision_source='legacy_unknown'` until commit B stamps the evaluated revision. Storage RPCs only insert already-mapped values. Per-fact storage/quarantine failures increment a durable counter; the fifth non-unique failure quarantines the last compact error. Unique collisions are terminal duplicate-identity quarantines. Failure bookkeeping itself requires an available database. No payload is copied into quarantine.

Only stores wired with the explicit derivation RPC port perform background work. App readiness starts the 60-second interval outside tests; once an hour an idle tick runs reconciliation instead of the normal sweep. If busy, reconciliation remains due for the next tick. App close stops the timer and cancels pending nudges. Constructors/imports start no timer, including the hourly pass; tests must start it explicitly. Normal sweeps, reconciliation and post-append nudges share one in-process flight; none is awaited by turn responses. A summary event per pass records mode, bounded depth/oldest estimates, attempts and disposition counts.

For an authorised operator backfill after applying the proposal:

```sh
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node --import tsx scripts/phase2/backfill-typed-runs.ts
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node --import tsx scripts/phase2/backfill-typed-runs.ts --reconcile
```

The job does not run in CI. Default mode uses capped windows from the durable cursor, whose initial value is -infinity. `--reconcile` loops no-watermark anti-join passes until empty and logs each pass through the same drain, leaving the cursor unchanged. Rerun after transient errors/lease expiry. The 31-case TS golden corpus remains pinned; the typed reader stays dormant and shares freshness ordering.

DL apply order (only after explicit deployment approval; these commands are not run by CEE here):

```sh
psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres --single-transaction -f supabase/migrations/20261009010000_phase2_a_typed_runs.sql
psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/migrations/20261009010100_phase2_a_sweep_index.sql
psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.analysis_run_facts_sweep_idx'::regclass"
```

`indisvalid` must be true. If false, run the index rollback alone (`DROP INDEX CONCURRENTLY`), then retry the index migration and post-check. `IF NOT EXISTS` does not repair an invalid existing index. SHARE UPDATE EXCLUSIVE does not conflict with normal INSERT/UPDATE/DELETE writers; concurrent builds can wait on other maintenance/transactions. Enable sweeps only after the valid-index post-check.

Rollback order:

```sh
psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/migrations/rollback/20261009010100_phase2_a_sweep_index_rollback.sql.do-not-apply
psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres --single-transaction -f supabase/migrations/rollback/20261009010000_phase2_a_typed_runs_rollback.sql.do-not-apply
```
