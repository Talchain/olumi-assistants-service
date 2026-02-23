/**
 * Cross-service contract test: CEE plan provenance preservation
 *
 * Verifies that plan_id and plan_hash flow correctly from:
 * 1. PlanAnnotationCheckpoint (captured after Stage 3)
 * 2. assembleCeeProvenance (surfaced in response provenance)
 * 3. pipelineTrace.cee_provenance (final response trace)
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

describe("Cross-service plan provenance", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubCleanEnv() {
    vi.stubEnv("CEE_DRAFT_PROMPT_VERSION", "");
    vi.stubEnv("ENGINE_BASE_URL", "");
  }

  // ── 1. PlanAnnotationCheckpoint contains plan_id and plan_hash ──────────

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

  // ── 2. assembleCeeProvenance includes plan_id/plan_hash in output ──────

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

    // Values must be preserved exactly
    expect(prov.plan_id).toBe(cp.plan_id);
    expect(prov.plan_hash).toBe(cp.plan_hash);
  });

  // ── 3. plan_id/plan_hash in provenance match checkpoint exactly ────────

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

  // ── 4. Values are preserved exactly (no transformation) ────────────────

  it("plan_id is not transformed between checkpoint and provenance", () => {
    stubCleanEnv();
    const prov = assembleCeeProvenance({
      pipelinePath: "unified",
      model: "test-model",
      planId: fixture.cee_checkpoint.plan_id,
      planHash: fixture.cee_checkpoint.plan_hash,
    });

    // Exact string equality — no lowercasing, trimming, or hashing
    expect(prov.plan_id).toStrictEqual(fixture.cee_checkpoint.plan_id);
    expect(prov.plan_hash).toStrictEqual(fixture.cee_checkpoint.plan_hash);
  });

  // ── 5. Fixture assertions are consistent ───────────────────────────────

  it("fixture assertions match fixture data", () => {
    const cp = fixture.cee_checkpoint;
    const provExpected = fixture.cee_provenance;

    // plan_id_preserved: checkpoint.plan_id === provenance.plan_id
    expect(cp.plan_id).toBe(provExpected.plan_id);

    // plan_hash_preserved: checkpoint.plan_hash === provenance.plan_hash
    expect(cp.plan_hash).toBe(provExpected.plan_hash);
  });
});
