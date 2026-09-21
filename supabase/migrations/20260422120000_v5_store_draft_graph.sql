-- ============================================================
-- V5 draft-graph persistence: store_draft_graph RPC
-- Target: Staging Supabase
-- Date: 2026-04-22
--
-- Problem solved:
--   The V5 draft_graph dispatcher (dispatchDraftGraph) produces a
--   valid GraphV3T from the CEE pipeline but the OlumiResponse
--   returned to the client carries no graph data (the v0.7.0 schema
--   has no full_draft block variant). The client had no way to
--   retrieve the graph after the turn completed.
--
-- Fix:
--   Add store_draft_graph RPC: after handleDraftGraph succeeds,
--   CEE writes the graph JSON to scenarios.graph. The client then
--   reads it via the existing scenario read path.
--
-- Design decisions:
--   - UPDATE-only semantics: pre-flight (ensure_scenario_exists) always
--     creates the scenarios row before this RPC fires. An INSERT fallback
--     would create a row without user_id (service-role has no auth.uid()),
--     breaking ownership semantics. Surface missing-row as an error instead.
--   - graph column is already JSONB in the scenarios table.
--   - SECURITY DEFINER with service-role key — same posture as all
--     other V5 RPCs. No user JWT required.
--   - Additive-only. Safe to re-run (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION store_draft_graph(
  p_scenario_id UUID,
  p_graph       JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  -- UPDATE-only: pre-flight (ensure_scenario_exists) always creates the
  -- scenarios row before this RPC is called, so a missing row is an
  -- application error we want to surface rather than silently paper over
  -- with a partial INSERT. An INSERT fallback here would create a row with
  -- no user_id (service-role has no auth.uid()), breaking ownership semantics.
  UPDATE scenarios SET graph = p_graph WHERE id = p_scenario_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'store_draft_graph: scenario % not found — ensure_scenario_exists must run before this RPC', p_scenario_id;
  END IF;
END;
$$;

-- Grant to authenticated only (service-role bypasses RLS and grants
-- automatically; this matches the posture of all other V5 RPCs).
REVOKE EXECUTE ON FUNCTION store_draft_graph(UUID, JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION store_draft_graph(UUID, JSONB) TO authenticated;
