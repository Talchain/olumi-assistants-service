
DECLARE
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
    RAISE EXCEPTION 'create_model_version: p_graph must not be null'
      USING ERRCODE = '22023'; -- invalid_parameter_value
  END IF;
  IF p_graph_identity_hash IS NULL OR p_graph_identity_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'create_model_version: p_graph_identity_hash must be 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_projection_version IS NULL OR p_normaliser_version IS NULL
     OR p_graph_schema_version IS NULL OR p_hash_algorithm IS NULL THEN
    RAISE EXCEPTION 'create_model_version: identity envelope version fields must not be null'
      USING ERRCODE = '22023';
  END IF;

  -- Row lock: serialises version_number assignment, CAS evaluation and
  -- pointer movement per scenario. FOUND distinguishes "row absent" from
  -- "guest row with user_id IS NULL".
  SELECT user_id, current_model_version_id
    INTO v_owner, v_head_id
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_model_version: scenario % not found', p_scenario_id;
  END IF;

  -- D3 Branch A guest refusal — distinct ERRCODE, app maps to the typed
  -- recoverable "version history requires sign-in" error.
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'create_model_version: scenario % has no owner — version history requires sign-in', p_scenario_id
      USING ERRCODE = 'MV001';
  END IF;

  IF v_head_id IS NOT NULL THEN
    SELECT * INTO v_head FROM public.model_versions WHERE id = v_head_id;
  END IF;

  -- Optional in-transaction CAS against the head version's stored hash.
  IF p_expected_graph_identity_hash IS NOT NULL THEN
    IF v_head_id IS NULL OR v_head.id IS NULL
       OR v_head.graph_identity_hash <> p_expected_graph_identity_hash THEN
      RAISE EXCEPTION 'create_model_version: expected head hash % does not match current head', p_expected_graph_identity_hash
        USING ERRCODE = 'MV409';
    END IF;
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
    WHERE id = p_scenario_id;

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
