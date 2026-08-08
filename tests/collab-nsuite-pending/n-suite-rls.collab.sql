-- ============================================================================
-- 2.909 N-suite — DB-GRAIN (RLS / grants / append-only) — RED pre-DDL.
--
-- Adapted from docs-designs/COLLAB-TENANCY-AUDIT-2026-07-11/tests/n-suite-rls.sql
-- (Talchain estate) for the U-S0 elicitation tables per
-- COLLAB-UNIFIED-BUILD-PLAN-2026-08-07 §3 (asset-3 posture: FORCE RLS;
-- REVOKE ALL then GRANT SELECT to authenticated under owner-only RLS; NO
-- participant table grants at all; writes only via service-role SECURITY
-- DEFINER RPCs with typed SQLSTATEs + pinned search_path).
--
-- HARNESS: psql -v ON_ERROR_STOP=1 -f n-suite-rls.collab.sql  against the
-- staging clone AFTER the U-S0 migration set is applied. Each DO block RAISES
-- on violation.
--
-- RED SIGNATURE TODAY (2026-08-08, pre-DDL): block 0 raises
--   'N-SQL-0 RED (pre-DDL): missing elicitation relations: ...'
-- because none of the four U-S0 tables exist. That failure IS the documented
-- RED for the DB grain. Do not delete block 0 — it is also the harness's
-- positive control that the catalog queries can SEE relations (it checks a
-- known-live table first).
-- ============================================================================

-- ── N-SQL-0: relations exist (RED today) + catalog-visibility positive control
DO $$
DECLARE
  missing text := '';
  t text;
BEGIN
  -- POSITIVE CONTROL (trap 13): a known-live table must be visible to this
  -- catalog query, else the harness itself is blind and every absence below
  -- would be vacuous. model_versions is EXECUTED on staging (2026-07-08).
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'model_versions' AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'N-SQL-0 HARNESS-BLIND: model_versions not visible — wrong database or blind catalog query; every subsequent assertion is void';
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'elicitation_rounds', 'round_events', 'elicitation_participants', 'elicitation_events'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      missing := missing || t || ' ';
    END IF;
  END LOOP;
  IF missing <> '' THEN
    RAISE EXCEPTION 'N-SQL-0 RED (pre-DDL): missing elicitation relations: % — the 2.909 N-suite documented RED; goes GREEN when the U-S0 migration set lands', missing;
  END IF;
END $$;

-- ── N-SQL-1: FORCE RLS on every elicitation table
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'elicitation_rounds', 'round_events', 'elicitation_participants', 'elicitation_events'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t
        AND c.relrowsecurity AND c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'N-SQL-1 VIOLATION: % lacks FORCE ROW LEVEL SECURITY', t;
    END IF;
  END LOOP;
END $$;

-- ── N-SQL-2: grants — anon has NOTHING; authenticated at most SELECT;
--             NO role has INSERT/UPDATE/DELETE (writes ride SECURITY DEFINER
--             RPCs as the table owner). Participants hold no DB identity at
--             all (blindness fails CLOSED — Verdict 1), so there is no
--             "participant role" to check: the assertion is the ABSENCE of any
--             non-owner write path.
DO $$
DECLARE t text; bad record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'elicitation_rounds', 'round_events', 'elicitation_participants', 'elicitation_events'
  ] LOOP
    FOR bad IN
      SELECT grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = t
        AND grantee IN ('anon', 'authenticated')
        AND NOT (grantee = 'authenticated' AND privilege_type = 'SELECT')
    LOOP
      RAISE EXCEPTION 'N-SQL-2 VIOLATION: % has % on % (asset-3 posture: anon nothing; authenticated SELECT-only under owner-only RLS)',
        bad.grantee, bad.privilege_type, t;
    END LOOP;
  END LOOP;
END $$;

-- ── N-SQL-3: append-only (INV-C) — no UPDATE/DELETE grant for ANY
--             non-superuser role on the event tables; the ONE exception is the
--             R-2 redaction routine, which is a SECURITY DEFINER function, not
--             a table grant.
DO $$
DECLARE t text; bad record;
BEGIN
  FOREACH t IN ARRAY ARRAY['round_events', 'elicitation_events'] LOOP
    FOR bad IN
      SELECT grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = t
        AND privilege_type IN ('UPDATE', 'DELETE')
        AND grantee NOT IN ('postgres')  -- table owner only; supabase_admin variants intentionally NOT excepted: surface them
    LOOP
      RAISE EXCEPTION 'N-SQL-3 VIOLATION (INV-C): % has % on append-only table %', bad.grantee, bad.privilege_type, t;
    END LOOP;
  END LOOP;
END $$;

-- ── N-SQL-4: every collab RPC's EXECUTE is revoked from PUBLIC/anon/authenticated
--             (service-role SECURITY DEFINER only — TA 04 §3, model_versions template)
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'collab\_%' OR p.proname LIKE 'elicitation\_%' OR p.proname LIKE '%\_elicitation%')
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.routine_privileges rp
      WHERE rp.routine_schema = 'public' AND rp.routine_name = f.proname
        AND rp.grantee IN ('PUBLIC', 'anon', 'authenticated')
        AND rp.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'N-SQL-4 VIOLATION: RPC % is executable by PUBLIC/anon/authenticated', f.proname;
    END IF;
  END LOOP;
END $$;

-- ── N-SQL-5 (N-7 legacy isolation): no elicitation RLS policy references the
--             legacy pre-canvas membership machinery
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT pol.polname AS polname,
           pg_get_expr(pol.polqual, pol.polrelid) AS qual,
           c.relname AS relname
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('elicitation_rounds','round_events','elicitation_participants','elicitation_events')
  LOOP
    IF p.qual ~* '(teams|team_members|organisation_members|organization_members|decision_collaborators|invitations)' THEN
      RAISE EXCEPTION 'N-SQL-5 VIOLATION (N-7): policy % on % references legacy membership machinery: %', p.polname, p.relname, p.qual;
    END IF;
  END LOOP;
END $$;

-- ── N-SQL-6 (N-9 share-link isolation): the snapshot share path exposes no
--             elicitation fields — no view/function joins shared_snapshots to
--             elicitation tables
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_shared_snapshot_by_slug'
      AND pg_get_functiondef(p.oid) ~* 'elicitation'
  ) THEN
    RAISE EXCEPTION 'N-SQL-6 VIOLATION (N-9): get_shared_snapshot_by_slug references elicitation state — slug possession must never reach the panel record';
  END IF;
END $$;

-- ── N-SQL-7 (N-12 shape): the redaction routine exists, is SECURITY DEFINER,
--             EXECUTE service-role-only, and a redaction audit table exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'collab_redact_participant' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'N-SQL-7 VIOLATION (N-12): collab_redact_participant SECURITY DEFINER routine missing (name is the 2.909 contract — rename consciously in the N-suite if the build chooses differently)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.routine_privileges rp
    WHERE rp.routine_schema = 'public' AND rp.routine_name = 'collab_redact_participant'
      AND rp.grantee IN ('PUBLIC', 'anon', 'authenticated') AND rp.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'N-SQL-7 VIOLATION (N-12): collab_redact_participant executable by PUBLIC/anon/authenticated — must be service-role only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'collab_redaction_audit' AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'N-SQL-7 VIOLATION (N-12): collab_redaction_audit table missing — redaction must be audit-logged';
  END IF;
END $$;

SELECT 'N-SQL suite complete: all DB-grain assertions held' AS verdict;
