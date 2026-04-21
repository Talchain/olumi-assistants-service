-- ============================================================
-- V5 cross-tenant enforcement (Group 3 P0 follow-up).
--
-- Status at time of drafting: NOT APPLIED. Paul owns the decision
-- on when/whether to apply this migration; the CEE-side code that
-- would call the new functions is present but gated on the
-- ENABLE_V5_CROSS_TENANT_ENFORCEMENT feature flag (default false).
-- With the flag off, V5 continues to call the original
-- `append_turn_atomic` (no user_id check) and the original
-- preflight pattern (service-role SELECT on `scenarios.id`).
-- With the flag on AFTER this migration is applied, V5 calls the
-- new `append_turn_atomic_v2` and `check_scenario_ownership`
-- functions, which enforce scenarios.user_id = p_user_id.
--
-- Why a feature flag instead of replacing the existing function:
--   1. Rolling forward/back the CEE deploy is trivial; rolling a
--      Supabase function back is a Paul-owned operation. The
--      flag lets CEE changes ship without coupling to the
--      migration's timing.
--   2. Failure modes are easier to reason about: flag-off keeps
--      the documented pre-Group-3 behaviour (UI-auth-only guard);
--      flag-on switches to the new path atomically.
--
-- How to apply:
--   1. Review this migration.
--   2. Apply it to staging via Supabase (the SQL editor or
--      `supabase db push`).
--   3. Set `ENABLE_V5_CROSS_TENANT_ENFORCEMENT=true` in the CEE
--      staging env.
--   4. Deploy CEE.
--   5. Verify with the integration test in
--      `tests/integration/orchestrate-v2-cross-tenant.test.ts`
--      (once Paul wires the scaffolded auth hook — see
--      src/orchestrator/route-v2.ts TODO block).
--   6. After soak, apply to production.
--
-- Rollback: drop the two new functions and the feature flag.
-- Data written by the new functions is compatible with the
-- original schema — no backfill needed.
-- ============================================================

-- ------------------------------------------------------------
-- 1. check_scenario_ownership(p_scenario_id, p_user_id)
--
-- Returns TRUE iff `public.scenarios` has a row with id =
-- p_scenario_id AND user_id = p_user_id. Returns FALSE for both
-- "row missing" and "row owned by a different user" — callers
-- treat them uniformly as "preflight fail" (the distinction
-- would be a leak: telling a non-owner "yes it exists but you
-- can't touch it" is worse than telling them "not found").
--
-- SECURITY DEFINER + pinned search_path so the service_role
-- bypass still reads `public.scenarios` correctly; the check is
-- in the body, not in RLS.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION check_scenario_ownership(
  p_scenario_id UUID,
  p_user_id     UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM scenarios
    WHERE id = p_scenario_id
      AND user_id = p_user_id
  ) INTO v_exists;
  RETURN v_exists;
END;
$$;

REVOKE EXECUTE ON FUNCTION check_scenario_ownership(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION check_scenario_ownership(UUID, UUID) TO service_role;

-- ------------------------------------------------------------
-- 2. append_turn_atomic_v2(..., p_user_id)
--
-- Same contract as `append_turn_atomic` (the pre-Group-3
-- function) with one hard additional check: the scenario MUST
-- belong to p_user_id, or the function raises
-- 'scenario % not found' — deliberately the same message as
-- the original "row missing" case, so callers treat both as a
-- preflight-fail without leaking ownership information.
--
-- Non-breaking: the original `append_turn_atomic` still exists
-- and still works. Callers migrate at their pace via the
-- ENABLE_V5_CROSS_TENANT_ENFORCEMENT flag.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION append_turn_atomic_v2(
  p_scenario_id      UUID,
  p_user_id          UUID,
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
  v_turn_id      UUID;
  v_owner_ok     BOOLEAN;
  v_fact         JSONB;
BEGIN
  -- Ownership check: scenario must exist AND belong to p_user_id.
  -- Callers see a single "not found" surface for both cases — do
  -- not leak ownership info across tenants.
  SELECT EXISTS (
    SELECT 1 FROM scenarios
    WHERE id = p_scenario_id AND user_id = p_user_id
  ) INTO v_owner_ok;

  IF NOT v_owner_ok THEN
    RAISE EXCEPTION 'scenario % not found', p_scenario_id;
  END IF;

  INSERT INTO v5_conversation_turns (
    scenario_id, user_id, turn_id, turn_class, handler_id,
    request_hash, response_emitted, llm_calls_used, duration_ms
  ) VALUES (
    p_scenario_id, p_user_id, p_turn_id, p_turn_class, p_handler_id,
    p_request_hash, p_response_emitted, p_llm_calls_used, p_duration_ms
  )
  ON CONFLICT (scenario_id, turn_id) DO NOTHING
  RETURNING id INTO v_turn_id;

  IF NOT FOUND THEN
    -- Idempotent replay of same (scenario, turn_id). Preserve
    -- the v1 behaviour of returning the existing row id.
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
        p_user_id,
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

REVOKE EXECUTE ON FUNCTION append_turn_atomic_v2(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION append_turn_atomic_v2(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB) TO service_role;
