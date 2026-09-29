-- ============================================================
-- Olumi Scenario Schema v2.0.1 — Hardening follow-up
-- Target: Staging Supabase
-- Date: 26 February 2026
--
-- Three fixes:
--   1. Mojibake in create_shared_brief error messages (em-dashes
--      encoded as Windows-1252 then misinterpreted as UTF-8)
--   2. Idempotent policies (DROP IF EXISTS before CREATE)
--   3. Idempotent trigger (DROP IF EXISTS before CREATE)
--
-- Safe to re-run. All statements are idempotent.
-- ============================================================

-- ============================================================
-- 1. Fix create_shared_brief error messages (mojibake)
--    CREATE OR REPLACE is inherently idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION create_shared_brief(
  p_scenario_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_scenario   scenarios%ROWTYPE;
  v_shared_id  UUID;
  v_slug       TEXT;
BEGIN
  SELECT * INTO v_scenario
  FROM scenarios
  WHERE id = p_scenario_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scenario not found or not owned by user';
  END IF;

  IF v_scenario.brief IS NULL THEN
    RAISE EXCEPTION 'No brief to share - generate a brief first';
  END IF;

  IF v_scenario.analysis_provenance IS NULL THEN
    RAISE EXCEPTION 'No analysis provenance - run analysis first';
  END IF;

  v_slug := encode(gen_random_bytes(16), 'hex');

  INSERT INTO shared_briefs (
    scenario_id, user_id, brief,
    graph_hash, seed_used, response_hash,
    slug
  ) VALUES (
    p_scenario_id,
    auth.uid(),
    v_scenario.brief,
    v_scenario.analysis_provenance->>'graph_hash',
    (v_scenario.analysis_provenance->>'seed_used')::integer,
    v_scenario.analysis_provenance->>'response_hash',
    v_slug
  )
  RETURNING id INTO v_shared_id;

  RETURN jsonb_build_object(
    'id',   v_shared_id,
    'slug', v_slug
  );
END;
$$;

-- ============================================================
-- 2. Make scenarios policies idempotent
--    DROP IF EXISTS then re-CREATE ensures re-runnability.
-- ============================================================

DROP POLICY IF EXISTS "Users can read own scenarios" ON scenarios;
CREATE POLICY "Users can read own scenarios"
  ON scenarios FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own scenarios" ON scenarios;
CREATE POLICY "Users can insert own scenarios"
  ON scenarios FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own scenarios" ON scenarios;
CREATE POLICY "Users can update own scenarios"
  ON scenarios FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own scenarios" ON scenarios;
CREATE POLICY "Users can delete own scenarios"
  ON scenarios FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- 3. Make shared_briefs policy idempotent
-- ============================================================

DROP POLICY IF EXISTS "Users can read own shared briefs" ON shared_briefs;
CREATE POLICY "Users can read own shared briefs"
  ON shared_briefs FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- 4. Make updated_at trigger idempotent
-- ============================================================

DROP TRIGGER IF EXISTS scenarios_updated_at ON scenarios;
CREATE TRIGGER scenarios_updated_at
  BEFORE UPDATE ON scenarios
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
