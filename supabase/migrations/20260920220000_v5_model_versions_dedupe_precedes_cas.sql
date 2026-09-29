-- =============================================================================
-- create_model_version / restore_model_version — DEDUPE BEFORE CAS (2026-09-20)
-- =============================================================================
--
-- THE SAME DEFECT AS 20260920210000, IN TWO MORE FUNCTIONS. Found by sweeping the
-- CLASS rather than repairing the instance: every plpgsql function here that has
-- BOTH an idempotency arm AND a conflict raise was checked for the order in which
-- they run. Nine have the shape; six were already correct; these two were not.
--
-- THE DEFECT
--   Both functions raise MV409 on an optional in-transaction CAS
--   (20260705120000_v5_model_versions.sql:266-272 and :418-424) BEFORE reaching
--   their dedupe arm (:275-287 and :427-440).
--
--   A post-commit retry sends the SAME p_expected_graph_identity_hash (the base
--   it read) and the SAME target. After the first call committed, the head IS the
--   target — so `v_head.graph_identity_hash <> p_expected_graph_identity_hash` is
--   true and MV409 is raised, although the dedupe nine lines below would have
--   matched exactly and returned `deduped: true`.
--
--   ⛔ This defeats a guarantee the file itself states. restore_model_version's
--   own header (:362-364) says the dedupe "also makes post-commit RETRIES of an
--   identical call idempotent end-to-end". Whenever the caller supplies the
--   expected hash, it does not. Both callers DO supply it
--   (store-adapter.ts:206 and :220, from an optional request-body field at
--   routes/assist.v1.scenario-versions.ts:203).
--
-- THE FIX
--   Move the dedupe arm ABOVE the CAS check in both. A dedupe match means the head
--   ALREADY IS the state the caller wants, so no write will happen and there is no
--   lost update for CAS to prevent.
--
--   ⚠ WHAT THIS DELIBERATELY ACCEPTS, stated so a reviewer can refuse it.
--   If another writer moved the head to EXACTLY the caller's target while the
--   caller expected a different base, the caller now gets `deduped: true` instead
--   of MV409 — a genuine concurrent modification is no longer signalled. That is
--   benign here and only here: graph_identity_hash identifies the graph state
--   under the projection, and the dedupe additionally pins projection, normaliser
--   and schema versions, so the end state is the one the caller asked for. There
--   is no lost update to report; there is only a race the caller won by default.
--   It is the same trade v4 already makes (20260806120000:298-305).
--
--   Neither predicate is otherwise altered. The blocks are moved, not rewritten;
--   the bodies below were generated from this file's own function text by a
--   transformation with assertions, not hand-copied.
--
-- EXECUTION
--   NOT EXECUTED BY THIS CHANGE. Migration execution on staging is Paul-gated.
--   The rollback beside this file restores 20260705120000's bodies verbatim.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_model_version(
  p_scenario_id                  UUID,
  p_graph                        JSONB,
  p_graph_identity_hash          TEXT,
  p_projection_version           TEXT,
  p_normaliser_version           TEXT,
  p_graph_schema_version         TEXT,
  p_hash_algorithm               TEXT DEFAULT 'sha256',
  p_label                        TEXT DEFAULT NULL,
  p_provenance                   TEXT DEFAULT NULL,
  p_event_id                     TEXT DEFAULT NULL,
  p_expected_graph_identity_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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

  -- ⛔ DEDUPE IS DECIDED BEFORE CAS (moved here 2026-09-20 — see this
  -- migration's header). A dedupe match means the head ALREADY IS the state the
  -- caller is asking for, so NO WRITE WILL HAPPEN and there is no lost update for
  -- CAS to prevent. Testing the caller's expected BASE against a head that has
  -- since become the caller's own TARGET asks a question about a write that is
  -- not pending — and refusing it is precisely the post-commit retry this
  -- function's own header promises to make idempotent.
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

  -- Optional in-transaction CAS against the head version's stored hash.
  IF p_expected_graph_identity_hash IS NOT NULL THEN
    IF v_head_id IS NULL OR v_head.id IS NULL
       OR v_head.graph_identity_hash <> p_expected_graph_identity_hash THEN
      RAISE EXCEPTION 'create_model_version: expected head hash % does not match current head', p_expected_graph_identity_hash
        USING ERRCODE = 'MV409';
    END IF;
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
$$;

CREATE OR REPLACE FUNCTION public.restore_model_version(
  p_scenario_id                  UUID,
  p_version_id                   UUID,
  p_label                        TEXT DEFAULT NULL,
  p_event_id                     TEXT DEFAULT NULL,
  p_expected_graph_identity_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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

  -- ⛔ DEDUPE IS DECIDED BEFORE CAS (moved here 2026-09-20 — see this
  -- migration's header). A dedupe match means the head ALREADY IS the state the
  -- caller is asking for, so NO WRITE WILL HAPPEN and there is no lost update for
  -- CAS to prevent. Testing the caller's expected BASE against a head that has
  -- since become the caller's own TARGET asks a question about a write that is
  -- not pending — and refusing it is precisely the post-commit retry this
  -- function's own header promises to make idempotent.
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

  IF p_expected_graph_identity_hash IS NOT NULL THEN
    IF v_head_id IS NULL OR v_head.id IS NULL
       OR v_head.graph_identity_hash <> p_expected_graph_identity_hash THEN
      RAISE EXCEPTION 'restore_model_version: expected head hash % does not match current head', p_expected_graph_identity_hash
        USING ERRCODE = 'MV409';
    END IF;
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
$$;
