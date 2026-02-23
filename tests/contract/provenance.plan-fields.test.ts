/**
 * Contract test: CEEProvenance plan_id / plan_hash fields
 *
 * Validates that the optional plan_id and plan_hash fields in CEEProvenance:
 * 1. Are correctly included by assembleCeeProvenance when provided
 * 2. Are correctly omitted when not provided
 * 3. Do not break PipelineTraceSchema validation (passthrough)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  assembleCeeProvenance,
  type CEEProvenance,
} from "../../src/cee/pipeline-checkpoints.js";
import { PipelineTraceSchema } from "../../src/schemas/ceeResponses.js";

describe("CEEProvenance plan fields contract", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CEE_DRAFT_PROMPT_VERSION;
    delete process.env.ENGINE_BASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const baseInput = {
    pipelinePath: "unified" as const,
    model: "gpt-4o-mini",
    promptVersion: "v2.3.1",
    promptSource: "store" as const,
    promptStoreVersion: 1,
  };

  it("includes plan_id and plan_hash when provided", () => {
    const prov = assembleCeeProvenance({
      ...baseInput,
      planId: "plan-abc-123",
      planHash: "sha256-deadbeef",
    });

    expect(prov.plan_id).toBe("plan-abc-123");
    expect(prov.plan_hash).toBe("sha256-deadbeef");
  });

  it("omits plan_id and plan_hash when not provided", () => {
    const prov = assembleCeeProvenance(baseInput);

    expect(prov).not.toHaveProperty("plan_id");
    expect(prov).not.toHaveProperty("plan_hash");
  });

  it("omits plan_id when planId is empty string", () => {
    const prov = assembleCeeProvenance({
      ...baseInput,
      planId: "",
      planHash: "sha256-deadbeef",
    });

    // Empty string is falsy — should not appear
    expect(prov).not.toHaveProperty("plan_id");
    expect(prov.plan_hash).toBe("sha256-deadbeef");
  });

  it("provenance with plan fields satisfies CEEProvenance type shape", () => {
    const prov: CEEProvenance = assembleCeeProvenance({
      ...baseInput,
      planId: "plan-abc-123",
      planHash: "sha256-deadbeef",
    });

    // All required base fields present
    expect(typeof prov.commit).toBe("string");
    expect(typeof prov.version).toBe("string");
    expect(typeof prov.build_timestamp).toBe("string");
    expect(prov.prompt_version).toBe("v2.3.1");
    expect(prov.model).toBe("gpt-4o-mini");
    expect(prov.pipeline_path).toBe("unified");

    // Plan fields present
    expect(prov.plan_id).toBe("plan-abc-123");
    expect(prov.plan_hash).toBe("sha256-deadbeef");
  });

  it("pipeline trace containing provenance with plan fields passes Zod validation", () => {
    const prov = assembleCeeProvenance({
      ...baseInput,
      planId: "plan-abc-123",
      planHash: "sha256-deadbeef",
    });

    const minimalTrace = {
      status: "success",
      total_duration_ms: 100,
      llm_call_count: 1,
      stages: [{ name: "llm_draft", status: "success", duration_ms: 50 }],
      cee_provenance: prov,
    };

    // PipelineTraceSchema uses .passthrough() — extra fields like cee_provenance
    // must not cause validation failure
    const result = PipelineTraceSchema.safeParse(minimalTrace);
    expect(result.success).toBe(true);
  });

  it("pipeline trace containing provenance without plan fields passes Zod validation", () => {
    const prov = assembleCeeProvenance(baseInput);

    const minimalTrace = {
      status: "success",
      total_duration_ms: 100,
      llm_call_count: 1,
      stages: [{ name: "llm_draft", status: "success", duration_ms: 50 }],
      cee_provenance: prov,
    };

    const result = PipelineTraceSchema.safeParse(minimalTrace);
    expect(result.success).toBe(true);
  });
});
