-- ─────────────────────────────────────────────────────────────────────────────
-- COLLAB — WORKSPACE-SCOPED PERSON IDENTITY (PR4).
--
-- Additive ALTER on `elicitation_participants` only. No table is created, no
-- column is dropped, no constraint is tightened, and no existing row changes
-- meaning. The sibling precedent is `20260814120000_collab_evidence.sql`.
--
-- ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────
-- `participant_id` is minted `crypto.randomUUID()` per ROUND
-- (`src/collab/participant-tokens.ts:92`), and the only unique constraint on the
-- table is `(round_id, token_hash)` — round-scoped by construction. So the same
-- human invited to two rounds on one scenario is TWO unrelated rows with no
-- link between them, and nothing in the schema can express "these are the same
-- person". Attribution is therefore round-local: the reveal can say what Grace
-- said in THIS round and can never say that it was the same Grace who said
-- something different last month. That is the capability being added — teams
-- reason across rounds, and a position only becomes interrogable when you can
-- see whose it was, over time.
--
-- ── WHY A COLUMN AND NOT A `people` TABLE ────────────────────────────────────
-- The minimum that makes attribution durable. A person, here, is nothing more
-- than a stable id shared by that person's participant rows within one scenario;
-- their name already lives on the participant row and is already R-2 resolvable.
-- A second table would need its own name column, and two places holding one
-- person's name is the hand-maintained-mirror defect — with the redaction
-- routine below as the exact place it would go wrong. The workspace roster is
-- DERIVED by grouping this column within `scenario_id`, so there is one source
-- of truth for a name and nothing to keep in sync.
--
-- Enterprise SSO, tenancy and a real `workspaces` substrate are OUT OF SCOPE by
-- ruling. `workspace` here means the scenario, which is the unit the collab
-- tables are already scoped to.
--
-- ── ⚠ THE BACKFILL IS 1:1 AND MUST STAY 1:1 ──────────────────────────────────
-- Every existing participant row gets its OWN fresh person identity, equal to
-- its `participant_id`. It is deliberately NOT a merge.
--
-- The tempting migration — "group the existing rows by display_name within a
-- scenario, they are probably the same person" — is the exact inverse failure
-- this feature must not ship: it would SILENTLY REATTRIBUTE two different
-- people's contributions to one person, on nothing but a string match, with no
-- audit trail and no way for anyone to notice. Two colleagues both called
-- "Sam", or one owner who typed "Grace" for Grace Chen in March and Grace
-- Okafor in August, and the record now says one person held both positions.
-- Merging is a claim about the world that only the owner can make; the
-- migration cannot make it and does not try. Existing contributions keep
-- exactly the author they have.
--
-- The opposite-direction twin is equally required and is why this is an UPDATE
-- rather than a DEFAULT: no existing row may be left person-less, because a
-- null person on a historic row would read at the API grain as "this
-- contribution belongs to nobody".
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. The column. Nullable, deliberately and permanently.
--
--    ⚠ NOT `NOT NULL`. The application resolves `person_id ?? participant_id`
--    at every read, so a row that predates this migration — or a deploy that
--    reaches a database where it has not yet run — behaves exactly as it does
--    today: identity falls back to round-scoped, nothing breaks, and no
--    contribution loses its author. Making it NOT NULL would convert an
--    unapplied migration from a degraded capability into a total outage of a
--    journey-witnessed feature.
ALTER TABLE public.elicitation_participants
  ADD COLUMN IF NOT EXISTS person_id UUID;

COMMENT ON COLUMN public.elicitation_participants.person_id IS
  'Workspace(scenario)-scoped durable person identity. Shared by one person''s '
  'participant rows across rounds. NULL means round-scoped (pre-migration or '
  'pre-backfill); readers resolve person_id ?? participant_id. Never inferred '
  'from display_name — only the owner may assert that two rows are one person.';

-- 2. The 1:1 backfill. Identity-preserving by construction: `participant_id` is
--    already unique (it is the PK), so this cannot collapse two rows onto one
--    person even if it were run twice.
--
--    Idempotent via the WHERE clause — a re-run touches nothing, and in
--    particular cannot overwrite a person link the owner has since asserted.
UPDATE public.elicitation_participants
SET person_id = participant_id
WHERE person_id IS NULL;

-- 3. The lookup the workspace roster needs: "who has been on a panel in this
--    scenario". `scenario_id` was previously written but never read and carried
--    no index at all; this is the query that gives it a job.
CREATE INDEX IF NOT EXISTS elicitation_participants_scenario_person_idx
  ON public.elicitation_participants (scenario_id, person_id);

-- 4. ⚠ REDACTION MUST DETACH THE PERSON LINK, AND THIS IS A NEW OBLIGATION
--    CREATED BY THE COLUMN ABOVE.
--
--    R-1 pseudonymisation detaches the NAME and retains the CONTENT. A durable
--    cross-round person id defeats that on its own: pseudonymise Grace in
--    round 1 and her `person_id` still joins to her NAMED row in round 2, so
--    the pseudonym is reversible by anyone who can read both. The erasure
--    feature would have built the re-identification index itself — precisely
--    the failure the original migration's audit-table comment warns about.
--
--    So `person_id` is nulled alongside `supabase_user_id`, by the same routine,
--    in the same statement. The consequence is intended and correct: an erased
--    person stops having durable cross-round identity. Their contributions
--    remain, attributed to a pseudonym, in the round they were made.
--
--    CREATE OR REPLACE preserves the existing grants; the REVOKE/GRANT pair from
--    the original migration still applies to this signature. Re-stated at the
--    foot of this file anyway, because relying on a previous migration's grants
--    surviving a replace is an assumption, not a guarantee.
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

  SELECT ep.pseudonym INTO v_existing
  FROM public.elicitation_participants ep
  WHERE ep.participant_id = p_participant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'collab_redact_participant: no such participant'
      USING ERRCODE = 'CR404';
  END IF;

  IF v_existing IS NOT NULL AND btrim(v_existing) <> '' THEN
    RETURN QUERY SELECT v_existing, TRUE;
    RETURN;
  END IF;

  UPDATE public.elicitation_participants
  SET display_name     = p_pseudonym,
      pseudonym        = p_pseudonym,
      supabase_user_id = NULL,
      -- NEW: see the note above. Without this line the column added by this
      -- migration would make R-1 pseudonymisation reversible.
      person_id        = NULL
  WHERE participant_id = p_participant_id;

  INSERT INTO public.collab_redaction_audit (participant_id, requested_by)
  VALUES (p_participant_id, COALESCE(NULLIF(btrim(p_requested_by), ''), 'service'))
  ON CONFLICT (participant_id) DO NOTHING;

  RETURN QUERY SELECT p_pseudonym, FALSE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.collab_redact_participant(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collab_redact_participant(UUID, TEXT, TEXT)
  TO service_role;

-- 5. No grant change for the column itself: `elicitation_participants` grants
--    are unchanged by this migration, and `person_id` inherits the table's
--    existing service-role-only posture. It is deliberately NOT exposed to the
--    `authenticated` role — the workspace roster is served by CEE, which
--    applies the owner check, not by PostgREST.
