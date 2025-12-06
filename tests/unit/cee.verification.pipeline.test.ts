import { describe, it, expect } from "vitest";

import { verificationPipeline } from "../../src/cee/verification/index.js";
import { CEEDraftGraphResponseV1Schema } from "../../src/schemas/ceeResponses.js";

// Minimal helper to build a valid CEEDraftGraphResponseV1-like payload for tests.
function buildMinimalDraftResponse() {
  return {
    graph: {
      version: "1",
      default_seed: 17,
      nodes: [{ id: "n1", kind: "goal" }],
      edges: [],
      meta: {
        roots: ["n1"],
        leaves: ["n1"],
        suggested_positions: {},
        source: "assistant",
      },
    },
    // DraftGraphOutput fields with defaults may be omitted; Zod will supply them.
    rationales: [],
    trace: {
      request_id: "req_verification_ok",
      correlation_id: "req_verification_ok",
      engine: {},
    },
    quality: {
      overall: 7,
    },
  };
}

describe("VerificationPipeline", () => {
  it("passes a valid draft response and enriches trace.verification", async () => {
    const payload = buildMinimalDraftResponse();

    const { response, results } = await verificationPipeline.verify(
      payload,
      CEEDraftGraphResponseV1Schema,
      {
        endpoint: "draft-graph",
        requiresEngineValidation: false,
        requestId: "req_verification_ok",
      },
    );

    expect(results.some((r) => r.stage === "schema_validation")).toBe(true);

    const trace = (response as any).trace;
    expect(trace).toBeDefined();
    expect(trace.verification).toBeDefined();
    expect(trace.verification.schema_valid).toBe(true);
    expect(typeof trace.verification.verification_latency_ms).toBe("number");
  });

  it("surfaces branch_probabilities warnings in trace.verification when branches are unnormalised", async () => {
    const payload = buildMinimalDraftResponse();

    (payload.graph as any).nodes.push(
      { id: "dec_1", kind: "decision" } as any,
      { id: "opt_1", kind: "option" } as any,
      { id: "opt_2", kind: "option" } as any,
    );
    (payload.graph as any).edges.push(
      { from: "n1", to: "dec_1" } as any,
      { from: "dec_1", to: "opt_1", belief: 0.7 } as any,
      { from: "dec_1", to: "opt_2", belief: 0.7 } as any,
    );

    const { response, results } = await verificationPipeline.verify(
      payload,
      CEEDraftGraphResponseV1Schema,
      {
        endpoint: "draft-graph",
        requiresEngineValidation: false,
        requestId: "req_branch_prob",
      },
    );

    const branchStage = results.find((r) => r.stage === "branch_probabilities");
    expect(branchStage).toBeDefined();
    expect(branchStage?.severity).toBe("warning");
    expect(branchStage?.code).toBe("BRANCH_PROBABILITIES_UNNORMALIZED");

    const verification = (response as any).trace?.verification;
    expect(verification).toBeDefined();
    const issues = verification.issues_detected;
    expect(Array.isArray(issues)).toBe(true);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "branch_probabilities",
          code: "BRANCH_PROBABILITIES_UNNORMALIZED",
          severity: "warning",
        }),
      ]),
    );
  });
  it("throws on schema violation for missing required fields", async () => {
    // Missing required trace/quality fields
    const invalid: any = {
      graph: {
        version: "1",
        default_seed: 17,
        nodes: [],
        edges: [],
        meta: {
          roots: [],
          leaves: [],
          suggested_positions: {},
          source: "assistant",
        },
      },
      rationales: [],
    };

    await expect(
      verificationPipeline.verify(
        invalid,
        CEEDraftGraphResponseV1Schema,
        {
          endpoint: "draft-graph",
          requiresEngineValidation: false,
          requestId: "req_verification_bad",
        },
      ),
    ).rejects.toThrow(/Response does not conform to expected schema/i);
  });

  it("returns weight_suggestions when uniform beliefs detected", async () => {
    const payload = buildMinimalDraftResponse();

    // Add uniform decision branches (all 0.33)
    (payload.graph as any).nodes.push(
      { id: "dec_1", kind: "decision", label: "Should we expand?" } as any,
      { id: "opt_1", kind: "option", label: "Yes" } as any,
      { id: "opt_2", kind: "option", label: "No" } as any,
      { id: "opt_3", kind: "option", label: "Maybe" } as any,
    );
    (payload.graph as any).edges.push(
      { from: "n1", to: "dec_1" } as any,
      { from: "dec_1", to: "opt_1", belief: 0.33 } as any,
      { from: "dec_1", to: "opt_2", belief: 0.33 } as any,
      { from: "dec_1", to: "opt_3", belief: 0.33 } as any,
    );

    const { response, results } = await verificationPipeline.verify(
      payload,
      CEEDraftGraphResponseV1Schema,
      {
        endpoint: "draft-graph",
        requiresEngineValidation: false,
        requestId: "req_weight_suggestions",
      },
    );

    const weightStage = results.find((r) => r.stage === "weight_suggestions");
    expect(weightStage).toBeDefined();
    expect((weightStage as any).suggestions?.length).toBeGreaterThan(0);

    // Check response has weight_suggestions field
    const suggestions = (response as any).weight_suggestions;
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].reason).toBe("uniform_distribution");
  });

  it("sets comparison_suggested when multiple options + shared outcomes", async () => {
    const payload = buildMinimalDraftResponse();

    // Add decision with multiple options targeting same outcome
    (payload.graph as any).nodes.push(
      { id: "dec_1", kind: "decision", label: "Compare options" } as any,
      { id: "opt_1", kind: "option", label: "Option A" } as any,
      { id: "opt_2", kind: "option", label: "Option B" } as any,
      { id: "out_1", kind: "outcome", label: "Revenue" } as any,
    );
    (payload.graph as any).edges.push(
      { from: "n1", to: "dec_1" } as any,
      { from: "dec_1", to: "opt_1" } as any,
      { from: "dec_1", to: "opt_2" } as any,
      { from: "opt_1", to: "out_1" } as any,
      { from: "opt_2", to: "out_1" } as any,
    );

    const { response, results } = await verificationPipeline.verify(
      payload,
      CEEDraftGraphResponseV1Schema,
      {
        endpoint: "draft-graph",
        requiresEngineValidation: false,
        requestId: "req_comparison",
      },
    );

    const comparisonStage = results.find((r) => r.stage === "comparison_detection");
    expect(comparisonStage).toBeDefined();
    expect((comparisonStage as any).comparison_suggested).toBe(true);

    // Check response has comparison_suggested field
    expect((response as any).comparison_suggested).toBe(true);
  });

  it("prioritizes near_zero/near_one suggestions over uniform_distribution", async () => {
    const payload = buildMinimalDraftResponse();

    // Add extreme belief edge and uniform edges
    (payload.graph as any).nodes.push(
      { id: "dec_1", kind: "decision", label: "Decision" } as any,
      { id: "opt_1", kind: "option", label: "A" } as any,
      { id: "opt_2", kind: "option", label: "B" } as any,
      { id: "out_1", kind: "outcome", label: "X" } as any,
    );
    (payload.graph as any).edges.push(
      { from: "n1", to: "dec_1" } as any,
      { from: "dec_1", to: "opt_1", belief: 0.5 } as any,
      { from: "dec_1", to: "opt_2", belief: 0.5 } as any,
      { from: "opt_1", to: "out_1", belief: 0.01 } as any, // near_zero
    );

    const { response } = await verificationPipeline.verify(
      payload,
      CEEDraftGraphResponseV1Schema,
      {
        endpoint: "draft-graph",
        requiresEngineValidation: false,
        requestId: "req_priority",
      },
    );

    const suggestions = (response as any).weight_suggestions;
    expect(Array.isArray(suggestions)).toBe(true);
    // near_zero should be first due to prioritization
    if (suggestions.length > 0) {
      expect(["near_zero", "near_one"]).toContain(suggestions[0].reason);
    }
  });
});
