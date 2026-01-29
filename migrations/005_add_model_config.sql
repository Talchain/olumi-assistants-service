-- Migration: Add model_config column to cee_prompts table
-- Description: Allows per-prompt model configuration with environment-specific settings
-- Date: 2026-01-29

-- Add design_version column if not exists (from migration 004)
ALTER TABLE cee_prompts ADD COLUMN IF NOT EXISTS design_version VARCHAR(32);

-- Add model_config column to cee_prompts table
-- Stores environment-specific model IDs as JSONB:
-- {"staging": "gpt-4o-mini", "production": "gpt-4o"}
ALTER TABLE cee_prompts ADD COLUMN IF NOT EXISTS model_config JSONB DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN cee_prompts.model_config IS 'Environment-specific model configuration: {"staging": "model-id", "production": "model-id"}';
