import { describe, it, expect } from "vitest";
import { trackProgress } from "../../../../src/orchestrator/pipeline/phase1-enrichment/progress-tracker.js";
import type { ConversationMessage } from "../../../../src/orchestrator/pipeline/types.js";

function msg(role: "user" | "assistant", content: string, toolCalls?: Array<{ name: string; input: Record<string, unknown> }>): ConversationMessage {
  const m: ConversationMessage = { role, content };
  if (toolCalls) m.tool_calls = toolCalls;
  return m;
}

describe("progress-tracker", () => {
  it("returns empty array for empty history", () => {
    expect(trackProgress([])).toEqual([]);
  });

  it("skips user messages and processes only assistant messages", () => {
    const history: ConversationMessage[] = [
      msg("user", "Hi"),
      msg("assistant", "Hello", [{ name: "draft_graph", input: {} }]),
      msg("user", "Run it"),
      msg("assistant", "Done", [{ name: "run_analysis", input: {} }]),
    ];
    const result = trackProgress(history);
    expect(result).toEqual(["changed_model", "ran_analysis"]);
  });

  it("maps draft_graph to changed_model", () => {
    const history = [msg("assistant", "ok", [{ name: "draft_graph", input: {} }])];
    expect(trackProgress(history)).toEqual(["changed_model"]);
  });

  it("maps edit_graph to changed_model", () => {
    const history = [msg("assistant", "ok", [{ name: "edit_graph", input: {} }])];
    expect(trackProgress(history)).toEqual(["changed_model"]);
  });

  it("maps run_analysis to ran_analysis", () => {
    const history = [msg("assistant", "ok", [{ name: "run_analysis", input: {} }])];
    expect(trackProgress(history)).toEqual(["ran_analysis"]);
  });

  it("maps generate_brief to committed", () => {
    const history = [msg("assistant", "ok", [{ name: "generate_brief", input: {} }])];
    expect(trackProgress(history)).toEqual(["committed"]);
  });

  it("maps explain_results to added_evidence", () => {
    const history = [msg("assistant", "ok", [{ name: "explain_results", input: {} }])];
    expect(trackProgress(history)).toEqual(["added_evidence"]);
  });

  it("returns 'none' for assistant turns with no tool calls", () => {
    const history = [msg("assistant", "Just chatting")];
    expect(trackProgress(history)).toEqual(["none"]);
  });

  it("respects lookback parameter", () => {
    const history: ConversationMessage[] = [
      msg("assistant", "1", [{ name: "draft_graph", input: {} }]),
      msg("assistant", "2", [{ name: "run_analysis", input: {} }]),
      msg("assistant", "3", [{ name: "generate_brief", input: {} }]),
      msg("assistant", "4", [{ name: "explain_results", input: {} }]),
      msg("assistant", "5"),
    ];
    // lookback=2 → only last 2 assistant turns
    expect(trackProgress(history, 2)).toEqual(["added_evidence", "none"]);
  });

  it("defaults lookback to 5", () => {
    const history: ConversationMessage[] = Array.from({ length: 10 }, (_, i) =>
      msg("assistant", `turn ${i}`, i < 5 ? [{ name: "draft_graph", input: {} }] : undefined),
    );
    const result = trackProgress(history);
    // Last 5 turns (indices 5-9) have no tool calls
    expect(result).toEqual(["none", "none", "none", "none", "none"]);
  });
});
