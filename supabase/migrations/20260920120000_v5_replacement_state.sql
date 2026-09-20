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
-- ------------------------------------------------------------
-- CONCURRENCY: OPTIMISTIC, ON THE `revision` COLUMN.
--
-- ⛔ AMENDED. THE PREVIOUS NOTE HERE WAS WRONG AND SAID SO HONESTLY.
--    It read: "last-writer-wins on scenario_id. Asserted safe from the
--    existence of the turn fence (admitCurrentTurnFence serialises turns
--    per scenario), NOT from a measurement."
--
--    The assertion is REFUTED at the bytes. admitCurrentTurnFence
--    (src/orchestrator-v5/turn-fence-prehandler.ts:128-150) returns
--    Promise<void>, records a generation on the slot, and NEVER ABORTS
--    the request; and src/orchestrator-v5/turn-fence.ts:23-28 scopes
--    fence enforcement to "ONLY writes that carry a graph". It claims a
--    generation. It does not hold a lock, and it does not cover this
--    table at all. Two turns for one scenario can therefore both read,
--    and the older snapshot can overwrite the newer one — destroying a
--    remembered fact, an open proposal, or a completed receipt, while
--    BOTH writes report success. Reproduced by execution.
--
-- WHAT THE DESIGN NOW REQUIRES OF THIS SCHEMA — all three, or the
-- guarantee is not there:
--
--   1. `revision` exists, is NOT NULL, and every row has one. The writer
--      (SupabaseReplacementStateStore.save) mints a FRESH uuid on every
--      write and filters the UPDATE on the one it read:
--          UPDATE v5_replacement_state
--             SET state = $1, revision = $2, updated_at = $3
--           WHERE scenario_id = $4 AND revision = $5
--       RETURNING revision;
--      Zero rows returned = another turn won = the write is REFUSED and
--      the caller is told. The DEFAULT is for rows created by anything
--      other than that writer; it is not the mechanism.
--
--   2. The first write for a scenario is an INSERT, not an upsert, so
--      the PRIMARY KEY is load-bearing: two first turns racing must give
--      one 23505, which the adapter reports as a conflict. Do not add
--      ON CONFLICT DO UPDATE anywhere against this table.
--
--   3. `revision` must CHANGE on every write. It is deliberately NOT
--      updated_at: that value comes from a CLIENT clock (PostgREST
--      cannot express now() in a write body), two saves in the same
--      millisecond — the ordinary checkpoint-then-final pair — collide,
--      and this service runs several instances whose clocks can skew
--      backwards. Either failure admits a stale write silently.
--
-- ⚠ NOT REQUIRED, AND DELIBERATELY NOT ADDED: a BEFORE UPDATE trigger
--    that maintains `revision` server-side. It would be strictly more
--    correct against a hand-written UPDATE, and it is a trigger for Core
--    to own, review and version. Core: add one if you would rather not
--    depend on the writer. The adapter works either way, because it
--    reads back the value it filtered on rather than assuming it.
--
-- ROLLBACK
--   Forward-only is not available here: the adapter SELECTs `revision`
--   and writes it, so schema and code must move together.
--     · To roll back the COLUMN only (leaving data):
--         ALTER TABLE public.v5_replacement_state DROP COLUMN revision;
--       This makes every load fail with PGRST204 (unknown column) and
--       every write fail with it too — loudly, and BEFORE any state is
--       written. That is the intended direction: the flag
--       (CEE_REPLACEMENT_COACH_ENABLED) refuses turns rather than
--       silently reverting to last-writer-wins. Roll the code back in
--       the same window.
--     · To roll back this migration entirely (the table holds nothing
--       any other subsystem reads):
--         DROP TABLE IF EXISTS public.v5_replacement_state;
--   Both are safe to run with the flag OFF, which is its default.
-- ------------------------------------------------------------
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
  -- The optimistic-concurrency token. See CONCURRENCY above: the writer
  -- mints a fresh value on every write and filters on the one it read,
  -- so a write built from a stale snapshot matches zero rows and is
  -- refused. The DEFAULT only covers rows created by something other
  -- than that writer — it is not the mechanism.
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotent re-run against a table created before `revision` existed.
-- CREATE TABLE IF NOT EXISTS above is a no-op on an existing table, so
-- without this the column would silently never appear.
ALTER TABLE public.v5_replacement_state
  ADD COLUMN IF NOT EXISTS revision uuid NOT NULL DEFAULT gen_random_uuid();

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
  'scenario, written only by the service role via '
  'SupabaseReplacementStateStore, under OPTIMISTIC CONCURRENCY on the '
  '`revision` column — never last-writer-wins, and never ON CONFLICT DO '
  'UPDATE. Must be visible to every instance before the next turn starts '
  '— the next turn''s "yes, make that update now" resolves against it.';

COMMENT ON COLUMN public.v5_replacement_state.revision IS
  'Optimistic-concurrency token. The writer mints a fresh uuid on every '
  'write and filters its UPDATE on the value it read; zero rows matched '
  'means another turn wrote first and the write is REFUSED. Opaque — '
  'compared for equality only, never ordered. Deliberately not updated_at, '
  'which is a client clock: two saves in one millisecond collide and '
  'multi-instance clock skew can move it backwards, and either admits a '
  'stale write silently.';

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
--     --           revision uuid NO gen_random_uuid();
--     --           updated_at timestamptz NO now().
--
--   -- The concurrency guarantee itself, which the column's existence does
--   -- NOT establish. Run both arms; a store that admits the first is
--   -- last-writer-wins whatever the schema says.
--   INSERT INTO v5_replacement_state (scenario_id, state)
--        VALUES ('probe-cas', '{"version":1,"memory":{"items":[]},"proposals":{"proposals":[]}}');
--   -- stale arm — expect UPDATE 0
--   UPDATE v5_replacement_state SET state = '{"stale":true}', revision = gen_random_uuid()
--    WHERE scenario_id = 'probe-cas' AND revision = '00000000-0000-0000-0000-000000000000';
--   -- current arm (the DISCRIMINATING control: this one must be UPDATE 1)
--   UPDATE v5_replacement_state SET state = '{"fresh":true}', revision = gen_random_uuid()
--    WHERE scenario_id = 'probe-cas'
--      AND revision = (SELECT revision FROM v5_replacement_state WHERE scenario_id = 'probe-cas');
--   DELETE FROM v5_replacement_state WHERE scenario_id = 'probe-cas';
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
