-- Quiescent, disposable LOCAL PostgreSQL 15 base schema copy only.
-- The four absent functions are installed from byte-exact LIVE fixtures here;
-- the migration and ALL its guards are applied unchanged. No hosted endpoint.
-- Fixture functions and a newly added guidance column are removed afterwards;
-- a pre-existing guidance column is retained. Original public catalogue and
-- base-table row counts must match exactly at cleanup. Failure stops for inspection.
-- From repository root, WITHOUT --single-transaction:
-- psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -U postgres -d postgres -f scripts/phase2/rehearse-a6-guidance.sql
\set ON_ERROR_STOP on
\set AUTOCOMMIT on
\encoding UTF8
SELECT :'HOST' IN ('localhost', '127.0.0.1', '::1') OR :'HOST' LIKE '/%' AS local_endpoint
\gset
\if :local_endpoint
\else
  \echo 'REFUSED: local endpoint required'
  \quit 3
\endif
DO $$ BEGIN
  IF current_user <> 'postgres' OR getdatabaseencoding() <> 'UTF8' THEN
    RAISE EXCEPTION 'A6 requires postgres owner and UTF8 database encoding';
  END IF;
  IF to_regclass('public.scenarios') IS NULL OR to_regclass('public.v5_conversation_turns') IS NULL
    OR to_regclass('public.v5_handler_facts') IS NULL THEN
    RAISE EXCEPTION 'A6 requires a disposable local base schema copy';
  END IF;
  IF EXISTS (SELECT 1 FROM public.scenarios WHERE id = 'a6000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'A6 requires its rehearsal scenario absent';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('append_turn_atomic_v2',
      'append_agent_answer_with_guidance', 'append_agent_answer_with_offers', 'append_agent_answer_if_latest')) THEN
    RAISE EXCEPTION 'A6 requires all four fixture functions absent; never overwrite an existing function';
  END IF;
END $$;
CREATE FUNCTION pg_temp.a6_check(label text, passed boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF passed IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END;
$$;
\ir catalogue-a.sql
-- Capture BEFORE the first persistent schema change.
CREATE TEMP TABLE a6_original AS SELECT pg_temp.phase2_catalogue() AS catalogue,
  EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.v5_conversation_turns'::regclass
    AND attname = 'agent_guidance' AND NOT attisdropped) AS guidance_column_preexisted,
  ARRAY(SELECT name FROM unnest(ARRAY['append_turn_atomic_v2',
    'append_agent_answer_with_guidance', 'append_agent_answer_with_offers',
    'append_agent_answer_if_latest']) AS names(name)
    WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = name)) AS fixture_names_absent_before;
CREATE TEMP TABLE a6_original_counts AS SELECT
  (SELECT count(*) FROM public.scenarios) AS scenarios,
  (SELECT count(*) FROM public.v5_conversation_turns) AS turns,
  (SELECT count(*) FROM public.v5_handler_facts) AS facts;
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.v5_conversation_turns ADD COLUMN IF NOT EXISTS agent_guidance jsonb;
\ir fixtures/a6-live-v2.sql
\ir fixtures/a6-live-with_guidance.sql
\ir fixtures/a6-live-with_offers.sql
\ir fixtures/a6-live-if_latest.sql
CREATE TEMP TABLE a6_expected (name text PRIMARY KEY, signature text, live_md5 text,
  live_length integer, live_bytes integer, arg_count integer, security_definer boolean);
INSERT INTO a6_expected VALUES
  ('append_turn_atomic_v2', 'public.append_turn_atomic_v2(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text)',
    '293850ef292d67c1c8e9c966722c510f', 3720, 3724, 15, TRUE),
  ('append_agent_answer_with_guidance', 'public.append_agent_answer_with_guidance(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb)',
    '9bc227a08d12cc216c9365f668fb6709', 4204, 4204, 16, FALSE),
  ('append_agent_answer_with_offers', 'public.append_agent_answer_with_offers(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text)',
    'ea9988e21459581bdf18097534a6e373', 3623, 3623, 18, FALSE),
  ('append_agent_answer_if_latest', 'public.append_agent_answer_if_latest(uuid,uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text)',
    '7d038f624e222134c7ac58c8db79281e', 1994, 1994, 19, FALSE);
SELECT pg_temp.a6_check('LIVE fixture md5/character length/UTF8 bytes/args/owner/ACL/security: ' || e.name,
  p.oid IS NOT NULL AND md5(p.prosrc) = e.live_md5 AND length(p.prosrc) = e.live_length
  AND octet_length(p.prosrc) = e.live_bytes AND p.pronargs = e.arg_count
  AND p.proowner = 'postgres'::regrole AND p.prosecdef = e.security_definer
  AND p.proacl = '{postgres=X/postgres,service_role=X/postgres}'::aclitem[])
FROM a6_expected e LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.signature);
-- Exact baseline for all four fixtures, taken before applying the migration.
CREATE TEMP TABLE a6_before AS
  SELECT p.oid, p.proname, p.prosrc, pg_get_functiondef(p.oid) AS definition,
    pg_get_function_identity_arguments(p.oid) AS args, to_jsonb(p) - 'prosrc' AS attributes
  FROM a6_expected e JOIN pg_proc p ON p.oid = to_regprocedure(e.signature);
SELECT pg_temp.a6_check('all four LIVE fixture functions installed', count(*) = 4) FROM a6_before;
COMMIT;
-- Read the actual migration/rollback source for the planted guard proof.
-- No rewritten migration, alternate guard or dependency on external fixture paths.
CREATE TEMP TABLE a6_source (name text PRIMARY KEY, sql text NOT NULL);
\set a6_source_dir `mktemp -d /private/tmp/a6-guidance.XXXXXX`
\setenv A6_GUIDANCE_SOURCE_DIR :a6_source_dir
\! node --input-type=module -e 'import {readFileSync,writeFileSync} from "node:fs"; const paths={forward:"supabase/migrations/20261010010000_a6_guidance_entry_variant_slot.sql",rollback:"supabase/migrations/rollback/20261010010000_a6_guidance_entry_variant_slot_rollback.sql.do-not-apply"}; let out=""; for(const [name,path] of Object.entries(paths)){const sql=readFileSync(path,"utf8");if(sql.includes("$a6_source$"))throw Error("delimiter collision");out+="INSERT INTO a6_source VALUES (\x27"+name+"\x27,$a6_source$"+sql+"$a6_source$);\n";} writeFileSync(process.env.A6_GUIDANCE_SOURCE_DIR+"/source.sql",out);'
\set a6_source_file :a6_source_dir '/source.sql'
\i :a6_source_file
\! node --input-type=module -e 'import {rmSync} from "node:fs"; rmSync(process.env.A6_GUIDANCE_SOURCE_DIR,{recursive:true});'
-- Plant an incorrect MD5 in the REAL guard. It must refuse without modifying a function.
DO $$ DECLARE guard text; refused boolean := false;
BEGIN
  SELECT substring(sql FROM 'DO \$guard\$[\s\S]*?\$guard\$;') INTO guard FROM a6_source WHERE name = 'forward';
  guard := regexp_replace(guard, 'expected_with_guidance_md5 CONSTANT text := ''[0-9a-f]{32}'';',
    'expected_with_guidance_md5 CONSTANT text := ''00000000000000000000000000000000'';');
  BEGIN EXECUTE guard;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'A6 guard refused:%' THEN RAISE; END IF;
    refused := true;
  END;
  PERFORM pg_temp.a6_check('actual guard refuses planted md5', refused);
  PERFORM pg_temp.a6_check('planted guard leaves original bodies exact',
    NOT EXISTS (SELECT 1 FROM a6_before b JOIN pg_proc p ON p.oid = b.oid WHERE p.prosrc <> b.prosrc));
END $$;
\ir ../../supabase/migrations/20261010010000_a6_guidance_entry_variant_slot.sql
CREATE TEMP TABLE a6_after AS SELECT p.oid, p.prosrc, pg_get_functiondef(p.oid) AS definition
  FROM a6_before b JOIN pg_proc p ON p.oid = b.oid;
SELECT pg_temp.a6_check('after apply body md5 and length',
  md5(p.prosrc) = 'bb1b2328d1e665311d96fa78e42e23df' AND length(p.prosrc) = 4978)
FROM pg_proc p JOIN a6_before b ON b.oid = p.oid WHERE b.proname = 'append_agent_answer_with_guidance';
SELECT pg_temp.a6_check('identity, ACL and function attributes unchanged: ' || b.proname,
  to_jsonb(p) - 'prosrc' = b.attributes AND pg_get_function_identity_arguments(p.oid) = b.args)
FROM a6_before b JOIN pg_proc p ON p.oid = b.oid;
SELECT pg_temp.a6_check('delegating wrapper body unchanged: ' || b.proname, p.prosrc = b.prosrc)
FROM a6_before b JOIN pg_proc p ON p.oid = b.oid WHERE b.proname <> 'append_agent_answer_with_guidance';
-- Extract the sole changed entry check from actual old and new bodies. Reverting
-- that hunk must yield exactly the original bytes AND MD5 (not just semantics).
DO $$ DECLARE old_body text; new_body text; old_check text; new_check text;
BEGIN
  SELECT prosrc INTO old_body FROM a6_before WHERE proname = 'append_agent_answer_with_guidance';
  SELECT p.prosrc INTO new_body FROM pg_proc p JOIN a6_before b ON b.oid = p.oid WHERE b.proname = 'append_agent_answer_with_guidance';
  old_check := substring(old_body FROM '      OR \(v_entry.value - ''status''[\s\S]*? THEN');
  new_check := substring(new_body FROM '      OR \(v_entry.value - ''status''[\s\S]*?      END\) THEN');
  PERFORM pg_temp.a6_check('only entry-check hunk changed; revert gives same md5',
    old_check IS NOT NULL AND new_check IS NOT NULL AND old_check <> new_check
    AND replace(new_body, new_check, old_check) = old_body
    AND md5(replace(new_body, new_check, old_check)) = '9bc227a08d12cc216c9365f668fb6709');
END $$;
INSERT INTO public.scenarios (id, user_id) VALUES ('a6000000-0000-4000-8000-000000000001', NULL);
CREATE FUNCTION pg_temp.a6_call(mode text, guidance jsonb, turn text DEFAULT gen_random_uuid()::text,
  words text DEFAULT 'Saved A6 words') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE sid uuid := 'a6000000-0000-4000-8000-000000000001'; latest uuid;
  offers jsonb := jsonb_build_array(jsonb_build_object('id', 'agent-talk',
    'label', 'Talk', 'message', 'Talk it through'));
BEGIN
  IF mode = 'with_guidance' THEN
    RETURN public.append_agent_answer_with_guidance(sid, turn, 'direct_answer', NULL, 'agent_turn:a6', TRUE,
      0, 1, jsonb_build_array(), NULL, NULL, jsonb_build_array(), NULL, 'What next?', words, guidance);
  ELSIF mode = 'offers' THEN
    RETURN public.append_agent_answer_with_offers(sid, turn, 'direct_answer', NULL, 'agent_turn:a6', TRUE,
      0, 1, jsonb_build_array(), NULL, NULL, jsonb_build_array(), NULL, 'What next?', words, guidance,
      offers, NULL);
  ELSE
    SELECT id INTO latest FROM public.v5_conversation_turns WHERE scenario_id = sid
      AND turn_id NOT LIKE '%:claim' ORDER BY created_at DESC LIMIT 1;
    RETURN public.append_agent_answer_if_latest(latest, sid, turn, 'direct_answer', NULL, 'agent_turn:a6', TRUE,
      0, 1, jsonb_build_array(), NULL, NULL, jsonb_build_array(), NULL, 'What next?', words, guidance,
      CASE WHEN mode = 'conditional_offers' THEN offers ELSE NULL END, NULL);
  END IF;
END;
$$;
CREATE FUNCTION pg_temp.a6_reject(mode text, event jsonb, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE refused boolean := false;
BEGIN
  BEGIN PERFORM pg_temp.a6_call(mode, jsonb_build_object('version', 1, 'entries', jsonb_build_object('RC-WIDEN', event)));
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'invalid content-free guidance event' THEN RAISE; END IF;
    refused := true;
  END;
  PERFORM pg_temp.a6_check(mode || ': ' || label || ' RAISES', refused);
END;
$$;
DO $$ DECLARE mode text; bad jsonb; receipt jsonb; key text; variant text; slot integer;
  old_event jsonb := jsonb_build_object('status', 'offered', 'state_key_hash', '012345abcdef');
  old_envelope jsonb := jsonb_build_object('version', 1, 'entries', jsonb_build_object('RC-WIDEN', old_event));
BEGIN
  FOREACH mode IN ARRAY ARRAY['with_guidance','offers','conditional_guidance','conditional_offers'] LOOP
    receipt := pg_temp.a6_call(mode, old_envelope);
    PERFORM pg_temp.a6_check(mode || ': old entry accepted', receipt ? 'id');
    PERFORM pg_temp.a6_check(mode || ': delegates persist original words and old guidance end to end',
      (SELECT assistant_message = 'Saved A6 words' AND agent_guidance = old_envelope
       FROM public.v5_conversation_turns WHERE id = (receipt->>'id')::uuid));
    receipt := pg_temp.a6_call(mode, jsonb_set(old_envelope, ARRAY['entries','RC-WIDEN'],
      old_event || jsonb_build_object('variant_id', 'W4', 'slot', 1)));
    PERFORM pg_temp.a6_check(mode || ': new identity stored', (SELECT agent_guidance->'entries'->'RC-WIDEN'
      FROM public.v5_conversation_turns WHERE id = (receipt->>'id')::uuid)
      = (old_event || jsonb_build_object('variant_id', 'W4', 'slot', 1)));
    IF mode IN ('offers', 'conditional_offers') THEN
      PERFORM pg_temp.a6_check(mode || ': original offers survive delegation end to end',
        (SELECT suggested_actions = jsonb_build_array(jsonb_build_object('id', 'agent-talk',
          'label', 'Talk', 'message', 'Talk it through'))
          AND assistant_message = 'Saved A6 words'
         FROM public.v5_conversation_turns WHERE id = (receipt->>'id')::uuid));
    END IF;
    PERFORM pg_temp.a6_reject(mode, old_event || jsonb_build_object('unknown', 'private'), 'unknown key');
    PERFORM pg_temp.a6_reject(mode, old_event || jsonb_build_object('variant_id', 'S1'), 'cross-policy bad variant');
    PERFORM pg_temp.a6_reject(mode, old_event || jsonb_build_object('variant_id', NULL::text), 'null variant');
    FOREACH bad IN ARRAY ARRAY[to_jsonb(0),to_jsonb(4),to_jsonb(1.5::numeric),
      to_jsonb('1'::text),to_jsonb(NULL::integer)] LOOP
      PERFORM pg_temp.a6_reject(mode, old_event || jsonb_build_object('slot', bad),
        format('slot %s', COALESCE(bad::text, 'null')));
    END LOOP;
  END LOOP;
  -- Sets below are derived from POLICY.rows; the TS spec independently checks
  -- those rows, so widening/drift in this inlined SQL set is reviewable.
  FOREACH key IN ARRAY ARRAY['RC-WIDEN','RC-STRENGTHEN-ITEM:012345abcdef'] LOOP
    FOREACH variant IN ARRAY CASE WHEN key = 'RC-WIDEN' THEN ARRAY['W1','W2Z','W2','W3','W4','W5','W6','W7'] ELSE ARRAY['S1','S2','S3L','S3V'] END LOOP
      FOR slot IN 1..3 LOOP
        receipt := pg_temp.a6_call('with_guidance', jsonb_build_object('version', 1, 'entries',
          jsonb_build_object(key, old_event || jsonb_build_object('variant_id', variant, 'slot', slot))));
        PERFORM pg_temp.a6_check(format('%s: %s slot %s accepted', key, variant, slot), receipt ? 'id');
      END LOOP;
    END LOOP;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['RC-WHAT-CHANGES','RC-PREMORTEM','RC-COACH-EDITS'] LOOP
    PERFORM pg_temp.a6_call('with_guidance', jsonb_build_object('version', 1, 'entries',
      jsonb_build_object(key, old_event || jsonb_build_object('slot', 3))));
    BEGIN
      PERFORM pg_temp.a6_call('with_guidance', jsonb_build_object('version', 1, 'entries',
        jsonb_build_object(key, old_event || jsonb_build_object('variant_id', 'W1'))));
      RAISE EXCEPTION 'FAIL variant supplied to variantless policy %', key;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'invalid content-free guidance event' THEN RAISE; END IF;
      RAISE NOTICE 'PASS %: no invented variant accepted', key;
    END;
  END LOOP;
  receipt := pg_temp.a6_call('with_guidance', old_envelope, 'a6-replay');
  PERFORM pg_temp.a6_call('with_guidance', jsonb_set(old_envelope, ARRAY['entries','RC-WIDEN','slot'], to_jsonb(2)),
    'a6-replay', 'Changed words');
  PERFORM pg_temp.a6_check('exact-turn replay preserves saved words and original entry',
    (SELECT assistant_message = 'Saved A6 words' AND agent_guidance = old_envelope
     FROM public.v5_conversation_turns WHERE id = (receipt->>'id')::uuid));
END $$;
-- Validator mutant: drop ONLY the unknown-key check in the actual installed
-- function. The unknown-key proof must turn RED, then restore exactly.
DO $$ DECLARE definition text; mutant text; killed boolean := false;
BEGIN
  SELECT a.definition INTO definition FROM a6_after a JOIN a6_before b ON b.oid = a.oid WHERE b.proname = 'append_agent_answer_with_guidance';
  mutant := replace(definition, '      OR (v_entry.value - ''status'' - ''state_key_hash'' - ''variant_id'' - ''slot'') <> ''{}''::jsonb', '');
  PERFORM pg_temp.a6_check('validator mutant changes the actual function', mutant <> definition);
  EXECUTE mutant;
  BEGIN PERFORM pg_temp.a6_reject('with_guidance', jsonb_build_object('status', 'offered',
    'state_key_hash', '012345abcdef', 'unknown', 'private'), 'unknown key');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'FAIL %unknown key RAISES' THEN RAISE; END IF;
    killed := true;
  END;
  EXECUTE definition;
  PERFORM pg_temp.a6_check('mutant allows any key -> unknown-key row RED (mutant killed)', killed);
END $$;
\ir ../../supabase/migrations/rollback/20261010010000_a6_guidance_entry_variant_slot_rollback.sql.do-not-apply
SELECT pg_temp.a6_check('exact rollback body, md5, args and ACL: ' || b.proname,
  p.prosrc = b.prosrc AND md5(p.prosrc) = md5(b.prosrc)
  AND pg_get_function_identity_arguments(p.oid) = b.args AND to_jsonb(p) - 'prosrc' = b.attributes)
FROM a6_before b JOIN pg_proc p ON p.oid = b.oid;
SELECT pg_temp.a6_check('rollback restores supplied LIVE md5 and length',
  md5(p.prosrc) = '9bc227a08d12cc216c9365f668fb6709' AND length(p.prosrc) = 4204)
FROM pg_proc p JOIN a6_before b ON b.oid = p.oid WHERE b.proname = 'append_agent_answer_with_guidance';
-- The same guarded cleanup also recovers an interrupted run in a new session.
\ir rehearse-a6-cleanup.sql
\echo 'A6 rehearsal PASS; migration guards unchanged; exact rollback proved; original public catalogue and data counts restored.'
