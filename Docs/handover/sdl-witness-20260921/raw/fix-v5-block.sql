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

  -- ⛔ REPLAY IS DECIDED BEFORE CAS. THIS LOOKUP MOVED ABOVE THE CAS BLOCK
  -- 2026-09-20 — see this migration's header for the defect it closes.
  --
  -- v4 has ALWAYS decided replay first and then skipped CAS entirely
  -- (20260806120000_v5_turn_fence_first_write_exemption.sql:298-305: "Conflict
  -- replay: identical (scenario_id, turn_id) already committed. SKIP CAS
  -- ENTIRELY and return the existing row id — retry safety"). v5 evaluated its
  -- own null-safe CAS ABOVE this lookup, so replaying an ALREADY-COMMITTED turn
  -- raised OLGC1 whenever the graph had moved on since — which is precisely the
  -- state an interrupted client is in when it replays.
  --
  -- The marker also still lets v5 distinguish that replay from the new
  -- NULL-marker row v4 inserts for us in this transaction.
  SELECT id, model_version_mutation_id, model_version_created
    INTO v_existing_turn_id, v_turn_version_mutation_id, v_turn_version_created
    FROM public.v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
  v_turn_preexisting := FOUND;

  -- A REPLAY IS NOT SUBJECT TO CAS. Its expected base belongs to the turn that
  -- already committed; re-testing it against a head that has since moved asks a
  -- question about a write that is no longer pending. The replay arm below is
  -- read-only and returns the durable receipt, so there is nothing to serialise.
  IF NOT v_turn_preexisting THEN
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
    -- So this guard adds EXACTLY ONE enforcement over v4 — a known-absent base
    -- that has since been filled in — which is precisely the lost update.
    --
    -- ⚠⚠ THE TABLE BELOW WAS WRITTEN AS A FUNCTION OF TWO VARIABLES AND THE CODE
    -- IS A FUNCTION OF THREE (corrected 2026-08-26, after the C4 oracle was run
    -- against a real Postgres for the first time). It previously read
    -- `expected NULL, current SET -> CONFLICT` UNCONDITIONALLY, omitting the
    -- `incoming` conjunct entirely. That reached the right verdict for an
    -- incomplete reason — and a fixture written from it sent `incoming = current`,
    -- landed in the replay-exemption cell, was correctly ACCEPTED, and read as a
    -- migration defect. An incomplete model that happens to agree on the case in
    -- hand is exactly how the next reader is misled.
    --
    -- `incoming` matters because v4's IDEMPOTENT-REPLAY exemption is preserved
    -- here: re-sending the SAME graph is a retry, not a conflict.
    --
    --   expected  current  incoming    outcome
    --   --------  -------  ---------   -----------------------------------------
    --   NULL      NULL     any      -> match      (first writer proceeds)
    --   NULL      SET      ≠current -> CONFLICT   <- the lost update, caught
    --   NULL      SET      =current -> match      (idempotent replay, exempt)
    --   SET       NULL     any      -> exempt     (unstamped legacy row)
    --   h1        h2       ≠current -> CONFLICT   (v4 catches this too)
    --   h1        h2       =current -> match      (idempotent replay, exempt)
    --   h         h        any      -> match
    --
    -- Two concurrent writers on an unstamped scenario both read expected = NULL.
    -- They serialise on the FOR UPDATE above: the first sees current NULL and
    -- commits, stamping the hash; the second then sees current SET against its
    -- NULL expectation, with a DIFFERENT graph in hand, and is refused. That is
    -- the race closed — and the "different graph" clause is why the row above it
    -- exists rather than being a hole.
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
  END IF;


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
