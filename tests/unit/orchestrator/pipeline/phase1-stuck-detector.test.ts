import { describe, it, expect } from "vitest";
import { detectStuck } from "../../../../src/orchestrator/pipeline/phase1-enrichment/stuck-detector.js";
import type { ConversationMessage, ProgressKind } from "../../../../src/orchestrator/pipeline/types.js";

function msg(role: "user" | "assistant", content: string, toolCalls?: Array<{ name: string; input: Record<string, unknown> }>): ConversationMessage {
  const m: ConversationMessage = { role, content };
  if (toolCalls) m.tool_calls = toolCalls;
  return m;
}

describe("stuck-detector", () => {
  it("detects stuck when 3 non-explain user turns have no progress", () => {
    const history: ConversationMessage[] = [
      msg("user", "Should I change this?"),
      msg("assistant", "Let me think..."),
      msg("user", "What about option B?"),
      msg("assistant", "Here's my take..."),
      msg("user", "Can you recommend something?"),
      msg("assistant", "Sure..."),
    ];
    // 3 assistant turns, all with progress: 'none'
    const progressMarkers: ProgressKind[] = ["none", "none", "none"];
    const result = detectStuck(history, progressMarkers);
    expect(result.detected).toBe(true);
    expect(result.rescue_routes.length).toBe(3);
  });

  it("not stuck with only 2 qualifying turns", () => {
    const history: ConversationMessage[] = [
      msg("user", "Should I change this?"),
      msg("assistant", "Let me think..."),
      msg("user", "What about option B?"),
      msg("assistant", "Here's my take..."),
    ];
    const progressMarkers: ProgressKind[] = ["none", "none"];
    const result = detectStuck(history, progressMarkers);
    expect(result.detected).toBe(false);
    expect(result.rescue_routes).toEqual([]);
  });

  it("not stuck when tools were invoked (hadTools)", () => {
    const history: ConversationMessage[] = [
      msg("user", "Change the model"),
      msg("assistant", "Done", [{ name: "edit_graph", input: {} }]),
      msg("user", "Run analysis"),
      msg("assistant", "Running", [{ name: "run_analysis", input: {} }]),
      msg("user", "Show brief"),
      msg("assistant", "Here it is", [{ name: "generate_brief", input: {} }]),
    ];
    const progressMarkers: ProgressKind[] = ["changed_model", "ran_analysis", "committed"];
    const result = detectStuck(history, progressMarkers);
    expect(result.detected).toBe(false);
  });

  it("excludes explain-intent turns from stuck calculation", () => {
    // All 3 user messages are "why" questions → explain intent → not counted
    const history: ConversationMessage[] = [
      msg("user", "Why did this happen?"),
      msg("assistant", "Because..."),
      msg("user", "How does this work?"),
      msg("assistant", "It works by..."),
      msg("user", "Explain the results"),
      msg("assistant", "The results show..."),
    ];
    const progressMarkers: ProgressKind[] = ["none", "none", "none"];
    const result = detectStuck(history, progressMarkers);
    // All turns filtered out as explain → fewer than 3 qualifying → not stuck
    expect(result.detected).toBe(false);
  });

  it("returns empty rescue_routes when not stuck", () => {
    const result = detectStuck([], []);
    expect(result.detected).toBe(false);
    expect(result.rescue_routes).toEqual([]);
  });

  it("rescue routes have correct shape when stuck", () => {
    const history: ConversationMessage[] = [
      msg("user", "What should I do?"),
      msg("assistant", "Hmm..."),
      msg("user", "Any suggestions?"),
      msg("assistant", "Maybe..."),
      msg("user", "OK what now?"),
      msg("assistant", "Well..."),
    ];
    const progressMarkers: ProgressKind[] = ["none", "none", "none"];
    const result = detectStuck(history, progressMarkers);
    expect(result.detected).toBe(true);
    for (const route of result.rescue_routes) {
      expect(route).toHaveProperty("label");
      expect(route).toHaveProperty("prompt");
      expect(route).toHaveProperty("role");
      expect(["facilitator", "challenger"]).toContain(route.role);
    }
  });
});
