import { describe, it, expect } from "vitest";
import { buildEventLogSummary } from "../../../../src/orchestrator/context/event-log-summary.js";
import type { ScenarioEvent } from "../../../../src/orchestrator/context/event-log-summary.js";

// ============================================================================
// Fixtures
// ============================================================================

let seqCounter = 0;

function makeEvent(
  event_type: string,
  details: Record<string, unknown> = {},
  seq?: number,
): ScenarioEvent {
  return {
    event_id: `evt_${seqCounter}`,
    event_type,
    seq: seq ?? seqCounter++,
    timestamp: new Date().toISOString(),
    details,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("buildEventLogSummary", () => {
  it("returns empty string for null input", () => {
    expect(buildEventLogSummary(null)).toBe("");
  });

  it("returns empty string for undefined input", () => {
    expect(buildEventLogSummary(undefined)).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(buildEventLogSummary([])).toBe("");
  });

  it("renders framing confirmed with goal", () => {
    const events = [makeEvent("framing_confirmed", { goal: "Choose the best vendor" })];
    const summary = buildEventLogSummary(events);
    expect(summary).toContain("Framing confirmed: Choose the best vendor.");
  });

  it("renders graph drafted with node and edge counts", () => {
    const events = [makeEvent("graph_drafted", { node_count: 8, edge_count: 12 })];
    const summary = buildEventLogSummary(events);
    expect(summary).toContain("Graph drafted with 8 nodes, 12 edges.");
  });

  it("renders patch counts — accepted and dismissed", () => {
    const events = [
      makeEvent("patch_accepted"),
      makeEvent("patch_accepted"),
      makeEvent("patch_dismissed"),
    ];
    const summary = buildEventLogSummary(events);
    expect(summary).toContain("2 patches accepted");
    expect(summary).toContain("1 dismissed");
  });

  it("renders only accepted count when no dismissals", () => {
    const events = [makeEvent("patch_accepted"), makeEvent("patch_accepted")];
    const summary = buildEventLogSummary(events);
    expect(summary).toContain("2 patches accepted");
    expect(summary).not.toContain("dismissed");
  });

  it("renders only dismissed count when no acceptances", () => {
    const events = [makeEvent("patch_dismissed")];
    const summary = buildEventLogSummary(events);
    expect(summary).toContain("1 dismissed");
    expect(summary).not.toContain("patches accepted");
  });

  it("renders analysis run with winner, probability, and robustness", () => {
    const events = [
      makeEvent("analysis_run", {
        winner: "Option A",
        win_probability: 0.65,
        robustness_level: "moderate",
      }),
    ];
    const summary = buildEventLogSummary(events);
    expect(summary).toContain("Analysis run: Option A at 65%, robustness moderate.");
  });

  it("rounds probability to nearest integer (71.83 → 72%)", () => {
    const events = [
      makeEvent("analysis_run", {
        winner: "Option A",
        win_probability: 0.7183,
        robustness_level: "high",
      }),
    ];
    const summary = buildEventLogSummary(events);
    expect(summary).toContain("at 72%");
  });

  it("renders brief generated", () => {
    const events = [
      makeEvent("analysis_run", { winner: "A", win_probability: 0.5 }),
      makeEvent("brief_generated"),
    ];
    const summary = buildEventLogSummary(events);
    expect(summary).toContain("Brief generated.");
    expect(summary).not.toContain("Brief not yet generated.");
  });

  it("renders 'Brief not yet generated' when analysis run but no brief", () => {
    const events = [
      makeEvent("analysis_run", { winner: "A", win_probability: 0.5 }),
    ];
    const summary = buildEventLogSummary(events);
    expect(summary).toContain("Brief not yet generated.");
  });

  it("does not render brief section when neither analysis nor brief exists", () => {
    const events = [makeEvent("framing_confirmed", { goal: "Test" })];
    const summary = buildEventLogSummary(events);
    expect(summary).not.toContain("Brief");
  });

  it("uses latest event of each type (highest seq)", () => {
    // Two graph_drafted events — should use the latest
    const events = [
      makeEvent("graph_drafted", { node_count: 5, edge_count: 7 }, 1),
      makeEvent("graph_drafted", { node_count: 10, edge_count: 15 }, 5),
    ];
    const summary = buildEventLogSummary(events);
    expect(summary).toContain("10 nodes, 15 edges");
    expect(summary).not.toContain("5 nodes");
  });

  it("uses latest analysis_run event (highest seq)", () => {
    const events = [
      makeEvent("analysis_run", { winner: "Old Winner", win_probability: 0.4 }, 1),
      makeEvent("analysis_run", { winner: "New Winner", win_probability: 0.7 }, 10),
    ];
    const summary = buildEventLogSummary(events);
    expect(summary).toContain("New Winner");
    expect(summary).not.toContain("Old Winner");
  });

  it("renders full session template in correct order", () => {
    const events = [
      makeEvent("framing_confirmed", { goal: "Pick supplier" }),
      makeEvent("graph_drafted", { node_count: 6, edge_count: 9 }),
      makeEvent("patch_accepted"),
      makeEvent("analysis_run", { winner: "Supplier X", win_probability: 0.72, robustness_level: "high" }),
      makeEvent("brief_generated"),
    ];
    const summary = buildEventLogSummary(events);
    expect(summary).toContain("Framing confirmed: Pick supplier.");
    expect(summary).toContain("Graph drafted with 6 nodes, 9 edges.");
    expect(summary).toContain("1 patches accepted.");
    expect(summary).toContain("Analysis run: Supplier X at 72%, robustness high.");
    expect(summary).toContain("Brief generated.");
  });

  it("omits sections for absent event types", () => {
    const events = [makeEvent("framing_confirmed", { goal: "Test" })];
    const summary = buildEventLogSummary(events);
    expect(summary).not.toContain("Graph drafted");
    expect(summary).not.toContain("Analysis run");
    expect(summary).not.toContain("patches");
    expect(summary).not.toContain("Brief");
  });

  it("returns empty string when no relevant event types present", () => {
    const events = [
      makeEvent("some_unknown_event", { data: "irrelevant" }),
    ];
    // No framing, no graph, no analysis, no patches, no brief
    const summary = buildEventLogSummary(events);
    expect(summary).toBe("");
  });

  it("is deterministic — same events → identical string", () => {
    const events = [
      makeEvent("framing_confirmed", { goal: "Test goal" }, 1),
      makeEvent("graph_drafted", { node_count: 5, edge_count: 8 }, 2),
      makeEvent("analysis_run", { winner: "A", win_probability: 0.6 }, 3),
    ];
    const s1 = buildEventLogSummary(events);
    const s2 = buildEventLogSummary(events);
    expect(s1).toBe(s2);
  });
});
