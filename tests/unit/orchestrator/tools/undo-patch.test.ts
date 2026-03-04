import { describe, it, expect } from "vitest";
import { handleUndoPatch } from "../../../../src/orchestrator/tools/undo-patch.js";
import { getToolDefinitions, GATE_ONLY_TOOL_NAMES } from "../../../../src/orchestrator/tools/registry.js";

describe("undo_patch Tool Handler", () => {
  it("returns graceful stub message", () => {
    const result = handleUndoPatch();
    expect(result.blocks).toEqual([]);
    expect(result.assistantText).toContain("Undo is not yet available");
  });

  it("does NOT throw an error", () => {
    expect(() => handleUndoPatch()).not.toThrow();
  });

  it("is NOT in the LLM tool registry", () => {
    const defs = getToolDefinitions();
    const undoTool = defs.find((d) => d.name === "undo_patch");
    expect(undoTool).toBeUndefined();
  });

  // Task 3 regression: undo_patch removed from GATE_ONLY_TOOL_NAMES (no gate patterns in v2)
  it("is NOT in GATE_ONLY_TOOL_NAMES (removed in v2, latent stub only)", () => {
    // grep evidence: no patterns in intent-gate.ts reference undo_patch.
    // Handler in dispatch.ts exists as a latent LLM-invocable stub.
    expect(GATE_ONLY_TOOL_NAMES.has('undo_patch')).toBe(false);
  });
});
