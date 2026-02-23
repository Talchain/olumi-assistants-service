/**
 * CEE plan provenance preservation contract test
 *
 * Verifies that plan_id and plan_hash flow correctly through CEE's
 * internal hops:
 * 1. PlanAnnotationCheckpoint (captured after Stage 3)
 * 2. assembleCeeProvenance (surfaced in response provenance)
 * 3. pipelineTrace.cee_provenance (assembled trace object)
 *
 * NOTE: PLoT consumption is out of scope for this repo. This test covers
 * the CEE-side contract only. PLoT integration should be verified in the
 * PLoT repo using this fixture as a shared contract.
 *
 * Values must be preserved exactly — no transformation or truncation.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assembleCeeProvenance,
  type CEEProvenance,
} from "../../src/cee/pipeline-checkpoints.js";

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, "../fixtures/cross-service/plan-provenance.fixture.json"),
    "utf-8",
  ),
);

describe("CEE plan provenance preservation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubCleanEnv() {
    vi.stubEnv("CEE_DRAFT_PROMPT_VERSION", "");
    vi.stubEnv("ENGINE_BASE_URL", "");
  }

  // ── 1. Fixture shape ──────────────────────────────────────────────────────

  it("fixture cee_checkpoint contains plan_id and plan_hash", () => {
    const cp = fixture.cee_checkpoint;
    expect(typeof cp.plan_id).toBe("string");
    expect(cp.plan_id.length).toBeGreaterThan(0);
    expect(typeof cp.plan_hash).toBe("string");
    expect(cp.plan_hash.length).toBeGreaterThan(0);
  });

  it("fixture cee_checkpoint includes plan_annotation_version", () => {
    expect(fixture.cee_checkpoint.plan_annotation_version).toBe("1");
  });

  // ── 2. assembleCeeProvenance preserves values ─────────────────────────────

  it("assembleCeeProvenance preserves plan_id and plan_hash from checkpoint", () => {
    stubCleanEnv();
    const cp = fixture.cee_checkpoint;

    const prov: CEEProvenance = assembleCeeProvenance({
      pipelinePath: "unified",
      model: cp.model_id,
      promptVersion: cp.prompt_version,
      promptSource: "store",
      promptStoreVersion: 1,
      planId: cp.plan_id,
      planHash: cp.plan_hash,
    });

    expect(prov.plan_id).toBe(cp.plan_id);
    expect(prov.plan_hash).toBe(cp.plan_hash);
  });

  // ── 3. Provenance matches fixture exactly ─────────────────────────────────

  it("provenance plan fields match fixture cee_provenance exactly", () => {
    stubCleanEnv();
    const cp = fixture.cee_checkpoint;
    const expected = fixture.cee_provenance;

    const prov = assembleCeeProvenance({
      pipelinePath: "unified",
      model: cp.model_id,
      promptVersion: cp.prompt_version,
      promptSource: "store",
      promptStoreVersion: 1,
      planId: cp.plan_id,
      planHash: cp.plan_hash,
    });

    expect(prov.plan_id).toBe(expected.plan_id);
    expect(prov.plan_hash).toBe(expected.plan_hash);
  });

  // ── 4. Trace-object hop: provenance lands on pipelineTrace ────────────────

  it("plan fields survive into a constructed pipelineTrace.cee_provenance", () => {
    stubCleanEnv();
    const cp = fixture.cee_checkpoint;

    // Simulate what package.ts does: build provenance, attach to trace
    const prov = assembleCeeProvenance({
      pipelinePath: "unified",
      model: cp.model_id,
      promptVersion: cp.prompt_version,
      promptSource: "store",
      promptStoreVersion: 1,
      planId: cp.plan_id,
      planHash: cp.plan_hash,
    });

    const pipelineTrace: Record<string, unknown> = {
      status: "success",
      total_duration_ms: 100,
      llm_call_count: 1,
      stages: [],
      cee_provenance: prov,
    };

    // Assert plan fields are accessible on the final trace structure
    const traceProv = pipelineTrace.cee_provenance as CEEProvenance;
    expect(traceProv.plan_id).toBe(cp.plan_id);
    expect(traceProv.plan_hash).toBe(cp.plan_hash);
  });

  // ── 5. No transformation ──────────────────────────────────────────────────

  it("values are not transformed between checkpoint and trace", () => {
    stubCleanEnv();
    const prov = assembleCeeProvenance({
      pipelinePath: "unified",
      model: "test-model",
      planId: fixture.cee_checkpoint.plan_id,
      planHash: fixture.cee_checkpoint.plan_hash,
    });

    // Exact string equality — no lowercasing, trimming, or re-hashing
    expect(prov.plan_id).toStrictEqual(fixture.cee_checkpoint.plan_id);
    expect(prov.plan_hash).toStrictEqual(fixture.cee_checkpoint.plan_hash);
  });

  // ── 6. Fixture self-consistency ───────────────────────────────────────────

  it("fixture assertions match fixture data", () => {
    const cp = fixture.cee_checkpoint;
    const provExpected = fixture.cee_provenance;

    expect(cp.plan_id).toBe(provExpected.plan_id);
    expect(cp.plan_hash).toBe(provExpected.plan_hash);
  });
});
