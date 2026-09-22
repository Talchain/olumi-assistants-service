
DECLARE
  v_owner        UUID;
  v_head_id      UUID;
  v_head         public.model_versions%ROWTYPE;
  v_target       public.model_versions%ROWTYPE;
  v_next_number  INTEGER;
  v_new_id       UUID;
  v_event_id     TEXT;
  v_new_seq      INTEGER;
  v_event        JSONB;
  v_events       JSONB;
BEGIN
  SELECT user_id, current_model_version_id
    INTO v_owner, v_head_id
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restore_model_version: scenario % not found', p_scenario_id;
  END IF;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'restore_model_version: scenario % has no owner — version history requires sign-in', p_scenario_id
      USING ERRCODE = 'MV001';
  END IF;

  -- Target must exist AND belong to this scenario (cross-scenario restore
  -- is refused with the same not-found code — no existence oracle).
  SELECT * INTO v_target
    FROM public.model_versions
    WHERE id = p_version_id AND scenario_id = p_scenario_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restore_model_version: version % not found for scenario %', p_version_id, p_scenario_id
      USING ERRCODE = 'MV404';
  END IF;

  IF v_head_id IS NOT NULL THEN
    SELECT * INTO v_head FROM public.model_versions WHERE id = v_head_id;
  END IF;

  IF p_expected_graph_identity_hash IS NOT NULL THEN
    IF v_head_id IS NULL OR v_head.id IS NULL
       OR v_head.graph_identity_hash <> p_expected_graph_identity_hash THEN
      RAISE EXCEPTION 'restore_model_version: expected head hash % does not match current head', p_expected_graph_identity_hash
        USING ERRCODE = 'MV409';
    END IF;
  END IF;

  -- Dedupe: head already IS the target state → nothing to restore.
  IF v_head_id IS NOT NULL AND v_head.id IS NOT NULL
     AND v_head.graph_identity_hash = v_target.graph_identity_hash
     AND v_head.identity_projection_version = v_target.identity_projection_version
     AND v_head.identity_normaliser_version = v_target.identity_normaliser_version
     AND v_head.graph_schema_version = v_target.graph_schema_version THEN
    RETURN jsonb_build_object(
      'version_id', v_head.id,
      'version_number', v_head.version_number,
      'graph_identity_hash', v_head.graph_identity_hash,
      'restored_from_version_id', p_version_id,
      'deduped', true,
      'event_id', NULL
    );
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_number
    FROM public.model_versions
    WHERE scenario_id = p_scenario_id;

  -- Byte-copy of the target's graph + identity envelope. Same graph under
  -- the same projection/normaliser versions ⇒ same identity hash, so the
  -- envelope columns are copied verbatim, never recomputed here.
  INSERT INTO public.model_versions (
    scenario_id, owner_user_id, version_number, graph,
    graph_identity_hash, hash_algorithm,
    identity_projection_version, identity_normaliser_version,
    graph_schema_version, label, provenance, restored_from_version_id
  ) VALUES (
    p_scenario_id, v_owner, v_next_number, v_target.graph,
    v_target.graph_identity_hash, v_target.hash_algorithm,
    v_target.identity_projection_version, v_target.identity_normaliser_version,
    v_target.graph_schema_version, p_label, 'restore', p_version_id
  )
  RETURNING id INTO v_new_id;

  UPDATE public.scenarios
    SET current_model_version_id = v_new_id
    WHERE id = p_scenario_id;

  v_event_id := COALESCE(p_event_id, 'model_version_restored_' || v_new_id::text);
  SELECT events, event_seq + 1 INTO v_events, v_new_seq
    FROM public.scenarios WHERE id = p_scenario_id;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_events, '[]'::jsonb)) AS e
    WHERE e->>'event_id' = v_event_id
  ) THEN
    v_event := jsonb_build_object(
      'event_id',   v_event_id,
      'event_type', 'model_version_restored',
      'seq',        v_new_seq,
      'timestamp',  to_jsonb(now()),
      'details',    jsonb_strip_nulls(jsonb_build_object(
                      'version_id', v_new_id,
                      'version_number', v_next_number,
                      'restored_from_version_id', p_version_id,
                      'restored_from_version_number', v_target.version_number,
                      'label', p_label
                    )),
      'hashes',     jsonb_build_object(
                      'graph_identity_hash', v_target.graph_identity_hash,
                      'algorithm', v_target.hash_algorithm,
                      'projection_version', v_target.identity_projection_version,
                      'normaliser_version', v_target.identity_normaliser_version,
                      'graph_schema_version', v_target.graph_schema_version
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
    'graph_identity_hash', v_target.graph_identity_hash,
    'restored_from_version_id', p_version_id,
    'deduped', false,
    'event_id', v_event_id
  );
END;
