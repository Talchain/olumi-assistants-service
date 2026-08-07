-- ============================================================
-- V5 TURN FENCE — append_turn_atomic_v4 GENERATION-KEYED fence gate.
-- ROADMAP 2.301: the staging commit-path outage fix (root cause proven in
-- PHASE0-EVIDENCE-2026-07-28/diagnosis-commit-path-2026-08-03.md).
--
-- ⚠️  AUTHORED AS CODE — NOT EXECUTED. Execution against staging is
--     Paul-gated / orchestrator-sequenced. The rehearsal harness is
--     scripts/rehearse-turn-fence-atomic-append-generation-key.mjs and it
--     MUST pass (including the mismatched-identity RED reproduction of the
--     defect) before this file is executed. Runbook:
--     Docs/v5/runbooks/turn-fence-atomic-append-generation-key-migration.md.
--
-- Date authored: 2026-08-02
-- Date executed: (pending — Paul-gated)
--
-- ── WHY (the defect this corrects) ───────────────────────────────────
-- Migration 20260731130000 (executed on staging 2026-07-30) gave
-- `append_turn_atomic_v4` an in-transaction fence gate whose row lookup was
--
--     WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id
--
-- `p_turn_id` is the COMMIT metadata's `write.turn_id`. That is NOT one
-- identity: the turn-executor passes the server `request_id` on all 24 of
-- its commit sites, while the fence row was claimed at admission under the
-- BROWSER's `payload.turn_id` (the ALS slot identity). No row matches →
-- SQLSTATE OLTF3 (`unclaimed`) → every graph-bearing edit/confirm commit on
-- staging has been refused deterministically since 31 Jul 22:17Z.
-- `turn-fence.ts`'s own header documents this exact hazard ("keying the
-- fence on `write.turn_id` would silently look up the wrong row on every
-- turn-executor commit"); the 20260731130000 SQL did precisely that, and
-- its rehearsal used MATCHED identities so it structurally could not see it.
--
-- ── THE FIX (one lookup key, nothing else) ───────────────────────────
-- The function already RECEIVES the unambiguous identity: `p_fence_generation`
-- is the admitted claim's bigserial (v5_turn_fence.generation, the PRIMARY
-- KEY), threaded from the ALS handle by supabase-store.ts. The gate now
-- locks the fence row by
--
--     WHERE scenario_id = p_scenario_id AND generation = p_fence_generation
--
-- Semantics preserved, case by case:
--   · OLTF3 (unclaimed)  — generation is the PK, so at most one row matches;
--     a generation that was never claimed for THIS scenario (including a
--     generation belonging to another scenario) finds no row → still
--     refused. Fail-closed posture unchanged.
--   · OLTF1 (stopped)    — `v5_mark_turn_stopped` upserts the SAME
--     (scenario_id, turn_id) row the claim inserted, i.e. the row whose
--     generation IS p_fence_generation. The tombstone is therefore found by
--     the new key exactly as by the old one, and the FOR UPDATE on that row
--     remains the Stop-serialisation point (a concurrent Stop either commits
--     first — gate sees the tombstone, append rolls back — or blocks until
--     this transaction commits and then reports `already_committed: true`).
--   · OLTF2 (superseded) — unchanged comparison, `p_fence_generation <
--     MAX(generation)` over the scenario.
--   · Stopped still wins over superseded (same order of checks).
--   · `p_turn_id` KEEPS its one correct job: the `v5_conversation_turns`
--     insert/idempotency key. The two identities the turn-fence.ts header
--     says must never be conflated are now used one-each, on purpose.
--
-- Signature UNCHANGED (19 args) — no PostgREST schema-cache hazard, no
-- caller change, no overload ambiguity (the 2026-04-26 precedent). The
-- app half needs NO deploy: supabase-store.ts already passes
-- `p_fence_generation` from the admitted ALS handle.
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────
-- rollback/20260802120000_v5_turn_fence_atomic_append_generation_key_rollback
-- .sql.do-not-apply DROPS v4 (it deliberately does NOT restore the
-- 20260731130000 body — that body is the outage). With v4 absent the app's
-- feature-detect (PGRST202) falls back to the pre-v4 evaluate-then-append,
-- which evaluates via the ALS handle — the CORRECT identity — so rollback
-- restores working commits with the fence still enforced as a check.
--
-- ── VERIFICATION (run after the Paul-gated execution) ────────────────
--   SELECT proname, pronargs FROM pg_proc WHERE proname = 'append_turn_atomic_v4';
--     -- Expected: exactly one row, pronargs = 19.
--   SELECT prosrc LIKE '%generation = p_fence_generation%'
--     FROM pg_proc WHERE proname = 'append_turn_atomic_v4';  -- true
--   Then a single-op edit commit on a virgin scenario via the deployed UI
--   (the probe the diagnosis names) — it must 200 and persist.
-- ============================================================

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
  -- entirely (v3-equivalent), which is also what keeps this function safe
  -- for any future non-fenced caller.
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
  v_fact             JSONB;
  v_updated          INTEGER;
  v_fence_generation BIGINT;
  v_fence_stopped_at TIMESTAMPTZ;
  v_fence_max        BIGINT;
BEGIN
  -- Row lock FIRST (v3 verbatim): serialises concurrent graph writers on
  -- this scenario for the remainder of the transaction.
  SELECT user_id, graph_identity_hash
    INTO v_user_id, v_current_hash
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
    -- write identity (turn-executor commits pass the server request_id
    -- there; see the header). v5_mark_turn_stopped upserts this same row,
    -- so a concurrent Stop still serialises here — commits-first (seen
    -- below, append refused) or waits (already_committed then reads TRUE).
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

    IF v_fence_stopped_at IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLTF1',
        MESSAGE = format(
          'append_turn_atomic_v4: the turn admitted at generation %s on scenario %s was explicitly stopped at %s',
          v_fence_generation, p_scenario_id, v_fence_stopped_at),
        DETAIL = format('{"generation": %s, "max_generation": %s}',
                        v_fence_generation, v_fence_max);
    END IF;

    IF p_fence_generation < v_fence_max THEN
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
  'ADMITTED GENERATION (2.301 fix: the fence row is locked by scenario_id + '
  'p_fence_generation — the claim identity — never by p_turn_id, the write identity, '
  'which turn-executor commits populate with the server request_id). Raises OLTF1 '
  '(stopped) / OLTF2 (superseded) / OLTF3 (unclaimed) with {"generation","max_generation"} '
  'in DETAIL. v3 body otherwise verbatim. service_role only.';
