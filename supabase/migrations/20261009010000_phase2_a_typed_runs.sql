-- PROPOSAL, NOT EXECUTED — Shared Data Phase 2(a): TS-derived analysis Runs.
-- Production and staging share this DB. The writer only attempts an enqueue;
-- the ONE mapper is CEE runs/typed-run-rows.ts, after the append has committed.
-- RunAnalysisResultSchema / RunInputSnapshotSchema have NO evaluated revision.
-- Every Run is NULL + revision_source=legacy_unknown until commit B stamps it
-- on the Run fact. NEVER infer it from scenarios.revision or derivation time.
-- No SQL mapper, SQL backfill, or independent latest-Run view/order exists.
-- Claims lease work for 30 seconds; expired leases and skipped enqueues recover
-- through the bounded queued-ids UNION anti-join sweep. No process holds a
-- transaction across TS mapping. Each storage RPC is a separate transaction.
-- Mapper skips (currently refusal markers) use compact terminal reasons (no payload),
-- counted as skipped by CEE, so an oldest non-Run cannot starve the sweep.
-- RLS on all four tables; service_role only. Apply wrapped in a transaction.
SET LOCAL lock_timeout = '3s';

CREATE TABLE public.analysis_runs (
  run_id TEXT PRIMARY KEY,
  scenario_id UUID NOT NULL REFERENCES public.scenarios(id) ON DELETE CASCADE,
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
  fact_id UUID NOT NULL UNIQUE REFERENCES public.v5_handler_facts(id) ON DELETE CASCADE,
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
  fact_id UUID NOT NULL UNIQUE REFERENCES public.v5_handler_facts(id) ON DELETE CASCADE,
  scenario_id UUID,
  reason TEXT NOT NULL,
  detail TEXT,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.analysis_run_queue (
  fact_id UUID PRIMARY KEY REFERENCES public.v5_handler_facts(id) ON DELETE CASCADE,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_until TIMESTAMPTZ NOT NULL DEFAULT '-infinity'
);
ALTER TABLE public.analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_run_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_run_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_run_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.analysis_runs, public.analysis_run_options,
  public.analysis_run_quarantine, public.analysis_run_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.analysis_runs, public.analysis_run_options,
  public.analysis_run_quarantine, public.analysis_run_queue TO service_role;

CREATE FUNCTION public.v5_handler_facts_enqueue_run()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '50ms'
AS $$
BEGIN
  IF NEW.action_type = 'run_analysis' AND NOT NEW.noop THEN
    BEGIN
      INSERT INTO public.analysis_run_queue(fact_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    EXCEPTION WHEN lock_not_available THEN
      RAISE LOG 'analysis_run enqueue skipped: fact_id=% SQLSTATE=55P03', NEW.id;
    END;
  END IF;
  -- No typed-table reads/writes. Only lock_not_available is contained. Disk,
  -- permission, FK, deadlock, cancellation and other DB failures can still
  -- reject the writer; 50ms bounds LOCK waiting, not CPU/I/O or statement time.
  -- A skipped enqueue is recoverable from the facts anti-join, not data loss.
  RETURN NULL;
END;
$$;
CREATE TRIGGER v5_handler_facts_enqueue_run AFTER INSERT ON public.v5_handler_facts
FOR EACH ROW EXECUTE FUNCTION public.v5_handler_facts_enqueue_run();

CREATE FUNCTION public.claim_analysis_run_facts(p_fact_ids UUID[] DEFAULT '{}', p_sweep_limit INTEGER DEFAULT 20)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '50ms'
SET statement_timeout = '5s'
AS $$
DECLARE
  f public.v5_handler_facts;
  batch JSONB := '[]';
  depth BIGINT;
  oldest_age DOUBLE PRECISION;
BEGIN
  IF p_sweep_limit IS NULL OR p_sweep_limit < 1 OR p_sweep_limit > 20 THEN
    RAISE EXCEPTION 'sweep limit must be in [1,20]' USING ERRCODE = '22023';
  END IF;
  FOR f IN
    WITH pending AS (
      SELECT q.fact_id FROM public.analysis_run_queue q WHERE q.claimed_until <= now()
      UNION
      SELECT h.id FROM public.v5_handler_facts h
      WHERE h.action_type = 'run_analysis' AND NOT h.noop
        AND NOT EXISTS (SELECT 1 FROM public.analysis_runs r WHERE r.fact_id = h.id)
        AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine x WHERE x.fact_id = h.id)
        AND NOT EXISTS (SELECT 1 FROM public.analysis_run_queue q WHERE q.fact_id = h.id AND q.claimed_until > now())
    )
    SELECT h.* FROM public.v5_handler_facts h JOIN pending p ON p.fact_id = h.id
    -- Queued terminal IDs are also claimed: idempotent finishers remove a
    -- stale enqueue racing with completion (e.g. an operator backfill).
    WHERE h.action_type = 'run_analysis' AND NOT h.noop
    ORDER BY CASE WHEN h.id = ANY(COALESCE(p_fact_ids, '{}')) THEN 0 ELSE 1 END, h.created_at, h.id
    LIMIT p_sweep_limit
    FOR UPDATE OF h SKIP LOCKED
  LOOP
    INSERT INTO public.analysis_run_queue(fact_id, enqueued_at, claimed_until)
      VALUES (f.id, f.created_at, now() + interval '30 seconds')
    ON CONFLICT (fact_id) DO UPDATE SET claimed_until = EXCLUDED.claimed_until
      WHERE analysis_run_queue.claimed_until <= now();
    IF FOUND THEN
      batch := batch || jsonb_build_array(jsonb_build_object(
        'fact_id', f.id, 'scenario_id', f.scenario_id, 'payload', f.payload, 'noop', f.noop));
    END IF;
  END LOOP;
  SELECT count(*) INTO depth FROM public.analysis_run_queue;
  SELECT EXTRACT(epoch FROM now() - min(h.created_at)) INTO oldest_age
    FROM public.v5_handler_facts h WHERE h.action_type = 'run_analysis' AND NOT h.noop
      AND NOT EXISTS (SELECT 1 FROM public.analysis_runs r WHERE r.fact_id = h.id)
      AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine x WHERE x.fact_id = h.id);
  RETURN jsonb_build_object('facts', batch, 'queue_depth', depth, 'oldest_pending_age_seconds', oldest_age);
END;
$$;

CREATE FUNCTION public.store_typed_analysis_run(p_fact_id UUID, p_run JSONB, p_options JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '50ms'
AS $$
DECLARE f public.v5_handler_facts;
BEGIN
  SELECT * INTO STRICT f FROM public.v5_handler_facts WHERE id = p_fact_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.analysis_runs WHERE fact_id = p_fact_id)
     OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine WHERE fact_id = p_fact_id) THEN
    DELETE FROM public.analysis_run_queue WHERE fact_id = p_fact_id;
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
  DELETE FROM public.analysis_run_queue WHERE fact_id = p_fact_id;
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
  SELECT * INTO STRICT f FROM public.v5_handler_facts WHERE id = p_fact_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.analysis_runs WHERE fact_id = p_fact_id)
     OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine WHERE fact_id = p_fact_id) THEN
    DELETE FROM public.analysis_run_queue WHERE fact_id = p_fact_id;
    RETURN FALSE;
  END IF;
  -- Compact reason/detail only, NEVER the payload or snapshot.
  INSERT INTO public.analysis_run_quarantine(fact_id, scenario_id, reason, detail)
    VALUES (f.id, f.scenario_id, p_reason, p_detail);
  DELETE FROM public.analysis_run_queue WHERE fact_id = p_fact_id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.v5_handler_facts_enqueue_run(),
  public.claim_analysis_run_facts(uuid[], integer), public.store_typed_analysis_run(uuid, jsonb, jsonb),
  public.quarantine_analysis_fact(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v5_handler_facts_enqueue_run(),
  public.claim_analysis_run_facts(uuid[], integer), public.store_typed_analysis_run(uuid, jsonb, jsonb),
  public.quarantine_analysis_fact(uuid, text, text) TO service_role;
