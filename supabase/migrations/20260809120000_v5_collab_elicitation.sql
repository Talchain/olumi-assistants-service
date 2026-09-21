-- ============================================================================
-- COLLAB U-S0 — blind elicitation rounds (ROADMAP 2.686 / 2.909 / 2.910)
--
-- Two people contribute to one shared model WITHOUT seeing each other's answer,
-- then reveal — with each position attributed to the person who made it.
--
-- ── THE POSTURE, COPIED VERBATIM FROM 20260705120000_v5_model_versions.sql ──
--   • ENABLE + FORCE row level security on every table.
--   • Owner-only SELECT for `authenticated`, as a PLAIN EQUALITY against a
--     denormalised `owner_user_id` — no subquery, no membership function, and
--     deliberately NO reference to the legacy teams/invitations/
--     decision_collaborators machinery (N-SQL-5 asserts that absence).
--   • REVOKE ALL from PUBLIC, anon, authenticated — then GRANT SELECT back to
--     `authenticated` only. anon gets NOTHING, ever.
--   • NO INSERT/UPDATE/DELETE policy for ANY JWT role. Writes ride the CEE
--     service role.
--   • The two EVENT tables get SELECT+INSERT for service_role and NO UPDATE or
--     DELETE for anybody but the table owner — append-only (INV-C) enforced at
--     the grant layer, not merely in application code.
--
-- ⚠ DO NOT copy the posture of `v5_conversation_turns` / `v5_handler_facts`.
-- Those have RLS enabled but NOT FORCE, a SELECT policy targeting role `public`,
-- and anon holds table-level DML grants — contained today only because no
-- permissive write policy exists. That is a graded latent hazard; these tables
-- must not widen it.
--
-- ── PARTICIPANTS HOLD NO DATABASE IDENTITY AT ALL ─────────────────────────
-- There is no participant role, no participant grant, and no participant RLS
-- policy — because a participant has no `auth.users` row. Their ONLY read path
-- is the packet endpoint, served by the service role, whose response shape
-- withholds sibling contributions by construction. Blindness therefore fails
-- CLOSED: there is nothing for a policy bug to leak, because there is no policy.
--
-- ── R-1/R-2 ERASURE: SCHEMA-CAPABLE, OPERATION DEFERRED ───────────────────
-- `elicitation_participants.pseudonym` exists and the reveal read model already
-- resolves `pseudonym ?? display_name`, so the redaction OPERATION can land
-- later with no data migration and no read-path change. The SECURITY DEFINER
-- routine (`collab_redact_participant`) and its audit table are NOT created
-- here — the N-suite's N-SQL-7 block stays RED until they are, deliberately.
--
-- Rollback: supabase/migrations/rollback/20260809120000_v5_collab_elicitation_rollback.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Rounds. One row per blind round; `status` is a materialised read
--    optimisation and `round_events` is the truth.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.elicitation_rounds (
  round_id          UUID PRIMARY KEY,
  scenario_id       UUID NOT NULL REFERENCES public.scenarios(id) ON DELETE CASCADE,
  -- Denormalised from scenarios.user_id at write time (model_versions D3
  -- Branch A). Unowned durable rows are impossible by constraint, and the RLS
  -- predicate stays a plain equality.
  owner_user_id     UUID NOT NULL,
  -- ROADMAP 2.910: the EXPLICIT model version this round asked about. NOT NULL
  -- — a round that pinned nothing could not honestly say, weeks later, what the
  -- panel was looking at.
  graph_version_ref UUID NOT NULL REFERENCES public.model_versions(id),
  target_manifest   JSONB NOT NULL,
  context_note      TEXT,
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('draft','open','closed','adjudicating','recorded')),
  created_by        UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.elicitation_rounds IS
  'COLLAB U-S0: a blind elicitation round over an immutable model version. '
  'Written EXCLUSIVELY by the CEE service role. status is a read optimisation; '
  'round_events are the truth.';
COMMENT ON COLUMN public.elicitation_rounds.graph_version_ref IS
  'ROADMAP 2.910: pinned from an EXPLICIT create_model_version call at mint. '
  'NEVER scenarios.current_model_version_id, which is nullable and frozen in '
  'practice — a round pinned to it would pin nothing.';

CREATE INDEX IF NOT EXISTS elicitation_rounds_scenario_idx
  ON public.elicitation_rounds (scenario_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 2. Round lifecycle events — append-only.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.round_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  round_id      UUID NOT NULL REFERENCES public.elicitation_rounds(round_id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  transition    TEXT NOT NULL
                  CHECK (transition IN ('draft','open','closed','adjudicating','recorded')),
  actor         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS round_events_round_idx
  ON public.round_events (round_id, created_at);

-- ----------------------------------------------------------------------------
-- 3. Participants. `token_hash` is a SHA-256 digest — the raw token is never
--    stored, never logged, and has no read-back path anywhere in the system.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.elicitation_participants (
  participant_id   UUID PRIMARY KEY,
  scenario_id      UUID NOT NULL REFERENCES public.scenarios(id) ON DELETE CASCADE,
  round_id         UUID NOT NULL REFERENCES public.elicitation_rounds(round_id) ON DELETE CASCADE,
  owner_user_id    UUID NOT NULL,
  display_name     TEXT NOT NULL,
  -- NULLABLE BY DESIGN. A PoC participant holds no Supabase account; this column
  -- is what lets one bind to a real account later with NO migration, when the
  -- dormant JWT hardening is switched on. Do not make it NOT NULL.
  supabase_user_id UUID,
  token_hash       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('invited','active','revoked')),
  -- R-1 pseudonymise-on-erasure. NULL until redacted; the reveal read model
  -- already resolves `pseudonym ?? display_name`, so lighting the operation
  -- later changes no read path.
  pseudonym        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Round-scoped uniqueness: a token resolves on exactly one round.
  UNIQUE (round_id, token_hash)
);

COMMENT ON COLUMN public.elicitation_participants.token_hash IS
  'SHA-256 hex of the participant bearer token. The raw token is returned ONCE '
  'to the minting owner and is unrecoverable thereafter. A token is a BEARER '
  'capability: under the PoC auth posture a forwarded link means a forged '
  'answer. Blindness does not depend on it; attribution does.';

CREATE INDEX IF NOT EXISTS elicitation_participants_round_idx
  ON public.elicitation_participants (round_id);

-- ----------------------------------------------------------------------------
-- 4. Participant lifecycle events — append-only. Revocation is an APPENDED
--    event, never a row delete: contributions stay attributed and the reveal
--    stays honest about who was in the room.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.elicitation_participant_events (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  participant_id UUID NOT NULL REFERENCES public.elicitation_participants(participant_id) ON DELETE CASCADE,
  status         TEXT NOT NULL CHECK (status IN ('invited','active','revoked')),
  actor          TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS elicitation_participant_events_idx
  ON public.elicitation_participant_events (participant_id, created_at);

-- ----------------------------------------------------------------------------
-- 5. Elicitation events — THE CONTRIBUTION RECORD. Append-only: a revision
--    APPENDS a new row and the reveal folds latest-per-(participant,target).
--    The (original, revision) pair IS the "what changed my mind" record.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.elicitation_events (
  event_id       UUID PRIMARY KEY,
  round_id       UUID NOT NULL REFERENCES public.elicitation_rounds(round_id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES public.elicitation_participants(participant_id) ON DELETE CASCADE,
  owner_user_id  UUID NOT NULL,
  event_version  INTEGER NOT NULL,
  kind           TEXT NOT NULL
                   CHECK (kind IN ('belief_submitted','belief_revised','declined','clarification_requested')),
  target         JSONB NOT NULL,
  -- { value, expression_raw, confidence }. `expression_raw` is the person's own
  -- words, VERBATIM — never normalised, never re-derived from the number.
  -- `elicited_range` is Neil-gated and deliberately absent: the published
  -- schema is .strict() and would refuse it.
  belief         JSONB,
  -- { authored_by, method, elicitation_version }. SERVER-STAMPED.
  provenance     JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.elicitation_events.provenance IS
  'authored_by is the TOKEN-RESOLVED participant, stamped server-side — never '
  'the scenario owner, and never a value the wire supplied. This is the direct '
  'pin on the append_turn_atomic_v4 defect class, where the RPC takes no acting-'
  'user parameter and stamps the owner on every write.';

CREATE INDEX IF NOT EXISTS elicitation_events_round_idx
  ON public.elicitation_events (round_id, created_at);
-- The blind read's index: scoped to one participant, in the query itself.
CREATE INDEX IF NOT EXISTS elicitation_events_own_idx
  ON public.elicitation_events (round_id, participant_id, created_at);

-- ============================================================================
-- 6. RLS + GRANTS — owner-only SELECT, no JWT write path, anon nothing.
-- ============================================================================

ALTER TABLE public.elicitation_rounds             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elicitation_rounds             FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.round_events                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_events                   FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.elicitation_participants       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elicitation_participants       FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.elicitation_participant_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elicitation_participant_events FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.elicitation_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elicitation_events             FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_own_elicitation_rounds ON public.elicitation_rounds;
CREATE POLICY select_own_elicitation_rounds ON public.elicitation_rounds
  FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS select_own_round_events ON public.round_events;
CREATE POLICY select_own_round_events ON public.round_events
  FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS select_own_elicitation_participants ON public.elicitation_participants;
CREATE POLICY select_own_elicitation_participants ON public.elicitation_participants
  FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS select_own_elicitation_events ON public.elicitation_events;
CREATE POLICY select_own_elicitation_events ON public.elicitation_events
  FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);

-- elicitation_participant_events has no owner column of its own; it is reachable
-- only through the service role. No authenticated SELECT policy = no rows for
-- any JWT caller, which is the fail-closed default we want.

-- ⚠⚠ `service_role` IS IN THIS LIST DELIBERATELY, AND ITS ABSENCE WAS A REAL
-- DEFECT CAUGHT ON THE STAGING PREFLIGHT. Supabase ships DEFAULT ACLs
-- (`pg_default_acl`, grantor postgres AND supabase_admin) that grant `arwdDxt`
-- — INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER — on EVERY
-- new table in `public` to anon, authenticated AND service_role, at CREATE
-- time. Measured on staging: anon already holds UPDATE on 49 public tables,
-- authenticated on 53, service_role on 61.
--
-- So a new table is born writable by all three, and GRANTing narrowly does NOT
-- remove an inherited default — only REVOKE does. `REVOKE ALL` then `GRANT`
-- the narrow set is the ONLY reliable order.
--
-- Reproduced in rehearsal on postgres 15.8 with the same default ACLs: without
-- service_role here, N-SQL-3 fails with
--   "service_role has UPDATE on append-only table round_events"
-- and it is RIGHT to fail — the append-only guarantee would have been a comment
-- rather than a grant.
REVOKE ALL ON public.elicitation_rounds             FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.round_events                   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.elicitation_participants       FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.elicitation_participant_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.elicitation_events             FROM PUBLIC, anon, authenticated, service_role;

-- Sequences inherit the same defaults. An append-only table whose sequence is
-- writable by anon is not append-only in any sense that matters.
REVOKE ALL ON SEQUENCE public.round_events_id_seq                   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.elicitation_participant_events_id_seq FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON public.elicitation_rounds       TO authenticated;
GRANT SELECT ON public.round_events             TO authenticated;
GRANT SELECT ON public.elicitation_participants TO authenticated;
GRANT SELECT ON public.elicitation_events       TO authenticated;

-- Service role. NOTE the asymmetry, it is deliberate and load-bearing:
--   • rounds/participants get UPDATE, because `status` and `pseudonym` are
--     materialised columns the service maintains;
--   • the two APPEND-ONLY EVENT tables get SELECT+INSERT ONLY — no UPDATE, no
--     DELETE, for anyone but the table owner. So a contribution, once made,
--     cannot be EDITED at all, and cannot be individually deleted by the
--     application. That is INV-C at the grant layer, and it holds even for
--     service_role, which carries BYPASSRLS — measured: BYPASSRLS defeats RLS,
--     not a missing GRANT.
--
--     ⚠ SCOPE OF THAT CLAIM, STATED HONESTLY: it is NOT "these rows can never
--     be removed". `ON DELETE CASCADE` from `scenarios` is a delete path no
--     grant audit can see — PostgreSQL runs referential actions as internal
--     triggers under the referencing table's owner, so neither the absent
--     DELETE grant nor FORCE RLS blocks a cascade. Deleting a scenario still
--     removes its rounds and their events.
--
--     That is deliberate (a deleted scenario should not leave orphaned panel
--     data) and it does NOT weaken what this feature depends on: there is no
--     UPDATE path at all, so an attribution cannot be forged, re-pointed or
--     silently edited. Destroying a whole parent is a different operation from
--     rewriting a contribution.
GRANT SELECT, INSERT, UPDATE ON public.elicitation_rounds       TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.elicitation_participants TO service_role;
GRANT SELECT, INSERT         ON public.round_events             TO service_role;
GRANT SELECT, INSERT         ON public.elicitation_events       TO service_role;
GRANT SELECT, INSERT         ON public.elicitation_participant_events TO service_role;

GRANT USAGE, SELECT ON SEQUENCE public.round_events_id_seq                   TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.elicitation_participant_events_id_seq TO service_role;

-- ============================================================================
-- 7. R-1/R-2 REDACTION — the single sanctioned exception to append-only.
--
-- ⚠ THE SHAPE IS BUILT HERE; THE OWNER-FACING OPERATION IS NOT SURFACED in
-- this slice. Erasure is a real obligation with a real workflow (who may ask,
-- who verifies, what the person is told) and that workflow is not part of
-- "two people contribute privately and reveal". Until it exists, this routine
-- is invoked out of band by an operator.
--
-- WHY A SECURITY DEFINER ROUTINE AND NOT AN UPDATE FROM THE SERVICE:
-- narrowness, the audit row and idempotency become properties of the DATABASE,
-- in ONE transaction, rather than promises made by a client that could be
-- interrupted between two round trips — leaving a name detached with no audit
-- row, or an audit row for a redaction that did not happen.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.collab_redaction_audit (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  participant_id UUID NOT NULL,
  -- WHO asked and WHEN. Deliberately NO column carries the redacted
  -- display_name: an audit table holding every erased name would be a
  -- re-identification index built by the erasure feature itself.
  requested_by   TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Idempotency at the DB grain: a retried erasure cannot mint a second row.
  UNIQUE (participant_id)
);

COMMENT ON TABLE public.collab_redaction_audit IS
  'R-2 audit: THAT / WHO / WHEN a participant identity was detached. Never '
  'carries the redacted name — see the erasure design note in src/collab/redaction.ts.';

ALTER TABLE public.collab_redaction_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collab_redaction_audit FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.collab_redaction_audit FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.collab_redaction_audit_id_seq FROM PUBLIC, anon, authenticated, service_role;
-- No authenticated SELECT policy and no grant: the audit trail is operator-only.
GRANT SELECT, INSERT ON public.collab_redaction_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.collab_redaction_audit_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.collab_redact_participant(
  p_participant_id UUID,
  p_pseudonym      TEXT,
  p_requested_by   TEXT
) RETURNS TABLE (pseudonym TEXT, already_redacted BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing TEXT;
BEGIN
  IF p_pseudonym IS NULL OR btrim(p_pseudonym) = '' THEN
    RAISE EXCEPTION 'collab_redact_participant: a pseudonym is required'
      USING ERRCODE = '22023';
  END IF;

  -- Lock the row: two concurrent erasure requests must not mint two pseudonyms
  -- and fragment one person's history into several apparent people.
  SELECT ep.pseudonym INTO v_existing
  FROM public.elicitation_participants ep
  WHERE ep.participant_id = p_participant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'collab_redact_participant: no such participant'
      USING ERRCODE = 'CR404';
  END IF;

  -- IDEMPOTENT: already redacted → return the SAME pseudonym, write nothing.
  IF v_existing IS NOT NULL AND btrim(v_existing) <> '' THEN
    RETURN QUERY SELECT v_existing, TRUE;
    RETURN;
  END IF;

  -- NARROW: exactly one participant, exactly the identity columns. The belief
  -- rows are not touched — content is retained, only the name detaches.
  UPDATE public.elicitation_participants
  SET display_name     = p_pseudonym,
      pseudonym        = p_pseudonym,
      supabase_user_id = NULL
  WHERE participant_id = p_participant_id;

  INSERT INTO public.collab_redaction_audit (participant_id, requested_by)
  VALUES (p_participant_id, COALESCE(NULLIF(btrim(p_requested_by), ''), 'service'))
  ON CONFLICT (participant_id) DO NOTHING;

  RETURN QUERY SELECT p_pseudonym, FALSE;
END;
$$;

-- Supabase auto-grants EXECUTE on new public functions — this REVOKE is
-- load-bearing, not decorative (N-SQL-4 and N-SQL-7 both assert it).
REVOKE EXECUTE ON FUNCTION public.collab_redact_participant(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collab_redact_participant(UUID, TEXT, TEXT)
  TO service_role;
