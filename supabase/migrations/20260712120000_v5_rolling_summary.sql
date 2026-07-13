-- ============================================================
-- Context Architecture v2 — S4 rolling conversation summary
-- (ROADMAP 1.73; design pack CONTEXT-ARCHITECTURE-V2-2026-07-13/01 §2, §4,
--  04 §3, 05 §S4). CEE half.
--
-- ⚠ DRAFT — NOT YET EXECUTED. Paul-gated (same posture as
--   20260710113000_v5_decision_records.sql at authoring time): the CEE
--   maintainer ships flag-dark behind CEE_ROLLING_SUMMARY (default 'off'),
--   AND the RPCs below do not exist on staging until this file is executed.
--   Until then the store adapter surfaces the PostgREST "function not found"
--   error as a RollingSummaryStoreError, which the fire-and-forget maintainer
--   logs and swallows — never a turn failure, never silent corruption.
--
-- ⚠ DRAFT AMENDED 2026-07-13 (pre-execution — file never run anywhere, so
--   in-place amendment is safe; Codex round-2 fix 3): the monotonic guard is
--   now COMPOSITE (updated_turn_created_at, updated_turn_id, version) instead
--   of the timestamp alone. The session store permits same-timestamp turns
--   and totally orders them (created_at, turn_id) — see readRecent's
--   deterministic tiebreak in session/supabase-store.ts — so a timestamp-only
--   `<` guard would silently no-op the write that absorbs a same-timestamp
--   sibling of the watermark turn, stranding that turn's content out of the
--   summary permanently. Signatures are UNCHANGED (the tiebreak keys are read
--   from p_summary, which already carries them), so the rollback file needs
--   no change. JS reference of this exact clause: FakeMonotonicStore in
--   src/orchestrator-v5/rolling-summary/__tests__/maintainer.test.ts.
--
-- Target: Staging Supabase
-- Date authored: 2026-07-12
-- Date executed: (pending — Paul-gated batch)
--
-- What this creates (all additive; scenarios is the only table touched, and
-- only by ADDING one nullable column — no existing column/row is modified):
--   1. scenarios.rolling_summary JSONB NULL — the four-slot rolling summary
--      of the conversation (FRAME / CONSTRAINTS / RESOLVED / OPEN), maintained
--      turn-by-turn OFF the turn path by the CEE summariser. NULL = no summary
--      yet (pre-S4 rows, or a scenario whose first summariser pass has not
--      landed). Written EXCLUSIVELY by the CEE service role via the RPC below.
--   2. upsert_rolling_summary(...) — the MONOTONIC conditional write. This is
--      the real cross-instance safety guard (design pack 01 §2 / 07 R4): the
--      summariser writes a MUTABLE SINGLETON row, so — unlike decision_records,
--      which is idempotent via a deterministic record id — an out-of-order or
--      retried write could otherwise REGRESS the watermark (a stale full-history
--      regen landing after a fresher incremental). The WHERE clause makes any
--      write whose watermark is not strictly newer than the stored one a silent
--      no-op. The in-process single-flight (CEE side) is a convenience only;
--      correctness under rolling deploys / overlapping instances rests HERE.
--   3. get_rolling_summary(...) — read the current summary for a scenario (the
--      maintainer reads the prior summary to build the incremental input; the
--      injector — S4 follow-up — reads it to compute summary_lag and inject).
--
-- WATERMARK (the monotonic key, COMPOSITE): the guard orders on
--   (updated_turn_created_at, updated_turn_id, version) — timestamp first;
--   at a timestamp tie, updated_turn_id text order breaks it (matching the
--   session store's readRecent tiebreak `ORDER BY created_at DESC, turn_id
--   DESC`, so "greater turn_id at equal created_at" == "later in the store's
--   total order"); at a full watermark tie, the app-side monotonic `version`
--   counter breaks it (a later pass that absorbed a same-timestamp SIBLING
--   of an unchanged watermark turn — the sibling-absorption write MUST land).
--   "Strictly greater composite" == "covers strictly more of the
--   conversation". Collation note: turn ids are ASCII (uuid-style client
--   strings), so text comparison here, PostgREST ordering, and JS string
--   comparison agree on the range in use; the tiebreak only ever decides
--   same-timestamp siblings.
--
-- DOCTRINE (design pack 04 §3.4 — "no layer writes to another"): this RPC
--   writes ONLY scenarios.rolling_summary. It never touches graph, brief_text,
--   v5_conversation_turns, v5_handler_facts, or decision_records. Memory can be
--   wrong; it can never corrupt ground truth.
--
-- A4 checklist (mirrors 20260710113000_v5_decision_records.sql):
--   - No RLS change: scenarios already ENABLE+FORCE RLS with owner policies;
--     rolling_summary is read back only through the service-role RPCs (which
--     bypass RLS) and the existing owner-scoped scenarios SELECT policy already
--     governs any direct authenticated read of the new column (it is content —
--     conversation-derived prose — so it must inherit the row's owner scope; it
--     does, because it is a column on the already-policied scenarios row).
--   - Every function: SECURITY DEFINER + pinned search_path + EXPLICIT
--     REVOKE ... FROM PUBLIC, anon, authenticated + GRANT ... TO service_role
--     (Supabase auto-GRANTs EXECUTE to anon/authenticated on new public
--     functions — the explicit revokes are load-bearing).
--   - DISTINCT function names, never overloads (the 20260426160532 lesson).
--
-- Distinct SQLSTATE raised here (app maps to a typed result):
--   RS001 — malformed p_summary (value-level shape guard failed). The write is
--           refused rather than persisting a summary that would fail the
--           read-side Zod parse and be un-injectable.
--
-- Verification (run after the separately-approved execution):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='scenarios' AND column_name='rolling_summary';   -- 1 row
--   SELECT has_function_privilege('authenticated',
--     'public.upsert_rolling_summary(uuid, jsonb, timestamptz)', 'EXECUTE'); -- false
--   SELECT has_function_privilege('service_role',
--     'public.upsert_rolling_summary(uuid, jsonb, timestamptz)', 'EXECUTE'); -- true
--   SELECT has_function_privilege('service_role',
--     'public.get_rolling_summary(uuid)', 'EXECUTE');                    -- true
-- ============================================================

-- ------------------------------------------------------------
-- 1. The column. Additive, nullable, no default — NULL is the
--    honest "no summary yet" state and every reader treats it so.
-- ------------------------------------------------------------
ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS rolling_summary JSONB;

COMMENT ON COLUMN public.scenarios.rolling_summary IS
  'Context Architecture v2 S4 (ROADMAP 1.73): four-slot rolling conversation '
  'summary {text, slots[{slot, entries[{text, source_turn_ids}]}], '
  'updated_turn_id, updated_turn_created_at, version, generator}. Maintained '
  'OFF the turn path by the CEE summariser (haiku-class), monotonic on '
  'updated_turn_created_at. NULL = not yet summarised. Written EXCLUSIVELY by '
  'the CEE service role via upsert_rolling_summary. Doctrine P: summary text '
  'carries no raw floats (04 §3.3).';

-- ------------------------------------------------------------
-- 2. upsert_rolling_summary — the MONOTONIC conditional write.
--
--    Returns jsonb:
--      { applied: boolean,               -- true = the write advanced the row
--        regressed: boolean,             -- true = stale/out-of-order, no-op'd
--        current_watermark: text|null }  -- the watermark now on the row
--
--    applied=false + regressed=true is the DESIGNED no-op for an out-of-order
--    land — NOT an error. The caller logs it at debug and moves on.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_rolling_summary(
  p_scenario_id             UUID,
  p_summary                 JSONB,
  p_updated_turn_created_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_stored_watermark TIMESTAMPTZ;
  v_stored_turn_id   TEXT;
  v_stored_version   BIGINT;
  v_new_turn_id      TEXT;
  v_new_version      BIGINT;
  v_found            BOOLEAN;
  v_applied          BOOLEAN := false;
BEGIN
  -- Value-level shape guard (RS001). The summary is read back into a
  -- .strict()-style Zod parse and injected into an LLM prompt; a malformed
  -- singleton would be silently un-injectable. Enforce object-ness + the
  -- required top-level key-set, and the types of the two composite-guard
  -- tiebreak keys (they are compared below, so a wrong type must be refused,
  -- not coerced). (Deep slot validation is the app-layer parse; this is the
  -- DB backstop, mirroring the decision_records guard posture.)
  IF p_summary IS NULL OR jsonb_typeof(p_summary) <> 'object'
     OR NOT (p_summary ? 'text')
     OR NOT (p_summary ? 'slots')
     OR NOT (p_summary ? 'updated_turn_id')
     OR NOT (p_summary ? 'updated_turn_created_at')
     OR NOT (p_summary ? 'version')
     OR NOT (p_summary ? 'generator')
     OR jsonb_typeof(p_summary->'slots') <> 'array'
     OR jsonb_typeof(p_summary->'updated_turn_id') <> 'string'
     OR jsonb_typeof(p_summary->'version') <> 'number' THEN
    RAISE EXCEPTION 'upsert_rolling_summary: p_summary is malformed (missing required keys or wrong types)'
      USING ERRCODE = 'RS001';
  END IF;
  IF p_updated_turn_created_at IS NULL OR NOT isfinite(p_updated_turn_created_at) THEN
    RAISE EXCEPTION 'upsert_rolling_summary: p_updated_turn_created_at must be a finite timestamptz'
      USING ERRCODE = 'RS001';
  END IF;

  -- Row lock: serialise concurrent summariser writes per scenario so the
  -- read-compare-write below is race-free within one instance; the WHERE
  -- predicate itself is what protects across instances.
  SELECT (rolling_summary->>'updated_turn_created_at')::timestamptz,
         COALESCE(rolling_summary->>'updated_turn_id', ''),
         COALESCE((rolling_summary->>'version')::bigint, 0)
    INTO v_stored_watermark, v_stored_turn_id, v_stored_version
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  v_found := FOUND;

  IF NOT v_found THEN
    -- No scenario row — nothing to attach a summary to. Not an error on the
    -- fire-and-forget path (a guest/ephemeral scenario may have no row); the
    -- caller treats applied=false as "nothing written".
    RETURN jsonb_build_object('applied', false, 'regressed', false, 'current_watermark', NULL);
  END IF;

  -- MONOTONIC guard, COMPOSITE (created_at, turn_id, version) — Codex r2
  -- fix 3: apply ONLY when the composite is strictly greater than what is
  -- stored (or nothing is stored). An identical composite (a retried write)
  -- or an older one ⇒ silent no-op. The turn_id tiebreak lets a summary
  -- watermarked at a same-timestamp LATER sibling land; the version tiebreak
  -- lets a later pass that absorbed a same-timestamp EARLIER sibling (same
  -- watermark turn, higher app-side version counter) land. This predicate is
  -- what the whole R4 safety argument rests on.
  v_new_turn_id := p_summary->>'updated_turn_id';
  v_new_version := (p_summary->>'version')::bigint;
  IF v_stored_watermark IS NULL
     OR v_stored_watermark < p_updated_turn_created_at
     OR (v_stored_watermark = p_updated_turn_created_at
         AND (v_stored_turn_id < v_new_turn_id
              OR (v_stored_turn_id = v_new_turn_id AND v_stored_version < v_new_version))) THEN
    UPDATE public.scenarios
      SET rolling_summary = p_summary,
          updated_at      = now()
      WHERE id = p_scenario_id;
    v_applied := true;
  END IF;

  RETURN jsonb_build_object(
    'applied', v_applied,
    'regressed', NOT v_applied,
    'current_watermark',
      to_jsonb(COALESCE(
        CASE WHEN v_applied THEN p_updated_turn_created_at ELSE v_stored_watermark END,
        p_updated_turn_created_at
      ))
  );
END;
$$;

-- ------------------------------------------------------------
-- 3. get_rolling_summary — read the current summary (or NULL).
--    Service-role read; used by the maintainer (prior-summary input) and,
--    in the S4 injection follow-up, by the assembler.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_rolling_summary(
  p_scenario_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_summary JSONB;
BEGIN
  SELECT rolling_summary INTO v_summary
    FROM public.scenarios
    WHERE id = p_scenario_id;
  -- Absent row and absent summary both read as NULL — the caller treats both
  -- as "no prior summary" (first summariser pass, or pre-S4 scenario).
  RETURN v_summary;
END;
$$;

-- ------------------------------------------------------------
-- 4. Function grants — explicit per function (Supabase auto-GRANTs
--    EXECUTE to anon/authenticated on new public functions).
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.upsert_rolling_summary(uuid, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_rolling_summary(uuid, jsonb, timestamptz)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_rolling_summary(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_rolling_summary(uuid)
  TO service_role;
