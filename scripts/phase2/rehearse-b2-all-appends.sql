-- Disposable, quiescent LOCAL schema/data copy only, with deployed v4 installed.
-- Creates the missing deployed v1/v2/v3 fixtures before applying dependencies.
-- Commits actual turns and migration steps; failure leaves the copy for inspection.
-- Run from repo root WITHOUT --single-transaction (concurrent sweep index).
-- psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -U postgres -d postgres -f scripts/phase2/rehearse-b2-all-appends.sql
\set ON_ERROR_STOP on
\set AUTOCOMMIT on
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
  IF EXISTS (SELECT 1 FROM public.scenarios WHERE id='f2b10000-0000-4000-8000-000000000001')
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.v5_handler_facts'::regclass
      AND attname='evaluated_scenario_revision' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'B2 all-appends fixture/column already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('append_turn_atomic','append_turn_atomic_v2','append_turn_atomic_v3')) THEN
    RAISE EXCEPTION 'Requires v1/v2/v3 absent before fixture installation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.append_turn_atomic_v4(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint)')
    AND md5(prosrc)='db7bdbe3e2052237c623d8c5477a96e5' AND length(prosrc)=4856) THEN
    RAISE EXCEPTION 'Requires deployed v4 body md5 db7bdbe3e2052237c623d8c5477a96e5, length 4856';
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
\ir fixtures/b2-deployed-append-v1.sql
\ir fixtures/b2-deployed-append-v2.sql
\ir fixtures/b2-deployed-append-v3.sql
CREATE TEMP TABLE b2_expected(name text PRIMARY KEY, signature text, args text, deployed_md5 text, deployed_length integer, modified_md5 text);
INSERT INTO b2_expected VALUES ('append_turn_atomic', 'public.append_turn_atomic(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb)', 'p_scenario_id uuid, p_turn_id text, p_turn_class text, p_handler_id text, p_request_hash text, p_response_emitted boolean, p_llm_calls_used integer, p_duration_ms integer, p_handler_facts jsonb, p_graph jsonb, p_brief_text text, p_pending_actions jsonb, p_coaching_state jsonb', 'ab162e6df5bd6bd28b05aa8a76b843c2', 3085, 'ee04796b07afbcbcbd66c069a79b1dd1');
INSERT INTO b2_expected VALUES ('append_turn_atomic_v2', 'public.append_turn_atomic_v2(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text)', 'p_scenario_id uuid, p_turn_id text, p_turn_class text, p_handler_id text, p_request_hash text, p_response_emitted boolean, p_llm_calls_used integer, p_duration_ms integer, p_handler_facts jsonb, p_graph jsonb, p_brief_text text, p_pending_actions jsonb, p_coaching_state jsonb, p_user_message text, p_assistant_message text', 'f187681b0c7e4bdf3538232f90abc24b', 3190, '293850ef292d67c1c8e9c966722c510f');
INSERT INTO b2_expected VALUES ('append_turn_atomic_v3', 'public.append_turn_atomic_v3(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean)', 'p_scenario_id uuid, p_turn_id text, p_turn_class text, p_handler_id text, p_request_hash text, p_response_emitted boolean, p_llm_calls_used integer, p_duration_ms integer, p_handler_facts jsonb, p_graph jsonb, p_brief_text text, p_pending_actions jsonb, p_coaching_state jsonb, p_user_message text, p_assistant_message text, p_expected_graph_identity_hash text, p_incoming_graph_identity_hash text, p_cas_enforce boolean', 'dbf479de15ee9fd2f7e8cfb980cde1dd', 5060, 'ec17b1ce1f16ca023109b262b1ac3739');

SELECT pg_temp.b2_check('deployed fixture md5/length/args/ACL: '||e.name,
  p.oid IS NOT NULL AND md5(p.prosrc)=e.deployed_md5 AND length(p.prosrc)=e.deployed_length
  AND pg_get_function_identity_arguments(p.oid)=e.args
  AND p.proacl='{postgres=X/postgres,service_role=X/postgres}'::aclitem[])
FROM b2_expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature);
BEGIN;
\ir ../../supabase/migrations/20261009010000_phase2_a_typed_runs.sql
COMMIT;
\ir ../../supabase/migrations/20261009010100_phase2_a_sweep_index.sql
\ir ../../supabase/migrations/20261009040000_phase2_a_legacy_unattributable.sql
\ir ../../supabase/migrations/20261009160000_b2_fact_evaluated_revision.sql
CREATE TEMP TABLE b2_before AS SELECT pg_temp.phase2_catalogue() AS catalogue;
CREATE TEMP TABLE b2_functions AS
  SELECT p.oid,p.proname,p.prosrc,pg_get_functiondef(p.oid) AS definition,
    to_jsonb(p)-'prosrc' AS attributes FROM b2_expected e JOIN pg_proc p ON p.oid=to_regprocedure(e.signature);
-- Read the ACTUAL migration guards, rather than a hand-maintained duplicate.
-- Temporary files are outside the repo and removed after loading the source.
\set b2_source_dir `mktemp -d /private/tmp/b2-all-appends.XXXXXX`
\setenv PHASE2_B2_SINK_DIR :b2_source_dir
\! node --input-type=module -e 'import {readFileSync,writeFileSync} from "node:fs"; const sql=readFileSync("supabase/migrations/20261009170000_b2_fact_revision_all_appends.sql","utf8"); if(sql.includes("$b2_source$")) throw new Error("source delimiter collision"); writeFileSync(process.env.PHASE2_B2_SINK_DIR+"/source.sql","INSERT INTO b2_migration_source VALUES ($b2_source$"+sql+"$b2_source$);\n");'
\if :SHELL_ERROR
  \quit 3
\endif
CREATE TEMP TABLE b2_migration_source(sql text);
\set b2_source_file :b2_source_dir '/source.sql'
\i :b2_source_file
\! node --input-type=module -e 'import {rmSync} from "node:fs"; rmSync(process.env.PHASE2_B2_SINK_DIR,{recursive:true});'
BEGIN;
DO $plants$
DECLARE f record; guard_sql text; refused boolean; count_guards integer := 0;
BEGIN
  FOR f IN SELECT * FROM b2_functions ORDER BY proname LOOP
    SELECT m[1] INTO STRICT guard_sql FROM b2_migration_source,
      LATERAL regexp_matches(sql, '(DO \$guard\$.*?\$guard\$;)', 'gs') m
      WHERE position('public.'||f.proname||'(' IN m[1])>0;
    count_guards := count_guards+1;
    -- Positive control: the unchanged deployed body is accepted first.
    EXECUTE guard_sql;
    EXECUTE replace(f.definition,f.prosrc,f.prosrc||E'\n-- planted md5 mismatch\n');
    refused := false;
    BEGIN
      EXECUTE guard_sql;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'B2 guard refused: public.'||f.proname||' body or identity arguments changed' THEN RAISE; END IF;
      refused := true;
    END;
    PERFORM pg_temp.b2_check('actual migration guard refuses planted md5: '||f.proname,refused);
    EXECUTE f.definition;
    EXECUTE guard_sql;
  END LOOP;
  PERFORM pg_temp.b2_check('all three actual guards exercised',count_guards=3);
END;
$plants$;
ROLLBACK;
\ir ../../supabase/migrations/20261009170000_b2_fact_revision_all_appends.sql
SELECT pg_temp.b2_check('identity/args/owner/ACL/defaults/attributes unchanged: '||f.proname,
  f.attributes=to_jsonb(p)-'prosrc' AND md5(p.prosrc)=e.modified_md5)
FROM b2_functions f JOIN pg_proc p ON p.oid=f.oid JOIN b2_expected e ON e.name=f.proname;
-- Revert only the two fact INSERT additions and hash the resulting prosrc.
SELECT pg_temp.b2_check('only fact INSERT changed; reverted hunk has deployed md5: '||e.name,
  md5(replace(replace(p.prosrc,
    $columns_new$        handler_id, action_type, noop, payload, evaluated_scenario_revision
$columns_new$,
    $columns_old$        handler_id, action_type, noop, payload
$columns_old$),
    $value_new$        COALESCE(v_fact->'payload', '{}'::jsonb),
        CASE WHEN jsonb_typeof(v_fact->'evaluated_scenario_revision') = 'number' THEN
          CASE WHEN (v_fact->>'evaluated_scenario_revision')::numeric >= 0
            AND (v_fact->>'evaluated_scenario_revision')::numeric <= 2147483647
            AND trunc((v_fact->>'evaluated_scenario_revision')::numeric)
              = (v_fact->>'evaluated_scenario_revision')::numeric
          THEN (v_fact->>'evaluated_scenario_revision')::numeric::integer
          ELSE NULL END
        ELSE NULL END$value_new$,
    $value_old$        COALESCE(v_fact->'payload', '{}'::jsonb)$value_old$))=e.deployed_md5)
FROM b2_expected e JOIN pg_proc p ON p.oid=to_regprocedure(e.signature);

-- Compare the whole public catalogue, normalising ONLY the three function bodies.
WITH after_entries AS (SELECT e FROM jsonb_array_elements(pg_temp.phase2_catalogue()) e),
  before_entries AS (SELECT e FROM b2_before, jsonb_array_elements(catalogue) e),
  normalised AS (
    SELECT CASE WHEN a.e->>'kind'='function' AND (a.e->>'id')::oid IN (SELECT oid FROM b2_functions)
      THEN (SELECT b.e FROM before_entries b WHERE b.e->>'kind'=a.e->>'kind' AND b.e->>'id'=a.e->>'id')
      ELSE a.e END AS e FROM after_entries a
  )
SELECT pg_temp.b2_check('catalogue unchanged except the three bodies',
  (SELECT jsonb_agg(e ORDER BY e->>'kind',(e->>'id')::oid) FROM normalised)=(SELECT catalogue FROM b2_before));
SELECT pg_temp.b2_check('no trigger added or changed',
  (SELECT COALESCE(jsonb_agg(e ORDER BY e->>'id'),'[]'::jsonb) FROM jsonb_array_elements(pg_temp.phase2_catalogue()) e WHERE e->>'kind'='trigger')
  =(SELECT COALESCE(jsonb_agg(e ORDER BY e->>'id'),'[]'::jsonb) FROM b2_before,jsonb_array_elements(catalogue) e WHERE e->>'kind'='trigger'));
BEGIN;
INSERT INTO public.scenarios(id,user_id,graph) VALUES ('f2b10000-0000-4000-8000-000000000001',NULL,NULL);
CREATE TEMP TABLE b2_cases(label text PRIMARY KEY, element jsonb NOT NULL, expected integer);
INSERT INTO b2_cases VALUES
  ('prod-demo-no-key','{}',NULL), ('negative','{"evaluated_scenario_revision":-1}',NULL),
  ('fraction','{"evaluated_scenario_revision":1.5}',NULL), ('string','{"evaluated_scenario_revision":"7"}',NULL),
  ('null','{"evaluated_scenario_revision":null}',NULL), ('int-overflow','{"evaluated_scenario_revision":2147483648}',NULL),
  ('zero','{"evaluated_scenario_revision":0}',0), ('seven','{"evaluated_scenario_revision":7}',7),
  ('int-max','{"evaluated_scenario_revision":2147483647}',2147483647);
CREATE TEMP TABLE b2_turns(name text,label text,turn_id text PRIMARY KEY,expected integer,payload jsonb,returned_id uuid);
INSERT INTO b2_turns SELECT e.name,c.label,'b2-sink-'||e.name||'-'||c.label,c.expected,
  jsonb_build_object('fact_type','run_analysis','fact_version',1,'noop',false,'result',
    jsonb_build_object('run_id','b2-sink-'||e.name||'-'||c.label)),NULL
FROM b2_expected e CROSS JOIN b2_cases c;
COMMIT;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
-- Each generated statement autocommits independently; no caught writer failures.
-- Recording the return in a temp table does not wrap the 27 turns in one transaction.
SELECT format('UPDATE b2_turns SET returned_id=public.%I(
  p_scenario_id=>%L::uuid,p_turn_id=>%L,p_turn_class=>''handler'',p_handler_id=>''run_analysis'',
  p_request_hash=>%L,p_response_emitted=>true,p_llm_calls_used=>0,p_duration_ms=>1,
  p_handler_facts=>%L::jsonb) WHERE turn_id=%L;',t.name,
  'f2b10000-0000-4000-8000-000000000001',t.turn_id,t.turn_id,
  jsonb_build_array(c.element||jsonb_build_object('handler_id','run_analysis','action_type','run_analysis','noop',false,'payload',t.payload)),t.turn_id)
FROM b2_turns t JOIN b2_cases c USING(label) ORDER BY t.turn_id
\gexec
SELECT pg_temp.b2_check('turn COMMITTED, revision/null stored and payload unchanged: '||t.turn_id,
  count(h.id)=1 AND bool_and(v.id=t.returned_id AND h.evaluated_scenario_revision IS NOT DISTINCT FROM t.expected AND h.payload=t.payload))
FROM b2_turns t LEFT JOIN public.v5_conversation_turns v ON v.turn_id=t.turn_id
  AND v.scenario_id='f2b10000-0000-4000-8000-000000000001'
LEFT JOIN public.v5_handler_facts h ON h.v5_conversation_turn_id=v.id GROUP BY t.turn_id;
CREATE TEMP TABLE b2_data_before_replay AS SELECT
  (SELECT to_jsonb(s) FROM public.scenarios s WHERE id='f2b10000-0000-4000-8000-000000000001') AS scenario,
  (SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM public.v5_conversation_turns v WHERE scenario_id='f2b10000-0000-4000-8000-000000000001') AS turns,
  (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM public.v5_handler_facts h WHERE scenario_id='f2b10000-0000-4000-8000-000000000001') AS facts;
-- Replay deliberately supplies different graph/brief/pending/coaching/fact values.
SELECT format('SELECT pg_temp.b2_check(%L, public.%I(
  p_scenario_id=>%L::uuid,p_turn_id=>%L,p_turn_class=>''handler'',p_handler_id=>''run_analysis'',
  p_request_hash=>''changed-replay'',p_response_emitted=>false,p_llm_calls_used=>1,p_duration_ms=>2,
  p_handler_facts=>''[{"handler_id":"run_analysis","action_type":"run_analysis","evaluated_scenario_revision":99,"payload":{"changed":true}}]''::jsonb,
  p_graph=>''{"nodes":[],"edges":[]}''::jsonb,p_brief_text=>''changed-replay'',
  p_pending_actions=>''[{"changed":true}]''::jsonb,p_coaching_state=>''{"changed":true}''::jsonb%s)=%L::uuid);',
  'conflict replay returns existing id: '||t.turn_id,t.name,'f2b10000-0000-4000-8000-000000000001',t.turn_id,
  CASE WHEN t.name='append_turn_atomic_v3' THEN ',p_expected_graph_identity_hash=>''stale'',p_incoming_graph_identity_hash=>''changed'',p_cas_enforce=>true' ELSE '' END,t.returned_id)
FROM b2_turns t ORDER BY t.turn_id
\gexec
SELECT pg_temp.b2_check('all replay calls leave scenario/turn/fact rows unchanged',
  scenario=(SELECT to_jsonb(s) FROM public.scenarios s WHERE id='f2b10000-0000-4000-8000-000000000001')
  AND turns=(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM public.v5_conversation_turns v WHERE scenario_id='f2b10000-0000-4000-8000-000000000001')
  AND facts=(SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM public.v5_handler_facts h WHERE scenario_id='f2b10000-0000-4000-8000-000000000001'))
FROM b2_data_before_replay;
\ir ../../supabase/migrations/rollback/20261009170000_b2_fact_revision_all_appends_rollback.sql.do-not-apply
SELECT pg_temp.b2_check('rollback byte-exact definition/MD5/length/attributes: '||f.proname,
  p.prosrc=f.prosrc AND pg_get_functiondef(p.oid)=f.definition AND md5(p.prosrc)=e.deployed_md5
  AND length(p.prosrc)=e.deployed_length AND to_jsonb(p)-'prosrc'=f.attributes)
FROM b2_functions f JOIN pg_proc p ON p.oid=f.oid JOIN b2_expected e ON e.name=f.proname;
SELECT pg_temp.b2_check('sink rollback restores entire catalogue exactly',pg_temp.phase2_catalogue()=(SELECT catalogue FROM b2_before));
\ir ../../supabase/migrations/rollback/20261009160000_b2_fact_evaluated_revision_rollback.sql.do-not-apply
\ir ../../supabase/migrations/rollback/20261009040000_phase2_a_legacy_unattributable_rollback.sql.do-not-apply
\ir ../../supabase/migrations/rollback/20261009010100_phase2_a_sweep_index_rollback.sql.do-not-apply
BEGIN;
\ir ../../supabase/migrations/rollback/20261009010000_phase2_a_typed_runs_rollback.sql.do-not-apply
DELETE FROM public.scenarios WHERE id='f2b10000-0000-4000-8000-000000000001';
-- These fixture-only functions were absent before the rehearsal.
DROP FUNCTION public.append_turn_atomic(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb);
DROP FUNCTION public.append_turn_atomic_v2(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text);
DROP FUNCTION public.append_turn_atomic_v3(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean);
COMMIT;
SELECT pg_temp.b2_check('all dependency rollbacks/fixture cleanup restore original catalogue exactly',
  pg_temp.phase2_catalogue()=(SELECT catalogue FROM b2_original));
SELECT pg_temp.b2_check('fixture cleanup restores original scenario/turn/fact counts',
  (SELECT scenarios=(SELECT count(*) FROM public.scenarios)
    AND turns=(SELECT count(*) FROM public.v5_conversation_turns)
    AND facts=(SELECT count(*) FROM public.v5_handler_facts) FROM b2_original_counts));
SELECT set_config('request.jwt.claims','',false);
\echo 'PASS B2 all-appends: 27 committed turns, replay, actual guard refusal, only INSERT hunk, exact rollback and no trigger'
