-- ============================================================
-- V5 upsert-on-append: ensure_scenario_exists RPC
-- Target: Staging Supabase
-- Date: 2026-04-21
--
-- Problem solved:
--   The pre-flight introduced in commit dbd59c9e surfaced missing
--   scenarios as a 422 at ingress. Real-user traffic exposed that the
--   UI's scenarios-row insert (DecisionGuideAI scenarioService, JWT-
--   scoped INSERT) can arrive after or concurrently with the first V5
--   turn, so the guard rejects valid traffic.
--
-- Fix:
--   CEE calls this RPC BEFORE append_turn_atomic. If the scenarios row
--   is missing, INSERT it with the caller-supplied user_id; if it
--   exists, leave it alone. Either way return the authoritative user_id
--   so the caller can detect tenant drift (the row exists but belongs
--   to a different user).
--
-- Security posture (PoC scope — NOT production):
--   ⚠ This RPC TRUSTS the caller-supplied p_user_id. CEE's HTTP ingress
--   is API-key + HMAC authenticated and service-to-service; there is
--   no end-user JWT reaching Postgres. Under SECURITY DEFINER the
--   function therefore has no way to verify p_user_id is the real
--   caller's id — it writes whatever the caller passes.
--
--   For the internal PoC this is acceptable: (a) the service-role key
--   is already full-trust, so an attacker with it can do anything
--   regardless; (b) the only caller today is CEE, and CEE is server-
--   to-server. No external users exist.
--
--   Production upgrade path (Group 3 round 2 "Option A"): mint a per-
--   request Supabase client from the end user's Supabase JWT and call
--   a version of this function that reads identity from `auth.uid()`
--   rather than a parameter. That removes the caller-spoofing surface
--   entirely. See Docs/v5/slice-phase-0-supabase-audit.md §residual-
--   risk sign-off for the accepted-risk discussion.
--
--   ⚠⚠ CORRECTED 2026-08-26 — THE PARAGRAPH BELOW WAS TRUE WHEN WRITTEN
--   AND IS FALSE TODAY. It is left standing rather than deleted because
--   it is the stated narrowing behind the §residual-risk sign-off above,
--   and a reader who finds only the corrected text cannot tell that the
--   sign-off once rested on something that has since been removed.
--
--   SUPERSEDED (2026-04-21, no longer true):
--     "Partial guardrail that already exists: scenarios.user_id has a
--      FOREIGN KEY to auth.users(id). A caller cannot create a scenarios
--      row for a user_id that is not a real Supabase Auth user. The
--      spoofing surface is therefore narrowed to 'known-existing auth
--      users' rather than 'arbitrary UUIDs'."
--
--   WHY IT IS FALSE: the very next migration,
--   20260422000000_v5_guest_mode_nullable_user_id.sql, DROPS
--   `scenarios_user_id_fkey` and drops NOT NULL on scenarios.user_id so
--   guest rows can store NULL. That is one day after this file. Two later
--   migrations record the absence as deliberate:
--   20260705120000_v5_model_versions.sql and
--   20260710113000_v5_decision_records.sql.
--
--   MEASURED 2026-08-26, at the migration tree AND at the deployed
--   staging database (they agree):
--     - `REFERENCES auth.users` appears ZERO times under supabase/
--       (contrast control in the same sweep: 16 other REFERENCES clauses
--       are visible, so the probe is not blind).
--     - public.scenarios carries two foreign keys — current_model_version_id
--       and source_scenario_id — and NONE on user_id.
--     - scenarios.user_id is_nullable = YES.
--   So the surface this paragraph bounded is, as stated in the negative,
--   "arbitrary UUIDs" and not "known-existing auth users".
--
--   ⭐ WHAT ACTUALLY BOUNDS IT TODAY, AND WHY THE SIGN-OFF STILL HOLDS:
--   not the foreign key — the GRANT. Measured on the deployed instance:
--   EXECUTE on this function is `anon = false`, `authenticated = false`,
--   `service_role = true`. No end-user role can call it at all, which is
--   the posture paragraphs (a) and (b) above already describe and is what
--   the §residual-risk sign-off actually rests on. The sign-off is
--   therefore NOT invalidated by the dropped FK; it was simply crediting
--   the wrong mechanism.
--
--   ⛔ THE CONSEQUENCE WORTH CARRYING: the two guardrails are not
--   interchangeable, and only one of them is still here. If EXECUTE is
--   ever granted to `authenticated` on this function, the foreign key is
--   NOT present to bound what a caller may pass — the pre-2026-04-22
--   reasoning does not apply. Re-derive the posture at that point rather
--   than inheriting this block.
--
-- Additive-only. Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION ensure_scenario_exists(
  p_scenario_id UUID,
  p_user_id     UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Idempotent upsert. ON CONFLICT DO NOTHING is intentional: we do
  -- NOT want to overwrite an existing row's user_id, stage, graph, or
  -- any UI-owned column with caller-supplied defaults.
  --
  -- `stage` defaults to 'frame' and `events` defaults to '[]'::jsonb at
  -- the table level (see scenarios DDL), so a minimal INSERT with id
  -- + user_id produces a well-formed, queryable row.
  INSERT INTO scenarios (id, user_id)
  VALUES (p_scenario_id, p_user_id)
  ON CONFLICT (id) DO NOTHING;

  -- Re-read the row's user_id regardless of whether we inserted. If
  -- the caller-supplied p_user_id disagrees with the stored value
  -- (i.e. row existed, belongs to a different user), the caller gets
  -- the authoritative answer and can reject cross-tenant access at
  -- the application layer.
  SELECT user_id INTO v_user_id
    FROM scenarios
    WHERE id = p_scenario_id;

  IF v_user_id IS NULL THEN
    -- Neither insert nor select found a row. Shouldn't be reachable
    -- (INSERT with no conflict returns a row; ON CONFLICT DO NOTHING
    -- leaves the existing row in place) but fail loudly if it ever is.
    RAISE EXCEPTION 'ensure_scenario_exists: scenario % neither inserted nor found', p_scenario_id;
  END IF;

  RETURN v_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION ensure_scenario_exists(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_scenario_exists(UUID, UUID) TO service_role;

COMMENT ON FUNCTION ensure_scenario_exists(UUID, UUID) IS
  'V5 pre-flight: idempotently upsert a scenarios row for an on-demand V5 turn. Returns the authoritative user_id (may differ from p_user_id if the row pre-existed with a different owner — caller MUST check). PoC scope; trust-the-caller on p_user_id. Production upgrade: JWT-scoped client + auth.uid().';
