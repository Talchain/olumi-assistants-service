-- ============================================================
-- V5 TURN FENCE — FIRST-WRITE EXEMPTION + the graph-write failure trace.
-- ROADMAP 2.709 (the fresh-journey P0: a first draft's commit destroyed by a
-- mid-draft non-graph turn; the UI keeps the rendered preview; the scenario
-- is a PHANTOM — canvas full, `scenarios.graph` NULL, zero committed turns).
-- Diagnosis: PHASE0-EVIDENCE-2026-07-28/fresh-journey-p0-diagnosis-2026-08-08.md
-- (fence supersede proven at the Render logs for request 708bc9e9, scenario
-- c1e0e6d3-7eb6-46bc-bda9-fff58111b7df, and induced deliberately at the wire).
--
-- ⚠️  AUTHORED AS CODE — NOT EXECUTED. Execution against staging is
--     Paul-gated / orchestrator-sequenced, per the standing migration
--     posture. The rehearsal harness is
--     scripts/rehearse-turn-fence-first-write-exemption.mjs and it MUST pass
--     (including the RED reproduction of the superseded-first-write refusal
--     against the 20260802120000 SQL) before this file is executed.
--
-- ⚠️  DEPLOY ORDER IS FREE, AND THAT IS DESIGNED. The app half carries an
--     OLTF2 recovery (supabase-store.ts tryFirstWriteExemptRecovery) that
--     produces the same commit against the PRE-migration v4, so the fix is
--     live on deploy either way; this migration closes the recovery's
--     check-not-lock window (the exemption moves inside the append
--     transaction, under the scenarios row lock) and creates the failure-
--     trace columns that light up the draft-loss notice (invariant 6 —
--     until they exist, the app logs
--     `v5.turn_fence.failure_mark_column_missing` at ERROR on every mark).
--
-- Date authored: 2026-08-06
-- Date executed: (pending — Paul-gated)
--
-- ── WHAT CHANGES, precisely ──────────────────────────────────────────
-- 1. `v5_turn_fence` gains `graph_write_failed_at timestamptz` +
--    `graph_write_failure_reason text` — the server-side trace of a
--    refused/failed graph commit, written best-effort by the app, read by
--    the next turn's draft-loss notice and EXCLUDED from the continuation
--    guard's admitted-turn read (a dead draft must not make a scenario a
--    continuation).
-- 2. `append_turn_atomic_v4`'s fence gate: the OLTF2 (superseded) raise is
--    now conditional on the scenario HOLDING a committed graph. The first
--    SELECT already locks the scenarios row FOR UPDATE and now also reads
--    `(graph IS NOT NULL)`, so the exemption decision is made under the
--    same lock that serialises every concurrent graph writer — zero
--    check-to-write window. Case by case:
--      · OLTF1 (stopped)    — UNCHANGED and checked FIRST: an explicit user
--        Stop refuses regardless of graph presence. The tombstone
--        protection of STOP-FENCE-BUILD-2026-07-31 survives verbatim.
--      · OLTF2 (superseded) — raised ONLY when `scenarios.graph IS NOT
--        NULL`: the supersede then protects a real, newer model (the
--        original clobber defect). When the scenario holds NO graph, the
--        write being refused would be the scenario's ONLY graph and the
--        superseding turn wrote nothing — the write proceeds. Both halves
--        of "first write" and "no later graph write has landed" are the
--        same predicate, read under the row lock.
--      · OLTF3 (unclaimed)  — UNCHANGED (fail closed).
--      · Interleavings: two graph-bearing first writes serialise on the
--        scenarios FOR UPDATE; whichever commits first flips the predicate
--        for the other (older gen → OLTF2 refusal; newer gen → verdict
--        current → ordinary overwrite, later intent wins).
--   Signature UNCHANGED (19 args) — no PostgREST schema-cache hazard, no
--   caller change, no overload ambiguity.
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────
-- rollback/20260806120000_v5_turn_fence_first_write_exemption_rollback
-- .sql.do-not-apply restores the 20260802120000 v4 body (generation-keyed,
-- unconditional OLTF2) and leaves the two columns in place (dropping a
-- column an app version may still write is the worse failure mode; they
-- are nullable and inert).
--
-- ── VERIFICATION (run after the Paul-gated execution) ────────────────
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'v5_turn_fence'
--       AND column_name LIKE 'graph_write_fail%';   -- two rows
--   SELECT prosrc LIKE '%v_has_graph%' FROM pg_proc
--     WHERE proname = 'append_turn_atomic_v4';       -- true
--   Then the wire probe: fresh scenario, streamed draft, second turn at
--   +12s (the diagnosis §1.4 induction) — the draft must COMMIT (one
--   append, no OLTF2 recovery log line) and the follow-up must classify
--   as continuation.
-- ============================================================

-- 1 ── The failure trace columns (invariant 6). Nullable, no default, no
--      backfill: absence of a mark is the ordinary state.
ALTER TABLE public.v5_turn_fence
  ADD COLUMN IF NOT EXISTS graph_write_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS graph_write_failure_reason TEXT;

COMMENT ON COLUMN public.v5_turn_fence.graph_write_failed_at IS
  'ROADMAP 2.709 invariant 6 — when this admitted turn''s graph commit was refused or failed. '
  'Written best-effort by the app at the refusal/500 site; read by the next turn''s draft-loss '
  'notice (with scenarios.graph IS NULL) and excluded from the continuation guard''s '
  'admitted-turn read.';
COMMENT ON COLUMN public.v5_turn_fence.graph_write_failure_reason IS
  'Closed reason string for graph_write_failed_at (fence verdict, or the draft-500 reason).';

-- 2 ── The exemption-aware fence gate. Body of 20260802120000 with the
--      v_has_graph read + the conditional OLTF2; everything else verbatim.
CREATE OR REPLACE FUNCTION public.append_turn_atomic_v4(
  p_scenario_id                  UUID,
  p_turn_id                      TEXT,
  p_turn_class                   TEXT,
  p_handler_id                   TEXT,
  p_request_hash                 TEXT,
  p_response_emitted             BOOLEAN,
  p_llm_calls_used               INTEGER,
  p_duration_ms                  INTEGER,
  p_handler_facts                JSONB,
  p_graph                        JSONB DEFAULT NULL,
  p_brief_text                   TEXT  DEFAULT NULL,
  p_pending_actions              JSONB DEFAULT '[]'::jsonb,
  p_coaching_state               JSONB DEFAULT NULL,
  p_user_message                 TEXT  DEFAULT NULL,
  p_assistant_message            TEXT  DEFAULT NULL,
  -- CAS (verbatim v3 semantics; all optional → v2-equivalent when absent):
  p_expected_graph_identity_hash TEXT    DEFAULT NULL,
  p_incoming_graph_identity_hash TEXT    DEFAULT NULL,
  p_cas_enforce                  BOOLEAN DEFAULT FALSE,
  -- The caller's ADMITTED fence generation (v5_turn_fence.generation, the
  -- PK of the row the ingress claim wrote). NULL skips the fence gate
  -- entirely (v3-equivalent).
  p_fence_generation             BIGINT  DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_turn_id          UUID;
  v_user_id          UUID;
  v_current_hash     TEXT;
  v_has_graph        BOOLEAN;
  v_fact             JSONB;
  v_updated          INTEGER;
  v_fence_generation BIGINT;
  v_fence_stopped_at TIMESTAMPTZ;
  v_fence_max        BIGINT;
BEGIN
  -- Row lock FIRST (v3 verbatim): serialises concurrent graph writers on
  -- this scenario for the remainder of the transaction. 2.709: also reads
  -- graph presence under the SAME lock — the first-write exemption's one
  -- predicate, so there is no window between the check and the write.
  SELECT user_id, graph_identity_hash, (graph IS NOT NULL)
    INTO v_user_id, v_current_hash, v_has_graph
    FROM scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scenario % not found', p_scenario_id;
  END IF;

  -- ── The IN-TRANSACTION fence gate, GENERATION-KEYED (2.301 fix) ────
  IF p_fence_generation IS NOT NULL AND p_graph IS NOT NULL THEN
    -- Lock THIS turn's fence row BY ITS ADMITTED GENERATION (the PK), the
    -- identity the claim actually wrote — never by the commit metadata's
    -- write identity. v5_mark_turn_stopped upserts this same row, so a
    -- concurrent Stop still serialises here.
    SELECT generation, stopped_at
      INTO v_fence_generation, v_fence_stopped_at
      FROM v5_turn_fence
      WHERE scenario_id = p_scenario_id AND generation = p_fence_generation
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLTF3',
        MESSAGE = format(
          'append_turn_atomic_v4: no fence row for scenario %s at generation %s — the write cannot be ordered',
          p_scenario_id, p_fence_generation),
        DETAIL = '{}';
    END IF;

    SELECT MAX(generation) INTO v_fence_max
      FROM v5_turn_fence
      WHERE scenario_id = p_scenario_id;

    -- OLTF1 FIRST, unconditionally: an explicit user Stop is never exempted.
    IF v_fence_stopped_at IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLTF1',
        MESSAGE = format(
          'append_turn_atomic_v4: the turn admitted at generation %s on scenario %s was explicitly stopped at %s',
          v_fence_generation, p_scenario_id, v_fence_stopped_at),
        DETAIL = format('{"generation": %s, "max_generation": %s}',
                        v_fence_generation, v_fence_max);
    END IF;

    -- OLTF2 — ROADMAP 2.709 FIRST-WRITE EXEMPTION: raised ONLY when the
    -- scenario holds a committed graph (v_has_graph, read under the
    -- scenarios FOR UPDATE above). A superseded write onto a graph-less
    -- scenario is the scenario's FIRST graph — refusing it manufactures
    -- the phantom state (canvas full, graph NULL); allowing it clobbers
    -- nothing, and a newer turn's own graph write later takes the
    -- ordinary overwrite path with verdict current.
    --
    -- REPLAY PASSTHROUGH (turn-fence.ts arrival 8, found by this
    -- migration's own rehearsal): when THIS (scenario_id, turn_id) has
    -- ALREADY committed, the superseded raise is skipped so the call falls
    -- through to the ON CONFLICT replay branch, which returns the existing
    -- row id BEFORE any graph write — an idempotent retry of a committed
    -- turn must never 500. (This gap predates 2.709: a turn committed at
    -- verdict `current` and retried after a newer claim hit the same false
    -- refusal.) OLTF1 deliberately keeps refusing replays — "a stopped
    -- replay refuses" is a pinned protection.
    IF p_fence_generation < v_fence_max AND v_has_graph
       AND NOT EXISTS (
         SELECT 1 FROM v5_conversation_turns
         WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id
       )
    THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLTF2',
        MESSAGE = format(
          'append_turn_atomic_v4: the turn admitted at generation %s is superseded on scenario %s (max generation %s)',
          p_fence_generation, p_scenario_id, v_fence_max),
        DETAIL = format('{"generation": %s, "max_generation": %s}',
                        p_fence_generation, v_fence_max);
    END IF;
  END IF;

  -- ── From here down: v3's body, verbatim (p_turn_id is the WRITE/row
  --    identity — its one correct job) ─────────────────────────────────
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
    -- Conflict replay: identical (scenario_id, turn_id) already committed.
    -- SKIP CAS ENTIRELY and return the existing row id — retry safety.
    SELECT id INTO v_turn_id
      FROM v5_conversation_turns
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
    RETURN v_turn_id;
  END IF;

  IF p_graph IS NOT NULL THEN
    IF p_cas_enforce
       AND p_expected_graph_identity_hash IS NOT NULL
       AND v_current_hash IS NOT NULL
       AND v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash
       AND (p_incoming_graph_identity_hash IS NULL
            OR p_incoming_graph_identity_hash IS DISTINCT FROM v_current_hash)
    THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLGC1',
        MESSAGE = format(
          'append_turn_atomic_v4: stale graph write for scenario %s (expected %s, current %s)',
          p_scenario_id, p_expected_graph_identity_hash, v_current_hash);
    END IF;

    UPDATE scenarios
       SET graph = p_graph,
           graph_identity_hash = p_incoming_graph_identity_hash
     WHERE id = p_scenario_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      RAISE EXCEPTION 'append_turn_atomic_v4: scenarios row % vanished under lock', p_scenario_id;
    END IF;
  END IF;

  IF jsonb_array_length(COALESCE(p_handler_facts, '[]'::jsonb)) > 0 THEN
    FOR v_fact IN SELECT * FROM jsonb_array_elements(p_handler_facts)
    LOOP
      INSERT INTO v5_handler_facts (
        v5_conversation_turn_id, scenario_id, user_id,
        handler_id, action_type, noop, payload
      ) VALUES (
        v_turn_id,
        p_scenario_id,
        v_user_id,
        v_fact->>'handler_id',
        v_fact->>'action_type',
        COALESCE((v_fact->>'noop')::boolean, FALSE),
        COALESCE(v_fact->'payload', '{}'::jsonb)
      );
    END LOOP;
  END IF;

  IF p_brief_text IS NOT NULL THEN
    UPDATE scenarios
       SET brief_text = p_brief_text,
           updated_at = NOW()
     WHERE id = p_scenario_id
       AND (brief_text IS NULL OR brief_text = '');
  END IF;

  RETURN v_turn_id;
END;
$$;

-- ── Lockdown — service-role only (A4 posture, identical to v2/v3/v4).
-- CREATE OR REPLACE preserves the existing ACLs; re-stating them is
-- defence-in-depth so this file is also correct standalone. ──
REVOKE EXECUTE ON FUNCTION public.append_turn_atomic_v4(
  uuid, text, text, text, text, boolean, integer, integer, jsonb,
  jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.append_turn_atomic_v4(
  uuid, text, text, text, text, boolean, integer, integer, jsonb,
  jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint
) TO service_role;

COMMENT ON FUNCTION public.append_turn_atomic_v4(
  uuid, text, text, text, text, boolean, integer, integer, jsonb,
  jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint
) IS
  'V5 turn append with the TURN FENCE checked inside the transaction, keyed on the '
  'ADMITTED GENERATION (2.301). ROADMAP 2.709: OLTF2 (superseded) is raised ONLY when '
  'scenarios.graph IS NOT NULL, read under the scenarios FOR UPDATE — a superseded FIRST '
  'write on a graph-less scenario proceeds (first-write exemption; the fresh-journey P0). '
  'OLTF1 (stopped) unconditional and checked first; OLTF3 (unclaimed) unchanged. '
  'service_role only.';
