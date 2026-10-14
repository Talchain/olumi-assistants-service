-- Additive version revision CAS: production keeps both legacy RPCs unchanged.
-- New RPCs require every named argument, including the final expected revision.
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE FUNCTION public.create_model_version_cas_v1(
  p_scenario_id                  UUID,
  p_graph                        JSONB,
  p_graph_identity_hash          TEXT,
  p_projection_version           TEXT,
  p_normaliser_version           TEXT,
  p_graph_schema_version         TEXT,
  p_hash_algorithm               TEXT,
  p_label                        TEXT,
  p_provenance                   TEXT,
  p_event_id                     TEXT,
  p_expected_graph_identity_hash TEXT,
  p_base_known                   BOOLEAN,
  p_expected_head_version_id     UUID,
  p_expected_working_graph_identity_hash TEXT,
  p_expected_revision BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.create_model_version_cas_v1(
  uuid, jsonb, text, text, text, text, text, text, text, text, text, boolean, uuid, text, bigint
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_model_version_cas_v1(
  uuid, jsonb, text, text, text, text, text, text, text, text, text, boolean, uuid, text, bigint
) TO service_role;

CREATE FUNCTION public.restore_model_version_atomic_cas_v1(
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
  p_label                              TEXT,
  p_expected_revision                  BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_revision           BIGINT;
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
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: p_mutation_id must not be null'
      USING ERRCODE = '22023';
  END IF;
  IF p_graph IS NULL THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: p_graph must not be null'
      USING ERRCODE = '22023';
  END IF;
  IF p_current_graph IS NULL AND p_current_graph_identity_hash IS NOT NULL THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: current graph/hash pair is inconsistent'
      USING ERRCODE = '22023';
  END IF;
  IF p_graph_identity_hash IS NULL OR p_graph_identity_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: p_graph_identity_hash must be 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_source_graph_identity_hash IS NULL OR p_source_graph_identity_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: p_source_graph_identity_hash must be 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_expected_graph_identity_hash IS NOT NULL
     AND p_expected_graph_identity_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: expected graph hash must be null or 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_current_graph_identity_hash IS NOT NULL
     AND p_current_graph_identity_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: current graph hash must be null or 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_analysis_affecting_hash IS NULL
     OR p_analysis_affecting_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: analysis hash must be 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_current_analysis_affecting_hash IS NOT NULL
     AND p_current_analysis_affecting_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: current analysis hash must be null or 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_projection_version IS NULL OR p_normaliser_version IS NULL
     OR p_graph_schema_version IS NULL OR p_hash_algorithm IS NULL THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: identity envelope must be complete'
      USING ERRCODE = '22023';
  END IF;
  IF NOT (
    (p_actor_kind = 'known' AND p_authored_by IS NOT NULL)
    OR (p_actor_kind IN ('system', 'unknown') AND p_authored_by IS NULL)
  ) THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: actor carrier is inconsistent'
      USING ERRCODE = '22023';
  END IF;
  IF p_source_turn_id IS NOT NULL AND length(p_source_turn_id) = 0 THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: source turn must be null or non-empty'
      USING ERRCODE = '22023';
  END IF;

  -- The single serialisation point for graph, head, undo and event. The exact
  -- working graph and its recorded identity are read under the same lock.
  SELECT user_id, graph, graph_identity_hash, current_model_version_id, events,
         event_seq, analysis_invalidated_at, revision
    INTO v_owner, v_current_graph, v_current_hash, v_head_id, v_events,
         v_new_seq, v_analysis_invalidated_at, v_revision
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: scenario % not found', p_scenario_id;
  END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: version history requires sign-in'
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
      RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: mutation id reused for another target'
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

  IF p_expected_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: revision_conflict'
      USING ERRCODE = 'OLRV1',
            DETAIL = jsonb_build_object(
              'reason', 'revision_conflict',
              'expected', p_expected_revision,
              'current', v_revision
            )::text;
  END IF;

  SELECT * INTO v_target
    FROM public.model_versions
    WHERE id = p_version_id AND scenario_id = p_scenario_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: version % not found', p_version_id
      USING ERRCODE = 'MV404';
  END IF;
  IF v_target.graph_identity_hash IS DISTINCT FROM p_source_graph_identity_hash THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: source version identity changed'
      USING ERRCODE = 'MV409';
  END IF;

  -- Exact working-state CAS. NULL is a meaningful expected absence; IS
  -- DISTINCT FROM handles both null and non-null cases without a bypass.
  IF v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash
     OR p_current_graph_identity_hash IS DISTINCT FROM p_expected_graph_identity_hash
     OR v_current_graph IS DISTINCT FROM p_current_graph THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: stale working graph'
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
    WHERE id = p_scenario_id AND revision = p_expected_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restore_model_version_atomic_cas_v1: revision_conflict'
      USING ERRCODE = 'OLRV1',
            DETAIL = jsonb_build_object('reason', 'revision_conflict',
              'expected', p_expected_revision, 'current', v_revision)::text;
  END IF;

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

REVOKE ALL ON FUNCTION public.restore_model_version_atomic_cas_v1(
  UUID, UUID, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.restore_model_version_atomic_cas_v1(
  UUID, UUID, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

