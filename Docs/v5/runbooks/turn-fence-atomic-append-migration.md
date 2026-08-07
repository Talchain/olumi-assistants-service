# Runbook — executing `20260731130000_v5_turn_fence_atomic_append.sql`

**What it does:** creates `append_turn_atomic_v4` — the turn-fence check moved
INSIDE the append transaction (ROADMAP 2.174 fix c). Closes the documented
~10-40 ms evaluate→append window through which a Stop could still lose to a
stopped turn's commit.

**Who executes:** the orchestrator (or Paul), against **staging** Supabase.
Production is out of scope for the POC.

> **STATUS — EXECUTED. Do not re-run without reading this box.**
> Applied to staging **2026-07-30**
> (`PHASE0-EVIDENCE-2026-07-28/fence-migration-execution.md`, 8/8 structural +
> 7/7 behavioural). The ledger row was **missing** until **2026-07-30**, when it
> was backfilled along with eight other unrecorded migrations
> (`PHASE0-EVIDENCE-2026-07-28/migration-ledger-reconciliation.md`).
> The pre-flight below therefore now expects v4 **present** and one ledger row —
> it is kept as written for the next executor of a migration of this shape, and
> for the rollback path. The line that used to say the authoring lane "never
> executed it" was true when written and went stale within hours; the file
> header of the migration itself still says "(pending)" and is also stale.
> **Derive status from the catalog and the ledger, never from prose.**

## Why order does not matter (but do it migration-first anyway)

The application FEATURE-DETECTS v4: while the function is absent, the first
graph write per CEE instance gets PostgREST `PGRST202`, logs ONE warn
(`v5.turn_fence.atomic_rpc_unavailable`), and every commit takes the pre-v4
evaluate-then-append two-step — the exact protection shipping today, window
included. Nothing fails in either order. Executing migration-first simply
means the very first deploy of the new code runs atomically from its first
turn. After executing on an already-deployed service, **restart CEE** (or
just redeploy) so instances that have cached "v4 missing" re-probe.

## Pre-flight (non-vacuity)

```sql
-- Expect 0 rows — v4 absent:
SELECT proname FROM pg_proc WHERE proname = 'append_turn_atomic_v4';
-- Expect 3 rows — the fence schema (20260731120000) is live:
SELECT proname FROM pg_proc
 WHERE proname IN ('v5_claim_turn_fence','v5_evaluate_turn_fence','v5_mark_turn_stopped');
-- Expect 0 rows — no ledger row yet for this migration:
SELECT version FROM supabase_migrations.schema_migrations
 WHERE version = '20260731130000';
```

If v4 already exists, STOP and find out who executed it.

## Execute

⚠️ **Applying the SQL is only half the step. The ledger row is the other half —
they go in ONE transaction or the next `supabase db push` re-applies this file.**

This is not hypothetical. On 2026-07-30 a reconciliation found **nine** migrations
live in staging with no ledger row, this one among them, because this runbook
told the executing lane to apply the file and never mentioned the ledger. That
lane followed the runbook exactly and was right to. See
`PHASE0-EVIDENCE-2026-07-28/migration-ledger-reconciliation.md`.

Apply `supabase/migrations/20260731130000_v5_turn_fence_atomic_append.sql`
verbatim **and record it**, in a single transaction:

```bash
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f supabase/migrations/20260731130000_v5_turn_fence_atomic_append.sql \
  -c "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
      VALUES ('20260731130000', 'v5_turn_fence_atomic_append',
              ARRAY[pg_read_file('supabase/migrations/20260731130000_v5_turn_fence_atomic_append.sql')]);"
```

`pg_read_file` is server-side and will not work against hosted Supabase; if it
fails, use `scripts/wave0-apply-migration.mjs` as the pattern instead — it does
apply-plus-record inside one `tx` (see `:137-178`) — or read the file client-side
and pass it as a bind parameter. The invariant that matters is **one transaction,
both effects**, and `statements` holding the file's full text (that is the shape
every existing row uses; verified byte-identical for `20260505120000` and
`20260717120000`).

**Never insert a ledger row for a migration you have not proven live in the
catalog.** Recording an unapplied migration hides it permanently — a later
`db push` skips it and the schema is silently wrong. That is strictly worse than
the drift this step exists to prevent.

## Post-flight

```sql
-- Exactly one row, pronargs = 19:
SELECT proname, pronargs FROM pg_proc WHERE proname = 'append_turn_atomic_v4';
-- true / false / false:
SELECT
  has_function_privilege('service_role','public.append_turn_atomic_v4(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint)','EXECUTE'),
  has_function_privilege('anon',        'public.append_turn_atomic_v4(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint)','EXECUTE'),
  has_function_privilege('authenticated','public.append_turn_atomic_v4(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint)','EXECUTE');
-- Exactly one ledger row, and its bytes match the file on disk:
SELECT version, name, array_length(statements,1) AS n_stmts
  FROM supabase_migrations.schema_migrations WHERE version = '20260731130000';
```

Behavioural smoke (safe on a throwaway scenario row): claim → append with the
claimed generation (commits) → mark stopped → append again (must fail with
SQLSTATE `OLTF1`, DETAIL `{"generation": …, "max_generation": …}`).

Then restart/redeploy CEE and confirm the WARN
`v5.turn_fence.atomic_rpc_unavailable` does NOT appear on a fresh draft turn,
and `v5.turn_fence.evaluated` events carry `reason: "atomic_append"`.

## Rollback

Apply
`supabase/migrations/rollback/20260731130000_v5_turn_fence_atomic_append_rollback.sql.do-not-apply`
(drops only v4). The app falls back to the two-step on the next graph write
per instance — no restart strictly required, no data migration either way.

**Remove the ledger row in the same transaction**, or the ledger will claim a
migration is applied that has been rolled back — the inverse of the drift above,
and the more dangerous direction, because a `db push` would then skip re-applying
it:

```sql
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260731130000';
```

## Rehearsal evidence (2026-07-30, ephemeral Postgres 16 in Docker)

Full log + method: `PHASE0-EVIDENCE-2026-07-28/fence-hardening-build.md`.
Summary of what was proven against the REAL migration files, byte-for-byte:

- Forward apply clean; re-apply idempotent; rollback drops exactly v4 (the
  three fence RPCs untouched); re-forward clean.
- Parity battery 8/8 with the test fake (`turn-fence-atomic-append.test.ts` /
  `turn-fence-stop-vs-disconnect.test.ts` fakes): current commits · idempotent
  replay same-id no-remutation · superseded → OLTF2 with DETAIL · stopped →
  OLTF1, no leaked rows, stopped WINS over superseded · unclaimed → OLTF3 ·
  NULL generation skips the gate · non-graph writes never gated · CAS OLGC1
  still enforced inside v4.
- Concurrency, both orderings, real locks: a Stop holding its transaction
  blocked the append 3.1 s and the append then REFUSED (OLTF1, graph never
  landed); an append holding its transaction blocked the Stop 3.1 s and the
  Stop then reported `already_committed: true`. No third interleaving exists.
- ACL: EXECUTE service_role only; anon/authenticated refused; pronargs 19.
