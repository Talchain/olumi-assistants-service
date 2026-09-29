-- ============================================================================
-- COLLAB — EVIDENCE ATTACH (participants attach evidence to a position)
--
-- ── ADDITIVE ONLY. NO NEW TABLE, NO NEW GRANT, NO NEW POLICY. ─────────────
-- Evidence is a new KIND of elicitation event, not a new kind of record: it is
-- authored by a participant, about one target, inside one round, append-only,
-- and server-attributed — every property the existing table already enforces.
-- A separate `elicitation_evidence` table would have needed its own RLS, its
-- own REVOKE/GRANT ordering, its own owner denormalisation and its own
-- append-only grant posture, and would have had to be kept in step with this
-- one forever. Riding the existing table inherits all of that, correct by
-- construction, and the R-1 erasure routine keeps working with no change:
-- detaching a display name detaches it from the person's evidence too, because
-- there is only ever one participants table to redact against.
--
-- ⚠ NO `REVOKE`/`GRANT` STATEMENTS HERE, AND THAT IS DELIBERATE. The Supabase
-- default-ACL hazard documented at length in 20260809120000 applies to NEW
-- TABLES at CREATE time. `elicitation_events` already exists with its posture
-- REVOKEd and re-GRANTed narrowly; adding a column changes no privilege, and
-- re-issuing grants here would be a second authority on this table's posture
-- that could drift from the first.
--
-- Rollback: supabase/migrations/rollback/20260814120000_collab_evidence_rollback.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The evidence payload.
--    { kind, body, url, stance, about_participant_id }
--
--    NULL on every answer row and NOT NULL on every evidence row — asserted by
--    the CHECK in step 3 rather than left to application code, so a direct
--    service-role insert cannot create a half-row that the read model would
--    then have to defend against.
-- ----------------------------------------------------------------------------
ALTER TABLE public.elicitation_events
  ADD COLUMN IF NOT EXISTS evidence JSONB;

COMMENT ON COLUMN public.elicitation_events.evidence IS
  'Populated ONLY on evidence_attached rows: { kind: note|link, body, url, '
  'stance: supports|challenges|qualifies, about_participant_id }. `body` is the '
  'person''s own words, VERBATIM — the append seam refuses an over-long body '
  'rather than truncating, because a trimmed sentence stored under someone''s '
  'name is a falsified record. `url` is http/https ONLY, normalised through the '
  'URL parser at the append seam: this value is rendered as a clickable link on '
  'a surface reachable with a bearer token, so a javascript:/data: scheme would '
  'be stored XSS wearing a colleague''s name. There is deliberately NO weight, '
  'strength, score or rank member — evidence is read by people, and a numeric '
  'strength is the first step towards a combined answer.';

-- ----------------------------------------------------------------------------
-- 2. Widen the kind vocabulary.
--
--    ⚠ `evidence_attached` is added to a CHECK that also still admits
--    `clarification_requested`, which the append seam refuses. The DB
--    vocabulary is deliberately the WIDER of the two: the application is the
--    narrower gate and is where an unsurfaced kind gets refused loudly. Keeping
--    the constraint in step with the type union (not with the accepted set) is
--    what lets a kind be minted and refused rather than minted and dark.
-- ----------------------------------------------------------------------------
ALTER TABLE public.elicitation_events
  DROP CONSTRAINT IF EXISTS elicitation_events_kind_check;

ALTER TABLE public.elicitation_events
  ADD CONSTRAINT elicitation_events_kind_check
  CHECK (kind IN ('belief_submitted','belief_revised','declined','clarification_requested','evidence_attached'));

-- ----------------------------------------------------------------------------
-- 3. The two halves must agree.
--
--    An evidence row without evidence, or an answer row carrying evidence, is a
--    row whose `kind` lies about its own contents. The read model splits on
--    `kind` — the answer fold skips non-answers, the evidence projection selects
--    them — so a disagreeing row would be invisible to BOTH readers and would
--    look, from every screen, exactly like a contribution that never happened.
-- ----------------------------------------------------------------------------
ALTER TABLE public.elicitation_events
  DROP CONSTRAINT IF EXISTS elicitation_events_evidence_matches_kind;

ALTER TABLE public.elicitation_events
  ADD CONSTRAINT elicitation_events_evidence_matches_kind
  CHECK (
    (kind = 'evidence_attached' AND evidence IS NOT NULL)
    OR
    (kind <> 'evidence_attached' AND evidence IS NULL)
  );

-- ----------------------------------------------------------------------------
-- 4. The evidence read's index.
--
--    The disagreement view selects evidence rows for a round. PARTIAL, on the
--    kind, because evidence is the small minority of rows and the answer folds
--    must not pay for this index.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS elicitation_events_evidence_idx
  ON public.elicitation_events (round_id, created_at)
  WHERE kind = 'evidence_attached';
