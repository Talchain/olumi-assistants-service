-- ============================================================
-- V5 Conversation Context Reliability — durable conversation CONTENT
-- (migration-only; NO app wiring in this change — that is the app PR).
-- Target: Staging Supabase
-- Date: 2026-06-09
--
-- Why:
--   v5_conversation_turns persists turn METADATA only (turn_class,
--   handler_id, request_hash, timings, pending_actions, coaching_state).
--   It does NOT store the user's message text or the assistant's answer
--   text. The ContextPack therefore projects content-free turn stubs to
--   the LLM, so ordinary follow-ups ("Why?", "do that", "the second one",
--   "what changed?") cannot be resolved. This migration adds DB support
--   ONLY: two nullable TEXT columns plus a NEW, distinctly-named save RPC
--   `append_turn_atomic_v2` that writes them. No app code calls the new
--   RPC yet; that ships in the app PR, which MUST NOT deploy until this
--   migration is live and verified.
--
-- Deployment-order safety (why this is split migration-first):
--   Render auto-deploys the app on every staging push; Supabase
--   migrations apply out-of-band. So this migration MUST be live before
--   any app build that calls `append_turn_atomic_v2`. It is backward
--   compatible in BOTH directions and — unlike the coaching_state /
--   pending_actions migrations — DOES NOT drop or replace the existing
--   `append_turn_atomic`:
--     - Old app (still calling the 13-arg `append_turn_atomic`): unchanged
--       and fully working. The two new columns are NULLABLE with no
--       default, so the existing INSERT (which omits them) writes NULL.
--     - New app (app PR): calls the new `append_turn_atomic_v2` only.
--   A DISTINCT FUNCTION NAME (not a same-name overload) is used
--   deliberately: it eliminates the PostgREST candidate-ambiguity class
--   (the 20260426160532 bug) by construction — there is only ever one
--   function of each name. The old `append_turn_atomic` is retired in a
--   SEPARATE later cleanup migration, only after the new app is deployed
--   and verified.
--
-- Backward compatibility:
--   - New columns are NULLABLE, NO default. NULL is meaningful: "no
--     conversation content persisted for this turn" (old rows, system /
--     internal-event turns, and — until the app PR — every turn). Do NOT
--     default to ''.
--   - `append_turn_atomic_v2`'s two new params have DEFAULT NULL.
--   - Conflict-replay idempotency (FOUND-based) is preserved verbatim:
--     same-(scenario_id, turn_id) retries do NOT mutate the existing row,
--     including the new content columns.
--
-- DB-layer constraint posture:
--   No length CHECK is added. Length capping is the app's job (it caps
--   before the RPC call). A DB CHECK that rejected an over-long value
--   would convert a content-cap bug into a LOST TURN (the whole commit
--   would fail), which is strictly worse than a truncated message. The
--   column comment records the app-side cap as the contract.
--
-- Privacy / data-safety (verified against staging before this lane):
--   - RLS is enabled on v5_conversation_turns; the only non-service
--     policy is SELECT `auth.uid() = user_id`. There is no INSERT/UPDATE/
--     DELETE policy for anon/authenticated, so only the service role
--     (CEE) writes. The new columns inherit this exact posture — they are
--     not separately exposed.
--   - v5_conversation_turns.scenario_id -> scenarios is ON DELETE CASCADE,
--     so deleting a scenario deletes its conversation rows (including this
--     content). Deletion requirement satisfied with no extra wiring.
--   - Stored assistant text is the FINAL public, user-visible answer only
--     (captured post-compose/safety by the app) — never raw LLM output,
--     hidden summaries, or blocked content. Telemetry logs IDs / counts /
--     lengths / booleans only, never the text.
--   - NOTE: this introduces durable conversation-content storage; a
--     retention stance is owed before enterprise use (see lane report).
--
-- Verification (run after migration applies):
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--     WHERE table_schema = 'public' AND table_name = 'v5_conversation_turns'
--       AND column_name IN ('user_message','assistant_message');
--     -- Expected: two rows, text, YES, NULL (no default).
--   SELECT proname, pronargs FROM pg_proc WHERE proname LIKE 'append_turn_atomic%';
--     -- Expected: append_turn_atomic (13 args) STILL PRESENT,
--     --           append_turn_atomic_v2 (15 args) NEW.
--   SELECT has_function_privilege('service_role',
--     'public.append_turn_atomic_v2(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text)',
--     'EXECUTE');
--     -- Expected: true.
--   -- Old-app safety: an INSERT via the existing append_turn_atomic still
--   -- succeeds and writes NULL into the two new columns.
--   -- PostgREST schema cache auto-reloads on DDL; if PGRST202 is seen,
--   -- force a reload: NOTIFY pgrst, 'reload schema';
-- ============================================================

-- 1. Add the two content columns. NULLABLE, NO default.
ALTER TABLE public.v5_conversation_turns
  ADD COLUMN IF NOT EXISTS user_message TEXT;
ALTER TABLE public.v5_conversation_turns
  ADD COLUMN IF NOT EXISTS assistant_message TEXT;

-- 2. Documentation. Operators reading \d v5_conversation_turns should
--    understand the source of truth, the app-side cap contract, and the
--    safety posture.
COMMENT ON COLUMN public.v5_conversation_turns.user_message IS
  'V5 Conversation Context Reliability: the user''s verbatim turn message '
  '(payload.message), captured by the app at commit. NULL means no user '
  'text for this turn (old rows, system/internal-event turns, pre-app-PR '
  'turns). Length-capped APP-SIDE before the RPC (no DB CHECK, so an '
  'over-long value can never fail the turn commit). Written only via '
  'append_turn_atomic_v2(p_user_message).';
COMMENT ON COLUMN public.v5_conversation_turns.assistant_message IS
  'V5 Conversation Context Reliability: the FINAL public, user-visible '
  'assistant answer text for this turn, captured by the app post-compose/'
  'safety. NEVER raw LLM output, hidden summaries, debug, or blocked '
  'content. NULL means no assistant text for this turn. Length-capped '
  'APP-SIDE before the RPC. Written only via '
  'append_turn_atomic_v2(p_assistant_message).';

-- 3. Create the NEW save RPC. Distinct name (no overload of
--    append_turn_atomic) so there is zero PostgREST candidate ambiguity
--    and the existing function is left completely intact for the
--    currently-deployed app. Body is the current append_turn_atomic
--    (13-arg) verbatim with TWO surgical additions:
--      a. p_user_message / p_assistant_message TEXT DEFAULT NULL as the
--         final two parameters;
--      b. the v5_conversation_turns INSERT also writes user_message and
--         assistant_message (passed through verbatim — NOT COALESCE'd; the
--         columns are nullable and NULL is meaningful).
--    The FOUND-based idempotency guard remains the load-bearing invariant:
--    on conflict replay the function returns the existing row id without
--    touching the content columns (or any other column).
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
  SELECT user_id INTO v_user_id FROM scenarios WHERE id = p_scenario_id;
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

-- 4. Lock down EXECUTE on the new function to the service role ONLY.
--    CEE calls every RPC with the service-role key. Supabase's default
--    privileges GRANT EXECUTE to `anon` and `authenticated` on new public
--    functions, so REVOKE FROM PUBLIC alone is insufficient — those are
--    direct role grants, not PUBLIC. We revoke them explicitly. This makes
--    append_turn_atomic_v2 STRICTLY SAFER than the legacy
--    append_turn_atomic (whose ACL still lists anon/authenticated — a
--    pre-existing latent exposure flagged for a separate security lane):
--    a SECURITY DEFINER function that writes durable conversation CONTENT
--    must not be callable with the public anon key (which could otherwise
--    poison any existing scenario's conversation history).
REVOKE EXECUTE ON FUNCTION public.append_turn_atomic_v2(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.append_turn_atomic_v2(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text
) TO service_role;
