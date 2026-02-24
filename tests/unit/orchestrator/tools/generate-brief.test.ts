import { describe, it, expect } from "vitest";
import { handleGenerateBrief } from "../../../../src/orchestrator/tools/generate-brief.js";
import type { ConversationContext, V2RunResponseEnvelope } from "../../../../src/orchestrator/types.js";

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: null,
    analysis_response: null,
    framing: { stage: "decide" },
    messages: [],
    scenario_id: "test-scenario",
    ...overrides,
  };
}

describe("generate_brief Tool Handler", () => {
  it("extracts decision_brief from analysis_response", () => {
    const brief = { recommendation: "Choose A", reasons: ["lower cost"] };
    const analysisResponse = {
      meta: { seed_used: 42, n_samples: 1000, response_hash: "abc" },
      results: [],
      decision_brief: brief,
    } as unknown as V2RunResponseEnvelope;

    const result = handleGenerateBrief(
      makeContext({ analysis_response: analysisResponse }),
      "turn-1",
    );

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe("brief");
    expect((result.blocks[0].data as { brief: unknown }).brief).toEqual(brief);
  });

  it("includes actions on brief block", () => {
    const analysisResponse = {
      meta: { seed_used: 42, n_samples: 1000, response_hash: "abc" },
      results: [],
      decision_brief: { recommendation: "Test" },
    } as unknown as V2RunResponseEnvelope;

    const result = handleGenerateBrief(
      makeContext({ analysis_response: analysisResponse }),
      "turn-1",
    );

    const block = result.blocks[0];
    expect(block.actions).toBeDefined();
    expect(block.actions!.length).toBeGreaterThan(0);

    const labels = block.actions!.map((a) => a.label);
    expect(labels).toContain("Share");
    expect(labels).toContain("Edit");
    expect(labels).toContain("Regenerate");
  });

  it("throws recoverable error when analysis_response is null", () => {
    expect(() => {
      handleGenerateBrief(makeContext({ analysis_response: null }), "turn-1");
    }).toThrow("Run analysis first");
  });

  it("throws recoverable error when decision_brief is absent", () => {
    const analysisResponse = {
      meta: { seed_used: 42, n_samples: 1000, response_hash: "abc" },
      results: [],
      // decision_brief intentionally absent
    } as unknown as V2RunResponseEnvelope;

    expect(() => {
      handleGenerateBrief(
        makeContext({ analysis_response: analysisResponse }),
        "turn-1",
      );
    }).toThrow("decision brief");
  });

  it("error includes orchestratorError with correct code", () => {
    try {
      handleGenerateBrief(makeContext({ analysis_response: null }), "turn-1");
      expect.unreachable("Should have thrown");
    } catch (error) {
      const orchErr = (error as { orchestratorError: { code: string; recoverable: boolean } }).orchestratorError;
      expect(orchErr.code).toBe("TOOL_EXECUTION_FAILED");
      expect(orchErr.recoverable).toBe(true);
    }
  });
});
