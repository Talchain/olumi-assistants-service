-- Migration: Add model_config column to prompts table
-- Description: Allows per-prompt model configuration with environment-specific settings
-- Date: 2026-01-29

-- Add model_config column to prompts table
-- Stores environment-specific model IDs as JSONB:
-- {"staging": "gpt-4o-mini", "production": "gpt-4o"}
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS model_config JSONB DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN prompts.model_config IS 'Environment-specific model configuration: {"staging": "model-id", "production": "model-id"}';
