-- ============================================================
-- V5 Replacement conversation layer — durable per-scenario state.
--
-- ⛔ PROPOSAL ONLY. NOT APPLIED, AND NOT TO BE APPLIED BY THIS LANE.
--    This file is a request for Core (the persistence and mutation
--    authority) to review, amend and execute. Nothing in this branch
--    connects to a database, runs a migration tool, or assumes this
--    table exists. The adapter that reads it
--    (src/orchestrator-v5/replacement/supabase-state-store.ts) is inert
--    until someone installs it with setReplacementStateStore(), which
--    nothing does yet.
--
-- ⚠ Whether the DEPLOYED schema matches the migrations in this repo has
--    NOT been checked. It needs an information_schema query against
--    staging. Nothing here should be applied on the assumption that it
--    does.
--
-- Target: Staging Supabase
-- Date: 2026-09-20
-- Spec: output/session-analysis-20260920/CORE-PERSISTENCE-REQUEST.md
-- Flag: CEE_REPLACEMENT_COACH_ENABLED (default off)
--
-- Why a new table, and why none of the existing slots will do:
--   · v5_handler_facts.payload — a trap. HandlerFactSchema is a .strict()
--     discriminated union whose read THROWS, and readFactsFor is called
--     UNFILTERED from build-turn-context.ts. One unrecognised row breaks
--     prior-fact loading for the WHOLE scenario on every later turn, for
--     every reader — not just the writer.
--   · pending_actions — capped at 3 rows by a DB CHECK.
--   · coaching_state / scenarios.rolling_summary — owned and typed by
--     other subsystems; sharing couples two lifecycles that have no
--     reason to move together.
--   · scenarios.brief — dead (0 live consumers), but reviving a dead
--     column as a different thing is how a name stops meaning anything.
--   · A new column on v5_conversation_turns — migration PLUS a new RPC
--     PLUS SessionTurnWrite PLUS baseRpcArgs PLUS the strip-before-
--     strict-parse read path. Strictly more surface, for less.
--
-- Why it must be durable rather than process-local:
--   This service runs more than one instance. A process-local store
--   would put the user's "yes, make that update now" on an instance
--   that never saw the offer — the exact failure this layer exists to
--   fix, reintroduced as a deployment artefact, and intermittent, which
--   is the worst form.
--
-- Concurrency: last-writer-wins on scenario_id. Asserted safe from the
--   existence of the turn fence (admitCurrentTurnFence serialises turns
--   per scenario), NOT from a measurement. If any path runs two turns
--   for one scenario concurrently, this needs updated_at as an
--   optimistic-concurrency token instead.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The table, exactly as specified in CORE-PERSISTENCE-REQUEST.md.
--
--    state holds { version: 1, memory, proposals }. Versioned from the
--    start: a stored blob with no version is a migration you cannot
--    write later.
--
--    No CHECK on the shape of `state` beyond NOT NULL, deliberately —
--    same discipline as pending_actions and coaching_state. The read
--    path (decodeReplacementState, turn-entry.ts) treats a stored blob
--    as data from outside the process and reads anything unrecognised
--    as EMPTY rather than throwing. That is the opposite of the
--    handler-facts trap above, and it is the whole reason a DB-level
--    shape constraint would be the wrong tool here: a constraint that
--    rejects a write is fine, but coupling the DB to the vendored JSON
--    layout buys nothing the decoder does not already give.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v5_replacement_state (
  scenario_id text PRIMARY KEY,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. ⚠ ADDED BY THE IMPLEMENTING LANE — NOT IN THE ORIGINAL REQUEST.
--    Core: strike this section if you disagree, but please decide it
--    rather than inherit it.
--
--    The request's DDL leaves the table with Supabase's default broad
--    grants and RLS OFF. Under the RLS-first model documented in
--    supabase/README.md, a public-schema table with no RLS and default
--    grants is READABLE AND WRITABLE BY `anon` THROUGH PostgREST. This
--    table holds a scenario's conversation memory and its outstanding
--    proposals — including the proposal a later "yes" resolves against,
--    which is exactly the thing an attacker would want to write.
--
--    Every sibling table of this kind is hardened. The closest analogue,
--    v5_turn_fence (migration 20260731120000), does precisely this:
--        ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
--        REVOKE ALL ... FROM PUBLIC, anon, authenticated;
--        GRANT  ALL ... TO service_role;
--    and the adapter reads it directly on the grounds that the client IS
--    the service role. The same reasoning applies here, so the same
--    hardening should.
--
--    RLS is enabled with NO policies on purpose: service_role bypasses
--    RLS, and no other role should reach this table at all. An enabled-
--    but-policy-less table denies every non-bypassing role by default,
--    which is the intended posture — belt (RLS) and braces (grants).
-- ------------------------------------------------------------
ALTER TABLE public.v5_replacement_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.v5_replacement_state FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.v5_replacement_state TO service_role;

-- ------------------------------------------------------------
-- 3. Documentation. An operator reading \d v5_replacement_state should
--    be able to tell what writes it and what happens to a bad row.
-- ------------------------------------------------------------
COMMENT ON TABLE public.v5_replacement_state IS
  'V5 replacement conversation layer: durable per-scenario state for the '
  'replacement controller (CEE_REPLACEMENT_COACH_ENABLED). One row per '
  'scenario, last-writer-wins, written only by the service role via '
  'SupabaseReplacementStateStore. Must be visible to every instance '
  'before the next turn starts — the next turn''s "yes, make that update '
  'now" resolves against it.';

COMMENT ON COLUMN public.v5_replacement_state.state IS
  'ReplacementState: { version: 1, memory, proposals }. Read through '
  'decodeReplacementState (turn-entry.ts), which treats the blob as data '
  'from outside the process — anything unrecognised reads as EMPTY, never '
  'throws. Shape is deliberately NOT constrained at the DB layer.';

COMMENT ON COLUMN public.v5_replacement_state.updated_at IS
  'Set explicitly by the writer on every upsert. The DEFAULT now() covers '
  'INSERT only — a column default does NOT fire on the UPDATE half of an '
  'upsert, so relying on it would freeze this value at row creation.';

-- ------------------------------------------------------------
-- 4. Verification (run AFTER Core applies this; this lane ran none of it).
--
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'v5_replacement_state';
--     -- Expected: scenario_id text NO null; state jsonb NO null;
--     --           updated_at timestamptz NO now().
--
--   SELECT relrowsecurity FROM pg_class
--    WHERE oid = 'public.v5_replacement_state'::regclass;
--     -- Expected: true (if section 2 was kept).
--
--   SELECT has_table_privilege('anon', 'public.v5_replacement_state', 'SELECT');
--     -- Expected: false (if section 2 was kept).
--
--   SELECT has_table_privilege('service_role', 'public.v5_replacement_state', 'INSERT');
--     -- Expected: true.
--
--   -- PostgREST schema cache: Supabase normally reloads on DDL. If the new
--   -- table is not visible (PGRST205), force it:  NOTIFY pgrst, 'reload schema';
-- ------------------------------------------------------------
