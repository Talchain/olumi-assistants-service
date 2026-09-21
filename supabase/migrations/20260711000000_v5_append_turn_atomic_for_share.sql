-- ============================================================
-- Claim-race closure — FOR SHARE on every plain scenarios.user_id read
-- in the turn-append path (login 3.4 follow-through; the "separate
-- FOR SHARE lane" named by 20260710190000_v5_claim_guest_scenario.sql).
--
-- ⚠️  AUTHORED AS CODE — NOT YET EXECUTED. Execution is Paul-gated
--     (batched by the orchestrator, same batch as 20260710190000).
--     Update this header with the execution date + evidence pointer
--     when applied, per the 20260705120000_v5_model_versions.sql
--     precedent.
--
-- Target: Staging Supabase
-- Date authored: 2026-07-10
-- Date executed: (pending)
--
-- Why (verified evidence, review of PR #410, 2026-07-10):
--   claim_guest_scenario locks the scenarios row FOR UPDATE, stamps
--   user_id, and re-stamps the denormalised NULL user_id copies on
--   v5_conversation_turns / v5_handler_facts. But the append path reads
--   scenarios with a PLAIN SELECT (no lock), so a turn streaming while
--   the claim commits can read the pre-claim NULL user_id and insert
--   NULL-stamped turn/fact rows AFTER the claim's denormalisation
--   UPDATEs have already run. Those rows are invisible to the new
--   owner's RLS reads. The #410 replay branch re-runs the UPDATEs — but
--   ONLY on a claim RETRY: a single successful login claim (the normal
--   case) leaves the stranded rows permanently orphaned with no repair
--   path. This migration closes the race at its source: the appenders'
--   scenarios read becomes SELECT ... FOR SHARE, which serialises
--   against the claim's FOR UPDATE —
--     - append first: the claim's FOR UPDATE waits for the append to
--       commit, so its denormalisation UPDATEs see (and stamp) the
--       appended rows;
--     - claim first: the append's FOR SHARE waits for the claim to
--       commit, then reads the post-claim owner and stamps correctly.
--   The #410 replay-branch repair remains in place as belt-and-braces.
--
-- Complete surface (sweep of every function in supabase/migrations at
-- staging tip 1361f1d75 for scenarios reads; claim type: plain-SELECT
-- reads of scenarios.user_id in currently-live function definitions):
--   1. append_turn_atomic      (13-arg; live def: 20260602120000)  — in scope
--   2. append_turn_atomic_v2   (15-arg; live def: 20260609120000)  — in scope
--   3. ensure_scenario_exists  ( 2-arg; live def: 20260422000000)  — in scope
--      (returns the authoritative user_id to the app preflight; a
--      plain read racing a claim would report a just-claimed scenario
--      as guest/NULL to the caller)
--   Checked and EXCLUDED (no NULL-user_id strand possible):
--   - store_draft_graph — writes scenarios.graph; never reads user_id.
--   - create_decision_record / record_decision_outcome /
--     create_model_version / restore_model_version — guest scenarios
--     are refused at write time (owner columns NOT NULL, DR001/MV001),
--     so no unowned rows exist to strand; record_decision_outcome
--     already takes FOR UPDATE.
--   - create_shared_brief — requires user_id = auth.uid() at create;
--     a guest can never have created one.
--   - Superseded earlier definitions of append_turn_atomic
--     (20260417160000 / 20260422000000 / 20260422200000 /
--     20260422210000 / 20260502120000 / 20260505120000) are dead —
--     each was replaced in place by the next CREATE OR REPLACE.
--
-- Change discipline (verify by diff, not trust):
--   Each function body below is byte-identical to its live definition
--   EXCEPT the single scenarios read. Proof — `diff <live def> <this
--   file's def>` per function:
--
--   append_turn_atomic (vs 20260602120000 lines 128-229):
--   27c27
--   <   SELECT user_id INTO v_user_id FROM scenarios WHERE id = p_scenario_id;
--   ---
--   >   SELECT user_id INTO v_user_id FROM scenarios WHERE id = p_scenario_id FOR SHARE;
--
--   append_turn_atomic_v2 (vs 20260609120000 lines 126-231):
--   29c29
--   <   SELECT user_id INTO v_user_id FROM scenarios WHERE id = p_scenario_id;
--   ---
--   >   SELECT user_id INTO v_user_id FROM scenarios WHERE id = p_scenario_id FOR SHARE;
--
--   ensure_scenario_exists (vs 20260422000000 lines 71-102):
--   23c23,24
--   <     WHERE id = p_scenario_id;
--   ---
--   >     WHERE id = p_scenario_id
--   >     FOR SHARE;
--
-- Known, accepted trade (documented, not hidden):
--   append_turn_atomic(_v2) later UPDATE scenarios in the same
--   transaction (graph write / write-once brief_text), which upgrades
--   the FOR SHARE row lock to exclusive. Two CONCURRENT appends for the
--   SAME scenario that both reach an UPDATE can therefore deadlock
--   (40P01) where they previously serialised on the UPDATE itself;
--   Postgres aborts one, the turn commit fails VISIBLY, and the
--   (scenario_id, turn_id) idempotency guard makes the retry safe. A
--   rare, visible, retryable error replaces a silent permanent data
--   strand. (FOR NO KEY UPDATE would avoid the upgrade but serialises
--   ALL same-scenario appends — a throughput change beyond the reviewed
--   FOR SHARE design, so not taken here.)
--
-- Grants / comments posture:
--   Signatures are UNCHANGED, so CREATE OR REPLACE preserves existing
--   ACLs and COMMENTs by itself; the grants below are re-issued
--   explicitly anyway (A4 house posture) and are byte-identical to each
--   function's source migration. Deliberately NOT changed: legacy
--   append_turn_atomic's known anon/authenticated ACL exposure
--   (flagged by the 20260609120000 header for a separate security
--   lane) — this migration must not smuggle in a grant change.
--
-- Rollback: rollback/20260711000000_v5_append_turn_atomic_for_share_rollback.sql.do-not-apply
--   restores the exact prior definitions (and re-issues the same grants).
--
-- Verification (run after the separately-approved execution):
--   SELECT proname FROM pg_proc
--     WHERE proname IN ('append_turn_atomic','append_turn_atomic_v2',
--                       'ensure_scenario_exists')
--       AND prosrc LIKE '%FOR SHARE%';
--     -- Expected: exactly 3 rows.
--   SELECT proname, pronargs FROM pg_proc
--     WHERE proname LIKE 'append_turn_atomic%';
--     -- Expected: append_turn_atomic 13, append_turn_atomic_v2 15
--     --           (one row each — no new overloads).
--   SELECT has_function_privilege('service_role',
--     'public.append_turn_atomic(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb)',
--     'EXECUTE');  -- true
--   SELECT has_function_privilege('service_role',
--     'public.append_turn_atomic_v2(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text)',
--     'EXECUTE');  -- true
--   SELECT has_function_privilege('anon',
--     'public.append_turn_atomic_v2(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text)',
--     'EXECUTE');  -- false (and same for 'authenticated')
--   SELECT has_function_privilege('service_role',
--     'public.ensure_scenario_exists(uuid, uuid)', 'EXECUTE');  -- true
-- ============================================================

-- ── 1. append_turn_atomic (13-arg): scenarios read gains FOR SHARE ──
-- Body from 20260602120000 verbatim except the locked read (see header
-- diff). The FOUND-based idempotency guard and all write behaviour are
-- untouched.

CREATE OR REPLACE FUNCTION public.append_turn_atomic(
  p_scenario_id      UUID,
  p_turn_id          TEXT,
  p_turn_class       TEXT,
  p_handler_id       TEXT,
  p_request_hash     TEXT,
  p_response_emitted BOOLEAN,
  p_llm_calls_used   INTEGER,
  p_duration_ms      INTEGER,
  p_handler_facts    JSONB,
  p_graph            JSONB DEFAULT NULL,
  p_brief_text       TEXT  DEFAULT NULL,
  p_pending_actions  JSONB DEFAULT '[]'::jsonb,
  p_coaching_state   JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_turn_id   UUID;
  v_user_id   UUID;
  v_fact      JSONB;
  v_updated   INTEGER;
BEGIN
  SELECT user_id INTO v_user_id FROM scenarios WHERE id = p_scenario_id FOR SHARE;
  -- Use FOUND (set by SELECT INTO) to distinguish "row absent" from
  -- "guest row with user_id IS NULL".
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scenario % not found', p_scenario_id;
  END IF;

  INSERT INTO v5_conversation_turns (
    scenario_id, user_id, turn_id, turn_class, handler_id,
    request_hash, response_emitted, llm_calls_used, duration_ms,
    pending_actions, coaching_state
  ) VALUES (
    p_scenario_id, v_user_id, p_turn_id, p_turn_class, p_handler_id,
    p_request_hash, p_response_emitted, p_llm_calls_used, p_duration_ms,
    COALESCE(p_pending_actions, '[]'::jsonb), p_coaching_state
  )
  ON CONFLICT (scenario_id, turn_id) DO NOTHING
  RETURNING id INTO v_turn_id;

  IF NOT FOUND THEN
    -- Conflict replay: deduplicated turn, idempotent return.
    -- Do NOT write p_graph, p_brief_text, p_pending_actions, or
    -- p_coaching_state — v5_conversation_turns and scenarios must not be
    -- mutated on retry. This is the load-bearing idempotency invariant.
    SELECT id INTO v_turn_id
      FROM v5_conversation_turns
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
    RETURN v_turn_id;
  END IF;

  -- New turn inserted. Now write the graph atomically in the same transaction.
  -- Gating on FOUND (above) ensures this block never runs on conflict replay,
  -- preserving the idempotency invariant for graph writes.
  IF p_graph IS NOT NULL THEN
    UPDATE scenarios SET graph = p_graph WHERE id = p_scenario_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      -- Should never happen: step 1 confirmed the scenarios row exists.
      -- Raise so the anomaly surfaces rather than being silently dropped.
      RAISE EXCEPTION 'append_turn_atomic: scenarios row % vanished between SELECT and UPDATE', p_scenario_id;
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

  -- V5 Phase 1 brief persistence: write user-supplied brief_text once.
  -- First-write-wins enforced by the WHERE predicate. ROW_COUNT is NOT
  -- checked here — a "no rows updated" outcome means the brief was
  -- already set, which is the intended write-once behaviour.
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

REVOKE EXECUTE ON FUNCTION public.append_turn_atomic(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.append_turn_atomic(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb
) TO service_role;

-- ── 2. append_turn_atomic_v2 (15-arg): scenarios read gains FOR SHARE ──
-- Body from 20260609120000 verbatim except the locked read (see header
-- diff).

CREATE OR REPLACE FUNCTION public.append_turn_atomic_v2(
  p_scenario_id      UUID,
  p_turn_id          TEXT,
  p_turn_class       TEXT,
  p_handler_id       TEXT,
  p_request_hash     TEXT,
  p_response_emitted BOOLEAN,
  p_llm_calls_used   INTEGER,
  p_duration_ms      INTEGER,
  p_handler_facts    JSONB,
  p_graph            JSONB DEFAULT NULL,
  p_brief_text       TEXT  DEFAULT NULL,
  p_pending_actions  JSONB DEFAULT '[]'::jsonb,
  p_coaching_state   JSONB DEFAULT NULL,
  p_user_message     TEXT  DEFAULT NULL,
  p_assistant_message TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_turn_id   UUID;
  v_user_id   UUID;
  v_fact      JSONB;
  v_updated   INTEGER;
BEGIN
  SELECT user_id INTO v_user_id FROM scenarios WHERE id = p_scenario_id FOR SHARE;
  -- Use FOUND (set by SELECT INTO) to distinguish "row absent" from
  -- "guest row with user_id IS NULL".
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scenario % not found', p_scenario_id;
  END IF;

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
    -- Conflict replay: deduplicated turn, idempotent return.
    -- Do NOT write p_graph, p_brief_text, p_pending_actions,
    -- p_coaching_state, or the content columns — v5_conversation_turns
    -- and scenarios must not be mutated on retry. This is the
    -- load-bearing idempotency invariant.
    SELECT id INTO v_turn_id
      FROM v5_conversation_turns
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
    RETURN v_turn_id;
  END IF;

  -- New turn inserted. Now write the graph atomically in the same transaction.
  -- Gating on FOUND (above) ensures this block never runs on conflict replay,
  -- preserving the idempotency invariant for graph writes.
  IF p_graph IS NOT NULL THEN
    UPDATE scenarios SET graph = p_graph WHERE id = p_scenario_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      -- Should never happen: step 1 confirmed the scenarios row exists.
      -- Raise so the anomaly surfaces rather than being silently dropped.
      RAISE EXCEPTION 'append_turn_atomic_v2: scenarios row % vanished between SELECT and UPDATE', p_scenario_id;
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

  -- V5 Phase 1 brief persistence: write user-supplied brief_text once.
  -- First-write-wins enforced by the WHERE predicate. ROW_COUNT is NOT
  -- checked here — a "no rows updated" outcome means the brief was
  -- already set, which is the intended write-once behaviour.
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

REVOKE EXECUTE ON FUNCTION public.append_turn_atomic_v2(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.append_turn_atomic_v2(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text
) TO service_role;

-- ── 3. ensure_scenario_exists (2-arg): scenarios read gains FOR SHARE ──
-- Body from 20260422000000 verbatim except the locked read (see header
-- diff). The read here is the authoritative-user_id re-read after the
-- idempotent upsert; FOR SHARE makes it wait out an in-flight claim
-- instead of reporting a just-claimed scenario as guest.

CREATE OR REPLACE FUNCTION ensure_scenario_exists(
  p_scenario_id UUID,
  p_user_id     UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Idempotent upsert. ON CONFLICT DO NOTHING never overwrites an
  -- existing row's user_id. p_user_id is NULL for guest sessions.
  INSERT INTO scenarios (id, user_id)
  VALUES (p_scenario_id, p_user_id)
  ON CONFLICT (id) DO NOTHING;

  -- Re-read the stored user_id. Use FOUND (set by SELECT INTO in
  -- PL/pgSQL) to distinguish row-absent from guest-row-with-null-user_id.
  SELECT user_id INTO v_user_id
    FROM scenarios
    WHERE id = p_scenario_id
    FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ensure_scenario_exists: scenario % neither inserted nor found', p_scenario_id;
  END IF;

  -- Return the authoritative user_id (NULL for guest rows).
  RETURN v_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION ensure_scenario_exists(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION ensure_scenario_exists(UUID, UUID) TO service_role;
