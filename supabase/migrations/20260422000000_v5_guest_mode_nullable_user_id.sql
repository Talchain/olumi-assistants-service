-- ============================================================
-- V5 guest mode: make scenarios.user_id nullable
-- Target: Staging Supabase
-- Date: 2026-04-22
--
-- Problem solved:
--   The PoC runs in guest mode (VITE_AUTH_MODE=guest) with no
--   Supabase authentication. No user_id is available on any turn.
--   The previous ensure_scenario_exists RPC required a non-null
--   p_user_id because scenarios.user_id was NOT NULL with a FK to
--   auth.users(id). The preflightEnsureScenario short-circuited
--   when userId === null, so no row was ever created, and
--   append_turn_atomic then failed with "scenario X not found".
--
-- Fix:
--   1. Drop the FK constraint from scenarios.user_id → auth.users(id)
--      (guest scenario rows have no corresponding auth user).
--   2. ALTER scenarios.user_id DROP NOT NULL (guest rows store NULL).
--   3. Relax v5_conversation_turns.user_id and v5_handler_facts.user_id
--      to allow NULL (they are denormalised from scenarios.user_id).
--   4. Replace ensure_scenario_exists to accept p_user_id UUID DEFAULT
--      NULL — inserts NULL when no user is present.
--   5. Fix append_turn_atomic's "scenario not found" guard: distinguish
--      row-absent from row-present-with-null-user_id.
--
-- Security posture: unchanged. This is a PoC-grade service-to-service
-- endpoint with service-role key auth. Guest rows are identifiable by
-- user_id IS NULL. Production upgrade path: JWT-scoped client as
-- documented in the existing migration header.
--
-- Additive-only where possible. Idempotent. Safe to re-run.
-- ============================================================

-- ── 1. Drop FK from scenarios.user_id → auth.users(id) ─────────────
-- The constraint name was set by Supabase's default naming convention.
-- We use IF EXISTS so re-runs are safe even if it was already dropped.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'scenarios'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name = 'scenarios_user_id_fkey'
  ) THEN
    ALTER TABLE scenarios DROP CONSTRAINT scenarios_user_id_fkey;
  END IF;
END$$;

-- ── 2. Drop NOT NULL on scenarios.user_id ───────────────────────────

ALTER TABLE scenarios ALTER COLUMN user_id DROP NOT NULL;

-- ── 3. Relax denormalised user_id columns in turn/fact tables ────────
-- These columns are populated from scenarios.user_id by
-- append_turn_atomic. They must accept NULL now that scenarios rows
-- can be created without a user.

ALTER TABLE v5_conversation_turns ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE v5_handler_facts      ALTER COLUMN user_id DROP NOT NULL;

-- ── 4. Replace ensure_scenario_exists (nullable p_user_id) ──────────
-- Drop the old signature (UUID, UUID) first because we are changing a
-- parameter type from UUID to UUID DEFAULT NULL — Postgres treats
-- default-less and defaulted overloads as the same signature, so a
-- CREATE OR REPLACE is sufficient here as long as the param types
-- match. The old function had no default; adding DEFAULT NULL keeps
-- the same binary signature and is a DROP+CREATE under the hood
-- when using CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION ensure_scenario_exists(
  p_scenario_id UUID,
  p_user_id     UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Idempotent upsert. ON CONFLICT DO NOTHING never overwrites an
  -- existing row's user_id. p_user_id is NULL for guest sessions.
  INSERT INTO scenarios (id, user_id)
  VALUES (p_scenario_id, p_user_id)
  ON CONFLICT (id) DO NOTHING;

  -- Re-read the stored user_id. Use FOUND (set by SELECT INTO in
  -- PL/pgSQL) to distinguish row-absent from guest-row-with-null-user_id.
  SELECT user_id INTO v_user_id
    FROM scenarios
    WHERE id = p_scenario_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ensure_scenario_exists: scenario % neither inserted nor found', p_scenario_id;
  END IF;

  -- Return the authoritative user_id (NULL for guest rows).
  RETURN v_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION ensure_scenario_exists(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION ensure_scenario_exists(UUID, UUID) TO service_role;

COMMENT ON FUNCTION ensure_scenario_exists(UUID, UUID) IS
  'V5 pre-flight: idempotently upsert a scenarios row. p_user_id is NULL for guest sessions (VITE_AUTH_MODE=guest). Returns the authoritative user_id (NULL for guest rows). Callers should skip cross-tenant ownership check when returned value is NULL. PoC scope.';

-- ── 5. Replace append_turn_atomic (NULL-safe "scenario not found") ───
-- The old guard was: IF v_user_id IS NULL THEN RAISE 'scenario not found'
-- This conflates "row absent" with "guest row (user_id IS NULL)".
-- Fix: use FOUND after SELECT INTO to detect row absence.

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
AS $$
DECLARE
  v_turn_id UUID;
  v_user_id UUID;
  v_fact    JSONB;
BEGIN
  SELECT user_id INTO v_user_id FROM scenarios WHERE id = p_scenario_id;
  -- Use FOUND (set by SELECT INTO) to distinguish "row absent" from
  -- "guest row with user_id IS NULL".
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scenario % not found', p_scenario_id;
  END IF;

  INSERT INTO v5_conversation_turns (
    scenario_id, user_id, turn_id, turn_class, handler_id,
    request_hash, response_emitted, llm_calls_used, duration_ms
  ) VALUES (
    p_scenario_id, v_user_id, p_turn_id, p_turn_class, p_handler_id,
    p_request_hash, p_response_emitted, p_llm_calls_used, p_duration_ms
  )
  ON CONFLICT (scenario_id, turn_id) DO NOTHING
  RETURNING id INTO v_turn_id;

  IF NOT FOUND THEN
    SELECT id INTO v_turn_id
      FROM v5_conversation_turns
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
    RETURN v_turn_id;
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

  RETURN v_turn_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION append_turn_atomic(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION append_turn_atomic(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB) TO service_role;
