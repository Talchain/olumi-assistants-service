-- ============================================================
-- V5 Coaching State Spine — Stage 2B-1a: durable coaching-state snapshot
-- (migration-only; NO app wiring in this change).
-- Target: Staging Supabase
-- Date: 2026-06-02
--
-- Why:
--   Stage 2A derives an internal, current-turn coaching_state on
--   EnrichedTurnContext but discards it each turn (never persisted).
--   Stage 2B needs a durable, compact per-turn snapshot so a later turn
--   can read the prior signals (Stage 2B-1b) and, later still, derive
--   cross-turn lifecycle (Stage 2B-2). This migration adds DB support
--   ONLY — a nullable JSONB column on v5_conversation_turns plus a
--   backward-compatible 13th append_turn_atomic parameter. No app code
--   sends p_coaching_state yet; that is Stage 2B-1b, which must NOT
--   deploy until this migration is live and verified.
--
-- Deployment-order safety (the reason Stage 2B-1 is split a/b):
--   Render auto-deploys the app on every staging push; Supabase
--   migrations are applied out-of-band. So this migration MUST be live
--   before any app build that sends a 13th named arg. It is backward
--   compatible in both directions:
--     - Old app (12 named args) -> new DB: the 13th param
--       (p_coaching_state) defaults to NULL, so 12-named-arg calls
--       resolve unambiguously to the single 13-arg function. The 12-arg
--       overload is dropped (step 4) so there is no PostgREST candidate
--       ambiguity.
--     - New app (13 named args) is Stage 2B-1b only and ships AFTER this.
--
-- Backward compatibility:
--   - The new column is NULLABLE with NO default. NULL is meaningful:
--     "no coaching state persisted for this turn" (old rows, system-event
--     turns, and — until 2B-1b — every turn). Do NOT default to '{}'.
--   - The RPC parameter has DEFAULT NULL. Existing 12-arg callers keep
--     working unchanged; they write NULL.
--   - Conflict-replay idempotency (FOUND-based) is preserved verbatim:
--     same-(scenario_id, turn_id) retries do NOT mutate the existing row,
--     including coaching_state.
--
-- DB-layer constraint:
--   CHECK enforces ONLY that the value is NULL or a JSON object
--   (jsonb_typeof = 'object'). Per-element shape is the read path's job
--   (Zod parser, Stage 2B-1b), kept off the DB to avoid coupling to the
--   vendored JSON layout — same discipline as pending_actions.
--
-- Overload housekeeping:
--   Adding a parameter creates a new function from PostgreSQL's
--   perspective. To prevent the PostgREST candidate ambiguity bug
--   (fixed once by 20260426160532), this migration DROPs the 12-arg
--   overload before creating the 13-arg version. After this migration
--   applies, exactly one append_turn_atomic exists in the database.
--
-- Verification (run after migration applies):
--   SELECT proname, pronargs FROM pg_proc WHERE proname = 'append_turn_atomic';
--     -- Expected: exactly one row with pronargs = 13.
--   SELECT pg_get_function_identity_arguments(oid)
--     FROM pg_proc WHERE proname = 'append_turn_atomic';
--     -- Expected: ends with `, p_coaching_state jsonb`.
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--     WHERE table_schema = 'public'
--       AND table_name = 'v5_conversation_turns'
--       AND column_name = 'coaching_state';
--     -- Expected: jsonb, YES, NULL (no default).
--   SELECT has_function_privilege('service_role',
--     'public.append_turn_atomic(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb)',
--     'EXECUTE');
--     -- Expected: true.
--   -- Old-app safety: a 12-named-arg call still resolves (p_coaching_state
--   -- defaults NULL) and writes NULL coaching_state.
--   -- PostgREST schema cache: Supabase auto-reloads its schema cache on DDL,
--   -- so the new 13-arg signature is normally visible immediately. If a
--   -- stale-cache symptom is observed after apply (PostgREST not yet aware
--   -- of the new signature / PGRST202), force a reload:
--   --   NOTIFY pgrst, 'reload schema';
-- ============================================================

-- 1. Add the column. NULLABLE, NO default — NULL means "no coaching
--    state persisted for this turn" (a meaningful state, unlike
--    pending_actions which backfills to '[]').
ALTER TABLE public.v5_conversation_turns
  ADD COLUMN IF NOT EXISTS coaching_state JSONB;

-- 2. Drop-then-add CHECK for migration idempotency. Enforces only that
--    the value is NULL or a JSON object; per-element shape is validated
--    at the application read path (Stage 2B-1b), not the DB.
ALTER TABLE public.v5_conversation_turns
  DROP CONSTRAINT IF EXISTS v5_conversation_turns_coaching_state_shape;
ALTER TABLE public.v5_conversation_turns
  ADD CONSTRAINT v5_conversation_turns_coaching_state_shape
  CHECK (
    coaching_state IS NULL
    OR jsonb_typeof(coaching_state) = 'object'
  );

-- 3. Documentation. Operators reading \d v5_conversation_turns should
--    immediately understand the source of truth and the read path.
COMMENT ON COLUMN public.v5_conversation_turns.coaching_state IS
  'V5 Coaching State Spine (Stage 2B): compact, content-free snapshot of '
  'the internal coaching_state derived at turn start (pre-dispatch). '
  'Persisted atomically with the turn INSERT inside append_turn_atomic '
  '(p_coaching_state); written by the app only from Stage 2B-1b onward. '
  'NULL means no coaching state was persisted for this turn (old rows, '
  'system-event turns, or pre-2B-1b turns). Constraint enforces NULL-or-'
  'object only; per-element shape validated by the Zod read path. Carries '
  'closed-enum signal kinds / reason_codes / statuses + SHA-prefix hashes '
  'only — no raw user content.';

-- 4. Drop the 12-arg overload BEFORE creating the 13-arg version to
--    eliminate PostgREST candidate ambiguity (the 20260426160532 bug).
--    The 9-, 10-, and 11-arg overloads were dropped by 20260426160532,
--    20260502120000, and 20260505120000 respectively.
DROP FUNCTION IF EXISTS public.append_turn_atomic(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb
);

-- 5. CREATE OR REPLACE the 13-arg version. Body identical to the
--    20260505120000 12-arg version with TWO surgical changes:
--      a. p_coaching_state JSONB DEFAULT NULL added as the 13th (final)
--         parameter — last position keeps 12-named-arg callers working
--         without code changes;
--      b. the v5_conversation_turns INSERT now also writes coaching_state
--         (passed through verbatim — NOT COALESCE'd, because the column
--         is nullable and NULL is meaningful).
--    The FOUND-based idempotency guard remains the load-bearing
--    invariant: on conflict replay the function returns the existing row
--    id without touching coaching_state (or any other column).
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
  p_pending_actions  JSONB DEFAULT '[]'::jsonb,
  p_coaching_state   JSONB DEFAULT NULL
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
    pending_actions, coaching_state
  ) VALUES (
    p_scenario_id, v_user_id, p_turn_id, p_turn_class, p_handler_id,
    p_request_hash, p_response_emitted, p_llm_calls_used, p_duration_ms,
    COALESCE(p_pending_actions, '[]'::jsonb), p_coaching_state
  )
  ON CONFLICT (scenario_id, turn_id) DO NOTHING
  RETURNING id INTO v_turn_id;

  IF NOT FOUND THEN
    -- Conflict replay: deduplicated turn, idempotent return.
    -- Do NOT write p_graph, p_brief_text, p_pending_actions, or
    -- p_coaching_state — v5_conversation_turns and scenarios must not be
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

-- 6. Re-issue GRANTs explicitly on the new 13-arg signature. CREATE OR
--    REPLACE preserves grants only when the signature is unchanged; a
--    param-count change creates a new function from PostgreSQL's
--    perspective. Mirrors 20260505120000: REVOKE PUBLIC, GRANT service_role.
REVOKE EXECUTE ON FUNCTION public.append_turn_atomic(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.append_turn_atomic(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb
) TO service_role;
