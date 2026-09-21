-- ============================================================
-- V5 DB security hardening — Tier 1 (grants/RLS).
-- Target: Staging Supabase (project etmmuzwxtcjipwphdola — the live
--         DecisionGuideAI app DB that cee-staging also writes into).
-- Date: 2026-06-10
--
-- Why:
--   The V5 security verification (Docs/v5/v5-db-security-tier1-pr-evidence.md)
--   confirmed that anon AND authenticated hold TRUNCATE on the V5
--   conversation/observation tables (RLS never gates TRUNCATE), that
--   cee_prompt_observations has RLS disabled with full anon DML, and that
--   the legacy SECURITY DEFINER mutation/purge RPCs are anon-EXECUTE-able.
--   Now that user_message/assistant_message are durably stored (PR #251),
--   removing this anon attack surface is P0.
--
-- Scope (Tier 1 only — the smallest safe slice):
--   1. Revoke TRUNCATE from anon + authenticated on the 4 V5/observation
--      tables (wipe-protection; RLS does not gate TRUNCATE).
--   2. Enable (+force) RLS on cee_prompt_observations (the only RLS-off
--      base table). No policy ⇒ default-deny to anon/authenticated.
--   3. Revoke EXECUTE from anon (+PUBLIC) on the legacy SECURITY DEFINER
--      mutation/purge RPCs.
--   Tier 2 (authenticated EXECUTE + table DML) and Tier 3 (DB-wide default
--   privileges + non-V5 SECDEF functions) are tracked SEPARATELY.
--
-- Service-role safety (why this cannot break the backend):
--   The CEE backend uses the service_role client
--   (src/orchestrator-v5/session/index.ts:48; SUPABASE_SERVICE_ROLE_KEY).
--   service_role has BYPASSRLS and is NOT named by any statement below, so
--   it retains every grant and bypasses the new RLS. Verified live:
--     - the commit path calls append_turn_atomic_v2 (service_role only),
--       not the legacy append_turn_atomic;
--     - cee_prompt_observations is read/written ONLY by the prompt store,
--       which also uses the service_role client
--       (src/prompts/stores/supabase.ts:156, role asserted at :148).
--
-- Reversibility:
--   Nothing is dropped. Every statement is REVOKE / ENABLE RLS. The paired
--   rollback is at:
--   supabase/migrations/rollback/20260610120000_v5_db_security_tier1_hardening_rollback.sql.do-not-apply
--
-- Deployment-order note:
--   This migration only REMOVES access from anon/authenticated (roles the
--   backend does not use) and enables RLS on a table read/written only by
--   service_role. It has no app-code dependency and is safe to apply
--   before or after any app deploy.
-- ============================================================

BEGIN;

-- 1. TRUNCATE — RLS never gates TRUNCATE, so only the grant prevents a wipe.
REVOKE TRUNCATE ON TABLE
  public.v5_conversation_turns,
  public.v5_handler_facts,
  public.turn_observations,
  public.cee_prompt_observations
FROM anon, authenticated;

-- 2. cee_prompt_observations is the only RLS-off base table (anon full DML).
--    Enable + force RLS; with no policy this is default-deny to
--    anon/authenticated. service_role bypasses RLS (sole legitimate writer).
ALTER TABLE public.cee_prompt_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cee_prompt_observations FORCE  ROW LEVEL SECURITY;

-- 3. Revoke EXECUTE from anon (+PUBLIC) on legacy SECURITY DEFINER
--    mutation/purge RPCs. service_role + postgres retain EXECUTE.
--    'authenticated' is intentionally retained (Tier 2 — pending UI check).
REVOKE EXECUTE ON FUNCTION
  public.append_turn_atomic(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb)
FROM anon, PUBLIC;

REVOKE EXECUTE ON FUNCTION
  public.insert_conversation_turn(uuid,text,text,jsonb,uuid,uuid,text)
FROM anon, PUBLIC;

REVOKE EXECUTE ON FUNCTION
  public.purge_old_observations(integer)
FROM anon, PUBLIC;

REVOKE EXECUTE ON FUNCTION
  public.ensure_scenario_exists(uuid,uuid)
FROM anon, PUBLIC;

-- 3b. Belt-and-suspenders: re-affirm authenticated EXECUTE on the 4 RPCs.
--     Verified pre-flight (aclexplode on each function): authenticated holds an
--     EXPLICIT EXECUTE grant and there is NO PUBLIC grant (public_execute=false),
--     so the REVOKE ... FROM PUBLIC above does NOT strip authenticated. These
--     GRANTs are therefore no-ops on the current ACLs — included only to GUARANTEE
--     the stated Tier-1 scope (authenticated EXECUTE preserved; Tier 2 deferred)
--     regardless of any apply-time ACL drift. Idempotent.
GRANT EXECUTE ON FUNCTION
  public.append_turn_atomic(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.insert_conversation_turn(uuid,text,text,jsonb,uuid,uuid,text)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.purge_old_observations(integer)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.ensure_scenario_exists(uuid,uuid)
TO authenticated;

-- append_turn_atomic_v2(...,text,text) (writes user_message/assistant_message)
-- is already service_role/postgres only — intentionally NOT touched.

COMMIT;
