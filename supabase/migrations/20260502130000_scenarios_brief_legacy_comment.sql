-- ============================================================
-- V5 Phase 1 brief persistence — operator clarity for scenarios.brief
-- Target: Staging Supabase
-- Date: 2026-05-02
--
-- Why:
--   With 20260502120000_v5_brief_text_persistence introducing
--   scenarios.brief_text as the canonical TEXT column for the
--   user-supplied free-text brief, an operator scanning `\d scenarios`
--   sees TWO `brief*` columns and may guess wrong about which one to
--   write to. brief_text already has a COMMENT documenting its role;
--   this migration adds the corresponding COMMENT on the legacy
--   scenarios.brief JSONB column to redirect future writers.
--
-- Scope:
--   This migration ONLY adds a COMMENT. It does NOT modify the
--   scenarios.brief column, its data, its constraints, or its grants.
--   The column itself is reserved for V4-era DecisionBriefV1 storage
--   and its existing semantics are unchanged.
--
-- Idempotency:
--   COMMENT ON COLUMN is unconditional — re-running the migration
--   replaces the previous comment text with the same string. No-op
--   on second apply.
-- ============================================================

COMMENT ON COLUMN scenarios.brief IS
  'JSONB DecisionBriefV1, V4 residual. Do not use for free-text brief storage — '
  'use scenarios.brief_text (added 20260502120000) instead. The brief_text '
  'column is the source of truth for the V5 decision_review enricher and is '
  'written by append_turn_atomic(p_brief_text) on the first draft turn. '
  'This column is preserved for future V5 structured-brief persistence; '
  'do NOT migrate the free-text shape into it.';
