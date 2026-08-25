-- ============================================================
-- C8-A — atomic model-version restore/adopt carrier
-- Target: Staging Supabase (NOT EXECUTED by this change)
-- Date authored: 2026-08-24
--
-- Replaces the application-level restore sequence:
--   pre-restore create_model_version
--   -> restore_model_version (version/head/event)
--   -> append_turn_atomic_v3 (working graph)
-- with ONE transaction. A failure can no longer leave a restore version/head
-- recorded while scenarios.graph remains unchanged.
--
-- Authority rules:
--   * the service supplies only graphs it read server-side; route contracts
--     contain no client graph or written hash;
--   * CAS is against scenarios.graph_identity_hash, the working-state
--     authority, never model_versions.current head;
--   * graph_identity_hash and analysis_affecting_hash remain distinct;
--   * p_mutation_id is the idempotency key. Replaying the same mutation for
--     the same source version returns the original receipt without writes;
--   * model_versions stays append-only.
--
-- Execution is Paul-gated. This file has not been run against staging.
-- ============================================================

-- Additive receipt/lineage columns. Legacy rows remain valid and explicitly
-- carry NULL for information that was not captured when they were written.
ALTER TABLE public.model_versions
  ADD COLUMN IF NOT EXISTS analysis_affecting_hash TEXT NULL;

ALTER TABLE public.model_versions
  ADD COLUMN IF NOT EXISTS mutation_id UUID NULL;

ALTER TABLE public.model_versions
  ADD COLUMN IF NOT EXISTS parent_version_id UUID NULL
  REFERENCES public.model_versions(id);

ALTER TABLE public.model_versions
  ADD COLUMN IF NOT EXISTS root_version_id UUID NULL
  REFERENCES public.model_versions(id);

ALTER TABLE public.model_versions
  ADD COLUMN IF NOT EXISTS actor_kind TEXT NULL;

ALTER TABLE public.model_versions
  ADD COLUMN IF NOT EXISTS authored_by TEXT NULL;

ALTER TABLE public.model_versions
  ADD COLUMN IF NOT EXISTS creation_kind TEXT NULL;

ALTER TABLE public.model_versions
  ADD COLUMN IF NOT EXISTS source_version_id UUID NULL
  REFERENCES public.model_versions(id);

ALTER TABLE public.model_versions
  ADD COLUMN IF NOT EXISTS source_turn_id TEXT NULL;

-- The turn row records whether this v5 call intentionally created a version.
-- That durable marker distinguishes a legitimate under-lock no-op replay from
-- an owned turn whose version write is missing/corrupt.
ALTER TABLE public.v5_conversation_turns
  ADD COLUMN IF NOT EXISTS model_version_mutation_id UUID NULL,
  ADD COLUMN IF NOT EXISTS model_version_created BOOLEAN NULL;

ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS analysis_invalidated_at TIMESTAMPTZ NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'model_versions_actor_consistency_ck'
      AND conrelid = 'public.model_versions'::regclass
  ) THEN
    ALTER TABLE public.model_versions ADD CONSTRAINT model_versions_actor_consistency_ck CHECK (
      (actor_kind IS NULL AND authored_by IS NULL)
      OR (actor_kind = 'unknown' AND authored_by IS NULL)
      OR (actor_kind = 'system' AND authored_by IS NULL)
      OR (actor_kind = 'known' AND authored_by IS NOT NULL AND (
        authored_by IN ('owner', 'assistant')
        OR authored_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      ))
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'model_versions_creation_kind_ck'
      AND conrelid = 'public.model_versions'::regclass
  ) THEN
    ALTER TABLE public.model_versions ADD CONSTRAINT model_versions_creation_kind_ck CHECK (
      creation_kind IS NULL OR creation_kind IN (
        'initial', 'committed_mutation', 'restore',
        'variant_creation', 'variant_promotion', 'unknown'
      )
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'model_versions_source_turn_nonempty_ck'
      AND conrelid = 'public.model_versions'::regclass
  ) THEN
    ALTER TABLE public.model_versions ADD CONSTRAINT model_versions_source_turn_nonempty_ck
      CHECK (source_turn_id IS NULL OR length(source_turn_id) > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'v5_turn_model_version_marker_ck'
      AND conrelid = 'public.v5_conversation_turns'::regclass
  ) THEN
    ALTER TABLE public.v5_conversation_turns
      ADD CONSTRAINT v5_turn_model_version_marker_ck CHECK (
        (model_version_mutation_id IS NULL AND model_version_created IS NULL)
        OR (model_version_mutation_id IS NOT NULL AND model_version_created IS NOT NULL)
      );
  END IF;
END;
$$;

COMMENT ON COLUMN public.model_versions.analysis_affecting_hash IS
  'CEE canonical analysis-affecting hash at this version. Distinct from '
  'graph_identity_hash; NULL means not captured or not computable.';
COMMENT ON COLUMN public.model_versions.mutation_id IS
  'Server mutation/idempotency identity. Unique per scenario when present.';
COMMENT ON COLUMN public.model_versions.parent_version_id IS
  'Immediate lineage parent. For restore rows this is the undo/pre-restore version.';
COMMENT ON COLUMN public.model_versions.root_version_id IS
  'Known lineage root. NULL means ancestry crosses legacy/unknown history.';
COMMENT ON COLUMN public.model_versions.actor_kind IS
  'Explicit producer-attested known/system/unknown actor kind; NULL is legacy unknown.';
COMMENT ON COLUMN public.model_versions.authored_by IS
  'owner, assistant or participant UUID iff actor_kind=known; never inferred.';
COMMENT ON COLUMN public.model_versions.creation_kind IS
  'Explicit version creation mechanism; NULL is legacy unknown.';
COMMENT ON COLUMN public.model_versions.source_version_id IS
  'Explicit restore/variant source version; NULL when not applicable or unknown.';
COMMENT ON COLUMN public.model_versions.source_turn_id IS
  'Canonical source turn identity for committed mutations; NULL when not captured.';
COMMENT ON COLUMN public.v5_conversation_turns.model_version_mutation_id IS
  'C8 atomic append idempotency marker; NULL for turns not admitted through append_turn_atomic_v5.';
COMMENT ON COLUMN public.v5_conversation_turns.model_version_created IS
  'C8 atomic append outcome: false is an intentional guest/no-op no-version result; NULL is legacy/not-v5.';
COMMENT ON COLUMN public.scenarios.analysis_invalidated_at IS
  'DB-stamped chronology guard: analysis facts at/before the latest restore are stale even when hashes match again.';

CREATE UNIQUE INDEX IF NOT EXISTS model_versions_scenario_mutation_id_uidx
  ON public.model_versions (scenario_id, mutation_id)
  WHERE mutation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS model_versions_scenario_source_turn_id_uidx
  ON public.model_versions (scenario_id, source_turn_id)
  WHERE source_turn_id IS NOT NULL;

-- History is append-only to every client-facing database role. The two
-- service-role RPCs below contain INSERTs only; route/static tests pin that no
-- UPDATE or DELETE capability is reintroduced through them.
REVOKE UPDATE, DELETE ON TABLE public.model_versions
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.restore_model_version_atomic_v1(
  p_scenario_id                        UUID,
  p_version_id                         UUID,
  p_mutation_id                        UUID,
  p_graph                              JSONB,
  p_graph_identity_hash                TEXT,
  p_analysis_affecting_hash            TEXT,
  p_projection_version                 TEXT,
  p_normaliser_version                 TEXT,
  p_graph_schema_version               TEXT,
  p_hash_algorithm                     TEXT,
  p_source_graph_identity_hash         TEXT,
  p_current_graph                      JSONB,
  p_current_graph_identity_hash        TEXT,
  p_current_analysis_affecting_hash    TEXT,
  p_expected_graph_identity_hash       TEXT,
  p_actor_kind                         TEXT,
  p_authored_by                        TEXT,
  p_source_turn_id                     TEXT,
  p_label                              TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_owner              UUID;
  v_current_graph      JSONB;
  v_current_hash       TEXT;
  v_head_id            UUID;
  v_head               public.model_versions%ROWTYPE;
  v_target             public.model_versions%ROWTYPE;
  v_existing           public.model_versions%ROWTYPE;
  v_undo_id            UUID;
  v_undo_root          UUID;
  v_new_id             UUID;
  v_next_number        INTEGER;
  v_event_id           TEXT;
  v_new_seq            INTEGER;
  v_analysis_invalidated_at TIMESTAMPTZ;
  v_events             JSONB;
  v_event              JSONB;
BEGIN
  IF p_mutation_id IS NULL THEN
    RAISE EXCEPTION 'restore_model_version_atomic_v1: p_mutation_id must not be null'
      USING ERRCODE = '22023';
  END IF;
  IF p_graph IS NULL THEN
    RAISE EXCEPTION 'restore_model_version_atomic_v1: p_graph must not be null'
      USING ERRCODE = '22023';
  END IF;
  IF p_current_graph IS NULL AND p_current_graph_identity_hash IS NOT NULL THEN
    RAISE EXCEPTION 'restore_model_version_atomic_v1: current graph/hash pair is inconsistent'
      USING ERRCODE = '22023';
  END IF;
  IF p_graph_identity_hash IS NULL OR p_graph_identity_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'restore_model_version_atomic_v1: p_graph_identity_hash must be 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_source_graph_identity_hash IS NULL OR p_source_graph_identity_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'restore_model_version_atomic_v1: p_source_graph_identity_hash must be 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_expected_graph_identity_hash IS NOT NULL
     AND p_expected_graph_identity_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'restore_model_version_atomic_v1: expected graph hash must be null or 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_current_graph_identity_hash IS NOT NULL
     AND p_current_graph_identity_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'restore_model_version_atomic_v1: current graph hash must be null or 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_analysis_affecting_hash IS NULL
     OR p_analysis_affecting_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'restore_model_version_atomic_v1: analysis hash must be 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_current_analysis_affecting_hash IS NOT NULL
     AND p_current_analysis_affecting_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'restore_model_version_atomic_v1: current analysis hash must be null or 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_projection_version IS NULL OR p_normaliser_version IS NULL
     OR p_graph_schema_version IS NULL OR p_hash_algorithm IS NULL THEN
    RAISE EXCEPTION 'restore_model_version_atomic_v1: identity envelope must be complete'
      USING ERRCODE = '22023';
  END IF;
  IF NOT (
    (p_actor_kind = 'known' AND p_authored_by IS NOT NULL)
    OR (p_actor_kind IN ('system', 'unknown') AND p_authored_by IS NULL)
  ) THEN
    RAISE EXCEPTION 'restore_model_version_atomic_v1: actor carrier is inconsistent'
      USING ERRCODE = '22023';
  END IF;
  IF p_source_turn_id IS NOT NULL AND length(p_source_turn_id) = 0 THEN
    RAISE EXCEPTION 'restore_model_version_atomic_v1: source turn must be null or non-empty'
      USING ERRCODE = '22023';
  END IF;

  -- The single serialisation point for graph, head, undo and event. The exact
  -- working graph and its recorded identity are read under the same lock.
  SELECT user_id, graph, graph_identity_hash, current_model_version_id, events,
         event_seq, analysis_invalidated_at
    INTO v_owner, v_current_graph, v_current_hash, v_head_id, v_events,
         v_new_seq, v_analysis_invalidated_at
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restore_model_version_atomic_v1: scenario % not found', p_scenario_id;
  END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'restore_model_version_atomic_v1: version history requires sign-in'
      USING ERRCODE = 'MV001';
  END IF;

  -- Replay is resolved after authorisation and the row lock, but before CAS.
  -- A successful original call may legitimately be retried after later graph
  -- changes; it returns the original operation receipt and performs no writes.
  SELECT * INTO v_existing
    FROM public.model_versions
    WHERE scenario_id = p_scenario_id AND mutation_id = p_mutation_id;
  IF FOUND THEN
    IF v_existing.restored_from_version_id IS DISTINCT FROM p_version_id THEN
      RAISE EXCEPTION 'restore_model_version_atomic_v1: mutation id reused for another target'
        USING ERRCODE = 'MV422';
    END IF;
    RETURN jsonb_build_object(
      'mutation_id', p_mutation_id,
      'version_id', v_existing.id,
      'version_number', v_existing.version_number,
      'graph_identity_hash', v_existing.graph_identity_hash,
      'analysis_affecting_hash', v_existing.analysis_affecting_hash,
      'hash_algorithm', v_existing.hash_algorithm,
      'identity_projection_version', v_existing.identity_projection_version,
      'identity_normaliser_version', v_existing.identity_normaliser_version,
      'graph_schema_version', v_existing.graph_schema_version,
      'restored_from_version_id', v_existing.restored_from_version_id,
      'undo_version_id', v_existing.parent_version_id,
      'parent_version_id', v_existing.parent_version_id,
      'root_version_id', v_existing.root_version_id,
      'actor_kind', v_existing.actor_kind,
      'authored_by', v_existing.authored_by,
      'creation_kind', v_existing.creation_kind,
      'source_version_id', v_existing.source_version_id,
      'source_turn_id', v_existing.source_turn_id,
      'graph', v_existing.graph,
      'deduped', false,
      'replayed', true,
      'analysis_invalidated_at', v_analysis_invalidated_at,
      'event_id', 'model_version_restored_mutation_' || p_mutation_id::text
    );
  END IF;

  SELECT * INTO v_target
    FROM public.model_versions
    WHERE id = p_version_id AND scenario_id = p_scenario_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restore_model_version_atomic_v1: version % not found', p_version_id
      USING ERRCODE = 'MV404';
  END IF;
  IF v_target.graph_identity_hash IS DISTINCT FROM p_source_graph_identity_hash THEN
    RAISE EXCEPTION 'restore_model_version_atomic_v1: source version identity changed'
      USING ERRCODE = 'MV409';
  END IF;

  -- Exact working-state CAS. NULL is a meaningful expected absence; IS
  -- DISTINCT FROM handles both null and non-null cases without a bypass.
  IF v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash
     OR p_current_graph_identity_hash IS DISTINCT FROM p_expected_graph_identity_hash
     OR v_current_graph IS DISTINCT FROM p_current_graph THEN
    RAISE EXCEPTION 'restore_model_version_atomic_v1: stale working graph'
      USING ERRCODE = 'MV409';
  END IF;

  IF v_head_id IS NOT NULL THEN
    SELECT * INTO v_head FROM public.model_versions WHERE id = v_head_id;
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_number
    FROM public.model_versions
    WHERE scenario_id = p_scenario_id;

  -- Reuse the head as undo only when it is the exact working graph under the
  -- current envelope. Otherwise capture the working graph before replacing it.
  IF v_head.id IS NOT NULL
     AND v_head.graph IS NOT DISTINCT FROM v_current_graph
     AND v_head.graph_identity_hash IS NOT DISTINCT FROM v_current_hash
     AND v_head.identity_projection_version = p_projection_version
     AND v_head.identity_normaliser_version = p_normaliser_version
     AND v_head.graph_schema_version = p_graph_schema_version
     AND v_head.hash_algorithm = p_hash_algorithm THEN
    v_undo_id := v_head.id;
    v_undo_root := v_head.root_version_id;
  ELSIF v_current_graph IS NOT NULL AND v_current_hash IS NOT NULL THEN
    v_undo_id := gen_random_uuid();
    v_undo_root := CASE
      WHEN v_head.id IS NULL THEN v_undo_id
      WHEN v_head.root_version_id IS NOT NULL THEN v_head.root_version_id
      ELSE NULL
    END;
    INSERT INTO public.model_versions (
      id, scenario_id, owner_user_id, version_number, graph,
      graph_identity_hash, analysis_affecting_hash, hash_algorithm,
      identity_projection_version, identity_normaliser_version,
      graph_schema_version, label, provenance, parent_version_id,
      root_version_id, actor_kind, authored_by, creation_kind,
      source_version_id, source_turn_id
    ) VALUES (
      v_undo_id, p_scenario_id, v_owner, v_next_number, v_current_graph,
      v_current_hash, p_current_analysis_affecting_hash, p_hash_algorithm,
      p_projection_version, p_normaliser_version,
      p_graph_schema_version, 'Before restore', 'pre_restore', v_head_id,
      v_undo_root, 'system', NULL, 'unknown', NULL, NULL
    );
    v_next_number := v_next_number + 1;
  ELSE
    v_undo_id := NULL;
    v_undo_root := NULL;
  END IF;

  v_new_id := gen_random_uuid();
  INSERT INTO public.model_versions (
    id, scenario_id, owner_user_id, version_number, graph,
    graph_identity_hash, analysis_affecting_hash, hash_algorithm,
    identity_projection_version, identity_normaliser_version,
    graph_schema_version, label, provenance, restored_from_version_id,
    parent_version_id, root_version_id, mutation_id, actor_kind, authored_by,
    creation_kind, source_version_id, source_turn_id
  ) VALUES (
    v_new_id, p_scenario_id, v_owner, v_next_number, p_graph,
    p_graph_identity_hash, p_analysis_affecting_hash, p_hash_algorithm,
    p_projection_version, p_normaliser_version,
    p_graph_schema_version, p_label, 'restore', p_version_id,
    v_undo_id, CASE WHEN v_undo_id IS NULL THEN v_new_id ELSE v_undo_root END, p_mutation_id,
    p_actor_kind, p_authored_by, 'restore', p_version_id, p_source_turn_id
  );

  v_event_id := 'model_version_restored_mutation_' || p_mutation_id::text;
  v_new_seq := COALESCE(v_new_seq, 0) + 1;
  v_event := jsonb_build_object(
    'event_id', v_event_id,
    'event_type', 'model_version_restored',
    'seq', v_new_seq,
    'timestamp', to_jsonb(now()),
    'details', jsonb_strip_nulls(jsonb_build_object(
      'mutation_id', p_mutation_id,
      'version_id', v_new_id,
      'version_number', v_next_number,
      'restored_from_version_id', p_version_id,
      'undo_version_id', v_undo_id,
      'actor_kind', p_actor_kind,
      'authored_by', p_authored_by,
      'label', p_label
    )),
    'hashes', jsonb_strip_nulls(jsonb_build_object(
      'graph_identity_hash', p_graph_identity_hash,
      'analysis_affecting_hash', p_analysis_affecting_hash,
      'algorithm', p_hash_algorithm,
      'projection_version', p_projection_version,
      'normaliser_version', p_normaliser_version,
      'graph_schema_version', p_graph_schema_version
    ))
  );

  v_analysis_invalidated_at := now();

  -- The only working-state UPDATE: graph, full identity, version head and
  -- event become visible together or the function transaction rolls back.
  UPDATE public.scenarios
    SET graph = p_graph,
        graph_identity_hash = p_graph_identity_hash,
        current_model_version_id = v_new_id,
        analysis_invalidated_at = v_analysis_invalidated_at,
        events = COALESCE(v_events, '[]'::jsonb) || jsonb_build_array(v_event),
        event_seq = v_new_seq,
        updated_at = now()
    WHERE id = p_scenario_id;

  RETURN jsonb_build_object(
    'mutation_id', p_mutation_id,
    'version_id', v_new_id,
    'version_number', v_next_number,
    'graph_identity_hash', p_graph_identity_hash,
    'analysis_affecting_hash', p_analysis_affecting_hash,
    'hash_algorithm', p_hash_algorithm,
    'identity_projection_version', p_projection_version,
    'identity_normaliser_version', p_normaliser_version,
    'graph_schema_version', p_graph_schema_version,
    'restored_from_version_id', p_version_id,
    'undo_version_id', v_undo_id,
    'parent_version_id', v_undo_id,
    'root_version_id', CASE WHEN v_undo_id IS NULL THEN v_new_id ELSE v_undo_root END,
    'actor_kind', p_actor_kind,
    'authored_by', p_authored_by,
    'creation_kind', 'restore',
    'source_version_id', p_version_id,
    'source_turn_id', p_source_turn_id,
    'graph', p_graph,
    'deduped', false,
    'replayed', false,
    'analysis_invalidated_at', v_analysis_invalidated_at,
    'event_id', v_event_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restore_model_version_atomic_v1(
  UUID, UUID, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.restore_model_version_atomic_v1(
  UUID, UUID, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

-- C8-A canonical accepted-mutation append. This is deliberately a distinct
-- name: deploying app code before this migration fails closed instead of
-- falling back to a split turn/version sequence.
CREATE OR REPLACE FUNCTION public.append_turn_atomic_v5(
  p_scenario_id                  UUID,
  p_turn_id                      TEXT,
  p_turn_class                   TEXT,
  p_handler_id                   TEXT,
  p_request_hash                 TEXT,
  p_response_emitted             BOOLEAN,
  p_llm_calls_used               INTEGER,
  p_duration_ms                  INTEGER,
  p_handler_facts                JSONB,
  p_graph                        JSONB,
  p_brief_text                   TEXT,
  p_pending_actions              JSONB,
  p_coaching_state               JSONB,
  p_user_message                 TEXT,
  p_assistant_message            TEXT,
  p_expected_graph_identity_hash TEXT,
  p_incoming_graph_identity_hash TEXT,
  p_cas_enforce                  BOOLEAN,
  p_fence_generation             BIGINT,
  p_version_mutation_id          UUID,
  p_version_analysis_affecting_hash TEXT,
  p_version_hash_algorithm       TEXT,
  p_version_projection_version   TEXT,
  p_version_normaliser_version   TEXT,
  p_version_graph_schema_version TEXT,
  p_version_actor_kind           TEXT,
  p_version_authored_by          TEXT,
  p_version_creation_kind        TEXT,
  p_version_source_turn_id       TEXT,
  -- Does the caller actually KNOW the expected base, or is it simply not
  -- instrumented on this path? SQL NULL cannot answer that, and conflating the
  -- two is the defect below. DEFAULT FALSE so every existing caller — and the
  -- C4 oracle's N1a/N1b/N2 pins — keep the pure-delegation behaviour they pin.
  p_expected_base_known          BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_turn_id             UUID;
  v_existing_turn_id    UUID;
  v_turn_preexisting    BOOLEAN;
  v_user_id             UUID;
  v_current_hash        TEXT;
  v_head_id             UUID;
  v_head_root           UUID;
  v_has_versions        BOOLEAN;
  v_should_create       BOOLEAN;
  v_turn_version_mutation_id UUID;
  v_turn_version_created BOOLEAN;
  v_events              JSONB;
  v_event_seq           INTEGER;
  v_updated             INTEGER;
  v_version             public.model_versions%ROWTYPE;
  v_version_id          UUID;
  v_version_number      INTEGER;
  v_root_id             UUID;
  v_creation_kind       TEXT;
  v_event_id            TEXT;
  v_event               JSONB;
BEGIN
  IF p_graph IS NULL OR p_version_mutation_id IS NULL THEN
    RAISE EXCEPTION 'append_turn_atomic_v5: graph and mutation id are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_incoming_graph_identity_hash IS NULL
     OR p_incoming_graph_identity_hash !~ '^[0-9a-f]{64}$'
     OR p_version_analysis_affecting_hash IS NULL
     OR p_version_analysis_affecting_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'append_turn_atomic_v5: both durable hashes must be 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_version_source_turn_id IS DISTINCT FROM p_turn_id
     OR p_version_creation_kind <> 'committed_mutation' THEN
    RAISE EXCEPTION 'append_turn_atomic_v5: creation/source turn carrier mismatch'
      USING ERRCODE = '22023';
  END IF;
  IF NOT (
    (p_version_actor_kind = 'known' AND p_version_authored_by IS NOT NULL)
    OR (p_version_actor_kind IN ('system', 'unknown') AND p_version_authored_by IS NULL)
  ) THEN
    RAISE EXCEPTION 'append_turn_atomic_v5: actor carrier is inconsistent'
      USING ERRCODE = '22023';
  END IF;

  -- Capture only the version-composition state under the scenario lock. The
  -- canonical turn/fence/CAS/graph/facts/brief authority remains v4 below;
  -- this read exists solely so v5 can decide and compose the version in the
  -- same transaction from the pre-write head and identities.
  SELECT user_id, graph_identity_hash, current_model_version_id, events, event_seq
    INTO v_user_id, v_current_hash, v_head_id, v_events, v_event_seq
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'append_turn_atomic_v5: scenario % not found', p_scenario_id;
  END IF;
  v_should_create := v_user_id IS NOT NULL
    AND v_current_hash IS DISTINCT FROM p_incoming_graph_identity_hash;

  -- ── NULL-SAFE CAS FOR A *KNOWN* EXPECTED BASE ──────────────────────────────
  -- v4 remains the canonical CAS and is not touched. This guard covers the one
  -- case v4 structurally CANNOT express, because its predicate is guarded by
  --     p_expected_graph_identity_hash IS NOT NULL AND v_current_hash IS NOT NULL
  -- (20260806120000_v5_turn_fence_first_write_exemption.sql:308-312). Those two
  -- guards are correct for v4, whose expected-hash parameter DEFAULTS to NULL
  -- and therefore genuinely means "no expectation supplied". They are wrong for
  -- a caller that READ the base and found it ABSENT: on a legacy scenario whose
  -- scenarios.graph_identity_hash is NULL, every concurrent writer reads
  -- expected = NULL at turn start, sends NULL, the first guard short-circuits,
  -- and NO CAS RUNS FOR ANY OF THEM. They serialise on the row lock and
  -- silently overwrite one another — a lost update with no conflict raised.
  --
  -- `p_expected_base_known` is the missing fact, not a second CAS: it says
  -- whether NULL means "known-absent" (enforce) or "not instrumented" (defer to
  -- v4, exactly as before). `IS DISTINCT FROM` is null-safe on both sides, so
  -- known-absent → known-absent matches and known-absent → moved conflicts.
  --
  -- This is the SAME semantics restore_model_version_atomic_v1 already states in
  -- this very migration ("NULL is a meaningful expected absence; IS DISTINCT
  -- FROM handles both null and non-null cases without a bypass"). Restore had
  -- it; append did not. One concept, two paths, opposite null handling.
  --
  -- The final conjunct preserves v4's idempotent-replay exemption: when the
  -- incoming graph ALREADY equals the current one, re-sending it is a replay,
  -- not a conflict. p_incoming_graph_identity_hash is required 64-hex above, so
  -- it is never NULL here.
  -- ⚠ THE FIRST-WRITE EXEMPTION IS PRESERVED, DELIBERATELY. v4's second guard
  -- (`v_current_hash IS NOT NULL`) is not only a bypass — it is also the
  -- exemption the migration NAMED AFTER IT exists to provide
  -- (20260806120000_v5_turn_fence_FIRST_WRITE_EXEMPTION). A legacy row whose
  -- graph EXISTS but whose graph_identity_hash column was never stamped reads
  -- `current = NULL` while the caller legitimately supplies a recomputed
  -- `expected = <hash>`. Refusing that is not conflict detection, it is
  -- bricking every unstamped scenario on its next turn — the exact "Cut 1"
  -- failure `validators/numeric-bounds.ts` records paying for once already.
  --
  -- So this guard adds EXACTLY ONE enforcement over v4 — `expected IS NULL AND
  -- current IS NOT NULL` — which is precisely the lost update and nothing else:
  --
  --   expected NULL,  current NULL   -> match      (first writer proceeds)
  --   expected NULL,  current SET    -> CONFLICT   <- the lost update, caught
  --   expected SET,   current NULL   -> exempt     (unstamped legacy row)
  --   expected h1,    current h2     -> CONFLICT   (v4 catches this too)
  --   expected h,     current h      -> match
  --
  -- Two concurrent writers on an unstamped scenario both read expected = NULL.
  -- They serialise on the FOR UPDATE above: the first sees current NULL and
  -- commits, stamping the hash; the second then sees current SET against its
  -- NULL expectation and is refused. That is the race closed.
  IF p_cas_enforce
     AND p_expected_base_known
     AND v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash
     AND p_incoming_graph_identity_hash IS DISTINCT FROM v_current_hash
     AND NOT (v_current_hash IS NULL AND p_expected_graph_identity_hash IS NOT NULL)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'OLGC1',
      MESSAGE = format(
        'append_turn_atomic_v5: stale graph write for scenario %s (expected %s, current %s)',
        p_scenario_id,
        COALESCE(p_expected_graph_identity_hash, '<absent>'),
        COALESCE(v_current_hash, '<absent>'));
  END IF;

  -- Remember whether this was already a durable turn before delegating. v4
  -- decides replay first and returns that row without any side effect; this
  -- marker lets v5 distinguish that replay from the new NULL-marker row v4
  -- inserts for us in this transaction.
  SELECT id, model_version_mutation_id, model_version_created
    INTO v_existing_turn_id, v_turn_version_mutation_id, v_turn_version_created
    FROM public.v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
  v_turn_preexisting := FOUND;

  -- ONE turn authority. The nested call shares this transaction: if version,
  -- head or event composition below fails, v4's turn/graph/facts/brief writes
  -- roll back with it. p_cas_enforce and every nullable CAS case are therefore
  -- exactly v4's semantics, not a second approximation in v5.
  v_turn_id := public.append_turn_atomic_v4(
    p_scenario_id,
    p_turn_id,
    p_turn_class,
    p_handler_id,
    p_request_hash,
    p_response_emitted,
    p_llm_calls_used,
    p_duration_ms,
    p_handler_facts,
    p_graph,
    p_brief_text,
    p_pending_actions,
    p_coaching_state,
    p_user_message,
    p_assistant_message,
    p_expected_graph_identity_hash,
    p_incoming_graph_identity_hash,
    p_cas_enforce,
    p_fence_generation
  );

  IF v_turn_preexisting THEN
    IF v_turn_id IS DISTINCT FROM v_existing_turn_id THEN
      RAISE EXCEPTION 'append_turn_atomic_v5: canonical replay returned another turn row'
        USING ERRCODE = 'MV409';
    END IF;
    IF v_turn_version_mutation_id IS DISTINCT FROM p_version_mutation_id THEN
      RAISE EXCEPTION 'append_turn_atomic_v5: turn replay reused with another mutation id'
        USING ERRCODE = 'MV422';
    END IF;
    IF v_turn_version_created = FALSE THEN
      RETURN jsonb_build_object('turn_row_id', v_turn_id, 'model_version_receipt', NULL);
    END IF;
    IF v_turn_version_created IS DISTINCT FROM TRUE OR v_user_id IS NULL THEN
      RAISE EXCEPTION 'append_turn_atomic_v5: turn has an inconsistent version marker'
        USING ERRCODE = 'MV409';
    END IF;
    SELECT * INTO v_version FROM public.model_versions
      WHERE scenario_id = p_scenario_id
        AND mutation_id = p_version_mutation_id
        AND source_turn_id = p_turn_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'append_turn_atomic_v5: committed owned turn has no atomic version receipt'
        USING ERRCODE = 'MV409';
    END IF;
    RETURN jsonb_build_object(
      'turn_row_id', v_turn_id,
      'model_version_receipt', jsonb_build_object(
        'mutation_id', v_version.mutation_id,
        'version_id', v_version.id,
        'version_number', v_version.version_number,
        'graph_identity_hash', v_version.graph_identity_hash,
        'analysis_affecting_hash', v_version.analysis_affecting_hash,
        'hash_algorithm', v_version.hash_algorithm,
        'identity_projection_version', v_version.identity_projection_version,
        'identity_normaliser_version', v_version.identity_normaliser_version,
        'graph_schema_version', v_version.graph_schema_version,
        'actor_kind', v_version.actor_kind,
        'authored_by', v_version.authored_by,
        'creation_kind', v_version.creation_kind,
        'source_version_id', v_version.source_version_id,
        'source_turn_id', v_version.source_turn_id,
        'parent_version_id', v_version.parent_version_id,
        'root_version_id', v_version.root_version_id,
        'undo_version_id', v_version.parent_version_id,
        'graph', v_version.graph,
        'event_id', 'model_version_created_mutation_' || v_version.mutation_id::text
      )
    );
  END IF;

  -- v4 intentionally knows nothing about C8's idempotency marker. Claim the
  -- new row once, after v4 returns, so replays can recover the durable receipt
  -- without duplicating any canonical turn side effect.
  UPDATE public.v5_conversation_turns
    SET model_version_mutation_id = p_version_mutation_id,
        model_version_created = v_should_create
    WHERE id = v_turn_id
      AND scenario_id = p_scenario_id
      AND turn_id = p_turn_id
      AND model_version_mutation_id IS NULL
      AND model_version_created IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'append_turn_atomic_v5: canonical append returned an unclaimable turn row'
      USING ERRCODE = 'MV409';
  END IF;

  -- Guest compatibility and authoritative under-lock no-op suppression: graph,
  -- turn and every ordinary side effect still commit, but there is no durable
  -- version/head/event and replay is pinned by the turn marker above.
  IF NOT v_should_create THEN
    RETURN jsonb_build_object('turn_row_id', v_turn_id, 'model_version_receipt', NULL);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.model_versions WHERE scenario_id = p_scenario_id
  ) INTO v_has_versions;
  IF v_head_id IS NOT NULL THEN
    SELECT root_version_id INTO v_head_root
      FROM public.model_versions WHERE id = v_head_id AND scenario_id = p_scenario_id;
  END IF;
  v_version_id := gen_random_uuid();
  v_root_id := CASE
    WHEN NOT v_has_versions THEN v_version_id
    WHEN v_head_root IS NOT NULL THEN v_head_root
    ELSE NULL
  END;
  v_creation_kind := CASE
    WHEN NOT v_has_versions THEN 'initial'
    ELSE 'committed_mutation'
  END;
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version_number
    FROM public.model_versions WHERE scenario_id = p_scenario_id;

  INSERT INTO public.model_versions (
    id, scenario_id, owner_user_id, version_number, graph,
    graph_identity_hash, analysis_affecting_hash, hash_algorithm,
    identity_projection_version, identity_normaliser_version,
    graph_schema_version, label, provenance, mutation_id,
    parent_version_id, root_version_id, actor_kind, authored_by,
    creation_kind, source_version_id, source_turn_id
  ) VALUES (
    v_version_id, p_scenario_id, v_user_id, v_version_number, p_graph,
    p_incoming_graph_identity_hash, p_version_analysis_affecting_hash,
    p_version_hash_algorithm, p_version_projection_version,
    p_version_normaliser_version, p_version_graph_schema_version,
    'Committed model change', 'commit', p_version_mutation_id,
    v_head_id, v_root_id, p_version_actor_kind, p_version_authored_by,
    v_creation_kind, NULL, p_version_source_turn_id
  );

  v_event_id := 'model_version_created_mutation_' || p_version_mutation_id::text;
  v_event_seq := COALESCE(v_event_seq, 0) + 1;
  v_event := jsonb_build_object(
    'event_id', v_event_id,
    'event_type', 'model_version_created',
    'seq', v_event_seq,
    'timestamp', to_jsonb(now()),
    'details', jsonb_build_object(
      'mutation_id', p_version_mutation_id,
      'version_id', v_version_id,
      'version_number', v_version_number,
      'source_turn_id', p_turn_id,
      'creation_kind', v_creation_kind,
      'parent_version_id', v_head_id,
      'root_version_id', v_root_id,
      'actor_kind', p_version_actor_kind,
      'authored_by', p_version_authored_by
    ),
    'hashes', jsonb_build_object(
      'graph_identity_hash', p_incoming_graph_identity_hash,
      'analysis_affecting_hash', p_version_analysis_affecting_hash,
      'algorithm', p_version_hash_algorithm,
      'projection_version', p_version_projection_version,
      'normaliser_version', p_version_normaliser_version,
      'graph_schema_version', p_version_graph_schema_version
    )
  );
  UPDATE public.scenarios SET
    current_model_version_id = v_version_id,
    events = COALESCE(v_events, '[]'::jsonb) || jsonb_build_array(v_event),
    event_seq = v_event_seq,
    updated_at = NOW()
    WHERE id = p_scenario_id;

  RETURN jsonb_build_object(
    'turn_row_id', v_turn_id,
    'model_version_receipt', jsonb_build_object(
      'mutation_id', p_version_mutation_id,
      'version_id', v_version_id,
      'version_number', v_version_number,
      'graph_identity_hash', p_incoming_graph_identity_hash,
      'analysis_affecting_hash', p_version_analysis_affecting_hash,
      'hash_algorithm', p_version_hash_algorithm,
      'identity_projection_version', p_version_projection_version,
      'identity_normaliser_version', p_version_normaliser_version,
      'graph_schema_version', p_version_graph_schema_version,
      'actor_kind', p_version_actor_kind,
      'authored_by', p_version_authored_by,
      'creation_kind', v_creation_kind,
      'source_version_id', NULL,
      'source_turn_id', p_turn_id,
      'parent_version_id', v_head_id,
      'root_version_id', v_root_id,
      'undo_version_id', v_head_id,
      'graph', p_graph,
      'event_id', v_event_id
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.append_turn_atomic_v5(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB,
  JSONB, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BIGINT,
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.append_turn_atomic_v5(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB,
  JSONB, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BIGINT,
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) TO service_role;
