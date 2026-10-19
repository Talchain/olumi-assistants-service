-- PATH-B (19 Oct 2026; Paul via DL-3: the Conversation id's storage is ours to decide). The `core` lane keeps ONE durable
-- OpenAI Conversation per scenario (src/orchestrator-v5/agent-lane/core/sdk-turn.ts): created on the first `core` turn,
-- its id saved here and reused on reopen. No existing field fits: `framing` is rewritten whole by the UI
-- (DGAI scenarioService.ts `.update({ framing })`), `rolling_summary` is the monotonic four-slot summary, and the Agent
-- answer row refuses `coaching_state` (supabase-store.ts appendThroughRpcInner).
-- Additive: ONE nullable column with its own CHECK. No existing function, grant, constraint or policy changes, so every
-- existing reader and writer (production CEE and the UI included) resolves exactly as before.
-- Order-safe: the store reads and writes it only for a `core` turn, and treats 42703 / PGRST204 (column absent) as "cannot
-- hold it yet", keeping the id in process memory. Rollback: rollback/20261019150000_*.do-not-apply.
ALTER TABLE public.scenarios ADD COLUMN IF NOT EXISTS openai_conversation_id TEXT;
COMMENT ON COLUMN public.scenarios.openai_conversation_id IS
  'PATH-B core lane: the scenario''s one OpenAI Conversation id (conv_...). NULL = no core turn yet.';
-- NOT VALID: the column is new, so every existing row is NULL; this skips a validation scan under the ADD COLUMN lock on a
-- shared table, and still checks every write.
ALTER TABLE public.scenarios ADD CONSTRAINT scenarios_openai_conversation_id_shape CHECK (
  openai_conversation_id IS NULL OR openai_conversation_id ~ '^conv_[A-Za-z0-9_-]{1,200}$'
) NOT VALID;
