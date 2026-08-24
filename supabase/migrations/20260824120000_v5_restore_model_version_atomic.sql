-- ============================================================================
-- Component 4 — Canonical State / Transactional Editing.
-- ONE-TRANSACTION RESTORE: restore_model_version_atomic.
--
-- ── WHY THIS EXISTS ────────────────────────────────────────────────────────
-- Before this migration a restore was THREE independent write transactions
-- issued in sequence by src/routes/assist.v1.scenario-versions.ts:
--
--   W1  create_model_version(provenance 'pre_restore')  → snapshot row + head
--   W2  restore_model_version(...)                      → restore row  + head
--   W3  append_turn_atomic_v4(p_graph := ...)           → scenarios.graph
--
-- Each committed on its own. A failure between W2 and W3 therefore left the
-- version head naming a version the working graph is NOT — and the route
-- REPORTED that partial state honestly, as `RESTORE_INCOMPLETE` with
-- `version_recorded: true`. A failure between W1 and W2 left an orphan
-- "Before restore" snapshot and a moved head for a restore that never
-- happened, reported as an ordinary refusal.
--
-- A state that cannot occur cannot be reported. This function makes the whole
-- restore ONE transaction: a single plpgsql invocation, so every RAISE below
-- aborts the entire operation and NO intermediate state survives. There is no
-- COMMIT, no SAVEPOINT, and no exception handler in this function — those are
-- the only three constructs that could break that guarantee, and the static
-- guards in
-- src/orchestrator-v5/model-management/__tests__/restore-atomic-migration-static-guards.test.ts
-- assert their absence.
--
-- ── WHAT IS NOT CHANGED, DELIBERATELY ──────────────────────────────────────
-- No existing function's SIGNATURE or BODY is touched. `create_model_version`
-- and `restore_model_version` keep their exact arities, so PostgREST resolves
-- them exactly as before and NO overload is introduced (the 20260426160532
-- lesson, pinned by migration-static-guards.test.ts). This migration is purely
-- ADDITIVE: two nullable columns, one partial unique index, one new function.
--
-- `restore_model_version` is now UNUSED BY THE SERVICE (the atomic path
-- replaces it) but is deliberately LEFT IN PLACE: dropping a deployed function
-- is a separate decision with its own rollback story, and leaving it costs
-- nothing. It must not be reintroduced as a live path — the whole point of
-- this component is that there is ONE writer for a restore.
--
-- ── DEPLOY ORDER IS NOT FREE — APPLY THIS MIGRATION BEFORE DEPLOYING CEE ────
-- The service calls `restore_model_version_atomic` and has NO fallback to the
-- old three-write path: a fallback would reintroduce exactly the partial state
-- this migration exists to abolish. If CEE deploys first, PostgREST answers
-- PGRST202 and the route answers an honest 503 — restore is UNAVAILABLE, never
-- partial. That is the intended failure mode, not an oversight.
--
-- ── THE TWO HASH REGIMES, NAMED APART ──────────────────────────────────────
-- This estate carries two different values called `graph_identity_hash`:
--
--   · scenarios.graph_identity_hash      — identity of the WORKING graph.
--                                          Written by append_turn_atomic_v*.
--   · model_versions.graph_identity_hash — identity of a SAVED VERSION's
--                                          snapshot. Written by the MM RPCs.
--
-- They answer different questions and they are NOT interchangeable. The old
-- route chained them: the client's expected hash (which is the WORKING graph
-- the user was looking at) gated `create_model_version`, whose CAS compares
-- against the HEAD VERSION's hash. That comparison is a category error except
-- in the steady state where the two happen to coincide.
--
-- This function CASes the caller's expectation against
-- `scenarios.graph_identity_hash` — the working graph, which is the thing a
-- restore overwrites and the thing the user actually saw. One comparison, one
-- authority, evaluated once under the row lock.
--
-- ── THE UNVERIFIABLE BASE, REFUSED RATHER THAN ASSUMED ─────────────────────
-- A scenario can hold `graph IS NOT NULL AND graph_identity_hash IS NULL`.
-- That is reachable only under `CEE_V5_GRAPH_CAS_RPC='off'`, where
-- supabase-store.ts passes `p_incoming_graph_identity_hash := NULL` and
-- append_turn_atomic_v4 stamps the column NULL on every graph write. In that
-- state the working graph's identity is UNKNOWN, so neither the CAS nor the
-- pre-restore snapshot can be evaluated honestly. The function refuses with
-- MV412 rather than snapshotting a graph under a hash it did not verify.
-- (The route maps MV412 to a 503 with an honest code. It is fail-CLOSED: the
-- guard is the feature, exactly as the pre-restore snapshot guard already is.)
--
-- ── IDEMPOTENCY ────────────────────────────────────────────────────────────
-- `p_mutation_id` is REQUIRED. It is stamped on the restore row and carried by
-- a partial UNIQUE index on (scenario_id, mutation_id). A replay is detected
-- FIRST, under the row lock, BEFORE any write, and returns the ORIGINAL
-- receipt reconstructed from the stored row — never a second version row.
-- The turn id handed to append_turn_atomic_v4 is derived from the SAME
-- mutation id, so the append layer's own (scenario_id, turn_id) idempotency
-- agrees with this one by construction rather than by coincidence.
--
-- ── THE PRE-RESTORE SNAPSHOT ───────────────────────────────────────────────
-- The snapshot's bytes are read from `scenarios.graph` INSIDE this
-- transaction, under the lock. The caller supplies no current graph at all,
-- which removes the read→write window the old route had (it loaded the graph
-- over HTTP, then handed those bytes to a separate transaction).
--
-- Reuse-vs-create is DERIVED, not branched on a guess: the snapshot is written
-- through `create_model_version`, whose no-op dedupe returns the existing head
-- unchanged when the head's full identity envelope already matches the working
-- graph. So "reuse the current head as the undo version when its full identity
-- matches the working graph; otherwise create one pre_restore checkpoint
-- inside the same transaction" is the dedupe's existing behaviour, invoked —
-- not a second implementation of the same rule.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Additive columns. Both nullable; every pre-existing row keeps
--    reading exactly as before. model_versions stays append-only —
--    nothing here UPDATEs an existing version row.
-- ------------------------------------------------------------
ALTER TABLE public.model_versions
  ADD COLUMN IF NOT EXISTS mutation_id TEXT;

-- Plain REFERENCES with NO `ON DELETE` clause, matching
-- restored_from_version_id exactly: the default RESTRICT keeps the table
-- append-only. `ON DELETE SET NULL` would UPDATE an existing version row,
-- which is precisely the immutability this table is built on.
ALTER TABLE public.model_versions
  ADD COLUMN IF NOT EXISTS undo_version_id UUID
  REFERENCES public.model_versions(id);

COMMENT ON COLUMN public.model_versions.mutation_id IS
  'Caller-supplied idempotency key for the mutation that created this row. '
  'Set ONLY by restore_model_version_atomic. Unique per scenario where '
  'present; a replay of the same mutation_id returns this row rather than '
  'writing a second one.';
COMMENT ON COLUMN public.model_versions.undo_version_id IS
  'The version holding the state this row replaced — the pre-restore '
  'snapshot (or the head it deduped to). Set ONLY by '
  'restore_model_version_atomic, so a replayed receipt can name the undo '
  'target without a second lookup. Symmetric with restored_from_version_id: '
  'that names where the bytes CAME FROM, this names what they REPLACED.';

-- Partial unique index: the idempotency key. Rows written by the pre-existing
-- RPCs carry NULL and are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS model_versions_scenario_mutation_idx
  ON public.model_versions (scenario_id, mutation_id)
  WHERE mutation_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. restore_model_version_atomic — the ONE transaction.
--
--    Order is: lock → guest → target → base verifiable → CAS →
--    idempotent replay → snapshot → restore row → head → graph →
--    event → receipt. Every refusal raises, and a raise inside a
--    single plpgsql invocation aborts the whole invocation, so no
--    step below can leave a partial state behind.
--
--    SQLSTATEs, all pre-existing except MV412:
--      MV001 guest        MV404 version absent
--      MV409 stale base   MV412 base identity unverifiable  (new)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_model_version_atomic(
  p_scenario_id                  UUID,
  p_version_id                   UUID,
  p_mutation_id                  TEXT,
  -- The graph to become the working model: the TARGET version's stored graph,
  -- re-validated against the ingress contract and re-projected through
  -- projectGraphForPersistence CEE-side. Never a client's bytes — the route
  -- reads the target itself and never reads a `graph` field off the request.
  p_graph                        JSONB,
  -- Identity of p_graph, computed CEE-side by computeGraphIdentityHash. The
  -- SAME value is written to scenarios.graph_identity_hash and to the new
  -- version row, so the head and the working graph cannot disagree.
  p_graph_identity_hash          TEXT,
  p_projection_version           TEXT,
  p_normaliser_version           TEXT,
  p_graph_schema_version         TEXT,
  -- CEE's read of the target version's stored hash. Asserted against the
  -- target row under the lock: it proves the row the caller projected is the
  -- row this transaction is restoring.
  p_expected_source_identity_hash TEXT,
  p_hash_algorithm               TEXT    DEFAULT 'sha256',
  p_label                        TEXT    DEFAULT NULL,
  -- CAS against scenarios.graph_identity_hash (the WORKING graph). NULL =
  -- no expectation, observe-only, mirroring every other CAS seam here.
  p_expected_graph_identity_hash TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_owner            UUID;
  v_current_graph    JSONB;
  v_current_hash     TEXT;
  -- SQL NULL and JSON `null` are different values and BOTH mean "no working
  -- graph here". Derived once so every later branch asks the same question;
  -- the pre-existing route made this distinction in TypeScript, where a JSON
  -- null arrives as JS null, and it must not be lost by moving into SQL.
  v_has_current      BOOLEAN;
  v_target           public.model_versions%ROWTYPE;
  v_replay           public.model_versions%ROWTYPE;
  v_snapshot         JSONB;
  v_undo_id          UUID;
  v_next_number      INTEGER;
  v_new_id           UUID;
  v_turn_id          TEXT;
  v_event_id         TEXT;
  v_new_seq          INTEGER;
  v_event            JSONB;
  v_events           JSONB;
  v_updated          INTEGER;
BEGIN
  -- Parameter guards, before anything is read.
  IF p_mutation_id IS NULL OR length(btrim(p_mutation_id)) = 0 THEN
    RAISE EXCEPTION 'restore_model_version_atomic: p_mutation_id is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_graph IS NULL THEN
    RAISE EXCEPTION 'restore_model_version_atomic: p_graph must not be null'
      USING ERRCODE = '22023';
  END IF;
  IF p_graph_identity_hash IS NULL OR p_graph_identity_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'restore_model_version_atomic: p_graph_identity_hash must be 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_projection_version IS NULL OR p_normaliser_version IS NULL
     OR p_graph_schema_version IS NULL OR p_hash_algorithm IS NULL THEN
    RAISE EXCEPTION 'restore_model_version_atomic: identity envelope version fields must not be null'
      USING ERRCODE = '22023';
  END IF;

  -- ── THE ROW LOCK. Everything after this point is serialised per
  --    scenario against every other writer that takes it — which is
  --    every MM RPC and every append_turn_atomic_v*.
  SELECT user_id, graph, graph_identity_hash
    INTO v_owner, v_current_graph, v_current_hash
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restore_model_version_atomic: scenario % not found', p_scenario_id;
  END IF;

  v_has_current := v_current_graph IS NOT NULL
                   AND jsonb_typeof(v_current_graph) <> 'null';

  -- D3 Branch A guest refusal, verbatim from the sibling RPCs.
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'restore_model_version_atomic: scenario % has no owner — version history requires sign-in', p_scenario_id
      USING ERRCODE = 'MV001';
  END IF;

  -- ── IDEMPOTENT REPLAY, DECIDED BEFORE ANY WRITE.
  --    A replayed mutation returns the ORIGINAL receipt from the stored
  --    row. Nothing is written, so no second version row is possible and
  --    no head moves. (Decided before the target/CAS checks on purpose: a
  --    replay must not be refused for a base that has legitimately moved
  --    ON BY THIS VERY MUTATION — the first attempt is what moved it.)
  SELECT * INTO v_replay
    FROM public.model_versions
    WHERE scenario_id = p_scenario_id AND mutation_id = p_mutation_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'version_id', v_replay.id,
      'version_number', v_replay.version_number,
      'graph_identity_hash', v_replay.graph_identity_hash,
      'restored_from_version_id', v_replay.restored_from_version_id,
      'undo_version_id', v_replay.undo_version_id,
      'graph', v_replay.graph,
      'replayed', true,
      'event_id', NULL
    );
  END IF;

  -- ── The target version must exist AND belong to this scenario.
  SELECT * INTO v_target
    FROM public.model_versions
    WHERE id = p_version_id AND scenario_id = p_scenario_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restore_model_version_atomic: version % not found for scenario %', p_version_id, p_scenario_id
      USING ERRCODE = 'MV404';
  END IF;

  -- The caller projected THIS row. Asserted under the lock so a receipt can
  -- never describe a version other than the one whose bytes were written.
  IF p_expected_source_identity_hash IS NULL
     OR v_target.graph_identity_hash IS DISTINCT FROM p_expected_source_identity_hash THEN
    RAISE EXCEPTION 'restore_model_version_atomic: source version % identity moved under the caller', p_version_id
      USING ERRCODE = 'MV409';
  END IF;

  -- ── The base must be VERIFIABLE. A working graph whose identity is
  --    unknown cannot be CAS-compared and cannot be honestly snapshotted.
  IF v_has_current AND v_current_hash IS NULL THEN
    RAISE EXCEPTION 'restore_model_version_atomic: scenario % holds a graph with no recorded identity — the base cannot be verified', p_scenario_id
      USING ERRCODE = 'MV412';
  END IF;

  -- ── CAS against the WORKING graph (scenarios.graph_identity_hash).
  --    One comparison, one authority. NULL expectation = observe-only.
  IF p_expected_graph_identity_hash IS NOT NULL
     AND v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash THEN
    RAISE EXCEPTION 'restore_model_version_atomic: expected working-graph hash % does not match current %', p_expected_graph_identity_hash, v_current_hash
      USING ERRCODE = 'MV409';
  END IF;

  -- ── THE PRE-RESTORE SNAPSHOT, INSIDE THIS TRANSACTION.
  --    Written through create_model_version so the version-insert,
  --    version_number assignment, pointer move and journey event have ONE
  --    implementation. Its no-op dedupe supplies the "reuse the head when
  --    its identity already matches the working graph" rule — derived, not
  --    re-decided here.
  --    Called with NO CAS: the working-graph CAS above has already run
  --    under this same lock, and create_model_version's own CAS asks a
  --    DIFFERENT question (head-version identity), which must not be
  --    conflated with it.
  --    A NULL working graph means there is nothing to lose and nothing to
  --    snapshot; undo_version_id stays NULL and says so.
  IF v_has_current THEN
    v_snapshot := public.create_model_version(
      p_scenario_id                  := p_scenario_id,
      p_graph                        := v_current_graph,
      p_graph_identity_hash          := v_current_hash,
      p_projection_version           := p_projection_version,
      p_normaliser_version           := p_normaliser_version,
      p_graph_schema_version         := p_graph_schema_version,
      p_hash_algorithm               := p_hash_algorithm,
      p_label                        := 'Before restore',
      p_provenance                   := 'pre_restore',
      p_event_id                     := 'pre_restore_' || p_mutation_id,
      p_expected_graph_identity_hash := NULL::text
    );
    v_undo_id := (v_snapshot->>'version_id')::uuid;
  END IF;

  -- ── THE RESTORE ROW. The ONLY insert this function performs itself,
  --    and the only one that has to differ: it carries the RE-PROJECTED
  --    bytes (not the target's raw bytes), the restore lineage, the undo
  --    lineage and the idempotency key.
  --
  --    ⚠ THE BYTES WRITTEN HERE AND THE BYTES WRITTEN TO scenarios.graph
  --    BELOW ARE THE SAME `p_graph`, UNDER THE SAME `p_graph_identity_hash`.
  --    The pre-existing restore_model_version byte-copies the TARGET's graph
  --    and envelope while the working graph receives the RE-PROJECTED bytes —
  --    so a version saved under an older projection left the head and the
  --    working graph describing different content the moment the restore
  --    "succeeded". Writing one graph to both is the point of this function.
  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_number
    FROM public.model_versions
    WHERE scenario_id = p_scenario_id;

  INSERT INTO public.model_versions (
    scenario_id, owner_user_id, version_number, graph,
    graph_identity_hash, hash_algorithm,
    identity_projection_version, identity_normaliser_version,
    graph_schema_version, label, provenance, restored_from_version_id,
    mutation_id, undo_version_id
  ) VALUES (
    p_scenario_id, v_owner, v_next_number, p_graph,
    p_graph_identity_hash, p_hash_algorithm,
    p_projection_version, p_normaliser_version,
    p_graph_schema_version, p_label, 'restore', p_version_id,
    p_mutation_id, v_undo_id
  )
  RETURNING id INTO v_new_id;

  UPDATE public.scenarios
    SET current_model_version_id = v_new_id
    WHERE id = p_scenario_id;

  -- ── THE WORKING GRAPH, through the sanctioned atomic writer.
  --    Nested inside THIS transaction, so its own row lock is already held
  --    and its failure aborts everything above.
  --
  --    p_cas_enforce := TRUE unconditionally. The append's CAS is the same
  --    comparison this function already made under the same lock, so it
  --    cannot fail here — it is carried anyway so that deleting the check
  --    above still leaves a stale write refused. It is deliberately NOT
  --    derived from CEE_V5_GRAPH_CAS_RPC: a restore's atomicity must not
  --    depend on a global posture flag.
  --
  --    p_fence_generation := NULL — a restore is an explicit user action,
  --    not the continuation of an admitted turn, so the turn fence has no
  --    generation to order it against (v3-equivalent, per v4's own contract).
  v_turn_id := 'version_restore:' || p_mutation_id;
  PERFORM public.append_turn_atomic_v4(
    p_scenario_id                  := p_scenario_id,
    p_turn_id                      := v_turn_id,
    p_turn_class                   := 'direct_answer',
    p_handler_id                   := NULL::text,
    p_request_hash                 := v_turn_id,
    p_response_emitted             := FALSE,
    p_llm_calls_used               := 0,
    p_duration_ms                  := 0,
    p_handler_facts                := '[]'::jsonb,
    p_graph                        := p_graph,
    p_brief_text                   := NULL::text,
    p_pending_actions              := '[]'::jsonb,
    p_coaching_state               := NULL::jsonb,
    p_user_message                 := NULL::text,
    p_assistant_message            := NULL::text,
    p_expected_graph_identity_hash := p_expected_graph_identity_hash,
    p_incoming_graph_identity_hash := p_graph_identity_hash,
    p_cas_enforce                  := TRUE,
    p_fence_generation             := NULL::bigint
  );

  -- append_turn_atomic_v4 skips its graph write on an idempotent turn replay
  -- (ON CONFLICT on (scenario_id, turn_id)). That branch is unreachable here —
  -- the mutation_id replay above returns before this point, and the turn id is
  -- derived from that same mutation id — but "unreachable" is not "checked",
  -- and a receipt that names a graph the scenario does not hold is precisely
  -- the defect this function exists to abolish. So: assert the working graph
  -- really is what this transaction wrote, and abort the whole restore if not.
  SELECT COUNT(*) INTO v_updated
    FROM public.scenarios
    WHERE id = p_scenario_id
      AND graph_identity_hash = p_graph_identity_hash;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'restore_model_version_atomic: working graph did not take the restored identity for scenario %', p_scenario_id
      USING ERRCODE = 'MV500';
  END IF;

  -- ── The journey event, in the same transaction as everything else.
  --    Idempotent by event_id, keyed on the mutation id.
  v_event_id := 'model_version_restored_' || p_mutation_id;
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
                      'undo_version_id', v_undo_id,
                      'label', p_label
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

  -- ── ONE canonical receipt. `graph` is the bytes now held by BOTH the
  --    scenario and the new head version — a reload cannot disagree with it.
  RETURN jsonb_build_object(
    'version_id', v_new_id,
    'version_number', v_next_number,
    'graph_identity_hash', p_graph_identity_hash,
    'restored_from_version_id', p_version_id,
    'undo_version_id', v_undo_id,
    'graph', p_graph,
    'replayed', false,
    'event_id', v_event_id
  );
END;
$$;

-- ------------------------------------------------------------
-- 3. Function grants — the A4 lesson, applied explicitly. Supabase
--    auto-GRANTs EXECUTE to anon/authenticated on new public
--    functions; REVOKE FROM PUBLIC alone is insufficient.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.restore_model_version_atomic(
  uuid, uuid, text, jsonb, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.restore_model_version_atomic(
  uuid, uuid, text, jsonb, text, text, text, text, text, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.restore_model_version_atomic(
  uuid, uuid, text, jsonb, text, text, text, text, text, text, text, text
) IS
  'Component 4 — the ONE-TRANSACTION restore. Pre-restore snapshot, restore '
  'version row, head pointer move, working-graph write and journey event all '
  'commit together or not at all, under a single scenarios row lock. '
  'Idempotent by (scenario_id, mutation_id): a replay returns the original '
  'receipt and writes nothing. Replaces the three-transaction sequence whose '
  'partial state was reported as RESTORE_INCOMPLETE — a state this function '
  'cannot produce and the service therefore no longer represents.';
