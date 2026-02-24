import { describe, it, expect } from "vitest";
import { generateEventLogSummary } from "../../../src/orchestrator/context/event-log.js";
import type { OrchestratorEvent } from "../../../src/orchestrator/types.js";

function makeEvent(type: string, payload: Record<string, unknown> = {}): OrchestratorEvent {
  return {
    event_type: type,
    timestamp: new Date().toISOString(),
    payload,
  };
}

describe("Event Log Summary", () => {
  it("returns empty string for no events", () => {
    expect(generateEventLogSummary([])).toBe("");
  });

  it("renders framing confirmed", () => {
    const events = [makeEvent("framing_confirmed", { goal: "Choose the best vendor" })];
    const summary = generateEventLogSummary(events);
    expect(summary).toContain("Framing confirmed: Choose the best vendor.");
  });

  it("renders graph drafted", () => {
    const events = [makeEvent("graph_drafted", { node_count: 8, edge_count: 12 })];
    const summary = generateEventLogSummary(events);
    expect(summary).toContain("Graph drafted with 8 nodes, 12 edges.");
  });

  it("renders analysis run with winner", () => {
    const events = [makeEvent("analysis_run", {
      winner: "Option A",
      win_probability: 0.65,
      robustness_level: "moderate",
    })];
    const summary = generateEventLogSummary(events);
    expect(summary).toContain("Analysis run: Option A at 65%");
    expect(summary).toContain("robustness moderate");
  });

  it("renders patch counts", () => {
    const events = [
      makeEvent("patch_accepted"),
      makeEvent("patch_accepted"),
      makeEvent("patch_dismissed"),
    ];
    const summary = generateEventLogSummary(events);
    expect(summary).toContain("2 patches accepted");
    expect(summary).toContain("1 dismissed");
  });

  it("renders brief generated", () => {
    const events = [makeEvent("brief_generated")];
    const summary = generateEventLogSummary(events);
    expect(summary).toContain("Brief generated.");
  });

  it("omits sections for absent events", () => {
    const events = [makeEvent("framing_confirmed", { goal: "Test" })];
    const summary = generateEventLogSummary(events);
    expect(summary).not.toContain("Graph drafted");
    expect(summary).not.toContain("Analysis run");
    expect(summary).not.toContain("Brief generated");
  });

  it("combines all events in order", () => {
    const events = [
      makeEvent("framing_confirmed", { goal: "Test goal" }),
      makeEvent("graph_drafted", { node_count: 5, edge_count: 7 }),
      makeEvent("analysis_run", { winner: "A", win_probability: 0.8, robustness_level: "high" }),
      makeEvent("patch_accepted"),
      makeEvent("brief_generated"),
    ];
    const summary = generateEventLogSummary(events);

    // Verify all parts present
    expect(summary).toContain("Framing confirmed");
    expect(summary).toContain("Graph drafted");
    expect(summary).toContain("Analysis run");
    expect(summary).toContain("1 patches accepted");
    expect(summary).toContain("Brief generated");
  });
});
