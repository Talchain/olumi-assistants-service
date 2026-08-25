/**
 * C8-A atomic restore SQL guards.
 *
 * This suite does not claim to execute Postgres. It pins the load-bearing SQL
 * structure while atomic-restore-transaction.test.ts exercises the state
 * transitions and failure cases with a transaction-faithful model.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/20260824200000_c8_atomic_model_version_restore.sql",
    import.meta.url
  )
);
const ROLLBACK_PATH = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/rollback/20260824200000_c8_atomic_model_version_restore_rollback.sql.do-not-apply",
    import.meta.url
  )
);

const migration = readFileSync(MIGRATION_PATH, "utf8");
const rollback = readFileSync(ROLLBACK_PATH, "utf8");
const code = migration
  .split("\n")
  .map((line) =>
    line.slice(0, line.indexOf("--") === -1 ? undefined : line.indexOf("--"))
  )
  .join("\n");
const oneLine = code.replace(/\s+/g, " ");
const functionBody = code.slice(
  code.indexOf(
    "CREATE OR REPLACE FUNCTION public.restore_model_version_atomic_v1"
  ),
  code.indexOf(
    "REVOKE EXECUTE ON FUNCTION public.restore_model_version_atomic_v1"
  )
);
const appendBody = code.slice(
  code.indexOf("CREATE OR REPLACE FUNCTION public.append_turn_atomic_v5"),
  code.indexOf("REVOKE EXECUTE ON FUNCTION public.append_turn_atomic_v5")
);
const appendV4Delegation = appendBody.match(
  /v_turn_id := public\.append_turn_atomic_v4\(([\s\S]*?)\);/
);

describe("C8-A atomic restore migration — authority and atomic structure", () => {
  it("is explicitly unexecuted and additive, with mutation uniqueness + two hash carriers", () => {
    expect(migration).toMatch(/NOT EXECUTED/);
    expect(oneLine).toMatch(
      /ADD COLUMN IF NOT EXISTS analysis_affecting_hash TEXT NULL/
    );
    expect(oneLine).toMatch(/ADD COLUMN IF NOT EXISTS mutation_id UUID NULL/);
    expect(oneLine).toMatch(
      /ADD COLUMN IF NOT EXISTS parent_version_id UUID NULL/
    );
    expect(oneLine).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS model_versions_scenario_mutation_id_uidx ON public\.model_versions \(scenario_id, mutation_id\) WHERE mutation_id IS NOT NULL/
    );
  });

  it("uses a distinct service-role-only RPC and locks scenarios as the serialization point", () => {
    expect(oneLine).toMatch(
      /CREATE OR REPLACE FUNCTION public\.restore_model_version_atomic_v1\(/
    );
    expect(oneLine).toMatch(
      /FROM public\.scenarios WHERE id = p_scenario_id FOR UPDATE/
    );
    expect(oneLine).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.restore_model_version_atomic_v1[\s\S]*FROM PUBLIC, anon, authenticated/
    );
    expect(oneLine).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.restore_model_version_atomic_v1[\s\S]*TO service_role/
    );
  });

  it("resolves idempotent replay before CAS and rejects a mutation reused for another target", () => {
    const replay = functionBody.indexOf(
      "WHERE scenario_id = p_scenario_id AND mutation_id = p_mutation_id"
    );
    const reuse = functionBody.indexOf("USING ERRCODE = 'MV422'");
    const cas = functionBody.indexOf(
      "v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash"
    );
    expect(replay).toBeGreaterThan(0);
    expect(reuse).toBeGreaterThan(replay);
    expect(cas).toBeGreaterThan(reuse);
  });

  it("performs exact CAS against scenarios.graph_identity_hash and the server-read working graph", () => {
    expect(oneLine).toMatch(
      /SELECT user_id, graph, graph_identity_hash, current_model_version_id, events, event_seq/
    );
    expect(oneLine).toMatch(
      /v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash OR p_current_graph_identity_hash IS DISTINCT FROM p_expected_graph_identity_hash OR v_current_graph IS DISTINCT FROM p_current_graph/
    );
    expect(oneLine).not.toMatch(
      /current_model_version_id IS DISTINCT FROM p_expected/
    );
  });

  it("appends undo then restore, and has exactly one scenario update carrying graph/head/event together", () => {
    const undo = functionBody.indexOf("'Before restore', 'pre_restore'");
    const restored = functionBody.indexOf("p_label, 'restore', p_version_id");
    const scenarioUpdate = functionBody.indexOf("UPDATE public.scenarios");
    expect(undo).toBeGreaterThan(0);
    expect(restored).toBeGreaterThan(undo);
    expect(scenarioUpdate).toBeGreaterThan(restored);
    expect(functionBody.match(/UPDATE public\.scenarios/g)).toHaveLength(1);
    expect(oneLine).toMatch(
      /SET graph = p_graph, graph_identity_hash = p_graph_identity_hash, current_model_version_id = v_new_id, analysis_invalidated_at = v_analysis_invalidated_at, events =/
    );
    expect(functionBody).not.toMatch(/UPDATE public\.model_versions/);
    expect(functionBody).not.toMatch(/DELETE FROM public\.model_versions/);
  });

  it("stores and returns full and analysis-affecting hashes as separate values", () => {
    expect(oneLine).toMatch(
      /graph_identity_hash, analysis_affecting_hash, hash_algorithm/
    );
    expect(oneLine).toMatch(
      /'graph_identity_hash', p_graph_identity_hash, 'analysis_affecting_hash', p_analysis_affecting_hash/
    );
    expect(oneLine).toMatch(
      /'graph_identity_hash', p_graph_identity_hash, 'analysis_affecting_hash', p_analysis_affecting_hash, 'hash_algorithm'/
    );
  });
});

describe("C8-A atomic restore rollback", () => {
  it("is marked do-not-apply and removes the function before destructive columns", () => {
    expect(rollback).toMatch(/DO NOT APPLY/);
    const dropFunction = rollback.indexOf(
      "DROP FUNCTION IF EXISTS public.restore_model_version_atomic_v1"
    );
    const dropColumn = rollback.indexOf(
      "DROP COLUMN IF EXISTS analysis_affecting_hash"
    );
    expect(dropFunction).toBeGreaterThan(0);
    expect(dropColumn).toBeGreaterThan(dropFunction);
  });
});

describe("C8-A atomic semantic append migration", () => {
  it("is a distinct service-role-only RPC with no application fallback target", () => {
    expect(oneLine).toMatch(
      /CREATE OR REPLACE FUNCTION public\.append_turn_atomic_v5\(/
    );
    expect(oneLine).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.append_turn_atomic_v5[\s\S]*FROM PUBLIC, anon, authenticated/
    );
    expect(oneLine).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.append_turn_atomic_v5[\s\S]*TO service_role/
    );
  });

  it("locks version state, then delegates every canonical turn carrier to v4 in exact order", () => {
    const lock = appendBody.indexOf("FOR UPDATE");
    const replayLookup = appendBody.indexOf(
      "SELECT id, model_version_mutation_id, model_version_created"
    );
    const replayFound = appendBody.indexOf("v_turn_preexisting := FOUND");
    const delegation = appendBody.indexOf(
      "v_turn_id := public.append_turn_atomic_v4"
    );
    const marker = appendBody.indexOf("UPDATE public.v5_conversation_turns");
    expect(lock).toBeGreaterThan(0);
    expect(replayLookup).toBeGreaterThan(lock);
    expect(replayFound).toBeGreaterThan(replayLookup);
    expect(delegation).toBeGreaterThan(replayFound);
    expect(marker).toBeGreaterThan(delegation);
    expect(appendV4Delegation).not.toBeNull();
    expect(appendV4Delegation![1]!.split(",").map((arg) => arg.trim())).toEqual(
      [
        "p_scenario_id",
        "p_turn_id",
        "p_turn_class",
        "p_handler_id",
        "p_request_hash",
        "p_response_emitted",
        "p_llm_calls_used",
        "p_duration_ms",
        "p_handler_facts",
        "p_graph",
        "p_brief_text",
        "p_pending_actions",
        "p_coaching_state",
        "p_user_message",
        "p_assistant_message",
        "p_expected_graph_identity_hash",
        "p_incoming_graph_identity_hash",
        "p_cas_enforce",
        "p_fence_generation",
      ]
    );
  });

  it("contains no second fence, turn, graph, facts or brief authority", () => {
    expect(appendBody.match(/public\.append_turn_atomic_v4\(/g)).toHaveLength(
      1
    );
    expect(appendBody).not.toContain(
      "INSERT INTO public.v5_conversation_turns"
    );
    expect(appendBody).not.toContain("INSERT INTO public.v5_handler_facts");
    expect(appendBody).not.toContain("SET graph = p_graph");
    expect(appendBody).not.toContain("SET brief_text = p_brief_text");
    expect(appendBody).not.toContain("public.v5_turn_fence");
    expect(appendBody).not.toMatch(/ERRCODE = 'OLTF[123]'/);
  });

  /**
   * ⚠⚠ NARROWED, NOT RELAXED (Codex C8-A review defect 1, 2026-08-25).
   *
   * The assertion above used to also carry
   *     expect(appendBody).not.toMatch(/ERRCODE = 'OLGC1'/)
   * plus exact counts of 2 for `p_expected_graph_identity_hash` and
   * `p_cas_enforce` — i.e. it forbade v5 from raising a CAS conflict AT ALL.
   *
   * That is one claim too strong, and it forbade the fix. v5 must not
   * REIMPLEMENT v4's CAS — a second approximation of the same question, which
   * is what delegation removed. It must still be able to guard the one case
   * v4 structurally cannot express, because v4's predicate is gated on
   * `p_expected_graph_identity_hash IS NOT NULL AND v_current_hash IS NOT NULL`:
   * a caller that READ the base and found it absent. Without that guard, two
   * concurrent writers on an unstamped scenario both pass and silently
   * overwrite one another.
   *
   * So the guard now pins the SHAPE rather than the absence: exactly one CAS
   * raise, reachable only through `p_expected_base_known`, and the delegation
   * to v4 still intact. A reimplementation — a second raise, or a raise not
   * gated on the known-base flag — still REDs.
   */
  it("adds EXACTLY ONE CAS guard, reachable only via p_expected_base_known, and still delegates to v4", () => {
    expect(
      appendBody.match(/ERRCODE = 'OLGC1'/g),
      "more than one CAS raise in v5 means it has regrown a CAS of its own " +
        "rather than adding the single guard v4 cannot express"
    ).toHaveLength(1);

    const guardStart = appendBody.indexOf("AND p_expected_base_known");
    expect(
      guardStart,
      "the CAS raise must sit inside the known-base guard; if this conjunct is " +
        "absent the raise is unconditional and every uninstrumented caller breaks"
    ).toBeGreaterThan(-1);
    const raiseAt = appendBody.indexOf("ERRCODE = 'OLGC1'");
    const guardEnd =
      appendBody.indexOf("END IF;", guardStart) + "END IF;".length;
    expect(
      raiseAt > guardStart && raiseAt < guardEnd,
      "the OLGC1 raise is outside the p_expected_base_known guard"
    ).toBe(true);

    // The delegated CAS parameters are still forwarded to v4 verbatim — the
    // property the delegation exists to provide.
    expect(appendBody.match(/p_cas_enforce/g)).toHaveLength(3);
    expect(appendBody.match(/p_expected_base_known/g)).toHaveLength(2);
    expect(appendBody.match(/p_expected_graph_identity_hash/g)).toHaveLength(5);
  });

  it("durably distinguishes guest/no-op null receipts from missing owned versions", () => {
    expect(oneLine).toMatch(
      /model_version_mutation_id UUID NULL, ADD COLUMN IF NOT EXISTS model_version_created BOOLEAN NULL/
    );
    expect(appendBody).toMatch(
      /v_should_create := v_user_id IS NOT NULL\s+AND v_current_hash IS DISTINCT FROM p_incoming_graph_identity_hash/
    );
    expect(appendBody).toMatch(
      /UPDATE public\.v5_conversation_turns\s+SET model_version_mutation_id = p_version_mutation_id,\s*model_version_created = v_should_create\s+WHERE id = v_turn_id\s+AND scenario_id = p_scenario_id\s+AND turn_id = p_turn_id\s+AND model_version_mutation_id IS NULL\s+AND model_version_created IS NULL;\s*GET DIAGNOSTICS v_updated = ROW_COUNT;\s*IF v_updated <> 1 THEN[\s\S]*?USING ERRCODE = 'MV409'/
    );
    expect(appendBody).toContain("IF v_turn_version_created = FALSE THEN");
    expect(appendBody).toContain("IF NOT v_should_create THEN");
  });

  it("cannot swallow delegated writes and orders marker, version, then head/event composition", () => {
    const delegation = appendBody.indexOf(
      "v_turn_id := public.append_turn_atomic_v4"
    );
    const marker = appendBody.indexOf("UPDATE public.v5_conversation_turns");
    const version = appendBody.indexOf("INSERT INTO public.model_versions");
    const headEvent = appendBody.indexOf(
      "UPDATE public.scenarios SET",
      version
    );
    expect(marker).toBeGreaterThan(delegation);
    expect(version).toBeGreaterThan(marker);
    expect(headEvent).toBeGreaterThan(version);
    expect(appendBody).not.toMatch(/\n\s*EXCEPTION\s+(?:WHEN|\n)/);
  });

  it("creates initial only when no version row exists and carries actor/undo metadata", () => {
    expect(appendBody).toMatch(
      /SELECT EXISTS \([\s\S]*FROM public\.model_versions WHERE scenario_id = p_scenario_id[\s\S]*\) INTO v_has_versions/
    );
    expect(appendBody).toContain("WHEN NOT v_has_versions THEN 'initial'");
    expect(appendBody).toContain("'undo_version_id', v_head_id");
    expect(appendBody).toContain(
      "'undo_version_id', v_version.parent_version_id"
    );
    expect(appendBody).toContain("'actor_kind', p_version_actor_kind");
    expect(appendBody).toContain("'authored_by', p_version_authored_by");
  });

  it("keeps history append-only and invalidates pre-restore analysis chronologically", () => {
    expect(oneLine).toMatch(
      /REVOKE UPDATE, DELETE ON TABLE public\.model_versions FROM PUBLIC, anon, authenticated/
    );
    expect(appendBody).not.toMatch(/UPDATE public\.model_versions/);
    expect(appendBody).not.toMatch(/DELETE FROM public\.model_versions/);
    expect(functionBody).toContain(
      "analysis_invalidated_at = v_analysis_invalidated_at"
    );
  });
});
