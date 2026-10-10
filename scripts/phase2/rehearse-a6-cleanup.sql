-- Quiescent disposable LOCAL PostgreSQL copy only; never a hosted endpoint.
-- Shared by the main rehearsal and standalone interrupted-run recovery.
-- The main rehearsal supplies its original, name-based absence snapshot.
-- In a new session that snapshot is gone: the round-3 output proves all four
-- names were absent (bootstrap preflight passed). Confirm that evidence with:
-- psql -X -v ON_ERROR_STOP=1 -v a6_fixtures_absent_before=true -h 127.0.0.1 -p 55432 -U postgres -d postgres -f scripts/phase2/rehearse-a6-cleanup.sql
-- Round-3 output also says agent_guidance already existed. RETAIN it.
-- Without a session snapshot the column is always retained by default; state
-- is printed below. Only if independently known to have been added by the
-- harness may the caller supply -v a6_drop_added_guidance_column=true.
-- WITHOUT --single-transaction: the unchanged rollback owns its transaction.
\set ON_ERROR_STOP on
\set AUTOCOMMIT on
\encoding UTF8
SELECT :'HOST' IN ('localhost', '127.0.0.1', '::1') OR :'HOST' LIKE '/%' AS a6_cleanup_local_endpoint
\gset
\if :a6_cleanup_local_endpoint
\else
  \echo 'REFUSED: local endpoint required'
  \quit 3
\endif
\if :{?a6_fixtures_absent_before}
\else
  \set a6_fixtures_absent_before false
\endif
\if :{?a6_drop_added_guidance_column}
\else
  \set a6_drop_added_guidance_column false
\endif
DO $$ BEGIN
  IF current_user <> 'postgres' OR getdatabaseencoding() <> 'UTF8' THEN
    RAISE EXCEPTION 'A6 cleanup requires postgres owner and UTF8 database encoding';
  END IF;
  IF to_regclass('public.scenarios') IS NULL OR to_regclass('public.v5_conversation_turns') IS NULL
    OR to_regclass('public.v5_handler_facts') IS NULL THEN
    RAISE EXCEPTION 'A6 cleanup requires a disposable local base schema copy';
  END IF;
END $$;
CREATE TEMP TABLE a6_cleanup_expected (name text PRIMARY KEY, signature text, live_md5 text,
  live_length integer, arg_count integer, security_definer boolean, drop_order integer);
INSERT INTO a6_cleanup_expected VALUES
  ('append_turn_atomic_v2', 'public.append_turn_atomic_v2(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text)',
    '293850ef292d67c1c8e9c966722c510f', 3720, 15, TRUE, 4),
  ('append_agent_answer_with_guidance', 'public.append_agent_answer_with_guidance(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb)',
    '9bc227a08d12cc216c9365f668fb6709', 4204, 16, FALSE, 3),
  ('append_agent_answer_with_offers', 'public.append_agent_answer_with_offers(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text)',
    'ea9988e21459581bdf18097534a6e373', 3623, 18, FALSE, 2),
  ('append_agent_answer_if_latest', 'public.append_agent_answer_if_latest(uuid,uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text)',
    '7d038f624e222134c7ac58c8db79281e', 1994, 19, FALSE, 1);
CREATE TEMP TABLE a6_cleanup_state AS SELECT
  :'a6_fixtures_absent_before'::boolean AS recovery_absence_confirmed,
  :'a6_drop_added_guidance_column'::boolean AS recovery_column_added_confirmed,
  ARRAY[]::text[] AS absent_names, FALSE AS drop_column, ''::text AS provenance;
DO $$ BEGIN
  IF to_regclass('pg_temp.a6_original') IS NOT NULL THEN
    UPDATE a6_cleanup_state SET
      absent_names = (SELECT fixture_names_absent_before FROM a6_original),
      drop_column = NOT (SELECT guidance_column_preexisted FROM a6_original),
      provenance = 'original rehearsal session snapshot';
  ELSE
    UPDATE a6_cleanup_state SET
      absent_names = CASE WHEN recovery_absence_confirmed
        THEN ARRAY(SELECT name FROM a6_cleanup_expected ORDER BY name) ELSE ARRAY[]::text[] END,
      drop_column = recovery_column_added_confirmed,
      provenance = 'new recovery session; function absence requires original preflight evidence; column retained unless caller confirms harness added it';
  END IF;
END $$;
SELECT provenance, absent_names AS confirmed_absent_before,
  EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.v5_conversation_turns'::regclass
    AND attname = 'agent_guidance' AND NOT attisdropped) AS agent_guidance_exists_now,
  CASE WHEN drop_column THEN 'DROP: confirmed added by harness'
    ELSE 'RETAIN: pre-existing, or original presence unknown in this session' END AS column_cleanup
FROM a6_cleanup_state;
-- Refuse before any persistent change if a named object cannot be identified
-- as an absent-at-start LIVE fixture (or the single A6-patched fixture).
-- Name-level checks also refuse an unexpected overload; no CASCADE anywhere.
DO $$ DECLARE f record;
BEGIN
  FOR f IN SELECT p.*, e.signature, e.live_md5, e.live_length, e.arg_count,
      e.security_definer, s.absent_names
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN a6_cleanup_expected e ON e.name = p.proname CROSS JOIN a6_cleanup_state s
    WHERE n.nspname = 'public'
  LOOP
    IF NOT (f.proname = ANY(f.absent_names)) THEN
      RAISE EXCEPTION 'A6 cleanup refused: % was not confirmed absent before bootstrap', f.proname;
    END IF;
    IF f.oid IS DISTINCT FROM to_regprocedure(f.signature)
      OR f.pronargs <> f.arg_count OR f.proowner <> 'postgres'::regrole
      OR f.prosecdef <> f.security_definer
      OR f.proacl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'::aclitem[]
      OR NOT ((md5(f.prosrc) = f.live_md5 AND length(f.prosrc) = f.live_length)
        OR (f.proname = 'append_agent_answer_with_guidance'
          AND md5(f.prosrc) = 'bb1b2328d1e665311d96fa78e42e23df' AND length(f.prosrc) = 4978)) THEN
      RAISE EXCEPTION 'A6 cleanup refused: % does not match a LIVE/A6 fixture', f.proname;
    END IF;
  END LOOP;
END $$;
SELECT EXISTS (SELECT 1 FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.append_agent_answer_with_guidance(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb)')
    AND md5(p.prosrc) = 'bb1b2328d1e665311d96fa78e42e23df') AS a6_cleanup_needs_rollback
\gset
\if :a6_cleanup_needs_rollback
  -- Apply the real rollback, including every identity/MD5/ACL/delegate guard.
  \ir ../../supabase/migrations/rollback/20261010010000_a6_guidance_entry_variant_slot_rollback.sql.do-not-apply
\else
  \echo 'A6 cleanup: after-md5 absent; rollback not needed'
\endif
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM a6_cleanup_expected e JOIN pg_proc p ON p.oid = to_regprocedure(e.signature)
    WHERE md5(p.prosrc) <> e.live_md5 OR length(p.prosrc) <> e.live_length) THEN
    RAISE EXCEPTION 'A6 cleanup refused: rollback did not restore LIVE fixture bodies';
  END IF;
END $$;
-- Exact fixture scenario only; explicit dependent deletes also work when the
-- copied schema has different FK cascade settings. No other scenario is touched.
DELETE FROM public.v5_handler_facts WHERE scenario_id = 'a6000000-0000-4000-8000-000000000001';
DELETE FROM public.v5_conversation_turns WHERE scenario_id = 'a6000000-0000-4000-8000-000000000001';
DELETE FROM public.scenarios WHERE id = 'a6000000-0000-4000-8000-000000000001';
DO $$ DECLARE f record;
BEGIN
  FOR f IN SELECT e.* FROM a6_cleanup_expected e CROSS JOIN a6_cleanup_state s
    WHERE e.name = ANY(s.absent_names) AND to_regprocedure(e.signature) IS NOT NULL
    ORDER BY e.drop_order
  LOOP
    EXECUTE format('DROP FUNCTION %s RESTRICT', f.signature);
    RAISE NOTICE 'A6 cleanup: removed absent-at-start fixture %', f.name;
  END LOOP;
  IF (SELECT drop_column FROM a6_cleanup_state) THEN
    ALTER TABLE public.v5_conversation_turns DROP COLUMN IF EXISTS agent_guidance RESTRICT;
    RAISE NOTICE 'A6 cleanup: removed column confirmed added by harness';
  ELSE
    RAISE NOTICE 'A6 cleanup: retained agent_guidance; see original-presence state above';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN a6_cleanup_state s WHERE n.nspname = 'public' AND p.proname = ANY(s.absent_names)) THEN
    RAISE EXCEPTION 'FAIL A6 fixture functions remain';
  END IF;
  IF EXISTS (SELECT 1 FROM public.scenarios WHERE id = 'a6000000-0000-4000-8000-000000000001')
    OR EXISTS (SELECT 1 FROM public.v5_conversation_turns WHERE scenario_id = 'a6000000-0000-4000-8000-000000000001')
    OR EXISTS (SELECT 1 FROM public.v5_handler_facts WHERE scenario_id = 'a6000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL A6 fixture scenario data remain';
  END IF;
  IF to_regclass('pg_temp.a6_original') IS NOT NULL THEN
    IF (EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.v5_conversation_turns'::regclass
      AND attname = 'agent_guidance' AND NOT attisdropped))
      IS DISTINCT FROM (SELECT guidance_column_preexisted FROM a6_original) THEN
      RAISE EXCEPTION 'FAIL original guidance-column presence restored';
    END IF;
    RAISE NOTICE 'PASS original guidance-column presence restored';
    IF pg_temp.phase2_catalogue() IS DISTINCT FROM (SELECT catalogue FROM a6_original) THEN
      RAISE EXCEPTION 'FAIL original public catalogue restored exactly';
    END IF;
    RAISE NOTICE 'PASS original public catalogue restored exactly';
    IF NOT (SELECT (SELECT count(*) FROM public.scenarios) = scenarios
      AND (SELECT count(*) FROM public.v5_conversation_turns) = turns
      AND (SELECT count(*) FROM public.v5_handler_facts) = facts FROM a6_original_counts) THEN
      RAISE EXCEPTION 'FAIL original base-table data counts restored';
    END IF;
    RAISE NOTICE 'PASS original base-table data counts restored';
  ELSE
    RAISE NOTICE 'A6 recovery complete; original catalogue/count snapshot unavailable in this new session';
  END IF;
END $$;
COMMIT;
DROP TABLE a6_cleanup_state, a6_cleanup_expected;
\echo 'A6 cleanup complete; rollback guards unchanged; fixture objects/data removed only with original-absence evidence.'
