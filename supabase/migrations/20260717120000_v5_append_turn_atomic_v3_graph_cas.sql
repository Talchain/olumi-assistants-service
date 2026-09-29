-- ============================================================
-- V5 graph CAS — append_turn_atomic_v3 (in-transaction compare-and-swap)
-- Target: Staging Supabase
--
-- ⚠️  AUTHORED AS CODE — NOT YET EXECUTED. Execution is Paul-gated
--     (POC-BOARD item 3, trust-spine batch). You (the reviewer/operator)
--     run this; the CEE lane does NOT. When applied, update this header
--     with the execution date + evidence pointer, per the
--     20260705120000_v5_model_versions.sql precedent.
--
-- Date authored: 2026-07-17
-- Date executed: (pending — Paul-gated)
--
-- Design source of truth:
--   Docs/v5/proposals/append-turn-atomic-v3-graph-cas.md
--   This migration realises that proposal verbatim (FOR UPDATE row lock →
--   in-transaction identity compare → typed OLGC1 conflict → stamp the new
--   graph_identity_hash column). Nothing here recomputes the hash; the app
--   (CEE src/orchestrator-v5/context/graph-identity.ts, identity.v1) is the
--   single normaliser authority. Postgres only compares opaque strings.
--
-- Why this exists (the concurrency dead-end root):
--   The live commit path (append_turn_atomic_v2, migration 20260609120000)
--   runs an UNCONDITIONAL `UPDATE scenarios SET graph = p_graph`. A
--   stale-base edit therefore silently CLOBBERS a concurrent write — the
--   baseGraphHash the app captures at turn start is audit-trail-only and is
--   never enforced at the write. The A3 app-side hook
--   (graph-cas-conflict.ts) only OBSERVES: its pre-write SELECT and the RPC
--   are two round-trips (a SELECT-then-write TOCTOU window), so it can
--   measure conflicts but never guarantee it caught one. v3 closes the
--   window by moving the compare INSIDE the transaction, under the row lock.
--
-- Backward compatibility (load-bearing — this is what lets the migration
-- land before any caller passes the new params):
--   All three CAS params default such that the function is byte-behaviour-
--   equivalent to v2 when they are absent:
--     - p_cas_enforce DEFAULT FALSE  → the compare block is skipped entirely;
--       the UPDATE is unconditional, exactly as v2.
--     - p_expected_graph_identity_hash DEFAULT NULL → no base to compare.
--     - p_incoming_graph_identity_hash DEFAULT NULL → graph_identity_hash is
--       stamped NULL (indistinguishable from a v2 write, which never touches
--       the column).
--   So: enforce=false OR expected=NULL OR the scenario has no recorded
--   current hash → today's unconditional behaviour. A conflict is raised
--   ONLY when the caller opts in (enforce=true) AND supplied an expected
--   base AND the row has a recorded current hash AND they diverge AND the
--   incoming write is not a self-noop.
--
-- Naming: a NEW, distinctly named function — never a same-name overload of
--   append_turn_atomic / _v2. Precedent: the V5 Step 4 staging outage
--   (request_id 99a83f32-…, 2026-04-26) where a CREATE OR REPLACE at a
--   different arity left two coexisting overloads and PostgREST failed every
--   commit with "Could not choose the best candidate function between …".
--   A distinct name makes that failure class structurally impossible. v2
--   stays intact and callable throughout; the app cuts over only when v3 is
--   live (CEE_V5_GRAPH_CAS_RPC=shadow|enforce) and can roll back by calling
--   v2 again (flag → off).
--
-- Idempotency invariant (identical to v2): the conflict-replay branch
--   (ON CONFLICT DO NOTHING → NOT FOUND) SKIPS CAS entirely and returns the
--   existing row id. A retried request whose first attempt already won must
--   never surface a stale-write error for its own successful write, and
--   scenarios.graph / graph_identity_hash must not be re-mutated on replay.
--
-- Self-noop safety (identical semantics to the app-side `self_noop`
--   category): when p_incoming_graph_identity_hash equals the recorded
--   current hash, the write is content-idempotent and is ALWAYS allowed,
--   however stale the expected base — a duplicate submission / idempotent
--   replay can never corrupt state.
--
-- Grants: Supabase default privileges auto-grant EXECUTE to anon/
--   authenticated on new public functions (the A4 lesson). Revoke both
--   plus PUBLIC explicitly; grant service_role only — same posture as v2.
--
-- Rollback:
--   rollback/20260717120000_v5_append_turn_atomic_v3_graph_cas_rollback.sql.do-not-apply
--   drops the function and the column (the column add is IF NOT EXISTS and
--   nullable, so the drop is trivially reversible; no data depends on it —
--   a NULL column behaves as "no recorded base").
--
-- Verification (run after the separately-approved execution):
--   SELECT proname, pronargs FROM pg_proc WHERE proname = 'append_turn_atomic_v3';
--     -- Expected: exactly one row, pronargs = 18.
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'scenarios' AND column_name = 'graph_identity_hash';
--     -- Expected: one row.
--   SELECT has_function_privilege('service_role',
--     'public.append_turn_atomic_v3(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, text, text, boolean)',
--     'EXECUTE');  -- true
--   SELECT has_function_privilege('anon',
--     'public.append_turn_atomic_v3(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, text, text, boolean)',
--     'EXECUTE');  -- false (and same for 'authenticated')
-- ============================================================

-- ── 1. CAS anchor column on scenarios (app-computed, never DB-derived) ──
ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS graph_identity_hash TEXT NULL;

COMMENT ON COLUMN public.scenarios.graph_identity_hash IS
  'V5 graph CAS (append_turn_atomic_v3): full 64-hex graphIdentityHash of '
  'scenarios.graph, COMPUTED BY THE APP (single normaliser authority: CEE '
  'src/orchestrator-v5/context/graph-identity.ts — identity.v1 projection). '
  'NULL = never written via v3 / graph absent. Postgres only ever compares '
  'this value; it never derives it. Stamped in lock-step with scenarios.graph '
  'by the v3 UPDATE.';

-- ── 2. append_turn_atomic_v3: v2 body + in-transaction graph CAS ──
-- Body copied verbatim from append_turn_atomic_v2 (20260609120000) EXCEPT:
--   (a) the scenarios read takes FOR UPDATE (not the bare SELECT) — this is
--       the row lock that serialises concurrent graph writers and makes the
--       compare below race-free (what the app-side A3 hook cannot do);
--   (b) the graph write is preceded by the CAS block and additionally stamps
--       graph_identity_hash.
CREATE OR REPLACE FUNCTION public.append_turn_atomic_v3(
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
  -- the remainder of the transaction. This is exactly what the app-side hook
  -- cannot do — the compare below is race-free. Also reads the recorded
  -- current identity hash under the same lock.
  SELECT user_id, graph_identity_hash
    INTO v_user_id, v_current_hash
    FROM scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  -- Use FOUND (set by SELECT INTO) to distinguish "row absent" from
  -- "guest row with user_id IS NULL".
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
    -- (same load-bearing idempotency invariant as v2): not scenarios.graph,
    -- not graph_identity_hash, not brief_text.
    SELECT id INTO v_turn_id
      FROM v5_conversation_turns
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
    RETURN v_turn_id;
  END IF;

  -- New turn inserted. Now write the graph atomically in the same transaction.
  -- Gating on FOUND (above) ensures this block never runs on conflict replay,
  -- preserving the idempotency invariant for graph writes.
  IF p_graph IS NOT NULL THEN
    -- In-transaction CAS, under the FOR UPDATE lock taken above.
    -- Enforce ONLY when the caller opted in AND supplied an expected hash
    -- AND a recorded current hash exists AND the incoming write is not a
    -- self-noop (incoming == current ⇒ content-idempotent, always allowed —
    -- mirrors the app-side self_noop category). Any of these being false
    -- falls through to today's unconditional UPDATE (v2-equivalent).
    IF p_cas_enforce
       AND p_expected_graph_identity_hash IS NOT NULL
       AND v_current_hash IS NOT NULL
       AND v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash
       AND (p_incoming_graph_identity_hash IS NULL
            OR p_incoming_graph_identity_hash IS DISTINCT FROM v_current_hash)
    THEN
      -- Typed, matchable error: the app maps SQLSTATE 'OLGC1' (custom class)
      -- onto its GraphStaleWriteError envelope (409-class refresh-reconfirm).
      -- The WHOLE transaction rolls back — the turn row included — so no
      -- partial state survives and nothing is clobbered.
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
      -- Should never happen: the FOR UPDATE above confirmed the row exists.
      -- Raise so the anomaly surfaces rather than being silently dropped.
      RAISE EXCEPTION 'append_turn_atomic_v3: scenarios row % vanished under lock', p_scenario_id;
    END IF;
  END IF;

  IF jsonb_array_length(COALESCE(p_handler_facts, '[]'::jsonb)) > 0 THEN
    FOR v_fact IN SELECT * FROM jsonb_array_elements(p_handler_facts)
    LOOP
      INSERT INTO v5_handler_facts (
        v5_conversation_turn_id, scenario_id, user_id,
        handler_id, action_type, noop, payload
      ) VALUES (
        v_turn_id,
        p_scenario_id,
        v_user_id,
        v_fact->>'handler_id',
        v_fact->>'action_type',
        COALESCE((v_fact->>'noop')::boolean, FALSE),
        COALESCE(v_fact->'payload', '{}'::jsonb)
      );
    END LOOP;
  END IF;

  -- V5 Phase 1 brief persistence: write user-supplied brief_text once.
  -- First-write-wins enforced by the WHERE predicate. ROW_COUNT is NOT
  -- checked here — a "no rows updated" outcome means the brief was
  -- already set, which is the intended write-once behaviour.
  IF p_brief_text IS NOT NULL THEN
    UPDATE scenarios
       SET brief_text = p_brief_text,
           updated_at = NOW()
     WHERE id = p_scenario_id
       AND (brief_text IS NULL OR brief_text = '');
  END IF;

  RETURN v_turn_id;
END;
$$;

-- ── 3. Lockdown — service-role only (A4 posture, identical to v2) ──
REVOKE EXECUTE ON FUNCTION public.append_turn_atomic_v3(
  uuid, text, text, text, text, boolean, integer, integer, jsonb,
  jsonb, text, jsonb, jsonb, text, text, text, text, boolean
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.append_turn_atomic_v3(
  uuid, text, text, text, text, boolean, integer, integer, jsonb,
  jsonb, text, jsonb, jsonb, text, text, text, text, boolean
) TO service_role;
