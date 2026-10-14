-- ============================================================================
-- CEE — the drafter's RAW answer for every served draft (bench construction replay)
--
-- ⚠ DL APPLIES THIS. Authored, NOT applied by its PR. The CEE code that writes
-- here is a no-op until it exists: every insert fails "relation not found"
-- (PGRST205 / 42P01), is logged, and is skipped — so merging the code before
-- this file is applied changes nothing for any user.
--
-- WHY: the replay bench re-runs every served draft with 0 LLM calls, but only
-- AFTER the drafter. The drafter's raw output was stored for 0 of 77 served
-- drafts, so construction (`buildModelFromBrief`) could only be measured on a
-- 9-draw proxy. One row per served draft keeps the exact text each drafter call
-- returned (the string construction parses), with the call's prompt / schema
-- identity, the model id and the CEE build.
--
-- ⛔ WHY A NEW TABLE, NOT A ROW OR KEY ON AN EXISTING ONE (the DB is shared by
--   staging, production, cee-demo and native-trial, several on OLDER code):
--   · `v5_handler_facts` / `v5_conversation_turns` are WINDOWED by every pin
--     (`readRecent` limit 20 → `prior_facts`; run-analysis / mutation-receipt /
--     guidance / pending-action / coaching readers). A new row type there is
--     counted by an older service's window and pushes its real facts out.
--   · `scenarios` JSONB columns are read by the UI and every CEE pin on every
--     load; 200 KB more per row would ride every read.
--   · `cee_draft_failures` is failure-only (`validation_error NOT NULL`), its
--     admin list is itself a 20-row window, and it lives in the legacy
--     hand-run estate (`migrations/003_…`), so its presence is unproven.
--   · `model_versions` has no free JSONB column besides the graph snapshot.
--   This table is read by NOTHING at any pin: no window can count its rows.
--
-- WHAT A ROW HOLDS (never the brief — it is already persisted as
-- `scenarios.brief_text` by the registration — only its sha256 and length;
-- never the call input, the API key, request headers, the user id, or a
-- provider error message):
--   · scenario_id + operation_id (`constructionOperationId`, the id the
--     registration and its model version carry) + request_id + model_version_id;
--   · outcome: registered | replayed | refused | threw (+ refusal code);
--   · cee_build (full commit), environment, render_service — which of the four
--     services wrote it;
--   · calls: JSONB array, in call order, ≤ 4 (today: first + at most one
--     retry). Each: role, model, prompt_alias, prompt_sha256, schema_sha256,
--     reasoning_effort, max_output_tokens, input_sha256, status,
--     incomplete_reason, usage, threw, raw_text, raw_bytes, raw_truncated.
--     raw_text is capped by CEE at 200 KiB of UTF-8 and, when cut, ends with
--     `[[olumi:drafter_raw_truncated original_bytes=N kept_bytes=M]]`.
--
-- POSTURE: service-role only. RLS enabled + forced, NO policies, every grant
-- revoked from PUBLIC / anon / authenticated (Supabase default privileges
-- auto-grant on CREATE TABLE, so the REVOKE is load-bearing). No RPC, no
-- trigger, no change to any existing table, function or grant.
--
-- Rollback: supabase/migrations/rollback/20261006114000_cee_drafter_raw_responses_rollback.sql.do-not-apply
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cee_drafter_raw_responses (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  record_version     INTEGER NOT NULL DEFAULT 1,
  scenario_id        UUID NOT NULL REFERENCES public.scenarios(id) ON DELETE CASCADE,
  operation_id       UUID NOT NULL,
  request_id         TEXT NOT NULL,
  model_version_id   UUID NULL,
  outcome            TEXT NOT NULL
    CHECK (outcome IN ('registered', 'replayed', 'refused', 'threw')),
  refusal            TEXT NULL,
  brief_sha256       TEXT NOT NULL CHECK (brief_sha256 ~ '^[0-9a-f]{64}$'),
  brief_chars        INTEGER NOT NULL CHECK (brief_chars >= 0),
  cee_build          TEXT NOT NULL,
  environment        TEXT NOT NULL,
  environment_source TEXT NOT NULL,
  render_service     TEXT NULL,
  calls              JSONB NOT NULL
    CHECK (jsonb_typeof(calls) = 'array'
           AND jsonb_array_length(calls) BETWEEN 1 AND 4
           AND octet_length(calls::text) <= 2097152)
);

COMMENT ON TABLE public.cee_drafter_raw_responses IS
  'One row per served agent-lane draft that called the drafter: the raw text '
  'each drafter call returned (capped 200 KiB, marker on cut) with its prompt/'
  'schema sha256, model id and CEE build, for the 0-LLM construction replay '
  'bench. Written fire-and-forget by CEE (service role); read by no window at '
  'any pin. Never holds the brief (brief_sha256 only), the call input, keys, '
  'headers or the user id.';

CREATE INDEX IF NOT EXISTS cee_drafter_raw_responses_scenario_created_idx
  ON public.cee_drafter_raw_responses (scenario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cee_drafter_raw_responses_build_created_idx
  ON public.cee_drafter_raw_responses (cee_build, created_at DESC);
CREATE INDEX IF NOT EXISTS cee_drafter_raw_responses_operation_idx
  ON public.cee_drafter_raw_responses (operation_id);

ALTER TABLE public.cee_drafter_raw_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cee_drafter_raw_responses FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.cee_drafter_raw_responses FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.cee_drafter_raw_responses TO service_role;

-- Verification (DL, after applying):
--   SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--     WHERE relname = 'cee_drafter_raw_responses';                 -- t, t
--   SELECT has_table_privilege('anon', 'public.cee_drafter_raw_responses', 'SELECT');           -- false
--   SELECT has_table_privilege('authenticated', 'public.cee_drafter_raw_responses', 'SELECT');  -- false
--   SELECT count(*) FROM public.cee_drafter_raw_responses;          -- grows by 1 per served draft
