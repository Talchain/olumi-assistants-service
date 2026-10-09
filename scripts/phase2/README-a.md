# Phase 2(a) TS derivation rehearsal

These are **unexecuted proposals**. Use an isolated, quiescent local copy of the deployed V5 schema, with `append_turn_atomic_v4` present and Supabase roles defined. Phase 2(a) must be absent before each rehearsal. No Docker/shared-DB apply is performed by CEE's build.

```sh
psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -f scripts/phase2/rehearse-a.sql
bash scripts/phase2/rehearse-a-lock.sh -h 127.0.0.1 -p 54322 -U postgres -d postgres
```

Supply passwords through `PGPASSWORD`/pgpass. The SQL rehearsal applies and rolls back within one transaction. It checks RLS/ACLs, the real append's enqueue discriminator, storage/quarantine idempotence, revision nullness, expired claim recovery, cascades, and exact public-catalogue restoration. The lock rehearsal temporarily commits the migration so session 2 can see the tables. It holds ACCESS EXCLUSIVE on **queue + runs + options**, then session 1 commits a real append with statement_timeout 2s. After release, it proves the enqueue was skipped and the next anti-join sweep claims the fact, then stores the TS-generated golden row. It removes its synthetic scenario/data, applies the proposal rollback, and compares exact catalogue snapshots. Production drain code never takes those adversarial table locks. Both rehearsals fail on failed conjuncts.

`rehearse-a-fixture.sql` contains output of `toTypedRunRows` for corpus 01, changing only scenario/run identity to the harness fixture. It is data, not another mapper. The SQL mapper/parity script is removed. The golden TS corpus contains 31 cases (including null snapshot option) and remains pinned by the mapper test.

For an explicitly authorised operator backfill **after applying the migration**, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then:

```sh
node --import tsx scripts/phase2/backfill-typed-runs.ts
```

This job never runs in CI. It enqueues historical non-noop Run facts and drains batches of at most 20 through `SupabaseSessionStore.deriveQueuedAnalysisRuns`. Work missed by enqueue is recoverable through queued ids UNION the fact anti-join. Claims use FOR UPDATE SKIP LOCKED plus a 30-second queue lease, with no transaction held across TS mapping. Rerun after lease expiry if interrupted or a retryable storage failure occurs. Mapper skips (currently refusal markers) get compact terminal disposition reasons in quarantine, counted as skipped, so they cannot permanently occupy the oldest sweep slots. No payload is copied into quarantine.

Every stored Run is `scenario_revision=NULL, revision_source='legacy_unknown'`: `RunAnalysisResultSchema` and `RunInputSnapshotSchema` contain no evaluated-revision stamp. Commit B owns that producer change. Current `scenarios.revision` is never substituted. The typed reader remains dormant; ordering calls the same freshness core, with raw producer ISO text and source fact insertion metadata preserved for exact ties. DB id ordering only paginates transport.

The trigger's 50ms lock timeout contains ONLY 55P03 during enqueue. It does not contain cancellation, disk/CPU/I/O failures, permission/FK failures or deadlocks; those remaining writer failure modes are stated in its comment. Storage and claim failures happen after commit and cannot change the user's turn. One summary event per sweep records depth/age at claim time plus derived/quarantined/skipped/failed counts.

The decision adapter's read dependency is obtained through `build-turn-context`'s sanctioned read-door type. Removing its stale direct-fact-query baseline entry lowers the state-write ratchet and locks that gain.
