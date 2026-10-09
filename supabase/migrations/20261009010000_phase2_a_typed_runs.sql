-- PROPOSAL, NOT EXECUTED. Apply inside an explicit BEGIN/COMMIT transaction.
-- no trigger, no write-blocking DDL; one concurrent index allowed (DL 87114 amendment).
-- Only added objects; no existing-table ALTER, FK or automatic writer-side work.
-- Apply 20261009010100_phase2_a_sweep_index.sql separately OUTSIDE a transaction
-- and verify indisvalid=true before enabling CEE's indexed sweeps.
-- The ONE mapper is CEE typed-run-rows.ts. SQL only claims/stores mapped values.
-- Every Run is NULL + legacy_unknown until commit B stamps evaluated revision.
-- No evaluated revision exists in RunAnalysisResultSchema/RunInputSnapshotSchema;
-- NEVER substitute scenarios.revision. Source UUIDs are logical references:
-- no FK to an existing table (FKs would install triggers on the shared writer).
-- Durable (created_at,id) watermark preserves ties; advance ONLY a fully-terminal
-- prefix. Each range window reads <=20 facts, not the complete historical anti-join.
-- An open/prepared-transaction horizon protects late commits with DEFAULT now()
-- timestamps. Explicitly backdated/imported created_at is outside that contract;
-- operator backfill starts at -infinity, and must precede autonomous advancement.
-- A durable 30s sweep lease recovers crashes; source tables are never row-locked.
SET LOCAL lock_timeout = '3s';

CREATE TABLE public.analysis_runs (
  run_id TEXT PRIMARY KEY,
  scenario_id UUID NOT NULL,
  user_id UUID,
  scenario_revision BIGINT NULL,
  revision_source TEXT NOT NULL CHECK (revision_source IN ('recorded', 'legacy_unknown')),
  canonical_request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'withheld')),
  computed_at TIMESTAMPTZ NOT NULL,
  -- Preserve the producer ISO text: freshness orders it lexically, not by DB-normalised time.
  recorded_computed_at TEXT NOT NULL,
  leading_option_id TEXT NULL,
  constraint_may_name_leading_option BOOLEAN NULL,
  graph_identity_hash TEXT,
  input_snapshot JSONB NOT NULL,
  fact_id UUID NOT NULL UNIQUE,
  fact_created_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((revision_source = 'recorded' AND scenario_revision IS NOT NULL AND scenario_revision >= 0)
      OR (revision_source = 'legacy_unknown' AND scenario_revision IS NULL))
);
CREATE INDEX analysis_runs_scenario_idx ON public.analysis_runs (scenario_id);

CREATE TABLE public.analysis_run_options (
  run_id TEXT NOT NULL REFERENCES public.analysis_runs(run_id) ON DELETE CASCADE,
  option_id TEXT NOT NULL,
  chance NUMERIC NULL CHECK (chance >= 0 AND chance <= 1),
  low NUMERIC NULL,
  high NUMERIC NULL,
  licence_status TEXT NOT NULL CHECK (licence_status IN ('permitted', 'permitted_with_caveat', 'withheld')),
  withheld_reason TEXT NULL,
  driver JSONB NULL,
  PRIMARY KEY (run_id, option_id),
  CHECK (licence_status <> 'withheld' OR (chance IS NULL AND NULLIF(btrim(withheld_reason), '') IS NOT NULL))
);
CREATE TABLE public.analysis_run_quarantine (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id UUID NOT NULL UNIQUE,
  scenario_id UUID,
  reason TEXT NOT NULL,
  detail TEXT,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.analysis_run_attempts (
  fact_id UUID PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count BETWEEN 0 AND 5),
  last_error TEXT
);
CREATE TABLE public.analysis_run_sweep_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
  processed_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  lease_id UUID,
  lease_until TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
  window_last_at TIMESTAMPTZ,
  window_last_id UUID
);
INSERT INTO public.analysis_run_sweep_state(singleton) VALUES (TRUE);
ALTER TABLE public.analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_run_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_run_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_run_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_run_sweep_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.analysis_runs, public.analysis_run_options,
  public.analysis_run_quarantine, public.analysis_run_attempts, public.analysis_run_sweep_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.analysis_runs, public.analysis_run_options,
  public.analysis_run_quarantine, public.analysis_run_attempts, public.analysis_run_sweep_state TO service_role;

CREATE FUNCTION public.claim_analysis_run_facts(p_sweep_limit INTEGER DEFAULT 20)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '50ms'
AS $$
DECLARE
  s public.analysis_run_sweep_state;
  batch JSONB;
  last_at TIMESTAMPTZ;
  last_id UUID;
  cutoff TIMESTAMPTZ;
  window_count INTEGER;
  token UUID := gen_random_uuid();
BEGIN
  IF p_sweep_limit IS NULL OR p_sweep_limit < 1 OR p_sweep_limit > 20 THEN
    RAISE EXCEPTION 'sweep limit must be in [1,20]' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.analysis_run_sweep_state WHERE singleton FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR s.lease_until > clock_timestamp() THEN
    RETURN jsonb_build_object('facts','[]'::jsonb,'depth_estimate',NULL,'oldest_pending_age_seconds',NULL,'window_count',0);
  END IF;
  -- DEFAULT now() reflects transaction start, not commit. Never cross a still
  -- open writer, including prepared transactions; no lock on the writer is taken.
  SELECT LEAST(statement_timestamp(),
    COALESCE((SELECT min(xact_start) FROM pg_stat_activity WHERE datname = current_database()
      AND pid <> pg_backend_pid() AND xact_start IS NOT NULL), statement_timestamp()),
    CASE WHEN EXISTS (SELECT 1 FROM pg_prepared_xacts WHERE database = current_database())
      THEN '-infinity'::timestamptz ELSE statement_timestamp() END) INTO cutoff;
  WITH fact_window AS MATERIALIZED (
    SELECT h.* FROM public.v5_handler_facts h
    WHERE h.action_type = 'run_analysis' AND NOT h.noop
      AND (h.created_at, h.id) > (s.processed_at, s.processed_id)
      AND h.created_at < cutoff
    ORDER BY h.created_at, h.id LIMIT p_sweep_limit
  ), pending AS (
    SELECT h.* FROM fact_window h
    WHERE NOT EXISTS (SELECT 1 FROM public.analysis_runs r WHERE r.fact_id = h.id)
      AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = h.id)
  )
  SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('fact_id',h.id,'scenario_id',h.scenario_id,
      'payload',h.payload,'noop',h.noop) ORDER BY h.created_at,h.id) FROM pending h), '[]'),
    (SELECT h.created_at FROM fact_window h ORDER BY h.created_at DESC,h.id DESC LIMIT 1),
    (SELECT h.id FROM fact_window h ORDER BY h.created_at DESC,h.id DESC LIMIT 1),
    (SELECT count(*) FROM fact_window)
    INTO batch, last_at, last_id, window_count;
  UPDATE public.analysis_run_sweep_state SET lease_id = token, lease_until = clock_timestamp()+interval '30 seconds',
    window_last_at = last_at, window_last_id = last_id WHERE singleton;
  RETURN jsonb_build_object('facts', batch, 'lease_id', token, 'window_count', window_count,
    -- Lower-bound depth in this <=20-row window; never an unbounded COUNT(*).
    'depth_estimate', jsonb_array_length(batch),
    'oldest_pending_age_seconds', CASE WHEN jsonb_array_length(batch) > 0 THEN
      (SELECT EXTRACT(epoch FROM clock_timestamp()-h.created_at) FROM public.v5_handler_facts h
        WHERE h.id = (batch->0->>'fact_id')::uuid) ELSE NULL END);
END;
$$;

CREATE FUNCTION public.finish_analysis_run_sweep(p_lease_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '50ms'
AS $$
DECLARE s public.analysis_run_sweep_state; last_at TIMESTAMPTZ; last_id UUID;
BEGIN
  SELECT * INTO s FROM public.analysis_run_sweep_state WHERE singleton FOR UPDATE;
  IF s.lease_id IS DISTINCT FROM p_lease_id THEN RETURN FALSE; END IF;
  WITH fact_window AS MATERIALIZED (
    SELECT h.id,h.created_at,
      EXISTS (SELECT 1 FROM public.analysis_runs r WHERE r.fact_id = h.id)
      OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = h.id) AS terminal
    FROM public.v5_handler_facts h WHERE h.action_type = 'run_analysis' AND NOT h.noop
      AND (h.created_at,h.id) > (s.processed_at,s.processed_id)
      AND (h.created_at,h.id) <= (s.window_last_at,s.window_last_id)
    ORDER BY h.created_at,h.id LIMIT 20
  ), first_pending AS (
    SELECT * FROM fact_window WHERE NOT terminal ORDER BY created_at,id LIMIT 1
  )
  SELECT h.created_at,h.id INTO last_at,last_id FROM fact_window h
    WHERE h.terminal AND NOT EXISTS (SELECT 1 FROM first_pending p WHERE (p.created_at,p.id) <= (h.created_at,h.id))
    ORDER BY h.created_at DESC,h.id DESC LIMIT 1;
  UPDATE public.analysis_run_sweep_state SET processed_at = COALESCE(last_at,processed_at),
    processed_id = COALESCE(last_id,processed_id), lease_id = NULL, lease_until = '-infinity',
    window_last_at = NULL, window_last_id = NULL WHERE singleton;
  RETURN TRUE;
END;
$$;

CREATE FUNCTION public.store_typed_analysis_run(p_fact_id UUID, p_run JSONB, p_options JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '50ms'
AS $$
DECLARE f public.v5_handler_facts;
BEGIN
  INSERT INTO public.analysis_run_attempts(fact_id) VALUES (p_fact_id) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.analysis_run_attempts WHERE fact_id = p_fact_id FOR UPDATE;
  SELECT * INTO STRICT f FROM public.v5_handler_facts WHERE id = p_fact_id;
  IF EXISTS (SELECT 1 FROM public.analysis_runs WHERE fact_id = p_fact_id)
     OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine WHERE fact_id = p_fact_id) THEN
    RETURN FALSE;
  END IF;
  -- Storage of TS-mapped values only. No re-derivation or scenarios.revision read.
  -- producer verdict at Run time; compose applies further remove-only gates; NOT the final permission
  INSERT INTO public.analysis_runs(run_id, scenario_id, user_id, scenario_revision, revision_source,
    canonical_request_hash, status, computed_at, recorded_computed_at, leading_option_id, constraint_may_name_leading_option,
    graph_identity_hash, input_snapshot, fact_id, fact_created_at)
  VALUES (p_run->>'run_id', f.scenario_id, f.user_id, (p_run->>'scenario_revision')::bigint,
    p_run->>'revision_source', p_run->>'canonical_request_hash', p_run->>'status',
    (p_run->>'computed_at')::timestamptz, p_run->>'computed_at', p_run->>'leading_option_id',
    (p_run->>'constraint_may_name_leading_option')::boolean, p_run->>'graph_identity_hash',
    p_run->'input_snapshot', f.id, f.created_at);
  INSERT INTO public.analysis_run_options(run_id, option_id, chance, low, high, licence_status, withheld_reason, driver)
  SELECT p_run->>'run_id', o.option_id, o.chance, o.low, o.high, o.licence_status, o.withheld_reason, o.driver
  FROM jsonb_to_recordset(p_options) AS o(option_id text, chance numeric, low numeric, high numeric,
    licence_status text, withheld_reason text, driver jsonb);
  RETURN TRUE;
END;
$$;

CREATE FUNCTION public.quarantine_analysis_fact(p_fact_id UUID, p_reason TEXT, p_detail TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '50ms'
AS $$
DECLARE f public.v5_handler_facts;
BEGIN
  INSERT INTO public.analysis_run_attempts(fact_id) VALUES (p_fact_id) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.analysis_run_attempts WHERE fact_id = p_fact_id FOR UPDATE;
  SELECT * INTO STRICT f FROM public.v5_handler_facts WHERE id = p_fact_id;
  IF EXISTS (SELECT 1 FROM public.analysis_runs WHERE fact_id = p_fact_id)
     OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine WHERE fact_id = p_fact_id) THEN
    RETURN FALSE;
  END IF;
  -- Compact reason/detail only, NEVER the payload or snapshot.
  INSERT INTO public.analysis_run_quarantine(fact_id, scenario_id, reason, detail)
    VALUES (f.id, f.scenario_id, p_reason, p_detail);
  RETURN TRUE;
END;
$$;
CREATE FUNCTION public.record_analysis_run_failure(p_fact_id UUID, p_error_code TEXT, p_detail TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '50ms'
AS $$
DECLARE n INTEGER; message TEXT; scenario UUID;
BEGIN
  IF p_error_code = '23505' THEN RETURN FALSE; END IF;
  INSERT INTO public.analysis_run_attempts(fact_id) VALUES (p_fact_id) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.analysis_run_attempts WHERE fact_id = p_fact_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.analysis_runs WHERE fact_id = p_fact_id)
     OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine WHERE fact_id = p_fact_id) THEN RETURN FALSE; END IF;
  message := left(COALESCE(p_error_code,'unknown') || ': ' || COALESCE(p_detail,''),1000);
  UPDATE public.analysis_run_attempts SET failure_count = LEAST(failure_count+1,5), last_error = message
    WHERE fact_id = p_fact_id RETURNING failure_count INTO n;
  IF n >= 5 THEN
    SELECT scenario_id INTO STRICT scenario FROM public.v5_handler_facts WHERE id = p_fact_id;
    INSERT INTO public.analysis_run_quarantine(fact_id,scenario_id,reason,detail)
      VALUES(p_fact_id,scenario,'derivation_failed',message);
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_analysis_run_facts(integer), public.finish_analysis_run_sweep(uuid),
  public.store_typed_analysis_run(uuid,jsonb,jsonb), public.quarantine_analysis_fact(uuid,text,text),
  public.record_analysis_run_failure(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_analysis_run_facts(integer), public.finish_analysis_run_sweep(uuid),
  public.store_typed_analysis_run(uuid,jsonb,jsonb), public.quarantine_analysis_fact(uuid,text,text),
  public.record_analysis_run_failure(uuid,text,text) TO service_role;
