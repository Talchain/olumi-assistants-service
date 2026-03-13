/**
 * Prompt Assembly Inspection
 *
 * Creates a realistic enrichedContext and runs it through the full prompt
 * assembly pipeline, writing the complete assembled prompt to
 * assembled-prompt-inspection.txt for analysis.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue(
    "[ZONE1: Orchestrator system prompt — cf-v4.0.5]\nYou are a decision coaching engine. Help the user explore, model, and evaluate their decision."
  ),
  getSystemPromptMeta: vi.fn().mockReturnValue({
    taskId: "orchestrator",
    source: "default",
    prompt_version: "default:orchestrator",
    prompt_hash: "inspection-test-hash",
    instance_id: "inspection-instance",
  }),
}));

import { assembleV2SystemPrompt } from "../../src/orchestrator/pipeline/phase3-llm/prompt-assembler.js";
import type { EnrichedContext } from "../../src/orchestrator/pipeline/types.js";
import type { GraphV3Compact } from "../../src/orchestrator/context/graph-compact.js";
import type { AnalysisResponseSummary } from "../../src/orchestrator/context/analysis-compact.js";

// ============================================================================
// Realistic Fixtures
// ============================================================================

function makeRealisticGraph(): GraphV3Compact {
  return {
    _node_count: 12,
    _edge_count: 13,
    nodes: [
      { id: "goal_1", kind: "goal", label: "Maximise ROI within 18 months" },
      { id: "opt_lead", kind: "option", label: "Hire Tech Lead", intervention_summary: "sets Hiring Cost=120000, Team Velocity=0.8" },
      { id: "opt_devs", kind: "option", label: "Hire Two Developers", intervention_summary: "sets Hiring Cost=160000, Team Velocity=0.65" },
      { id: "opt_contract", kind: "option", label: "Outsource to Contractor", intervention_summary: "sets Hiring Cost=90000, Team Velocity=0.5" },
      { id: "opt_hybrid", kind: "option", label: "Lead + Junior Dev", intervention_summary: "sets Hiring Cost=150000, Team Velocity=0.75" },
      { id: "f_cost", kind: "factor", label: "Hiring Cost", type: "external", category: "financial", value: 120000, source: "user" as const },
      { id: "f_velocity", kind: "factor", label: "Team Velocity", type: "external", category: "operational", value: 0.7, source: "assumption" as const },
      { id: "f_churn", kind: "factor", label: "Churn Risk", type: "external", category: "risk", value: 0.15, source: "assumption" as const },
      { id: "f_time", kind: "factor", label: "Time to Market", type: "external", category: "operational", value: 6, source: "user" as const },
      { id: "out_revenue", kind: "outcome", label: "Revenue Growth" },
      { id: "risk_delay", kind: "risk", label: "Project Delay Risk" },
      { id: "con_budget", kind: "constraint", label: "Budget < £200k" },
    ],
    edges: [
      { from: "f_cost", to: "out_revenue", strength: -0.45, exists: 0.9, plain_interpretation: "Hiring Cost moderately decreases Revenue Growth" },
      { from: "f_velocity", to: "out_revenue", strength: 0.72, exists: 0.85, plain_interpretation: "Team Velocity strongly increases Revenue Growth (high confidence)" },
      { from: "f_churn", to: "out_revenue", strength: -0.35, exists: 0.7, plain_interpretation: "Churn Risk weakly decreases Revenue Growth (moderate confidence)" },
      { from: "f_churn", to: "risk_delay", strength: 0.55, exists: 0.75, plain_interpretation: "Churn Risk moderately increases Project Delay Risk" },
      { from: "f_time", to: "out_revenue", strength: -0.60, exists: 0.80, plain_interpretation: "Time to Market moderately decreases Revenue Growth" },
      { from: "f_velocity", to: "f_time", strength: -0.50, exists: 0.78, plain_interpretation: "Team Velocity moderately decreases Time to Market" },
      { from: "f_cost", to: "con_budget", strength: 0.90, exists: 0.95 },
      { from: "opt_lead", to: "f_cost", strength: 0.0, exists: 1.0 },
      { from: "opt_lead", to: "f_velocity", strength: 0.0, exists: 1.0 },
      { from: "opt_devs", to: "f_cost", strength: 0.0, exists: 1.0 },
      { from: "opt_devs", to: "f_velocity", strength: 0.0, exists: 1.0 },
      { from: "opt_contract", to: "f_cost", strength: 0.0, exists: 1.0 },
      { from: "opt_hybrid", to: "f_cost", strength: 0.0, exists: 1.0 },
    ],
  };
}

function makeRealisticAnalysis(): AnalysisResponseSummary {
  return {
    winner: { option_id: "opt_lead", option_label: "Hire Tech Lead", win_probability: 0.42 },
    options: [
      { option_id: "opt_lead", option_label: "Hire Tech Lead", win_probability: 0.42, outcome_mean: 185000, outcome_p10: 120000, outcome_p90: 260000 },
      { option_id: "opt_hybrid", option_label: "Lead + Junior Dev", win_probability: 0.28, outcome_mean: 165000, outcome_p10: 95000, outcome_p90: 240000 },
      { option_id: "opt_devs", option_label: "Hire Two Developers", win_probability: 0.18, outcome_mean: 145000, outcome_p10: 80000, outcome_p90: 215000 },
      { option_id: "opt_contract", option_label: "Outsource to Contractor", win_probability: 0.12, outcome_mean: 110000, outcome_p10: 50000, outcome_p90: 180000 },
    ],
    option_results: [
      { option_id: "opt_lead", label: "Hire Tech Lead", win_probability: 0.42, mean: 185000, p10: 120000, p90: 260000 },
      { option_id: "opt_hybrid", label: "Lead + Junior Dev", win_probability: 0.28, mean: 165000, p10: 95000, p90: 240000 },
      { option_id: "opt_devs", label: "Hire Two Developers", win_probability: 0.18, mean: 145000, p10: 80000, p90: 215000 },
      { option_id: "opt_contract", label: "Outsource to Contractor", win_probability: 0.12, mean: 110000, p10: 50000, p90: 180000 },
    ],
    top_drivers: [
      { factor_id: "f_velocity", factor_label: "Team Velocity", sensitivity: 0.85, direction: "positive" as const },
      { factor_id: "f_time", factor_label: "Time to Market", sensitivity: -0.72, direction: "negative" as const },
      { factor_id: "f_cost", factor_label: "Hiring Cost", sensitivity: -0.55, direction: "negative" as const },
      { factor_id: "f_churn", factor_label: "Churn Risk", sensitivity: -0.40, direction: "negative" as const },
    ],
    robustness_level: "moderate",
    fragile_edge_count: 2,
    top_fragile_edges: [
      { from_label: "Team Velocity", to_label: "Revenue Growth" },
      { from_label: "Time to Market", to_label: "Revenue Growth" },
    ],
    constraint_tensions: ["Budget < £200k tension: Hire Two Developers approaches constraint limit"],
    flip_thresholds: [
      { factor_id: "f_velocity", factor_label: "Team Velocity", current_value: 0.7, flip_value: 0.55, unit: undefined },
      { factor_id: "f_churn", factor_label: "Churn Risk", current_value: 0.15, flip_value: 0.35, unit: undefined },
    ],
    analysis_status: "current",
  };
}

function makeRealisticEnrichedContext(): EnrichedContext {
  const graph = makeRealisticGraph();
  const analysis = makeRealisticAnalysis();

  return {
    graph: null, // Raw graph not used by prompt assembler
    analysis: null,
    framing: {
      stage: "evaluate",
      goal: "Maximise ROI within 18 months",
      constraints: ["Budget < £200k", "Must ship AI features within 6 months"],
      options: ["Hire Tech Lead", "Hire Two Developers", "Outsource to Contractor", "Lead + Junior Dev"],
    },
    conversation_history: [],
    selected_elements: [],
    stage_indicator: { stage: "evaluate", substate: "comparing_options", confidence: "high", source: "analysis_present" },
    intent_classification: "explain",
    decision_archetype: { type: "hiring", confidence: "high", evidence: "hire, tech lead, developers" },
    progress_markers: ["ran_analysis"],
    stuck: { detected: false, rescue_routes: [] },
    conversational_state: {
      active_entities: ["f_velocity", "opt_lead"],
      stated_constraints: ["Budget < £200k"],
      current_topic: { topic: "option_comparison" },
      last_failed_action: null,
    },
    dsk: { claims: [], triggers: [], techniques: [], version_hash: null },
    user_profile: { coaching_style: "socratic", calibration_tendency: "unknown", challenge_tolerance: "medium" },
    scenario_id: "inspection-scenario",
    turn_id: "inspection-turn",
    graph_compact: graph,
    analysis_response: analysis,
    messages: [
      { role: "user", content: "We need to ship AI features within 6 months, budget under £200k, options are hire a tech lead or two developers" },
      { role: "assistant", content: "I've drafted a decision model with 4 options and 4 key factors. Shall I run the analysis?" },
      { role: "user", content: "Yes, run the analysis" },
      { role: "assistant", content: "The analysis is complete. Hire Tech Lead wins at 42% probability, driven primarily by Team Velocity." },
      { role: "user", content: "Why is the tech lead option winning?" },
    ],
    event_log_summary: "Turn 1: drafted graph (4 options, 4 factors). Turn 2: ran analysis. Turn 3: explaining results.",
    context_hash: "abc123def456",
    decision_continuity: {
      goal: "Maximise ROI within 18 months",
      options: ["Hire Tech Lead", "Hire Two Developers", "Outsource to Contractor", "Lead + Junior Dev"],
      constraints: ["Budget < £200k", "Must ship AI features within 6 months"],
      stage: "evaluate",
      graph_version: "v3-abc",
      analysis_status: "current",
      top_drivers: ["Team Velocity", "Time to Market", "Hiring Cost"],
      top_uncertainties: ["Churn Risk"],
      last_patch_summary: null,
      active_proposal: null,
      assumption_count: 2,
    },
    referenced_entities: [
      {
        id: "f_velocity",
        label: "Team Velocity",
        kind: "factor",
        category: "operational",
        value: 0.7,
        source: "assumption",
        edges: [
          { connected_label: "Revenue Growth", strength: 0.72 },
          { connected_label: "Time to Market", strength: -0.50 },
        ],
      },
    ],
  } as unknown as EnrichedContext;
}

// ============================================================================
// Test + Inspection
// ============================================================================

let capturedPrompt = "";

describe("Prompt Assembly Inspection", () => {
  it("assembles a complete Zone 1 + Zone 2 prompt from realistic context", async () => {
    const ctx = makeRealisticEnrichedContext();
    const prompt = await assembleV2SystemPrompt(ctx);

    capturedPrompt = prompt;

    // Basic structure assertions
    expect(prompt).toContain("[ZONE1:");
    expect(prompt).toContain("<decision_state>");
    expect(prompt).toContain("</decision_state>");
    expect(prompt).toContain("Graph (");
    expect(prompt).toContain("Analysis:");
    expect(prompt).toContain("<referenced_entity>");
    expect(prompt).toContain("User intent:");
    expect(prompt).toContain("Decision archetype:");

    // Token estimation (4 chars per token)
    const estimatedTokens = Math.ceil(prompt.length / 4);
    expect(estimatedTokens).toBeGreaterThan(0);
    expect(estimatedTokens).toBeLessThan(10000); // Should be well under budget
  });

  afterAll(() => {
    if (capturedPrompt) {
      const outPath = path.resolve(process.cwd(), "assembled-prompt-inspection.txt");

      const charCount = capturedPrompt.length;
      const estimatedTokens = Math.ceil(charCount / 4);
      const lines = capturedPrompt.split("\n");

      const header = [
        "=" .repeat(80),
        "ASSEMBLED PROMPT INSPECTION",
        "=" .repeat(80),
        "",
        `Total characters: ${charCount}`,
        `Estimated tokens (4 chars/token): ${estimatedTokens}`,
        `Total lines: ${lines.length}`,
        "",
        "Zone 2 blocks detected:",
      ];

      // Detect blocks
      const blocks: string[] = [];
      if (capturedPrompt.includes("<decision_state>")) blocks.push("  - <decision_state> (decision continuity)");
      if (capturedPrompt.includes("Stage confidence:")) blocks.push("  - Stage confidence");
      if (capturedPrompt.includes("Current stage:")) blocks.push("  - Current stage (standalone framing)");
      if (capturedPrompt.includes("Decision goal:")) blocks.push("  - Decision goal (standalone framing)");
      if (capturedPrompt.includes("Graph (")) blocks.push("  - Compact graph");
      if (capturedPrompt.includes("Analysis:")) blocks.push("  - Compact analysis");
      if (capturedPrompt.includes("Option comparison:")) blocks.push("    - Option comparison (within analysis)");
      if (capturedPrompt.includes("Top drivers:")) blocks.push("    - Top drivers (within analysis)");
      if (capturedPrompt.includes("Fragile edge")) blocks.push("    - Fragile edges (within analysis)");
      if (capturedPrompt.includes("Constraint tensions:")) blocks.push("    - Constraint tensions (within analysis)");
      if (capturedPrompt.includes("Flip thresholds:")) blocks.push("    - Flip thresholds (within analysis)");
      if (capturedPrompt.includes("<pending_changes>")) blocks.push("  - Pending changes");
      if (capturedPrompt.includes("<referenced_entity>")) blocks.push("  - Referenced entity");
      if (capturedPrompt.includes("Decision history:")) blocks.push("  - Event log summary");
      if (capturedPrompt.includes("User intent:")) blocks.push("  - User intent");
      if (capturedPrompt.includes("Decision archetype:")) blocks.push("  - Decision archetype");
      if (capturedPrompt.includes("User appears stuck")) blocks.push("  - Stuck detection");
      if (capturedPrompt.includes("<!-- DSK")) blocks.push("  - DSK placeholder");
      if (capturedPrompt.includes("<!-- Specialist")) blocks.push("  - Specialist advice placeholder");

      header.push(...blocks);
      header.push("");
      header.push("=" .repeat(80));
      header.push("FULL ASSEMBLED PROMPT");
      header.push("=" .repeat(80));
      header.push("");

      const content = [...header, capturedPrompt].join("\n");
      fs.writeFileSync(outPath, content, "utf-8");
    }
  });
});
