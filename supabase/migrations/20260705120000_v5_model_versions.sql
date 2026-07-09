-- ============================================================
-- V5 Layer 2 — Model Management v1: `model_versions` substrate
-- (Decision 1 Option B + Decision 3 Branch A, both signed 2026-07-05).
--
-- ⚠️  EXECUTED ON STAGING — 2026-07-08 (build e122f16). ⚠️
--   Paul's mandated execution approval (layer-1-architecture-decisions-memo-v0
--   §D1) landed; this migration has been APPLIED to staging Supabase, not
--   merely authored as code. Live rows exist (model_versions version 1 + 2
--   on scenario `330ffc3c-766b-4b58-9581-5dae191062e0`, pointer-advance +
--   identical-to-head dedupe all proven; a pre-existing "LIVE-PROVEN" row
--   from 2026-07-07 on scenario `e39bb25d…` predates this window). Evidence:
--   acceptance-evidence/gm-mm/03-mm-owned-scenario-proof.md (+ STATUS.md).
--   Do not re-describe this file as unexecuted/not-applied elsewhere in
--   Docs/ — see the same evidence pointer.
--
-- Target: Staging Supabase (executed)
-- Date authored: 2026-07-05
-- Date executed: 2026-07-08
--
-- What this creates (all additive; no existing table's semantics change):
--   1. `model_versions` — append-only, CEE-owned, service-role-written
--      version snapshots of a scenario's decision graph. One row = one
--      deliberate user-facing version. Full JSONB snapshots (no deltas at
--      this scale — substrate brief §2 size note).
--   2. `scenarios.current_model_version_id` — nullable pointer column,
--      the ONLY touch on an existing table. Moved exclusively inside the
--      RPCs below, under the scenarios row lock.
--   3. Two SECURITY DEFINER RPCs (service_role only):
--        create_model_version(...)  — insert version + move pointer +
--                                     journey event, one transaction.
--        restore_model_version(...) — restore = INSERT NEW version copying
--                                     the target's graph (history is NEVER
--                                     rewritten), move pointer, journey
--                                     event, one transaction.
--
-- Ownership (Decision 3 — Branch A, login first):
--   - owner_user_id uuid NOT NULL — no unowned durable rows, ever.
--   - Deliberately NO foreign key to auth.users: the substrate brief's §3
--     sketch carries none, and scenarios.user_id itself had its
--     auth.users FK dropped by 20260422000000 (guest relaxation), so an FK
--     here would be a stronger constraint than its own denormalisation
--     source can guarantee. The value is denormalised from
--     scenarios.user_id AT WRITE TIME inside the RPC.
--   - Guest scenarios (scenarios.user_id IS NULL) are REFUSED with the
--     distinct SQLSTATE 'MV001', which the CEE app layer maps to a typed,
--     recoverable "version history requires sign-in" error (D3 interim
--     guest posture).
--
-- A4 checklist applied (substrate brief §4 — every line load-bearing):
--   - ENABLE + FORCE ROW LEVEL SECURITY on model_versions.
--   - Owner-only SELECT policy for `authenticated`; NO INSERT/UPDATE/
--     DELETE policies for any JWT role (writes go exclusively through the
--     service-role RPCs, which bypass RLS).
--   - REVOKE ALL on the table FROM anon AND authenticated, then GRANT
--     SELECT (policy-scoped) back to authenticated only.
--   - Every function: SECURITY DEFINER + pinned search_path + EXPLICIT
--     `REVOKE ... FROM PUBLIC, anon, authenticated` + `GRANT ... TO
--     service_role`. Supabase default privileges auto-GRANT EXECUTE to
--     anon/authenticated on every new public function (see
--     20260609120000 lines 233–246), so the explicit revokes are
--     load-bearing, not belt-and-braces.
--   - DISTINCT function names, never overloads (the 20260426160532
--     PostgREST candidate-ambiguity lesson).
--
-- Distinct SQLSTATEs raised here (app maps each to a typed result):
--   MV001 — guest scenario refusal ("version history requires sign-in").
--   MV404 — restore target version not found for this scenario.
--   MV409 — expected-hash CAS conflict (stale write attempt).
--
-- Verification (run after the separately-approved execution):
--   SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--     WHERE relname = 'model_versions';                  -- t, t
--   SELECT proname FROM pg_proc
--     WHERE proname IN ('create_model_version','restore_model_version');
--   SELECT has_function_privilege('authenticated',
--     'public.create_model_version(uuid, jsonb, text, text, text, text, text, text, text, text, text)',
--     'EXECUTE');                                        -- false
--   SELECT has_function_privilege('service_role',
--     'public.create_model_version(uuid, jsonb, text, text, text, text, text, text, text, text, text)',
--     'EXECUTE');                                        -- true
--   (Grant-layer verification is against the LIVE database pg_proc/proacl,
--    not this file — the Group A method that caught A4.)
-- ============================================================

-- ------------------------------------------------------------
-- 1. The version table. Append-only; no updated_at by design
--    (versions are immutable — restore appends, never rewrites).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.model_versions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id                 UUID NOT NULL REFERENCES public.scenarios(id) ON DELETE CASCADE,
  -- Decision 3 Branch A: NOT NULL, denormalised from scenarios.user_id at
  -- write time. No FK to auth.users (see header). Unowned durable rows are
  -- impossible by constraint.
  owner_user_id               UUID NOT NULL,
  -- Per-scenario monotonic ordering identity, RPC-assigned under the
  -- scenarios row lock. This is the user-facing "v7".
  version_number              INTEGER NOT NULL,
  -- Full snapshot. No deltas at this graph scale (tens of nodes/edges).
  graph                       JSONB NOT NULL,
  -- Content identity: the Group A graphIdentityHash envelope, stored
  -- verbatim (src/orchestrator-v5/context/graph-identity.ts). Hashes are
  -- only comparable within matching projection/normaliser versions, so the
  -- version fields are persisted alongside the value. Deliberately NOT
  -- unique — restoring an older state legitimately re-creates an earlier
  -- hash at a later version_number.
  graph_identity_hash         TEXT NOT NULL,
  hash_algorithm              TEXT NOT NULL,
  identity_projection_version TEXT NOT NULL,
  identity_normaliser_version TEXT NOT NULL,
  graph_schema_version        TEXT NOT NULL,
  -- Optional user-facing label and machine provenance (e.g. 'user_save').
  label                       TEXT,
  provenance                  TEXT,
  -- Restore lineage: set iff this version was created by
  -- restore_model_version, pointing at the version whose graph was copied.
  restored_from_version_id    UUID REFERENCES public.model_versions(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scenario_id, version_number)
);

COMMENT ON TABLE public.model_versions IS
  'Model Management v1 (Layer 2, D1 Option B): append-only, deliberate '
  'user-facing versions of scenarios.graph. Written EXCLUSIVELY by the CEE '
  'service role via create_model_version / restore_model_version. '
  'Restore never rewrites history — it appends a new version. '
  'Ownership: D3 Branch A (owner_user_id NOT NULL; guests refused).';
COMMENT ON COLUMN public.model_versions.owner_user_id IS
  'Denormalised from scenarios.user_id at write time by the RPC. NOT NULL '
  'by decision (D3 Branch A): guest scenarios cannot create versions.';
COMMENT ON COLUMN public.model_versions.graph_identity_hash IS
  '64-hex sha256 from the Group A graphIdentityHash envelope '
  '(identity projection — NOT the analysis-affecting hash, NOT the legacy '
  'UI graph_hash in scenario_snapshots; the three regimes never compare).';

CREATE INDEX IF NOT EXISTS model_versions_scenario_created_idx
  ON public.model_versions (scenario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS model_versions_scenario_hash_idx
  ON public.model_versions (scenario_id, graph_identity_hash);

-- ------------------------------------------------------------
-- 2. RLS — ENABLE + FORCE; owner-only SELECT for authenticated;
--    NO write policies for any JWT role.
-- ------------------------------------------------------------
ALTER TABLE public.model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_versions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_own_model_versions ON public.model_versions;
CREATE POLICY select_own_model_versions ON public.model_versions
  FOR SELECT TO authenticated
  USING (auth.uid() = owner_user_id);

-- Table grants: strip everything from JWT roles, then re-grant SELECT
-- (policy-scoped) to authenticated only. anon gets nothing.
REVOKE ALL ON public.model_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.model_versions TO authenticated;
GRANT ALL ON public.model_versions TO service_role;

-- ------------------------------------------------------------
-- 3. Current-version pointer on scenarios — the only touch on an
--    existing table. Nullable; ON DELETE SET NULL so deleting a
--    version can never break the scenario row. Moved ONLY inside
--    the RPCs below, under the scenarios row lock.
-- ------------------------------------------------------------
ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS current_model_version_id UUID
  REFERENCES public.model_versions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.scenarios.current_model_version_id IS
  'Model Management v1: head pointer into model_versions. NULL = no '
  'versions yet. Moved exclusively by create_model_version / '
  'restore_model_version under the scenarios row lock.';

-- ------------------------------------------------------------
-- 4. create_model_version — the single write path for new versions.
--
--    One transaction: guest refusal → optional CAS → no-op dedupe →
--    version_number assignment under row lock → INSERT → pointer move →
--    journey event append (idempotent by event_id, inlined — the existing
--    append_scenario_event RPC checks `user_id = auth.uid()`, which is
--    NULL for the service role, so the same event shape/plumbing is
--    replicated inline while we already hold the scenarios row lock;
--    the Journey tab renders these events unchanged).
--
--    No-op dedupe (substrate brief §2 mitigation i): when the head
--    version's identity envelope exactly matches the payload's, no new
--    version, no pointer move, no event — the head is returned with
--    deduped = true. This also makes post-commit RETRIES of an identical
--    call idempotent end-to-end.
--
--    CAS seam (optional p_expected_graph_identity_hash): evaluated
--    in-transaction under the row lock against the CURRENT HEAD version's
--    stored graph_identity_hash. Mismatch → SQLSTATE MV409. NULL expected
--    → observe-only, no check (mirrors evaluateGraphIdentityCas
--    'no_expected' semantics).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_model_version(
  p_scenario_id                  UUID,
  p_graph                        JSONB,
  p_graph_identity_hash          TEXT,
  p_projection_version           TEXT,
  p_normaliser_version           TEXT,
  p_graph_schema_version         TEXT,
  p_hash_algorithm               TEXT DEFAULT 'sha256',
  p_label                        TEXT DEFAULT NULL,
  p_provenance                   TEXT DEFAULT NULL,
  p_event_id                     TEXT DEFAULT NULL,
  p_expected_graph_identity_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_owner        UUID;
  v_head_id      UUID;
  v_head         public.model_versions%ROWTYPE;
  v_next_number  INTEGER;
  v_new_id       UUID;
  v_event_id     TEXT;
  v_new_seq      INTEGER;
  v_event        JSONB;
  v_events       JSONB;
BEGIN
  -- Parameter guards. A NULL graph must never create a version (contrast
  -- the store_draft_graph unconditional-UPDATE lesson).
  IF p_graph IS NULL THEN
    RAISE EXCEPTION 'create_model_version: p_graph must not be null'
      USING ERRCODE = '22023'; -- invalid_parameter_value
  END IF;
  IF p_graph_identity_hash IS NULL OR p_graph_identity_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'create_model_version: p_graph_identity_hash must be 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_projection_version IS NULL OR p_normaliser_version IS NULL
     OR p_graph_schema_version IS NULL OR p_hash_algorithm IS NULL THEN
    RAISE EXCEPTION 'create_model_version: identity envelope version fields must not be null'
      USING ERRCODE = '22023';
  END IF;

  -- Row lock: serialises version_number assignment, CAS evaluation and
  -- pointer movement per scenario. FOUND distinguishes "row absent" from
  -- "guest row with user_id IS NULL".
  SELECT user_id, current_model_version_id
    INTO v_owner, v_head_id
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_model_version: scenario % not found', p_scenario_id;
  END IF;

  -- D3 Branch A guest refusal — distinct ERRCODE, app maps to the typed
  -- recoverable "version history requires sign-in" error.
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'create_model_version: scenario % has no owner — version history requires sign-in', p_scenario_id
      USING ERRCODE = 'MV001';
  END IF;

  IF v_head_id IS NOT NULL THEN
    SELECT * INTO v_head FROM public.model_versions WHERE id = v_head_id;
  END IF;

  -- Optional in-transaction CAS against the head version's stored hash.
  IF p_expected_graph_identity_hash IS NOT NULL THEN
    IF v_head_id IS NULL OR v_head.id IS NULL
       OR v_head.graph_identity_hash <> p_expected_graph_identity_hash THEN
      RAISE EXCEPTION 'create_model_version: expected head hash % does not match current head', p_expected_graph_identity_hash
        USING ERRCODE = 'MV409';
    END IF;
  END IF;

  -- No-op dedupe: identical identity envelope at the head → return head.
  IF v_head_id IS NOT NULL AND v_head.id IS NOT NULL
     AND v_head.graph_identity_hash = p_graph_identity_hash
     AND v_head.identity_projection_version = p_projection_version
     AND v_head.identity_normaliser_version = p_normaliser_version
     AND v_head.graph_schema_version = p_graph_schema_version THEN
    RETURN jsonb_build_object(
      'version_id', v_head.id,
      'version_number', v_head.version_number,
      'graph_identity_hash', v_head.graph_identity_hash,
      'deduped', true,
      'event_id', NULL
    );
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_number
    FROM public.model_versions
    WHERE scenario_id = p_scenario_id;

  INSERT INTO public.model_versions (
    scenario_id, owner_user_id, version_number, graph,
    graph_identity_hash, hash_algorithm,
    identity_projection_version, identity_normaliser_version,
    graph_schema_version, label, provenance
  ) VALUES (
    p_scenario_id, v_owner, v_next_number, p_graph,
    p_graph_identity_hash, p_hash_algorithm,
    p_projection_version, p_normaliser_version,
    p_graph_schema_version, p_label, p_provenance
  )
  RETURNING id INTO v_new_id;

  UPDATE public.scenarios
    SET current_model_version_id = v_new_id
    WHERE id = p_scenario_id;

  -- Journey event — same shape append_scenario_event produces, so the
  -- existing Journey tab renders it with zero UI change. Idempotent by
  -- event_id (deterministic default keyed on the new version row id).
  v_event_id := COALESCE(p_event_id, 'model_version_created_' || v_new_id::text);
  SELECT events, event_seq + 1 INTO v_events, v_new_seq
    FROM public.scenarios WHERE id = p_scenario_id;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_events, '[]'::jsonb)) AS e
    WHERE e->>'event_id' = v_event_id
  ) THEN
    v_event := jsonb_build_object(
      'event_id',   v_event_id,
      'event_type', 'model_version_created',
      'seq',        v_new_seq,
      'timestamp',  to_jsonb(now()),
      'details',    jsonb_strip_nulls(jsonb_build_object(
                      'version_id', v_new_id,
                      'version_number', v_next_number,
                      'label', p_label,
                      'provenance', p_provenance
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

  RETURN jsonb_build_object(
    'version_id', v_new_id,
    'version_number', v_next_number,
    'graph_identity_hash', p_graph_identity_hash,
    'deduped', false,
    'event_id', v_event_id
  );
END;
$$;

-- ------------------------------------------------------------
-- 5. restore_model_version — restore = INSERT NEW version copying the
--    target's graph and identity envelope, with restored_from_version_id
--    provenance; move pointer; journey event. History is NEVER rewritten.
--    Same guest refusal + row-lock + optional-CAS discipline as create.
--    Restoring when the head already carries the target's exact identity
--    envelope dedupes to the head (no duplicate no-op version; also makes
--    post-commit retries idempotent).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_model_version(
  p_scenario_id                  UUID,
  p_version_id                   UUID,
  p_label                        TEXT DEFAULT NULL,
  p_event_id                     TEXT DEFAULT NULL,
  p_expected_graph_identity_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_owner        UUID;
  v_head_id      UUID;
  v_head         public.model_versions%ROWTYPE;
  v_target       public.model_versions%ROWTYPE;
  v_next_number  INTEGER;
  v_new_id       UUID;
  v_event_id     TEXT;
  v_new_seq      INTEGER;
  v_event        JSONB;
  v_events       JSONB;
BEGIN
  SELECT user_id, current_model_version_id
    INTO v_owner, v_head_id
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restore_model_version: scenario % not found', p_scenario_id;
  END IF;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'restore_model_version: scenario % has no owner — version history requires sign-in', p_scenario_id
      USING ERRCODE = 'MV001';
  END IF;

  -- Target must exist AND belong to this scenario (cross-scenario restore
  -- is refused with the same not-found code — no existence oracle).
  SELECT * INTO v_target
    FROM public.model_versions
    WHERE id = p_version_id AND scenario_id = p_scenario_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restore_model_version: version % not found for scenario %', p_version_id, p_scenario_id
      USING ERRCODE = 'MV404';
  END IF;

  IF v_head_id IS NOT NULL THEN
    SELECT * INTO v_head FROM public.model_versions WHERE id = v_head_id;
  END IF;

  IF p_expected_graph_identity_hash IS NOT NULL THEN
    IF v_head_id IS NULL OR v_head.id IS NULL
       OR v_head.graph_identity_hash <> p_expected_graph_identity_hash THEN
      RAISE EXCEPTION 'restore_model_version: expected head hash % does not match current head', p_expected_graph_identity_hash
        USING ERRCODE = 'MV409';
    END IF;
  END IF;

  -- Dedupe: head already IS the target state → nothing to restore.
  IF v_head_id IS NOT NULL AND v_head.id IS NOT NULL
     AND v_head.graph_identity_hash = v_target.graph_identity_hash
     AND v_head.identity_projection_version = v_target.identity_projection_version
     AND v_head.identity_normaliser_version = v_target.identity_normaliser_version
     AND v_head.graph_schema_version = v_target.graph_schema_version THEN
    RETURN jsonb_build_object(
      'version_id', v_head.id,
      'version_number', v_head.version_number,
      'graph_identity_hash', v_head.graph_identity_hash,
      'restored_from_version_id', p_version_id,
      'deduped', true,
      'event_id', NULL
    );
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_number
    FROM public.model_versions
    WHERE scenario_id = p_scenario_id;

  -- Byte-copy of the target's graph + identity envelope. Same graph under
  -- the same projection/normaliser versions ⇒ same identity hash, so the
  -- envelope columns are copied verbatim, never recomputed here.
  INSERT INTO public.model_versions (
    scenario_id, owner_user_id, version_number, graph,
    graph_identity_hash, hash_algorithm,
    identity_projection_version, identity_normaliser_version,
    graph_schema_version, label, provenance, restored_from_version_id
  ) VALUES (
    p_scenario_id, v_owner, v_next_number, v_target.graph,
    v_target.graph_identity_hash, v_target.hash_algorithm,
    v_target.identity_projection_version, v_target.identity_normaliser_version,
    v_target.graph_schema_version, p_label, 'restore', p_version_id
  )
  RETURNING id INTO v_new_id;

  UPDATE public.scenarios
    SET current_model_version_id = v_new_id
    WHERE id = p_scenario_id;

  v_event_id := COALESCE(p_event_id, 'model_version_restored_' || v_new_id::text);
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
                      'label', p_label
                    )),
      'hashes',     jsonb_build_object(
                      'graph_identity_hash', v_target.graph_identity_hash,
                      'algorithm', v_target.hash_algorithm,
                      'projection_version', v_target.identity_projection_version,
                      'normaliser_version', v_target.identity_normaliser_version,
                      'graph_schema_version', v_target.graph_schema_version
                    )
    );
    UPDATE public.scenarios
      SET events    = COALESCE(events, '[]'::jsonb) || jsonb_build_array(v_event),
          event_seq = v_new_seq,
          updated_at = now()
      WHERE id = p_scenario_id;
  END IF;

  RETURN jsonb_build_object(
    'version_id', v_new_id,
    'version_number', v_next_number,
    'graph_identity_hash', v_target.graph_identity_hash,
    'restored_from_version_id', p_version_id,
    'deduped', false,
    'event_id', v_event_id
  );
END;
$$;

-- ------------------------------------------------------------
-- 6. Function grants — the A4 lesson, applied explicitly per function.
--    Supabase default privileges auto-GRANT EXECUTE to anon/authenticated
--    on new public functions; REVOKE FROM PUBLIC alone is insufficient.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_model_version(
  uuid, jsonb, text, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_model_version(
  uuid, jsonb, text, text, text, text, text, text, text, text, text
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.restore_model_version(
  uuid, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.restore_model_version(
  uuid, uuid, text, text, text
) TO service_role;
