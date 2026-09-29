-- Ensure UUID generation is available (pick ONE approach)
-- Option A: pgcrypto
-- create extension if not exists pgcrypto;

-- Option B: uuid-ossp
-- create extension if not exists "uuid-ossp";

CREATE TABLE IF NOT EXISTS cee_draft_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  brief_hash TEXT NOT NULL,
  brief_preview TEXT,
  brief TEXT,

  raw_llm_output JSONB,
  raw_llm_text TEXT,

  validation_error TEXT NOT NULL,
  status_code INTEGER,
  missing_kinds TEXT[],
  node_kinds_raw_json TEXT[],
  node_kinds_post_normalisation TEXT[],
  node_kinds_pre_validation TEXT[],

  prompt_version TEXT,
  prompt_hash TEXT,
  model TEXT,
  temperature DOUBLE PRECISION,
  token_usage JSONB,
  finish_reason TEXT,

  llm_duration_ms INTEGER,
  total_duration_ms INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cee_draft_failures_request_id
  ON cee_draft_failures(request_id);

CREATE INDEX IF NOT EXISTS idx_cee_draft_failures_created_at
  ON cee_draft_failures(created_at);
