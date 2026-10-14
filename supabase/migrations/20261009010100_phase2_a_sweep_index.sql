-- NOT transactional; the DL applies this file alone, outside BEGIN/COMMIT.
-- no trigger, no write-blocking DDL; one concurrent index allowed (DL 87114 amendment).
-- SHARE UPDATE EXCLUSIVE never blocks writers (INSERT/UPDATE/DELETE).
-- Post-check: SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.analysis_run_facts_sweep_idx'::regclass
-- must be true; if invalid -> DROP INDEX CONCURRENTLY public.analysis_run_facts_sweep_idx; and retry this file.
SET lock_timeout = '3s';
CREATE INDEX CONCURRENTLY IF NOT EXISTS analysis_run_facts_sweep_idx ON public.v5_handler_facts (created_at, id) WHERE action_type = 'run_analysis' AND NOT noop;
