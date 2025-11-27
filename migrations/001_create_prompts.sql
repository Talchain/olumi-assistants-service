-- Migration: Create prompts tables
-- Version: 001
-- Description: Initial schema for prompt management

-- Create prompts table
CREATE TABLE IF NOT EXISTS prompts (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  task_id VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'staging', 'production', 'archived')),
  active_version INTEGER NOT NULL DEFAULT 1,
  staging_version INTEGER,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create prompt_versions table
CREATE TABLE IF NOT EXISTS prompt_versions (
  id SERIAL PRIMARY KEY,
  prompt_id VARCHAR(255) NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  variables JSONB DEFAULT '[]',
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_note TEXT,
  content_hash VARCHAR(64) NOT NULL,

  UNIQUE(prompt_id, version)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_prompts_task_id ON prompts(task_id);
CREATE INDEX IF NOT EXISTS idx_prompts_status ON prompts(status);
CREATE INDEX IF NOT EXISTS idx_prompts_task_status ON prompts(task_id, status);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_id ON prompt_versions(prompt_id);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_prompts_updated_at ON prompts;
CREATE TRIGGER update_prompts_updated_at
  BEFORE UPDATE ON prompts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE prompts IS 'Prompt definitions with metadata and versioning';
COMMENT ON TABLE prompt_versions IS 'Version history for each prompt';
COMMENT ON COLUMN prompts.task_id IS 'CEE task identifier (e.g., draft_graph, clarify_brief)';
COMMENT ON COLUMN prompts.status IS 'Lifecycle status: draft, staging, production, archived';
COMMENT ON COLUMN prompt_versions.content_hash IS 'SHA-256 hash of content for integrity checking';
