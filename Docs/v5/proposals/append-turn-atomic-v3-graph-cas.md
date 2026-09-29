# `append_turn_atomic_v3` — in-transaction graph CAS (proposal)

> **DESIGN ARTIFACT — NOT A MIGRATION — requires Paul's approval.**
> Nothing in this document is deployed, scheduled, or committed to. No file
> under `supabase/migrations/` exists for this. Build it ONLY if A3
> observe-mode telemetry (`v5.graph_cas.evaluated` conflict rates) or a
> product need justifies it — not speculatively.

## Why this exists

A3 (`CEE_V5_GRAPH_CAS_MODE`) is app-side stale-write **observation**: the
store SELECTs `scenarios.graph`, categorises the write, and (optionally,
non-prod) blocks before calling `append_turn_atomic_v2`. That SELECT and the
RPC are **two separate round-trips**, so a concurrent writer can land between
them — a classic SELECT-then-write TOCTOU window. A3 can therefore *measure*
conflicts and *usually* intercept them, but can never *guarantee* it caught
one.

Closing that window requires the compare to happen **inside the same
transaction as the write, under a row lock** — i.e. inside the RPC itself.
That is this proposal. Until it ships, no one may describe the A3 hook as
atomic CAS or complete write safety.

## Naming: a NEW function, never an overload

`append_turn_atomic_v3` MUST be a **distinctly named function** — never a
same-name overload of `append_turn_atomic` or `append_turn_atomic_v2`.

Precedent: the V5 Step 4 staging outage (request_id `99a83f32-…`,
2026-04-26). Migration `20260422210000` added a 10-arg `append_turn_atomic`
via `CREATE OR REPLACE`, which does not drop a different arity; the stale
9-arg version coexisted, and PostgREST failed every commit with *"Could not
choose the best candidate function between …"*. Two follow-up migrations were
needed to drop the stale arities, and the client now defensively passes every
named argument. A distinct name makes that whole failure class structurally
impossible; the v2 header comment in
`src/orchestrator-v5/session/supabase-store.ts` documents the same rule.

`append_turn_atomic_v2` remains intact and callable throughout — the app cuts
over only when v3 is live, and can roll back by calling v2 again.

## Proposed schema change

One nullable column on `scenarios`, **app-computed** — the single-normaliser
authority stays in CEE (`src/orchestrator-v5/context/graph-identity.ts`).
Postgres never recomputes or interprets the hash; it only compares strings.

```sql
-- DESIGN SKETCH — NOT A MIGRATION. Requires Paul's approval before any file
-- is created under supabase/migrations/.

ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS graph_identity_hash TEXT NULL;

COMMENT ON COLUMN public.scenarios.graph_identity_hash IS
  'A3/RPC-v3 graph CAS: full 64-hex graphIdentityHash of scenarios.graph, '
  'COMPUTED BY THE APP (single normaliser authority: CEE '
  'src/orchestrator-v5/context/graph-identity.ts — identity.v1 projection). '
  'NULL = never written via v3 / graph absent. Postgres only ever compares '
  'this value; it never derives it.';
```

Backfill is deliberately NOT proposed: `NULL` rows behave as "no recorded
base" and the first v3 write stamps the hash. This keeps the migration
trivially reversible and avoids a normaliser reimplementation in SQL.

## Proposed function

All 15 `append_turn_atomic_v2` params, plus three trailing CAS params. The
compare runs **inside the transaction, under `FOR UPDATE`**, and the
conflict-replay branch **skips CAS entirely** (retry safety — an idempotent
replay of an already-committed turn must return the existing row id exactly
as v2 does, never a CAS error).

```sql
-- DESIGN SKETCH — NOT A MIGRATION.
CREATE FUNCTION public.append_turn_atomic_v3(
  p_scenario_id                  UUID,
  p_turn_id                      TEXT,
  p_turn_class                   TEXT,
  p_handler_id                   TEXT,
  p_request_hash                 TEXT,
  p_response_emitted             BOOLEAN,
  p_llm_calls_used               INTEGER,
  p_duration_ms                  INTEGER,
  p_handler_facts                JSONB,
  p_graph                        JSONB DEFAULT NULL,
  p_brief_text                   TEXT  DEFAULT NULL,
  p_pending_actions              JSONB DEFAULT '[]'::jsonb,
  p_coaching_state               JSONB DEFAULT NULL,
  p_user_message                 TEXT  DEFAULT NULL,
  p_assistant_message            TEXT  DEFAULT NULL,
  -- CAS additions (all optional → v2-equivalent behaviour when absent):
  p_expected_graph_identity_hash TEXT    DEFAULT NULL,
  p_incoming_graph_identity_hash TEXT    DEFAULT NULL,
  p_cas_enforce                  BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_turn_id      UUID;
  v_user_id      UUID;
  v_current_hash TEXT;
  v_fact         JSONB;
  v_updated      INTEGER;
BEGIN
  -- Row lock FIRST: serialises concurrent graph writers on this scenario for
  -- the remainder of the transaction. This is what the app-side hook cannot
  -- do — the compare below is race-free.
  SELECT user_id, graph_identity_hash
    INTO v_user_id, v_current_hash
    FROM scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scenario % not found', p_scenario_id;
  END IF;

  INSERT INTO v5_conversation_turns (
    scenario_id, user_id, turn_id, turn_class, handler_id,
    request_hash, response_emitted, llm_calls_used, duration_ms,
    pending_actions, coaching_state, user_message, assistant_message
  ) VALUES (
    p_scenario_id, v_user_id, p_turn_id, p_turn_class, p_handler_id,
    p_request_hash, p_response_emitted, p_llm_calls_used, p_duration_ms,
    COALESCE(p_pending_actions, '[]'::jsonb), p_coaching_state,
    p_user_message, p_assistant_message
  )
  ON CONFLICT (scenario_id, turn_id) DO NOTHING
  RETURNING id INTO v_turn_id;

  IF NOT FOUND THEN
    -- Conflict replay: identical (scenario_id, turn_id) already committed.
    -- SKIP CAS ENTIRELY and return the existing row id — retry safety. A
    -- retried request whose first attempt already won must never surface a
    -- stale-write error for its own successful write. Nothing is mutated
    -- (same load-bearing idempotency invariant as v2).
    SELECT id INTO v_turn_id
      FROM v5_conversation_turns
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
    RETURN v_turn_id;
  END IF;

  IF p_graph IS NOT NULL THEN
    -- In-transaction CAS, under the FOR UPDATE lock taken above.
    -- Enforce ONLY when the caller opted in AND supplied an expected hash
    -- AND a recorded current hash exists AND the incoming write is not a
    -- self-noop (incoming == current ⇒ content-idempotent, always allowed —
    -- mirrors the app-side self_noop category).
    IF p_cas_enforce
       AND p_expected_graph_identity_hash IS NOT NULL
       AND v_current_hash IS NOT NULL
       AND v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash
       AND (p_incoming_graph_identity_hash IS NULL
            OR p_incoming_graph_identity_hash IS DISTINCT FROM v_current_hash)
    THEN
      -- Typed, matchable error: the app maps SQLSTATE 'OLGC1' (custom class)
      -- onto its GraphStaleWriteError envelope. The whole transaction rolls
      -- back — turn row included — so no partial state survives.
      RAISE EXCEPTION USING
        ERRCODE = 'OLGC1',
        MESSAGE = format(
          'append_turn_atomic_v3: stale graph write for scenario %s (expected %s, current %s)',
          p_scenario_id, p_expected_graph_identity_hash, v_current_hash);
    END IF;

    UPDATE scenarios
       SET graph = p_graph,
           graph_identity_hash = p_incoming_graph_identity_hash
     WHERE id = p_scenario_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      RAISE EXCEPTION 'append_turn_atomic_v3: scenarios row % vanished under lock', p_scenario_id;
    END IF;
  END IF;

  -- handler_facts + brief_text blocks: verbatim from append_turn_atomic_v2
  -- (fact loop; first-write-wins brief predicate). Elided here for brevity —
  -- the real migration copies them unchanged.

  RETURN v_turn_id;
END;
$$;

-- Lockdown identical to v2: Supabase default privileges grant EXECUTE to
-- anon/authenticated on new public functions; revoke both explicitly plus
-- PUBLIC. Service-role only.
REVOKE EXECUTE ON FUNCTION public.append_turn_atomic_v3(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB,
  JSONB, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon, authenticated;
```

## Rationale

- **Closes the app-side TOCTOU window.** The A3 hook's SELECT and RPC are
  separate statements; v3's compare happens after `FOR UPDATE` on the
  `scenarios` row, inside the same transaction as the graph UPDATE and turn
  INSERT. A concurrent writer either commits before the lock (and the compare
  sees its hash) or waits behind it. No interleaving escapes the check.
- **App stays the normaliser authority.** Postgres stores and compares an
  opaque string; `graph-identity.ts` (identity.v1) remains the only place the
  hash is computed. A projection-version bump is an app deploy, not a
  migration.
- **Self-noop stays safe at the DB layer too.** The
  `p_incoming_graph_identity_hash` guard reproduces the app-side `self_noop`
  category so idempotent replays / duplicate submissions are never rejected,
  even under enforcement.
- **Rollout shape (if approved):** migration → app passes the new params with
  `p_cas_enforce = FALSE` (dark) → compare telemetry against A3 observe
  events → flip `p_cas_enforce` per-environment. Each step independently
  reversible; v2 remains the fallback callee throughout.
- **Build trigger:** a sustained non-trivial `analysis_affecting_conflict`
  rate in `v5.graph_cas.evaluated` on staging/prod observe, or a product
  decision that concurrent-editor safety is required. If observe shows ~zero
  conflicts on the instrumented path, v3 stays unbuilt and this document is
  the record of why.
