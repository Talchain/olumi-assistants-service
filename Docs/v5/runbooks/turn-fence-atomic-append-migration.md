# Runbook — executing `20260731130000_v5_turn_fence_atomic_append.sql`

**What it does:** creates `append_turn_atomic_v4` — the turn-fence check moved
INSIDE the append transaction (ROADMAP 2.174 fix c). Closes the documented
~10-40 ms evaluate→append window through which a Stop could still lose to a
stopped turn's commit.

**Who executes:** the orchestrator (or Paul), against **staging** Supabase.
Production is out of scope for the POC. The authoring lane REHEARSED this
migration and never executed it.

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
```

If v4 already exists, STOP and find out who executed it.

## Execute

Apply `supabase/migrations/20260731130000_v5_turn_fence_atomic_append.sql`
verbatim (single transaction is unnecessary — one CREATE OR REPLACE plus
grants; the file is idempotent and safe to re-apply).

## Post-flight

```sql
-- Exactly one row, pronargs = 19:
SELECT proname, pronargs FROM pg_proc WHERE proname = 'append_turn_atomic_v4';
-- true / false / false:
SELECT
  has_function_privilege('service_role','public.append_turn_atomic_v4(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint)','EXECUTE'),
  has_function_privilege('anon',        'public.append_turn_atomic_v4(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint)','EXECUTE'),
  has_function_privilege('authenticated','public.append_turn_atomic_v4(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint)','EXECUTE');
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
