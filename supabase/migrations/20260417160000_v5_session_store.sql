-- ============================================================
-- V5 session store — v5_conversation_turns + v5_handler_facts
-- Target: Staging Supabase
-- Date: 2026-04-17
--
-- v5_ prefix decision: 2026-04-17 introspection found an unrelated,
-- incompatible public.conversation_turns sketch (4/11 columns, 0 rows,
-- unknown provenance). Option 2 (rename) chosen over option 3 (drop) so
-- the pre-existing table stays untouched. See audit §2.7.
--
-- Depends on:
--   - scenarios table (from earlier remote migration not checked in)
--   - gen_random_uuid() from pgcrypto extension
--   - auth.uid() from Supabase GoTrue schema
--
-- Additive-only. Zero destructive DDL. Safe to re-run (idempotent).
-- See `Docs/v5/slice-phase-0-supabase-audit.md` §4 for the audit-approved
-- design rationale.
-- ============================================================

-- ------------------------------------------------------------
-- 1. v5_conversation_turns — one row per successful turn
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS v5_conversation_turns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id      UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL,
  turn_id          TEXT NOT NULL,
  turn_class       TEXT NOT NULL,
  handler_id       TEXT NULL,
  request_hash     TEXT NOT NULL,
  response_emitted BOOLEAN NOT NULL DEFAULT TRUE,
  llm_calls_used   INTEGER NOT NULL DEFAULT 0,
  duration_ms      INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT v5_conversation_turns_scenario_turn_unique UNIQUE (scenario_id, turn_id)
);

CREATE INDEX IF NOT EXISTS v5_conversation_turns_scenario_created_idx
  ON v5_conversation_turns (scenario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS v5_conversation_turns_user_created_idx
  ON v5_conversation_turns (user_id, created_at DESC);

COMMENT ON COLUMN v5_conversation_turns.user_id IS
  'Denormalised from scenarios.user_id for RLS without join. Drift is API-unreachable; no CHECK constraint by design.';

-- ------------------------------------------------------------
-- 2. v5_handler_facts — one row per HandlerFact
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS v5_handler_facts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  v5_conversation_turn_id UUID NOT NULL REFERENCES v5_conversation_turns(id) ON DELETE CASCADE,
  scenario_id             UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL,
  handler_id              TEXT NOT NULL,
  action_type             TEXT NOT NULL,
  fact_version            INTEGER NOT NULL DEFAULT 1,
  noop                    BOOLEAN NOT NULL DEFAULT FALSE,
  payload                 JSONB NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS v5_handler_facts_turn_idx
  ON v5_handler_facts (v5_conversation_turn_id);
CREATE INDEX IF NOT EXISTS v5_handler_facts_scenario_handler_idx
  ON v5_handler_facts (scenario_id, handler_id, created_at DESC);

COMMENT ON COLUMN v5_handler_facts.user_id IS
  'Denormalised from scenarios.user_id for RLS without join. Drift is API-unreachable; no CHECK constraint by design.';

-- ------------------------------------------------------------
-- 3. Row Level Security — authenticated reads own rows; writes
--    only via the service-role path or the atomic RPC below.
-- ------------------------------------------------------------

ALTER TABLE v5_conversation_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE v5_handler_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own v5 conversation turns" ON v5_conversation_turns;
CREATE POLICY "Users can read own v5 conversation turns"
  ON v5_conversation_turns FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own v5 handler facts" ON v5_handler_facts;
CREATE POLICY "Users can read own v5 handler facts"
  ON v5_handler_facts FOR SELECT
  USING (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 4. append_turn_atomic RPC — single-transaction append.
--    user_id is derived from scenarios.user_id, NOT caller-supplied,
--    to defend against SECURITY DEFINER user-impersonation.
--    Execute is granted explicitly to service_role only — no
--    reliance on role inheritance.
-- ------------------------------------------------------------

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
  IF v_user_id IS NULL THEN
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
GRANT EXECUTE ON FUNCTION append_turn_atomic(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB) TO service_role;

-- ------------------------------------------------------------
-- 5. Cross-field CHECK constraints.
--    Split from the CREATE TABLE so future additions (new turn
--    classes in E-series, additional biconditionals) can amend
--    individual constraints without touching the table definition.
-- ------------------------------------------------------------

ALTER TABLE v5_conversation_turns
  DROP CONSTRAINT IF EXISTS v5_conversation_turns_turn_class_valid;
ALTER TABLE v5_conversation_turns
  ADD CONSTRAINT v5_conversation_turns_turn_class_valid
  CHECK (turn_class IN ('direct_answer', 'clarify', 'handler', 'unhandled'));

ALTER TABLE v5_conversation_turns
  DROP CONSTRAINT IF EXISTS v5_conversation_turns_handler_id_biconditional;
ALTER TABLE v5_conversation_turns
  ADD CONSTRAINT v5_conversation_turns_handler_id_biconditional
  CHECK ((turn_class = 'handler') = (handler_id IS NOT NULL));
