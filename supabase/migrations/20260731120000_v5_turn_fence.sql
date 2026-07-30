-- ============================================================
-- V5 TURN FENCE — the Stop tombstone + the per-scenario generation fence.
-- Codex P0 (`parallel-briefs/STOP-FENCE-BUILD-2026-07-31.md`), 2026-07-31.
--
-- ✅  EXECUTED ON STAGING 2026-07-30. Authorised as the orchestrator's recorded
--     decision under the standing staging mandate (the batching authority this
--     header previously described as Paul-gated, per the
--     20260710190000_v5_claim_guest_scenario.sql precedent).
--
--     Applied by /private/tmp/stopfence-sqlcheck-a7f3/apply-turn-fence.mjs in
--     commit mode — byte-identical to the rehearsal that had proven it on the
--     same database with a ROLLBACK, except the rollback is gone.
--     Evidence: PHASE0-EVIDENCE-2026-07-28/fix-stop-fence.md
--       §"MIGRATION EXECUTED ON STAGING".
--     All assertions passed: pre-flight non-vacuity (both objects absent) →
--     migration → all four objects present → ACL service_role-only with RLS on →
--     behavioural smoke (monotonic + idempotent claim, tombstone, supersession).
--     Re-running the applier now REFUSES at the pre-flight guard, which is the
--     guard working rather than a fault.
--
-- ⚠️  MIGRATION-FIRST IS LOAD-BEARING FOR THIS ONE. The application half
--     FAILS CLOSED: a graph-bearing commit whose fence cannot be evaluated
--     is REFUSED (see src/orchestrator-v5/session/turn-fence.ts). So if
--     this migration is not live in the target DB, graph writes refuse and
--     drafting breaks — loudly, immediately, and visibly, rather than
--     silently running unfenced. Execute this BEFORE the code deploys.
--     Non-graph turns (answers, analysis, receipts) are never fenced and
--     keep working either way.
--
--     ⚠️⚠️  THAT PROMISE WAS FALSE WHEN FIRST WRITTEN, AND THE FIX IS WHAT
--     MAKES IT TRUE. The #759 adversarial review proved that a missing
--     migration presented as PGRST202 on the ingress CLAIM, which bound no
--     fence handle, so the commit took its "never came through the fenced
--     ingress" branch and ALLOWED the write. A wrong deploy order therefore
--     ran SILENTLY UNFENCED — the exact opposite of this paragraph. A failed
--     claim now binds an unclaimed handle and graph writes refuse. Anyone
--     re-reading this header for reassurance should note that it needed a
--     reviewer to make it honest.
--
-- Target: Staging Supabase
-- Date authored: 2026-07-31
-- Date executed: 2026-07-30 (staging; production out of scope for the POC)
--
-- ── WHY ──────────────────────────────────────────────────────────────
-- Reproduced live on staging 2026-07-29 (evidence:
-- PHASE0-EVIDENCE-2026-07-28/fix-stop-fence.md, scenario
-- a6ccf5cf-aab0-4f01-b889-e0d6c072067c):
--
--   · A streamed draft turn was STOPPED by the user at +4.0s. The UI's Stop
--     aborts only its own AbortController, and streamed-turn-sse.ts:71-78
--     deliberately does not cancel the turn on hangup — so the turn ran the
--     full 52.7s and COMMITTED.
--   · A second, different turn was sent on the same scenario at +5.0s. It
--     committed at 23:43:37.438179; the stopped turn committed 163 ms later
--     at 23:43:37.601964 and OVERWROTE its graph. Final state was forked:
--     brief_text from the live turn, graph from the stopped one.
--
-- Two facts had nowhere to live: "the user explicitly stopped THIS turn"
-- and "a LATER turn has since claimed this scenario". This table is where
-- they live, and `v5_evaluate_turn_fence` is the question the commit path
-- asks immediately before it writes.
--
-- ── WHY A TABLE AND NOT PROCESS MEMORY ───────────────────────────────
-- The Stop request and the in-flight turn are two separate HTTP requests
-- and are NOT guaranteed to reach the same service instance (cee-staging's
-- served-prompt reads have demonstrably split across instances — see
-- CLAUDE.md trap 12c). An in-process Map would fence correctly on a
-- single-instance deployment and silently stop fencing the day the service
-- scaled: guarantee theatre with a scale trigger. The fence is a
-- data-integrity guarantee, so its state is durable and shared.
--
-- ── WHY `generation` IS A bigserial ──────────────────────────────────
-- The fence needs a strict order of turn STARTS per scenario. Deriving it
-- as `MAX(generation) + 1` in the claim would race two concurrent claims
-- into the same value (the exact defect the fence exists to catch). A
-- sequence is race-free by construction: globally monotonic, therefore
-- also monotonic within every scenario, with no lock and no read. Gaps
-- (from ON CONFLICT re-claims and rolled-back transactions) are expected
-- and carry no meaning — ONLY the ORDER is load-bearing.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.v5_turn_fence (
  -- Strict start-order across all scenarios; compared only WITHIN a
  -- scenario. See the bigserial rationale above.
  generation   BIGSERIAL   PRIMARY KEY,
  scenario_id  UUID        NOT NULL,
  -- The INGRESS turn id (OrchestratorTurnPayload.turn_id) — the identity
  -- the browser generated and can therefore name in a Stop request.
  -- Deliberately TEXT, matching v5_conversation_turns.turn_id, and
  -- deliberately NOT a FK to it: the fence row is written when the turn
  -- STARTS, and no v5_conversation_turns row exists until it commits.
  turn_id      TEXT        NOT NULL,
  -- The Stop tombstone. NULL = never stopped. Set by v5_mark_turn_stopped.
  stopped_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT v5_turn_fence_scenario_turn_key UNIQUE (scenario_id, turn_id)
);

-- The pre-commit question is always "what is the newest generation for THIS
-- scenario", so the index carries the scenario and orders the generation.
CREATE INDEX IF NOT EXISTS v5_turn_fence_scenario_generation_idx
  ON public.v5_turn_fence (scenario_id, generation DESC);

COMMENT ON TABLE public.v5_turn_fence IS
  'V5 turn fence (Codex P0, 2026-07-31): one row per turn START. Holds the per-scenario start order (generation) and the explicit-Stop tombstone (stopped_at). Read immediately before every graph-bearing commit by v5_evaluate_turn_fence. Rows are never deleted by the application; retention is a separate, rowed decision. RETENTION HAZARD: any future trim MUST NOT delete a row for an IN-FLIGHT turn, and must not delete the NEWEST row of a scenario — a turn whose row is gone evaluates as unclaimed and its graph write is refused, and trimming the newest row lowers max_generation so an older in-flight turn reads as current and can clobber. Trim by created_at with a margin well above the turn budget, and never trim rows whose turn has no v5_conversation_turns row yet.';

-- ⚠️  RETENTION, SPELLED OUT NEXT TO THE TABLE IT ENDANGERS (raised as a
--     non-blocking note by the #759 review). The two ways a well-meaning
--     cleanup job breaks the fence:
--       1. deleting an IN-FLIGHT turn's row  → that turn evaluates `unclaimed`
--          and its graph write is refused (a lost draft, fail-closed but real);
--       2. deleting a scenario's NEWEST row  → max_generation drops, so an
--          older in-flight turn reads `current` and can CLOBBER a newer graph.
--     (2) is the dangerous one: it silently reintroduces the defect this table
--     exists to prevent. No trim job exists today, and this comment is here so
--     the first one written cannot claim it was not warned.

-- ────────────────────────────────────────────────────────────────────
-- CLAIM — called once per turn, at ingress (/orchestrate/v2/turn).
--
-- Idempotent on (scenario_id, turn_id): a retry of the SAME turn returns
-- the SAME generation, so an idempotent replay is not treated as a newer
-- turn superseding itself. The no-op DO UPDATE exists purely so the
-- existing row can be RETURNED (ON CONFLICT DO NOTHING returns no rows).
--
-- ⚠️  IT MUST NOT CLEAR `stopped_at`. A Stop can arrive BEFORE the claim
--     lands (v5_mark_turn_stopped upserts for exactly that case); if this
--     reset the tombstone, that race would silently unfence the turn.
--     Pinned by the migration static guard test.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.v5_claim_turn_fence(
  p_scenario_id UUID,
  p_turn_id     TEXT
) RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.v5_turn_fence (scenario_id, turn_id)
  VALUES (p_scenario_id, p_turn_id)
  ON CONFLICT (scenario_id, turn_id) DO UPDATE
    SET scenario_id = public.v5_turn_fence.scenario_id
  RETURNING generation;
$$;

-- ────────────────────────────────────────────────────────────────────
-- EVALUATE — called immediately before a graph-bearing commit.
--
-- Returns the three facts the commit path needs, in ONE round trip:
--   claimed         — is there a fence row for this (scenario, turn)?
--   stopped         — has an explicit user Stop been recorded for it?
--   generation      — this turn's start order
--   max_generation  — the newest start order on this scenario
--
-- `generation < max_generation` means a LATER turn has claimed this
-- scenario, i.e. this write is superseded. Note this is CLAIM order, not
-- commit order: a later turn that has not committed yet still supersedes,
-- deliberately — the user's later intent owns the scenario, and a write
-- computed from an older base is stale whether or not the newer one has
-- landed.
--
-- NOT A LOCK, and never described as one. The SELECT and the subsequent
-- append_turn_atomic are separate round trips, so a Stop that arrives
-- inside that window (~one RPC) is not seen by this evaluation. The
-- window is enumerated in turn-fence.ts and in the evidence file; it is
-- the honest residual, not a guarantee gap we are hiding.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.v5_evaluate_turn_fence(
  p_scenario_id UUID,
  p_turn_id     TEXT
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'claimed',        mine.generation IS NOT NULL,
    'stopped',        mine.stopped_at IS NOT NULL,
    'generation',     mine.generation,
    'max_generation', newest.max_generation
  )
  FROM (SELECT MAX(generation) AS max_generation
          FROM public.v5_turn_fence
         WHERE scenario_id = p_scenario_id) AS newest
  LEFT JOIN LATERAL (
    SELECT generation, stopped_at
      FROM public.v5_turn_fence
     WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id
  ) AS mine ON true;
$$;

-- ────────────────────────────────────────────────────────────────────
-- STOP — the server-visible explicit Stop.
--
-- UPSERTS. If the fence row is not there yet (the Stop beat the claim, or
-- the claim failed), a tombstoned row is inserted anyway; the later claim
-- hits ON CONFLICT and preserves `stopped_at`, so the turn is still
-- fenced. That is the whole reason the claim's DO UPDATE is a no-op.
--
-- `already_committed` is DERIVED from v5_conversation_turns rather than
-- tracked on the fence row (trap 12: no second copy of a fact that already
-- has an owner). It is what lets the UI say something TRUE about the past
-- instead of predicting the future: a turn whose row already exists was
-- already saved when the Stop arrived, and no tombstone can unsave it.
--
-- First-Stop-wins on the timestamp: a second Stop for the same turn does
-- not move `stopped_at`, so the recorded time is when the user actually
-- stopped.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.v5_mark_turn_stopped(
  p_scenario_id UUID,
  p_turn_id     TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_generation       BIGINT;
  v_stopped_at       TIMESTAMPTZ;
  v_already_claimed  BOOLEAN;
  v_already_committed BOOLEAN;
BEGIN
  SELECT TRUE INTO v_already_claimed
    FROM public.v5_turn_fence
   WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
  v_already_claimed := COALESCE(v_already_claimed, FALSE);

  INSERT INTO public.v5_turn_fence (scenario_id, turn_id, stopped_at)
  VALUES (p_scenario_id, p_turn_id, now())
  ON CONFLICT (scenario_id, turn_id) DO UPDATE
    SET stopped_at = COALESCE(public.v5_turn_fence.stopped_at, now())
  RETURNING generation, stopped_at INTO v_generation, v_stopped_at;

  SELECT EXISTS (
    SELECT 1 FROM public.v5_conversation_turns
     WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id
  ) INTO v_already_committed;

  RETURN jsonb_build_object(
    'stopped',           TRUE,
    'claimed',           v_already_claimed,
    'already_committed', v_already_committed,
    'generation',        v_generation,
    'stopped_at',        v_stopped_at
  );
END;
$$;

-- ── A4 security checklist (same posture as 20260710113000) ───────────
-- The fence table is service_role-only. Nothing in the browser or an
-- `authenticated` session ever reads it: the UI learns the outcome of its
-- own Stop from the route's response, never from a direct table read.
ALTER TABLE public.v5_turn_fence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v5_turn_fence FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.v5_turn_fence TO service_role;
REVOKE ALL ON SEQUENCE public.v5_turn_fence_generation_seq FROM PUBLIC, anon, authenticated;
GRANT  ALL ON SEQUENCE public.v5_turn_fence_generation_seq TO service_role;

-- Supabase default privileges auto-GRANT EXECUTE to anon + authenticated on
-- every new public function, so these revokes are load-bearing.
REVOKE EXECUTE ON FUNCTION public.v5_claim_turn_fence(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.v5_claim_turn_fence(UUID, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.v5_evaluate_turn_fence(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.v5_evaluate_turn_fence(UUID, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.v5_mark_turn_stopped(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.v5_mark_turn_stopped(UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.v5_claim_turn_fence(UUID, TEXT) IS
  'V5 turn fence: claim this turn''s start order for the scenario. Idempotent on (scenario_id, turn_id) and MUST NOT clear stopped_at. service_role only.';
COMMENT ON FUNCTION public.v5_evaluate_turn_fence(UUID, TEXT) IS
  'V5 turn fence: read {claimed, stopped, generation, max_generation} for a turn immediately before its graph commit. Not a lock — the read and the commit are separate round trips.';
COMMENT ON FUNCTION public.v5_mark_turn_stopped(UUID, TEXT) IS
  'V5 turn fence: record an explicit user Stop for a turn (upsert, first-Stop-wins), returning whether the turn had ALREADY committed. service_role only.';

COMMIT;
