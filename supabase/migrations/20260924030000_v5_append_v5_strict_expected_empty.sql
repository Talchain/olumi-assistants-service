-- =============================================================================
-- append_turn_atomic_v5 — STRICT EXPECTED-EMPTY, PER WRITE (2026-09-24)
-- =============================================================================
--
-- ⛔ NOT INSTALLED. This file is SOURCE ONLY. Nothing in the change that adds
--   it has run it, connected to a database, or compared it with the deployed
--   function definition. Staging, production and demo share ONE database, so
--   installing it is a Paul-gated step and it changes production's function.
--
-- THE DEFECT (independent review of PR #1786, comment 5806044132)
--   Graph registration's first construction (`expected_model_empty`) reads the
--   model as EMPTY, generates for ~20 s, then appends with
--   `requireAtomicExpectedBase`: p_cas_enforce = true, p_expected_base_known =
--   true, p_expected_graph_identity_hash = NULL. The guard in
--   20260920210000_v5_append_v5_replay_precedes_cas.sql:263-276 then refuses a
--   filled-in base ONLY IF
--       p_incoming_graph_identity_hash IS DISTINCT FROM v_current_hash
--   That conjunct is v4's content-idempotent exemption: re-sending the graph
--   that is already there is treated as a retry. It cannot tell a retry of
--   THIS write from a DIFFERENT operation that happened to save the same bytes:
--
--     expected = NULL (known-empty)   current = H_A   incoming = H_A
--     -> no conflict raised
--     -> v_should_create = (current IS DISTINCT FROM incoming) = false
--     -> the turn commits with NO model_version_receipt; the route reports
--        success for a construction that never became a version.
--
--   The same-turn replay is NOT the problem and is NOT touched: it is decided
--   first by the turn pre-existence lookup (20260920210000:183-193) and returns
--   the original receipt.
--
-- THE CHANGE
--   One trailing parameter, `p_require_expected_empty BOOLEAN DEFAULT FALSE`,
--   one declared variable, and two additions to the body, each between
--   `BEGIN/END strict expected-empty` marker comments. Everything else is the
--   20260920210000 body VERBATIM (a static guard test removes the marked
--   blocks and compares the remainder byte for byte).
--     1. An argument check beside the other 22023 checks: strictness is a
--        claim about a KNOWN-EMPTY base, so asking for it with any other base
--        is refused rather than silently run without it.
--     2. Inside `IF NOT v_turn_preexisting THEN`, after the existing guard and
--        so still AFTER the replay lookup: when the flag is true, ANY graph
--        presence raises OLGC1 with the existing message format — with no
--        `incoming IS DISTINCT FROM current` exemption. A distinct operation
--        can no longer satisfy strict expected-empty by saving the same bytes.
--        This clause does not read p_cas_enforce: a per-write precondition is
--        not switched off by the global posture (the store sends
--        p_cas_enforce = true for these writes anyway).
--   A write that does not send the flag reads FALSE: check 1 is `FALSE AND …`
--   and clause 2 is `IF FALSE`, so it behaves exactly as under 20260920210000.
--
-- ⭐ WHAT "GRAPH PRESENCE" MEANS — THE EMPTY-BUT-PRESENT DECISION
--   v_current_hash is NOT the graph. It is `scenarios.graph_identity_hash`,
--   read under the FOR UPDATE at the top of the body, and it is NULL for four
--   different states:
--     (i)   no graph at all (graph IS NULL);
--     (ii)  an identity-EMPTY graph — v3/v4 stamp the incoming hash, and the
--           identity hash of an identity-empty graph is null
--           (graph-identity.ts normaliseGraphForIdentity);
--     (iii) a NON-empty graph written by a path that never stamps the column:
--           append_turn_atomic_v2 (20260711000000:316, the store's path
--           under CEE_V5_GRAPH_CAS_RPC=off), store_draft_graph
--           (20260422120000:46) and the pre-v3 append_turn_atomic all run
--           `UPDATE scenarios SET graph = p_graph` and leave
--           graph_identity_hash untouched;
--     (iv)  a non-empty graph v4 wrote with a NULL incoming hash (unparseable).
--   Presence is therefore defined as:
--       v_current_hash IS NOT NULL
--       OR the stored graph is IDENTITY-BEARING   (only read when the hash
--                                                  is NULL)
--   where identity-bearing is graph-identity.ts `isIdentityEmptyGraph`
--   negated, field for field: a non-empty `nodes`, `edges` or `options`
--   array, or a `goal_node_id` key (v_current_identity_bearing).
--   so (iii) and (iv) ARE presence and (i) and (ii) are NOT.
--   * Why not the hash alone: in (iii) and (iv) a distinct operation's graph
--     would satisfy expected-empty through the NULL column, which is the class
--     of hole this change exists to close.
--   * Why not `graph IS NOT NULL`: (ii) is exactly what the caller's own read
--     classified as empty (assist.v1.scenario-graph-register.ts, the
--     `expected_model_empty` preflight: `isIdentityEmptyGraph(base)`), and the
--     stored skeleton does not go away — every retry would read it as empty
--     and be refused again, bricking first construction on that scenario.
--   * Why all four fields and not `nodes` (independent review of #1786,
--     5807034398): the ingress schema admits an options-only graph, and the
--     identity rule counts nodes, edges, options and goal_node_id. A
--     nodes-only test here let an UNSTAMPED options-, edges- or goal-only
--     graph pass as empty and be overwritten by a "first" construction.
--   * The test mirrors that route predicate on the SAME column (`loadGraph`
--     returns `scenarios.graph` raw), so on every state whose hash column is
--     NULL the route's read-time check and this clause agree: a graph the
--     route admitted as empty is refused here only if it changed. It is a
--     deliberate twin of a TS predicate; change them together. The static
--     guard test (CORRESPONDENCE) parses this expression and compares it,
--     field by field and on a probe set, with `isIdentityEmptyGraph`.
--   * CASE, not AND, guards jsonb_array_length: SQL does not promise
--     left-to-right evaluation, and jsonb_array_length raises on a non-array.
--   * `goal_node_id` counts by KEY presence (`?`), whatever its value, as the
--     TS rule does (`goal_node_id === undefined` is its only empty goal). A
--     stored `"goal_node_id": null` is therefore presence at BOTH boundaries.
--   * The graph read happens under the row lock this transaction already
--     holds, so it sees the same row the hash was read from.
--   NOT CHANGED HERE (pre-existing, recorded so it is not mistaken for fixed):
--   a non-strict write keeps the content-idempotent exemption by design. And a
--   STALE non-NULL hash, left by a non-stamping writer that replaced a stamped
--   graph with an empty one, reads as presence: the existing guard already
--   refuses that state for any different incoming graph, so strictness only
--   removes its identical-bytes admission.
--
-- WHY DROP + CREATE, AND NOT AN OVERLOAD
--   CREATE OR REPLACE keys on the full argument-type list, so adding a
--   parameter does not replace the 30-argument function; it creates a SECOND
--   one. PostgREST resolves a named-argument call against every overload: a
--   call carrying today's 30 keys matches both the 30-argument function and
--   the 31-argument one (whose extra parameter has a DEFAULT), and PostgREST
--   refuses it as ambiguous (PGRST203). Every existing caller would break.
--   This is the bug 20260426160532 fixed once and 20260502120000 avoided by
--   dropping first. So the exact old signature is DROPPED and the new one
--   CREATED, inside ONE transaction (BEGIN/COMMIT below, as in
--   20260610120000 and 20260731120000): no caller can observe the function
--   missing, and none can observe the new function before its REVOKE/GRANT
--   below. PostgreSQL gives EXECUTE to PUBLIC on every NEW function; the
--   REVOKE/GRANT reproduce 20260920210000's exactly, over the new signature.
--   `DROP … IF EXISTS` + `CREATE OR REPLACE` make a re-run harmless: the DROP
--   finds nothing and the CREATE replaces the 31-argument function in place.
--   SECURITY DEFINER and `SET search_path = pg_catalog, public` are as in
--   20260920210000. That file has no COMMENT ON FUNCTION and no OWNER TO line
--   for this function, and neither does this one.
--
-- ⚠ OWNERSHIP — CHECK BEFORE INSTALLING
--   A dropped function takes its owner with it; the new one is owned by the
--   role that runs this file, and a SECURITY DEFINER function runs AS its
--   owner. Install as the role that owns the current function:
--     SELECT p.oid::regprocedure, pg_get_userbyid(p.proowner),
--            p.prosecdef, p.proconfig, p.proacl
--       FROM pg_proc p
--      WHERE p.proname = 'append_turn_atomic_v5';
--   Expected before: ONE row, 30 arguments, prosecdef = true,
--   proconfig = {search_path=pg_catalog, public}. After: ONE row, 31
--   arguments, the same owner, prosecdef and proconfig, and an ACL that grants
--   EXECUTE to service_role and not to PUBLIC, anon or authenticated.
--
-- DEPLOY ORDER
--   1. Install THIS migration FIRST. Every caller already deployed keeps
--      working unchanged: it does not send p_require_expected_empty, so the
--      DEFAULT supplies FALSE. That includes production, which runs `main`.
--   2. Let the PostgREST schema cache reload (Supabase's DDL watch normally
--      does this; otherwise `NOTIFY pgrst, 'reload schema';`).
--   3. Only THEN serve a CEE build that sends p_require_expected_empty.
--      Against a database without this migration, or a stale schema cache,
--      that build's strict writes are refused with PGRST202 and write nothing
--      (fail closed); every other write sends no new key and is unaffected.
--
-- ROLLBACK
--   rollback/20260924030000_v5_append_v5_strict_expected_empty_rollback.sql.do-not-apply
--   restores the 20260920210000
--   function verbatim, again as one DROP + CREATE transaction. Apply it only
--   after no serving CEE build sends p_require_expected_empty.
--   ⛔ Do NOT "roll back" by re-running 20260920210000: its CREATE OR REPLACE
--   would add the 30-argument overload BESIDE the 31-argument one, and every
--   caller would then get PGRST203.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.append_turn_atomic_v5(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB,
  JSONB, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BIGINT,
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
);

CREATE OR REPLACE FUNCTION public.append_turn_atomic_v5(
  p_scenario_id                  UUID,
  p_turn_id                      TEXT,
  p_turn_class                   TEXT,
  p_handler_id                   TEXT,
  p_request_hash                 TEXT,
  p_response_emitted             BOOLEAN,
  p_llm_calls_used               INTEGER,
  p_duration_ms                  INTEGER,
  p_handler_facts                JSONB,
  p_graph                        JSONB,
  p_brief_text                   TEXT,
  p_pending_actions              JSONB,
  p_coaching_state               JSONB,
  p_user_message                 TEXT,
  p_assistant_message            TEXT,
  p_expected_graph_identity_hash TEXT,
  p_incoming_graph_identity_hash TEXT,
  p_cas_enforce                  BOOLEAN,
  p_fence_generation             BIGINT,
  p_version_mutation_id          UUID,
  p_version_analysis_affecting_hash TEXT,
  p_version_hash_algorithm       TEXT,
  p_version_projection_version   TEXT,
  p_version_normaliser_version   TEXT,
  p_version_graph_schema_version TEXT,
  p_version_actor_kind           TEXT,
  p_version_authored_by          TEXT,
  p_version_creation_kind        TEXT,
  p_version_source_turn_id       TEXT,
  -- Does the caller actually KNOW the expected base, or is it simply not
  -- instrumented on this path? SQL NULL cannot answer that, and conflating the
  -- two is the defect below. DEFAULT FALSE so every existing caller — and the
  -- C4 oracle's N1a/N1b/N2 pins — keep the pure-delegation behaviour they pin.
  p_expected_base_known          BOOLEAN DEFAULT FALSE,
  -- ── BEGIN strict expected-empty (20260924030000) ──
  -- Strict expected-empty for THIS write only. DEFAULT FALSE: a caller that
  -- does not send it keeps the 20260920210000 behaviour byte for byte.
  p_require_expected_empty       BOOLEAN DEFAULT FALSE
  -- ── END strict expected-empty (20260924030000) ──
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_turn_id             UUID;
  v_existing_turn_id    UUID;
  v_turn_preexisting    BOOLEAN;
  v_user_id             UUID;
  v_current_hash        TEXT;
  -- ── BEGIN strict expected-empty (20260924030000) ──
  v_current_identity_bearing BOOLEAN;
  -- ── END strict expected-empty (20260924030000) ──
  v_head_id             UUID;
  v_head_root           UUID;
  v_has_versions        BOOLEAN;
  v_should_create       BOOLEAN;
  v_turn_version_mutation_id UUID;
  v_turn_version_created BOOLEAN;
  v_events              JSONB;
  v_event_seq           INTEGER;
  v_updated             INTEGER;
  v_version             public.model_versions%ROWTYPE;
  v_version_id          UUID;
  v_version_number      INTEGER;
  v_root_id             UUID;
  v_creation_kind       TEXT;
  v_event_id            TEXT;
  v_event               JSONB;
BEGIN
  IF p_graph IS NULL OR p_version_mutation_id IS NULL THEN
    RAISE EXCEPTION 'append_turn_atomic_v5: graph and mutation id are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_incoming_graph_identity_hash IS NULL
     OR p_incoming_graph_identity_hash !~ '^[0-9a-f]{64}$'
     OR p_version_analysis_affecting_hash IS NULL
     OR p_version_analysis_affecting_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'append_turn_atomic_v5: both durable hashes must be 64-hex'
      USING ERRCODE = '22023';
  END IF;
  IF p_version_source_turn_id IS DISTINCT FROM p_turn_id
     OR p_version_creation_kind <> 'committed_mutation' THEN
    RAISE EXCEPTION 'append_turn_atomic_v5: creation/source turn carrier mismatch'
      USING ERRCODE = '22023';
  END IF;
  IF NOT (
    (p_version_actor_kind = 'known' AND p_version_authored_by IS NOT NULL)
    OR (p_version_actor_kind IN ('system', 'unknown') AND p_version_authored_by IS NULL)
  ) THEN
    RAISE EXCEPTION 'append_turn_atomic_v5: actor carrier is inconsistent'
      USING ERRCODE = '22023';
  END IF;
  -- ── BEGIN strict expected-empty (20260924030000) ──
  -- Strictness is a claim about a KNOWN-EMPTY base. Asked for with any other
  -- base it is a caller contract violation: refuse it, never run the write
  -- without the strictness it asked for.
  IF p_require_expected_empty
     AND (p_expected_base_known IS NOT TRUE
          OR p_expected_graph_identity_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'append_turn_atomic_v5: strict expected-empty requires a known-empty expected base'
      USING ERRCODE = '22023';
  END IF;
  -- ── END strict expected-empty (20260924030000) ──

  -- Capture only the version-composition state under the scenario lock. The
  -- canonical turn/fence/CAS/graph/facts/brief authority remains v4 below;
  -- this read exists solely so v5 can decide and compose the version in the
  -- same transaction from the pre-write head and identities.
  SELECT user_id, graph_identity_hash, current_model_version_id, events, event_seq
    INTO v_user_id, v_current_hash, v_head_id, v_events, v_event_seq
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'append_turn_atomic_v5: scenario % not found', p_scenario_id;
  END IF;
  v_should_create := v_user_id IS NOT NULL
    AND v_current_hash IS DISTINCT FROM p_incoming_graph_identity_hash;

  -- ⛔ REPLAY IS DECIDED BEFORE CAS. THIS LOOKUP MOVED ABOVE THE CAS BLOCK
  -- 2026-09-20 — see this migration's header for the defect it closes.
  --
  -- v4 has ALWAYS decided replay first and then skipped CAS entirely
  -- (20260806120000_v5_turn_fence_first_write_exemption.sql:298-305: "Conflict
  -- replay: identical (scenario_id, turn_id) already committed. SKIP CAS
  -- ENTIRELY and return the existing row id — retry safety"). v5 evaluated its
  -- own null-safe CAS ABOVE this lookup, so replaying an ALREADY-COMMITTED turn
  -- raised OLGC1 whenever the graph had moved on since — which is precisely the
  -- state an interrupted client is in when it replays.
  --
  -- The marker also still lets v5 distinguish that replay from the new
  -- NULL-marker row v4 inserts for us in this transaction.
  SELECT id, model_version_mutation_id, model_version_created
    INTO v_existing_turn_id, v_turn_version_mutation_id, v_turn_version_created
    FROM public.v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
  v_turn_preexisting := FOUND;

  -- A REPLAY IS NOT SUBJECT TO CAS. Its expected base belongs to the turn that
  -- already committed; re-testing it against a head that has since moved asks a
  -- question about a write that is no longer pending. The replay arm below is
  -- read-only and returns the durable receipt, so there is nothing to serialise.
  IF NOT v_turn_preexisting THEN
    -- ── NULL-SAFE CAS FOR A *KNOWN* EXPECTED BASE ──────────────────────────────
    -- v4 remains the canonical CAS and is not touched. This guard covers the one
    -- case v4 structurally CANNOT express, because its predicate is guarded by
    --     p_expected_graph_identity_hash IS NOT NULL AND v_current_hash IS NOT NULL
    -- (20260806120000_v5_turn_fence_first_write_exemption.sql:308-312). Those two
    -- guards are correct for v4, whose expected-hash parameter DEFAULTS to NULL
    -- and therefore genuinely means "no expectation supplied". They are wrong for
    -- a caller that READ the base and found it ABSENT: on a legacy scenario whose
    -- scenarios.graph_identity_hash is NULL, every concurrent writer reads
    -- expected = NULL at turn start, sends NULL, the first guard short-circuits,
    -- and NO CAS RUNS FOR ANY OF THEM. They serialise on the row lock and
    -- silently overwrite one another — a lost update with no conflict raised.
    --
    -- `p_expected_base_known` is the missing fact, not a second CAS: it says
    -- whether NULL means "known-absent" (enforce) or "not instrumented" (defer to
    -- v4, exactly as before). `IS DISTINCT FROM` is null-safe on both sides, so
    -- known-absent → known-absent matches and known-absent → moved conflicts.
    --
    -- This is the SAME semantics restore_model_version_atomic_v1 already states in
    -- this very migration ("NULL is a meaningful expected absence; IS DISTINCT
    -- FROM handles both null and non-null cases without a bypass"). Restore had
    -- it; append did not. One concept, two paths, opposite null handling.
    --
    -- The final conjunct preserves v4's idempotent-replay exemption: when the
    -- incoming graph ALREADY equals the current one, re-sending it is a replay,
    -- not a conflict. p_incoming_graph_identity_hash is required 64-hex above, so
    -- it is never NULL here.
    -- ⚠ THE FIRST-WRITE EXEMPTION IS PRESERVED, DELIBERATELY. v4's second guard
    -- (`v_current_hash IS NOT NULL`) is not only a bypass — it is also the
    -- exemption the migration NAMED AFTER IT exists to provide
    -- (20260806120000_v5_turn_fence_FIRST_WRITE_EXEMPTION). A legacy row whose
    -- graph EXISTS but whose graph_identity_hash column was never stamped reads
    -- `current = NULL` while the caller legitimately supplies a recomputed
    -- `expected = <hash>`. Refusing that is not conflict detection, it is
    -- bricking every unstamped scenario on its next turn — the exact "Cut 1"
    -- failure `validators/numeric-bounds.ts` records paying for once already.
    --
    -- So this guard adds EXACTLY ONE enforcement over v4 — a known-absent base
    -- that has since been filled in — which is precisely the lost update.
    --
    -- ⚠⚠ THE TABLE BELOW WAS WRITTEN AS A FUNCTION OF TWO VARIABLES AND THE CODE
    -- IS A FUNCTION OF THREE (corrected 2026-08-26, after the C4 oracle was run
    -- against a real Postgres for the first time). It previously read
    -- `expected NULL, current SET -> CONFLICT` UNCONDITIONALLY, omitting the
    -- `incoming` conjunct entirely. That reached the right verdict for an
    -- incomplete reason — and a fixture written from it sent `incoming = current`,
    -- landed in the replay-exemption cell, was correctly ACCEPTED, and read as a
    -- migration defect. An incomplete model that happens to agree on the case in
    -- hand is exactly how the next reader is misled.
    --
    -- `incoming` matters because v4's IDEMPOTENT-REPLAY exemption is preserved
    -- here: re-sending the SAME graph is a retry, not a conflict.
    --
    --   expected  current  incoming    outcome
    --   --------  -------  ---------   -----------------------------------------
    --   NULL      NULL     any      -> match      (first writer proceeds)
    --   NULL      SET      ≠current -> CONFLICT   <- the lost update, caught
    --   NULL      SET      =current -> match      (idempotent replay, exempt)
    --   SET       NULL     any      -> exempt     (unstamped legacy row)
    --   h1        h2       ≠current -> CONFLICT   (v4 catches this too)
    --   h1        h2       =current -> match      (idempotent replay, exempt)
    --   h         h        any      -> match
    --
    -- Two concurrent writers on an unstamped scenario both read expected = NULL.
    -- They serialise on the FOR UPDATE above: the first sees current NULL and
    -- commits, stamping the hash; the second then sees current SET against its
    -- NULL expectation, with a DIFFERENT graph in hand, and is refused. That is
    -- the race closed — and the "different graph" clause is why the row above it
    -- exists rather than being a hole.
    IF p_cas_enforce
       AND p_expected_base_known
       AND v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash
       AND p_incoming_graph_identity_hash IS DISTINCT FROM v_current_hash
       AND NOT (v_current_hash IS NULL AND p_expected_graph_identity_hash IS NOT NULL)
    THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLGC1',
        MESSAGE = format(
          'append_turn_atomic_v5: stale graph write for scenario %s (expected %s, current %s)',
          p_scenario_id,
          COALESCE(p_expected_graph_identity_hash, '<absent>'),
          COALESCE(v_current_hash, '<absent>'));
    END IF;
    -- ── BEGIN strict expected-empty (20260924030000) ──
    -- ⛔ STRICT EXPECTED-EMPTY. The guard above exempts `incoming = current` as a
    -- content-idempotent retry. For a caller that asserted a known-empty base that
    -- exemption is a hole: a DIFFERENT operation that saved the same bytes between
    -- the empty read and this append is admitted, v_should_create is false, and the
    -- turn commits with no version receipt. So when strictness is requested ANY
    -- graph presence is a conflict and `incoming` is deliberately not consulted.
    -- A replay of THIS turn never reaches here: v_turn_preexisting decided it above.
    --
    -- Presence = a stamped identity hash, OR (hash NULL) a stored graph that is
    -- IDENTITY-BEARING: a non-empty `nodes`, `edges` or `options` array, or a
    -- `goal_node_id` key. That is graph-identity.ts `isIdentityEmptyGraph`, the
    -- SAME predicate the route's `expected_model_empty` preflight applies, field
    -- for field (independent review of #1786, 5807034398: "nodes only" here let
    -- an unstamped options-only graph pass as empty and be overwritten).
    -- v_current_hash is scenarios.graph_identity_hash, which the v2 /
    -- store_draft_graph writers never stamp, so the hash alone would let an
    -- unstamped graph pass as empty. An identity-empty graph with a NULL hash is
    -- NOT presence: it is what the caller's own read classified as empty, and
    -- refusing it would refuse every retry on that scenario. Read under the FOR
    -- UPDATE lock above.
    --   * CASE, not AND: jsonb_array_length raises on a non-array, and SQL does
    --     not promise to evaluate AND left to right. Every OR operand is safe
    --     to evaluate in any order.
    --   * The outer object CASE mirrors `!graph || …` over a non-object value,
    --     and keeps `?` off scalars/arrays, where it tests string membership.
    --   * `graph ? 'goal_node_id'` is KEY presence, whatever the value, as in TS
    --     (`goal_node_id === undefined` is the only empty goal on JSON input).
    -- ⛔ A deliberate twin of a TS predicate: change them together. The static
    --   guard test parses THIS expression and compares it with isIdentityEmptyGraph.
    IF p_require_expected_empty THEN
      IF v_current_hash IS NULL THEN
        SELECT CASE WHEN jsonb_typeof(graph) = 'object' THEN
                      (CASE WHEN jsonb_typeof(graph -> 'nodes') = 'array'
                            THEN jsonb_array_length(graph -> 'nodes') > 0
                            ELSE FALSE END)
                   OR (CASE WHEN jsonb_typeof(graph -> 'edges') = 'array'
                            THEN jsonb_array_length(graph -> 'edges') > 0
                            ELSE FALSE END)
                   OR (CASE WHEN jsonb_typeof(graph -> 'options') = 'array'
                            THEN jsonb_array_length(graph -> 'options') > 0
                            ELSE FALSE END)
                   OR (graph ? 'goal_node_id')
                    ELSE FALSE
               END
          INTO v_current_identity_bearing
          FROM public.scenarios
          WHERE id = p_scenario_id;
      END IF;
      IF v_current_hash IS NOT NULL OR v_current_identity_bearing IS TRUE THEN
        RAISE EXCEPTION USING
          ERRCODE = 'OLGC1',
          MESSAGE = format(
            'append_turn_atomic_v5: stale graph write for scenario %s (expected %s, current %s)',
            p_scenario_id,
            COALESCE(p_expected_graph_identity_hash, '<absent>'),
            COALESCE(v_current_hash, '<unstamped>'));
      END IF;
    END IF;
    -- ── END strict expected-empty (20260924030000) ──
  END IF;


  -- ONE turn authority. The nested call shares this transaction: if version,
  -- head or event composition below fails, v4's turn/graph/facts/brief writes
  -- roll back with it. p_cas_enforce and every nullable CAS case are therefore
  -- exactly v4's semantics, not a second approximation in v5.
  v_turn_id := public.append_turn_atomic_v4(
    p_scenario_id,
    p_turn_id,
    p_turn_class,
    p_handler_id,
    p_request_hash,
    p_response_emitted,
    p_llm_calls_used,
    p_duration_ms,
    p_handler_facts,
    p_graph,
    p_brief_text,
    p_pending_actions,
    p_coaching_state,
    p_user_message,
    p_assistant_message,
    p_expected_graph_identity_hash,
    p_incoming_graph_identity_hash,
    p_cas_enforce,
    p_fence_generation
  );

  IF v_turn_preexisting THEN
    IF v_turn_id IS DISTINCT FROM v_existing_turn_id THEN
      RAISE EXCEPTION 'append_turn_atomic_v5: canonical replay returned another turn row'
        USING ERRCODE = 'MV409';
    END IF;
    IF v_turn_version_mutation_id IS DISTINCT FROM p_version_mutation_id THEN
      RAISE EXCEPTION 'append_turn_atomic_v5: turn replay reused with another mutation id'
        USING ERRCODE = 'MV422';
    END IF;
    IF v_turn_version_created = FALSE THEN
      RETURN jsonb_build_object('turn_row_id', v_turn_id, 'model_version_receipt', NULL);
    END IF;
    IF v_turn_version_created IS DISTINCT FROM TRUE OR v_user_id IS NULL THEN
      RAISE EXCEPTION 'append_turn_atomic_v5: turn has an inconsistent version marker'
        USING ERRCODE = 'MV409';
    END IF;
    SELECT * INTO v_version FROM public.model_versions
      WHERE scenario_id = p_scenario_id
        AND mutation_id = p_version_mutation_id
        AND source_turn_id = p_turn_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'append_turn_atomic_v5: committed owned turn has no atomic version receipt'
        USING ERRCODE = 'MV409';
    END IF;
    RETURN jsonb_build_object(
      'turn_row_id', v_turn_id,
      'model_version_receipt', jsonb_build_object(
        'mutation_id', v_version.mutation_id,
        'version_id', v_version.id,
        'version_number', v_version.version_number,
        'graph_identity_hash', v_version.graph_identity_hash,
        'analysis_affecting_hash', v_version.analysis_affecting_hash,
        'hash_algorithm', v_version.hash_algorithm,
        'identity_projection_version', v_version.identity_projection_version,
        'identity_normaliser_version', v_version.identity_normaliser_version,
        'graph_schema_version', v_version.graph_schema_version,
        'actor_kind', v_version.actor_kind,
        'authored_by', v_version.authored_by,
        'creation_kind', v_version.creation_kind,
        'source_version_id', v_version.source_version_id,
        'source_turn_id', v_version.source_turn_id,
        'parent_version_id', v_version.parent_version_id,
        'root_version_id', v_version.root_version_id,
        'undo_version_id', v_version.parent_version_id,
        'graph', v_version.graph,
        'event_id', 'model_version_created_mutation_' || v_version.mutation_id::text
      )
    );
  END IF;

  -- v4 intentionally knows nothing about C8's idempotency marker. Claim the
  -- new row once, after v4 returns, so replays can recover the durable receipt
  -- without duplicating any canonical turn side effect.
  UPDATE public.v5_conversation_turns
    SET model_version_mutation_id = p_version_mutation_id,
        model_version_created = v_should_create
    WHERE id = v_turn_id
      AND scenario_id = p_scenario_id
      AND turn_id = p_turn_id
      AND model_version_mutation_id IS NULL
      AND model_version_created IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'append_turn_atomic_v5: canonical append returned an unclaimable turn row'
      USING ERRCODE = 'MV409';
  END IF;

  -- Guest compatibility and authoritative under-lock no-op suppression: graph,
  -- turn and every ordinary side effect still commit, but there is no durable
  -- version/head/event and replay is pinned by the turn marker above.
  IF NOT v_should_create THEN
    RETURN jsonb_build_object('turn_row_id', v_turn_id, 'model_version_receipt', NULL);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.model_versions WHERE scenario_id = p_scenario_id
  ) INTO v_has_versions;
  IF v_head_id IS NOT NULL THEN
    SELECT root_version_id INTO v_head_root
      FROM public.model_versions WHERE id = v_head_id AND scenario_id = p_scenario_id;
  END IF;
  v_version_id := gen_random_uuid();
  v_root_id := CASE
    WHEN NOT v_has_versions THEN v_version_id
    WHEN v_head_root IS NOT NULL THEN v_head_root
    ELSE NULL
  END;
  v_creation_kind := CASE
    WHEN NOT v_has_versions THEN 'initial'
    ELSE 'committed_mutation'
  END;
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version_number
    FROM public.model_versions WHERE scenario_id = p_scenario_id;

  INSERT INTO public.model_versions (
    id, scenario_id, owner_user_id, version_number, graph,
    graph_identity_hash, analysis_affecting_hash, hash_algorithm,
    identity_projection_version, identity_normaliser_version,
    graph_schema_version, label, provenance, mutation_id,
    parent_version_id, root_version_id, actor_kind, authored_by,
    creation_kind, source_version_id, source_turn_id
  ) VALUES (
    v_version_id, p_scenario_id, v_user_id, v_version_number, p_graph,
    p_incoming_graph_identity_hash, p_version_analysis_affecting_hash,
    p_version_hash_algorithm, p_version_projection_version,
    p_version_normaliser_version, p_version_graph_schema_version,
    'Committed model change', 'commit', p_version_mutation_id,
    v_head_id, v_root_id, p_version_actor_kind, p_version_authored_by,
    v_creation_kind, NULL, p_version_source_turn_id
  );

  v_event_id := 'model_version_created_mutation_' || p_version_mutation_id::text;
  v_event_seq := COALESCE(v_event_seq, 0) + 1;
  v_event := jsonb_build_object(
    'event_id', v_event_id,
    'event_type', 'model_version_created',
    'seq', v_event_seq,
    'timestamp', to_jsonb(now()),
    'details', jsonb_build_object(
      'mutation_id', p_version_mutation_id,
      'version_id', v_version_id,
      'version_number', v_version_number,
      'source_turn_id', p_turn_id,
      'creation_kind', v_creation_kind,
      'parent_version_id', v_head_id,
      'root_version_id', v_root_id,
      'actor_kind', p_version_actor_kind,
      'authored_by', p_version_authored_by
    ),
    'hashes', jsonb_build_object(
      'graph_identity_hash', p_incoming_graph_identity_hash,
      'analysis_affecting_hash', p_version_analysis_affecting_hash,
      'algorithm', p_version_hash_algorithm,
      'projection_version', p_version_projection_version,
      'normaliser_version', p_version_normaliser_version,
      'graph_schema_version', p_version_graph_schema_version
    )
  );
  UPDATE public.scenarios SET
    current_model_version_id = v_version_id,
    events = COALESCE(v_events, '[]'::jsonb) || jsonb_build_array(v_event),
    event_seq = v_event_seq,
    updated_at = NOW()
    WHERE id = p_scenario_id;

  RETURN jsonb_build_object(
    'turn_row_id', v_turn_id,
    'model_version_receipt', jsonb_build_object(
      'mutation_id', p_version_mutation_id,
      'version_id', v_version_id,
      'version_number', v_version_number,
      'graph_identity_hash', p_incoming_graph_identity_hash,
      'analysis_affecting_hash', p_version_analysis_affecting_hash,
      'hash_algorithm', p_version_hash_algorithm,
      'identity_projection_version', p_version_projection_version,
      'identity_normaliser_version', p_version_normaliser_version,
      'graph_schema_version', p_version_graph_schema_version,
      'actor_kind', p_version_actor_kind,
      'authored_by', p_version_authored_by,
      'creation_kind', v_creation_kind,
      'source_version_id', NULL,
      'source_turn_id', p_turn_id,
      'parent_version_id', v_head_id,
      'root_version_id', v_root_id,
      'undo_version_id', v_head_id,
      'graph', p_graph,
      'event_id', v_event_id
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.append_turn_atomic_v5(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB,
  JSONB, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BIGINT,
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.append_turn_atomic_v5(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB,
  JSONB, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BIGINT,
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN
) TO service_role;

COMMIT;
