-- cee_m2_artifacts: bodies of the V6 dual-draft M2 defer artifacts
-- (evidence gaps, uncertainty flags, clarification proposals, deferred
-- options), which the MVP currently counts in telemetry and discards.
--
-- ============================= INERT / UNAPPLIED =============================
-- This file is committed on the quarantined claude/v6-dual-model-production-
-- system branch and has NOT been applied to any database. Applying it is an
-- ops/activation step requiring its own approval — nothing in the service
-- references the table unless the (equally unwired) SupabaseArtifactStore is
-- explicitly constructed by a future wiring lane.
-- =============================================================================
--
-- Bounds are structural, matching src/cee/dual-model/artifacts/types.ts
-- (parity-tested by src/cee/dual-model/__tests__/artifact-migration-parity.test.ts):
--   - artifact_index < 8 (= dual-draft PROPOSAL_CAP) + the composite unique
--     index bound rows per turn at 8 and make re-appends idempotent;
--   - per-field CHECK caps mirror ARTIFACT_FIELD_CAPS;
--   - status has NO 'rejected' value: rejected proposals become
--     MergeFailures whose bodies are discarded before artifact creation.

CREATE TABLE IF NOT EXISTS cee_m2_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  -- Opaque 16-hex topology hash supplied by the dispatch layer; nullable
  -- because a hash may be underivable for a degenerate graph.
  graph_hash TEXT,
  artifact_index SMALLINT NOT NULL CHECK (artifact_index >= 0 AND artifact_index < 8),
  proposal_type TEXT NOT NULL CHECK (proposal_type IN
    ('added_evidence_gap', 'uncertainty_flag', 'clarification_proposal', 'added_option')),
  question TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 500),
  rationale TEXT CHECK (rationale IS NULL OR char_length(rationale) <= 500),
  evidence_pointer TEXT NOT NULL CHECK (char_length(evidence_pointer) BETWEEN 1 AND 300),
  status TEXT NOT NULL DEFAULT 'deferred' CHECK (status IN
    ('deferred', 'surfaced', 'dismissed', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent re-append: one row per (scenario, turn, merge position).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cee_m2_artifacts_turn_artifact
  ON cee_m2_artifacts (scenario_id, turn_id, artifact_index);

-- Read path: newest-first per scenario.
CREATE INDEX IF NOT EXISTS idx_cee_m2_artifacts_scenario_created
  ON cee_m2_artifacts (scenario_id, created_at DESC);

COMMENT ON TABLE cee_m2_artifacts IS
  'V6 dual-draft M2 defer-artifact bodies. Non-user-facing session data; surfacing requires the separately-authorised harness/coaching lane (dual-draft amendment #3).';
