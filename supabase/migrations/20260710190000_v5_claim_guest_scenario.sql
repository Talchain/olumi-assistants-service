-- ============================================================
-- Guest-claim v1 — `claim_guest_scenario` RPC (login 3.4, guest-data §4a)
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
--   yet executed, so it is amended in place rather than superseded):
--   - 2026-07-10 (claim-race-hardening lane): single-read micro-fix.
--     events/event_seq are folded into the FOR UPDATE row-lock SELECT
--     and the second, redundant scenarios read before the journey-event
--     append is dropped. No behaviour change: the row lock is held to
--     commit and the only intervening write (the claim UPDATE) touches
--     neither column. Companion migration (same execution batch)
--     20260711000000_v5_append_turn_atomic_for_share.sql closes the
--     append-side strand race at its source; the replay branch below
--     stays as belt-and-braces.
--
-- RULING IMPLEMENTED (Paul, 2026-07-10 eve): guest-data option (a) —
-- claim-on-first-login (PLATFORM-LOGIN-AUDIT-2026-07-10.md §4a). After a
-- user's FIRST verified sign-in, the server-side guest rows belonging to
-- their browser session are claimed by stamping user_id. The localStorage
-- half of the claim (importing local canvas state) is the UI's, per
-- LOGIN-UI-HALF-SPEC-2026-07-10.md — this migration is the server half.
--
-- CALLER CONTRACT (binding, security-load-bearing):
--   p_user_id MUST be a VERIFIED identity — the `sub` claim of a Supabase
--   access token verified by CEE's flag-gated JWT half
--   (src/utils/supabase-user-jwt.ts, CEE_REQUIRE_USER_JWT, PR #409).
--   NEVER the client-supplied x-user-id header: the whole point of login
--   3.4 is that identity stops being trusted input, and a claim RPC fed a
--   client-asserted id would let any allowed-origin browser adopt any
--   guest scenario as any user. p_scenario_id IS client-supplied (the ids
--   the browser's guest session holds in localStorage) — that is safe
--   precisely because claiming is restricted to rows that are still
--   unowned (user_id IS NULL): the worst a fabricated scenario id can do
--   is claim an ORPHAN row nobody owns, never touch an owned one.
--
-- WHAT A CLAIM TOUCHES (complete surface, verified against every
-- migration in this directory at staging tip 77784c8ed):
--   1. `scenarios.user_id`             — NULL → p_user_id (the claim).
--   2. `v5_conversation_turns.user_id` — denormalised copy of
--      scenarios.user_id ("for RLS without join", 20260417160000).
--      Stamped scenario-scoped WHERE user_id IS NULL, else the claimed
--      scenario's history stays invisible to its new owner's RLS reads.
--   3. `v5_handler_facts.user_id`      — same denormalisation, same fix.
--   Nothing else holds guest rows BY DESIGN:
--   - model_versions.owner_user_id / decision_records.owner_user_id are
--     NOT NULL — guest scenarios are refused at write time (MV001/DR001),
--     so there are no unowned rows to claim.
--   - shared_briefs rows require `user_id = auth.uid()` at create time
--     (create_shared_brief) — a guest (auth.uid() IS NULL) can never have
--     created one.
--
-- OUT OF SCOPE (deliberate):
--   - Purge of never-claimed guest rows: separate decision, explicitly
--     scheduled for Paul per audit §4 ("schedule a purge decision").
--     Claiming and purging have different blast radii; this file only
--     claims.
--   - Stopping NEW guest rows: that is the login flip itself (CEE half
--     refuses unauthenticated turns once CEE_REQUIRE_USER_JWT is on).
--   - Bulk claim-all-NULL-rows: intentionally ABSENT. A blanket claim
--     would hand the first user to sign in every orphaned guest row in
--     the database. Claims are per-scenario, driven by the ids the
--     claiming browser actually holds.
--
-- A4 checklist applied (same posture as 20260710113000_v5_decision_records):
--   - SECURITY DEFINER + pinned search_path.
--   - EXPLICIT `REVOKE ... FROM PUBLIC, anon, authenticated` + `GRANT ...
--     TO service_role`. Supabase default privileges auto-GRANT EXECUTE to
--     anon/authenticated on every new public function, so the explicit
--     revokes are load-bearing, not belt-and-braces.
--   - DISTINCT function name, never an overload (the 20260426160532
--     PostgREST candidate-ambiguity lesson).
--   - No table DDL, no policy changes: owner-only RLS already does the
--     right thing for a claimed row (it simply starts matching the new
--     owner's auth.uid()).
--
-- Distinct SQLSTATEs raised here (app maps each to a typed result):
--   GC404 — scenario not found. Expected in normal operation: localStorage
--           can reference a scenario whose server row was never created
--           (pure-local guest work) or was since deleted. The UI treats
--           this as "nothing to claim server-side" and proceeds with the
--           local import path.
--   GC409 — scenario already owned by a DIFFERENT user. Not an error the
--           honest flow can hit (guest ids live in one browser's
--           localStorage); reaching it means a stale/foreign id — refuse,
--           never re-stamp. Same-user replays are NOT errors (idempotent
--           success, deduped).
--   22023 — malformed parameters (NULL ids, p_user_id not a real
--           auth.users row).
--
-- Idempotency: a retried claim (same scenario, same user) returns
-- {claimed:false, already_owned:true} and appends NO second journey
-- event (deterministic event_id, keyed on the scenario id — a scenario
-- can only ever be claimed once, since user_id never returns to NULL).
-- The replay branch DOES re-run the two denormalisation UPDATEs
-- (idempotent, claim-pinned): append_turn_atomic reads scenarios with a
-- plain SELECT (no lock), so a turn streaming while the original claim
-- committed can strand NULL-stamped turn/fact rows AFTER the claim's
-- UPDATEs — the replay converts that to self-healing-on-retry (review
-- fixup 1, 2026-07-10; FOR SHARE on the append read is closed by
-- 20260711000000_v5_append_turn_atomic_for_share.sql, same batch —
-- this replay branch remains as belt-and-braces).
--
-- Verification (run after the separately-approved execution):
--   SELECT proname FROM pg_proc WHERE proname = 'claim_guest_scenario';
--   SELECT has_function_privilege('authenticated',
--     'public.claim_guest_scenario(uuid, uuid, text)', 'EXECUTE'); -- false
--   SELECT has_function_privilege('anon',
--     'public.claim_guest_scenario(uuid, uuid, text)', 'EXECUTE'); -- false
--   SELECT has_function_privilege('service_role',
--     'public.claim_guest_scenario(uuid, uuid, text)', 'EXECUTE'); -- true
--   (Grant-layer verification is against the LIVE database pg_proc/proacl,
--    not this file.)
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_guest_scenario(
  p_scenario_id UUID,
  p_user_id     UUID,
  p_event_id    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_owner          UUID;
  v_turns_updated  INTEGER := 0;
  v_facts_updated  INTEGER := 0;
  v_event_id       TEXT;
  v_events         JSONB;
  v_new_seq        INTEGER;
  v_existing_event JSONB;
  v_event          JSONB;
BEGIN
  -- Parameter guards — value-level (the fixup-2 lesson from
  -- decision_records: a buggy service-role call must fail typed here,
  -- not half-apply).
  IF p_scenario_id IS NULL THEN
    RAISE EXCEPTION 'claim_guest_scenario: p_scenario_id is required'
      USING ERRCODE = '22023'; -- invalid_parameter_value
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'claim_guest_scenario: p_user_id is required'
      USING ERRCODE = '22023';
  END IF;
  -- scenarios.user_id lost its FK to auth.users in 20260422000000 (guest
  -- relaxation), so this EXISTS check is the ONLY thing preventing a
  -- buggy caller from stamping an id that can never authenticate —
  -- which would orphan the row *differently* (owned-by-nobody-real,
  -- unreachable via RLS forever, and no longer claimable).
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'claim_guest_scenario: p_user_id % is not a known auth user', p_user_id
      USING ERRCODE = '22023';
  END IF;

  -- Row lock: serialises concurrent claims of the same scenario (second
  -- claimer blocks, then sees the stamped owner and takes the replay or
  -- GC409 branch below). FOUND distinguishes "row absent" from "guest
  -- row with user_id IS NULL" (the 20260422000000 lesson). events /
  -- event_seq are read here too — single read, under the same lock —
  -- for the journey-event append: the lock is held to commit and the
  -- claim UPDATE below touches neither column, so the values stay
  -- authoritative (pre-execution amendment, see header CHANGELOG).
  SELECT user_id, events, event_seq + 1
    INTO v_owner, v_events, v_new_seq
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim_guest_scenario: scenario % not found', p_scenario_id
      USING ERRCODE = 'GC404';
  END IF;

  IF v_owner IS NOT NULL THEN
    IF v_owner = p_user_id THEN
      -- Idempotent replay: this user already owns the row (retry after a
      -- lost response, double-submit, second device). The journey event
      -- already exists — but the denormalisation UPDATEs MUST re-run:
      -- an append_turn_atomic reading scenarios with a plain SELECT (no
      -- lock) while the original claim committed can have appended
      -- NULL-stamped turn/fact rows AFTER the claim's UPDATEs ran —
      -- invisible to the new owner's RLS reads. Re-running the two
      -- idempotent, claim-pinned UPDATEs here (still under this claim's
      -- row lock) makes any retry a repair (review fixup 1, 2026-07-10).
      -- The race itself is closed at source by the same-batch companion
      -- 20260711000000_v5_append_turn_atomic_for_share.sql; this branch
      -- stays as belt-and-braces.
      UPDATE public.v5_conversation_turns
        SET user_id = p_user_id
        WHERE scenario_id = p_scenario_id AND user_id IS NULL;
      GET DIAGNOSTICS v_turns_updated = ROW_COUNT;

      UPDATE public.v5_handler_facts
        SET user_id = p_user_id
        WHERE scenario_id = p_scenario_id AND user_id IS NULL;
      GET DIAGNOSTICS v_facts_updated = ROW_COUNT;

      RETURN jsonb_build_object(
        'claimed',       false,
        'already_owned', true,
        'turns_updated', v_turns_updated,
        'facts_updated', v_facts_updated,
        'event_id',      NULL
      );
    END IF;
    RAISE EXCEPTION 'claim_guest_scenario: scenario % is already owned by a different user', p_scenario_id
      USING ERRCODE = 'GC409';
  END IF;

  -- The claim. All three surfaces in one transaction (this function body).
  UPDATE public.scenarios
    SET user_id    = p_user_id,
        updated_at = now()
    WHERE id = p_scenario_id;

  -- Denormalised copies: scenario-scoped, NULL-only. The `user_id IS NULL`
  -- predicate pins the statement to "claim", never "reassign". NOTE: this
  -- row lock alone does NOT close the append race — an append_turn_atomic
  -- reading scenarios with a plain SELECT (no FOR SHARE) could commit
  -- NULL-stamped turn/fact rows after these UPDATEs run. That race is
  -- closed at its source by the same-batch companion migration
  -- 20260711000000_v5_append_turn_atomic_for_share.sql (the append read
  -- becomes FOR SHARE and serialises against this FOR UPDATE); the
  -- same-user replay branch above re-runs both UPDATEs as belt-and-braces
  -- (per the 2026-07-10 review).
  UPDATE public.v5_conversation_turns
    SET user_id = p_user_id
    WHERE scenario_id = p_scenario_id AND user_id IS NULL;
  GET DIAGNOSTICS v_turns_updated = ROW_COUNT;

  UPDATE public.v5_handler_facts
    SET user_id = p_user_id
    WHERE scenario_id = p_scenario_id AND user_id IS NULL;
  GET DIAGNOSTICS v_facts_updated = ROW_COUNT;

  -- Journey event — same shape the existing Journey tab renders (the
  -- decision_records precedent). Deterministic default id: a scenario is
  -- claimable exactly once, so one event per scenario is the invariant.
  -- A caller-supplied p_event_id colliding with an existing event for a
  -- DIFFERENT claim target is a caller bug — 22023, never a silent skip
  -- that returns the colliding id as if it were this claim's.
  v_event_id := COALESCE(p_event_id, 'guest_claimed_' || p_scenario_id::text);
  SELECT e INTO v_existing_event
    FROM jsonb_array_elements(COALESCE(v_events, '[]'::jsonb)) AS e
    WHERE e->>'event_id' = v_event_id;
  IF FOUND AND (v_existing_event->'details'->>'claimed_user_id') IS DISTINCT FROM p_user_id::text THEN
    RAISE EXCEPTION 'claim_guest_scenario: p_event_id % collides with an existing journey event for a different claim', v_event_id
      USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND THEN
    v_event := jsonb_build_object(
      'event_id',   v_event_id,
      'event_type', 'guest_claimed',
      'seq',        v_new_seq,
      'timestamp',  to_jsonb(now()),
      'details',    jsonb_build_object(
                      'claimed_user_id', p_user_id,
                      'turns_updated',   v_turns_updated,
                      'facts_updated',   v_facts_updated
                    )
    );
    UPDATE public.scenarios
      SET events    = COALESCE(events, '[]'::jsonb) || jsonb_build_array(v_event),
          event_seq = v_new_seq
      WHERE id = p_scenario_id;
  ELSE
    v_event_id := NULL; -- pre-existing event (idempotent path): report no new append
  END IF;

  RETURN jsonb_build_object(
    'claimed',       true,
    'already_owned', false,
    'turns_updated', v_turns_updated,
    'facts_updated', v_facts_updated,
    'event_id',      v_event_id
  );
END;
$$;

-- Load-bearing revokes (Supabase default privileges would otherwise
-- GRANT EXECUTE to anon + authenticated on creation).
REVOKE EXECUTE ON FUNCTION public.claim_guest_scenario(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_guest_scenario(UUID, UUID, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.claim_guest_scenario(UUID, UUID, TEXT) IS
  'Login 3.4 guest-data §4a (claim-on-first-login, Paul-ratified 2026-07-10): stamp an unowned guest scenario (user_id IS NULL) and its denormalised v5_conversation_turns/v5_handler_facts copies with a VERIFIED user id, appending an idempotent guest_claimed journey event. p_user_id MUST be the sub of a verified Supabase JWT (CEE_REQUIRE_USER_JWT half), never client-supplied. SQLSTATEs: GC404 scenario absent, GC409 owned by another user, 22023 bad params. service_role only.';
