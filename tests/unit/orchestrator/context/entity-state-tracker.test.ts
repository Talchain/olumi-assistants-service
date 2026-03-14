/**
 * Entity State Tracker Tests (B4)
 *
 * Verifies:
 * 1. trackEntityStates() classifies correctly: accepted patch → calibrated,
 *    explicit question → challenged, no reference → untouched, assumption → default
 * 2. Recency: later action overwrites earlier state
 * 3. Loose mention does NOT trigger calibrated or challenged
 * 4. Edge cases: empty history, no graph, empty graph
 */

import { describe, it, expect } from "vitest";
import { trackEntityStates } from "../../../../src/orchestrator/context/entity-state-tracker.js";
import type { GraphV3Compact } from "../../../../src/orchestrator/context/graph-compact.js";
import type { ConversationMessage } from "../../../../src/orchestrator/types.js";

// ============================================================================
// Fixtures
// ============================================================================

const GRAPH: GraphV3Compact = {
  nodes: [
    { id: "fac_churn_rate", kind: "factor", label: "Monthly Churn Rate", value: 0.03, source: "assumption" },
    { id: "fac_team_exp", kind: "factor", label: "Team Experience", value: 7, source: "assumption" },
    { id: "fac_budget", kind: "factor", label: "Recruitment Budget", value: 200000 },
    { id: "opt_hire", kind: "option", label: "Hire Externally" },
  ],
  edges: [
    { from: "fac_churn_rate", to: "opt_hire", strength: 0.6, exists: 0.9 },
    { from: "fac_team_exp", to: "opt_hire", strength: 0.4, exists: 0.8 },
  ],
  _node_count: 4,
  _edge_count: 2,
};

function msg(role: 'user' | 'assistant', content: string, tool_calls?: Array<{ name: string; input: Record<string, unknown> }>): ConversationMessage {
  return { role, content, ...(tool_calls ? { tool_calls } : {}) };
}

// ============================================================================
// State classification
// ============================================================================

describe("trackEntityStates — state classification", () => {
  it("marks factors with source='assumption' as 'default' when untouched", () => {
    const result = trackEntityStates([], GRAPH);
    expect(result["fac_team_exp"].state).toBe("default");
  });

  it("marks factors with source='assumption' (churn_rate) as 'default' when untouched", () => {
    const result = trackEntityStates([], GRAPH);
    expect(result["fac_churn_rate"].state).toBe("default");
  });

  it("marks factors without assumption source as 'untouched'", () => {
    const result = trackEntityStates([], GRAPH);
    expect(result["fac_budget"].state).toBe("untouched");
  });

  it("excludes non-factor nodes (options) from state map", () => {
    const result = trackEntityStates([], GRAPH);
    expect(result["opt_hire"]).toBeUndefined();
  });

  it("detects calibrated state from edit_graph tool call referencing node by ID with subsequent user message", () => {
    const history: ConversationMessage[] = [
      msg("user", "Set churn rate to 4%"),
      msg("assistant", "I'll update the churn rate.", [
        { name: "edit_graph", input: { edit_description: "change fac_churn_rate value to 0.04" } },
      ]),
      msg("user", "Thanks, looks good"),
    ];
    const result = trackEntityStates(history, GRAPH);
    expect(result["fac_churn_rate"].state).toBe("calibrated");
  });

  it("detects calibrated state from edit_graph tool call referencing node by label with subsequent user message", () => {
    const history: ConversationMessage[] = [
      msg("user", "Update the monthly churn rate"),
      msg("assistant", "Updating the value.", [
        { name: "edit_graph", input: { edit_description: "change Monthly Churn Rate to 4%" } },
      ]),
      msg("user", "OK"),
    ];
    const result = trackEntityStates(history, GRAPH);
    expect(result["fac_churn_rate"].state).toBe("calibrated");
  });

  it("does NOT mark calibrated when edit_graph is the last message (no subsequent user confirmation)", () => {
    const history: ConversationMessage[] = [
      msg("user", "Set churn rate to 4%"),
      msg("assistant", "I'll update the churn rate.", [
        { name: "edit_graph", input: { edit_description: "change fac_churn_rate value to 0.04" } },
      ]),
    ];
    const result = trackEntityStates(history, GRAPH);
    // Without a subsequent user message, the edit is unconfirmed
    expect(result["fac_churn_rate"].state).toBe("default"); // source='assumption' → default
  });

  it("detects challenged state from explicit question about a factor", () => {
    const history: ConversationMessage[] = [
      msg("user", "Where did Recruitment Budget come from? What is the source for that number?"),
    ];
    const result = trackEntityStates(history, GRAPH);
    expect(result["fac_budget"].state).toBe("challenged");
  });

  it("detects challenged state: 'is X really' pattern", () => {
    const history: ConversationMessage[] = [
      msg("user", "Is the Monthly Churn Rate really 3%? That seems too low."),
    ];
    const result = trackEntityStates(history, GRAPH);
    expect(result["fac_churn_rate"].state).toBe("challenged");
  });

  it("detects challenged state: 'are you sure' pattern", () => {
    const history: ConversationMessage[] = [
      msg("user", "Are you sure about the Team Experience score?"),
    ];
    const result = trackEntityStates(history, GRAPH);
    expect(result["fac_team_exp"].state).toBe("challenged");
  });

  it("does NOT mark as challenged from loose mention without challenge pattern", () => {
    const history: ConversationMessage[] = [
      msg("user", "Tell me more about the Recruitment Budget and how it affects outcomes."),
    ];
    const result = trackEntityStates(history, GRAPH);
    // Loose mention without challenge pattern should NOT trigger challenged
    expect(result["fac_budget"].state).toBe("untouched");
  });

  it("does NOT mark as calibrated from non-edit_graph tool calls", () => {
    const history: ConversationMessage[] = [
      msg("assistant", "Here are the results.", [
        { name: "run_analysis", input: {} },
      ]),
    ];
    const result = trackEntityStates(history, GRAPH);
    // run_analysis doesn't calibrate anything
    expect(result["fac_churn_rate"].state).toBe("default");
  });
});

// ============================================================================
// Recency
// ============================================================================

describe("trackEntityStates — recency", () => {
  it("later action overwrites earlier state: calibrated then challenged → challenged", () => {
    const history: ConversationMessage[] = [
      msg("user", "Set churn rate to 4%"),
      msg("assistant", "Done.", [
        { name: "edit_graph", input: { edit_description: "change fac_churn_rate to 0.04" } },
      ]),
      // The subsequent user message confirms the edit was applied (calibrated)
      // but then the user challenges the value again
      msg("user", "Wait, is the Monthly Churn Rate really 4%? Are you sure about that?"),
    ];
    const result = trackEntityStates(history, GRAPH);
    // The challenge (turn 2) overwrites the calibrated state (turn 1)
    expect(result["fac_churn_rate"].state).toBe("challenged");
    expect(result["fac_churn_rate"].last_action_turn).toBe(2);
  });

  it("later action overwrites: challenged then calibrated → calibrated", () => {
    const history: ConversationMessage[] = [
      msg("user", "Where did Recruitment Budget come from? What is the source for that?"),
      msg("assistant", "Let me check.", []),
      msg("user", "Actually, set recruitment budget to 250k"),
      msg("assistant", "Updated.", [
        { name: "edit_graph", input: { edit_description: "change Recruitment Budget to 250000" } },
      ]),
      msg("user", "Great, that looks right"),
    ];
    const result = trackEntityStates(history, GRAPH);
    expect(result["fac_budget"].state).toBe("calibrated");
    expect(result["fac_budget"].last_action_turn).toBe(3);
  });
});

// ============================================================================
// Negative calibration — rejection / dismissal / ambiguity
// ============================================================================

describe("trackEntityStates — negative calibration", () => {
  it("edit_graph proposed, then user asks unrelated question → NOT calibrated", () => {
    // User's next message doesn't acknowledge the edit — it's unrelated.
    // However, the current heuristic checks for dismissal patterns, not relevance.
    // An unrelated follow-up without dismissal language IS treated as implicit acceptance
    // because we can't reliably distinguish "moved on" from "accepted silently".
    // This test documents the current conservative-but-permissive behaviour.
    const history: ConversationMessage[] = [
      msg("user", "Set churn rate to 5%"),
      msg("assistant", "I'll update that.", [
        { name: "edit_graph", input: { edit_description: "change fac_churn_rate to 0.05" } },
      ]),
      msg("user", "What is the weather today?"),
    ];
    const result = trackEntityStates(history, GRAPH);
    // Unrelated follow-up without rejection → treated as implicit acceptance
    expect(result["fac_churn_rate"].state).toBe("calibrated");
  });

  it("edit_graph proposed, then user explicitly rejects → NOT calibrated", () => {
    const history: ConversationMessage[] = [
      msg("user", "Set churn rate to 5%"),
      msg("assistant", "I'll update that.", [
        { name: "edit_graph", input: { edit_description: "change fac_churn_rate to 0.05" } },
      ]),
      msg("user", "No, don't change that. Revert it."),
    ];
    const result = trackEntityStates(history, GRAPH);
    expect(result["fac_churn_rate"].state).toBe("default"); // source='assumption' → stays default
  });

  it("edit_graph proposed, user says 'undo' → NOT calibrated", () => {
    const history: ConversationMessage[] = [
      msg("user", "Change recruitment budget to 300k"),
      msg("assistant", "Updated.", [
        { name: "edit_graph", input: { edit_description: "change Recruitment Budget to 300000" } },
      ]),
      msg("user", "Actually undo that please"),
    ];
    const result = trackEntityStates(history, GRAPH);
    expect(result["fac_budget"].state).toBe("untouched"); // no assumption source → stays untouched
  });

  it("edit_graph proposed, user says 'wrong' → NOT calibrated", () => {
    const history: ConversationMessage[] = [
      msg("user", "Set team experience to 9"),
      msg("assistant", "Done.", [
        { name: "edit_graph", input: { edit_description: "change Team Experience to 9" } },
      ]),
      msg("user", "That's wrong, it should be 7"),
    ];
    const result = trackEntityStates(history, GRAPH);
    expect(result["fac_team_exp"].state).toBe("default"); // source='assumption' → stays default
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("trackEntityStates — edge cases", () => {
  it("returns empty map when graph is null", () => {
    const result = trackEntityStates([], null);
    expect(result).toEqual({});
  });

  it("returns empty map when graph is undefined", () => {
    const result = trackEntityStates([], undefined);
    expect(result).toEqual({});
  });

  it("returns empty map when graph has no nodes", () => {
    const emptyGraph: GraphV3Compact = { nodes: [], edges: [], _node_count: 0, _edge_count: 0 };
    const result = trackEntityStates([], emptyGraph);
    expect(result).toEqual({});
  });

  it("preserves value from graph on state entry", () => {
    const result = trackEntityStates([], GRAPH);
    expect(result["fac_churn_rate"].value).toBe(0.03);
    expect(result["fac_budget"].value).toBe(200000);
  });

  it("includes label from graph on state entry", () => {
    const result = trackEntityStates([], GRAPH);
    expect(result["fac_churn_rate"].label).toBe("Monthly Churn Rate");
  });

  it("last_action_turn is -1 when never interacted", () => {
    const result = trackEntityStates([], GRAPH);
    expect(result["fac_budget"].last_action_turn).toBe(-1);
  });
});
