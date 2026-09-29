import { describe, it, expect } from "vitest";
import { classifyUserIntent } from "../../../../src/orchestrator/pipeline/phase1-enrichment/intent-classifier.js";

describe("intent-classifier", () => {
  it("classifies 'explain' keywords", () => {
    expect(classifyUserIntent("Why did this happen?")).toBe("explain");
    expect(classifyUserIntent("Explain the results")).toBe("explain");
    expect(classifyUserIntent("How is this calculated?")).toBe("explain");
    expect(classifyUserIntent("Tell me about the analysis")).toBe("explain");
  });

  it("classifies 'recommend' keywords", () => {
    expect(classifyUserIntent("Should I raise prices?")).toBe("recommend");
    expect(classifyUserIntent("Which option do you recommend?")).toBe("recommend");
    expect(classifyUserIntent("What do you think about this?")).toBe("recommend");
  });

  it("classifies 'act' keywords", () => {
    expect(classifyUserIntent("Add a new factor")).toBe("act");
    expect(classifyUserIntent("Run the analysis")).toBe("act");
    expect(classifyUserIntent("Create a model")).toBe("act");
    expect(classifyUserIntent("Draft a graph")).toBe("act");
  });

  it("classifies 'conversational' when no keywords match", () => {
    expect(classifyUserIntent("Hello there")).toBe("conversational");
    expect(classifyUserIntent("Thanks")).toBe("conversational");
    expect(classifyUserIntent("OK")).toBe("conversational");
  });

  it("prioritises act > recommend > explain", () => {
    // "add" (act) + "should I" (recommend)
    expect(classifyUserIntent("Should I add this factor?")).toBe("act");
    // "recommend" (recommend) + "explain" (explain) — recommend wins over explain
    expect(classifyUserIntent("Can you recommend and explain?")).toBe("recommend");
  });

  it("act takes priority over recommend", () => {
    expect(classifyUserIntent("Should I add a new node?")).toBe("act");
  });

  it("recommend takes priority over explain", () => {
    expect(classifyUserIntent("What do you think about why this happened?")).toBe("recommend");
  });
});
