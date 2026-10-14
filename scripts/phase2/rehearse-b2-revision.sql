-- Disposable, quiescent LOCAL schema/data copy only, with v4 and v6 installed.
-- Commits real turns and migration steps; failure leaves the copy for inspection.
-- Run from repo root. Do NOT use --single-transaction (concurrent sweep index).
-- psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -f scripts/phase2/rehearse-b2-revision.sql
\set ON_ERROR_STOP on
SELECT :'HOST' IN ('localhost','127.0.0.1','::1') OR :'HOST' LIKE '/%' AS local_endpoint
\gset
\if :local_endpoint
\else
  \echo 'REFUSED: local endpoint required'
  \quit 3
\endif
DO $$ BEGIN
  IF to_regclass('public.analysis_runs') IS NOT NULL
    OR to_regclass('public.analysis_run_facts_sweep_idx') IS NOT NULL
    OR to_regclass('public.analysis_run_unattributable') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires #2893, sweep index and slice C absent';
  END IF;
  IF EXISTS (SELECT 1 FROM public.scenarios WHERE id='f2b00000-0000-4000-8000-000000000001')
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.v5_handler_facts'::regclass
      AND attname='evaluated_scenario_revision' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'B2 fixture/column already exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.append_turn_atomic_v4(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint)')
    AND md5(prosrc)='db7bdbe3e2052237c623d8c5477a96e5' AND length(prosrc)=4856) THEN
    RAISE EXCEPTION 'Requires deployed v4 body: md5 db7bdbe3e2052237c623d8c5477a96e5, length 4856';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='append_turn_atomic_v6') THEN
    RAISE EXCEPTION 'Requires existing v6 revision wrapper';
  END IF;
END $$;
\ir catalogue-a.sql
CREATE FUNCTION pg_temp.b2_check(label text, passed boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF passed IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'FAIL %',label; END IF;
  RAISE NOTICE 'PASS %',label;
END;
$$;
CREATE TEMP TABLE b2_original AS SELECT pg_temp.phase2_catalogue() AS catalogue;
CREATE TEMP TABLE b2_original_counts AS SELECT
  (SELECT count(*) FROM public.scenarios) AS scenarios,
  (SELECT count(*) FROM public.v5_conversation_turns) AS turns,
  (SELECT count(*) FROM public.v5_handler_facts) AS facts;
BEGIN;
\ir ../../supabase/migrations/20261009010000_phase2_a_typed_runs.sql
COMMIT;
\ir ../../supabase/migrations/20261009010100_phase2_a_sweep_index.sql
\ir ../../supabase/migrations/20261009040000_phase2_a_legacy_unattributable.sql
CREATE TEMP TABLE b2_before AS SELECT pg_temp.phase2_catalogue() AS catalogue;
CREATE TEMP TABLE b2_functions AS
  SELECT p.oid,p.proname,p.prosrc,pg_get_functiondef(p.oid) AS definition,p.proacl,
    pg_get_function_identity_arguments(p.oid) AS args,to_jsonb(p)-'prosrc' AS attributes
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN
    ('append_turn_atomic_v4','claim_analysis_run_facts','claim_analysis_run_reconciliation');
-- Plant a real body mismatch; exercise the exact step-2 guard from the migration.
-- The subtransaction catches only the guard's own expected refusal.
BEGIN;
DO $plant$
DECLARE f record; refused boolean := false;
BEGIN
  SELECT * INTO STRICT f FROM b2_functions WHERE proname='append_turn_atomic_v4';
  EXECUTE replace(f.definition,f.prosrc,f.prosrc||E'\n-- planted md5 mismatch\n');
  BEGIN
    EXECUTE $step2_guard$
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.append_turn_atomic_v4(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint)')
      AND md5(p.prosrc) = 'db7bdbe3e2052237c623d8c5477a96e5'
      AND pg_get_function_identity_arguments(p.oid) = 'p_scenario_id uuid, p_turn_id text, p_turn_class text, p_handler_id text, p_request_hash text, p_response_emitted boolean, p_llm_calls_used integer, p_duration_ms integer, p_handler_facts jsonb, p_graph jsonb, p_brief_text text, p_pending_actions jsonb, p_coaching_state jsonb, p_user_message text, p_assistant_message text, p_expected_graph_identity_hash text, p_incoming_graph_identity_hash text, p_cas_enforce boolean, p_fence_generation bigint'
  ) THEN
    RAISE EXCEPTION 'B2 guard refused: public.append_turn_atomic_v4 body or identity arguments changed';
  END IF;
END;
$guard$;

$step2_guard$;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'B2 guard refused: public.append_turn_atomic_v4 body or identity arguments changed' THEN RAISE; END IF;
    refused := true;
  END;
  PERFORM pg_temp.b2_check('step-2 guard REFUSES planted md5 mismatch',refused);
END;
$plant$;
ROLLBACK;
-- Split only at step boundaries, retaining exact SQL bytes and transactions.
-- This permits the before/after step-2 witness before applying step 3.
SELECT '/tmp/phase2-b2-rehearsal-'||pg_backend_pid() AS b2_rehearsal_dir
\gset
\setenv PHASE2_B2_REHEARSAL_DIR :b2_rehearsal_dir
\! node --input-type=module -e 'import {readFileSync,mkdirSync,writeFileSync} from "node:fs"; const sql=readFileSync("supabase/migrations/20261009160000_b2_fact_evaluated_revision.sql","utf8"); const steps=sql.split(/(?=^-- STEP [23] )/m); if(steps.length!==3) throw new Error("Expected three B2 steps"); const dir=process.env.PHASE2_B2_REHEARSAL_DIR; mkdirSync(dir,{recursive:true}); steps.forEach((step,i)=>writeFileSync(`${dir}/step-${i+1}.sql`,step));'
\if :SHELL_ERROR
  \quit 3
\endif
\set b2_step1 :b2_rehearsal_dir '/step-1.sql'
\set b2_step2 :b2_rehearsal_dir '/step-2.sql'
\set b2_step3 :b2_rehearsal_dir '/step-3.sql'
\i :b2_step1
SELECT pg_temp.b2_check('before step 2: deployed v4 md5/length and exact ACL',
  (SELECT md5(prosrc)='db7bdbe3e2052237c623d8c5477a96e5' AND length(prosrc)=4856
    AND proacl='{postgres=X/postgres,service_role=X/postgres}'::aclitem[]
    FROM pg_proc WHERE oid=to_regprocedure('public.append_turn_atomic_v4(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint)')));
\i :b2_step2
SELECT md5(prosrc) AS b2_v4_after_step2_md5,length(prosrc) AS b2_v4_after_step2_length
  FROM pg_proc WHERE oid=to_regprocedure('public.append_turn_atomic_v4(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint)');
SELECT pg_temp.b2_check('after step 2: expected modified v4 body',
  (SELECT md5(prosrc)='e43eadabab6f416561497c35815d2860' AND length(prosrc)=5386
    FROM pg_proc WHERE oid=to_regprocedure('public.append_turn_atomic_v4(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint)')));
\i :b2_step3
SELECT pg_temp.b2_check('nullable integer column, no default, nonnegative constraint NOT VALID',
  EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.v5_handler_facts'::regclass
    AND a.attname='evaluated_scenario_revision' AND a.atttypid='integer'::regtype
    AND NOT a.attnotnull AND NOT a.atthasdef AND NOT a.attisdropped)
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.v5_handler_facts'::regclass
    AND conname='v5_handler_facts_evaluated_revision_nonneg' AND NOT convalidated
    AND pg_get_constraintdef(oid)='CHECK ((evaluated_scenario_revision >= 0)) NOT VALID'));
SELECT pg_temp.b2_check('all three identities/args/ACLs/attributes unchanged',
  (SELECT count(*)=3 AND bool_and(f.attributes=to_jsonb(p)-'prosrc'
    AND f.args=pg_get_function_identity_arguments(p.oid) AND f.proacl IS NOT DISTINCT FROM p.proacl)
    FROM b2_functions f JOIN pg_proc p ON p.oid=f.oid));
-- Normalise ONLY the allowed column/constraint/three bodies, then compare the
-- full public catalogue. Includes every source trigger, index, owner and ACL.
WITH after_entries AS (SELECT e FROM jsonb_array_elements(pg_temp.phase2_catalogue()) e),
  before_entries AS (SELECT e FROM b2_before, jsonb_array_elements(catalogue) e),
  normalised AS (
    SELECT CASE WHEN a.e->>'kind'='function' AND (a.e->>'id')::oid IN (SELECT oid FROM b2_functions)
      THEN (SELECT b.e FROM before_entries b WHERE b.e->>'kind'=a.e->>'kind' AND b.e->>'id'=a.e->>'id')
      WHEN a.e->>'kind'='columns' AND (a.e->>'id')::oid='public.v5_handler_facts'::regclass
      THEN jsonb_set(a.e,'{definition}',(SELECT jsonb_agg(col ORDER BY ord)
        FROM jsonb_array_elements(a.e->'definition') WITH ORDINALITY c(col,ord)
        WHERE col->>'name'<>'evaluated_scenario_revision'))
      ELSE a.e END AS e FROM after_entries a
    WHERE NOT (a.e->>'kind'='constraint' AND a.e->'definition'->>'name'='v5_handler_facts_evaluated_revision_nonneg')
  )
SELECT pg_temp.b2_check('catalogue unchanged except column/constraint/3 bodies; NO new writer trigger',
  (SELECT jsonb_agg(e ORDER BY e->>'kind',(e->>'id')::oid) FROM normalised)=(SELECT catalogue FROM b2_before));
BEGIN;
INSERT INTO public.scenarios(id,user_id,graph) VALUES ('f2b00000-0000-4000-8000-000000000001',NULL,NULL);
CREATE TEMP TABLE b2_cases(label text PRIMARY KEY, element jsonb NOT NULL, expected integer);
INSERT INTO b2_cases VALUES
  ('prod-no-key','{}',NULL), ('negative','{"evaluated_scenario_revision":-1}',NULL),
  ('fraction','{"evaluated_scenario_revision":1.5}',NULL), ('string','{"evaluated_scenario_revision":"7"}',NULL),
  ('null','{"evaluated_scenario_revision":null}',NULL), ('too-large','{"evaluated_scenario_revision":1e10}',NULL),
  ('zero','{"evaluated_scenario_revision":0}',0), ('seven','{"evaluated_scenario_revision":7}',7),
  ('int-max','{"evaluated_scenario_revision":2147483647}',2147483647),
  ('int-overflow','{"evaluated_scenario_revision":2147483648}',NULL),
  ('object','{"evaluated_scenario_revision":{}}',NULL), ('boolean','{"evaluated_scenario_revision":true}',NULL);
CREATE TEMP TABLE b2_turns(path text,label text,turn_id text PRIMARY KEY,expected integer,payload jsonb);
INSERT INTO b2_turns SELECT path,label,'b2-'||path||'-'||label,expected,
  jsonb_build_object('fact_type','run_analysis','fact_version',1,'noop',false,'result',
    jsonb_build_object('run_id','b2-'||path||'-'||label)) FROM b2_cases CROSS JOIN (VALUES ('v4'),('v6')) p(path);
COMMIT;
-- Session setting survives individual autocommit turns; never touches shared state.
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
-- Each emitted SELECT is its OWN transaction: all 24 turns must actually COMMIT.
-- No exception handler swallows a writer failure. Both append paths get the same
-- prod-shape payload and revision sibling; v6 delegates via v5 to the v4 INSERT.
SELECT format('SELECT public.append_turn_atomic_%s(
  p_scenario_id=>%L::uuid,p_turn_id=>%L,p_turn_class=>''handler'',p_handler_id=>''run_analysis'',
  p_request_hash=>%L,p_response_emitted=>true,p_llm_calls_used=>0,p_duration_ms=>1,
  p_handler_facts=>%L::jsonb,p_graph=>%s,p_brief_text=>NULL,p_pending_actions=>''[]''::jsonb,
  p_coaching_state=>NULL,p_user_message=>NULL,p_assistant_message=>NULL,
  p_expected_graph_identity_hash=>NULL,p_incoming_graph_identity_hash=>%s,p_cas_enforce=>false,p_fence_generation=>NULL%s);',
  CASE t.path WHEN 'v4' THEN 'v4' ELSE 'v6' END,
  'f2b00000-0000-4000-8000-000000000001',t.turn_id,t.turn_id,
  jsonb_build_array(c.element||jsonb_build_object('handler_id','run_analysis','action_type','run_analysis','noop',false,'payload',t.payload)),
  CASE t.path WHEN 'v4' THEN 'NULL' ELSE '''{"nodes":[],"edges":[]}''::jsonb' END,
  CASE t.path WHEN 'v4' THEN 'NULL' ELSE 'repeat(''a'',64)' END,
  CASE t.path WHEN 'v4' THEN '' ELSE format(',
  p_version_mutation_id=>gen_random_uuid(),p_version_analysis_affecting_hash=>repeat(''a'',64),p_version_hash_algorithm=>''sha256'',
  p_version_projection_version=>''1'',p_version_normaliser_version=>''1'',p_version_graph_schema_version=>''1'',
  p_version_actor_kind=>''system'',p_version_authored_by=>NULL,p_version_creation_kind=>''committed_mutation'',
  p_version_source_turn_id=>%L,p_expected_base_known=>false,
  p_expected_revision=>(SELECT revision FROM public.scenarios WHERE id=''f2b00000-0000-4000-8000-000000000001'')',t.turn_id) END)
FROM b2_turns t JOIN b2_cases c USING(label) ORDER BY t.turn_id
\gexec
SELECT pg_temp.b2_check('each v4/v6 turn COMMITTED with stored revision/null and payload unchanged: '||t.turn_id,
  count(h.id)=1 AND bool_and(h.evaluated_scenario_revision IS NOT DISTINCT FROM t.expected AND h.payload=t.payload))
FROM b2_turns t LEFT JOIN public.v5_conversation_turns v ON v.turn_id=t.turn_id
  AND v.scenario_id='f2b00000-0000-4000-8000-000000000001'
LEFT JOIN public.v5_handler_facts h ON h.v5_conversation_turn_id=v.id GROUP BY t.turn_id;
-- Temporary cursor/time/terminal changes all roll back. Each path's twelve
-- facts are claimed by BOTH ports, so every stored number/null is witnessed.
BEGIN;
CREATE TEMP TABLE b2_fixture_facts AS
  SELECT h.id,t.path,t.label,t.expected,h.payload FROM public.v5_handler_facts h
    JOIN public.v5_conversation_turns v ON v.id=h.v5_conversation_turn_id
    JOIN b2_turns t ON t.turn_id=v.turn_id
  WHERE h.scenario_id='f2b00000-0000-4000-8000-000000000001';
-- Place fixture times strictly before all local history (a quiescent copy).
WITH seed AS (SELECT COALESCE(min(created_at),now())-interval '1 day' AS first_at FROM public.v5_handler_facts),
  ordered AS (SELECT id,row_number() OVER (ORDER BY path,label) AS n FROM b2_fixture_facts)
UPDATE public.v5_handler_facts h SET created_at=seed.first_at+ordered.n*interval '1 second'
  FROM seed,ordered WHERE h.id=ordered.id;
UPDATE public.analysis_run_sweep_state SET lease_id=NULL,lease_until='-infinity',
  processed_at='-infinity',processed_id='00000000-0000-4000-8000-000000000000';
DO $claims$
DECLARE path_name text; receipt jsonb; kind text;
BEGIN
  FOREACH path_name IN ARRAY ARRAY['v4','v6'] LOOP
    FOREACH kind IN ARRAY ARRAY['claim_analysis_run_facts','claim_analysis_run_reconciliation'] LOOP
      UPDATE public.analysis_run_sweep_state SET lease_id=NULL,lease_until='-infinity';
      EXECUTE format('SELECT public.%I(12)',kind) INTO receipt;
      PERFORM pg_temp.b2_check(kind||' returns all sibling values/nulls for '||path_name,
        (SELECT count(*)=12 AND bool_and(f ? 'evaluated_scenario_revision'
          AND f->'evaluated_scenario_revision' IS NOT DISTINCT FROM COALESCE(to_jsonb(b.expected),'null'::jsonb)
          AND f->'payload'=b.payload AND b.path=path_name)
          FROM jsonb_array_elements(receipt->'facts') f
          JOIN b2_fixture_facts b ON b.id=(f->>'fact_id')::uuid));
    END LOOP;
    -- Make this first group terminal for both claims, only inside this rollback.
    INSERT INTO public.analysis_run_quarantine(fact_id,scenario_id,reason)
      SELECT id,'f2b00000-0000-4000-8000-000000000001','b2-rehearsal-only'
      FROM b2_fixture_facts WHERE path=path_name;
    UPDATE public.analysis_run_sweep_state SET processed_at=h.created_at,processed_id=h.id
      FROM (SELECT h.created_at,h.id FROM public.v5_handler_facts h JOIN b2_fixture_facts b ON b.id=h.id
        WHERE b.path=path_name ORDER BY h.created_at DESC,h.id DESC LIMIT 1) h;
  END LOOP;
END;
$claims$;
ROLLBACK;
\ir ../../supabase/migrations/rollback/20261009160000_b2_fact_evaluated_revision_rollback.sql.do-not-apply
SELECT pg_temp.b2_check('rollback v4 body md5 is deployed db7bdbe3, length 4856',
  (SELECT md5(prosrc)='db7bdbe3e2052237c623d8c5477a96e5' AND length(prosrc)=4856
    FROM pg_proc WHERE oid=to_regprocedure('public.append_turn_atomic_v4(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint)')));
SELECT pg_temp.b2_check('B2 rollback restores all 3 bodies byte-exactly, drops column and constraint',
  pg_temp.phase2_catalogue()=(SELECT catalogue FROM b2_before)
  AND (SELECT bool_and(f.prosrc=p.prosrc AND f.definition=pg_get_functiondef(p.oid)
    AND f.proacl IS NOT DISTINCT FROM p.proacl) FROM b2_functions f JOIN pg_proc p ON p.oid=f.oid)
  AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.v5_handler_facts'::regclass
    AND attname='evaluated_scenario_revision' AND NOT attisdropped));
\ir ../../supabase/migrations/rollback/20261009040000_phase2_a_legacy_unattributable_rollback.sql.do-not-apply
\ir ../../supabase/migrations/rollback/20261009010100_phase2_a_sweep_index_rollback.sql.do-not-apply
BEGIN;
\ir ../../supabase/migrations/rollback/20261009010000_phase2_a_typed_runs_rollback.sql.do-not-apply
DELETE FROM public.scenarios WHERE id='f2b00000-0000-4000-8000-000000000001';
COMMIT;
SELECT pg_temp.b2_check('all dependency rollback and fixture cleanup restore original catalogue EXACTLY',
  pg_temp.phase2_catalogue()=(SELECT catalogue FROM b2_original));
SELECT pg_temp.b2_check('fixture cleanup restores original scenario/turn/fact counts',
  (SELECT scenarios=(SELECT count(*) FROM public.scenarios)
    AND turns=(SELECT count(*) FROM public.v5_conversation_turns)
    AND facts=(SELECT count(*) FROM public.v5_handler_facts) FROM b2_original_counts));
SELECT set_config('request.jwt.claims','',false);
\echo 'PASS B2 revision storage/read claims, committed turns, guard refusal and exact rollback'
