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
});
