-- ============================================================
-- V5 pending-actions persistence: persist offered resumable actions
-- alongside the turn that emits them, so the next turn's deterministic
-- short-confirm pre-route can resume without an LLM round-trip.
-- Target: Staging Supabase
-- Date: 2026-05-05
--
-- Why:
--   Phase 0 confirmed that V5 emits chips offering executable actions
--   (e.g. "Would you like to explore what would change this result?")
--   but those offers are computed ephemerally and never persisted. On
--   the next turn the LLM has no way to know what was offered, so a
--   user reply of "yes" routes to direct_answer with a generic "no
--   pending action queued" response. This migration adds a column on
--   v5_conversation_turns that stores the offered actions atomically
--   with the turn write, and extends append_turn_atomic with a default
--   parameter so existing 11-arg callers keep working unchanged.
--
-- Backward compatibility:
--   - The new column is NOT NULL with DEFAULT '[]'::jsonb. Old rows
--     read as the empty array. The application layer never sees null.
--   - The RPC parameter has DEFAULT '[]'::jsonb. Existing CEE callers
--     that omit the new arg keep working; they write an empty array.
--   - Conflict-replay idempotency (FOUND-based) is preserved verbatim:
--     same-(scenario_id, turn_id) retries with different pending_actions
--     do NOT mutate the existing row.
--
-- DB-layer constraints:
--   The CHECK constraint enforces ONLY:
--     a. value is a JSON array (jsonb_typeof = 'array');
--     b. array length is at most 3 (mirrors MAX_CHIPS).
--   It does NOT enforce per-element object shape — that is the read
--   path's job (Zod parser at session/pending-action.ts). DB-layer
--   shape checks would couple the schema to vendored JSON layout and
--   slow future structural changes; we keep the DB constraint thin
--   and rely on the application layer for full validation.
--
-- Overload housekeeping:
--   Adding a parameter creates a new function from PostgreSQL's
--   perspective. To prevent the PostgREST candidate ambiguity bug
--   that 20260426160532 fixed once, this migration DROPs the 11-arg
--   overload before creating the 12-arg version. After this migration
--   applies, exactly one append_turn_atomic exists in the database.
--
-- Verification (run after migration applies):
--   SELECT proname, pronargs FROM pg_proc WHERE proname = 'append_turn_atomic';
--     -- Expected: exactly one row with pronargs = 12.
--   SELECT pg_get_function_identity_arguments(oid)
--     FROM pg_proc WHERE proname = 'append_turn_atomic';
--     -- Expected: ends with `, p_pending_actions jsonb`.
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--     WHERE table_schema = 'public'
--       AND table_name = 'v5_conversation_turns'
--       AND column_name = 'pending_actions';
--     -- Expected: jsonb, NO, '[]'::jsonb.
--   SELECT has_function_privilege('service_role',
--     'public.append_turn_atomic(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb)',
--     'EXECUTE');
--     -- Expected: true.
-- ============================================================

-- 1. Add the column. NOT NULL with default '[]'::jsonb means old rows
--    backfill implicitly to the empty array; the app layer never sees null.
ALTER TABLE public.v5_conversation_turns
  ADD COLUMN IF NOT EXISTS pending_actions JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 2. Drop-then-add CHECK for migration idempotency. The constraint
--    enforces only that pending_actions is a JSON array of length <= 3.
--    Per-element object shape is enforced at the application read
--    path (Zod), not the DB.
ALTER TABLE public.v5_conversation_turns
  DROP CONSTRAINT IF EXISTS v5_conversation_turns_pending_actions_shape;
ALTER TABLE public.v5_conversation_turns
  ADD CONSTRAINT v5_conversation_turns_pending_actions_shape
  CHECK (
    jsonb_typeof(pending_actions) = 'array'
    AND jsonb_array_length(pending_actions) <= 3
  );

-- 3. Documentation. Operators reading \d v5_conversation_turns should
--    immediately understand the source of truth and the read path.
COMMENT ON COLUMN public.v5_conversation_turns.pending_actions IS
  'V5 pending actions emitted alongside this turn''s suggested-action chips. '
  'Persisted atomically with the turn INSERT inside append_turn_atomic '
  '(p_pending_actions). Read by the deterministic short-confirm pre-route '
  'on the next turn so a user reply of "yes" / chip click can resume the '
  'offered action without an LLM round-trip. Constraint enforces array + '
  'length <= 3 only; per-element shape validated by the Zod parser at the '
  'read path. Default empty array — old rows read as [], not null.';

-- 4. Drop the 11-arg overload BEFORE creating the 12-arg version to
--    eliminate PostgREST candidate ambiguity (the 20260426160532 bug).
--    The 9- and 10-arg overloads were dropped by 20260426160532 and
--    20260502120000 respectively.
DROP FUNCTION IF EXISTS public.append_turn_atomic(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text
);

-- 5. CREATE OR REPLACE the 12-arg version. Body identical to the
--    20260502120000 11-arg version with TWO surgical changes:
--      a. p_pending_actions JSONB DEFAULT '[]'::jsonb added as the
--         12th parameter (last position keeps named-arg callers
--         working without code changes elsewhere);
--      b. the v5_conversation_turns INSERT now also writes
--         pending_actions, COALESCE'd to '[]'::jsonb so a NULL
--         passthrough still satisfies the NOT NULL column.
--    The FOUND-based idempotency guard remains the load-bearing
--    invariant: on conflict replay, the function returns the existing
--    row id without touching pending_actions. Same-turn retries with
--    different pending_actions do NOT mutate the existing row.
CREATE OR REPLACE FUNCTION public.append_turn_atomic(
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
  p_brief_text       TEXT  DEFAULT NULL,
  p_pending_actions  JSONB DEFAULT '[]'::jsonb
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
    request_hash, response_emitted, llm_calls_used, duration_ms,
    pending_actions
  ) VALUES (
    p_scenario_id, v_user_id, p_turn_id, p_turn_class, p_handler_id,
    p_request_hash, p_response_emitted, p_llm_calls_used, p_duration_ms,
    COALESCE(p_pending_actions, '[]'::jsonb)
  )
  ON CONFLICT (scenario_id, turn_id) DO NOTHING
  RETURNING id INTO v_turn_id;

  IF NOT FOUND THEN
    -- Conflict replay: deduplicated turn, idempotent return.
    -- Do NOT write p_graph, p_brief_text, or pending_actions —
    -- v5_conversation_turns and scenarios must not be mutated on retry.
    -- This is the load-bearing idempotency invariant.
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

-- 6. Re-issue GRANTs explicitly. CREATE OR REPLACE preserves grants only
--    when the signature is unchanged; param-count change creates a new
--    function from PostgreSQL's perspective. Mirrors the precedent set
--    by 20260502120000: REVOKE PUBLIC, GRANT service_role.
REVOKE EXECUTE ON FUNCTION public.append_turn_atomic(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.append_turn_atomic(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb
) TO service_role;
