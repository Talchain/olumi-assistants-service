import { describe, it, expect } from "vitest";
import { handleUndoPatch } from "../../../../src/orchestrator/tools/undo-patch.js";
import { getToolDefinitions } from "../../../../src/orchestrator/tools/registry.js";

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
});
