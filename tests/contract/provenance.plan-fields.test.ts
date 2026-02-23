/**
 * Contract test: CEEProvenance plan_id / plan_hash fields
 *
 * Validates that the optional plan_id and plan_hash fields in CEEProvenance:
 * 1. Are correctly included by assembleCeeProvenance when provided
 * 2. Are correctly omitted when not provided
 * 3. Conform to a strict provenance shape (not just passthrough acceptance)
 * 4. Survive PipelineTraceSchema passthrough without rejection
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import {
  assembleCeeProvenance,
  type CEEProvenance,
} from "../../src/cee/pipeline-checkpoints.js";
import { PipelineTraceSchema } from "../../src/schemas/ceeResponses.js";

/**
 * Dedicated provenance schema for contract validation.
 *
 * PipelineTraceSchema uses .passthrough() and does not validate cee_provenance
 * fields — so we define a strict shape here to catch misspellings, wrong types,
 * or accidental removal of plan fields.
 */
const CEEProvenanceSchema = z.object({
  commit: z.string(),
  version: z.string(),
  build_timestamp: z.string(),
  prompt_version: z.string(),
  prompt_source: z.enum(["supabase", "defaults", "env_override"]),
  prompt_override_active: z.boolean(),
  model: z.string(),
  pipeline_path: z.enum(["A", "B", "unified"]),
  engine_base_url_configured: z.boolean(),
  model_override_active: z.boolean(),
  prompt_store_version: z.number().nullable(),
  plan_id: z.string().optional(),
  plan_hash: z.string().optional(),
});

describe("CEEProvenance plan fields contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubCleanEnv() {
    vi.stubEnv("CEE_DRAFT_PROMPT_VERSION", "");
    vi.stubEnv("ENGINE_BASE_URL", "");
  }

  const baseInput = {
    pipelinePath: "unified" as const,
    model: "gpt-4o-mini",
    promptVersion: "v2.3.1",
    promptSource: "store" as const,
    promptStoreVersion: 1,
  };

  // ── Shape validation (strict, not passthrough) ────────────────────────────

  it("provenance with plan fields validates against strict CEEProvenanceSchema", () => {
    stubCleanEnv();
    const prov = assembleCeeProvenance({
      ...baseInput,
      planId: "plan-abc-123",
      planHash: "sha256-deadbeef",
    });

    const result = CEEProvenanceSchema.safeParse(prov);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.plan_id).toBe("plan-abc-123");
      expect(result.data.plan_hash).toBe("sha256-deadbeef");
    }
  });

  it("provenance without plan fields validates against strict CEEProvenanceSchema", () => {
    stubCleanEnv();
    const prov = assembleCeeProvenance(baseInput);

    const result = CEEProvenanceSchema.safeParse(prov);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.plan_id).toBeUndefined();
      expect(result.data.plan_hash).toBeUndefined();
    }
  });

  // ── Inclusion / omission ──────────────────────────────────────────────────

  it("includes plan_id and plan_hash when provided", () => {
    stubCleanEnv();
    const prov = assembleCeeProvenance({
      ...baseInput,
      planId: "plan-abc-123",
      planHash: "sha256-deadbeef",
    });

    expect(prov.plan_id).toBe("plan-abc-123");
    expect(prov.plan_hash).toBe("sha256-deadbeef");
  });

  it("omits plan_id and plan_hash when not provided", () => {
    stubCleanEnv();
    const prov = assembleCeeProvenance(baseInput);

    expect(prov).not.toHaveProperty("plan_id");
    expect(prov).not.toHaveProperty("plan_hash");
  });

  it("omits plan_id when planId is empty string", () => {
    stubCleanEnv();
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
    stubCleanEnv();
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

    // Plan fields present and correctly typed
    expect(prov.plan_id).toBe("plan-abc-123");
    expect(prov.plan_hash).toBe("sha256-deadbeef");
  });

  // ── PipelineTraceSchema passthrough ───────────────────────────────────────

  it("pipeline trace containing provenance with plan fields passes Zod validation", () => {
    stubCleanEnv();
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

    const result = PipelineTraceSchema.safeParse(minimalTrace);
    expect(result.success).toBe(true);
  });

  it("pipeline trace containing provenance without plan fields passes Zod validation", () => {
    stubCleanEnv();
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
