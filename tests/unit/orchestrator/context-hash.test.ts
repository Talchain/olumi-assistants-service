import { describe, it, expect } from "vitest";
import { hashContext } from "../../../src/orchestrator/context/hash.js";
import type { ConversationContext } from "../../../src/orchestrator/types.js";

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: null,
    analysis_response: null,
    framing: { stage: "frame" },
    messages: [],
    scenario_id: "test-scenario",
    ...overrides,
  };
}

describe("Context Hash", () => {
  it("produces 32-char hex string", () => {
    const hash = hashContext(makeContext());
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is deterministic (same input → same hash)", () => {
    const ctx = makeContext();
    expect(hashContext(ctx)).toBe(hashContext(ctx));
  });

  it("changes with different scenario_id", () => {
    const hash1 = hashContext(makeContext({ scenario_id: "scenario-1" }));
    const hash2 = hashContext(makeContext({ scenario_id: "scenario-2" }));
    expect(hash1).not.toBe(hash2);
  });

  it("changes with different stage", () => {
    const hash1 = hashContext(makeContext({ framing: { stage: "frame" } }));
    const hash2 = hashContext(makeContext({ framing: { stage: "evaluate" } }));
    expect(hash1).not.toBe(hash2);
  });

  it("changes with different messages", () => {
    const hash1 = hashContext(makeContext({
      messages: [{ role: "user", content: "Hello" }],
    }));
    const hash2 = hashContext(makeContext({
      messages: [{ role: "user", content: "Goodbye" }],
    }));
    expect(hash1).not.toBe(hash2);
  });

  it("is invariant to selected_elements order", () => {
    const hash1 = hashContext(makeContext({
      selected_elements: ["a", "b", "c"],
    }));
    const hash2 = hashContext(makeContext({
      selected_elements: ["c", "a", "b"],
    }));
    expect(hash1).toBe(hash2);
  });

  it("is invariant to analysis_inputs option order", () => {
    const hash1 = hashContext(makeContext({
      analysis_inputs: {
        options: [
          { option_id: "opt_b", label: "B", interventions: {} },
          { option_id: "opt_a", label: "A", interventions: {} },
        ],
      },
    }));
    const hash2 = hashContext(makeContext({
      analysis_inputs: {
        options: [
          { option_id: "opt_a", label: "A", interventions: {} },
          { option_id: "opt_b", label: "B", interventions: {} },
        ],
      },
    }));
    expect(hash1).toBe(hash2);
  });

  it("handles null framing", () => {
    const hash = hashContext(makeContext({ framing: null }));
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });
});
