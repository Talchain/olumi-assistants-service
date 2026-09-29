-- ============================================================
-- ROADMAP 2.1229 — store_brief_and_provenance (CEE commit-seam writer)
--
-- ⚠ STATUS: ✅ ALREADY APPLIED AND LIVE ON STAGING before this file was
-- committed. This migration is the REPOSITORY'S RECORD of an object that
-- already exists in the database, so the two agree and a future
-- `supabase db reset` reproduces the live state. It is written to be safely
-- re-runnable (CREATE OR REPLACE / ALTER ... TYPE / idempotent grants).
-- Do not treat it as pending work.
--
-- The statements below were read back from the deployed catalogue
-- (`pg_get_functiondef`, `information_schema.columns`, `pg_proc.proacl`) on
-- 2026-09-18 rather than transcribed from a design note — the function body
-- here is what the database is actually running.
--
-- ── WHY IT EXISTS ────────────────────────────────────────────────────────
-- USER OUTCOME: a person who has run an analysis can send their model to a
-- colleague, and the colleague opens the link and sees it.
--
-- `create_shared_brief` raises 'No brief to share - generate a brief first'
-- whenever `scenarios.brief IS NULL`. At the time of writing that column was
-- NULL on 14,157 of 14,158 scenarios (the single exception is a hand-made
-- test stub), and `analysis_provenance` likewise — so EVERY real share
-- failed, and the UI answered "Please try again shortly": a retry prompt for
-- a permanently impossible operation.
--
-- Nothing was wrong with the producers. They lost their CALLER when the
-- direct browser→PLoT `/v2/run` path was retired. CEE mints all four values
-- on every run and had been writing them only to the telemetry table
-- `v5_handler_facts`. This function is the service-role door that lets the
-- CEE commit seam put them where the share path reads them.
--
-- ── ALL-OR-NOTHING IS A CONSUMER REQUIREMENT, NOT A PREFERENCE ───────────
-- `create_shared_brief` null-checks `analysis_provenance` ONCE and then
-- dereferences three keys out of it —
--   analysis_provenance->>'graph_hash'
--   (analysis_provenance->>'seed_used')::integer
--   analysis_provenance->>'response_hash'
-- — straight into three NOT NULL columns of `shared_briefs`. A PARTIAL
-- envelope therefore passes that null check and dies on a 23502, converting
-- an honest and actionable 'run analysis first' into an opaque constraint
-- violation at SHARE time, one hop and possibly days from the turn that
-- caused it. Hence the guard below returns false rather than writing a
-- partial row, and the CEE-side projection enforces the same rule
-- independently (belt and braces, by design — neither is load-bearing alone).
--
-- ⚠ KNOWN RESIDUAL, NOT ADDRESSED HERE. `create_shared_brief` still casts
-- `(analysis_provenance->>'seed_used')::integer`. Widening
-- `shared_briefs.seed_used` to bigint below did NOT widen that cast, so a
-- seed above 2,147,483,647 would still raise 22003 inside that function.
-- Observed seeds max at 2,146,549,360 — 0.04% under the int32 ceiling, and
-- 0 of 3,078 measured runs exceed it — so this is latent, not live. Fixing
-- it means editing `create_shared_brief`, which is a different function with
-- a different blast radius; it is reported rather than folded in here.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Widen shared_briefs.seed_used to bigint.
--    Seeds are emitted as 32-bit-range integers today but the value is
--    lineage, not a bounded enum, and the observed maximum sits 0.04% under
--    the int32 ceiling. `integer` was one seed away from a hard failure.
-- ------------------------------------------------------------
ALTER TABLE public.shared_briefs
  ALTER COLUMN seed_used TYPE bigint;

-- ------------------------------------------------------------
-- 2. The writer.
--
--    SECURITY DEFINER with a pinned search_path: it updates `scenarios`
--    rows that the CALLER may not own, because the caller is the CEE
--    service, not the end user. It takes the scenario id from the turn CEE
--    just committed.
--
--    Returns boolean, and the two false cases are NOT the same as an error:
--      false — any of the four values is NULL (the all-or-nothing guard),
--              or no `scenarios` row matched the id. Nothing was written.
--      true  — a row was updated.
--    The CEE caller reports these as distinct telemetry statuses so a
--    silent no-write can never be read as a success.
--
--    `stored_by` / `stored_at` are stamped into the provenance envelope so a
--    row's origin is legible at the database without joining telemetry.
--    `create_shared_brief` reads only the three keys above and ignores them.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.store_brief_and_provenance(
  p_scenario_id  uuid,
  p_brief        jsonb,
  p_graph_hash   text,
  p_seed_used    bigint,
  p_response_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_updated integer;
BEGIN
  IF p_brief IS NULL OR p_graph_hash IS NULL OR p_seed_used IS NULL OR p_response_hash IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.scenarios
     SET brief = p_brief,
         analysis_provenance = jsonb_build_object(
           'graph_hash',    p_graph_hash,
           'seed_used',     p_seed_used,
           'response_hash', p_response_hash,
           'stored_by',     'cee.commit.store_brief_and_provenance',
           'stored_at',     to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
   WHERE id = p_scenario_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END
$$;

-- ------------------------------------------------------------
-- 3. Grants — service_role ONLY.
--
--    This function bypasses RLS on `scenarios` by design, so exposing it to
--    `authenticated` would let any signed-in user overwrite any scenario's
--    brief and provenance by id. REVOKE FIRST, then grant the single role
--    that may call it: PostgreSQL grants EXECUTE on functions to PUBLIC by
--    default, so the REVOKE is the load-bearing statement here, not the
--    GRANT.
--    Verified at the live ACL: {postgres=X/postgres,service_role=X/postgres}
--    — no anon, no authenticated, no PUBLIC.
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.store_brief_and_provenance(uuid, jsonb, text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.store_brief_and_provenance(uuid, jsonb, text, bigint, text) FROM anon;
REVOKE ALL ON FUNCTION public.store_brief_and_provenance(uuid, jsonb, text, bigint, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.store_brief_and_provenance(uuid, jsonb, text, bigint, text) TO service_role;
