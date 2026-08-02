# Runbook — recovering the staging commit path (ROADMAP 2.301)

**Defect:** `append_turn_atomic_v4`'s in-transaction fence gate (executed
migration `20260731130000`) keys its fence-row lookup on the commit's WRITE
identity (`p_turn_id`), which is the server `request_id` on every
turn-executor commit — while the fence row was claimed under the browser's
`payload.turn_id`. No row matches → SQLSTATE `OLTF3` → verdict `unclaimed` →
**every graph-bearing edit/confirm commit on staging refused since
31 Jul 22:17Z**. Drafts and run_analysis commits pass `payload.turn_id` and
survive. Full proof: `PHASE0-EVIDENCE-2026-07-28/diagnosis-commit-path-2026-08-03.md`.

**Who executes:** Paul (or his one-line delegation), against **staging**
Supabase. Production is out of scope for the POC. **This lane built the files
and rehearsed them; it executed nothing against staging.**

Two INDEPENDENT recovery steps. Either alone restores commits; both together
restore commits AND keep the closed evaluate→append window. Both are
staging-reversible.

## Step (i) — optional immediate unblock: execute the EXISTING rollback (zero deploy, minutes)

Apply
`supabase/migrations/rollback/20260731130000_v5_turn_fence_atomic_append_rollback.sql.do-not-apply`
(drops v4) **and delete the `20260731130000` ledger row in the same
transaction** (the runbook for that migration spells out the ledger
invariant):

```sql
-- one transaction:
DROP FUNCTION IF EXISTS public.append_turn_atomic_v4(
  uuid, text, text, text, text, boolean, integer, integer, jsonb,
  jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint
);
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260731130000';
```

Why this unblocks: the deployed code FEATURE-DETECTS v4. With the function
absent, the next graph write per CEE instance gets PostgREST `PGRST202`, logs
one WARN (`v5.turn_fence.atomic_rpc_unavailable`), and falls back to the
pre-v4 evaluate-then-append — which evaluates the fence via the ALS handle,
the CORRECT identity. Commits work again with the fence still enforced as a
check (the pre-#761-arc posture, honest ~one-RPC window included). No restart
strictly required; a brief PostgREST schema-cache staleness can surface 42883
instead of PGRST202 for a few seconds after the DROP (Supabase auto-reloads
on DDL).

**Verification probe after (i):** a single-op value-edit commit on a virgin
scenario via the deployed UI → expect HTTP 200 and the edit persisted; CEE
logs show `v5.turn_fence.evaluated` with `reason: null` (pre-v4 channel) and
no `graph_write_refused` for that turn.

## Step (ii) — the real fix: execute the corrected migration (after its rehearsal passes)

**Pre-condition:** run the rehearsal harness locally and see 28/28:

```bash
node scripts/rehearse-turn-fence-atomic-append-generation-key.mjs
```

(Needs Docker for an ephemeral `postgres:16`; or point `REHEARSAL_DB_URL` at
a LOCAL Postgres — the harness refuses non-local hosts by design.) The
harness reproduces the outage RED against the executed SQL (mismatched
identities → OLTF3), proves the corrected SQL admits the same commit, and
proves the fence still fences (stopped/superseded/unclaimed, stopped-wins,
cross-scenario guard, Stop-vs-append serialisation), CAS, replay, ACLs, and
the rollback. It was executed by the authoring lane on 2026-08-02: 28/28.

**Pre-flight (against staging):**

```sql
-- exactly one row, pronargs 19 (v4 present — either the defective one, or
-- absent if step (i) already dropped it; BOTH are fine for CREATE OR REPLACE):
SELECT proname, pronargs FROM pg_proc WHERE proname = 'append_turn_atomic_v4';
-- the defective lookup is present iff step (i) has not run:
SELECT prosrc LIKE '%turn_id = p_turn_id%' AS defective
  FROM pg_proc WHERE proname = 'append_turn_atomic_v4';
```

**Execute** `supabase/migrations/20260802120000_v5_turn_fence_atomic_append_generation_key.sql`
verbatim, **plus the ledger row, in ONE transaction** (the
`scripts/wave0-apply-migration.mjs` apply-plus-record pattern; `statements`
carries the file's full text). If step (i) ran first, ALSO re-insert the
`20260731130000` row? **No — do not.** The corrected file supersedes it;
recording only `20260802120000` keeps the ledger truthful about which
definition is live.

**Post-flight:**

```sql
-- exactly one row, pronargs 19:
SELECT proname, pronargs FROM pg_proc WHERE proname = 'append_turn_atomic_v4';
-- generation-keyed, not turn_id-keyed:
SELECT prosrc LIKE '%generation = p_fence_generation%' AS fixed,
       prosrc LIKE '%v5_turn_fence%turn_id = p_turn_id%' AS defect_reintroduced
  FROM pg_proc WHERE proname = 'append_turn_atomic_v4';   -- expect: true, false
-- ACLs: true / false / false
SELECT
  has_function_privilege('service_role','public.append_turn_atomic_v4(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint)','EXECUTE'),
  has_function_privilege('anon',        'public.append_turn_atomic_v4(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint)','EXECUTE'),
  has_function_privilege('authenticated','public.append_turn_atomic_v4(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint)','EXECUTE');
```

If step (i) ran first, **restart/redeploy CEE** so instances that latched
`atomicFenceRpcUnavailable = true` re-probe v4 (the memo is per-instance and
only resets on restart). If (i) did NOT run, no restart is needed — the
signature is unchanged, so the next commit simply succeeds.

**Verification probe after (ii):** the same single-op edit commit on a virgin
scenario → HTTP 200; CEE logs show `v5.turn_fence.evaluated` with
`reason: "atomic_append"`, verdict `current`, and no
`atomic_rpc_unavailable` WARNs.

## Rollback of step (ii)

`supabase/migrations/rollback/20260802120000_v5_turn_fence_atomic_append_generation_key_rollback.sql.do-not-apply`
— drops v4 (it deliberately does NOT restore the 20260731130000 body, which
is the outage). Remove the `20260802120000` ledger row in the same
transaction. The app falls back to the correct-identity two-step, i.e.
rollback of (ii) lands you exactly where step (i) lands.

## The code half (same PR, deploys via the normal pipeline)

The hoisted conflict mapping (fence/CAS refusals → typed 409 on ALL commit
paths, not just the A2 site) ships in `src/orchestrator-v5/turn-executor.ts`
and needs no sequencing against either step: it changes only the HTTP shape
of refusals that were previously 500s. It is what turns the walk's
`state_commit_failed_or_turn_runtime_failure` 500s into actionable
`GRAPH_DIVERGED` 409s if any refusal class ever recurs.
