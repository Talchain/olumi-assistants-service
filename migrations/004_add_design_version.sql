-- Migration: Add design_version column
-- Version: 004
-- Description: Adds explicit design version metadata for prompt generation tracking (e.g., "v22", "v8.2")

-- Add design_version column for explicit prompt design/generation version
-- This is separate from the revision count (activeVersion) and tracks the prompt design iteration
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS design_version VARCHAR(32);

-- Comment for documentation
COMMENT ON COLUMN prompts.design_version IS 'Prompt design version (e.g., v22, v8.2) - tracks prompt generation/iteration';
