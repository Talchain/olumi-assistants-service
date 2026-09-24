-- =============================================================================
-- decision_records — "NOT READY TO CHOOSE" + DURABLE REASONING TEXT (2026-09-24)
-- Contract: @talchain/schemas 0.57.0 (DecisionRecordNotReadyPositionSchema; the
-- four optional reasoning fields; DECISION_RECORD_TEXT_MAX_CHARS = 1000).
-- Approved by Paul (product owner) 2026-09-24.
-- =============================================================================
--
-- ⛔ EXECUTION: NOT EXECUTED BY THIS CHANGE. Applying it to any database is a
--   separate, Paul-gated ops step. Until it is applied, the CEE route that
--   sends the new fields gets a 22023 from the LIVE function for any payload
--   that uses them (→ 502 store_error, nothing written), while TODAY'S payload
--   is byte-identical and keeps working — see "Deploy ordering" below.
--
-- WHAT CHANGES (forward-only, additive — no new column, no row rewritten, no
-- signature change):
--
--   1. `dr_decision_shape` (table CHECK) is replaced. It used to require
--      chosen_option_id + chosen_option_label + graph_hash. It now requires
--      graph_hash AND EXACTLY ONE of:
--        - chosen option: no `position` key, both option keys present
--          (every row that exists today satisfies this — re-validation on
--          ADD CONSTRAINT cannot fail on existing data);
--        - not ready:     position = 'not_ready', NEITHER option key present.
--      Any other `position` value is refused at the table, not just the RPC.
--
--   1b. A NOT-READY POSITION MAKES NO PREDICTION (reconciled 2026-09-24, Paul's
--      product semantics: no option, no confidence, no expectation). The
--      expectation and the stated confidence are claims about a CHOSEN
--      option's outcome, so without a choice both are claims about nothing.
--      `prediction` loses NOT NULL, and `dr_prediction_shape` is replaced by
--      a CHECK that TIES the two: a not-ready row has `prediction IS NULL`;
--      every other row has a non-NULL object with a `statement` — exactly the
--      old requirement, so every existing row (all chosen, all with a
--      statement under the old NOT NULL + CHECK) re-validates unchanged. The
--      RPCs already return the record through jsonb_strip_nulls, so a
--      not-ready record comes back with NO `prediction` key, which is the
--      schemas 0.57.0 shape.
--
--   2. `create_decision_record` is replaced IN PLACE (same 8-parameter
--      signature — CREATE OR REPLACE, so no overload is created, per the
--      distinct-names/no-overloads rule in 20260710113000's header). Its body
--      is GENERATED from 20260710113000's function text by three asserted
--      transformations, never hand-copied; everything outside them is
--      byte-identical (the static-guard test proves it):
--        a. the p_decision guards branch on the PRESENCE of `position`:
--             - not-ready: position must be 'not_ready'; whitelist
--               {position, graph_hash, committed_by_user, rationale,
--               key_assumption, revisit_trigger, next_action} — so it may NOT
--               name an option; graph_hash non-empty; committed_by_user
--               REQUIRED and true;
--             - chosen: the pre-0.57.0 guards unchanged, whitelist widened by
--               the four reasoning keys;
--           then, on either branch, each reasoning key is optional and, when
--           present, a non-empty string with char_length <= 1000.
--        b. the `decision_recorded` journey event's details gain
--           `'position', p_decision->>'position'` — NULL and therefore
--           STRIPPED on a chosen record (byte-identical to today), and
--           'not_ready' on a not-ready one (which carries no option keys).
--        c. the p_prediction guard branches on the same PRESENCE of
--           `position`: on a not-ready decision p_prediction must be NULL
--           (SQL NULL, or a JSON null normalised to SQL NULL) and anything
--           else is refused 22023; on a chosen decision the pre-0.57.0 guard
--           runs unchanged (IF becomes ELSIF, nothing else), so a NULL
--           p_prediction is still refused there by its first clause.
--
--   `review_date`, `record_decision_outcome`, RLS and the table grants are
--   NOT touched. A not-ready record keeps its server-derived graph anchor
--   and its review date (the user's, or the labelled 90-day default); it has
--   no prediction, so an outcome recorded against it is UNSCORED (CEE's
--   scoring reads `prediction.confidence`, finds none, and omits
--   brier_component — never 0).
--
-- WHY INSIDE `decision` AND NOT NEW COLUMNS. The table's own doctrine is
--   pass-through: the JSONB sub-objects mirror the contract verbatim, and the
--   RPC's `record` return parses under DecisionRecordSchema with zero mapping.
--   New columns would need a new RPC parameter — a signature change, i.e. a
--   DROP + CREATE with a window where the deployed caller and the function
--   disagree about the argument list, which would fail TODAY'S payload too.
--   Keeping the signature fixed means today's callers cannot be broken by any
--   ordering of code deploy and migration apply.
--
-- DEPLOY ORDERING (either order is safe for TODAY'S clients):
--   - code first, migration later: today's payload is byte-identical on the
--     wire to the RPC; payloads using the new fields are refused by the live
--     function's whitelist (22023 → the route's 502 store_error), so nothing
--     partial is ever written.
--   - migration first, code later: the widened function accepts everything
--     the old one did; nothing sends the new keys yet.
--   ⚠ BUT A CLIENT THAT SENDS THE NEW FIELDS (the UI's decision-record-v2,
--   which sends `rationale` / `key_assumption` / `revisit_trigger` on EVERY
--   option commit) turns "code first" into a REGRESSION: its option commits
--   would 502 until this file is applied. So: apply this migration BEFORE the
--   CEE route that forwards the new fields is deployed, and ship that UI only
--   after both.
--
-- ROLLBACK: rollback/20260924120000_v5_decision_records_not_ready_and_reasoning_rollback.sql.do-not-apply
--   restores 20260710113000's constraint and function body verbatim. ⚠ It
--   will FAIL (by design) once any not-ready row exists, because the restored
--   CHECK cannot validate it — see that file before running it.
--
-- Verification (after the separately-approved execution):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conname = 'dr_decision_shape';            -- contains 'not_ready'
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conname = 'dr_prediction_shape';          -- contains 'not_ready'
--   SELECT is_nullable FROM information_schema.columns
--     WHERE table_name = 'decision_records' AND column_name = 'prediction';  -- YES
--   SELECT count(*) FROM pg_proc WHERE proname = 'create_decision_record';  -- 1
--   SELECT has_function_privilege('authenticated',
--     'public.create_decision_record(uuid, jsonb, jsonb, timestamptz, uuid, text, uuid, text)',
--     'EXECUTE');                                     -- false
-- =============================================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. dr_decision_shape — admit the not-ready branch, refuse any other
--    `position`. Every existing row has both option keys and no
--    `position`, so it satisfies the first disjunct: re-validation on
--    ADD CONSTRAINT cannot fail on existing data.
-- ------------------------------------------------------------
ALTER TABLE public.decision_records
  DROP CONSTRAINT IF EXISTS dr_decision_shape;
ALTER TABLE public.decision_records
  ADD CONSTRAINT dr_decision_shape CHECK (
    jsonb_typeof(decision) = 'object'
    AND decision ? 'graph_hash'
    AND (
      -- chosen option: no `position`, both option keys (every existing row)
      (NOT (decision ? 'position')
        AND decision ? 'chosen_option_id'
        AND decision ? 'chosen_option_label')
      OR
      -- not ready to choose: position 'not_ready' and NEITHER option key.
      -- COALESCE is load-bearing, as in dr_outcome_shape: a NULL here would
      -- make the whole CHECK NULL, and a NULL CHECK passes silently.
      (COALESCE(decision->>'position', '') = 'not_ready'
        AND NOT (decision ? 'chosen_option_id')
        AND NOT (decision ? 'chosen_option_label'))
    )
  );

-- ------------------------------------------------------------
-- 1b. prediction — NULL exactly on a not-ready position. Every existing
--     row is a chosen row with a non-NULL prediction carrying `statement`
--     (the old NOT NULL + dr_prediction_shape), so it satisfies the ELSE
--     arm and re-validation cannot fail on existing data. The CASE is
--     never NULL: `prediction IS [NOT] NULL` is boolean, and `?` /
--     jsonb_typeof are only reached on a non-NULL prediction.
-- ------------------------------------------------------------
ALTER TABLE public.decision_records
  ALTER COLUMN prediction DROP NOT NULL;
ALTER TABLE public.decision_records
  DROP CONSTRAINT IF EXISTS dr_prediction_shape;
ALTER TABLE public.decision_records
  ADD CONSTRAINT dr_prediction_shape CHECK (
    CASE
      WHEN COALESCE(decision->>'position', '') = 'not_ready'
        THEN prediction IS NULL
      ELSE prediction IS NOT NULL
        AND jsonb_typeof(prediction) = 'object'
        AND prediction ? 'statement'
    END
  );

-- ------------------------------------------------------------
-- 2. create_decision_record — SAME 8-parameter signature (CREATE OR
--    REPLACE replaces in place; no overload is created). Body generated
--    from 20260710113000 by three asserted transformations.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_decision_record(
  p_scenario_id  UUID,
  p_decision     JSONB,
  p_prediction   JSONB,
  p_review_date  TIMESTAMPTZ,
  p_record_id    UUID DEFAULT NULL,
  p_event_id     TEXT DEFAULT NULL,
  -- P1 amendment (appended AFTER the existing defaults so existing
  -- positional callers are untouched): workspace at birth + visibility.
  p_workspace_id UUID DEFAULT NULL,
  p_visibility   TEXT DEFAULT 'private'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_owner          UUID;
  v_existing       public.decision_records%ROWTYPE;
  v_new            public.decision_records%ROWTYPE;
  v_event_id       TEXT;
  v_existing_event JSONB;
  v_new_seq        INTEGER;
  v_event          JSONB;
  v_events         JSONB;
BEGIN
  -- Parameter guards — VALUE-LEVEL, not just key presence (fixup 2, from
  -- the pre-execution adversarial review). Rationale: outcome is
  -- write-once and the sub-objects are read back into a .strict() Zod
  -- parse, so one malformed service-role call would otherwise create a
  -- permanently unrepairable row that poisons Brier readback. Enforced
  -- here: object-ness, key-set WHITELISTS (the schemas are .strict() —
  -- unknown keys must never persist), string-typed non-empty required
  -- fields, numeric types + ranges for confidence, and finiteness of
  -- review_date. NOT enforced (app-layer parse territory): the exact Zod
  -- datetime string grammar.
  -- 0.16.0 amendment (2026-07-12): whitelists widened to the schemas
  -- 0.16.0 additive fields — decision.committed_by_user;
  -- prediction.confidence_source / probability_of_goal /
  -- probability_of_joint_goal — value-guarded to mirror the Zod schema
  -- exactly (boolean; closed enum; numbers in [0,1]).
  IF p_decision IS NULL OR jsonb_typeof(p_decision) <> 'object' THEN
    RAISE EXCEPTION 'create_decision_record: p_decision must be a JSON object'
      USING ERRCODE = '22023'; -- invalid_parameter_value
  END IF;
  -- 0.57.0 amendment (2026-09-24): `decision` is EITHER a chosen option
  -- (no `position` key — every pre-0.57.0 record) OR an explicit "not ready
  -- to choose" (`position: 'not_ready'`, NO option keys). The branch is
  -- decided by the PRESENCE of `position`, exactly as the schemas 0.57.0
  -- union decides it, so the two layers cannot disagree about which branch a
  -- payload is on.
  IF p_decision ? 'position' THEN
    -- NOT-READY branch (DecisionRecordNotReadyPositionSchema).
    IF jsonb_typeof(p_decision->'position') IS DISTINCT FROM 'string'
       OR p_decision->>'position' <> 'not_ready' THEN
      RAISE EXCEPTION 'create_decision_record: decision.position, when present, must be ''not_ready'''
        USING ERRCODE = '22023';
    END IF;
    -- The whitelist does NOT admit chosen_option_id / chosen_option_label /
    -- analysis_summary: "not ready, but option B" is a contradiction, and it
    -- is refused here rather than stored for a reader to adjudicate.
    IF p_decision - 'position' - 'graph_hash' - 'committed_by_user'
       - 'rationale' - 'key_assumption' - 'revisit_trigger' - 'next_action'
       <> '{}'::jsonb THEN
      RAISE EXCEPTION 'create_decision_record: a not-ready decision carries keys outside the DecisionRecordNotReadyPositionSchema whitelist (it may not name an option)'
        USING ERRCODE = '22023';
    END IF;
    -- graph_hash stays required (the view is anchored to its graph), and
    -- committed_by_user is REQUIRED TRUE: ambient capture can never produce
    -- a not-ready record, so anything else is a producer bug.
    IF jsonb_typeof(p_decision->'graph_hash') IS DISTINCT FROM 'string'
       OR p_decision->>'graph_hash' = ''
       OR p_decision->'committed_by_user' IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'create_decision_record: a not-ready decision needs a non-empty graph_hash and committed_by_user = true'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    -- CHOSEN branch (DecisionRecordDecisionSchema). The pre-0.57.0 guards,
    -- unchanged except that the whitelist admits the four reasoning keys.
    IF p_decision - 'chosen_option_id' - 'chosen_option_label' - 'graph_hash' - 'analysis_summary'
       - 'committed_by_user'
       - 'rationale' - 'key_assumption' - 'revisit_trigger' - 'next_action'
       <> '{}'::jsonb THEN
      RAISE EXCEPTION 'create_decision_record: p_decision carries keys outside the DecisionRecordDecisionSchema whitelist'
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_decision->'chosen_option_id') IS DISTINCT FROM 'string'
       OR p_decision->>'chosen_option_id' = ''
       OR jsonb_typeof(p_decision->'chosen_option_label') IS DISTINCT FROM 'string'
       OR p_decision->>'chosen_option_label' = ''
       OR jsonb_typeof(p_decision->'graph_hash') IS DISTINCT FROM 'string'
       OR p_decision->>'graph_hash' = '' THEN
      RAISE EXCEPTION 'create_decision_record: chosen_option_id, chosen_option_label and graph_hash must be non-empty strings'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  -- 0.57.0 amendment: the four reasoning keys, on EITHER branch. Optional;
  -- when present, a non-empty string of at most 1000 characters
  -- (DECISION_RECORD_TEXT_MAX_CHARS). char_length counts code points, which
  -- is never stricter than the app layer's UTF-16 length, so anything the
  -- route admits also passes here.
  IF (p_decision ? 'rationale'
      AND (jsonb_typeof(p_decision->'rationale') <> 'string'
           OR p_decision->>'rationale' = ''
           OR char_length(p_decision->>'rationale') > 1000))
     OR (p_decision ? 'key_assumption'
      AND (jsonb_typeof(p_decision->'key_assumption') <> 'string'
           OR p_decision->>'key_assumption' = ''
           OR char_length(p_decision->>'key_assumption') > 1000))
     OR (p_decision ? 'revisit_trigger'
      AND (jsonb_typeof(p_decision->'revisit_trigger') <> 'string'
           OR p_decision->>'revisit_trigger' = ''
           OR char_length(p_decision->>'revisit_trigger') > 1000))
     OR (p_decision ? 'next_action'
      AND (jsonb_typeof(p_decision->'next_action') <> 'string'
           OR p_decision->>'next_action' = ''
           OR char_length(p_decision->>'next_action') > 1000)) THEN
    RAISE EXCEPTION 'create_decision_record: rationale, key_assumption, revisit_trigger and next_action must each be a non-empty string of at most 1000 characters'
      USING ERRCODE = '22023';
  END IF;
  -- 0.16.0 amendment: committed_by_user distinguishes an explicit "log
  -- this decision" commit from ambient auto-capture; optional boolean
  -- (absent = disclosed inference, per the schema comment).
  IF p_decision ? 'committed_by_user'
     AND jsonb_typeof(p_decision->'committed_by_user') <> 'boolean' THEN
    RAISE EXCEPTION 'create_decision_record: committed_by_user must be a boolean'
      USING ERRCODE = '22023';
  END IF;
  IF p_decision ? 'analysis_summary' THEN
    IF jsonb_typeof(p_decision->'analysis_summary') <> 'object'
       OR (p_decision->'analysis_summary') - 'leading_option' - 'win_probability' - 'goal_fit' - 'robustness_band'
          <> '{}'::jsonb
       OR (p_decision->'analysis_summary' ? 'leading_option'
           AND (jsonb_typeof(p_decision->'analysis_summary'->'leading_option') <> 'string'
                OR p_decision->'analysis_summary'->>'leading_option' = ''))
       OR (p_decision->'analysis_summary' ? 'win_probability'
           AND (jsonb_typeof(p_decision->'analysis_summary'->'win_probability') <> 'number'
                OR (p_decision->'analysis_summary'->>'win_probability')::numeric NOT BETWEEN 0 AND 1))
       OR (p_decision->'analysis_summary' ? 'goal_fit'
           AND jsonb_typeof(p_decision->'analysis_summary'->'goal_fit') <> 'number')
       OR (p_decision->'analysis_summary' ? 'robustness_band'
           AND (jsonb_typeof(p_decision->'analysis_summary'->'robustness_band') <> 'string'
                OR p_decision->'analysis_summary'->>'robustness_band' = '')) THEN
      RAISE EXCEPTION 'create_decision_record: analysis_summary violates DecisionRecordAnalysisSummarySchema (whitelist/types/ranges)'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  -- 0.57.0 amendment (reconciled 2026-09-24): a NOT-READY decision makes NO
  -- prediction — no expectation, no confidence (schemas 0.57.0: the record
  -- carries no `prediction`). p_prediction must be SQL NULL there; a JSON
  -- null is normalised to SQL NULL so the row satisfies dr_prediction_shape;
  -- anything else is refused rather than stored as a forecast the user's own
  -- position says they have not made. The CHOSEN branch is the pre-0.57.0
  -- guard below, unchanged but for IF → ELSIF, so a NULL p_prediction is
  -- still refused there by its first clause.
  IF p_decision ? 'position' THEN
    IF p_prediction IS NOT NULL AND p_prediction <> 'null'::jsonb THEN
      RAISE EXCEPTION 'create_decision_record: a not-ready decision makes no prediction — p_prediction must be NULL'
        USING ERRCODE = '22023';
    END IF;
    p_prediction := NULL;
  -- 0.16.0 amendment: prediction whitelist widened; new keys value-guarded
  -- (confidence_source closed enum per DecisionRecordConfidenceSource; the
  -- two probabilities recorded verbatim but must be numbers in [0,1]).
  ELSIF p_prediction IS NULL OR jsonb_typeof(p_prediction) <> 'object'
     OR p_prediction - 'statement' - 'confidence' - 'confidence_source'
        - 'probability_of_goal' - 'probability_of_joint_goal' <> '{}'::jsonb
     OR jsonb_typeof(p_prediction->'statement') IS DISTINCT FROM 'string'
     OR p_prediction->>'statement' = ''
     OR (p_prediction ? 'confidence'
         AND (jsonb_typeof(p_prediction->'confidence') <> 'number'
              OR (p_prediction->>'confidence')::numeric NOT BETWEEN 0 AND 1))
     OR (p_prediction ? 'confidence_source'
         AND (jsonb_typeof(p_prediction->'confidence_source') <> 'string'
              OR p_prediction->>'confidence_source' NOT IN ('model_derived', 'user_stated')))
     OR (p_prediction ? 'probability_of_goal'
         AND (jsonb_typeof(p_prediction->'probability_of_goal') <> 'number'
              OR (p_prediction->>'probability_of_goal')::numeric NOT BETWEEN 0 AND 1))
     OR (p_prediction ? 'probability_of_joint_goal'
         AND (jsonb_typeof(p_prediction->'probability_of_joint_goal') <> 'number'
              OR (p_prediction->>'probability_of_joint_goal')::numeric NOT BETWEEN 0 AND 1)) THEN
    RAISE EXCEPTION 'create_decision_record: p_prediction must be {statement: non-empty string, confidence?: number in [0,1], confidence_source?: ''model_derived''|''user_stated'', probability_of_goal?: number in [0,1], probability_of_joint_goal?: number in [0,1]} and nothing else'
      USING ERRCODE = '22023';
  END IF;
  IF p_review_date IS NULL OR NOT isfinite(p_review_date) THEN
    RAISE EXCEPTION 'create_decision_record: p_review_date must be a finite timestamptz'
      USING ERRCODE = '22023';
  END IF;
  -- P1 amendment guards. p_visibility: closed vocabulary, same style as
  -- the whitelists above (an explicit NULL is rejected — the column is
  -- NOT NULL; omit the parameter to get the 'private' default).
  -- p_workspace_id needs no value guard beyond its UUID parameter type:
  -- NULL is the legitimate pre-workspace value, and existence cannot be
  -- checked — public.workspaces does not exist yet (Batch A). Honest
  -- scope: the design's eventual source is scenarios.workspace_id
  -- (denormalised under the row lock below), but THAT column does not
  -- exist yet either — until Batch A lands, the caller-supplied
  -- parameter is the carrier, and the sourcing can be tightened in a
  -- later pre-execution amendment or in the CEE caller.
  IF p_visibility IS NULL OR p_visibility NOT IN ('private', 'workspace') THEN
    RAISE EXCEPTION 'create_decision_record: p_visibility must be ''private'' or ''workspace'''
      USING ERRCODE = '22023';
  END IF;

  -- Row lock: serialises the guest check, replay check and event append
  -- per scenario. FOUND distinguishes "row absent" from "guest row".
  SELECT user_id
    INTO v_owner
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_decision_record: scenario % not found', p_scenario_id;
  END IF;

  -- D3 Branch A guest refusal — distinct ERRCODE, app maps to the typed
  -- recoverable "decision records require sign-in" error.
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'create_decision_record: scenario % has no owner — decision records require sign-in', p_scenario_id
      USING ERRCODE = 'DR001';
  END IF;

  -- Idempotent replay: a retried call carrying the same p_record_id
  -- returns the existing record unchanged. A p_record_id that exists
  -- under a DIFFERENT scenario is a caller bug, not a replay.
  IF p_record_id IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.decision_records
      WHERE record_id = p_record_id;
    IF FOUND THEN
      IF v_existing.scenario_id <> p_scenario_id THEN
        RAISE EXCEPTION 'create_decision_record: record % already exists under a different scenario', p_record_id
          USING ERRCODE = '22023';
      END IF;
      RETURN jsonb_build_object(
        'record', jsonb_strip_nulls(jsonb_build_object(
          'record_id',   v_existing.record_id,
          'scenario_id', v_existing.scenario_id,
          'created_at',  to_jsonb(v_existing.created_at),
          'decision',    v_existing.decision,
          'prediction',  v_existing.prediction,
          'review_date', to_jsonb(v_existing.review_date),
          'outcome',     v_existing.outcome
        )),
        'deduped', true,
        'event_id', NULL
      );
    END IF;
  END IF;

  -- INSERT with a unique_violation net (fixup 2, defect 2): the scenarios
  -- row lock does NOT serialise two concurrent creates carrying the same
  -- p_record_id under DIFFERENT scenarios, and a same-scenario concurrent
  -- replay can also race past the pre-check above. Without this handler
  -- the caller would see raw SQLSTATE 23505 instead of the typed replay
  -- semantics.
  BEGIN
    INSERT INTO public.decision_records (
      record_id, scenario_id, owner_user_id, review_date, decision, prediction,
      workspace_id, visibility  -- P1 amendment: stamped at birth
    ) VALUES (
      COALESCE(p_record_id, gen_random_uuid()),
      p_scenario_id, v_owner, p_review_date, p_decision, p_prediction,
      p_workspace_id, p_visibility
    )
    RETURNING * INTO v_new;
  EXCEPTION WHEN unique_violation THEN
    -- A p_record_id-less insert cannot meaningfully collide (gen_random_uuid);
    -- surface anything that strange verbatim.
    IF p_record_id IS NULL THEN
      RAISE;
    END IF;
    -- Re-run the replay branch against the row the concurrent writer won.
    SELECT * INTO v_existing
      FROM public.decision_records
      WHERE record_id = p_record_id;
    IF NOT FOUND THEN
      RAISE; -- collision vanished — not a replay; surface the original error
    END IF;
    IF v_existing.scenario_id <> p_scenario_id THEN
      RAISE EXCEPTION 'create_decision_record: record % already exists under a different scenario', p_record_id
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'record', jsonb_strip_nulls(jsonb_build_object(
        'record_id',   v_existing.record_id,
        'scenario_id', v_existing.scenario_id,
        'created_at',  to_jsonb(v_existing.created_at),
        'decision',    v_existing.decision,
        'prediction',  v_existing.prediction,
        'review_date', to_jsonb(v_existing.review_date),
        'outcome',     v_existing.outcome
      )),
      'deduped', true,
      'event_id', NULL
    );
  END;

  -- Journey event — same shape append_scenario_event produces, so the
  -- existing Journey tab renders it with zero UI change. Idempotent by
  -- event_id (deterministic default keyed on the new record id). Fixup 2,
  -- defect 3: a caller-supplied p_event_id that collides with an existing
  -- event belonging to a DIFFERENT record is a caller bug — raise 22023
  -- rather than silently skipping the append while returning the event_id
  -- as if it were this record's.
  v_event_id := COALESCE(p_event_id, 'decision_recorded_' || v_new.record_id::text);
  SELECT events, event_seq + 1 INTO v_events, v_new_seq
    FROM public.scenarios WHERE id = p_scenario_id;
  SELECT e INTO v_existing_event
    FROM jsonb_array_elements(COALESCE(v_events, '[]'::jsonb)) AS e
    WHERE e->>'event_id' = v_event_id;
  IF FOUND AND (v_existing_event->'details'->>'record_id') IS DISTINCT FROM v_new.record_id::text THEN
    RAISE EXCEPTION 'create_decision_record: p_event_id % collides with an existing journey event for a different record', v_event_id
      USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND THEN
    v_event := jsonb_build_object(
      'event_id',   v_event_id,
      'event_type', 'decision_recorded',
      'seq',        v_new_seq,
      'timestamp',  to_jsonb(now()),
      -- 0.57.0: `position` joins the details. NULL (so STRIPPED, byte-
      -- identical to before) on a chosen record; 'not_ready' on a not-ready
      -- one, which carries no option keys — so a reader of the journey can
      -- never mistake it for a choice.
      'details',    jsonb_strip_nulls(jsonb_build_object(
                      'record_id', v_new.record_id,
                      'position', p_decision->>'position',
                      'chosen_option_id', p_decision->>'chosen_option_id',
                      'chosen_option_label', p_decision->>'chosen_option_label',
                      'review_date', to_jsonb(p_review_date)
                    )),
      'hashes',     jsonb_build_object(
                      'graph_hash', p_decision->>'graph_hash'
                    )
    );
    UPDATE public.scenarios
      SET events    = COALESCE(events, '[]'::jsonb) || jsonb_build_array(v_event),
          event_seq = v_new_seq,
          updated_at = now()
      WHERE id = p_scenario_id;
  END IF;

  RETURN jsonb_build_object(
    'record', jsonb_strip_nulls(jsonb_build_object(
      'record_id',   v_new.record_id,
      'scenario_id', v_new.scenario_id,
      'created_at',  to_jsonb(v_new.created_at),
      'decision',    v_new.decision,
      'prediction',  v_new.prediction,
      'review_date', to_jsonb(v_new.review_date),
      'outcome',     v_new.outcome
    )),
    'deduped', false,
    'event_id', v_event_id
  );
END;
$$;

-- Re-stated, not changed: CREATE OR REPLACE keeps the existing ACL, and
-- re-issuing the explicit grants keeps this file safe on a database
-- where the function is being created for the first time.
REVOKE EXECUTE ON FUNCTION public.create_decision_record(
  uuid, jsonb, jsonb, timestamptz, uuid, text, uuid, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_decision_record(
  uuid, jsonb, jsonb, timestamptz, uuid, text, uuid, text
) TO service_role;

COMMENT ON COLUMN public.decision_records.decision IS
  'DecisionRecordDecisionSchema OR (schemas 0.57.0) DecisionRecordNotReadyPositionSchema, verbatim. '
  'No `position` key = a chosen option; position = ''not_ready'' = not ready to choose, with NO option keys. '
  'decision->>''graph_hash'' regime: ``aag_v1:sha256:<64-hex>`` = CEE computeAnalysisAffectingGraphHash with '
  'versioned prefix (NOT response_hash, NOT graph_identity_hash, NOT the legacy UI graph_hash — regimes never compare).';

COMMIT;
