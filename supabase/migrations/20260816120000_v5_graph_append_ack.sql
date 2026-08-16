-- ============================================================
-- V5 GRAPH APPEND ACKNOWLEDGEMENT
--
-- DB-FIRST ROLLOUT (do not deploy the app first):
--   1. Apply this additive migration and refresh PostgREST schema cache.
--   2. Probe inserted / identical replay / divergent replay with service_role.
--   3. Deploy the app, then drain all workers still capable of graph writes
--      through append_turn_atomic_v2/v3/v4.
--
-- The app deliberately has NO graph-bearing fallback when this function is
-- absent or its acknowledgement is malformed. Non-graph turns remain on v2.
-- Rollback is app-first; see the checked-in .do-not-apply rollback companion.
-- Date authored: 2026-08-16. External DB state was not changed by authorship.
-- ============================================================

-- Immutable witness for the exact JSONB accepted with this turn. Legacy rows
-- remain NULL and therefore classify as divergent/unverifiable on replay.
ALTER TABLE public.v5_conversation_turns
  ADD COLUMN IF NOT EXISTS accepted_graph JSONB;

COMMENT ON COLUMN public.v5_conversation_turns.accepted_graph IS
  'Immutable exact JSONB graph accepted atomically with this graph-bearing turn. '
  'NULL on legacy and graph-free rows. Used only to classify idempotent replay; '
  'it is not current workspace authority (scenarios.graph is current).';

CREATE OR REPLACE FUNCTION public.v5_guard_accepted_graph_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.accepted_graph IS DISTINCT FROM NEW.accepted_graph THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'v5_conversation_turns.accepted_graph is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS v5_conversation_turns_accepted_graph_immutable
  ON public.v5_conversation_turns;
CREATE TRIGGER v5_conversation_turns_accepted_graph_immutable
  BEFORE UPDATE OF accepted_graph ON public.v5_conversation_turns
  FOR EACH ROW
  EXECUTE FUNCTION public.v5_guard_accepted_graph_immutable();

REVOKE EXECUTE ON FUNCTION public.v5_guard_accepted_graph_immutable()
  FROM PUBLIC, anon, authenticated;

-- One graph-only successor, not three acknowledgement twins. Its first 19
-- arguments preserve v4's fence/CAS/current-write contract. p_graph is
-- required by behaviour (a NULL call raises) and every outcome is a strict
-- JSONB object: {id, disposition}.
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
  p_brief_text                   TEXT    DEFAULT NULL,
  p_pending_actions              JSONB   DEFAULT '[]'::jsonb,
  p_coaching_state               JSONB   DEFAULT NULL,
  p_user_message                 TEXT    DEFAULT NULL,
  p_assistant_message            TEXT    DEFAULT NULL,
  p_expected_graph_identity_hash TEXT    DEFAULT NULL,
  p_incoming_graph_identity_hash TEXT    DEFAULT NULL,
  p_cas_enforce                  BOOLEAN DEFAULT FALSE,
  p_fence_generation             BIGINT  DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_turn_id             UUID;
  v_existing_graph      JSONB;
  v_user_id             UUID;
  v_current_hash        TEXT;
  v_has_graph           BOOLEAN;
  v_fact                JSONB;
  v_updated             INTEGER;
  v_fence_generation    BIGINT;
  v_fence_stopped_at    TIMESTAMPTZ;
  v_fence_max           BIGINT;
BEGIN
  IF p_graph IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'append_turn_atomic_v5 requires a non-null graph';
  END IF;

  -- Serialise every graph writer on current scenario authority. This is also
  -- what makes concurrent same-key A/A and A/C classification deterministic.
  SELECT user_id, graph_identity_hash, (graph IS NOT NULL)
    INTO v_user_id, v_current_hash, v_has_graph
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scenario % not found', p_scenario_id;
  END IF;

  -- Replay is classified before fence/CAS and performs zero mutation. JSONB
  -- IS NOT DISTINCT FROM gives value equality: object key order is ignored,
  -- while arrays, explicit []/null, and every nested value remain material.
  -- Direct probe controls after DB-first rollout:
  --   {"a":1,"b":2} vs {"b":2,"a":1} => identical;
  --   [1,2] vs [2,1], {"x":null} vs {}, and {"x":[]} vs {"x":null}
  --   => divergent.
  SELECT id, accepted_graph
    INTO v_turn_id, v_existing_graph
    FROM public.v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'id', v_turn_id,
      'disposition',
      CASE
        WHEN v_existing_graph IS NOT DISTINCT FROM p_graph
          THEN 'replayed_identical'
        ELSE 'replayed_divergent'
      END
    );
  END IF;

  -- Generation-keyed in-transaction fence (v4 semantics). NULL preserves the
  -- explicitly unfenced/externally checked path; a claimed graph write always
  -- supplies its generation from the ingress handle.
  IF p_fence_generation IS NOT NULL THEN
    SELECT generation, stopped_at
      INTO v_fence_generation, v_fence_stopped_at
      FROM public.v5_turn_fence
      WHERE scenario_id = p_scenario_id
        AND generation = p_fence_generation
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLTF3',
        MESSAGE = format(
          'append_turn_atomic_v5: no fence row for scenario %s at generation %s',
          p_scenario_id, p_fence_generation),
        DETAIL = '{}';
    END IF;

    SELECT MAX(generation) INTO v_fence_max
      FROM public.v5_turn_fence
      WHERE scenario_id = p_scenario_id;

    IF v_fence_stopped_at IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLTF1',
        MESSAGE = format(
          'append_turn_atomic_v5: generation %s on scenario %s was stopped',
          v_fence_generation, p_scenario_id),
        DETAIL = format('{"generation": %s, "max_generation": %s}',
                        v_fence_generation, v_fence_max);
    END IF;

    -- Preserve v4's atomic first-write exemption. Once a current graph exists,
    -- an older generation cannot overwrite it; on a graph-less scenario the
    -- first real graph may land even if a later graph-free turn superseded it.
    IF p_fence_generation < v_fence_max AND v_has_graph THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLTF2',
        MESSAGE = format(
          'append_turn_atomic_v5: generation %s is superseded on scenario %s (max %s)',
          p_fence_generation, p_scenario_id, v_fence_max),
        DETAIL = format('{"generation": %s, "max_generation": %s}',
                        p_fence_generation, v_fence_max);
    END IF;
  END IF;

  -- Store the acknowledgement witness in the same INSERT that establishes
  -- idempotency. ON CONFLICT handles a graph-free/other-worker race that may
  -- have inserted the key after the pre-read; it is classified below without
  -- writing scenarios.graph, facts, brief, or any other side effect.
  INSERT INTO public.v5_conversation_turns (
    scenario_id, user_id, turn_id, turn_class, handler_id,
    request_hash, response_emitted, llm_calls_used, duration_ms,
    pending_actions, coaching_state, user_message, assistant_message,
    accepted_graph
  ) VALUES (
    p_scenario_id, v_user_id, p_turn_id, p_turn_class, p_handler_id,
    p_request_hash, p_response_emitted, p_llm_calls_used, p_duration_ms,
    COALESCE(p_pending_actions, '[]'::jsonb), p_coaching_state,
    p_user_message, p_assistant_message, p_graph
  )
  ON CONFLICT (scenario_id, turn_id) DO NOTHING
  RETURNING id INTO v_turn_id;

  IF NOT FOUND THEN
    SELECT id, accepted_graph
      INTO v_turn_id, v_existing_graph
      FROM public.v5_conversation_turns
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
    RETURN jsonb_build_object(
      'id', v_turn_id,
      'disposition',
      CASE
        WHEN v_existing_graph IS NOT DISTINCT FROM p_graph
          THEN 'replayed_identical'
        ELSE 'replayed_divergent'
      END
    );
  END IF;

  -- CAS deliberately follows the successful INSERT. A raised OLGC1 aborts
  -- this function statement/transaction, so PostgreSQL rolls the just-inserted
  -- turn and accepted_graph witness back with it. There is no exception handler
  -- that can swallow the raise and leave a false accepted-insert row behind.
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
        'append_turn_atomic_v5: stale graph write for scenario %s (expected %s, current %s)',
        p_scenario_id, p_expected_graph_identity_hash, v_current_hash);
  END IF;

  UPDATE public.scenarios
     SET graph = p_graph,
         graph_identity_hash = p_incoming_graph_identity_hash
   WHERE id = p_scenario_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'append_turn_atomic_v5: scenarios row % vanished under lock', p_scenario_id;
  END IF;

  IF jsonb_array_length(COALESCE(p_handler_facts, '[]'::jsonb)) > 0 THEN
    FOR v_fact IN SELECT * FROM jsonb_array_elements(p_handler_facts)
    LOOP
      INSERT INTO public.v5_handler_facts (
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
    UPDATE public.scenarios
       SET brief_text = p_brief_text,
           updated_at = NOW()
     WHERE id = p_scenario_id
       AND (brief_text IS NULL OR brief_text = '');
  END IF;

  RETURN jsonb_build_object('id', v_turn_id, 'disposition', 'inserted');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.append_turn_atomic_v5(
  uuid, text, text, text, text, boolean, integer, integer, jsonb,
  jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.append_turn_atomic_v5(
  uuid, text, text, text, text, boolean, integer, integer, jsonb,
  jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint
) TO service_role;

COMMENT ON FUNCTION public.append_turn_atomic_v5(
  uuid, text, text, text, text, boolean, integer, integer, jsonb,
  jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint
) IS
  'Graph-only atomic append with strict inserted/replayed_identical/replayed_divergent JSONB acknowledgement. '
  'Stores immutable per-turn accepted_graph, preserves v4 fence/CAS/first-write semantics, and writes facts/current graph only for inserted. service_role only.';
