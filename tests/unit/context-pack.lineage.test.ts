/**
 * ContextPack v1 Lineage Propagation Tests (Stream C)
 *
 * Verifies that ContextPack fields propagate correctly through
 * assembleCeeProvenance() into the CEEProvenance structure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  assembleCeeProvenance,
  type ProvenanceInput,
  type CEEProvenance,
} from "../../src/cee/pipeline-checkpoints.js";

// =============================================================================
// Lineage propagation tests
// =============================================================================

describe("CEEProvenance — ContextPack v1 lineage", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const BASE_PROVENANCE_INPUT: ProvenanceInput = {
    pipelinePath: "unified",
    model: "gpt-4o",
    promptVersion: "v15",
    promptSource: "default",
    promptStoreVersion: null,
    modelOverrideActive: false,
    // ContextPack v1 lineage fields
    contextHash: "abc123def456",
    promptHash: "fed654cba321",
    modelId: "openai/gpt-4o",
    capability: "draft_graph",
  };

  it("includes context_hash from ContextPack", () => {
    const provenance = assembleCeeProvenance(BASE_PROVENANCE_INPUT);
    expect(provenance.context_hash).toBe("abc123def456");
  });

  it("includes prompt_hash from ContextPack", () => {
    const provenance = assembleCeeProvenance(BASE_PROVENANCE_INPUT);
    expect(provenance.prompt_hash).toBe("fed654cba321");
  });

  it("includes model_id from ContextPack", () => {
    const provenance = assembleCeeProvenance(BASE_PROVENANCE_INPUT);
    expect(provenance.model_id).toBe("openai/gpt-4o");
  });

  it("includes capability from ContextPack", () => {
    const provenance = assembleCeeProvenance(BASE_PROVENANCE_INPUT);
    expect(provenance.capability).toBe("draft_graph");
  });

  it("ContextPack fields are optional (backwards-compatible)", () => {
    const input: ProvenanceInput = {
      pipelinePath: "unified",
      model: "gpt-4o",
      // No ContextPack fields
    };
    const provenance = assembleCeeProvenance(input);

    // Legacy fields still work
    expect(provenance.model).toBe("gpt-4o");
    expect(provenance.pipeline_path).toBe("unified");

    // ContextPack fields are undefined
    expect(provenance.context_hash).toBeUndefined();
    expect(provenance.prompt_hash).toBeUndefined();
    expect(provenance.model_id).toBeUndefined();
    expect(provenance.capability).toBeUndefined();
  });

  it("existing provenance fields are preserved", () => {
    const provenance = assembleCeeProvenance(BASE_PROVENANCE_INPUT);

    // Legacy fields
    expect(provenance.commit).toBeDefined();
    expect(provenance.version).toBeDefined();
    expect(provenance.build_timestamp).toBeDefined();
    expect(provenance.prompt_version).toBe("v15");
    expect(provenance.prompt_source).toBe("defaults");
    expect(provenance.model).toBe("gpt-4o");
    expect(provenance.pipeline_path).toBe("unified");
    expect(provenance.model_override_active).toBe(false);
    expect(provenance.prompt_store_version).toBeNull();
  });

  it("prompt_source resolves correctly with env override", () => {
    process.env.CEE_DRAFT_PROMPT_VERSION = "v99";
    const provenance = assembleCeeProvenance(BASE_PROVENANCE_INPUT);
    expect(provenance.prompt_source).toBe("env_override");
    expect(provenance.prompt_override_active).toBe(true);
  });

  it("prompt_source resolves to supabase when source is store", () => {
    delete process.env.CEE_DRAFT_PROMPT_VERSION;
    const provenance = assembleCeeProvenance({
      ...BASE_PROVENANCE_INPUT,
      promptSource: "store",
    });
    expect(provenance.prompt_source).toBe("supabase");
  });
});
