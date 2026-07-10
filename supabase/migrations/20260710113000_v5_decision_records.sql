-- ============================================================
-- Decision Records v1 — `decision_records` substrate (ROADMAP 3.1)
-- Authored by the Platform & MVP workstream (Account 3), 2026-07-10.
--
-- ⚠️  AUTHORED AS CODE — NOT YET EXECUTED. Execution is Paul-gated
--     (batched by the orchestrator). Update this header with the
--     execution date + evidence pointer when applied, per the
--     20260705120000_v5_model_versions.sql precedent.
--
-- Target: Staging Supabase
-- Date authored: 2026-07-10
-- Date executed: (pending)
--
-- CONTRACT: @talchain/schemas 0.15.0 `DecisionRecordSchema`
--   (olumi-schemas src/boundary/decision-record.ts). That schema's own
--   comment binds this file: FIELD NAMES MUST MATCH THE SCHEMA EXACTLY so
--   the API layer between wire and storage is a pass-through, not a
--   translation layer. Hence:
--     - the PK is `record_id` (NOT `id` — a deliberate deviation from the
--       model_versions convention; parity wins),
--     - `decision` / `prediction` / `outcome` are stored as JSONB
--       sub-objects mirroring DecisionRecordDecisionSchema /
--       DecisionRecordPredictionSchema / DecisionRecordOutcomeSchema
--       verbatim,
--     - a full record is read back with a single jsonb_build_object (see
--       the RPCs' `record` return key), which parses under
--       DecisionRecordSchema.strict() with zero mapping.
--
-- What this creates (all additive; NO existing table is touched):
--   1. `decision_records` — the Brier-calibration capture substrate: a
--      decision + forward prediction + review date captured at decision
--      time; `outcome` filled at review time (nullable, write-once).
--      Written EXCLUSIVELY by the CEE service role via the RPCs below.
--   2. Two SECURITY DEFINER RPCs (service_role only):
--        create_decision_record(...)  — insert record + journey event,
--                                       one transaction, idempotent by
--                                       p_record_id.
--        record_decision_outcome(...) — write-once outcome fill + journey
--                                       event; idempotent on identical
--                                       retry.
--
-- Ownership (Decision 3 — Branch A, same posture as model_versions):
--   - owner_user_id uuid NOT NULL — no unowned durable rows, ever.
--     Denormalised from scenarios.user_id AT WRITE TIME inside the RPC.
--     Deliberately NO foreign key to auth.users (scenarios.user_id lost
--     its FK in 20260422000000 guest relaxation; an FK here would be a
--     stronger constraint than its denormalisation source guarantees).
--   - Guest scenarios (scenarios.user_id IS NULL) are REFUSED with the
--     distinct SQLSTATE 'DR001' ("decision records require sign-in").
--     Rationale: decision records are the long-horizon calibration asset;
--     an unowned record can never be reliably re-attached and would
--     poison Brier aggregation (ROADMAP 3.2). Required login (3.4,
--     Branch A decided) is closing the guest window this sprint anyway.
--
-- graph_hash REGIME (binding on producer AND reviewer — agreed seam):
--   `decision->>'graph_hash'` carries CEE's analysis-affecting graph hash
--   (computeAnalysisAffectingGraphHash) with a versioned regime prefix:
--       aag_v1:sha256:<64-hex>
--   NOT PLoT's response_hash (request-canonical — false "graph changed"
--   positives), NOT PLoT's internal hashGraph (not recomputable by the
--   reviewer), NOT graph_identity_hash (model_versions' regime), NOT the
--   legacy UI graph_hash. Hash regimes NEVER compare across families —
--   the in-value prefix exists because DecisionRecordDecisionSchema is
--   .strict() (no sibling version fields possible). Same function at
--   capture time and review time, same codebase (CEE).
--
-- A4 checklist applied (every line load-bearing):
--   - ENABLE + FORCE ROW LEVEL SECURITY on decision_records.
--   - Owner-only SELECT policy for `authenticated`; NO INSERT/UPDATE/
--     DELETE policies for any JWT role (writes go exclusively through the
--     service-role RPCs, which bypass RLS).
--   - REVOKE ALL on the table FROM PUBLIC, anon, authenticated, then
--     GRANT SELECT (policy-scoped) back to authenticated only.
--   - Every function: SECURITY DEFINER + pinned search_path + EXPLICIT
--     `REVOKE ... FROM PUBLIC, anon, authenticated` + `GRANT ... TO
--     service_role`. Supabase default privileges auto-GRANT EXECUTE to
--     anon/authenticated on every new public function, so the explicit
--     revokes are load-bearing, not belt-and-braces.
--   - DISTINCT function names, never overloads (the 20260426160532
--     PostgREST candidate-ambiguity lesson).
--
-- Distinct SQLSTATEs raised here (app maps each to a typed result):
--   DR001 — guest scenario refusal ("decision records require sign-in").
--   DR404 — record not found (record_decision_outcome).
--   DR409 — outcome already recorded (write-once; identical-payload
--           retries are deduped, not errored).
--
-- Verification (run after the separately-approved execution):
--   SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--     WHERE relname = 'decision_records';                 -- t, t
--   SELECT proname FROM pg_proc
--     WHERE proname IN ('create_decision_record','record_decision_outcome');
--   SELECT has_function_privilege('authenticated',
--     'public.create_decision_record(uuid, jsonb, jsonb, timestamptz, uuid, text)',
--     'EXECUTE');                                         -- false
--   SELECT has_function_privilege('service_role',
--     'public.create_decision_record(uuid, jsonb, jsonb, timestamptz, uuid, text)',
--     'EXECUTE');                                         -- true
--   SELECT has_function_privilege('authenticated',
--     'public.record_decision_outcome(uuid, jsonb, text)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('service_role',
--     'public.record_decision_outcome(uuid, jsonb, text)', 'EXECUTE');  -- true
--   (Grant-layer verification is against the LIVE database pg_proc/proacl,
--    not this file.)
-- ============================================================

-- ------------------------------------------------------------
-- 1. The capture table. `outcome` is the ONLY mutable field
--    (NULL → filled once at review time); everything else is
--    immutable after insert.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.decision_records (
  -- Contract PK name (DecisionRecordSchema.record_id) — pass-through parity.
  record_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id    UUID NOT NULL REFERENCES public.scenarios(id) ON DELETE CASCADE,
  -- D3 Branch A: NOT NULL, denormalised from scenarios.user_id at write
  -- time. No FK to auth.users (see header). Unowned durable rows are
  -- impossible by constraint.
  owner_user_id  UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- When the user (or an automated prompt) should compare prediction to
  -- reality. Set at creation, independent of when `outcome` lands.
  review_date    TIMESTAMPTZ NOT NULL,
  -- DecisionRecordDecisionSchema verbatim: {chosen_option_id,
  -- chosen_option_label, graph_hash, analysis_summary?}.
  decision       JSONB NOT NULL,
  -- DecisionRecordPredictionSchema verbatim: {statement, confidence?}.
  prediction     JSONB NOT NULL,
  -- DecisionRecordOutcomeSchema verbatim: {recorded_at, result, notes?,
  -- brier_component?}. NULL until review; write-once via RPC.
  outcome        JSONB,
  -- Indexable projection for 3.2 Brier aggregation; cannot skew from the
  -- JSONB because it is generated.
  outcome_result TEXT GENERATED ALWAYS AS (outcome->>'result') STORED,
  -- Shape guards mirroring the Zod schema's required keys + closed result
  -- vocabulary, so the DB cannot hold a row the contract would reject.
  CONSTRAINT dr_decision_shape CHECK (
    jsonb_typeof(decision) = 'object'
    AND decision ? 'chosen_option_id'
    AND decision ? 'chosen_option_label'
    AND decision ? 'graph_hash'
  ),
  CONSTRAINT dr_prediction_shape CHECK (
    jsonb_typeof(prediction) = 'object'
    AND prediction ? 'statement'
  ),
  -- COALESCE is load-bearing: a missing/null 'result' key makes the bare
  -- IN(...) evaluate to NULL, and a NULL CHECK passes silently.
  CONSTRAINT dr_outcome_shape CHECK (
    outcome IS NULL OR (
      jsonb_typeof(outcome) = 'object'
      AND outcome ? 'recorded_at'
      AND COALESCE(outcome->>'result', '')
          IN ('better', 'as_expected', 'worse', 'abandoned')
    )
  )
);

COMMENT ON TABLE public.decision_records IS
  'Decision Records v1 (ROADMAP 3.1): decision + prediction + review date '
  'captured at decision time; outcome filled once at review time. The '
  'Brier-calibration capture substrate (3.2 scores on top). Written '
  'EXCLUSIVELY by the CEE service role via create_decision_record / '
  'record_decision_outcome. Column names + JSONB shapes mirror '
  '@talchain/schemas 0.15.0 DecisionRecordSchema verbatim (pass-through '
  'doctrine). Ownership: D3 Branch A (owner_user_id NOT NULL; guests '
  'refused with DR001).';
COMMENT ON COLUMN public.decision_records.owner_user_id IS
  'Denormalised from scenarios.user_id at write time by the RPC. NOT NULL '
  'by decision (D3 Branch A): guest scenarios cannot create decision '
  'records.';
COMMENT ON COLUMN public.decision_records.decision IS
  'DecisionRecordDecisionSchema verbatim. decision->>''graph_hash'' regime: '
  '``aag_v1:sha256:<64-hex>`` = CEE computeAnalysisAffectingGraphHash with '
  'versioned prefix (NOT response_hash, NOT graph_identity_hash, NOT the '
  'legacy UI graph_hash — regimes never compare).';
COMMENT ON COLUMN public.decision_records.outcome IS
  'DecisionRecordOutcomeSchema verbatim. NULL until review. Write-once via '
  'record_decision_outcome (DR409 on conflicting rewrite; identical retry '
  'dedupes).';

-- Review-reminder scan: "records due for review, not yet scored".
CREATE INDEX IF NOT EXISTS decision_records_owner_review_due_idx
  ON public.decision_records (owner_user_id, review_date)
  WHERE outcome IS NULL;
-- Per-scenario history.
CREATE INDEX IF NOT EXISTS decision_records_scenario_created_idx
  ON public.decision_records (scenario_id, created_at DESC);
-- 3.2 Brier aggregation over scored records.
CREATE INDEX IF NOT EXISTS decision_records_owner_scored_idx
  ON public.decision_records (owner_user_id, outcome_result)
  WHERE outcome IS NOT NULL;

-- ------------------------------------------------------------
-- 2. RLS — ENABLE + FORCE; owner-only SELECT for authenticated;
--    NO write policies for any JWT role.
-- ------------------------------------------------------------
ALTER TABLE public.decision_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decision_records FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_own_decision_records ON public.decision_records;
CREATE POLICY select_own_decision_records ON public.decision_records
  FOR SELECT TO authenticated
  USING (auth.uid() = owner_user_id);

-- Table grants: strip everything from JWT roles, then re-grant SELECT
-- (policy-scoped) to authenticated only. anon gets nothing.
REVOKE ALL ON public.decision_records FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.decision_records TO authenticated;
GRANT ALL ON public.decision_records TO service_role;

-- ------------------------------------------------------------
-- 3. create_decision_record — the single write path for new records.
--
--    One transaction: parameter guards → scenarios row lock → guest
--    refusal → idempotent replay check (p_record_id) → INSERT → journey
--    event append (idempotent by event_id, inlined — same rationale as
--    create_model_version: append_scenario_event checks auth.uid(), which
--    is NULL for the service role).
--
--    Returns jsonb:
--      {
--        record:  <full pass-through record — parses under
--                  DecisionRecordSchema.strict() with zero mapping>,
--        deduped: boolean  (true = p_record_id already existed; the
--                  existing record was returned, nothing written),
--        event_id: text | null
--      }
--    The RPC-metadata keys live BESIDE `record`, never inside it, so the
--    strict contract parse of `record` stays clean.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_decision_record(
  p_scenario_id UUID,
  p_decision    JSONB,
  p_prediction  JSONB,
  p_review_date TIMESTAMPTZ,
  p_record_id   UUID DEFAULT NULL,
  p_event_id    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_owner    UUID;
  v_existing public.decision_records%ROWTYPE;
  v_new      public.decision_records%ROWTYPE;
  v_event_id TEXT;
  v_new_seq  INTEGER;
  v_event    JSONB;
  v_events   JSONB;
BEGIN
  -- Parameter guards — typed errors before constraint noise. These mirror
  -- the dr_*_shape CHECKs (and the Zod schema's required keys).
  IF p_decision IS NULL OR jsonb_typeof(p_decision) <> 'object'
     OR NOT (p_decision ? 'chosen_option_id')
     OR NOT (p_decision ? 'chosen_option_label')
     OR NOT (p_decision ? 'graph_hash')
     OR COALESCE(p_decision->>'graph_hash', '') = '' THEN
    RAISE EXCEPTION 'create_decision_record: p_decision must be an object with chosen_option_id, chosen_option_label and a non-empty graph_hash'
      USING ERRCODE = '22023'; -- invalid_parameter_value
  END IF;
  IF p_prediction IS NULL OR jsonb_typeof(p_prediction) <> 'object'
     OR COALESCE(p_prediction->>'statement', '') = '' THEN
    RAISE EXCEPTION 'create_decision_record: p_prediction must be an object with a non-empty statement'
      USING ERRCODE = '22023';
  END IF;
  IF p_review_date IS NULL THEN
    RAISE EXCEPTION 'create_decision_record: p_review_date must not be null'
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

  INSERT INTO public.decision_records (
    record_id, scenario_id, owner_user_id, review_date, decision, prediction
  ) VALUES (
    COALESCE(p_record_id, gen_random_uuid()),
    p_scenario_id, v_owner, p_review_date, p_decision, p_prediction
  )
  RETURNING * INTO v_new;

  -- Journey event — same shape append_scenario_event produces, so the
  -- existing Journey tab renders it with zero UI change. Idempotent by
  -- event_id (deterministic default keyed on the new record id).
  v_event_id := COALESCE(p_event_id, 'decision_recorded_' || v_new.record_id::text);
  SELECT events, event_seq + 1 INTO v_events, v_new_seq
    FROM public.scenarios WHERE id = p_scenario_id;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_events, '[]'::jsonb)) AS e
    WHERE e->>'event_id' = v_event_id
  ) THEN
    v_event := jsonb_build_object(
      'event_id',   v_event_id,
      'event_type', 'decision_recorded',
      'seq',        v_new_seq,
      'timestamp',  to_jsonb(now()),
      'details',    jsonb_strip_nulls(jsonb_build_object(
                      'record_id', v_new.record_id,
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

-- ------------------------------------------------------------
-- 4. record_decision_outcome — write-once outcome fill.
--
--    One transaction: parameter guards → scenarios row lock (taken FIRST,
--    same lock order as create_decision_record, for the journey-event
--    append) → record row lock → write-once check (identical-payload
--    retry dedupes; conflicting rewrite raises DR409) → UPDATE → journey
--    event. Same return envelope as create_decision_record.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_decision_outcome(
  p_record_id UUID,
  p_outcome   JSONB,
  p_event_id  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_scenario_id UUID;
  v_rec         public.decision_records%ROWTYPE;
  v_event_id    TEXT;
  v_new_seq     INTEGER;
  v_event       JSONB;
  v_events      JSONB;
BEGIN
  -- Parameter guards mirroring dr_outcome_shape + the Zod enum.
  IF p_outcome IS NULL OR jsonb_typeof(p_outcome) <> 'object'
     OR NOT (p_outcome ? 'recorded_at')
     OR COALESCE(p_outcome->>'result', '')
        NOT IN ('better', 'as_expected', 'worse', 'abandoned') THEN
    RAISE EXCEPTION 'record_decision_outcome: p_outcome must be an object with recorded_at and result in (better|as_expected|worse|abandoned)'
      USING ERRCODE = '22023';
  END IF;

  -- Locate the record (no lock yet) to learn its scenario, then take the
  -- scenarios lock FIRST — identical lock order to create_decision_record.
  SELECT scenario_id INTO v_scenario_id
    FROM public.decision_records
    WHERE record_id = p_record_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_decision_outcome: record % not found', p_record_id
      USING ERRCODE = 'DR404';
  END IF;

  PERFORM 1 FROM public.scenarios WHERE id = v_scenario_id FOR UPDATE;

  -- Re-select under lock (the row cannot vanish while the scenario lock
  -- is held — deletes cascade from scenarios — but re-read for the
  -- write-once check to be race-free).
  SELECT * INTO v_rec
    FROM public.decision_records
    WHERE record_id = p_record_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_decision_outcome: record % not found', p_record_id
      USING ERRCODE = 'DR404';
  END IF;

  IF v_rec.outcome IS NOT NULL THEN
    -- Identical-payload retry is idempotent; anything else is a
    -- write-once violation.
    IF v_rec.outcome = p_outcome THEN
      RETURN jsonb_build_object(
        'record', jsonb_strip_nulls(jsonb_build_object(
          'record_id',   v_rec.record_id,
          'scenario_id', v_rec.scenario_id,
          'created_at',  to_jsonb(v_rec.created_at),
          'decision',    v_rec.decision,
          'prediction',  v_rec.prediction,
          'review_date', to_jsonb(v_rec.review_date),
          'outcome',     v_rec.outcome
        )),
        'deduped', true,
        'event_id', NULL
      );
    END IF;
    RAISE EXCEPTION 'record_decision_outcome: record % already has an outcome — outcomes are write-once', p_record_id
      USING ERRCODE = 'DR409';
  END IF;

  UPDATE public.decision_records
    SET outcome = p_outcome
    WHERE record_id = p_record_id
    RETURNING * INTO v_rec;

  v_event_id := COALESCE(p_event_id, 'decision_outcome_recorded_' || p_record_id::text);
  SELECT events, event_seq + 1 INTO v_events, v_new_seq
    FROM public.scenarios WHERE id = v_scenario_id;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_events, '[]'::jsonb)) AS e
    WHERE e->>'event_id' = v_event_id
  ) THEN
    v_event := jsonb_build_object(
      'event_id',   v_event_id,
      'event_type', 'decision_outcome_recorded',
      'seq',        v_new_seq,
      'timestamp',  to_jsonb(now()),
      'details',    jsonb_strip_nulls(jsonb_build_object(
                      'record_id', p_record_id,
                      'result', p_outcome->>'result'
                    ))
    );
    UPDATE public.scenarios
      SET events    = COALESCE(events, '[]'::jsonb) || jsonb_build_array(v_event),
          event_seq = v_new_seq,
          updated_at = now()
      WHERE id = v_scenario_id;
  END IF;

  RETURN jsonb_build_object(
    'record', jsonb_strip_nulls(jsonb_build_object(
      'record_id',   v_rec.record_id,
      'scenario_id', v_rec.scenario_id,
      'created_at',  to_jsonb(v_rec.created_at),
      'decision',    v_rec.decision,
      'prediction',  v_rec.prediction,
      'review_date', to_jsonb(v_rec.review_date),
      'outcome',     v_rec.outcome
    )),
    'deduped', false,
    'event_id', v_event_id
  );
END;
$$;

-- ------------------------------------------------------------
-- 5. Function grants — explicit per function. Supabase default privileges
--    auto-GRANT EXECUTE to anon/authenticated on new public functions;
--    REVOKE FROM PUBLIC alone is insufficient.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_decision_record(
  uuid, jsonb, jsonb, timestamptz, uuid, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_decision_record(
  uuid, jsonb, jsonb, timestamptz, uuid, text
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_decision_outcome(
  uuid, jsonb, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_decision_outcome(
  uuid, jsonb, text
) TO service_role;
