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

  it("locks scenarios before replay/CAS and carries every v4 turn side effect", () => {
    const lock = appendBody.indexOf("FOR UPDATE");
    const turn = appendBody.indexOf("INSERT INTO public.v5_conversation_turns");
    const graph = appendBody.indexOf("UPDATE public.scenarios");
    const facts = appendBody.indexOf("INSERT INTO public.v5_handler_facts");
    const brief = appendBody.indexOf("SET brief_text = p_brief_text");
    expect(lock).toBeGreaterThan(0);
    expect(turn).toBeGreaterThan(lock);
    expect(graph).toBeGreaterThan(turn);
    expect(facts).toBeGreaterThan(graph);
    expect(brief).toBeGreaterThan(facts);
    for (const carrier of [
      "pending_actions",
      "coaching_state",
      "user_message",
      "assistant_message",
      "handler_facts",
      "brief_text",
    ]) {
      expect(appendBody).toContain(carrier);
    }
  });

  it("uses null-safe exact CAS with only the current-state self-noop exception", () => {
    expect(oneLine).toMatch(
      /IF v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash AND p_incoming_graph_identity_hash IS DISTINCT FROM v_current_hash THEN RAISE EXCEPTION USING ERRCODE = 'OLGC1'/
    );
    expect(appendBody).not.toMatch(
      /p_expected_graph_identity_hash IS NOT NULL/
    );
  });

  it("durably distinguishes guest/no-op null receipts from missing owned versions", () => {
    expect(oneLine).toMatch(
      /model_version_mutation_id UUID NULL, ADD COLUMN IF NOT EXISTS model_version_created BOOLEAN NULL/
    );
    expect(appendBody).toContain("p_version_mutation_id, v_should_create");
    expect(appendBody).toContain("IF v_turn_version_created = FALSE THEN");
    expect(appendBody).toContain("IF NOT v_should_create THEN");
  });

  it("creates initial only when no version row exists and carries actor/undo metadata", () => {
    expect(appendBody).toMatch(
      /SELECT EXISTS \([\s\S]*FROM public\.model_versions WHERE scenario_id = p_scenario_id[\s\S]*\) INTO v_has_versions/
    );
    expect(appendBody).toContain("WHEN NOT v_has_versions THEN 'initial'");
    expect(appendBody).toContain("'undo_version_id', v_head_id");
    expect(appendBody).toContain("'undo_version_id', v_version.parent_version_id");
    expect(appendBody).toContain("'actor_kind', p_version_actor_kind");
    expect(appendBody).toContain("'authored_by', p_version_authored_by");
  });

  it("keeps history append-only and invalidates pre-restore analysis chronologically", () => {
    expect(oneLine).toMatch(
      /REVOKE UPDATE, DELETE ON TABLE public\.model_versions FROM PUBLIC, anon, authenticated/
    );
    expect(appendBody).not.toMatch(/UPDATE public\.model_versions/);
    expect(appendBody).not.toMatch(/DELETE FROM public\.model_versions/);
    expect(functionBody).toContain("analysis_invalidated_at = v_analysis_invalidated_at");
  });
});
