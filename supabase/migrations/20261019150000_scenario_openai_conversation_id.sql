-- PATH-B (19 Oct 2026; storage ruled the DL's call by Paul). Target: the shared Supabase project etmmuzwxtcjipwphdola.
-- The `core` lane (src/orchestrator-v5/agent-lane/core/sdk-turn.ts) keeps its state in two places on the scenario:
--   1. openai_conversation_id: the scenario's ONE OpenAI Conversation (conv_...), created on the first `core` turn, saved
--      here by one conditional write (only while NULL) before the turn uses it, and reused on every later turn and reopen.
--   2. openai_paused_run: the one SDK run paused for the person's approval: {pause_id, proposal_id, call_id, tool, state},
--      where `state` is the SDK's RunState.toString(). The press that resumes it clears it by one conditional write keyed on
--      pause_id, so a duplicate press finds nothing to resume and applies nothing twice.
-- No existing field fits: `framing` is rewritten whole by the UI (DGAI scenarioService.ts `.update({ framing })`),
-- `rolling_summary` is the monotonic four-slot summary, and the Agent answer row refuses `coaching_state`
-- (supabase-store.ts appendThroughRpcInner).
-- Strict: there is NO in-process fallback. Until this migration is applied, a `core` turn stops before any model call with
-- 503 CORE_STATE_UNAVAILABLE (the store reads 42703 / PGRST204 as "cannot hold it"). Other lanes never read either column.
-- Additive: two nullable columns, each with its own CHECK. No existing function, grant, constraint or policy changes, so
-- every existing reader and writer (production CEE and the UI included) resolves exactly as before.
-- Rollback: rollback/20261019150000_scenario_openai_conversation_id_rollback.sql.do-not-apply (drops exactly these).
ALTER TABLE public.scenarios ADD COLUMN IF NOT EXISTS openai_conversation_id TEXT;
ALTER TABLE public.scenarios ADD COLUMN IF NOT EXISTS openai_paused_run JSONB;
COMMENT ON COLUMN public.scenarios.openai_conversation_id IS
  'PATH-B core lane: the scenario''s one OpenAI Conversation id (conv_...). NULL = no core turn yet.';
COMMENT ON COLUMN public.scenarios.openai_paused_run IS
  'PATH-B core lane: the SDK run paused for the person''s approval ({pause_id, proposal_id, call_id, tool, state}). NULL = none.';
-- NOT VALID: both columns are new, so every existing row is NULL; this skips a validation scan under the ADD COLUMN lock on
-- a shared table, and still checks every write.
ALTER TABLE public.scenarios ADD CONSTRAINT scenarios_openai_conversation_id_shape CHECK (
  openai_conversation_id IS NULL OR openai_conversation_id ~ '^conv_[A-Za-z0-9_-]{1,200}$'
) NOT VALID;
ALTER TABLE public.scenarios ADD CONSTRAINT scenarios_openai_paused_run_shape CHECK (
  openai_paused_run IS NULL OR (
    jsonb_typeof(openai_paused_run) = 'object'
    AND jsonb_typeof(openai_paused_run -> 'pause_id') = 'string'
    AND jsonb_typeof(openai_paused_run -> 'state') = 'string'
  )
) NOT VALID;
