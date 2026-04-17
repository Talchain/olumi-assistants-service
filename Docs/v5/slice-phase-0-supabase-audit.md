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
- **Live introspection (post-0.5.1 hardening):** executed [scripts/phase-0-introspect.ts](../../scripts/phase-0-introspect.ts) against staging Supabase with Paul-supplied `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars. See §2.7 for the actual output and the signed-off residual-risk posture for checks outside supabase-js scope.

The inventory combines README + client code (source of truth for shapes + RPC inventory) with the live introspection snapshot (source of truth for "does the target table already exist"). Schema-state assumptions about Supabase-default extensions and functions (`pgcrypto.gen_random_uuid()`, `auth.uid()`) are indirectly evidenced by existing SECURITY DEFINER RPCs that already depend on them in production — see §2.7.

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

**Run 1 (2026-04-17, attempted):** aborted at env-var load. CEE's local `.env` carries only LLM provider keys; Supabase credentials live in the Render deploy environment rather than local `.env`. Exit 2, instruction printed.

**Run 2 (2026-04-17, executed with Paul-supplied staging service-role key):**

```markdown
# Phase 0 Supabase introspection
Generated: 2026-04-17T15:28:13.901Z

## Table collision check (V5 migration preconditions)
- conversation_turns: **present-collision** — returned 0 rows on limit(0) probe — schema registered
- handler_facts: **absent-OK** — absent — code=PGRST205, msg="Could not find the table 'public.handler_facts' in the schema cache"

## Known-good preconditions (verified via committed source, not live query)
- `pgcrypto.gen_random_bytes()` — used by `create_shared_brief` in the committed hardening migration.
- `auth.uid()` — used by every existing SECURITY DEFINER RPC per `supabase/README.md` §RPCs.
- Both are Supabase-default extensions/functions; a project lacking them would fail existing RPCs, not just new ones.

[phase-0-introspect] SURPRISE — halt Phase 0 and review.
Exit code: 3
```

### ⚠️ Collision: `public.conversation_turns` already exists in staging

This is a **hard halt** condition per the script's own protocol and the plan's stop-on-surprise rule. The migration as currently designed would collide with pre-existing state. Investigating and resolving this MUST happen before any migration file is written, let alone applied.

**Hypotheses (unverified — need Paul's inspection of the staging DB):**
1. A prior V5 dry-run or partial-apply left the table behind.
2. Another service/team created a `conversation_turns` table for an unrelated purpose.
3. A stale PostgREST schema cache entry (least likely — cache misses usually manifest as PGRST205, not false positives).

**Required next steps before Phase 0 can sign off:**
1. Paul inspects the existing `public.conversation_turns` via the Supabase dashboard (Table Editor → public → conversation_turns) or a direct `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='conversation_turns'` query in the SQL Editor.
2. Decide:
   - **Compatible:** existing schema matches §4.1 shape → add `IF NOT EXISTS` guard (already present) and validate the existing `(scenario_id, turn_id)` unique constraint + RLS + indexes match or can be adjusted idempotently.
   - **Incompatible:** rename the V5 tables to disambiguate (e.g. `v5_conversation_turns`, `v5_handler_facts`). Audit §4 + migration file updated accordingly.
   - **Stale:** existing table is safe to drop → add a scoped `DROP TABLE IF EXISTS` companion migration (risky; only if Paul is certain no data is referenced).
3. Re-run `pnpm exec tsx scripts/phase-0-introspect.ts` with the same creds and confirm the resolution before continuing.

**Residual-risk sign-off for checks outside supabase-js scope (Paul-accepted).** Even if the collision is resolved, the two catalog checks (`pg_extension` and `pg_proc`) remain unrunnable via supabase-js against a standard-config Supabase project (PostgREST does not expose `pg_catalog` or `information_schema`). Indirect evidence is accepted as sufficient:
- `pgcrypto.gen_random_bytes()` is actively invoked by `create_shared_brief` every time a brief is shared on staging. Its absence would have surfaced as user-visible failures, which it has not. Paul-signed residual risk: very low.
- `auth.uid()` is invoked by every existing SECURITY DEFINER RPC (`append_scenario_event`, `apply_patch_and_log`, `store_analysis_and_log`, etc.). Its absence would manifest as universal RLS-related failures across the UI write path. Paul-signed residual risk: very low.

If the collision resolution takes us to a path where the RPC is rewritten or the tables are renamed, the residual-risk sign-off stands — it applies to Supabase-default plumbing, not to the specific table names.

**Scope limit.** If deeper catalog introspection is ever required, either add a read-only SQL RPC to the migration set or use a direct Postgres driver with the project connection string (kept outside `.env`). This is explicitly NOT in Phase 0 scope.

### Existing `conversation_turns` shape characterisation (2026-04-17)

Ran [scripts/phase-0-shape-probe.ts](../../scripts/phase-0-shape-probe.ts) — a read-only per-column probe triggered by the collision finding. Real output:

```markdown
# Phase 0 — public.conversation_turns shape probe
Generated: 2026-04-17T15:35:43.677Z

## Row count
- rows: 0

## Full expected-column select
- columns tried: id, scenario_id, user_id, turn_id, turn_class, handler_id, request_hash, response_emitted, llm_calls_used, duration_ms, created_at
- status: FAILED
- error: column conversation_turns.turn_id does not exist
- code: 42703

## Per-column existence probe
- id: present
- scenario_id: present
- user_id: present
- turn_id: MISSING — column conversation_turns.turn_id does not exist
- turn_class: MISSING — column conversation_turns.turn_class does not exist
- handler_id: MISSING — column conversation_turns.handler_id does not exist
- request_hash: MISSING — column conversation_turns.request_hash does not exist
- response_emitted: MISSING — column conversation_turns.response_emitted does not exist
- llm_calls_used: MISSING — column conversation_turns.llm_calls_used does not exist
- duration_ms: MISSING — column conversation_turns.duration_ms does not exist
- created_at: present

## Summary
- expected-column coverage: 4 / 11
- missing columns: turn_id, turn_class, handler_id, request_hash, response_emitted, llm_calls_used, duration_ms
- shape verdict: INCOMPATIBLE
- data verdict: EMPTY
```

**What the shape tells us.** The existing table has the four identity-plus-timestamp columns (`id`, `scenario_id`, `user_id`, `created_at`) and nothing more. That pattern looks like a minimal sketch or placeholder — plausibly a prior V5 dry-run that was not completed, an abandoned sibling feature's scaffold, or a very-thin audit-log table that never got its payload columns. No V5 migration has been applied from this repo, so this table was created by some other path (dashboard, a prior migration not checked in, or a partial earlier round). Provenance is unknown from the repo's side.

**What the shape does NOT tell us.**
- Whether extra columns exist beyond the expected set (PostgREST doesn't expose column metadata without a row-returning SELECT; `rows: 0` means the scope-limit caveat applies unchanged).
- Whether foreign keys, triggers, indexes, or RLS policies reference this table. A drop must either `CASCADE` or these must be verified absent first.
- When it was created and by whom (Supabase dashboard history or Postgres logs would answer; out of scope for a read-only probe).

### Path decision: **option 3 (scoped drop)** — pending explicit Paul confirmation

Per the decision matrix Paul fixed at 2026-04-17:
> incompatible + zero rows → option 3 (scoped drop, Paul confirms)

This maps unambiguously: shape is 4/11 (incompatible), rows = 0 (empty). Option 3 is the cleanest path — it preserves the clean `conversation_turns` name for V5 rather than locking in a permanent `v5_` prefix for a transient collision.

**Proposed migration prelude (NOT yet written to a migration file — awaiting confirmation):**

```sql
-- Staging cleanup: the pre-existing public.conversation_turns is a 4-column
-- sketch unrelated to the V5 design, empty on 2026-04-17 per shape-probe
-- evidence. Dropped with CASCADE so any dependent FKs/indexes/RLS policies go
-- with it. Verified-empty precondition at probe time.
DROP TABLE IF EXISTS public.conversation_turns CASCADE;
```

**Paul-confirmation checklist before this prelude ships:**
1. Open Supabase dashboard → Table Editor → `public.conversation_turns` → inspect for FK references IN (other tables → this table) and FK references OUT (this table → other tables). If IN exists, `CASCADE` will drop those FKs too — confirm the target FK is also safe to lose.
2. Confirm no RLS policies on this table protect data we're not expecting (empty now, but check the policy list in case a policy is load-bearing for something else).
3. Confirm no triggers on the table that perform side-effects.
4. Once confirmed, Paul gives explicit go-ahead in writing. The drop prelude is added to the migration file as its first statement.

**If any check surfaces a blocker**, fall back to option 2 (rename to `v5_conversation_turns`). This is reversible and non-destructive; the permanent-`v5_` cost is worth it if the existing table turns out to be load-bearing for anything else.

**Re-run introspection after resolution.** Either path MUST be followed by a fresh `pnpm exec tsx scripts/phase-0-introspect.ts` run confirming both `conversation_turns` AND `handler_facts` report `absent-OK`, BEFORE the migration file is written.

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
-- Explicit grant to service_role — the role CEE uses for every write path.
-- Making the grant explicit rather than relying on implicit inheritance
-- removes any ambiguity about whether service_role retains EXECUTE after the
-- PUBLIC revoke. service_role is not a Postgres superuser in standard
-- Supabase projects; it has BYPASSRLS + broad defaults, but REVOKE FROM PUBLIC
-- can still remove its EXECUTE in some configurations. Explicit grant closes
-- that ambiguity. No GRANT to authenticated.
GRANT EXECUTE ON FUNCTION append_turn_atomic(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB) TO service_role;
-- A future UI write path (if ever needed) will use a separate RPC that
-- derives identity from auth.uid(), not a spoofable parameter.
```

Notes:
- Single function invocation = single transaction. This satisfies rev 2 revision 3 (compensating-writes fallback not needed — `supabase-js` `.rpc()` wraps the call in a single HTTP request that executes the entire PL/pgSQL body in one transaction).
- Arguments are explicit and typed — no free-form JSON for top-level fields. Only `p_handler_facts` is JSONB because it is variable-length.
- `SECURITY DEFINER` + `SET search_path` match the existing RPC idiom (§2.2).
- **Identity derivation:** `user_id` is always read from `scenarios.user_id`. Caller cannot inject an alternative. This is a single source of truth and defends against CEE bugs in addition to malicious callers.
- **Execute-grant pattern:** revoke from PUBLIC, no grant to authenticated. CEE uses service-role; that role inherits EXECUTE via superuser-like privileges at the Postgres layer.
- **Duplicate-turn guard:** the `IF NOT FOUND ... RETURN` early-exit ensures handler_facts are written exactly once per `(scenario_id, turn_id)`. Re-invoking `append_turn_atomic` on a committed turn is a safe no-op that returns the same turn UUID, not a duplicate-key error and not a double-write.
- **JSONB NULL safety:** `jsonb_array_length` raises on NULL input. `COALESCE(p_handler_facts, '[]'::jsonb)` treats NULL and empty-array uniformly. The signature still declares JSONB (not nullable) — callers should pass `[]` for handlerless turns — but defence-in-depth is cheap here.

**Post-migration validation (Tranche 2 deliverable, mandatory).** Once this migration is applied against staging Supabase, Tranche 2's evidence pack MUST include a one-shot integration test that:
1. Creates a throwaway `scenarios` row (or reuses a staging test fixture).
2. Calls `append_turn_atomic(...)` via `supabase-js` with the CEE service-role key.
3. Asserts the call returns a UUID, **not** a `permission denied` or `42501` error.
4. Cleans up the throwaway row.

This validates the grant model end-to-end against a real database rather than relying on Postgres-role-inheritance assumptions. If the call fails with a permission error, investigate and fix before handing off to Slice B proper — the RPC signature is the only Phase 0 artefact that depends on a non-local runtime assumption about Supabase role privileges.

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

## 5. **Verdict: NEW_TABLES with scoped cleanup prelude** (plan rev 2 revision 9, revised 2026-04-17)

V5 session persistence adds two new tables (`conversation_turns`, `handler_facts`) + one new RPC (`append_turn_atomic`) + matching RLS policies.

**Revised on 2026-04-17** after the introspection run surfaced a pre-existing incompatible `public.conversation_turns` sketch table (4/11 expected columns, 0 rows — see §2.7 shape characterisation). The migration now requires a single-statement cleanup prelude:

```sql
DROP TABLE IF EXISTS public.conversation_turns CASCADE;
```

This is scoped (one table, verified-empty at probe time), gated (Paul-confirmation checklist in §2.7 before the prelude ships), and conditional (if any check in the checklist surfaces a blocker, the fallback is option 2 — rename V5 tables to `v5_conversation_turns` / `v5_handler_facts` and leave the existing sketch alone).

**Zero impact on other existing state.** `scenarios`, `shared_briefs`, `cee_prompts*`, draft-failures store, and every SECURITY DEFINER RPC continue unchanged. The cleanup targets only the empty `conversation_turns` sketch.

**`scenarios.events` disposition:** Replace (for turn-level data) — see §3.3. The column is unchanged; V5 simply does not write to it. UI-owned lifecycle events continue unchanged.

---

## 6. Dependency on Phase 0 schemas work

**Status:** landed. `@talchain/schemas@0.5.0` shipped the baseline (SessionTurn, HandlerFact discriminated union, per-handler arg + result schemas, 5 handler-result block types on the BlockSchema union, V5ActionType alias, DecisionContext placeholder). `@talchain/schemas@0.5.1` added defensive tightening:
- `SessionTurnSchema` / `SessionCacheEntrySchema` enforce the `turn_class='handler' ⇔ handler_id IS NOT NULL` biconditional via Zod `.refine()`, mirrored by the SQL CHECK constraint in §4.5.
- `GraphPatchBlockSchema.operation` narrowed from the full 7-value `ActionType` enum to the three graph-edit literals (`set_factor_value | add_constraint | adjust_edge_strength`), with a runtime subset-drift guard test.
- `AddConstraintArgsSchema` gains `.superRefine()` cross-field validation — impossible kind/bound combinations (e.g. `range` with null bounds) reject at dispatch rather than propagating to a handler.

The package now exports all of:
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

## 8. Approvals + remaining Phase 0 work

Paul has approved (in sequence) the audit verdict, the `scenarios.events` disposition, the proposed DDL + RPC, the action-type mapping table, the RLS + grant posture, and the post-review hardening (P0-3 RPC redesign, P1-1 biconditional, P1-2 explicit service_role grant, P1-3 cross-field validation).

**Landed:**
- `@talchain/schemas@0.5.0` → `0.5.1` (additive-only; negative contract tests cover every refinement). Vendored into CEE + UI with SHA-manifested tarball. Typecheck clean on both.
- Audit doc hardened with P0-3 RPC redesign (§4.4), P1-1 SQL CHECK (§4.5), P1-2 explicit service_role grant (§4.4), live introspection snapshot + residual-risk sign-off (§2.7).
- Memory corrected: Supabase credentials live in the Render deploy environment, not local `.env`.

**Remaining Phase 0 work (Tranche 1 close-out):**
- 7 new `CeeTaskId` literals in [src/prompts/schema.ts](../../src/prompts/schema.ts) matching the 7 V5 handler task IDs.
- 7 new `OPERATION_TO_TASK_ID` entries in [src/adapters/llm/prompt-loader.ts](../../src/adapters/llm/prompt-loader.ts) mapping handler operations to task IDs.
- 7 placeholder prompt fragments in [src/prompts/defaults.ts](../../src/prompts/defaults.ts) (Paul remains sole author of real prompt content).
- Migration file at `supabase/migrations/2026XXXX_v5_session_store.sql` incorporating the DDL + RPC from §4 verbatim (additive, idempotent).
- Break-glass rollback companion at `supabase/migrations/rollback/2026XXXX_v5_session_store_rollback.sql.do-not-apply`.
- `scripts/validate-data-responsibility.sh` grep-guard against cross-service computation leaks.
- `scripts/validate-phase-0-complete.sh` closure script (I-1) that fails if any of the above are missing, so partial-Phase-0 states cannot pass informal verification.
- Final Phase 0 evidence-pack commit.

The migration itself is **not** run by Phase 0 — applying it against staging Supabase is a separate operational step that happens at Tranche 2 start, immediately before the Slice B session layer needs the tables.

Phase 0 then hard-stops for Tranche 2 (Slice B) approval.

---

## 9. Operational notes (post-Phase-0 housekeeping)

**Rotate the staging Supabase `service_role` key after Phase 0 closes.** The key was briefly transited through conversation logs during the 2026-04-17 introspection runs (two uses: `scripts/phase-0-introspect.ts` and `scripts/phase-0-shape-probe.ts`). Do NOT rotate mid-Phase-0 — introspection will keep needing the key for (a) post-resolution re-run of `phase-0-introspect.ts` and (b) the Tranche 2 post-migration RPC-grant validation test per §4.4. Rotate once Phase 0 is signed off and Tranche 2's grant-validation test has run successfully. Action: Supabase dashboard → Project Settings → API → service_role key → Rotate. Re-deploy CEE and UI with the fresh key.

**Future introspection hygiene.** Prefer piping secrets via `op run --` (1Password CLI), `direnv`-managed `.envrc` files that never commit, or a shell-local `~/.config/olumi/supabase-staging.env` sourced explicitly rather than pasted into chat. The current-round exposure is bounded and mitigated by rotation; do not normalise the paste-into-chat pattern.
