-- PROPOSAL (Paul-gated): scenarios.brief is the decision brief PRODUCED by analysis (store_brief_and_provenance /
-- store_brief_and_log after a Run), an output like analysis*, not an input a turn reasons over. Bumping on it made
-- every Run move the revision, causing spurious OLRV1 409s for edits read before the Run and "stale" right after
-- every Run. brief_text (the user's brief) still bumps. Replaces ONLY our own trigger function (no other caller).
SET LOCAL lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.scenarios_bump_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.graph IS DISTINCT FROM OLD.graph OR NEW.brief_text IS DISTINCT FROM OLD.brief_text
     OR NEW.framing IS DISTINCT FROM OLD.framing OR NEW.stage IS DISTINCT FROM OLD.stage
     OR NEW.current_model_version_id IS DISTINCT FROM OLD.current_model_version_id THEN
    NEW.revision := OLD.revision + 1;
  ELSE
    NEW.revision := OLD.revision;   -- pins revision: no writer can set it directly
  END IF;
  RETURN NEW;
END;
$$;
