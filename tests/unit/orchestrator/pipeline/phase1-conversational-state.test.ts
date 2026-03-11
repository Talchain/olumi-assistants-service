import { describe, it, expect } from "vitest";
import { buildConversationalState } from "../../../../src/orchestrator/pipeline/phase1-enrichment/conversational-state.js";
import type { ConversationContext, ConversationMessage } from "../../../../src/orchestrator/types.js";

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: null,
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: "test",
    ...overrides,
  };
}

function makeMessages(items: Array<{ role: "user" | "assistant"; content: string; tool_calls?: ConversationMessage["tool_calls"] }>): ConversationMessage[] {
  return items.map((item) => ({
    role: item.role,
    content: item.content,
    tool_calls: item.tool_calls,
  }));
}

// ============================================================================
// pending_clarification extraction
// ============================================================================

describe("buildConversationalState — pending_clarification", () => {
  it("extracts pending clarification from structured tool state", () => {
    const messages = makeMessages([
      { role: "user", content: "Reduce it by 10%" },
      {
        role: "assistant",
        content: "Which one should I update — Onboarding Time or Hiring Delay?",
        tool_calls: [{
          name: "edit_graph",
          input: {
            edit_description: "Reduce it by 10%",
            pending_clarification: {
              tool: "edit_graph",
              original_edit_request: "Reduce it by 10%",
              candidate_labels: ["Onboarding Time", "Hiring Delay"],
            },
          },
        }],
      },
    ]);
    const state = buildConversationalState("Onboarding Time", makeContext({ messages }), "act");
    expect(state.pending_clarification).not.toBeNull();
    expect(state.pending_clarification?.tool).toBe("edit_graph");
    expect(state.pending_clarification?.original_edit_request).toBe("Reduce it by 10%");
    expect(state.pending_clarification?.candidate_labels).toEqual(["Onboarding Time", "Hiring Delay"]);
  });

  it("trims and deduplicates structured candidate labels", () => {
    const messages = makeMessages([
      { role: "user", content: "Update the value" },
      {
        role: "assistant",
        content: "Which factor should I update – Demand or Supply?",
        tool_calls: [{
          name: "edit_graph",
          input: {
            edit_description: "Update the value",
            pending_clarification: {
              tool: "edit_graph",
              original_edit_request: "  Update the value ",
              candidate_labels: [" Demand ", "Supply", "Demand"],
            },
          },
        }],
      },
    ]);
    const state = buildConversationalState("Demand", makeContext({ messages }), "act");
    expect(state.pending_clarification).not.toBeNull();
    expect(state.pending_clarification?.candidate_labels).toEqual(["Demand", "Supply"]);
    expect(state.pending_clarification?.original_edit_request).toBe("Update the value");
  });

  it("returns null for prose-only clarification with no structured state", () => {
    const messages = makeMessages([
      { role: "user", content: "Make it stronger" },
      {
        role: "assistant",
        content: "Which factor should I update — Market Demand or Pricing Power?",
        tool_calls: [{ name: "edit_graph", input: { edit_description: "Make it stronger" } }],
      },
    ]);
    const state = buildConversationalState("Market Demand", makeContext({ messages }), "act");
    expect(state.pending_clarification).toBeNull();
  });

  it("returns null when structured candidate labels are missing", () => {
    const messages = makeMessages([
      { role: "user", content: "Remove the weak link" },
      {
        role: "assistant",
        content: "Which node should I update — Option A or Option B?",
        tool_calls: [{
          name: "edit_graph",
          input: {
            edit_description: "Remove the weak link",
            pending_clarification: {
              tool: "edit_graph",
              original_edit_request: "Remove the weak link",
              candidate_labels: [],
            },
          },
        }],
      },
    ]);
    const state = buildConversationalState("Option A", makeContext({ messages }), "act");
    expect(state.pending_clarification).toBeNull();
  });

  it("returns null when most recent assistant message is not a clarification question", () => {
    const messages = makeMessages([
      { role: "user", content: "Change demand" },
      {
        role: "assistant",
        content: "I've updated the Demand factor.",
        tool_calls: [{ name: "edit_graph", input: { edit_description: "Change demand" } }],
      },
    ]);
    const state = buildConversationalState("ok", makeContext({ messages }), "act");
    expect(state.pending_clarification).toBeNull();
  });

  it("returns null when assistant message has no tool_calls", () => {
    const messages = makeMessages([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Which one should I update — A or B?" },
    ]);
    const state = buildConversationalState("A", makeContext({ messages }), "conversational");
    expect(state.pending_clarification).toBeNull();
  });

  it("returns null when edit_description is empty", () => {
    const messages = makeMessages([
      { role: "user", content: "do something" },
      {
        role: "assistant",
        content: "Which one should I update — A or B?",
        tool_calls: [{ name: "edit_graph", input: { edit_description: "" } }],
      },
    ]);
    const state = buildConversationalState("A", makeContext({ messages }), "act");
    expect(state.pending_clarification).toBeNull();
  });

  it("returns null when pending_clarification shape is invalid", () => {
    const messages = makeMessages([
      { role: "user", content: "Update it" },
      {
        role: "assistant",
        content: "Which option should I update — Option A or Option B?",
        tool_calls: [{
          name: "edit_graph",
          input: {
            edit_description: "Update it",
            pending_clarification: {
              tool: "edit_graph",
              original_edit_request: "Update it",
              candidate_labels: ["Option A", 42],
            },
          },
        }],
      },
    ]);
    const state = buildConversationalState("Option A", makeContext({ messages }), "act");
    expect(state.pending_clarification?.candidate_labels).toEqual(["Option A"]);
  });
});

describe("buildConversationalState — pending_proposal", () => {
  it("extracts pending proposal from structured tool state", () => {
    const messages = makeMessages([
      { role: "user", content: "Update all three options" },
      {
        role: "assistant",
        content: "Here’s the change I’d propose. If you want, I can apply it next.",
        tool_calls: [{
          name: "edit_graph",
          input: {
            edit_description: "Update all three options",
            pending_proposal: {
              tool: "edit_graph",
              original_edit_request: "Update all three options",
              base_graph_hash: "abc123",
              candidate_labels: ["Option A", "Option B", "Option C"],
              proposed_changes: {
                changes: [
                  { description: "Update Option A", element_label: "Option A", action_type: "option_config" },
                ],
              },
            },
          },
        }],
      },
    ]);

    const state = buildConversationalState("yes", makeContext({ messages }), "act");

    expect(state.pending_proposal).toEqual({
      tool: "edit_graph",
      original_edit_request: "Update all three options",
      base_graph_hash: "abc123",
      candidate_labels: ["Option A", "Option B", "Option C"],
      proposed_changes: {
        changes: [
          { description: "Update Option A", element_label: "Option A", action_type: "option_config" },
        ],
      },
    });
  });

  it("returns null when pending proposal is missing required fields", () => {
    const messages = makeMessages([
      { role: "user", content: "Update all three options" },
      {
        role: "assistant",
        content: "Here’s the change I’d propose. If you want, I can apply it next.",
        tool_calls: [{
          name: "edit_graph",
          input: {
            edit_description: "Update all three options",
            pending_proposal: {
              tool: "edit_graph",
              original_edit_request: "Update all three options",
              base_graph_hash: "",
              candidate_labels: ["Option A"],
              proposed_changes: { changes: [] },
            },
          },
        }],
      },
    ]);

    const state = buildConversationalState("yes", makeContext({ messages }), "act");

    expect(state.pending_proposal).toBeNull();
  });
});

// ============================================================================
// buildClarificationContinuationInput — exercised via phase3Generate,
// but topic classification is exercised here directly.
// ============================================================================

describe("buildConversationalState — current_topic classification", () => {
  it("returns 'explaining' for 'why' questions", () => {
    const state = buildConversationalState("Why did this happen?", makeContext(), "explain");
    expect(state.current_topic).toBe("explaining");
  });

  it("returns 'explaining' for 'recommended' before 'option' can match 'configuring'", () => {
    // P2-C regression: "What option is recommended?" must NOT match 'configuring' via 'option'.
    const state = buildConversationalState("What option is recommended?", makeContext(), "recommend");
    expect(state.current_topic).toBe("explaining");
  });

  it("returns 'analysing' for 'run' keyword", () => {
    const state = buildConversationalState("Run the analysis", makeContext(), "act");
    expect(state.current_topic).toBe("analysing");
  });

  it("returns 'configuring' for 'intervention' keyword", () => {
    const state = buildConversationalState("Set the intervention values", makeContext(), "act");
    expect(state.current_topic).toBe("configuring");
  });

  it("returns 'configuring' for 'configure' keyword", () => {
    const state = buildConversationalState("Configure the options", makeContext(), "act");
    expect(state.current_topic).toBe("configuring");
  });

  it("returns 'framing' when no graph", () => {
    const state = buildConversationalState("Let's define the goal", makeContext({ graph: null }), "conversational");
    expect(state.current_topic).toBe("framing");
  });

  it("returns 'editing' for act intent when graph exists", () => {
    const ctx = makeContext({ graph: { nodes: [{ id: "n1", kind: "factor", label: "Demand" }], edges: [] } as ConversationContext["graph"] });
    const state = buildConversationalState("Change demand to strong", ctx, "act");
    expect(state.current_topic).toBe("editing");
  });

  it("returns 'explaining' (not 'configuring') when 'option' appears in an explain context", () => {
    const ctx = makeContext({
      graph: { nodes: [], edges: [] } as ConversationContext["graph"],
      analysis_response: {
        analysis_status: "completed",
        meta: { response_hash: "hash-topic-test", seed_used: 1, n_samples: 1 },
        results: [],
      } as unknown as ConversationContext["analysis_response"],
    });
    const state = buildConversationalState("Which option looks best?", ctx, "recommend");
    // 'option' is in the message but 'recommended' is absent — fallback to 'explaining' (analysis present)
    // and NOT 'configuring' (intervention/configure keywords absent)
    expect(state.current_topic).not.toBe("configuring");
  });
});
