-- ============================================================
-- V5 TURN FENCE — append_turn_atomic_v4 (the fence check INSIDE the append
-- transaction). ROADMAP 2.174 fix c; Codex round-2 P1, adjudicated real.
--
-- ✅  EXECUTED ON STAGING 2026-07-30 (this header said "NOT EXECUTED" until
--     2026-08-02 — nine days stale; corrected per the #794 adversarial
--     review's honesty ritual, CLAUDE.md trap 2's lesson that a file's
--     description of its own status is a hand-maintained mirror). Evidence:
--     PHASE0-EVIDENCE-2026-07-28/fence-migration-execution.md (8/8
--     structural + 7/7 behavioural); the ledger row was backfilled the same
--     day (migration-ledger-reconciliation.md). Rehearsal evidence:
--     fence-hardening-build.md.
--
-- ⚠️⚠️ DEFECTIVE AND SUPERSEDED — ROADMAP 2.301. The fence gate below keys
--     its row lookup on `turn_id = p_turn_id` (the commit's WRITE identity,
--     which turn-executor commits populate with the server request_id),
--     while the fence row was claimed under the browser's payload.turn_id.
--     Executing this file killed every graph-bearing edit/confirm commit on
--     staging from 31 Jul 22:17Z (proof:
--     PHASE0-EVIDENCE-2026-07-28/diagnosis-commit-path-2026-08-03.md). The
--     corrected definition is 20260802120000_v5_turn_fence_atomic_append_
--     generation_key.sql (generation-keyed lookup, signature unchanged).
--     NEVER re-execute this file; its ledger row must EXIST precisely so
--     replay tooling never re-applies it (see the generation-key runbook's
--     A1 section). The SQL below is preserved byte-for-byte as the executed
--     historical artefact.
--
-- ⚠️  DEPLOY ORDER IS FREE — THE CODE FEATURE-DETECTS (stated and pinned).
--     Unlike 20260731120000 (migration-first, fail-closed), the application
--     half of this change detects a missing v4 (PostgREST PGRST202), logs
--     one WARN, and falls back to the pre-v4 evaluate-then-append two-step —
--     i.e. exactly the protection that shipped with the fence, including its
--     honestly-documented ~one-RPC window. Executing this migration (and
--     restarting/redeploying CEE) is what CLOSES that window; nothing breaks
--     in either order. Pinned by turn-fence-atomic-append.test.ts.
--
-- Date authored: 2026-07-30
-- Date executed: 2026-07-30 (staging; header falsely read "(pending)" until 2026-08-02)
--
-- ── WHY ──────────────────────────────────────────────────────────────
-- The fence (20260731120000) is a pre-write CHECK, not a lock: the commit
-- path evaluates `v5_evaluate_turn_fence` in one round trip and calls
-- append_turn_atomic_v2/v3 in another (~10-40 ms later). A Stop — or a newer
-- claim — landing inside that window is invisible to the evaluation the
-- commit just passed, so the stopped/superseded graph still lands. The
-- window was enumerated honestly at authoring time (turn-fence.ts arrival
-- 10) and rowed; this migration is that row.
--
-- ── HOW THE WINDOW CLOSES ────────────────────────────────────────────
-- v4 = v3's body verbatim (row-locked scenarios read, CAS block, idempotent
-- replay, brief_text write-once, handler facts) + ONE new block: when the
-- caller passes its admitted fence generation and the write carries a graph,
-- the turn's OWN v5_turn_fence row is read FOR UPDATE inside this
-- transaction and the three-verdict gate runs under that lock:
--
--   · no row              → SQLSTATE OLTF3 (unclaimed — cannot order)
--   · stopped_at NOT NULL → SQLSTATE OLTF1 (explicit user Stop)
--   · generation < MAX(generation) over the scenario
--                         → SQLSTATE OLTF2 (superseded by a later claim)
--
-- The FOR UPDATE on the turn's fence row is the serialisation point:
-- `v5_mark_turn_stopped` upserts that SAME row, so a concurrent Stop either
-- (a) commits first — this gate sees the tombstone and the whole append
-- rolls back — or (b) blocks until this transaction commits, after which the
-- Stop's `already_committed` reads TRUE and the UI says something true about
-- the past. There is no third interleaving; the window does not exist.
--
-- Supersession inside the window collapses to benign ordering: a claim is a
-- plain INSERT (never blocked by this lock), and a turn whose claim lands
-- while an older append is mid-transaction commits its own graph LATER,
-- which then supersedes normally. Only the tombstone race was a corruption;
-- it is the one the lock closes.
--
-- Lock ordering (deadlock-free by construction): scenarios FOR UPDATE first
-- (v3's existing graph-writer serialisation), then the fence row. Appends on
-- one scenario serialise on the scenarios lock before either touches a fence
-- row; the Stop takes only the fence-row lock; the claim only inserts.
--
-- Verdict precedence mirrors classifyTurnFence: stopped wins over
-- superseded — it is the reason the user would recognise.
--
-- Error shape: RAISE ... USING ERRCODE + DETAIL, where DETAIL is a JSON
-- object {"generation": n, "max_generation": m} — PostgREST surfaces it as
-- `details` and the app parses it defensively (classifyAtomicFenceError:
-- a malformed detail costs the two numbers, never the refusal).
--
-- Naming: a NEW, distinctly named function — never a same-name overload
-- (the 2026-04-26 PostgREST "could not choose the best candidate" outage
-- precedent; same reasoning as v3's header). v2 and v3 stay intact and
-- callable throughout; the app calls v4 only for graph-bearing writes whose
-- turn holds an admitted claim, and falls back to v2/v3 whenever v4 is
-- absent.
--
-- Idempotent-replay interaction (deliberate, matches the live two-step): the
-- fence gate runs BEFORE the conversation-turn insert, so a replay of an
-- already-committed turn that has SINCE been stopped or superseded is
-- REFUSED rather than answered with the existing row id — byte-for-byte the
-- verdict the pre-v4 evaluation gives that replay today. A replay on a
-- still-current turn passes the gate and takes the ON CONFLICT branch
-- exactly as in v3 (nothing re-mutated).
--
-- Grants: Supabase default privileges auto-grant EXECUTE to anon/
-- authenticated on new public functions (the A4 lesson). Revoke both plus
-- PUBLIC explicitly; grant service_role only — same posture as v2/v3.
--
-- Rollback:
--   rollback/20260731130000_v5_turn_fence_atomic_append_rollback.sql.do-not-apply
--   drops the function. The app's feature-detect then answers PGRST202 on
--   the next graph write per instance and every commit takes the pre-v4
--   two-step again — rollback is a pure de-optimisation back to the
--   documented window, no data migration in either direction.
--
-- Verification (run after the separately-sequenced execution):
--   SELECT proname, pronargs FROM pg_proc WHERE proname = 'append_turn_atomic_v4';
--     -- Expected: exactly one row, pronargs = 19.
--   SELECT has_function_privilege('service_role',
--     'public.append_turn_atomic_v4(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint)',
--     'EXECUTE');  -- true
--   SELECT has_function_privilege('anon',
--     'public.append_turn_atomic_v4(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint)',
--     'EXECUTE');  -- false (and same for 'authenticated')
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
  -- 2.174 fix c — the caller's ADMITTED fence generation. NULL skips the
  -- fence gate entirely (v3-equivalent), which is also what keeps this
  -- function safe for any future non-fenced caller.
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

  -- ── 2.174 fix c: the IN-TRANSACTION fence gate ─────────────────────
  IF p_fence_generation IS NOT NULL AND p_graph IS NOT NULL THEN
    -- Lock THIS turn's fence row: v5_mark_turn_stopped upserts the same
    -- row, so a concurrent Stop serialises here — commits-first (seen
    -- below, append refused) or waits (already_committed then reads TRUE).
    SELECT generation, stopped_at
      INTO v_fence_generation, v_fence_stopped_at
      FROM v5_turn_fence
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLTF3',
        MESSAGE = format(
          'append_turn_atomic_v4: no fence row for scenario %s turn %s — the write cannot be ordered',
          p_scenario_id, p_turn_id),
        DETAIL = '{}';
    END IF;

    SELECT MAX(generation) INTO v_fence_max
      FROM v5_turn_fence
      WHERE scenario_id = p_scenario_id;

    IF v_fence_stopped_at IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLTF1',
        MESSAGE = format(
          'append_turn_atomic_v4: turn %s on scenario %s was explicitly stopped at %s',
          p_turn_id, p_scenario_id, v_fence_stopped_at),
        DETAIL = format('{"generation": %s, "max_generation": %s}',
                        v_fence_generation, v_fence_max);
    END IF;

    IF p_fence_generation < v_fence_max THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLTF2',
        MESSAGE = format(
          'append_turn_atomic_v4: turn %s (generation %s) is superseded on scenario %s (max generation %s)',
          p_turn_id, p_fence_generation, p_scenario_id, v_fence_max),
        DETAIL = format('{"generation": %s, "max_generation": %s}',
                        p_fence_generation, v_fence_max);
    END IF;
  END IF;

  -- ── From here down: v3's body, verbatim ────────────────────────────
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

-- ── Lockdown — service-role only (A4 posture, identical to v2/v3) ──
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
  'V5 turn append with the TURN FENCE checked inside the transaction (2.174 fix c): '
  'v3 body verbatim + a FOR UPDATE gate on the turn''s own v5_turn_fence row raising '
  'OLTF1 (stopped) / OLTF2 (superseded) / OLTF3 (unclaimed) with {"generation","max_generation"} '
  'in DETAIL. Closes the evaluate-then-append window. service_role only.';
