-- Migration: Add is_active column and partial unique index
-- Version: 002
-- Description: Ensures only one active prompt per task_id at database level

-- Add is_active column (derived from status = 'production')
-- Default to true only if status is 'production', false otherwise
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false;

-- Backfill is_active from existing status
UPDATE prompts SET is_active = (status = 'production');

-- Add prompt_key column for semantic identification
-- This allows multiple prompt variants per task (e.g., draft_graph_v1, draft_graph_experimental)
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS prompt_key VARCHAR(128);

-- Backfill prompt_key from task_id for existing records
UPDATE prompts SET prompt_key = task_id WHERE prompt_key IS NULL;

-- Make prompt_key NOT NULL after backfill
ALTER TABLE prompts ALTER COLUMN prompt_key SET NOT NULL;

-- Create partial unique index: only one active prompt per task_id
-- This is a database-level constraint that prevents race conditions
CREATE UNIQUE INDEX IF NOT EXISTS one_active_per_task
  ON prompts (task_id)
  WHERE is_active = true;

-- Add unique constraint on (task_id, prompt_key) to prevent duplicate keys within a task
CREATE UNIQUE INDEX IF NOT EXISTS unique_task_prompt_key
  ON prompts (task_id, prompt_key);

-- Create trigger to keep is_active in sync with status
CREATE OR REPLACE FUNCTION sync_is_active_with_status()
RETURNS TRIGGER AS $$
BEGIN
  -- When status changes, update is_active accordingly
  NEW.is_active = (NEW.status = 'production');
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS sync_is_active_trigger ON prompts;
CREATE TRIGGER sync_is_active_trigger
  BEFORE INSERT OR UPDATE OF status ON prompts
  FOR EACH ROW
  EXECUTE FUNCTION sync_is_active_with_status();

-- Add index on is_active for fast lookups
CREATE INDEX IF NOT EXISTS idx_prompts_is_active ON prompts(is_active) WHERE is_active = true;

-- Comments for documentation
COMMENT ON COLUMN prompts.is_active IS 'True if this prompt is the active one for its task_id (derived from status=production)';
COMMENT ON COLUMN prompts.prompt_key IS 'Semantic key for the prompt variant (e.g., draft_graph, draft_graph_experimental)';
COMMENT ON INDEX one_active_per_task IS 'Ensures only one active prompt per task_id at database level';
