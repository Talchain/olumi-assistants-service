# Phase 0 — Supabase audit

**Date:** 2026-04-17
**Branch:** `staging`
**Scope:** Brief §3.1 — inventory current Supabase state, decide whether V5 session persistence reuses, extends, or adds new tables. Plan rev 2 revisions 9 and 11: conclude with explicit REUSE/EXTEND/NEW_TABLES verdict + resolve `scenarios.events` JSONB lifecycle.

---

## 1. Method

- Searched `supabase/migrations/` — the repo-tracked migration inventory.
- Read `supabase/README.md` (security model + RPC inventory, last updated 2026-02-26).
- Grepped CEE `src/**/*.ts` for Supabase client usage (`createClient`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `.from('scenarios')`, `rpc('append_scenario_event')`, etc.).
- Reviewed [src/orchestrator/context/event-log-summary.ts](../../src/orchestrator/context/event-log-summary.ts) for the current `ScenarioEvent` shape that flows through `scenarios.events` JSONB.
- Checked [src/config/index.ts](../../src/config/index.ts) for CEE's Supabase configuration.

No live Supabase query was run — the repo-tracked migration file is a hardening patch only (no `CREATE TABLE` statements), so the canonical DDL lives on the remote DB and was not re-derived for this audit. The inventory is assembled from the README + client code, both of which are treated as source of truth.

---

## 2. Current inventory

### 2.1 Tables (per `supabase/README.md`)

| Table | Owner (writes) | CEE touches? | Purpose |
|---|---|---|---|
| `scenarios` | UI (PostgREST + RPC) | No direct writes or reads (see §2.3) | Brief, graph, analysis_provenance, stage, title, framing, events JSONB, `user_id` |
| `shared_briefs` | UI via `create_shared_brief` RPC only | No | Slug-based public brief sharing |
| `cee_prompts` | CEE (prompt store admin) | Yes — [src/prompts/stores/supabase.ts](../../src/prompts/stores/supabase.ts) | Prompt metadata: name, task_id, active_version |
| `cee_prompt_versions` | CEE | Yes | Versioned prompt content + hash |
| `cee_prompt_observations` | CEE | Yes | Prompt feedback/ratings |
| (draft failures table — per [src/cee/draft-failures/store.ts](../../src/cee/draft-failures/store.ts)) | CEE | Yes | Draft-pipeline failure log |

### 2.2 RPCs (all `SECURITY DEFINER`, `SET search_path = pg_catalog, public`)

| RPC | Auth | Purpose |
|---|---|---|
| `append_scenario_event` | authenticated | Core event append with idempotency — writes into `scenarios.events` JSONB |
| `apply_patch_and_log` | authenticated | Atomic graph update + event |
| `store_analysis_and_log` | authenticated | Atomic analysis + provenance + event |
| `store_analysis_failure` | authenticated | Atomic analysis failure + event |
| `store_brief_and_log` | authenticated | Atomic brief storage + event |
| `set_stage_and_log` | authenticated | Atomic stage transition + event |
| `create_shared_brief` | authenticated | Ownership-verified brief sharing (slug server-generated) |
| `get_shared_brief_by_slug` | anon + authenticated | Public read-only brief access by unguessable slug |

These existing atomic-state-plus-event-write RPCs are the **prior art** for the transaction pattern V5 needs (plan rev 2 revision 3). Any V5 RPC should match this idiom.

### 2.3 CEE ↔ Supabase ownership (critical finding)

Grepping CEE source for `.from('scenarios')`, `.from("scenarios")`, `.from('shared_briefs')`, `rpc('append_scenario_event')`, and every other scenario-RPC name returns **zero matches**. CEE does **not** directly read or write `scenarios` or `shared_briefs`. Instead:

- **UI (DecisionGuideAI)** writes to `scenarios` and `shared_briefs` via PostgREST + the atomic RPCs in §2.2.
- **CEE** receives `ScenarioEvent[]` via the turn request payload (see `ScenarioEvent` interface at [src/orchestrator/context/event-log-summary.ts:22](../../src/orchestrator/context/event-log-summary.ts#L22)) and consumes them read-only for things like the event log summary in enriched context.
- **CEE's only Supabase writes** are to the prompt-management tables (`cee_prompts*`) and the draft-failures store — never to scenario-lifecycle tables.

V5 session persistence changes this pattern: **CEE becomes the write-side owner for per-turn data** (`conversation_turns` + `handler_facts` per rev-2 §Tranche 2 decisions). UI continues to own `scenarios` and its lifecycle events. This is a deliberate separation of concerns, not a hostile takeover — see verdict §5.

### 2.4 CEE Supabase connection

CEE already configures `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` ([src/config/index.ts:943-944](../../src/config/index.ts#L943-L944)). Service-role key bypasses RLS, which is the right posture for CEE — turn-level writes must be auditable to the correct user but not subject to UI-session authentication. **No new infra is required to give V5 a Supabase write path.**

### 2.5 Repo-tracked migration inventory

Only one migration in-repo: [supabase/migrations/20260226010000_scenario_schema_v2_0_1_hardening.sql](../../supabase/migrations/20260226010000_scenario_schema_v2_0_1_hardening.sql). It is a hardening patch (policy idempotency + mojibake fix in `create_shared_brief`) — contains zero `CREATE TABLE` statements. The canonical DDL for `scenarios`, `shared_briefs`, the RPCs, and the `cee_prompts*` family lives on the remote DB and/or earlier migrations not checked into this repo.

**Implication:** V5's migration is the *first* net-new table creation we will check into this repo. It must be internally complete (table + indexes + constraints + RLS + triggers) because it has no earlier migration to lean on.

A `migrations 2/` directory exists but is empty — Finder duplicate artefact. Recommend removing it as a house-keeping item, out of scope here.

### 2.6 Prior-work memory check

No prior session-persistence discussions are recorded in project memory ([memory/MEMORY.md](../../../../../../.claude/projects/-Users-paulslee-Documents-GitHub-olumi-assistants-service/memory/MEMORY.md)). The CEE context module under `src/orchestrator/context/` is the nearest neighbour — it builds compact summaries of scenario events but does not persist anything.

### 2.7 Live Supabase introspection (P0-1)

A reusable introspection script lives at [scripts/phase-0-introspect.ts](../../scripts/phase-0-introspect.ts). It probes `conversation_turns` and `handler_facts` for existence against the live Supabase project referenced by `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

**Attempted run (2026-04-17):** aborted at env-var load. CEE's local `.env` carries only LLM provider keys; Supabase credentials live in the staging/production deploy environment (Render) rather than local `.env`, contrary to an earlier assumption in the audit plan. The script exited cleanly with `exit 2` and the instruction:

```
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-JWT> \
  pnpm exec tsx scripts/phase-0-introspect.ts
```

**Paul-runnable snapshot output expected:**

```markdown
# Phase 0 Supabase introspection
Generated: <ISO timestamp>

## Table collision check (V5 migration preconditions)
- conversation_turns: **absent-OK** — absent — code=PGRST205, msg="..."
- handler_facts: **absent-OK** — absent — code=PGRST205, msg="..."

## Known-good preconditions (verified via committed source, not live query)
- pgcrypto.gen_random_bytes() — used by create_shared_brief ...
- auth.uid() — used by every existing SECURITY DEFINER RPC ...
```

When the script is run against the staging Supabase project (Paul → Supabase dashboard → Project Settings → API → service_role key), the output should be pasted back here in place of the "expected" block above to close the P0-1 gap fully.

**Source-evidence fallback.** Even without the live probe, the three preconditions have circumstantial evidence:
- `conversation_turns` and `handler_facts` are V5-coined table names; no committed migration or documented schema references them, so a collision is implausible but not impossible.
- `pgcrypto.gen_random_bytes()` is already used by [create_shared_brief](../../supabase/migrations/20260226010000_scenario_schema_v2_0_1_hardening.sql) in the committed hardening migration — if pgcrypto were missing, that RPC would fail on every invocation, and it does not.
- `auth.uid()` is used by every existing SECURITY DEFINER RPC per `supabase/README.md` §RPCs.

The live probe reduces residual risk to near-zero; the source-evidence path holds it at very low. Phase 0 sign-off can accept either posture with Paul's explicit call.

**Scope limit.** `pg_catalog` and `information_schema` are not accessible through Supabase PostgREST without a project-settings change that exposes additional schemas. The script therefore cannot query `pg_extension` or `pg_proc` directly. If deeper introspection is ever required, either add a read-only SQL RPC to the migration set or use a direct Postgres driver with the project connection string (kept outside `.env`).

---

## 3. `scenarios.events` JSONB — lifecycle verdict (plan rev 2 revision 11)

### 3.1 What the column currently carries

`scenarios.events` is a JSONB array of `ScenarioEvent`:

```ts
interface ScenarioEvent {
  event_id: string
  event_type: string        // e.g. framing_confirmed, graph_drafted,
                            //      patch_accepted, patch_dismissed,
                            //      analysis_run, brief_generated
  seq: number               // monotonic within scenario
  timestamp: string
  details: Record<string, unknown>
  turn_id?: string
  hashes?: Record<string, string>
}
```

Event types are scenario-lifecycle coarse-grained — one event per major state transition, not per conversational turn. Written by UI via `append_scenario_event` + the composite RPCs (`apply_patch_and_log` etc.). Read by CEE from the request payload (never by direct DB query).

### 3.2 Options considered

| Option | Description | Pros | Cons |
|---|---|---|---|
| **Reuse** | V5 appends new `event_type`s (e.g. `turn_executed`, `handler_fact:run_analysis`) to `scenarios.events`. | No new tables. | Couples V5 writes to a UI-owned table. JSONB rot (rev 2 revision 2). No per-handler queryability. RLS cross-role complexity. Violates separate-tables decision. |
| **Shadow** | V5 writes turn-level data to new tables AND appends summary entries to `scenarios.events`. | Retains single-read-path for consumers. | Dual-write ambiguity. Every consumer must decide which source to trust. Extra write cost on hot path. |
| **Replace** | V5 new tables become the source of truth for turn-level + handler-fact data. `scenarios.events` remains for UI-owned scenario-lifecycle events unchanged. Consumers that need turn-level data read the new tables. | Clean separation. No dual-writes. `scenarios.events` UI write path unchanged. Per-handler queryability. RLS stays simple on new tables (CEE service role). | Two event-history-like surfaces coexist (different granularities). Documentation overhead. |

### 3.3 Verdict: **Replace** (for turn-level data only)

`scenarios.events` is **preserved unchanged**. UI continues writing scenario-lifecycle events to it. CEE continues reading it from the request payload as today.

V5 turn-level data (`conversation_turns`, `handler_facts`) lives in **new** tables that CEE owns via service-role writes. No dual-writes. No new entries to `scenarios.events` from V5.

**Implication for event log summary:** the existing `buildEventLogSummary()` over `ScenarioEvent[]` continues to operate on scenario-lifecycle events only. If V5 needs a turn-log summary later, it builds it from `conversation_turns` / `handler_facts` — not from `scenarios.events`.

---

## 4. Proposed V5 session-store schema

All additive. Zero destructive DDL. Idempotent (`IF NOT EXISTS`, `DROP … IF EXISTS` before `CREATE POLICY`/`CREATE TRIGGER`) per the repo's style.

### 4.0 Migration file header

The migration file begins with an explicit dependency declaration so the chain is readable to future operators:

```sql
-- ============================================================
-- V5 session store — conversation_turns + handler_facts
-- Target: Staging Supabase
-- Date: 2026-04-XX
--
-- Depends on:
--   - scenarios table (from earlier remote migration not checked in)
--   - gen_random_uuid() from pgcrypto extension
--   - auth.uid() from Supabase GoTrue schema
--
-- Additive-only. Zero destructive DDL. Safe to re-run (idempotent).
-- ============================================================
```

### 4.1 `conversation_turns`

One row per successful turn. Failed turns write zero rows (brief §4.4).

```sql
CREATE TABLE IF NOT EXISTS conversation_turns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id      UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL,  -- denormalised from scenarios.user_id for RLS + pruning
  turn_id          TEXT NOT NULL,  -- request_id / idempotency key from TurnExecutor
  turn_class       TEXT NOT NULL,  -- direct_answer | clarify | handler | unhandled
  handler_id       TEXT NULL,      -- NULL except when turn_class='handler'
  request_hash     TEXT NOT NULL,  -- dedupe signal for replay
  response_emitted BOOLEAN NOT NULL DEFAULT TRUE,  -- BI-01 witness
  llm_calls_used   INTEGER NOT NULL DEFAULT 0,
  duration_ms      INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversation_turns_scenario_turn_unique UNIQUE (scenario_id, turn_id)
);

CREATE INDEX IF NOT EXISTS conversation_turns_scenario_created_idx
  ON conversation_turns (scenario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS conversation_turns_user_created_idx
  ON conversation_turns (user_id, created_at DESC);

COMMENT ON COLUMN conversation_turns.user_id IS
  'Denormalised from scenarios.user_id for RLS without join. Drift is API-unreachable; no CHECK constraint by design.';
```

- `UNIQUE (scenario_id, turn_id)` satisfies the idempotency lock (plan rev 2 §Tranche 2 decision 2).
- `user_id` denormalised so RLS can filter without a join. Foreign-key to `scenarios` keeps lifecycle aligned; `ON DELETE CASCADE` cleans up when a scenario is removed.
- `turn_class` is a free TEXT with a CHECK constraint added below (enum-like but evolvable).

### 4.2 `handler_facts`

One row per HandlerFact emitted by a handler turn. Zero rows for non-handler turns.

```sql
CREATE TABLE IF NOT EXISTS handler_facts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_turn_id UUID NOT NULL REFERENCES conversation_turns(id) ON DELETE CASCADE,
  scenario_id          UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  user_id              UUID NOT NULL,
  handler_id           TEXT NOT NULL,   -- e.g. run_analysis, set_factor_value
  action_type          TEXT NOT NULL,   -- canonical V4 action_type literal
  fact_version         INTEGER NOT NULL DEFAULT 1,
  noop                 BOOLEAN NOT NULL DEFAULT FALSE,  -- rev 2 revision 5 suppression flag
  payload              JSONB NOT NULL,  -- the HandlerFact body (Zod-validated at write time)
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS handler_facts_turn_idx
  ON handler_facts (conversation_turn_id);
CREATE INDEX IF NOT EXISTS handler_facts_scenario_handler_idx
  ON handler_facts (scenario_id, handler_id, created_at DESC);

COMMENT ON COLUMN handler_facts.user_id IS
  'Denormalised from scenarios.user_id for RLS without join. Drift is API-unreachable; no CHECK constraint by design.';
```

- Separate table (rev 2 revision 2): queryability, RLS granularity, schema evolution.
- `payload` JSONB for the fact body (discriminated-union shape varies per handler). Zod schema enforces shape at write time in CEE; the JSONB column stores the validated blob.
- `noop BOOLEAN`: set TRUE when a D1 handler suppresses a redundant write (rev 2 revision 5). This row still persists — NOOP is observable.
- `action_type` is the canonical V4 literal, verified against the Phase 0 action-type mapping table (§6).

### 4.3 RLS policies

Match the `scenarios` pattern exactly. CEE service-role bypasses RLS for writes; `authenticated` role can read own rows via policy.

```sql
ALTER TABLE conversation_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE handler_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own conversation turns" ON conversation_turns;
CREATE POLICY "Users can read own conversation turns"
  ON conversation_turns FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own handler facts" ON handler_facts;
CREATE POLICY "Users can read own handler facts"
  ON handler_facts FOR SELECT
  USING (auth.uid() = user_id);
```

No INSERT/UPDATE/DELETE policies for `authenticated`. All writes go through the `append_turn_atomic` RPC (§4.4) or directly via the CEE service-role key. This mirrors `shared_briefs`: direct writes are impossible; all mutation is RPC-mediated or service-role.

### 4.4 `append_turn_atomic` RPC (rev 2 revision 3, hardened post-review)

Single-transaction append covering one `conversation_turn` row + N `handler_fact` rows.

**Security hardening (2026-04-17 review):** the function no longer accepts a caller-supplied `p_user_id`. SECURITY DEFINER bypasses RLS, which in the previous design combined with a trusted `p_user_id` parameter to create a user-impersonation vector: any `authenticated` caller could write rows tagged with an arbitrary `user_id`. The redesign derives `user_id` from `scenarios.user_id` via `p_scenario_id` — single source of truth, unspoofable — and revokes EXECUTE from `authenticated`. Only CEE's service-role path reaches this RPC, matching CEE's actual Supabase auth posture (§2.4).

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
  p_handler_facts    JSONB   -- array of { handler_id, action_type, noop, payload }
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_turn_id UUID;
  v_user_id UUID;
  v_fact    JSONB;
BEGIN
  -- Derive user_id from the scenario — unspoofable; trust nothing about
  -- caller-supplied identity. If the scenario does not exist, raise.
  SELECT user_id INTO v_user_id FROM scenarios WHERE id = p_scenario_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'scenario % not found', p_scenario_id;
  END IF;

  -- ON CONFLICT DO NOTHING satisfies write idempotency
  INSERT INTO conversation_turns (
    scenario_id, user_id, turn_id, turn_class, handler_id,
    request_hash, response_emitted, llm_calls_used, duration_ms
  ) VALUES (
    p_scenario_id, v_user_id, p_turn_id, p_turn_class, p_handler_id,
    p_request_hash, p_response_emitted, p_llm_calls_used, p_duration_ms
  )
  ON CONFLICT (scenario_id, turn_id) DO NOTHING
  RETURNING id INTO v_turn_id;

  -- FOUND is FALSE iff the INSERT did not insert (conflict fired).
  -- On duplicate, fetch the existing turn id and RETURN EARLY — the fact rows
  -- were written on the first successful call and re-inserting would violate
  -- the whole-append idempotency contract.
  IF NOT FOUND THEN
    SELECT id INTO v_turn_id
      FROM conversation_turns
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
    RETURN v_turn_id;
  END IF;

  -- Fresh turn: insert handler facts if any. COALESCE guards NULL input.
  IF jsonb_array_length(COALESCE(p_handler_facts, '[]'::jsonb)) > 0 THEN
    FOR v_fact IN SELECT * FROM jsonb_array_elements(p_handler_facts)
    LOOP
      INSERT INTO handler_facts (
        conversation_turn_id, scenario_id, user_id,
        handler_id, action_type, noop, payload
      ) VALUES (
        v_turn_id,
        p_scenario_id,
        v_user_id,  -- derived, never caller-supplied
        v_fact->>'handler_id',
        v_fact->>'action_type',
        COALESCE((v_fact->>'noop')::boolean, FALSE),
        COALESCE(v_fact->'payload', '{}'::jsonb)
      );
    END LOOP;
  END IF;

  RETURN v_turn_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION append_turn_atomic(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB) FROM PUBLIC;
-- No GRANT to authenticated. Service role inherits EXECUTE via superuser-like
-- privileges; only CEE's service-role path reaches this function. A future
-- UI write path (if ever needed) will use a separate RPC that derives identity
-- from auth.uid(), not a spoofable parameter.
```

Notes:
- Single function invocation = single transaction. This satisfies rev 2 revision 3 (compensating-writes fallback not needed — `supabase-js` `.rpc()` wraps the call in a single HTTP request that executes the entire PL/pgSQL body in one transaction).
- Arguments are explicit and typed — no free-form JSON for top-level fields. Only `p_handler_facts` is JSONB because it is variable-length.
- `SECURITY DEFINER` + `SET search_path` match the existing RPC idiom (§2.2).
- **Identity derivation:** `user_id` is always read from `scenarios.user_id`. Caller cannot inject an alternative. This is a single source of truth and defends against CEE bugs in addition to malicious callers.
- **Execute-grant pattern:** revoke from PUBLIC, no grant to authenticated. CEE uses service-role; that role inherits EXECUTE via superuser-like privileges at the Postgres layer.
- **Duplicate-turn guard:** the `IF NOT FOUND ... RETURN` early-exit ensures handler_facts are written exactly once per `(scenario_id, turn_id)`. Re-invoking `append_turn_atomic` on a committed turn is a safe no-op that returns the same turn UUID, not a duplicate-key error and not a double-write.
- **JSONB NULL safety:** `jsonb_array_length` raises on NULL input. `COALESCE(p_handler_facts, '[]'::jsonb)` treats NULL and empty-array uniformly. The signature still declares JSONB (not nullable) — callers should pass `[]` for handlerless turns — but defence-in-depth is cheap here.

### 4.5 Cross-field CHECK constraints

Both added as separate `ALTER TABLE` statements so future adjustments (e.g. a new `'exercise'` turn class once E-series lands) can amend individual CHECKs without touching the `CREATE TABLE` statement.

```sql
ALTER TABLE conversation_turns
  ADD CONSTRAINT conversation_turns_turn_class_valid
  CHECK (turn_class IN ('direct_answer', 'clarify', 'handler', 'unhandled'));

-- Biconditional: handler_id is non-null iff turn_class = 'handler'.
-- Catches a semantic-garbage class of bug (non-handler turn citing a handler, or
-- handler turn missing its handler_id) that Zod types alone cannot enforce at
-- the persistence layer. Mirrored by a Zod refinement on SessionTurnSchema
-- in `@talchain/schemas` 0.5.1 (see schemas repo commit history).
ALTER TABLE conversation_turns
  ADD CONSTRAINT conversation_turns_handler_id_biconditional
  CHECK ((turn_class = 'handler') = (handler_id IS NOT NULL));
```

---

## 5. **Verdict: NEW_TABLES** (plan rev 2 revision 9)

V5 session persistence adds two new tables (`conversation_turns`, `handler_facts`) + one new RPC (`append_turn_atomic`) + matching RLS policies. Zero changes to existing tables, zero destructive DDL, zero impact on UI's existing scenario-lifecycle write path.

**`scenarios.events` disposition:** Replace (for turn-level data) — see §3.3. The column is unchanged; V5 simply does not write to it. UI-owned lifecycle events continue unchanged.

---

## 6. Dependency on Phase 0 schemas work

The schema package bump (`@talchain/schemas@0.5.0`) must export:
- `SessionTurnSchema` matching the `conversation_turns` row shape above (response-side representation — cache/read tier).
- `HandlerFactSchema` discriminated union matching the `handler_facts.payload` shape per-handler.
- Per-handler `HandlerFactResult` types that Zod-validate at write time before going into `handler_facts.payload`.

The action-type mapping table (brief §3.3) is a separate required Phase 0 artefact. Seven V5-relevant V4 `action_type` literals are already verified verbatim against V4 source:

| V4 action_type | V5 schema literal | V5 handler module (future) | V4 source |
|---|---|---|---|
| `run_analysis` | `run_analysis` | `src/orchestrator-v5/tools/run-analysis.ts` | [src/orchestrator/deterministic/actions/run-analysis.ts:27](../../src/orchestrator/deterministic/actions/run-analysis.ts#L27) |
| `set_factor_value` | `set_factor_value` | `src/orchestrator-v5/tools/set-factor-value.ts` | [src/orchestrator/deterministic/actions/set-factor-value.ts:42](../../src/orchestrator/deterministic/actions/set-factor-value.ts#L42) |
| `add_constraint` | `add_constraint` | `src/orchestrator-v5/tools/add-constraint.ts` | [src/orchestrator/deterministic/actions/add-constraint.ts:12](../../src/orchestrator/deterministic/actions/add-constraint.ts#L12) |
| `adjust_edge_strength` | `adjust_edge_strength` | `src/orchestrator-v5/tools/adjust-edge-strength.ts` | [src/orchestrator/deterministic/actions/adjust-edge-strength.ts:12](../../src/orchestrator/deterministic/actions/adjust-edge-strength.ts#L12) |
| `explain_result` | `explain_result` | `src/orchestrator-v5/tools/explain-result.ts` | [src/orchestrator/deterministic/actions/explain-result.ts:14](../../src/orchestrator/deterministic/actions/explain-result.ts#L14) |
| `compare_options` | `compare_options` | `src/orchestrator-v5/tools/compare-options.ts` | [src/orchestrator/deterministic/actions/compare-options.ts:13](../../src/orchestrator/deterministic/actions/compare-options.ts#L13) |
| `what_would_flip` | `what_would_flip` | `src/orchestrator-v5/tools/what-would-flip.ts` | [src/orchestrator/deterministic/actions/what-would-flip.ts:14](../../src/orchestrator/deterministic/actions/what-would-flip.ts#L14) |

All V5 literals match V4 verbatim; zero rename. This table will be committed as part of the schemas addendum in the next Phase 0 step.

---

## 7. Risks + rollback

| Risk | Mitigation |
|---|---|
| Migration applied out of order (e.g. without the canonical `scenarios` table existing yet on a fresh DB). | Migration will be tagged as depending on the scenarios schema. The staging DB already has `scenarios`; a fresh deploy would need earlier migrations consolidated first, but that's out of this tranche's scope. |
| `ON DELETE CASCADE` removes turn + fact history when a scenario is deleted. | This is intended: deleting a scenario should delete its conversation + handler history. UI already deletes scenarios on user action; V5 follows the same lifecycle. |
| `user_id` denormalisation drifts from `scenarios.user_id`. | CEE always reads `user_id` from the incoming turn payload (derived from `scenarios` at UI-write time). Drift is not reachable through the API surface. Explicit CHECK not added to keep the migration minimal. |
| RPC transaction fails mid-insert. | PL/pgSQL block is implicitly atomic — on failure, Postgres rolls back the whole function. `supabase-js` `.rpc()` surfaces the error; CEE TurnExecutor maps to `STATE_COMMIT_FAILED` failure type (added in Tranche 2 alongside the Supabase store implementation). |
| `append_turn_atomic` signature changes later. | Separate migration file per change. The first signature ships additively here. |

**Rollback:** the migration is additive-only. A break-glass rollback companion ships alongside the migration at `supabase/migrations/rollback/2026XXXX_v5_session_store_rollback.sql.do-not-apply` — the `.do-not-apply` suffix ensures migration tooling skips it. Contents drop the function first, then the fact table, then the turn table (reverse order so foreign keys are respected). The rollback file exists as documentation and break-glass only — **not** auto-run, **not** part of the tranche's standard rollback path. Standard rollback if Tranche 2 regresses: stop writing from CEE (feature flag off) and leave the tables empty-but-present. Apply the companion manually only if the tables themselves must go.

---

## 8. Approvals required before schemas proceed

Per plan rev 2 §Execution flow step 2 and brief §3.5, the next Phase 0 step (schema bump + tarball + vendoring) cannot begin until Paul reviews:

1. Verdict: **NEW_TABLES** (§5).
2. `scenarios.events` disposition: **Replace** for turn-level data (§3.3).
3. Proposed DDL + RPC (§4).
4. Action-type mapping table (§6).
5. RLS + grant posture (§4.3, §4.4).

On approval, Phase 0 resumes with:
- Schema bump `@talchain/schemas@0.4.0` → `0.5.0` (additive-only).
- Vendored tarball rebuild + SHA manifest.
- Pin update in CEE and UI `package.json`.
- Typecheck clean against new schemas.
- Migration file committed under `supabase/migrations/2026XXXX_v5_session_store.sql` (applied against staging Supabase as a separate operational step — not run by Phase 0).
- New CEE task_id literals + `OPERATION_TO_TASK_ID` additions.
- `scripts/validate-data-responsibility.sh` shipped.
- Final Phase 0 evidence-pack commit.

Phase 0 then hard-stops for Tranche 2 (Slice B) approval.
