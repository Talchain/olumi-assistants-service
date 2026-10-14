-- S1 slice C: pre-run-identity facts are terminal legacy work, not malformed Runs.
-- Apply before the CEE mapper/port change. No payload or snapshot is copied.
SET lock_timeout = '3s';
BEGIN;

CREATE TABLE public.analysis_run_unattributable (
  -- Logical reference, as in #2893: no FK or trigger on the shared writer.
  fact_id UUID PRIMARY KEY,
  reason TEXT NOT NULL CHECK (reason IN ('run_id_absent')),
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.analysis_run_unattributable ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.analysis_run_unattributable FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.analysis_run_unattributable TO service_role;

CREATE FUNCTION public.mark_analysis_fact_unattributable(p_fact_id UUID, p_reason TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '50ms'
AS $$
DECLARE f_id UUID;
BEGIN
  -- Same per-fact attempt lock/terminal protocol as quarantine_analysis_fact.
  INSERT INTO public.analysis_run_attempts(fact_id) VALUES (p_fact_id) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.analysis_run_attempts WHERE fact_id = p_fact_id FOR UPDATE;
  SELECT id INTO STRICT f_id FROM public.v5_handler_facts WHERE id = p_fact_id;
  IF EXISTS (SELECT 1 FROM public.analysis_runs WHERE fact_id = p_fact_id)
     OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine WHERE fact_id = p_fact_id)
     OR EXISTS (SELECT 1 FROM public.analysis_run_unattributable WHERE fact_id = p_fact_id) THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.analysis_run_unattributable(fact_id, reason) VALUES (f_id, p_reason);
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_analysis_fact_unattributable(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_analysis_fact_unattributable(uuid,text) TO service_role;

-- #2893 bodies copied verbatim except the unattributable anti-join.
CREATE OR REPLACE FUNCTION public.claim_analysis_run_facts(p_sweep_limit INTEGER DEFAULT 20)
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
      AND NOT EXISTS (SELECT 1 FROM public.analysis_run_unattributable u WHERE u.fact_id = h.id)
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

CREATE OR REPLACE FUNCTION public.claim_analysis_run_reconciliation(p_sweep_limit INTEGER DEFAULT 20)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '50ms'
AS $$
DECLARE
  s public.analysis_run_sweep_state;
  batch JSONB;
  oldest_at TIMESTAMPTZ;
  token UUID := gen_random_uuid();
BEGIN
  IF p_sweep_limit IS NULL OR p_sweep_limit < 1 OR p_sweep_limit > 20 THEN
    RAISE EXCEPTION 'sweep limit must be in [1,20]' USING ERRCODE = '22023';
  END IF;
  -- Share the normal sweep's lease, including across processes. No source locks.
  SELECT * INTO s FROM public.analysis_run_sweep_state WHERE singleton FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR s.lease_until > clock_timestamp() THEN
    RETURN jsonb_build_object('facts','[]'::jsonb,'depth_estimate',NULL,'oldest_pending_age_seconds',NULL,'window_count',0);
  END IF;
  WITH pending AS MATERIALIZED (
    SELECT h.* FROM public.v5_handler_facts h
    WHERE h.action_type = 'run_analysis' AND NOT h.noop
      AND NOT EXISTS (SELECT 1 FROM public.analysis_runs r WHERE r.fact_id = h.id)
      AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = h.id)
      AND NOT EXISTS (SELECT 1 FROM public.analysis_run_unattributable u WHERE u.fact_id = h.id)
    ORDER BY h.created_at, h.id LIMIT p_sweep_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('fact_id',h.id,'scenario_id',h.scenario_id,
    'payload',h.payload,'noop',h.noop) ORDER BY h.created_at,h.id),'[]'::jsonb), min(h.created_at)
    INTO batch, oldest_at FROM pending h;
  -- NULL boundary marks release-only completion: reconciliation cannot advance
  -- the range cursor. The result cap does not bound older terminal index entries.
  UPDATE public.analysis_run_sweep_state SET lease_id = token, lease_until = clock_timestamp()+interval '30 seconds',
    window_last_at = NULL, window_last_id = NULL WHERE singleton;
  RETURN jsonb_build_object('facts',batch,'lease_id',token,'window_count',jsonb_array_length(batch),
    'depth_estimate',jsonb_array_length(batch),
    'oldest_pending_age_seconds',EXTRACT(epoch FROM clock_timestamp()-oldest_at));
END;
$$;

-- The bounded finisher recognises the same terminal classes as both claims.
CREATE OR REPLACE FUNCTION public.finish_analysis_run_sweep(p_lease_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '50ms'
AS $$
DECLARE s public.analysis_run_sweep_state; last_at TIMESTAMPTZ; last_id UUID;
BEGIN
  SELECT * INTO s FROM public.analysis_run_sweep_state WHERE singleton FOR UPDATE;
  IF s.lease_id IS DISTINCT FROM p_lease_id THEN RETURN FALSE; END IF;
  -- Reconciliation has no range boundary (as does an empty normal window).
  -- Release only: neither watermark column is updated by this branch.
  IF s.window_last_at IS NULL THEN
    UPDATE public.analysis_run_sweep_state SET lease_id = NULL, lease_until = '-infinity',
      window_last_id = NULL WHERE singleton;
    RETURN TRUE;
  END IF;
  WITH fact_window AS MATERIALIZED (
    SELECT h.id,h.created_at,
      EXISTS (SELECT 1 FROM public.analysis_runs r WHERE r.fact_id = h.id)
      OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = h.id)
      OR EXISTS (SELECT 1 FROM public.analysis_run_unattributable u WHERE u.fact_id = h.id) AS terminal
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

-- One-time, idempotent move of the already-quarantined legacy rows (DL ruling:
-- stays in the migration). Reads only analysis_run_quarantine, never the source
-- table. Preserve the first observation time.
INSERT INTO public.analysis_run_unattributable(fact_id, reason, seen_at)
  SELECT fact_id, reason, seen_at FROM public.analysis_run_quarantine WHERE reason = 'run_id_absent'
  ON CONFLICT (fact_id) DO NOTHING;
DELETE FROM public.analysis_run_quarantine q
  WHERE q.reason = 'run_id_absent'
    AND EXISTS (SELECT 1 FROM public.analysis_run_unattributable u WHERE u.fact_id = q.fact_id);

-- Unquarantined legacy facts are a separate bounded operator job, AFTER this
-- commits: scripts/phase2/classify-legacy-unattributable.ts. No source table is
-- read or locked while this migration applies. Cascade: not applicable (logical ID).

COMMIT;
RESET lock_timeout;
