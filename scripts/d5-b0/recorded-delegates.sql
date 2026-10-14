-- ============================================================================
-- D5 B0 fixture: the live objects D5-B-MIGRATION.sql calls or touches, recorded for a DISPOSABLE Postgres.
-- NEVER apply this to Supabase. It creates roles, schemas and tables.
--
-- MEASURED: 14 Oct 2026 08:44:41Z–08:47:00Z UTC (DB clock: first read 08:44:41.389926+00, B14 scan 08:46:34.213225+00).
--   Project etmmuzwxtcjipwphdola (shared with production), PostgreSQL 15.8. Read-only SELECTs only:
--   pg_get_functiondef, pg_attribute/pg_attrdef, pg_constraint, pg_index, pg_trigger, pg_class.relacl/proacl,
--   pg_default_acl, pg_roles. Nothing was written.
--
-- FUNCTION BODIES are the live pg_get_functiondef text. The harness proves each one by md5(pg_get_functiondef)
--   after loading (scripts/d5-b0/live-fingerprints.tsv); a transcription slip fails the FIX rows, never passes.
--   Live md5(pg_get_functiondef):
--     append_agent_answer_if_latest            fca6a21cbcd07a2e2f0ec3994ac46485
--     append_agent_answer_if_latest_narrated   a3c05897876e1bf6361e4f1d314e28b6
--     append_agent_answer_narrated             51ea0b3668de63fc8f5c83b9ad00ce8c
--     append_agent_answer_with_offers          d65f9bba4c291c9eef86e1eefafa7194
--     append_agent_answer_with_guidance        fbc87d7d8c9d39b343537206b4af09a9
--     append_turn_atomic_v2                    3f26919033ac076a8888762d179a4f78
--     scenarios_bump_revision (trigger)        3e7ea8689e7b1b46809159eabc7d3f64
--     update_updated_at (trigger)              bc63a00721d3247270efd34cf8aa8531
--     claim_guest_scenario (B0 concurrency)    d7f95c0a4b441c3457fb3bc526cd9b62
--     create_model_version_cas_v1 (B0 conc.)   2efc01760b26f67fd8a92ca193b11f68
--     append_scenario_event (B14 orphan try)   11729bdf39a7d15d1dbcfee2f8c9af88
--     auth.uid                                 ea3b41bf29e2ad573067939329aa088e
--
-- TABLES: every column of scenarios, v5_conversation_turns, v5_handler_facts, scenario_members and
--   model_versions in live order with live defaults; every live constraint, index and trigger on them.
--   RLS is enabled as live (scenarios also FORCED). Row-level POLICIES were NOT recorded: every path tested
--   runs as service_role (BYPASSRLS, live) or inside a SECURITY DEFINER function owned by postgres
--   (BYPASSRLS live; superuser in the container), so no policy is evaluated on a tested path.
-- STUBS (not live copies): roles anon/authenticated/service_role (attributes as live), schema auth,
--   auth.users(id) (claim_guest_scenario checks it). auth.uid() IS the live body.
-- ACLs are set to the live proacl/relacl text; the harness compares them (FIX-ACL rows).
--
-- B14 LIVE SCAN (08:46:34Z): public functions whose source contains 'construction_questions' = 0
--   (contrast 'model_version_created' = 3); D5 names present = 0; construction_questions events = 0.
--   Event writers whose event_type comes from a parameter: append_scenario_event ONLY (authenticated + service_role
--   EXECUTE, owner-only via auth.uid()). It is recorded here because B14 attempts an orphan through it.
-- ============================================================================

-- Roles (cluster-wide in the container; attributes as live: anon/authenticated NOLOGIN, service_role BYPASSRLS).
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END
$roles$;

-- Live default privileges for objects postgres creates in public (pg_default_acl, per-schema entries).
-- They are what makes a fresh CREATE FUNCTION executable by anon/authenticated until the migration's REVOKE.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- auth schema (stub) + the live auth.uid() body.
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables (live columns, order, defaults, constraints)
-- ---------------------------------------------------------------------------
CREATE TABLE public.scenarios (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid DEFAULT auth.uid(),
  title text,
  scenario_schema_version integer NOT NULL DEFAULT 1,
  stage text NOT NULL DEFAULT 'frame'::text,
  graph jsonb,
  framing jsonb,
  analysis_status text NOT NULL DEFAULT 'none'::text,
  analysis jsonb,
  analysis_error jsonb,
  analysis_provenance jsonb,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  event_seq integer NOT NULL DEFAULT 0,
  brief jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  last_turn_nonce integer NOT NULL DEFAULT 0,
  is_pinned boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  source_scenario_id uuid,
  latest_analysis_summary jsonb,
  brief_text text,
  current_model_version_id uuid,
  rolling_summary jsonb,
  graph_identity_hash text,
  analysis_invalidated_at timestamp with time zone,
  revision bigint NOT NULL DEFAULT 0,
  CONSTRAINT scenarios_pkey PRIMARY KEY (id),
  CONSTRAINT scenarios_analysis_status_check CHECK ((analysis_status = ANY (ARRAY['none'::text, 'running'::text, 'ready'::text, 'failed'::text]))),
  CONSTRAINT scenarios_brief_text_length CHECK (((brief_text IS NULL) OR (((char_length(brief_text) >= 1) AND (char_length(brief_text) <= 8000)) AND (brief_text ~ '[^[:space:]]'::text)))),
  CONSTRAINT scenarios_stage_check CHECK ((stage = ANY (ARRAY['frame'::text, 'ideate'::text, 'evaluate'::text, 'decide'::text, 'optimise'::text]))),
  CONSTRAINT scenarios_source_scenario_id_fkey FOREIGN KEY (source_scenario_id) REFERENCES public.scenarios(id) ON DELETE SET NULL
);
CREATE INDEX idx_scenarios_hub_query ON public.scenarios USING btree (user_id, is_archived, is_pinned DESC, updated_at DESC);
CREATE INDEX idx_scenarios_updated_at ON public.scenarios USING btree (updated_at DESC);
CREATE INDEX idx_scenarios_user_id ON public.scenarios USING btree (user_id);
CREATE INDEX idx_scenarios_user_updated ON public.scenarios USING btree (user_id, updated_at DESC);

CREATE TABLE public.model_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  version_number integer NOT NULL,
  graph jsonb NOT NULL,
  graph_identity_hash text NOT NULL,
  hash_algorithm text NOT NULL,
  identity_projection_version text NOT NULL,
  identity_normaliser_version text NOT NULL,
  graph_schema_version text NOT NULL,
  label text,
  provenance text,
  restored_from_version_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  analysis_affecting_hash text,
  mutation_id uuid,
  parent_version_id uuid,
  root_version_id uuid,
  actor_kind text,
  authored_by text,
  creation_kind text,
  source_version_id uuid,
  source_turn_id text,
  CONSTRAINT model_versions_pkey PRIMARY KEY (id),
  CONSTRAINT model_versions_scenario_id_version_number_key UNIQUE (scenario_id, version_number),
  CONSTRAINT model_versions_creation_kind_ck CHECK (((creation_kind IS NULL) OR (creation_kind = ANY (ARRAY['initial'::text, 'committed_mutation'::text, 'restore'::text, 'variant_creation'::text, 'variant_promotion'::text, 'unknown'::text])))),
  CONSTRAINT model_versions_source_turn_nonempty_ck CHECK (((source_turn_id IS NULL) OR (length(source_turn_id) > 0))),
  CONSTRAINT model_versions_actor_consistency_ck CHECK ((((actor_kind IS NULL) AND (authored_by IS NULL)) OR ((actor_kind = 'unknown'::text) AND (authored_by IS NULL)) OR ((actor_kind = 'system'::text) AND (authored_by IS NULL)) OR ((actor_kind = 'known'::text) AND (authored_by IS NOT NULL) AND ((authored_by = ANY (ARRAY['owner'::text, 'assistant'::text])) OR (authored_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'::text))))),
  CONSTRAINT model_versions_scenario_id_fkey FOREIGN KEY (scenario_id) REFERENCES public.scenarios(id) ON DELETE CASCADE,
  CONSTRAINT model_versions_source_version_id_fkey FOREIGN KEY (source_version_id) REFERENCES public.model_versions(id),
  CONSTRAINT model_versions_root_version_id_fkey FOREIGN KEY (root_version_id) REFERENCES public.model_versions(id),
  CONSTRAINT model_versions_restored_from_version_id_fkey FOREIGN KEY (restored_from_version_id) REFERENCES public.model_versions(id),
  CONSTRAINT model_versions_parent_version_id_fkey FOREIGN KEY (parent_version_id) REFERENCES public.model_versions(id)
);
CREATE UNIQUE INDEX model_versions_scenario_source_turn_id_uidx ON public.model_versions USING btree (scenario_id, source_turn_id) WHERE (source_turn_id IS NOT NULL);
CREATE UNIQUE INDEX model_versions_scenario_mutation_id_uidx ON public.model_versions USING btree (scenario_id, mutation_id) WHERE (mutation_id IS NOT NULL);
CREATE INDEX model_versions_scenario_created_idx ON public.model_versions USING btree (scenario_id, created_at DESC);
CREATE INDEX model_versions_scenario_hash_idx ON public.model_versions USING btree (scenario_id, graph_identity_hash);

ALTER TABLE public.scenarios ADD CONSTRAINT scenarios_current_model_version_id_fkey
  FOREIGN KEY (current_model_version_id) REFERENCES public.model_versions(id) ON DELETE SET NULL;

CREATE TABLE public.v5_conversation_turns (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL,
  user_id uuid,
  turn_id text NOT NULL,
  turn_class text NOT NULL,
  handler_id text,
  request_hash text NOT NULL,
  response_emitted boolean NOT NULL DEFAULT true,
  llm_calls_used integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  pending_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  coaching_state jsonb,
  user_message text,
  assistant_message text,
  model_version_mutation_id uuid,
  model_version_created boolean,
  agent_guidance jsonb,
  suggested_actions jsonb,
  suggested_actions_run_key text,
  run_narration jsonb,
  CONSTRAINT v5_conversation_turns_pkey PRIMARY KEY (id),
  CONSTRAINT v5_conversation_turns_scenario_turn_unique UNIQUE (scenario_id, turn_id),
  CONSTRAINT v5_conversation_turns_coaching_state_shape CHECK (((coaching_state IS NULL) OR (jsonb_typeof(coaching_state) = 'object'::text))),
  CONSTRAINT v5_conversation_turns_handler_id_biconditional CHECK (((turn_class = 'handler'::text) = (handler_id IS NOT NULL))),
  CONSTRAINT v5_conversation_turns_pending_actions_shape CHECK (((jsonb_typeof(pending_actions) = 'array'::text) AND (jsonb_array_length(pending_actions) <= 3))),
  CONSTRAINT v5_conversation_turns_turn_class_valid CHECK ((turn_class = ANY (ARRAY['direct_answer'::text, 'clarify'::text, 'handler'::text, 'unhandled'::text]))),
  CONSTRAINT v5_turn_model_version_marker_ck CHECK ((((model_version_mutation_id IS NULL) AND (model_version_created IS NULL)) OR ((model_version_mutation_id IS NOT NULL) AND (model_version_created IS NOT NULL)))),
  CONSTRAINT v5_conversation_turns_scenario_id_fkey FOREIGN KEY (scenario_id) REFERENCES public.scenarios(id) ON DELETE CASCADE
);
ALTER TABLE public.v5_conversation_turns ADD CONSTRAINT v5_conversation_turns_run_narration_shape CHECK (((run_narration IS NULL) OR (
CASE
    WHEN (jsonb_typeof(run_narration) = 'object'::text) THEN ((((run_narration - 'status'::text) - 'run_key'::text) = '{}'::jsonb) AND (jsonb_typeof((run_narration -> 'status'::text)) = 'string'::text) AND ((run_narration ->> 'status'::text) = ANY (ARRAY['pending'::text, 'ready'::text, 'unavailable'::text, 'stale'::text])) AND (jsonb_typeof((run_narration -> 'run_key'::text)) = 'string'::text) AND ((run_narration ->> 'run_key'::text) ~ '^[0-9a-f]{16}$'::text))
    ELSE false
END IS TRUE))) NOT VALID;
CREATE INDEX v5_conversation_turns_scenario_created_idx ON public.v5_conversation_turns USING btree (scenario_id, created_at DESC);
CREATE INDEX v5_conversation_turns_user_created_idx ON public.v5_conversation_turns USING btree (user_id, created_at DESC);

CREATE TABLE public.v5_handler_facts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  v5_conversation_turn_id uuid NOT NULL,
  scenario_id uuid NOT NULL,
  user_id uuid,
  handler_id text NOT NULL,
  action_type text NOT NULL,
  fact_version integer NOT NULL DEFAULT 1,
  noop boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  evaluated_scenario_revision integer,
  CONSTRAINT v5_handler_facts_pkey PRIMARY KEY (id),
  CONSTRAINT v5_handler_facts_evaluated_revision_nonneg CHECK ((evaluated_scenario_revision >= 0)),
  CONSTRAINT v5_handler_facts_scenario_id_fkey FOREIGN KEY (scenario_id) REFERENCES public.scenarios(id) ON DELETE CASCADE,
  CONSTRAINT v5_handler_facts_v5_conversation_turn_id_fkey FOREIGN KEY (v5_conversation_turn_id) REFERENCES public.v5_conversation_turns(id) ON DELETE CASCADE
);
CREATE INDEX analysis_run_facts_sweep_idx ON public.v5_handler_facts USING btree (created_at, id) WHERE ((action_type = 'run_analysis'::text) AND (NOT noop));
CREATE INDEX v5_handler_facts_scenario_handler_idx ON public.v5_handler_facts USING btree (scenario_id, handler_id, created_at DESC);
CREATE INDEX v5_handler_facts_turn_idx ON public.v5_handler_facts USING btree (v5_conversation_turn_id);

CREATE TABLE public.scenario_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'viewer'::text,
  invited_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  revoked_at timestamp with time zone,
  CONSTRAINT scenario_members_pkey PRIMARY KEY (id),
  CONSTRAINT scenario_members_email_check CHECK (((email = lower(btrim(email))) AND (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text))),
  CONSTRAINT scenario_members_role_check CHECK ((role = 'viewer'::text)),
  CONSTRAINT scenario_members_scenario_id_fkey FOREIGN KEY (scenario_id) REFERENCES public.scenarios(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX scenario_members_active_uniq ON public.scenario_members USING btree (scenario_id, email) WHERE (revoked_at IS NULL);
CREATE INDEX scenario_members_email_active ON public.scenario_members USING btree (email) WHERE (revoked_at IS NULL);

ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenarios FORCE ROW LEVEL SECURITY;
ALTER TABLE public.v5_conversation_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v5_handler_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_members ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Functions: live pg_get_functiondef text, verbatim
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;

CREATE OR REPLACE FUNCTION public.scenarios_bump_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE TRIGGER scenarios_bump_revision BEFORE UPDATE ON public.scenarios FOR EACH ROW EXECUTE FUNCTION scenarios_bump_revision();
CREATE TRIGGER scenarios_updated_at BEFORE UPDATE ON public.scenarios FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION public.append_turn_atomic_v2(p_scenario_id uuid, p_turn_id text, p_turn_class text, p_handler_id text, p_request_hash text, p_response_emitted boolean, p_llm_calls_used integer, p_duration_ms integer, p_handler_facts jsonb, p_graph jsonb DEFAULT NULL::jsonb, p_brief_text text DEFAULT NULL::text, p_pending_actions jsonb DEFAULT '[]'::jsonb, p_coaching_state jsonb DEFAULT NULL::jsonb, p_user_message text DEFAULT NULL::text, p_assistant_message text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_turn_id   UUID;
  v_user_id   UUID;
  v_fact      JSONB;
  v_updated   INTEGER;
BEGIN
  SELECT user_id INTO v_user_id FROM scenarios WHERE id = p_scenario_id FOR SHARE;
  -- Use FOUND (set by SELECT INTO) to distinguish "row absent" from
  -- "guest row with user_id IS NULL".
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scenario % not found', p_scenario_id;
  END IF;

  INSERT INTO v5_conversation_turns (
    scenario_id, user_id, turn_id, turn_class, handler_id,
    request_hash, response_emitted, llm_calls_used, duration_ms,
    pending_actions, coaching_state, user_message, assistant_message
  ) VALUES (
    p_scenario_id, v_user_id, p_turn_id, p_turn_class, p_handler_id,
    p_request_hash, p_response_emitted, p_llm_calls_used, p_duration_ms,
    COALESCE(p_pending_actions, '[]'::jsonb), p_coaching_state,
    p_user_message, p_assistant_message
  )
  ON CONFLICT (scenario_id, turn_id) DO NOTHING
  RETURNING id INTO v_turn_id;

  IF NOT FOUND THEN
    -- Conflict replay: deduplicated turn, idempotent return.
    -- Do NOT write p_graph, p_brief_text, p_pending_actions,
    -- p_coaching_state, or the content columns — v5_conversation_turns
    -- and scenarios must not be mutated on retry. This is the
    -- load-bearing idempotency invariant.
    SELECT id INTO v_turn_id
      FROM v5_conversation_turns
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
    RETURN v_turn_id;
  END IF;

  -- New turn inserted. Now write the graph atomically in the same transaction.
  -- Gating on FOUND (above) ensures this block never runs on conflict replay,
  -- preserving the idempotency invariant for graph writes.
  IF p_graph IS NOT NULL THEN
    UPDATE scenarios SET graph = p_graph WHERE id = p_scenario_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      -- Should never happen: step 1 confirmed the scenarios row exists.
      -- Raise so the anomaly surfaces rather than being silently dropped.
      RAISE EXCEPTION 'append_turn_atomic_v2: scenarios row % vanished between SELECT and UPDATE', p_scenario_id;
    END IF;
  END IF;

  IF jsonb_array_length(COALESCE(p_handler_facts, '[]'::jsonb)) > 0 THEN
    FOR v_fact IN SELECT * FROM jsonb_array_elements(p_handler_facts)
    LOOP
      INSERT INTO v5_handler_facts (
        v5_conversation_turn_id, scenario_id, user_id,
        handler_id, action_type, noop, payload, evaluated_scenario_revision
      ) VALUES (
        v_turn_id,
        p_scenario_id,
        v_user_id,
        v_fact->>'handler_id',
        v_fact->>'action_type',
        COALESCE((v_fact->>'noop')::boolean, FALSE),
        COALESCE(v_fact->'payload', '{}'::jsonb),
        CASE WHEN jsonb_typeof(v_fact->'evaluated_scenario_revision') = 'number' THEN
          CASE WHEN (v_fact->>'evaluated_scenario_revision')::numeric >= 0
            AND (v_fact->>'evaluated_scenario_revision')::numeric <= 2147483647
            AND trunc((v_fact->>'evaluated_scenario_revision')::numeric)
              = (v_fact->>'evaluated_scenario_revision')::numeric
          THEN (v_fact->>'evaluated_scenario_revision')::numeric::integer
          ELSE NULL END
        ELSE NULL END
      );
    END LOOP;
  END IF;

  -- V5 Phase 1 brief persistence: write user-supplied brief_text once.
  -- First-write-wins enforced by the WHERE predicate. ROW_COUNT is NOT
  -- checked here — a "no rows updated" outcome means the brief was
  -- already set, which is the intended write-once behaviour.
  IF p_brief_text IS NOT NULL THEN
    UPDATE scenarios
       SET brief_text = p_brief_text,
           updated_at = NOW()
     WHERE id = p_scenario_id
       AND (brief_text IS NULL OR brief_text = '');
  END IF;

  RETURN v_turn_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.append_agent_answer_with_guidance(p_scenario_id uuid, p_turn_id text, p_turn_class text, p_handler_id text, p_request_hash text, p_response_emitted boolean, p_llm_calls_used integer, p_duration_ms integer, p_handler_facts jsonb, p_graph jsonb, p_brief_text text, p_pending_actions jsonb, p_coaching_state jsonb, p_user_message text, p_assistant_message text, p_agent_guidance jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_id UUID;
  v_existing UUID;
  v_existing_hash TEXT;
  v_entry RECORD;
BEGIN
  -- This wrapper may only append a visible Agent answer. It cannot acquire a
  -- graph, handler, brief or pre-dispatch coaching write authority.
  IF p_turn_class IS DISTINCT FROM 'direct_answer' OR p_handler_id IS NOT NULL
    OR p_request_hash IS NULL OR p_request_hash NOT LIKE 'agent_turn:%'
    OR p_turn_id IS NULL OR p_turn_id LIKE '%:claim'
    OR p_response_emitted IS DISTINCT FROM TRUE OR p_graph IS NOT NULL
    OR p_brief_text IS NOT NULL OR p_coaching_state IS NOT NULL
    OR NOT (CASE
      -- 0.79 SD-1: '[]' as before, or the ONE fact a guidance answer may carry: the Run delivery it
      -- showed, in the store's serialised shape (handler_id = action_type = payload.fact_type).
      -- CASE fixes the evaluation order and maps every NULL to FALSE, so NULL and non-arrays still raise.
      WHEN p_handler_facts IS NULL THEN FALSE
      WHEN p_handler_facts = '[]'::jsonb THEN TRUE
      WHEN jsonb_typeof(p_handler_facts) <> 'array' THEN FALSE
      WHEN jsonb_array_length(p_handler_facts) <> 1 THEN FALSE
      WHEN jsonb_typeof(p_handler_facts->0) <> 'object' THEN FALSE
      ELSE COALESCE(
        (p_handler_facts->0->>'handler_id') = 'run_delivery'
        AND (p_handler_facts->0->>'action_type') = 'run_delivery'
        AND jsonb_typeof(p_handler_facts->0->'payload') = 'object'
        AND (p_handler_facts->0->'payload'->>'fact_type') = 'run_delivery', FALSE)
    END) THEN
    RAISE EXCEPTION 'guidance requires a final non-graph Agent answer';
  END IF;
  IF p_agent_guidance IS NULL OR jsonb_typeof(p_agent_guidance) <> 'object'
    OR p_agent_guidance->'version' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(p_agent_guidance->'entries') IS DISTINCT FROM 'object'
    OR (p_agent_guidance - 'version' - 'entries') <> '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid guidance envelope';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_agent_guidance->'entries')) > 3 THEN
    RAISE EXCEPTION 'guidance event cap exceeded';
  END IF;
  FOR v_entry IN SELECT key, value FROM jsonb_each(p_agent_guidance->'entries') LOOP
    IF v_entry.key !~ '^(RC-WIDEN|RC-WHAT-CHANGES|RC-PREMORTEM|RC-COACH-EDITS|RC-STRENGTHEN-ITEM:[0-9a-f]{12})$'
      OR jsonb_typeof(v_entry.value) <> 'object'
      OR jsonb_typeof(v_entry.value->'status') IS DISTINCT FROM 'string'
      OR (v_entry.value->>'status') NOT IN ('offered', 'pressed', 'completed', 'dismissed')
      OR jsonb_typeof(v_entry.value->'state_key_hash') IS DISTINCT FROM 'string'
      OR (v_entry.value->>'state_key_hash') !~ '^[0-9a-f]{12}$'
      OR (v_entry.value - 'status' - 'state_key_hash' - 'variant_id' - 'slot') <> '{}'::jsonb
      OR (v_entry.value ? 'variant_id' AND (
        jsonb_typeof(v_entry.value->'variant_id') IS DISTINCT FROM 'string'
        OR CASE split_part(v_entry.key, ':', 1)
          WHEN 'RC-WIDEN' THEN (v_entry.value->>'variant_id') NOT IN ('W1', 'W2Z', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7')
          WHEN 'RC-WHAT-CHANGES' THEN TRUE
          WHEN 'RC-STRENGTHEN-ITEM' THEN (v_entry.value->>'variant_id') NOT IN ('S1', 'S2', 'S3L', 'S3V')
          WHEN 'RC-PREMORTEM' THEN TRUE
          WHEN 'RC-COACH-EDITS' THEN TRUE
          ELSE TRUE
        END))
      OR (v_entry.value ? 'slot' AND CASE
        WHEN jsonb_typeof(v_entry.value->'slot') = 'number'
          THEN (v_entry.value->>'slot')::numeric NOT IN (1, 2, 3)
        ELSE TRUE
      END) THEN
      RAISE EXCEPTION 'invalid content-free guidance event';
    END IF;
  END LOOP;

  -- Same lock order as the existing appends. All v2 callers take FOR SHARE on
  -- this row; FOR UPDATE serialises insertion with this exact-id existence
  -- check. Thus a concurrent retry can never replace the first answer's events.
  PERFORM 1 FROM public.scenarios WHERE id = p_scenario_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'scenario % not found', p_scenario_id; END IF;
  SELECT id, request_hash INTO v_existing, v_existing_hash FROM public.v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;

  v_id := public.append_turn_atomic_v2(
    p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
    p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
    p_graph, p_brief_text, p_pending_actions, p_coaching_state,
    p_user_message, p_assistant_message
  );
  IF v_existing IS NULL THEN
    UPDATE public.v5_conversation_turns SET agent_guidance = p_agent_guidance
      WHERE id = v_id AND scenario_id = p_scenario_id AND turn_id = p_turn_id
        AND request_hash = p_request_hash;
    IF NOT FOUND THEN RAISE EXCEPTION 'guidance answer row not found'; END IF;
  END IF;
  RETURN jsonb_build_object('id', v_id,
    'replayed_prior_turn', v_existing IS NOT NULL AND v_existing_hash IS NOT DISTINCT FROM p_request_hash,
    'prior_turn_conflict', v_existing IS NOT NULL AND v_existing_hash IS DISTINCT FROM p_request_hash);
END;
$function$;

CREATE OR REPLACE FUNCTION public.append_agent_answer_with_offers(p_scenario_id uuid, p_turn_id text, p_turn_class text, p_handler_id text, p_request_hash text, p_response_emitted boolean, p_llm_calls_used integer, p_duration_ms integer, p_handler_facts jsonb, p_graph jsonb, p_brief_text text, p_pending_actions jsonb, p_coaching_state jsonb, p_user_message text, p_assistant_message text, p_agent_guidance jsonb, p_suggested_actions jsonb, p_suggested_actions_run_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_id UUID;
  v_existing UUID;
  v_existing_hash TEXT;
  v_action JSONB;
  v_receipt JSONB;
BEGIN
  -- The delegate retains authority over handler facts, including parked answer facts.
  IF p_turn_class IS DISTINCT FROM 'direct_answer' OR p_handler_id IS NOT NULL
    OR p_request_hash IS NULL OR p_request_hash NOT LIKE 'agent_turn:%'
    OR p_turn_id IS NULL OR p_turn_id LIKE '%:claim'
    OR p_response_emitted IS DISTINCT FROM TRUE OR p_graph IS NOT NULL
    OR p_brief_text IS NOT NULL OR p_coaching_state IS NOT NULL THEN
    RAISE EXCEPTION 'offers require a final non-graph Agent answer';
  END IF;
  IF jsonb_typeof(p_suggested_actions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid answer offers envelope';
  END IF;
  IF jsonb_array_length(p_suggested_actions) NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION 'answer offers cap exceeded';
  END IF;
  FOR v_action IN SELECT value FROM jsonb_array_elements(p_suggested_actions) LOOP
    IF jsonb_typeof(v_action) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid answer offer';
    END IF;
    IF jsonb_typeof(v_action->'id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_action->'label') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_action->'message') IS DISTINCT FROM 'string'
      OR (v_action - 'id' - 'label' - 'message') <> '{}'::jsonb
      OR (v_action->>'id') !~ '^agent-[a-z0-9-]{1,80}$'
      OR (v_action->>'id') = 'agent-run-analysis'
      OR char_length(v_action->>'label') NOT BETWEEN 1 AND 80
      OR char_length(v_action->>'message') NOT BETWEEN 1 AND 400 THEN
      RAISE EXCEPTION 'invalid plain-text answer offer';
    END IF;
  END LOOP;
  IF p_suggested_actions_run_key IS NOT NULL AND p_suggested_actions_run_key !~ '^[0-9a-f]{16}$' THEN
    RAISE EXCEPTION 'invalid answer offers Run key';
  END IF;

  -- Same lock order as the guidance wrapper; retries never replace the first answer's offers.
  PERFORM 1 FROM public.scenarios WHERE id = p_scenario_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'scenario % not found', p_scenario_id; END IF;
  SELECT id, request_hash INTO v_existing, v_existing_hash FROM public.v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;

  IF p_agent_guidance IS NOT NULL THEN
    v_receipt := public.append_agent_answer_with_guidance(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message, p_agent_guidance
    );
    v_id := (v_receipt->>'id')::uuid;
  ELSE
    v_id := public.append_turn_atomic_v2(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message
    );
  END IF;
  IF v_existing IS NULL THEN
    UPDATE public.v5_conversation_turns SET suggested_actions = p_suggested_actions,
      suggested_actions_run_key = p_suggested_actions_run_key
      WHERE id = v_id AND scenario_id = p_scenario_id AND turn_id = p_turn_id
        AND request_hash = p_request_hash;
    IF NOT FOUND THEN RAISE EXCEPTION 'offers answer row not found'; END IF;
  END IF;
  RETURN jsonb_build_object('id', v_id,
    'replayed_prior_turn', v_existing IS NOT NULL AND v_existing_hash IS NOT DISTINCT FROM p_request_hash,
    'prior_turn_conflict', v_existing IS NOT NULL AND v_existing_hash IS DISTINCT FROM p_request_hash);
END;
$function$;

CREATE OR REPLACE FUNCTION public.append_agent_answer_narrated(p_scenario_id uuid, p_turn_id text, p_turn_class text, p_handler_id text, p_request_hash text, p_response_emitted boolean, p_llm_calls_used integer, p_duration_ms integer, p_handler_facts jsonb, p_graph jsonb, p_brief_text text, p_pending_actions jsonb, p_coaching_state jsonb, p_user_message text, p_assistant_message text, p_agent_guidance jsonb, p_suggested_actions jsonb, p_suggested_actions_run_key text, p_run_narration jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_id UUID;
  v_existing UUID;
  v_existing_hash TEXT;
  v_receipt JSONB;
BEGIN
  -- Only a visible final Agent answer; no graph, handler, brief or coaching write authority.
  IF p_turn_class IS DISTINCT FROM 'direct_answer' OR p_handler_id IS NOT NULL
    OR p_request_hash IS NULL OR p_request_hash NOT LIKE 'agent_turn:%'
    OR p_turn_id IS NULL OR p_turn_id LIKE '%:claim'
    OR p_response_emitted IS DISTINCT FROM TRUE OR p_graph IS NOT NULL
    OR p_brief_text IS NOT NULL OR p_coaching_state IS NOT NULL THEN
    RAISE EXCEPTION 'narration requires a final non-graph Agent answer';
  END IF;
  IF p_run_narration IS NULL OR jsonb_typeof(p_run_narration) IS DISTINCT FROM 'object'
    OR (p_run_narration - 'status' - 'run_key') <> '{}'::jsonb
    OR jsonb_typeof(p_run_narration->'status') IS DISTINCT FROM 'string'
    OR (p_run_narration->>'status') NOT IN ('pending', 'ready', 'unavailable', 'stale')
    OR jsonb_typeof(p_run_narration->'run_key') IS DISTINCT FROM 'string'
    OR (p_run_narration->>'run_key') !~ '^[0-9a-f]{16}$' THEN
    RAISE EXCEPTION 'invalid answer Run narration';
  END IF;

  -- Same lock order as the wrappers it delegates to; a retry never replaces the first answer's narration.
  PERFORM 1 FROM public.scenarios WHERE id = p_scenario_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'scenario % not found', p_scenario_id; END IF;
  SELECT id, request_hash INTO v_existing, v_existing_hash FROM public.v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;

  -- The existing wrappers keep their own validation and receipts, unchanged.
  IF p_suggested_actions IS NOT NULL THEN
    v_receipt := public.append_agent_answer_with_offers(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message, p_agent_guidance,
      p_suggested_actions, p_suggested_actions_run_key
    );
    v_id := (v_receipt->>'id')::uuid;
  ELSIF p_agent_guidance IS NOT NULL THEN
    v_receipt := public.append_agent_answer_with_guidance(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message, p_agent_guidance
    );
    v_id := (v_receipt->>'id')::uuid;
  ELSE
    v_id := public.append_turn_atomic_v2(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message
    );
    v_receipt := jsonb_build_object('id', v_id,
      'replayed_prior_turn', v_existing IS NOT NULL AND v_existing_hash IS NOT DISTINCT FROM p_request_hash,
      'prior_turn_conflict', v_existing IS NOT NULL AND v_existing_hash IS DISTINCT FROM p_request_hash);
  END IF;
  IF v_existing IS NULL THEN
    UPDATE public.v5_conversation_turns SET run_narration = p_run_narration
      WHERE id = v_id AND scenario_id = p_scenario_id AND turn_id = p_turn_id
        AND request_hash = p_request_hash;
    IF NOT FOUND THEN RAISE EXCEPTION 'narration answer row not found'; END IF;
  END IF;
  RETURN v_receipt;
END;
$function$;

CREATE OR REPLACE FUNCTION public.append_agent_answer_if_latest(p_expected_latest_row_id uuid, p_scenario_id uuid, p_turn_id text, p_turn_class text, p_handler_id text, p_request_hash text, p_response_emitted boolean, p_llm_calls_used integer, p_duration_ms integer, p_handler_facts jsonb, p_graph jsonb, p_brief_text text, p_pending_actions jsonb, p_coaching_state jsonb, p_user_message text, p_assistant_message text, p_agent_guidance jsonb, p_suggested_actions jsonb, p_suggested_actions_run_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_latest UUID;
BEGIN
  IF p_turn_class IS DISTINCT FROM 'direct_answer' OR p_handler_id IS NOT NULL
    OR p_request_hash IS NULL OR p_request_hash NOT LIKE 'agent_turn:%'
    OR p_turn_id IS NULL OR p_turn_id LIKE '%:claim'
    OR p_response_emitted IS DISTINCT FROM TRUE OR p_graph IS NOT NULL
    OR p_brief_text IS NOT NULL OR p_coaching_state IS NOT NULL THEN
    RAISE EXCEPTION 'conditional append requires a final non-graph Agent answer';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_scenario_id::text, 0));
  SELECT id INTO v_latest FROM public.v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id NOT LIKE '%:claim'
    ORDER BY created_at DESC LIMIT 1;
  IF v_latest IS DISTINCT FROM p_expected_latest_row_id THEN
    RETURN jsonb_build_object('status', 'latest_moved');
  END IF;

  IF p_suggested_actions IS NOT NULL THEN
    RETURN public.append_agent_answer_with_offers(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message, p_agent_guidance,
      p_suggested_actions, p_suggested_actions_run_key
    );
  ELSIF p_agent_guidance IS NOT NULL THEN
    RETURN public.append_agent_answer_with_guidance(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message, p_agent_guidance
    );
  ELSE
    RETURN to_jsonb(public.append_turn_atomic_v2(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message
    ));
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.append_agent_answer_if_latest_narrated(p_expected_latest_row_id uuid, p_scenario_id uuid, p_turn_id text, p_turn_class text, p_handler_id text, p_request_hash text, p_response_emitted boolean, p_llm_calls_used integer, p_duration_ms integer, p_handler_facts jsonb, p_graph jsonb, p_brief_text text, p_pending_actions jsonb, p_coaching_state jsonb, p_user_message text, p_assistant_message text, p_agent_guidance jsonb, p_suggested_actions jsonb, p_suggested_actions_run_key text, p_run_narration jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_latest UUID;
BEGIN
  IF p_turn_class IS DISTINCT FROM 'direct_answer' OR p_handler_id IS NOT NULL
    OR p_request_hash IS NULL OR p_request_hash NOT LIKE 'agent_turn:%'
    OR p_turn_id IS NULL OR p_turn_id LIKE '%:claim'
    OR p_response_emitted IS DISTINCT FROM TRUE OR p_graph IS NOT NULL
    OR p_brief_text IS NOT NULL OR p_coaching_state IS NOT NULL THEN
    RAISE EXCEPTION 'conditional append requires a final non-graph Agent answer';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_scenario_id::text, 0));
  SELECT id INTO v_latest FROM public.v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id NOT LIKE '%:claim'
    ORDER BY created_at DESC LIMIT 1;
  IF v_latest IS DISTINCT FROM p_expected_latest_row_id THEN
    RETURN jsonb_build_object('status', 'latest_moved');
  END IF;

  RETURN public.append_agent_answer_narrated(
    p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
    p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
    p_graph, p_brief_text, p_pending_actions, p_coaching_state,
    p_user_message, p_assistant_message, p_agent_guidance,
    p_suggested_actions, p_suggested_actions_run_key, p_run_narration
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_guest_scenario(p_scenario_id uuid, p_user_id uuid, p_event_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_owner          UUID;
  v_turns_updated  INTEGER := 0;
  v_facts_updated  INTEGER := 0;
  v_event_id       TEXT;
  v_events         JSONB;
  v_new_seq        INTEGER;
  v_existing_event JSONB;
  v_event          JSONB;
BEGIN
  -- Parameter guards — value-level (the fixup-2 lesson from
  -- decision_records: a buggy service-role call must fail typed here,
  -- not half-apply).
  IF p_scenario_id IS NULL THEN
    RAISE EXCEPTION 'claim_guest_scenario: p_scenario_id is required'
      USING ERRCODE = '22023'; -- invalid_parameter_value
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'claim_guest_scenario: p_user_id is required'
      USING ERRCODE = '22023';
  END IF;
  -- scenarios.user_id lost its FK to auth.users in 20260422000000 (guest
  -- relaxation), so this EXISTS check is the ONLY thing preventing a
  -- buggy caller from stamping an id that can never authenticate —
  -- which would orphan the row *differently* (owned-by-nobody-real,
  -- unreachable via RLS forever, and no longer claimable).
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'claim_guest_scenario: p_user_id % is not a known auth user', p_user_id
      USING ERRCODE = '22023';
  END IF;

  -- Row lock: serialises concurrent claims of the same scenario (second
  -- claimer blocks, then sees the stamped owner and takes the replay or
  -- GC409 branch below). FOUND distinguishes "row absent" from "guest
  -- row with user_id IS NULL" (the 20260422000000 lesson). events /
  -- event_seq are read here too — single read, under the same lock —
  -- for the journey-event append: the lock is held to commit and the
  -- claim UPDATE below touches neither column, so the values stay
  -- authoritative (pre-execution amendment, see header CHANGELOG).
  SELECT user_id, events, event_seq + 1
    INTO v_owner, v_events, v_new_seq
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim_guest_scenario: scenario % not found', p_scenario_id
      USING ERRCODE = 'GC404';
  END IF;

  IF v_owner IS NOT NULL THEN
    IF v_owner = p_user_id THEN
      -- Idempotent replay: this user already owns the row (retry after a
      -- lost response, double-submit, second device). The journey event
      -- already exists — but the denormalisation UPDATEs MUST re-run:
      -- an append_turn_atomic reading scenarios with a plain SELECT (no
      -- lock) while the original claim committed can have appended
      -- NULL-stamped turn/fact rows AFTER the claim's UPDATEs ran —
      -- invisible to the new owner's RLS reads. Re-running the two
      -- idempotent, claim-pinned UPDATEs here (still under this claim's
      -- row lock) makes any retry a repair (review fixup 1, 2026-07-10).
      -- The race itself is closed at source by the same-batch companion
      -- 20260711000000_v5_append_turn_atomic_for_share.sql; this branch
      -- stays as belt-and-braces.
      UPDATE public.v5_conversation_turns
        SET user_id = p_user_id
        WHERE scenario_id = p_scenario_id AND user_id IS NULL;
      GET DIAGNOSTICS v_turns_updated = ROW_COUNT;

      UPDATE public.v5_handler_facts
        SET user_id = p_user_id
        WHERE scenario_id = p_scenario_id AND user_id IS NULL;
      GET DIAGNOSTICS v_facts_updated = ROW_COUNT;

      RETURN jsonb_build_object(
        'claimed',       false,
        'already_owned', true,
        'turns_updated', v_turns_updated,
        'facts_updated', v_facts_updated,
        'event_id',      NULL
      );
    END IF;
    RAISE EXCEPTION 'claim_guest_scenario: scenario % is already owned by a different user', p_scenario_id
      USING ERRCODE = 'GC409';
  END IF;

  -- The claim. All three surfaces in one transaction (this function body).
  UPDATE public.scenarios
    SET user_id    = p_user_id,
        updated_at = now()
    WHERE id = p_scenario_id;

  -- Denormalised copies: scenario-scoped, NULL-only. The `user_id IS NULL`
  -- predicate pins the statement to "claim", never "reassign". NOTE: this
  -- row lock alone does NOT close the append race — an append_turn_atomic
  -- reading scenarios with a plain SELECT (no FOR SHARE) could commit
  -- NULL-stamped turn/fact rows after these UPDATEs run. That race is
  -- closed at its source by the same-batch companion migration
  -- 20260711000000_v5_append_turn_atomic_for_share.sql (the append read
  -- becomes FOR SHARE and serialises against this FOR UPDATE); the
  -- same-user replay branch above re-runs both UPDATEs as belt-and-braces
  -- (per the 2026-07-10 review).
  UPDATE public.v5_conversation_turns
    SET user_id = p_user_id
    WHERE scenario_id = p_scenario_id AND user_id IS NULL;
  GET DIAGNOSTICS v_turns_updated = ROW_COUNT;

  UPDATE public.v5_handler_facts
    SET user_id = p_user_id
    WHERE scenario_id = p_scenario_id AND user_id IS NULL;
  GET DIAGNOSTICS v_facts_updated = ROW_COUNT;

  -- Journey event — same shape the existing Journey tab renders (the
  -- decision_records precedent). Deterministic default id: a scenario is
  -- claimable exactly once, so one event per scenario is the invariant.
  -- A caller-supplied p_event_id colliding with an existing event for a
  -- DIFFERENT claim target is a caller bug — 22023, never a silent skip
  -- that returns the colliding id as if it were this claim's.
  v_event_id := COALESCE(p_event_id, 'guest_claimed_' || p_scenario_id::text);
  SELECT e INTO v_existing_event
    FROM jsonb_array_elements(COALESCE(v_events, '[]'::jsonb)) AS e
    WHERE e->>'event_id' = v_event_id;
  IF FOUND AND (v_existing_event->'details'->>'claimed_user_id') IS DISTINCT FROM p_user_id::text THEN
    RAISE EXCEPTION 'claim_guest_scenario: p_event_id % collides with an existing journey event for a different claim', v_event_id
      USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND THEN
    v_event := jsonb_build_object(
      'event_id',   v_event_id,
      'event_type', 'guest_claimed',
      'seq',        v_new_seq,
      'timestamp',  to_jsonb(now()),
      'details',    jsonb_build_object(
                      'claimed_user_id', p_user_id,
                      'turns_updated',   v_turns_updated,
                      'facts_updated',   v_facts_updated
                    )
    );
    UPDATE public.scenarios
      SET events    = COALESCE(events, '[]'::jsonb) || jsonb_build_array(v_event),
          event_seq = v_new_seq
      WHERE id = p_scenario_id;
  ELSE
    v_event_id := NULL; -- pre-existing event (idempotent path): report no new append
  END IF;

  RETURN jsonb_build_object(
    'claimed',       true,
    'already_owned', false,
    'turns_updated', v_turns_updated,
    'facts_updated', v_facts_updated,
    'event_id',      v_event_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_model_version_cas_v1(p_scenario_id uuid, p_graph jsonb, p_graph_identity_hash text, p_projection_version text, p_normaliser_version text, p_graph_schema_version text, p_hash_algorithm text, p_label text, p_provenance text, p_event_id text, p_expected_graph_identity_hash text, p_base_known boolean, p_expected_head_version_id uuid, p_expected_working_graph_identity_hash text, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_revision BIGINT;
  v_working_graph JSONB;
  v_working_identity_hash TEXT;
  v_owner        UUID;
  v_head_id      UUID;
  v_head         public.model_versions%ROWTYPE;
  v_next_number  INTEGER;
  v_new_id       UUID;
  v_event_id     TEXT;
  v_new_seq      INTEGER;
  v_event        JSONB;
  v_events       JSONB;
BEGIN
  -- Parameter guards. A NULL graph must never create a version (contrast
  -- the store_draft_graph unconditional-UPDATE lesson).
  IF p_graph IS NULL THEN
    RAISE EXCEPTION 'create_model_version_cas_v1: p_graph must not be null'
      USING ERRCODE = '22023'; -- invalid_parameter_value
  END IF;
  IF p_graph_identity_hash IS NULL OR p_graph_identity_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'create_model_version_cas_v1: p_graph_identity_hash must be 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_projection_version IS NULL OR p_normaliser_version IS NULL
     OR p_graph_schema_version IS NULL OR p_hash_algorithm IS NULL THEN
    RAISE EXCEPTION 'create_model_version_cas_v1: identity envelope version fields must not be null'
      USING ERRCODE = '22023';
  END IF;

  -- Row lock: serialises version_number assignment, CAS evaluation and
  -- pointer movement per scenario. FOUND distinguishes "row absent" from
  -- "guest row with user_id IS NULL".
  SELECT user_id, current_model_version_id, graph, graph_identity_hash, revision
    INTO v_owner, v_head_id, v_working_graph, v_working_identity_hash, v_revision
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_model_version_cas_v1: scenario % not found', p_scenario_id;
  END IF;

  -- D3 Branch A guest refusal — distinct ERRCODE, app maps to the typed
  -- recoverable "version history requires sign-in" error.
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'create_model_version_cas_v1: scenario % has no owner — version history requires sign-in', p_scenario_id
      USING ERRCODE = 'MV001';
  END IF;

  IF p_expected_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION 'create_model_version_cas_v1: revision_conflict'
      USING ERRCODE = 'OLRV1',
            DETAIL = jsonb_build_object(
              'reason', 'revision_conflict',
              'expected', p_expected_revision,
              'current', v_revision
            )::text;
  END IF;

  -- The captured working graph must still be current, even when the saved
  -- head happens to match the incoming target. Never dedupe a stale round pin.
  -- Exact bytes also protect legacy rows whose identity stamp is absent.
  IF p_base_known IS TRUE THEN
    IF p_expected_working_graph_identity_hash IS NULL
       OR p_expected_working_graph_identity_hash IS DISTINCT FROM p_graph_identity_hash
       OR v_working_graph IS DISTINCT FROM p_graph
       OR (v_working_identity_hash IS NOT NULL
           AND v_working_identity_hash IS DISTINCT FROM p_expected_working_graph_identity_hash) THEN
      RAISE EXCEPTION 'create_model_version_cas_v1: working graph moved since the base read'
        USING ERRCODE = 'MV409';
    END IF;
  END IF;

  IF v_head_id IS NOT NULL THEN
    SELECT * INTO v_head FROM public.model_versions WHERE id = v_head_id;
  END IF;

  -- Optional in-transaction CAS against the head version's stored hash.
  IF p_expected_graph_identity_hash IS NOT NULL THEN
    IF v_head_id IS NULL OR v_head.id IS NULL
       OR v_head.graph_identity_hash <> p_expected_graph_identity_hash THEN
      RAISE EXCEPTION 'create_model_version_cas_v1: expected head hash % does not match current head', p_expected_graph_identity_hash
        USING ERRCODE = 'MV409';
    END IF;
  END IF;

  -- Known NULL is a first-version base, not permission to overwrite a head.
  -- Check before dedupe: a moved captured head refuses even a same-target pin.
  IF p_base_known IS TRUE
     AND v_head_id IS DISTINCT FROM p_expected_head_version_id THEN
    RAISE EXCEPTION 'create_model_version_cas_v1: head moved since the base read'
      USING ERRCODE = 'MV409';
  END IF;

  -- No-op dedupe: identical identity envelope at the head → return head.
  IF v_head_id IS NOT NULL AND v_head.id IS NOT NULL
     AND v_head.graph_identity_hash = p_graph_identity_hash
     AND v_head.identity_projection_version = p_projection_version
     AND v_head.identity_normaliser_version = p_normaliser_version
     AND v_head.graph_schema_version = p_graph_schema_version THEN
    RETURN jsonb_build_object(
      'version_id', v_head.id,
      'version_number', v_head.version_number,
      'graph_identity_hash', v_head.graph_identity_hash,
      'deduped', true,
      'event_id', NULL
    );
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_number
    FROM public.model_versions
    WHERE scenario_id = p_scenario_id;

  INSERT INTO public.model_versions (
    scenario_id, owner_user_id, version_number, graph,
    graph_identity_hash, hash_algorithm,
    identity_projection_version, identity_normaliser_version,
    graph_schema_version, label, provenance
  ) VALUES (
    p_scenario_id, v_owner, v_next_number, p_graph,
    p_graph_identity_hash, p_hash_algorithm,
    p_projection_version, p_normaliser_version,
    p_graph_schema_version, p_label, p_provenance
  )
  RETURNING id INTO v_new_id;

  UPDATE public.scenarios
    SET current_model_version_id = v_new_id
    WHERE id = p_scenario_id AND revision = p_expected_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_model_version_cas_v1: revision_conflict'
      USING ERRCODE = 'OLRV1',
            DETAIL = jsonb_build_object('reason', 'revision_conflict',
              'expected', p_expected_revision, 'current', v_revision)::text;
  END IF;

  -- Journey event — same shape append_scenario_event produces, so the
  -- existing Journey tab renders it with zero UI change. Idempotent by
  -- event_id (deterministic default keyed on the new version row id).
  v_event_id := COALESCE(p_event_id, 'model_version_created_' || v_new_id::text);
  SELECT events, event_seq + 1 INTO v_events, v_new_seq
    FROM public.scenarios WHERE id = p_scenario_id;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_events, '[]'::jsonb)) AS e
    WHERE e->>'event_id' = v_event_id
  ) THEN
    v_event := jsonb_build_object(
      'event_id',   v_event_id,
      'event_type', 'model_version_created',
      'seq',        v_new_seq,
      'timestamp',  to_jsonb(now()),
      'details',    jsonb_strip_nulls(jsonb_build_object(
                      'version_id', v_new_id,
                      'version_number', v_next_number,
                      'label', p_label,
                      'provenance', p_provenance
                    )),
      'hashes',     jsonb_build_object(
                      'graph_identity_hash', p_graph_identity_hash,
                      'algorithm', p_hash_algorithm,
                      'projection_version', p_projection_version,
                      'normaliser_version', p_normaliser_version,
                      'graph_schema_version', p_graph_schema_version
                    )
    );
    UPDATE public.scenarios
      SET events    = COALESCE(events, '[]'::jsonb) || jsonb_build_array(v_event),
          event_seq = v_new_seq,
          updated_at = now()
      WHERE id = p_scenario_id;
  END IF;

  RETURN jsonb_build_object(
    'version_id', v_new_id,
    'version_number', v_next_number,
    'graph_identity_hash', p_graph_identity_hash,
    'deduped', false,
    'event_id', v_event_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.append_scenario_event(p_scenario_id uuid, p_event_id text, p_event_type text, p_details jsonb DEFAULT '{}'::jsonb, p_hashes jsonb DEFAULT NULL::jsonb, p_turn_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_scenario   scenarios%ROWTYPE;
  v_new_seq    INTEGER;
  v_event      JSONB;
BEGIN
  SELECT * INTO v_scenario
  FROM scenarios
  WHERE id = p_scenario_id AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scenario not found or not owned by user';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_scenario.events) AS e
    WHERE e->>'event_id' = p_event_id
  ) THEN
    RETURN (
      SELECT e FROM jsonb_array_elements(v_scenario.events) AS e
      WHERE e->>'event_id' = p_event_id
    );
  END IF;

  v_new_seq := v_scenario.event_seq + 1;

  v_event := jsonb_build_object(
    'event_id',   p_event_id,
    'event_type', p_event_type,
    'seq',        v_new_seq,
    'timestamp',  to_jsonb(now()),
    'details',    p_details
  );

  IF p_turn_id IS NOT NULL THEN
    v_event := v_event || jsonb_build_object('turn_id', p_turn_id);
  END IF;
  IF p_hashes IS NOT NULL THEN
    v_event := v_event || jsonb_build_object('hashes', p_hashes);
  END IF;

  UPDATE scenarios
  SET events    = events || jsonb_build_array(v_event),
      event_seq = v_new_seq,
      updated_at = now()
  WHERE id = p_scenario_id;

  RETURN v_event;
END;
$function$;

-- ---------------------------------------------------------------------------
-- ACLs, set to the live proacl / relacl / attacl text
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.append_turn_atomic_v2(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_agent_answer_with_guidance(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_agent_answer_with_offers(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_agent_answer_narrated(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_agent_answer_if_latest(uuid,uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_agent_answer_if_latest_narrated(uuid,uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_guest_scenario(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_model_version_cas_v1(uuid,jsonb,text,text,text,text,text,text,text,text,text,boolean,uuid,text,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_scenario_event(uuid,text,text,jsonb,jsonb,text) FROM PUBLIC, anon;
-- scenarios_bump_revision / update_updated_at keep the default ACL (live: =X, postgres, anon, authenticated, service_role).

REVOKE ALL ON TABLE public.scenarios FROM anon;
REVOKE UPDATE ON TABLE public.scenarios FROM authenticated;
GRANT UPDATE (analysis_error, analysis_status, framing, is_archived, is_pinned, title) ON TABLE public.scenarios TO authenticated;
REVOKE TRUNCATE ON TABLE public.v5_conversation_turns FROM anon, authenticated;
REVOKE TRUNCATE ON TABLE public.v5_handler_facts FROM anon, authenticated;
REVOKE ALL ON TABLE public.scenario_members FROM anon, authenticated;
REVOKE ALL ON TABLE public.model_versions FROM anon, authenticated;
GRANT SELECT ON TABLE public.model_versions TO authenticated;
