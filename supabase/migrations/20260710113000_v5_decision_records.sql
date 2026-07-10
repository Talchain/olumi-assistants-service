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
-- CHANGELOG (pre-execution amendments — this file is merged but NOT
--   yet executed, so it is amended in place rather than superseded;
--   precedent: PR #415 amending #410's claim RPC file):
--   - 2026-07-10 (workspace/identity lane, Decision P1 per
--     parallel-briefs/WORKSPACE-IDENTITY-DESIGN-v1.md §18/§P1 —
--     authored AHEAD of Paul's ratification of P1; stated honestly:
--     the ruling is pending, and execution of this file remains
--     Paul-gated regardless, so nothing goes live without his
--     approval of the batch): add `workspace_id UUID NULL` (no FK —
--     the workspaces table does not exist yet; Batch A creates it;
--     NULL = pre-workspace record; denormalised at write time, same
--     posture as owner_user_id) and `visibility TEXT NOT NULL DEFAULT
--     'private'` CHECK IN ('private','workspace'). Stamped AT BIRTH
--     because records OUTLIVE scenarios by design — a later backfill
--     via scenario lookup fails for precisely the records whose
--     scenarios are gone (free this week; permanently lossy after
--     execution). create_decision_record gains OPTIONAL
--     p_workspace_id UUID DEFAULT NULL + p_visibility TEXT DEFAULT
--     'private' (value-guarded per this file's whitelist style);
--     the signature change is safe pre-execution — no prior version
--     exists in any database, so no overload is created. Contract
--     note: @talchain/schemas 0.15.0 DecisionRecordSchema does NOT
--     carry these fields yet, so the RPCs' `record` envelope
--     deliberately EXCLUDES them — the .strict() pass-through parse
--     stays clean; they join the envelope only when the contract
--     adds them. No RLS policy change here: 'workspace' visibility
--     is read via a Phase-2 additive policy, not this file.
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
-- RECORDS OUTLIVE SCENARIOS BY DESIGN (orchestrator ruling, 2026-07-10):
--   There is NO foreign key from decision_records to scenarios. Scenario
--   deletion is a routine event here (user deletes, cleanup scripts — the
--   existing scenarios FKs all CASCADE), and a CASCADE from this table
--   would silently destroy exactly the Brier calibration history the
--   table exists to accumulate. The record is self-contained (embedded
--   decision snapshot + prediction); scenario existence is validated at
--   CREATE time inside create_decision_record under the scenarios row
--   lock; record_decision_outcome works correctly on a record whose
--   scenario has since been deleted (it just skips the journey event).
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
--     'public.create_decision_record(uuid, jsonb, jsonb, timestamptz, uuid, text, uuid, text)',
--     'EXECUTE');                                         -- false
--   SELECT has_function_privilege('service_role',
--     'public.create_decision_record(uuid, jsonb, jsonb, timestamptz, uuid, text, uuid, text)',
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
  -- Deliberately NO foreign key to scenarios (orchestrator ruling,
  -- 2026-07-10): records OUTLIVE scenarios by design — see header.
  -- Scenario existence is enforced at create time inside the RPC under
  -- the scenarios row lock; a dangling scenario_id on an old record is
  -- valid history and still parses under the contract.
  scenario_id    UUID NOT NULL,
  -- D3 Branch A: NOT NULL, denormalised from scenarios.user_id at write
  -- time. No FK to auth.users (see header). Unowned durable rows are
  -- impossible by constraint.
  owner_user_id  UUID NOT NULL,
  -- P1 amendment (see header CHANGELOG): workspace stamped at birth.
  -- NULL = record created before the workspace substrate exists.
  -- Deliberately NO foreign key — public.workspaces does not exist yet
  -- (Batch A of the workspace/identity MVP creates it); same
  -- denormalise-at-write-time posture as owner_user_id.
  workspace_id   UUID,
  -- P1 amendment: per-record visibility. 'private' = owner-only (the
  -- default — Decision P2: a record is personal calibration data
  -- first); 'workspace' = per-record opt-in, readable by workspace
  -- members only via a Phase-2 ADDITIVE RLS policy that this file
  -- deliberately does not create.
  visibility     TEXT NOT NULL DEFAULT 'private',
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
  -- Shape guards: required keys + the closed result vocabulary. These
  -- CHECKs are the LAST line; the RPCs enforce the stronger value-level
  -- guards (types, key-set whitelists, ranges — see the RPC guard blocks
  -- for exactly what is and is not enforced). Honest scope: the DB layer
  -- as a whole enforces everything in DecisionRecordSchema EXCEPT the
  -- exact Zod datetime STRING grammar inside the JSONB (recorded_at is
  -- guarded to be timestamptz-castable, which is looser than
  -- z.string().datetime({offset:true})) — that final grammar check is
  -- the app layer's parse.
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
  ),
  -- P1 amendment: closed visibility vocabulary (design doc §18 —
  -- exactly these two values; further tiers are a later, additive
  -- constraint change).
  CONSTRAINT dr_visibility_allowed CHECK (
    visibility IN ('private', 'workspace')
  )
);

COMMENT ON TABLE public.decision_records IS
  'Decision Records v1 (ROADMAP 3.1): decision + prediction + review date '
  'captured at decision time; outcome filled once at review time. The '
  'Brier-calibration capture substrate (3.2 scores on top). Written '
  'EXCLUSIVELY by the CEE service role via create_decision_record / '
  'record_decision_outcome. Records OUTLIVE scenarios by design — no FK; '
  'scenario deletion must never destroy Brier history. '
  'Column names + JSONB shapes mirror '
  '@talchain/schemas 0.15.0 DecisionRecordSchema verbatim (pass-through '
  'doctrine). Ownership: D3 Branch A (owner_user_id NOT NULL; guests '
  'refused with DR001).';
COMMENT ON COLUMN public.decision_records.owner_user_id IS
  'Denormalised from scenarios.user_id at write time by the RPC. NOT NULL '
  'by decision (D3 Branch A): guest scenarios cannot create decision '
  'records.';
COMMENT ON COLUMN public.decision_records.workspace_id IS
  'P1 amendment (workspace/identity design): workspace stamped at record '
  'birth (records outlive scenarios — no later backfill is possible for '
  'records whose scenarios are gone). NULL = pre-workspace record. NO FK: '
  'public.workspaces does not exist yet (Batch A creates it).';
COMMENT ON COLUMN public.decision_records.visibility IS
  'P1 amendment: ''private'' (default — owner-only; Decision P2) or '
  '''workspace'' (per-record opt-in; readable by workspace members only '
  'once the Phase-2 additive RLS policy lands — not created here).';
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
--
--    P1 amendment: p_workspace_id + p_visibility are STAMPED onto the row
--    but NOT projected into `record` — DecisionRecordSchema 0.15.0 is
--    .strict() and does not carry them yet (see header CHANGELOG).
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
  IF p_decision IS NULL OR jsonb_typeof(p_decision) <> 'object' THEN
    RAISE EXCEPTION 'create_decision_record: p_decision must be a JSON object'
      USING ERRCODE = '22023'; -- invalid_parameter_value
  END IF;
  IF p_decision - 'chosen_option_id' - 'chosen_option_label' - 'graph_hash' - 'analysis_summary'
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
  IF p_prediction IS NULL OR jsonb_typeof(p_prediction) <> 'object'
     OR p_prediction - 'statement' - 'confidence' <> '{}'::jsonb
     OR jsonb_typeof(p_prediction->'statement') IS DISTINCT FROM 'string'
     OR p_prediction->>'statement' = ''
     OR (p_prediction ? 'confidence'
         AND (jsonb_typeof(p_prediction->'confidence') <> 'number'
              OR (p_prediction->>'confidence')::numeric NOT BETWEEN 0 AND 1)) THEN
    RAISE EXCEPTION 'create_decision_record: p_prediction must be {statement: non-empty string, confidence?: number in [0,1]} and nothing else'
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
  v_scenario_id     UUID;
  v_scenario_exists BOOLEAN := false;
  v_rec             public.decision_records%ROWTYPE;
  v_event_id        TEXT;
  v_existing_event  JSONB;
  v_new_seq         INTEGER;
  v_event           JSONB;
  v_events          JSONB;
BEGIN
  -- Parameter guards — VALUE-LEVEL (fixup 2; outcome is write-once, so a
  -- malformed accepted payload would be permanently unrepairable). Same
  -- enforcement scope statement as create_decision_record's guards.
  IF p_outcome IS NULL OR jsonb_typeof(p_outcome) <> 'object'
     OR p_outcome - 'recorded_at' - 'result' - 'notes' - 'brier_component'
        <> '{}'::jsonb
     OR jsonb_typeof(p_outcome->'recorded_at') IS DISTINCT FROM 'string'
     OR p_outcome->>'recorded_at' = ''
     OR COALESCE(p_outcome->>'result', '')
        NOT IN ('better', 'as_expected', 'worse', 'abandoned')
     OR (p_outcome ? 'notes'
         AND (jsonb_typeof(p_outcome->'notes') <> 'string'
              OR p_outcome->>'notes' = ''))
     OR (p_outcome ? 'brier_component'
         AND (jsonb_typeof(p_outcome->'brier_component') <> 'number'
              OR (p_outcome->>'brier_component')::numeric < 0)) THEN
    RAISE EXCEPTION 'record_decision_outcome: p_outcome must be {recorded_at: string, result: better|as_expected|worse|abandoned, notes?: non-empty string, brier_component?: number >= 0} and nothing else'
      USING ERRCODE = '22023';
  END IF;
  -- recorded_at must at least be a real point in time (castability guard;
  -- the exact Zod offset-datetime grammar remains the app layer's parse).
  BEGIN
    PERFORM (p_outcome->>'recorded_at')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'record_decision_outcome: recorded_at is not a valid timestamp'
      USING ERRCODE = '22023';
  END;

  -- Locate the record (no lock yet) to learn its scenario. The record may
  -- legitimately OUTLIVE its scenario (no FK by design — see header):
  -- scenario absence is NOT an error on this path, only record absence is.
  SELECT scenario_id INTO v_scenario_id
    FROM public.decision_records
    WHERE record_id = p_record_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_decision_outcome: record % not found', p_record_id
      USING ERRCODE = 'DR404';
  END IF;

  -- If the scenario still exists, lock it FIRST (identical lock order to
  -- create_decision_record) to serialise the journey-event append. When
  -- it has been deleted, proceed without it — the record outlives it and
  -- the journey event is deliberately skipped below.
  PERFORM 1 FROM public.scenarios WHERE id = v_scenario_id FOR UPDATE;
  v_scenario_exists := FOUND;

  -- Re-select the record under its own lock so the write-once check is
  -- race-free. Record deletion is possible via service-role maintenance
  -- between the first read and this lock — DR404 covers that race.
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

  -- Journey event — only when the scenario still exists. Scenario deleted
  -- → the record outlives it (no FK by design); there is no journey to
  -- append to, so skip deliberately and return event_id NULL.
  IF v_scenario_exists THEN
    v_event_id := COALESCE(p_event_id, 'decision_outcome_recorded_' || p_record_id::text);
    SELECT events, event_seq + 1 INTO v_events, v_new_seq
      FROM public.scenarios WHERE id = v_scenario_id;
    -- Fixup 2, defect 3: same cross-record p_event_id collision rule as
    -- create_decision_record — never silently skip-and-claim.
    SELECT e INTO v_existing_event
      FROM jsonb_array_elements(COALESCE(v_events, '[]'::jsonb)) AS e
      WHERE e->>'event_id' = v_event_id;
    IF FOUND AND (v_existing_event->'details'->>'record_id') IS DISTINCT FROM p_record_id::text THEN
      RAISE EXCEPTION 'record_decision_outcome: p_event_id % collides with an existing journey event for a different record', v_event_id
        USING ERRCODE = '22023';
    END IF;
    IF NOT FOUND THEN
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
  ELSE
    v_event_id := NULL;
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
-- (Signature includes the P1-amendment parameters. Safe pre-execution:
-- no prior version of the function exists in any database, so the
-- CREATE above makes exactly one function — no overload, per the
-- distinct-names/no-overloads rule in the header.)
REVOKE EXECUTE ON FUNCTION public.create_decision_record(
  uuid, jsonb, jsonb, timestamptz, uuid, text, uuid, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_decision_record(
  uuid, jsonb, jsonb, timestamptz, uuid, text, uuid, text
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_decision_outcome(
  uuid, jsonb, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_decision_outcome(
  uuid, jsonb, text
) TO service_role;
