# Phase 0 — SQL / RLS self-review

**Date:** 2026-04-17
**Reviewer:** CC (self-review, pre-apply)
**Scope:** [supabase/migrations/20260417160000_v5_session_store.sql](../../supabase/migrations/20260417160000_v5_session_store.sql) and [supabase/migrations/rollback/20260417160000_v5_session_store_rollback.sql.do-not-apply](../../supabase/migrations/rollback/20260417160000_v5_session_store_rollback.sql.do-not-apply).
**Purpose:** Pre-apply manual walkthrough against Paul's Phase 0 closure checklist. Documents every concern I noticed and confirms which parts of the checklist pass as written.

---

## Checklist outcomes

| # | Item | Verdict | Reference |
|---|---|---|---|
| 1 | No destructive DDL in migration | **PASS** | §1 below |
| 2 | Idempotency guards on every statement | **PASS** | §2 |
| 3 | CHECK constraint syntax valid | **PASS** | §3 |
| 4 | RLS policies grant SELECT only to authenticated (no INSERT/UPDATE/DELETE) | **PASS** | §4 |
| 5 | RPC signature matches audit §4.4 (no `p_user_id`) | **PASS** | §5 |
| 6 | RPC derives `v_user_id` from `scenarios.user_id` | **PASS** | §5 |
| 7 | `REVOKE ... FROM PUBLIC` + `GRANT EXECUTE ... TO service_role` present | **PASS** | §6 |
| 8 | Rollback companion drops in correct reverse order | **PASS** | §7 |
| — | Flagged concerns (none blocking) | **3 items** | §8 |

---

## 1. No destructive DDL

Reviewed every top-level statement in the migration. Each operates on V5-coined names only. The committed list:

- `CREATE TABLE IF NOT EXISTS v5_conversation_turns ...`
- `CREATE INDEX IF NOT EXISTS ...` (2)
- `COMMENT ON COLUMN v5_conversation_turns.user_id ...`
- `CREATE TABLE IF NOT EXISTS v5_handler_facts ...`
- `CREATE INDEX IF NOT EXISTS ...` (2)
- `COMMENT ON COLUMN v5_handler_facts.user_id ...`
- `ALTER TABLE v5_conversation_turns ENABLE ROW LEVEL SECURITY` + `ALTER TABLE v5_handler_facts ENABLE ROW LEVEL SECURITY`
- `DROP POLICY IF EXISTS ... ON v5_conversation_turns` + `CREATE POLICY ...`
- `DROP POLICY IF EXISTS ... ON v5_handler_facts` + `CREATE POLICY ...`
- `CREATE OR REPLACE FUNCTION append_turn_atomic ...`
- `REVOKE EXECUTE ON FUNCTION append_turn_atomic ... FROM PUBLIC`
- `GRANT EXECUTE ON FUNCTION append_turn_atomic ... TO service_role`
- `ALTER TABLE v5_conversation_turns DROP CONSTRAINT IF EXISTS v5_conversation_turns_turn_class_valid` + `ADD CONSTRAINT ...`
- `ALTER TABLE v5_conversation_turns DROP CONSTRAINT IF EXISTS v5_conversation_turns_handler_id_biconditional` + `ADD CONSTRAINT ...`

No `DROP TABLE`, no `DROP COLUMN`, no `DROP DATABASE`, no `TRUNCATE`. The two `DROP CONSTRAINT` calls target V5-coined constraint names that cannot exist on pre-V5 state. The two `DROP POLICY` calls target V5-coined policy names (the quoted strings include the word "v5"). No touch on `public.conversation_turns` (the pre-existing sketch) or any other pre-existing table.

**Verdict: PASS.**

---

## 2. Idempotency guards

Every statement is safe to re-run:

- `CREATE TABLE IF NOT EXISTS` — skips if present.
- `CREATE INDEX IF NOT EXISTS` — skips if present.
- `COMMENT ON COLUMN` — always overwrites, no failure mode.
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` — enabling when already enabled is a no-op in Postgres.
- `DROP POLICY IF EXISTS ... ; CREATE POLICY ...` — matches the existing hardening-migration idiom in `20260226010000_scenario_schema_v2_0_1_hardening.sql`.
- `CREATE OR REPLACE FUNCTION` — inherently idempotent.
- `REVOKE EXECUTE ... FROM PUBLIC` — removing a grant that may not exist is a no-op (Postgres emits a warning but doesn't error).
- `GRANT EXECUTE ... TO service_role` — regranting is a no-op.
- `ALTER TABLE ... DROP CONSTRAINT IF EXISTS ... ; ADD CONSTRAINT ...` — the DROP is explicit `IF EXISTS`, and the ADD creates fresh.

On a re-run against a populated table, `ADD CONSTRAINT` would fail if existing rows violated the new CHECK. V5 tables are V5-only so no pre-existing rows exist; future re-applies would be against rows the RPC itself inserted (all of which satisfy the constraint by construction). Safe.

**Verdict: PASS.**

---

## 3. CHECK constraint syntax

Two CHECK constraints, both on `v5_conversation_turns`:

```sql
CHECK (turn_class IN ('direct_answer', 'clarify', 'handler', 'unhandled'));
CHECK ((turn_class = 'handler') = (handler_id IS NOT NULL));
```

Both are standard SQL. The biconditional form — `(A = 'x') = (B IS NOT NULL)` — evaluates to `TRUE` iff both sides have the same truth value. Postgres treats `=` between booleans as equivalence (XNOR). Valid and semantically correct for the intended invariant.

Named constraints: `v5_conversation_turns_turn_class_valid`, `v5_conversation_turns_handler_id_biconditional`. Both unambiguously V5-owned.

**Verdict: PASS.**

---

## 4. RLS policy posture

Both tables:
- `ENABLE ROW LEVEL SECURITY`.
- One policy each, FOR `SELECT` ONLY, with `USING (auth.uid() = user_id)`.
- No `INSERT`, `UPDATE`, or `DELETE` policies defined.

Consequence: authenticated users can read their own rows. They cannot write or mutate via PostgREST. All writes flow through:
- The `append_turn_atomic` RPC (granted to `service_role` only) — CEE's intended write path.
- Direct service-role writes bypassing RLS (would require CEE coding against the table directly, which the design deliberately discourages in favor of the RPC).

Anonymous users (no JWT) can't read either: `auth.uid()` is NULL for anon, so the policy condition `NULL = user_id` is NULL → rejected.

Mirror of the `shared_briefs` idiom (audit §2.1): direct writes are impossible; mutation is RPC-mediated or service-role.

**Verdict: PASS.**

---

## 5. RPC signature + identity derivation

RPC signature (migration line 99-109):

```sql
CREATE OR REPLACE FUNCTION append_turn_atomic(
  p_scenario_id      UUID,
  p_turn_id          TEXT,
  p_turn_class       TEXT,
  p_handler_id       TEXT,
  p_request_hash     TEXT,
  p_response_emitted BOOLEAN,
  p_llm_calls_used   INTEGER,
  p_duration_ms      INTEGER,
  p_handler_facts    JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
```

Matches audit §4.4 verbatim:
- **No `p_user_id` parameter** — dropped in the P0-3 hardening.
- Nine parameters (was ten before P0-3).
- `SECURITY DEFINER` + `SET search_path = pg_catalog, public` matches the existing RPC idiom.

Identity derivation (migration line 119-123):

```sql
SELECT user_id INTO v_user_id FROM scenarios WHERE id = p_scenario_id;
IF v_user_id IS NULL THEN
  RAISE EXCEPTION 'scenario % not found', p_scenario_id;
END IF;
```

User_id is derived from `scenarios.user_id` by FK-keyed lookup. Caller cannot inject an alternative user_id. If the scenario does not exist, the function raises `scenario <uuid> not found` (Postgres code P0001 for RAISE EXCEPTION). CEE caller maps this error to the appropriate failure type.

**Verdict: PASS.**

---

## 6. REVOKE + GRANT pattern

Migration line 164-165:

```sql
REVOKE EXECUTE ON FUNCTION append_turn_atomic(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION append_turn_atomic(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB) TO service_role;
```

- REVOKE strips the default `PUBLIC` EXECUTE privilege that Postgres grants on all new functions.
- GRANT explicitly grants EXECUTE to `service_role` — the role CEE uses for every write path. Explicit grant removes dependency on role-inheritance assumptions (see P1-2 hardening history in audit §4.4 notes).
- Both statements use the full type-qualified function signature. A signature change in a future migration would need to revoke+grant separately; the current one-migration one-signature invariant holds.

**Verdict: PASS.**

Live confirmation happens in [scripts/phase-0-post-apply-validate.ts](../../scripts/phase-0-post-apply-validate.ts) — calling the RPC with a nonexistent scenario UUID should return the "scenario not found" exception, not a permission-denied error. If it returns `42501` / `permission denied`, the grant model is broken and Tranche 2 halts.

---

## 7. Rollback companion

[supabase/migrations/rollback/20260417160000_v5_session_store_rollback.sql.do-not-apply](../../supabase/migrations/rollback/20260417160000_v5_session_store_rollback.sql.do-not-apply):

```sql
DROP FUNCTION IF EXISTS append_turn_atomic(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB);
DROP TABLE IF EXISTS v5_handler_facts;
DROP TABLE IF EXISTS v5_conversation_turns;
```

Order: function → handler_facts (FK child) → conversation_turns (FK parent). Correct reverse of the migration.

`DROP TABLE ... IF EXISTS` cascades policies, indexes, constraints, and COMMENTs automatically. No separate DROP POLICY or DROP INDEX needed.

Filename suffix `.do-not-apply` ensures the Supabase CLI migration-apply tooling skips this file. Confirmed by searching Supabase migration-tool behaviour: it only applies files matching `*.sql` without further suffixes.

**Verdict: PASS.**

---

## 8. Flagged concerns (non-blocking)

Three observations worth surfacing even though none blocks apply:

### 8.1 Spec-vs-implementation count mismatch on `v5_handler_facts`

Paul's Slice B dispatch checklist said "v5_handler_facts table with all **9** expected columns". My migration defines **10** columns (id, v5_conversation_turn_id, scenario_id, user_id, handler_id, action_type, fact_version, noop, payload, created_at). Audit §4.2 aligns with the migration (10 columns).

Likely explanation: the spec line was a miscount; `fact_version` (present in audit §4.2 since the 0.5.0 schemas design) is the easiest to omit when counting from memory.

Action: post-apply validator [scripts/phase-0-post-apply-validate.ts](../../scripts/phase-0-post-apply-validate.ts) probes the true 10-column set. If the migration's actual shape is wrong, the validator will fail. If the spec count was simply a miscount, validator passes and audit §4.2 remains source of truth.

### 8.2 Grant to `service_role` assumes the role exists on the target project

Supabase projects created after their role-model refactor (late 2024 onward) all ship with `service_role`. The target staging project predates most role churn and has `service_role` confirmed (used by CEE's prompt store; see audit §2.4). No action.

If a future project applies this migration against a Supabase deployment where `service_role` is not present (e.g. self-hosted Postgres with a different role-model), the `GRANT ... TO service_role` fails. Downstream migration authors should adjust to the target project's role name in that scenario. Not relevant here.

### 8.3 No explicit search_path grant to service_role

The RPC sets `search_path = pg_catalog, public` at function level. This is sufficient for the function's own body. However, when `service_role` invokes the RPC, the session's search_path is whatever `service_role`'s own default is — which is Postgres-standard `"$user", public`. That's fine for the RPC-internal writes but could matter if the caller is also doing direct SELECTs in the same session.

CEE's pattern is to invoke via `supabase-js.rpc(...)` which is a single HTTP round-trip — no interleaved direct queries. Not a concern in practice. Documenting for future readers.

---

## 9. Apply readiness

The migration is ready to apply against staging Supabase via Path A (Dashboard SQL Editor) per Paul's decision.

**Apply procedure:**
1. Supabase Dashboard → SQL Editor → New query.
2. Paste the contents of [supabase/migrations/20260417160000_v5_session_store.sql](../../supabase/migrations/20260417160000_v5_session_store.sql).
3. Run.
4. If successful, run [scripts/phase-0-post-apply-validate.ts](../../scripts/phase-0-post-apply-validate.ts) with staging `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
5. Validator exit 0 → Tranche 2 may dispatch.
6. Validator exit 3 → investigate before proceeding.

Operator records which path was taken + the applied-at timestamp in Tranche 2's evidence pack for reproducibility.
