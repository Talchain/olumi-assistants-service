-- ============================================================
-- V5 Phase 1 brief persistence: persist user-supplied free-text
-- decision brief on the scenarios row, transactionally with the
-- first draft turn via append_turn_atomic.
-- Target: Staging Supabase
-- Date: 2026-05-02
--
-- Why:
--   Defect B (decision_review skips with `no_brief` despite
--   `_meta.decision_brief_assembled: true`). Root cause: the brief
--   is passed out-of-band via RunTurnExecutorOptions.scenarioBrief
--   and never persisted. No caller currently populates that option.
--   chip-click-dispatch.ts hardcodes brief: null when invoking the
--   enricher directly. After this migration, the brief lives on
--   scenarios.brief_text and both enricher call sites read it from
--   canonical state via EnrichedTurnContext.scenarioBriefText.
--
-- Distinct from scenarios.brief:
--   scenarios.brief is JSONB (DecisionBriefV1 — V4 residual / future
--   structured storage). Verified via information_schema on the live
--   schema during Phase 0 of this work. We do NOT modify scenarios.brief.
--   brief_text is the new TEXT column for the user-supplied free-text
--   message.
--
-- Write-once semantics:
--   The brief is set on the first draft turn that supplies a non-null
--   p_brief_text. The WHERE predicate
--     (brief_text IS NULL OR brief_text = '')
--   silently ignores subsequent writes — protecting against:
--     1. Repair / edit / regeneration turns that re-pass payload.message
--        through the same dispatch path.
--     2. A future caller that legitimately writes a new turn_id with a
--        different brief.
--   First-write-wins is intentional for Phase 1. Brief regeneration
--   semantics are out of scope and a Phase 2 candidate.
--
--   The FOUND-based idempotency guard in append_turn_atomic (preserved
--   from 20260422210000) ALREADY prevents conflict-replay overwrite
--   (same scenario_id + same turn_id retried). The brief_text block
--   placed AFTER the FOUND guard inherits this protection by construction.
--
-- Idempotency:
--   ALTER TABLE … ADD COLUMN IF NOT EXISTS — safe to re-run.
--   ALTER TABLE … DROP CONSTRAINT IF EXISTS — drop-then-add for re-runs.
--   DROP FUNCTION IF EXISTS — succeeds whether the overload exists
--     or not.
--   CREATE OR REPLACE FUNCTION — replaces atomically.
--
-- Overload housekeeping:
--   Adding a parameter to append_turn_atomic produces a new function
--   from PostgreSQL's perspective (CREATE OR REPLACE keys on the full
--   signature, not the name). To prevent the same PostgREST candidate
--   ambiguity bug 20260426160532 already fixed once, this migration
--   DROPs the 10-arg overload before creating the 11-arg version.
--   The 9-arg overload is dropped by 20260426160532 (which runs FIRST
--   in timestamp order, before this migration). After both migrations
--   apply, exactly one append_turn_atomic exists in the database.
--
-- Verification (run after migration applies):
--   SELECT proname, pronargs FROM pg_proc WHERE proname = 'append_turn_atomic';
--     -- Expected: exactly one row with pronargs = 11.
--   SELECT pg_get_function_identity_arguments(oid)
--     FROM pg_proc WHERE proname = 'append_turn_atomic';
--     -- Expected: ends with `, p_brief_text text`.
--   \d scenarios
--     -- Expected: brief_text TEXT column with CHECK + COMMENT.
--   SELECT has_function_privilege('service_role', 'append_turn_atomic(...)', 'EXECUTE');
--     -- Expected: true.
-- ============================================================

-- 1. Add the brief_text column.
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS brief_text TEXT;

-- 2. CHECK constraint enforces BOTH bounds at the DB layer
--    (defence-in-depth alongside app-side normaliseBriefText):
--      a. Stored length 1..8000 (prevents over-length values reaching
--         storage via direct RPC or SQL that bypasses normaliseBriefText —
--         e.g. a 9000-char string padded with trailing whitespace would
--         pass a btrim-only check while still bloating the row).
--      b. Trimmed content non-empty (rejects whitespace-only stores
--         that the app-side normaliser already collapses to undefined).
--    Drop-then-add for migration idempotency.
ALTER TABLE scenarios DROP CONSTRAINT IF EXISTS scenarios_brief_text_length;
ALTER TABLE scenarios
  ADD CONSTRAINT scenarios_brief_text_length
  CHECK (
    brief_text IS NULL
    OR (char_length(brief_text) BETWEEN 1 AND 8000
        AND char_length(btrim(brief_text)) >= 1)
  );

-- 3. Documentation. Operators reading \d scenarios should immediately
--    understand the source of truth and the distinction from brief.
COMMENT ON COLUMN scenarios.brief_text IS
  'V5 first-turn user-supplied free-text decision brief. Written by CEE via '
  'append_turn_atomic(p_brief_text). Source of truth for decision_review '
  'enricher. Distinct from scenarios.brief (JSONB DecisionBriefV1 structured '
  'storage). Null permitted for system_event-only or pre-V5 scenarios. '
  'First-write-wins semantics enforced by the RPC WHERE clause.';

-- 4. Drop the 10-arg overload BEFORE creating the 11-arg version to
--    eliminate PostgREST candidate ambiguity (the 20260426160532 bug).
--    The 9-arg overload was already dropped by 20260426160532, which
--    runs first in timestamp order.
DROP FUNCTION IF EXISTS public.append_turn_atomic(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb
);

-- 5. CREATE OR REPLACE the 11-arg version. The body below is the
--    20260422210000 body verbatim plus ONE new block (the brief_text
--    UPDATE), inserted between the existing handler_facts insert and
--    the final RETURN, matching the brief's contract for surgical
--    placement. The new block is still downstream of the FOUND-based
--    idempotency guard (which short-circuits much earlier in the body),
--    so it inherits the same conflict-replay protection the graph
--    write enjoys — but the load-bearing placement constraint is
--    "after handler_facts, before RETURN", not the FOUND ordering.
CREATE OR REPLACE FUNCTION append_turn_atomic(
  p_scenario_id      UUID,
  p_turn_id          TEXT,
  p_turn_class       TEXT,
  p_handler_id       TEXT,
  p_request_hash     TEXT,
  p_response_emitted BOOLEAN,
  p_llm_calls_used   INTEGER,
  p_duration_ms      INTEGER,
  p_handler_facts    JSONB,
  p_graph            JSONB DEFAULT NULL,
  p_brief_text       TEXT  DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_turn_id   UUID;
  v_user_id   UUID;
  v_fact      JSONB;
  v_updated   INTEGER;
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
    -- Conflict replay: deduplicated turn, idempotent return.
    -- Do NOT write p_graph or p_brief_text — scenarios.* must not be
    -- mutated on retry. This is the load-bearing idempotency invariant.
    SELECT id INTO v_turn_id
      FROM v5_conversation_turns
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
    RETURN v_turn_id;
  END IF;

  -- New turn inserted. Now write the graph atomically in the same transaction.
  -- Gating on FOUND (above) ensures this block never runs on conflict replay,
  -- preserving the idempotency invariant for graph writes.
  IF p_graph IS NOT NULL THEN
    UPDATE scenarios SET graph = p_graph WHERE id = p_scenario_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      -- Should never happen: step 1 confirmed the scenarios row exists.
      -- Raise so the anomaly surfaces rather than being silently dropped.
      RAISE EXCEPTION 'append_turn_atomic: scenarios row % vanished between SELECT and UPDATE', p_scenario_id;
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
  -- Placement is AFTER the handler_facts insert and BEFORE the final
  -- RETURN, matching the brief's contract for surgical placement.
  -- The FOUND guard above ensures this block is unreachable on
  -- conflict-replay (so a retry carrying a different brief cannot mutate
  -- state). The WHERE predicate adds first-write-wins protection against
  -- non-conflict callers (different turn_id) that pass a different brief
  -- (e.g. brief regeneration). First-write-wins is intentional for
  -- Phase 1; explicit regenerate semantics are out of scope.
  -- ROW_COUNT is NOT checked here — a "no rows updated" outcome means
  -- the brief was already set, which is the intended write-once behaviour.
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

-- 6. Re-issue GRANTs explicitly. CREATE OR REPLACE preserves grants only
--    when the signature is unchanged; param-count change creates a new
--    function from PostgreSQL's perspective.
--
--    Phase 0 capture of the 10-arg ACL on the live DB (Olumi project,
--    2026-05-02):
--      service_role=X/postgres
--    plus the system roles (postgres + the implicit `=X` PUBLIC entry).
--
--    This matches the precedent set by 20260422200000 which REVOKEd
--    PUBLIC + service_role on the 9-arg signature and re-GRANTed only
--    to service_role on the 10-arg signature. We follow the same
--    pattern: REVOKE PUBLIC, GRANT service_role.
--
--    Note: the live DB still shows anon=X / authenticated=X on the
--    9-arg overload — those are the pre-V5-Slice-B grant pattern that
--    20260426160532 cleans up by dropping the 9-arg overload entirely.
--    They are NOT re-granted here because CEE's HTTP ingress is
--    service-role only (api key + HMAC, not Supabase JWT).
REVOKE EXECUTE ON FUNCTION append_turn_atomic(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION append_turn_atomic(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text
) TO service_role;
