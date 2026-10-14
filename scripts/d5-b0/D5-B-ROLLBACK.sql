-- ROLLBACK for D5-B-MIGRATION.sql (round 2: one function)
-- (repo path when PR'd: supabase/migrations/rollback/20261014120000_d5_construction_questions_event_rollback.sql.do-not-apply)
--
-- ⚠ AUTHORED, NOT APPLIED. Shared Supabase (shared with production): Paul's call (CLAUDE.md §7.6).
--
-- ⛔ ORDER: revert the CEE writer PR FIRST and confirm the served CEE no longer calls
-- append_agent_answer_with_construction_questions; only THEN apply this. The writer has no fallback by
-- design: while it is deployed, a build answer whose RPC is missing fails like any other answer-commit
-- failure (`not_recorded`), so dropping first would fail every build answer until the revert lands.
-- Production CEE (0562e1de), cee-demo (3a44e75b) and cee-native-context-trial (833ec7be) never call
-- this function and never select scenarios.events (fresh worktrees, 14 Oct), so they are unaffected.
--
-- WHAT STAYS: `construction_questions` events already appended remain in scenarios.events, each beside
-- the answer row it was committed with. They are harmless to every reader measured: the production UI
-- (DGAI bed21070, served by olumi.netlify.app), staging UI (341bec5c) and main (7b5992fc) render an
-- unknown type as a generic timeline entry and fall to the scenario list's default arm; production and
-- staging also leave it out of the run-snapshot edit set (an allow-list; main has no snapshot factory) —
-- exactly as they already do for the 5,299 live `model_version_created` and 3,603 `decision_recorded`
-- events, which are also absent from those UIs' ScenarioEventType union. Removing them is a data UPDATE
-- on the shared DB: NOT part of this rollback, and only with Paul's separate approval.

DROP FUNCTION IF EXISTS public.append_agent_answer_with_construction_questions(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text,
  jsonb, jsonb, text, jsonb, boolean, uuid, uuid, jsonb
);

-- Postcondition: no D5 function remains (round 1's helper name included, in case it was ever created).
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND p.proname IN ('append_construction_questions_event', 'append_agent_answer_with_construction_questions')) THEN
    RAISE EXCEPTION 'D5-B rollback: a D5 function is still present';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';
