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

  
  
  
  
  SELECT id, model_version_mutation_id, model_version_created
    INTO v_existing_turn_id, v_turn_version_mutation_id, v_turn_version_created
    FROM public.v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
  v_turn_preexisting := FOUND;

  
  
  
  
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
$function$
