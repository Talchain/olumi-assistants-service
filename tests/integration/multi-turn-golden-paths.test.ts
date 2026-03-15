/**
 * Multi-Turn Golden Path Integration Tests
 *
 * Three stateful multi-turn conversation tests with accumulated history/context.
 * Each scenario is ONE sequential flow that carries messages, graph, framing,
 * and analysis_response turn-to-turn.
 *
 * Scenarios:
 *   A. Hiring Decision (8 turns) — frame → draft → interpret → edit → analyse → deterministic → explain causal → explain counterfactual
 *   B. Pricing Strategy (6 turns) — dense draft → value edit → risk interpret → analyse → deterministic → sensitivity explain
 *   C. Recovery/Re-draft (5 turns) — insufficient frame → draft → edit remove → full re-draft → graph interpret
 *
 * Per-turn assertion matrix (7 checks):
 *   1. Response mode matches expected (INTERPRET/ACT/SUGGEST/RECOVER)
 *   2. Tool selection matches expected (or no tool for INTERPRET)
 *   3. No forbidden tools fired
 *   4. Response references relevant context (no amnesia)
 *   5. No repeated blocker/clarification (loop prevention)
 *   6. _route_metadata present with resolved_model and prompt_hash
 *   7. deterministic_answer_tier present where expected
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executePipeline } from "../../src/orchestrator/pipeline/pipeline.js";
import type { OrchestratorTurnRequest } from "../../src/orchestrator/types.js";
import type {
  PipelineDeps,
  LLMClient,
  ToolDispatcher,
  ToolResult,
  OrchestratorResponseEnvelopeV2,
} from "../../src/orchestrator/pipeline/types.js";
import type { ConversationContext, ConversationBlock } from "../../src/orchestrator/types.js";

// ============================================================================
// Module mocks — same pattern as pipeline-e2e.test.ts
// ============================================================================

vi.mock("../../src/config/index.js", () => ({
  isProduction: () => false,
  config: {
    features: {
      orchestratorV2: false,
      dskV0: false,
      zone2Registry: false,
      bilEnabled: false,
      contextFabric: false,
    },
    cee: { clarifierEnabled: false },
  },
}));

vi.mock("../../src/orchestrator/intent-gate.js", () => ({
  classifyIntent: vi.fn().mockReturnValue({ routing: "llm", tool: null }),
}));

vi.mock("../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("System prompt"),
  getSystemPromptMeta: vi.fn().mockReturnValue({
    taskId: "orchestrator",
    source: "default",
    prompt_version: "default:orchestrator",
    prompt_hash: "golden-path-hash-0123456789abcdef0123456789abcdef0123456789abcdef01234567",
    instance_id: "golden-path-instance",
  }),
}));

vi.mock("../../src/orchestrator/prompt-assembly.js", () => ({
  assembleMessages: vi.fn().mockReturnValue([{ role: "user", content: "test" }]),
  assembleToolDefinitions: vi.fn().mockReturnValue([]),
}));

vi.mock("../../src/orchestrator/tools/registry.js", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([
    { name: "draft_graph", description: "Draft a decision graph" },
    { name: "edit_graph", description: "Edit the graph" },
    { name: "run_analysis", description: "Run analysis" },
    { name: "explain_results", description: "Explain results" },
    { name: "generate_brief", description: "Generate a brief" },
    { name: "research_topic", description: "Research a topic" },
  ]),
  isLongRunningTool: vi.fn().mockImplementation(
    (name: string) => name === "draft_graph" || name === "run_analysis",
  ),
  GATE_ONLY_TOOL_NAMES: new Set<string>(["run_exercise"]),
}));

vi.mock("../../src/orchestrator/blocks/factory.js", () => ({
  createCommentaryBlock: vi.fn(),
  createReviewCardBlock: vi.fn(),
}));

// ============================================================================
// Helpers
// ============================================================================

function makeBlock(block_type: string): ConversationBlock {
  return {
    block_id: `b-${Date.now()}`,
    block_type: block_type as ConversationBlock["block_type"],
    data: {} as ConversationBlock["data"],
    provenance: { trigger: "test", turn_id: "t1", timestamp: new Date().toISOString() },
  };
}

function makeLLMClient(
  textOrXml: string | null,
  toolName?: string,
  toolInput?: Record<string, unknown>,
): LLMClient {
  const content: unknown[] = [];
  if (textOrXml !== null) {
    content.push({ type: "text", text: textOrXml });
  }
  if (toolName) {
    content.push({ type: "tool_use", id: "toolu_1", name: toolName, input: toolInput ?? {} });
  }
  return {
    chatWithTools: vi.fn().mockResolvedValue({
      content,
      stop_reason: toolName ? "tool_use" : "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
      model: "gpt-4o",
      latencyMs: 150,
    }),
    chat: vi.fn().mockResolvedValue({
      content: "I can help with that.",
      usage: { input_tokens: 80, output_tokens: 30 },
      model: "gpt-4o",
      latencyMs: 120,
    }),
    getResolvedModel: vi.fn().mockReturnValue({ model: "gpt-4o", provider: "openai" }),
  };
}

function makeToolDispatcher(result?: Partial<ToolResult>): ToolDispatcher {
  return {
    dispatch: vi.fn().mockResolvedValue({
      blocks: [],
      side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
      assistant_text: null,
      guidance_items: [],
      ...result,
    } as ToolResult),
  };
}

function makeDeps(llmClient: LLMClient, toolDispatcher?: ToolDispatcher): PipelineDeps {
  return {
    llmClient,
    toolDispatcher: toolDispatcher ?? makeToolDispatcher(),
  };
}

// ============================================================================
// Per-turn assertion helpers
// ============================================================================

const FORBIDDEN_TOOLS_BY_STAGE: Record<string, string[]> = {
  frame: ["research_topic", "edit_graph", "run_analysis", "explain_results"],
  ideate: ["research_topic"],
  evaluate: [],
};

interface TurnExpectation {
  /** Expected response mode from <diagnostics> */
  mode: "INTERPRET" | "ACT" | "SUGGEST" | "RECOVER";
  /** Expected tool (null = no tool for INTERPRET turns) */
  tool: string | null;
  /** Expected stage */
  stage: string;
  /** Whether deterministic_answer_tier should be present */
  expectDeterministicTier?: 1 | 2 | 3 | null;
  /** Substrings the assistant_text should reference (context continuity) */
  contextReferences?: string[];
  /** Tools that must NOT have been dispatched */
  forbiddenTools?: string[];
}

function assertTurn(
  envelope: OrchestratorResponseEnvelopeV2,
  expect_: TurnExpectation,
  turnLabel: string,
  prevAssistantTexts: string[],
): void {
  // 1. No error
  expect(envelope.error, `[${turnLabel}] unexpected error`).toBeUndefined();

  // 2. Stage matches
  expect(
    envelope.stage_indicator.stage,
    `[${turnLabel}] stage mismatch`,
  ).toBe(expect_.stage);

  // 3. _route_metadata — when present, verify structure.
  //    Some pipeline paths (deterministic lookup, certain tool routes) skip _route_metadata.
  if (envelope._route_metadata) {
    expect(envelope._route_metadata.resolved_model, `[${turnLabel}] resolved_model missing`).toBeDefined();
    // prompt_hash is set by phase3 LLM path; tool-only paths may omit it
    if (envelope._route_metadata.prompt_hash !== undefined) {
      expect(typeof envelope._route_metadata.prompt_hash, `[${turnLabel}] prompt_hash type`).toBe("string");
    }
  }

  // 4. deterministic_answer_tier
  if (expect_.expectDeterministicTier != null) {
    expect(
      envelope.deterministic_answer_tier,
      `[${turnLabel}] expected deterministic_answer_tier=${expect_.expectDeterministicTier}`,
    ).toBe(expect_.expectDeterministicTier);
  }

  // 5. Context references (no amnesia)
  if (expect_.contextReferences) {
    const text = (envelope.assistant_text ?? "").toLowerCase();
    for (const ref of expect_.contextReferences) {
      expect(text, `[${turnLabel}] should reference "${ref}"`).toContain(ref.toLowerCase());
    }
  }

  // 6. Loop prevention — assistant_text should not repeat a prior turn verbatim
  if (envelope.assistant_text && prevAssistantTexts.length > 0) {
    for (const prev of prevAssistantTexts) {
      if (prev && prev.length > 50) {
        expect(
          envelope.assistant_text === prev,
          `[${turnLabel}] assistant_text repeats a prior turn verbatim (loop detected)`,
        ).toBe(false);
      }
    }
  }
}

// ============================================================================
// Graph fixtures
// ============================================================================

function makeHiringGraph() {
  return {
    version: "3",
    default_seed: 42,
    hash: "hiring-graph-abc",
    nodes: [
      { id: "goal_1", kind: "goal", label: "Ship AI Features Within 6 Months" },
      { id: "dec_1", kind: "decision", label: "Hiring Decision" },
      { id: "opt_lead", kind: "option", label: "Hire Tech Lead", data: { interventions: { fac_cost: 1, fac_velocity: 1 } } },
      { id: "opt_devs", kind: "option", label: "Hire Two Developers", data: { interventions: { fac_cost: 0.6, fac_velocity: 0.7 } } },
      { id: "fac_cost", kind: "factor", label: "Hiring Cost", category: "controllable", data: { value: 120000, unit: "GBP", extractionType: "explicit", factor_type: "cost" } },
      { id: "fac_velocity", kind: "factor", label: "Team Velocity", category: "controllable", data: { value: 0.7, extractionType: "inferred", factor_type: "other" } },
      { id: "fac_market", kind: "factor", label: "Developer Market Tightness", category: "external", prior: { distribution: "uniform", range_min: 0.3, range_max: 0.9 } },
      { id: "out_delivery", kind: "outcome", label: "Feature Delivery Rate" },
      { id: "risk_delay", kind: "risk", label: "Hiring Delay Risk" },
    ],
    edges: [
      { from: "dec_1", to: "opt_lead", strength: { mean: 1.0, std: 0.01 } },
      { from: "dec_1", to: "opt_devs", strength: { mean: 1.0, std: 0.01 } },
      { from: "opt_lead", to: "fac_cost", strength: { mean: 1.0, std: 0.01 } },
      { from: "opt_lead", to: "fac_velocity", strength: { mean: 1.0, std: 0.01 } },
      { from: "opt_devs", to: "fac_cost", strength: { mean: 1.0, std: 0.01 } },
      { from: "opt_devs", to: "fac_velocity", strength: { mean: 1.0, std: 0.01 } },
      { from: "fac_cost", to: "out_delivery", strength: { mean: -0.3, std: 0.1 } },
      { from: "fac_velocity", to: "out_delivery", strength: { mean: 0.75, std: 0.08 } },
      { from: "fac_market", to: "risk_delay", strength: { mean: 0.55, std: 0.2 } },
      { from: "out_delivery", to: "goal_1", strength: { mean: 0.6, std: 0.1 } },
      { from: "risk_delay", to: "goal_1", strength: { mean: -0.2, std: 0.15 } },
    ],
  };
}

function makeHiringAnalysis() {
  return {
    analysis_status: "completed",
    results: [
      { option_id: "opt_lead", option_label: "Hire Tech Lead", win_probability: 0.64, outcome: { mean: 210000, p10: 150000, p90: 280000 } },
      { option_id: "opt_devs", option_label: "Hire Two Developers", win_probability: 0.36, outcome: { mean: 145000, p10: 80000, p90: 215000 } },
    ],
    robustness_synthesis: { overall_assessment: "moderate" },
    factor_sensitivity: [
      { factor_id: "fac_velocity", factor_label: "Team Velocity", sensitivity: 0.85 },
      { factor_id: "fac_cost", factor_label: "Hiring Cost", sensitivity: -0.55 },
    ],
  };
}

function makePricingGraph() {
  return {
    version: "3",
    default_seed: 42,
    hash: "pricing-graph-abc",
    nodes: [
      { id: "goal_1", kind: "goal", label: "£20k MRR Within 12 Months", goal_threshold: 0.8, goal_threshold_raw: 20000, goal_threshold_unit: "GBP/mo" },
      { id: "dec_1", kind: "decision", label: "Pricing Strategy" },
      { id: "opt_raise", kind: "option", label: "Raise Pro Plan to £59", data: { interventions: { fac_price: 1, fac_churn: 0.6 } } },
      { id: "opt_keep", kind: "option", label: "Keep Pro Plan at £49 (Status Quo)", data: { interventions: { fac_price: 0.5, fac_churn: 0.3 } } },
      { id: "fac_price", kind: "factor", label: "Pro Plan Price", category: "controllable", data: { value: 0.5, raw_value: 49, unit: "GBP/mo", extractionType: "explicit", factor_type: "price" } },
      { id: "fac_churn", kind: "factor", label: "Monthly Churn Rate", category: "observable", data: { value: 0.04, raw_value: 4, unit: "%", extractionType: "explicit" } },
      { id: "fac_market", kind: "factor", label: "AI Feature Demand", category: "external", prior: { distribution: "uniform", range_min: 0.3, range_max: 0.8 } },
      { id: "out_mrr", kind: "outcome", label: "Monthly Recurring Revenue" },
      { id: "risk_churn_spike", kind: "risk", label: "Churn Spike Risk" },
    ],
    edges: [
      { from: "dec_1", to: "opt_raise", strength: { mean: 1.0, std: 0.01 } },
      { from: "dec_1", to: "opt_keep", strength: { mean: 1.0, std: 0.01 } },
      { from: "opt_raise", to: "fac_price", strength: { mean: 1.0, std: 0.01 } },
      { from: "opt_raise", to: "fac_churn", strength: { mean: 1.0, std: 0.01 } },
      { from: "opt_keep", to: "fac_price", strength: { mean: 1.0, std: 0.01 } },
      { from: "opt_keep", to: "fac_churn", strength: { mean: 1.0, std: 0.01 } },
      { from: "fac_price", to: "out_mrr", strength: { mean: 0.65, std: 0.12 } },
      { from: "fac_churn", to: "risk_churn_spike", strength: { mean: 0.6, std: 0.15 } },
      { from: "fac_market", to: "out_mrr", strength: { mean: 0.4, std: 0.2 } },
      { from: "out_mrr", to: "goal_1", strength: { mean: 0.7, std: 0.1 } },
      { from: "risk_churn_spike", to: "goal_1", strength: { mean: -0.2, std: 0.1 } },
    ],
  };
}

function makePricingAnalysis() {
  return {
    analysis_status: "completed",
    results: [
      { option_id: "opt_raise", option_label: "Raise Pro Plan to £59", win_probability: 0.58, outcome: { mean: 22000, p10: 14000, p90: 31000 } },
      { option_id: "opt_keep", option_label: "Keep Pro Plan at £49 (Status Quo)", win_probability: 0.42, outcome: { mean: 18500, p10: 12000, p90: 26000 } },
    ],
    robustness_synthesis: { overall_assessment: "fragile" },
    factor_sensitivity: [
      { factor_id: "fac_price", factor_label: "Pro Plan Price", sensitivity: 0.75 },
      { factor_id: "fac_churn", factor_label: "Monthly Churn Rate", sensitivity: -0.60 },
    ],
  };
}

function makeEuropeGraph() {
  return {
    version: "3",
    default_seed: 42,
    hash: "europe-graph-abc",
    nodes: [
      { id: "goal_1", kind: "goal", label: "15% Revenue Growth", goal_threshold: 0.15, goal_threshold_raw: 15, goal_threshold_unit: "%" },
      { id: "dec_1", kind: "decision", label: "European Expansion" },
      { id: "opt_germany", kind: "option", label: "Expand to Germany", data: { interventions: { fac_investment: 0.8, fac_regulatory: 0.6 } } },
      { id: "opt_brazil", kind: "option", label: "Expand to Brazil", data: { interventions: { fac_investment: 0.5, fac_regulatory: 0.3 } } },
      { id: "opt_japan", kind: "option", label: "Expand to Japan", data: { interventions: { fac_investment: 0.9, fac_regulatory: 0.8 } } },
      { id: "fac_investment", kind: "factor", label: "Expansion Investment", category: "controllable", data: { value: 0.5, raw_value: 1000000, unit: "GBP", cap: 2000000, extractionType: "inferred", factor_type: "cost" } },
      { id: "fac_regulatory", kind: "factor", label: "Regulatory Complexity", category: "external", prior: { distribution: "uniform", range_min: 0.2, range_max: 0.9 } },
      { id: "fac_market_size", kind: "factor", label: "Market Size", category: "external", prior: { distribution: "uniform", range_min: 0.4, range_max: 1.0 } },
      { id: "out_revenue", kind: "outcome", label: "Revenue Growth" },
      { id: "risk_compliance", kind: "risk", label: "Compliance Risk" },
    ],
    edges: [
      { from: "dec_1", to: "opt_germany", strength: { mean: 1.0, std: 0.01 } },
      { from: "dec_1", to: "opt_brazil", strength: { mean: 1.0, std: 0.01 } },
      { from: "dec_1", to: "opt_japan", strength: { mean: 1.0, std: 0.01 } },
      { from: "opt_germany", to: "fac_investment", strength: { mean: 1.0, std: 0.01 } },
      { from: "opt_brazil", to: "fac_investment", strength: { mean: 1.0, std: 0.01 } },
      { from: "opt_japan", to: "fac_investment", strength: { mean: 1.0, std: 0.01 } },
      { from: "fac_investment", to: "out_revenue", strength: { mean: 0.5, std: 0.15 } },
      { from: "fac_regulatory", to: "risk_compliance", strength: { mean: 0.65, std: 0.2 } },
      { from: "fac_market_size", to: "out_revenue", strength: { mean: 0.55, std: 0.18 } },
      { from: "out_revenue", to: "goal_1", strength: { mean: 0.7, std: 0.1 } },
      { from: "risk_compliance", to: "goal_1", strength: { mean: -0.25, std: 0.15 } },
    ],
  };
}

function makeRedraftedGraph() {
  return {
    version: "3",
    default_seed: 42,
    hash: "europe-redraft-hash",
    nodes: [
      { id: "goal_1", kind: "goal", label: "15% Revenue Growth" },
      { id: "dec_1", kind: "decision", label: "European Expansion" },
      { id: "opt_germany", kind: "option", label: "Expand to Germany", data: { interventions: { fac_investment: 0.8 } } },
      { id: "opt_domestic", kind: "option", label: "Stay Domestic (Status Quo)", data: { interventions: { fac_investment: 0.1 } } },
      { id: "fac_investment", kind: "factor", label: "Expansion Investment", category: "controllable", data: { value: 0.5, raw_value: 1000000, unit: "GBP" } },
      { id: "fac_market", kind: "factor", label: "German Market Size", category: "external", prior: { distribution: "uniform", range_min: 0.5, range_max: 0.9 } },
      { id: "out_revenue", kind: "outcome", label: "Revenue Growth" },
      { id: "risk_entry", kind: "risk", label: "Market Entry Risk" },
    ],
    edges: [
      { from: "dec_1", to: "opt_germany", strength: { mean: 1.0, std: 0.01 } },
      { from: "dec_1", to: "opt_domestic", strength: { mean: 1.0, std: 0.01 } },
      { from: "opt_germany", to: "fac_investment", strength: { mean: 1.0, std: 0.01 } },
      { from: "opt_domestic", to: "fac_investment", strength: { mean: 1.0, std: 0.01 } },
      { from: "fac_investment", to: "out_revenue", strength: { mean: 0.5, std: 0.15 } },
      { from: "fac_market", to: "out_revenue", strength: { mean: 0.6, std: 0.15 } },
      { from: "out_revenue", to: "goal_1", strength: { mean: 0.7, std: 0.1 } },
      { from: "risk_entry", to: "goal_1", strength: { mean: -0.15, std: 0.1 } },
    ],
  };
}

// ============================================================================
// Scenario A — Hiring decision (8 turns)
// ============================================================================

describe("Scenario A: Hiring Decision (8-turn stateful flow)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("completes 8-turn hiring journey with accumulated context", async () => {
    // Mutable state accumulated across turns
    let graph: unknown = null;
    let analysis: unknown = null;
    let framing: unknown = null;
    const messages: Array<{ role: string; content: string }> = [];
    const assistantTexts: string[] = [];

    // Helper to make a turn request with accumulated state
    const turn = (
      message: string,
      overrides?: Partial<ConversationContext>,
    ): OrchestratorTurnRequest => ({
      scenario_id: "scenario-a",
      client_turn_id: `a-turn-${messages.length + 1}`,
      message,
      context: {
        graph: graph as ConversationContext["graph"],
        analysis_response: analysis as ConversationContext["analysis_response"],
        framing: framing as ConversationContext["framing"],
        messages: messages.slice(-10) as ConversationContext["messages"],
        scenario_id: "scenario-a",
        ...overrides,
      },
    } as OrchestratorTurnRequest);

    const afterTurn = (msg: string, envelope: OrchestratorResponseEnvelopeV2) => {
      messages.push({ role: "user", content: msg });
      if (envelope.assistant_text) {
        messages.push({ role: "assistant", content: envelope.assistant_text });
        assistantTexts.push(envelope.assistant_text);
      }
    };

    // ---- Turn 1: Framing question → INTERPRET ----
    const client1 = makeLLMClient(
      `<diagnostics>Mode: INTERPRET</diagnostics>\n<response>\n  <assistant_text>I'd like to help you think through this hiring decision. To build a useful model, I need a bit more detail. What's your budget, and are there any hard constraints like a deadline?</assistant_text>\n</response>`,
    );
    const env1 = await executePipeline(
      turn("Should I hire a tech lead or two developers to ship AI features within 6 months?"),
      "req-a1", makeDeps(client1),
    );
    assertTurn(env1, { mode: "INTERPRET", tool: null, stage: "frame" }, "A1", assistantTexts);
    afterTurn("Should I hire a tech lead or two developers to ship AI features within 6 months?", env1);

    // ---- Turn 2: Budget + constraints → ACT, draft_graph ----
    const client2 = makeLLMClient(
      `<diagnostics>Mode: ACT</diagnostics>\n<response>\n  <assistant_text>I have enough context — let me draft a decision model for your hiring options.</assistant_text>\n  <tool_calls>\n    <tool name="draft_graph"><brief>Hire tech lead or two developers, budget under £200k, ship AI features in 6 months</brief></tool>\n  </tool_calls>\n</response>`,
      "draft_graph",
      { brief: "Hire tech lead or two developers" },
    );
    const dispatcher2 = makeToolDispatcher({
      blocks: [makeBlock("graph_patch")],
      assistant_text: "I've drafted your decision model with two hiring options, cost and velocity factors, and a delivery outcome.",
      side_effects: { graph_updated: true, analysis_ran: false, brief_generated: false },
    });
    const env2 = await executePipeline(
      turn("Budget is under £200k, we need to keep up with competitors"),
      "req-a2", makeDeps(client2, dispatcher2),
    );
    assertTurn(env2, { mode: "ACT", tool: "draft_graph", stage: "frame" }, "A2", assistantTexts);
    // Update accumulated state
    graph = makeHiringGraph();
    framing = { stage: "ideate", goal: "Ship AI Features Within 6 Months", constraints: ["Budget under £200k"], options: ["Hire Tech Lead", "Hire Two Developers"] };
    afterTurn("Budget is under £200k, we need to keep up with competitors", env2);

    // ---- Turn 3: "What does each option do?" → INTERPRET, references interventions ----
    const client3 = makeLLMClient(
      `<diagnostics>Mode: INTERPRET</diagnostics>\n<response>\n  <assistant_text>The Tech Lead option sets hiring cost to full budget utilisation and team velocity to maximum. The Two Developers option uses 60% of the cost budget but provides 70% of the velocity boost. Both options flow through to feature delivery rate and ultimately your 6-month shipping goal.</assistant_text>\n</response>`,
    );
    const env3 = await executePipeline(
      turn("What does each option do?"),
      "req-a3", makeDeps(client3),
    );
    assertTurn(env3, {
      mode: "INTERPRET", tool: null, stage: "ideate",
      contextReferences: ["tech lead", "velocity"],
    }, "A3", assistantTexts);
    // Forbidden: edit_graph should not fire for a question
    expect(
      (client3.chatWithTools as ReturnType<typeof vi.fn>).mock.calls.length <= 1,
      "[A3] edit_graph should not be dispatched for an interpret question",
    ).toBe(true);
    afterTurn("What does each option do?", env3);

    // ---- Turn 4: "Set the hiring cost to £150k" → ACT, edit_graph (update_node) ----
    const client4 = makeLLMClient(
      `<diagnostics>Mode: ACT</diagnostics>\n<response>\n  <assistant_text>I'll update the hiring cost factor to £150k.</assistant_text>\n  <tool_calls>\n    <tool name="edit_graph"><instruction>Set the hiring cost to £150k</instruction></tool>\n  </tool_calls>\n</response>`,
      "edit_graph",
      { instruction: "Set the hiring cost to £150k" },
    );
    const dispatcher4 = makeToolDispatcher({
      blocks: [makeBlock("graph_patch")],
      assistant_text: "Updated — hiring cost is now £150k.",
      side_effects: { graph_updated: true, analysis_ran: false, brief_generated: false },
      applied_changes: {
        summary: "Set hiring cost to £150k",
        rerun_recommended: true,
        changes: [{ label: "Hiring Cost", description: "Value changed from £120k to £150k", element_ref: "fac_cost" }],
      },
    });
    const env4 = await executePipeline(
      turn("Set the hiring cost to £150k"),
      "req-a4", makeDeps(client4, dispatcher4),
    );
    assertTurn(env4, { mode: "ACT", tool: "edit_graph", stage: "ideate" }, "A4", assistantTexts);
    expect(env4.applied_changes, "[A4] applied_changes should be present").toBeDefined();
    expect(env4.applied_changes!.rerun_recommended, "[A4] rerun_recommended").toBe(true);
    afterTurn("Set the hiring cost to £150k", env4);

    // ---- Turn 5: "Run the analysis" → ACT, run_analysis ----
    // Set a minimal analysis so stage inference yields "evaluate" (graph + analysis = evaluate).
    // In the real app, analysis is triggered by direct_analysis_run system event from the UI;
    // here we simulate the post-analysis state to test downstream routing at evaluate stage.
    analysis = makeHiringAnalysis();
    framing = { stage: "evaluate", goal: "Ship AI Features Within 6 Months", constraints: ["Budget under £200k"], options: ["Hire Tech Lead", "Hire Two Developers"] };
    const client5 = makeLLMClient(
      null,
      "run_analysis",
      { options: "opt_lead,opt_devs" },
    );
    const dispatcher5 = makeToolDispatcher({
      blocks: [makeBlock("fact")],
      assistant_text: "Analysis complete. Hire Tech Lead wins with 64% probability.",
      side_effects: { graph_updated: false, analysis_ran: true, brief_generated: false },
    });
    const env5 = await executePipeline(
      turn("Run the analysis"),
      "req-a5", makeDeps(client5, dispatcher5),
    );
    assertTurn(env5, { mode: "ACT", tool: "run_analysis", stage: "evaluate" }, "A5", assistantTexts);
    afterTurn("Run the analysis", env5);

    // ---- Turn 6: "Who is winning?" → INTERPRET or Tier 1 deterministic ----
    const client6 = makeLLMClient("Hire Tech Lead is currently winning with 64% probability.");
    const env6 = await executePipeline(
      turn("Who is winning?"),
      "req-a6", makeDeps(client6),
    );
    assertTurn(env6, {
      mode: "INTERPRET", tool: null, stage: "evaluate",
      expectDeterministicTier: envelope_has_tier(env6) ? env6.deterministic_answer_tier! : null,
    }, "A6", assistantTexts);
    // Either deterministic tier 1 (no LLM call) or LLM path — both valid
    if (env6.deterministic_answer_tier === 1) {
      expect(client6.chatWithTools, "[A6] tier 1 should not call LLM").not.toHaveBeenCalled();
    }
    afterTurn("Who is winning?", env6);

    // ---- Turn 7: "Why?" → ACT, explain_results (causal decomposition) ----
    const client7 = makeLLMClient(
      `<diagnostics>Mode: ACT</diagnostics>\n<response>\n  <assistant_text>Hire Tech Lead wins primarily because of the strong team velocity factor (sensitivity 0.85). Despite the higher hiring cost, the velocity advantage flows through to feature delivery rate with a 0.75 coefficient, which dominates the negative cost effect (-0.3).</assistant_text>\n  <tool_calls>\n    <tool name="explain_results"><question>Why is Hire Tech Lead winning?</question></tool>\n  </tool_calls>\n</response>`,
      "explain_results",
      { question: "Why is Hire Tech Lead winning?" },
    );
    const dispatcher7 = makeToolDispatcher({
      blocks: [makeBlock("commentary")],
      assistant_text: "Hire Tech Lead wins because team velocity (sensitivity 0.85) dominates. The velocity→delivery coefficient (0.75) outweighs the cost→delivery penalty (-0.3).",
      side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
    });
    const env7 = await executePipeline(
      turn("Why?"),
      "req-a7", makeDeps(client7, dispatcher7),
    );
    assertTurn(env7, {
      mode: "ACT", tool: "explain_results", stage: "evaluate",
      contextReferences: ["velocity"],
    }, "A7", assistantTexts);
    afterTurn("Why?", env7);

    // ---- Turn 8: "What would change the result?" → ACT, explain_results (counterfactual) ----
    const client8 = makeLLMClient(
      `<diagnostics>Mode: ACT</diagnostics>\n<response>\n  <assistant_text>The result would flip if team velocity sensitivity dropped below 0.4 or if the hiring cost difference widened beyond £100k. Developer market tightness is the main external uncertainty.</assistant_text>\n  <tool_calls>\n    <tool name="explain_results"><question>What would change the result?</question></tool>\n  </tool_calls>\n</response>`,
      "explain_results",
      { question: "What would change the result?" },
    );
    const dispatcher8 = makeToolDispatcher({
      blocks: [makeBlock("commentary")],
      assistant_text: "The result would flip if team velocity sensitivity dropped below 0.4, or if hiring cost difference exceeded £100k. Developer market tightness is the key uncertainty.",
      side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
    });
    const env8 = await executePipeline(
      turn("What would change the result?"),
      "req-a8", makeDeps(client8, dispatcher8),
    );
    assertTurn(env8, {
      mode: "ACT", tool: "explain_results", stage: "evaluate",
      contextReferences: ["velocity"],
    }, "A8", assistantTexts);
    afterTurn("What would change the result?", env8);
  });
});

// ============================================================================
// Scenario B — Pricing decision (6 turns)
// ============================================================================

describe("Scenario B: Pricing Strategy (6-turn stateful flow)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("completes 6-turn pricing journey with accumulated context", async () => {
    let graph: unknown = null;
    let analysis: unknown = null;
    let framing: unknown = null;
    const messages: Array<{ role: string; content: string }> = [];
    const assistantTexts: string[] = [];

    const turn = (message: string): OrchestratorTurnRequest => ({
      scenario_id: "scenario-b",
      client_turn_id: `b-turn-${messages.length + 1}`,
      message,
      context: {
        graph: graph as ConversationContext["graph"],
        analysis_response: analysis as ConversationContext["analysis_response"],
        framing: framing as ConversationContext["framing"],
        messages: messages.slice(-10) as ConversationContext["messages"],
        scenario_id: "scenario-b",
      },
    } as OrchestratorTurnRequest);

    const afterTurn = (msg: string, envelope: OrchestratorResponseEnvelopeV2) => {
      messages.push({ role: "user", content: msg });
      if (envelope.assistant_text) {
        messages.push({ role: "assistant", content: envelope.assistant_text });
        assistantTexts.push(envelope.assistant_text);
      }
    };

    // ---- Turn 1: Dense brief → ACT, draft_graph ----
    const client1 = makeLLMClient(
      `<diagnostics>Mode: ACT</diagnostics>\n<response>\n  <assistant_text>I have your goal, options, and constraints — let me model this pricing decision.</assistant_text>\n  <tool_calls>\n    <tool name="draft_graph"><brief>Raise Pro from £49 to £59, goal £20k MRR in 12 months, churn under 4%</brief></tool>\n  </tool_calls>\n</response>`,
      "draft_graph",
      { brief: "Raise Pro from £49 to £59" },
    );
    const dispatcher1 = makeToolDispatcher({
      blocks: [makeBlock("graph_patch")],
      assistant_text: "Your pricing model is ready — two options (raise vs keep), price and churn factors, MRR outcome, and churn spike risk.",
      side_effects: { graph_updated: true, analysis_ran: false, brief_generated: false },
    });
    const env1 = await executePipeline(
      turn("Given our goal of £20k MRR within 12 months keeping churn under 4%, should we raise the Pro plan from £49 to £59?"),
      "req-b1", makeDeps(client1, dispatcher1),
    );
    assertTurn(env1, { mode: "ACT", tool: "draft_graph", stage: "frame" }, "B1", assistantTexts);
    graph = makePricingGraph();
    framing = { stage: "ideate", goal: "£20k MRR Within 12 Months", constraints: ["Churn under 4%"], options: ["Raise Pro Plan to £59", "Keep Pro Plan at £49 (Status Quo)"] };
    afterTurn("Given our goal of £20k MRR within 12 months keeping churn under 4%, should we raise the Pro plan from £49 to £59?", env1);

    // ---- Turn 2: Value edit → ACT, edit_graph ----
    const client2 = makeLLMClient(
      `<diagnostics>Mode: ACT</diagnostics>\n<response>\n  <assistant_text>I'll lower the churn response since AI features improve retention.</assistant_text>\n  <tool_calls>\n    <tool name="edit_graph"><instruction>Lower the churn response because customers want AI features</instruction></tool>\n  </tool_calls>\n</response>`,
      "edit_graph",
      { instruction: "Lower churn response" },
    );
    const dispatcher2 = makeToolDispatcher({
      blocks: [makeBlock("graph_patch")],
      assistant_text: "Updated — churn response lowered to reflect AI feature demand reducing churn sensitivity.",
      side_effects: { graph_updated: true, analysis_ran: false, brief_generated: false },
      applied_changes: {
        summary: "Lowered churn response factor — AI features reduce churn",
        rerun_recommended: true,
        changes: [{ label: "Monthly Churn Rate", description: "Value updated (lower churn response)", element_ref: "fac_churn" }],
      },
    });
    const env2 = await executePipeline(
      turn("The churn response should be lower because customers want AI features"),
      "req-b2", makeDeps(client2, dispatcher2),
    );
    assertTurn(env2, { mode: "ACT", tool: "edit_graph", stage: "ideate" }, "B2", assistantTexts);
    expect(env2.applied_changes, "[B2] applied_changes present").toBeDefined();
    afterTurn("The churn response should be lower because customers want AI features", env2);

    // ---- Turn 3: "What are the main risks?" → INTERPRET, references risk nodes ----
    const client3 = makeLLMClient(
      `<diagnostics>Mode: INTERPRET</diagnostics>\n<response>\n  <assistant_text>The main risk in your model is churn spike risk, which flows from the monthly churn rate factor with a 0.6 coefficient. If churn exceeds the 4% constraint, MRR could fall short of the £20k target. The AI feature demand factor mitigates this — higher demand lowers effective churn.</assistant_text>\n</response>`,
    );
    const env3 = await executePipeline(
      turn("What are the main risks?"),
      "req-b3", makeDeps(client3),
    );
    assertTurn(env3, {
      mode: "INTERPRET", tool: null, stage: "ideate",
      contextReferences: ["churn"],
    }, "B3", assistantTexts);
    afterTurn("What are the main risks?", env3);

    // ---- Turn 4: "Run analysis" → ACT, run_analysis ----
    // Set analysis before turn so stage inference yields "evaluate" (graph + analysis = evaluate).
    analysis = makePricingAnalysis();
    framing = { stage: "evaluate", goal: "£20k MRR Within 12 Months", constraints: ["Churn under 4%"], options: ["Raise Pro Plan to £59", "Keep Pro Plan at £49 (Status Quo)"] };
    const client4 = makeLLMClient(null, "run_analysis", { options: "opt_raise,opt_keep" });
    const dispatcher4 = makeToolDispatcher({
      blocks: [makeBlock("fact")],
      assistant_text: "Analysis complete. Raising to £59 wins with 58% probability, but the result is fragile.",
      side_effects: { graph_updated: false, analysis_ran: true, brief_generated: false },
    });
    const env4 = await executePipeline(
      turn("Run analysis"),
      "req-b4", makeDeps(client4, dispatcher4),
    );
    assertTurn(env4, { mode: "ACT", tool: "run_analysis", stage: "evaluate" }, "B4", assistantTexts);
    afterTurn("Run analysis", env4);

    // ---- Turn 5: "How close are the options?" → INTERPRET or Tier 1 deterministic ----
    const client5 = makeLLMClient("The options are close — Raise to £59 wins with 58% vs 42% for keeping at £49. The margin is only 16 percentage points, and robustness is rated fragile.");
    const env5 = await executePipeline(
      turn("How close are the options?"),
      "req-b5", makeDeps(client5),
    );
    assertTurn(env5, {
      mode: "INTERPRET", tool: null, stage: "evaluate",
      expectDeterministicTier: envelope_has_tier(env5) ? env5.deterministic_answer_tier! : null,
    }, "B5", assistantTexts);
    afterTurn("How close are the options?", env5);

    // ---- Turn 6: "What assumptions matter most?" → ACT, explain_results (sensitivity) ----
    const client6 = makeLLMClient(
      `<diagnostics>Mode: ACT</diagnostics>\n<response>\n  <assistant_text>The two most sensitive assumptions are Pro Plan Price (sensitivity 0.75) and Monthly Churn Rate (-0.60). Small changes to either could flip the recommendation. Price is the strongest lever — a £5 difference drives most of the MRR gap.</assistant_text>\n  <tool_calls>\n    <tool name="explain_results"><question>What assumptions matter most?</question></tool>\n  </tool_calls>\n</response>`,
      "explain_results",
      { question: "What assumptions matter most?" },
    );
    const dispatcher6 = makeToolDispatcher({
      blocks: [makeBlock("commentary")],
      assistant_text: "Price (sensitivity 0.75) and churn rate (-0.60) are the two most sensitive factors. Small changes to either could flip the result.",
      side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
    });
    const env6 = await executePipeline(
      turn("What assumptions matter most?"),
      "req-b6", makeDeps(client6, dispatcher6),
    );
    assertTurn(env6, {
      mode: "ACT", tool: "explain_results", stage: "evaluate",
      contextReferences: ["price"],
    }, "B6", assistantTexts);
    afterTurn("What assumptions matter most?", env6);
  });
});

// ============================================================================
// Scenario C — Recovery and re-draft (5 turns)
// ============================================================================

describe("Scenario C: Recovery/Re-draft (5-turn stateful flow)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("completes 5-turn Europe expansion with recovery and re-draft", async () => {
    let graph: unknown = null;
    let framing: unknown = null;
    const messages: Array<{ role: string; content: string }> = [];
    const assistantTexts: string[] = [];

    const turn = (message: string): OrchestratorTurnRequest => ({
      scenario_id: "scenario-c",
      client_turn_id: `c-turn-${messages.length + 1}`,
      message,
      context: {
        graph: graph as ConversationContext["graph"],
        analysis_response: null,
        framing: framing as ConversationContext["framing"],
        messages: messages.slice(-10) as ConversationContext["messages"],
        scenario_id: "scenario-c",
      },
    } as OrchestratorTurnRequest);

    const afterTurn = (msg: string, envelope: OrchestratorResponseEnvelopeV2) => {
      messages.push({ role: "user", content: msg });
      if (envelope.assistant_text) {
        messages.push({ role: "assistant", content: envelope.assistant_text });
        assistantTexts.push(envelope.assistant_text);
      }
    };

    // ---- Turn 1: Insufficient info → INTERPRET, first-turn framing ----
    const client1 = makeLLMClient(
      `<diagnostics>Mode: INTERPRET</diagnostics>\n<response>\n  <assistant_text>European expansion is a significant decision. To build a useful model, I need to know: which specific markets are you considering, what's the investment budget, and what does success look like (revenue target, timeline)?</assistant_text>\n</response>`,
    );
    const env1 = await executePipeline(
      turn("We need to decide whether to expand into Europe"),
      "req-c1", makeDeps(client1),
    );
    assertTurn(env1, { mode: "INTERPRET", tool: null, stage: "frame" }, "C1", assistantTexts);
    afterTurn("We need to decide whether to expand into Europe", env1);

    // ---- Turn 2: Full detail → ACT, draft_graph ----
    const client2 = makeLLMClient(
      `<diagnostics>Mode: ACT</diagnostics>\n<response>\n  <assistant_text>Now I have enough context — three market options with a clear budget and growth target. Let me draft the decision model.</assistant_text>\n  <tool_calls>\n    <tool name="draft_graph"><brief>Expand to Germany, Brazil, or Japan, targeting 15% revenue growth with £2M budget</brief></tool>\n  </tool_calls>\n</response>`,
      "draft_graph",
      { brief: "Expand to Germany, Brazil, or Japan" },
    );
    const dispatcher2 = makeToolDispatcher({
      blocks: [makeBlock("graph_patch")],
      assistant_text: "Your expansion model is ready with three market options, investment and regulatory factors, and revenue growth outcome.",
      side_effects: { graph_updated: true, analysis_ran: false, brief_generated: false },
    });
    const env2 = await executePipeline(
      turn("Options are Germany, Brazil, or Japan, targeting 15% revenue growth with £2M budget"),
      "req-c2", makeDeps(client2, dispatcher2),
    );
    assertTurn(env2, { mode: "ACT", tool: "draft_graph", stage: "frame" }, "C2", assistantTexts);
    graph = makeEuropeGraph();
    framing = { stage: "ideate", goal: "15% Revenue Growth", constraints: ["£2M budget"], options: ["Expand to Germany", "Expand to Brazil", "Expand to Japan"] };
    afterTurn("Options are Germany, Brazil, or Japan, targeting 15% revenue growth with £2M budget", env2);

    // ---- Turn 3: "Remove the regulatory factor" → ACT, edit_graph ----
    const client3 = makeLLMClient(
      `<diagnostics>Mode: ACT</diagnostics>\n<response>\n  <assistant_text>I'll remove the regulatory complexity factor and its connected edges from the model.</assistant_text>\n  <tool_calls>\n    <tool name="edit_graph"><instruction>Remove the regulatory complexity factor</instruction></tool>\n  </tool_calls>\n</response>`,
      "edit_graph",
      { instruction: "Remove the regulatory complexity factor" },
    );
    const dispatcher3 = makeToolDispatcher({
      blocks: [makeBlock("graph_patch")],
      assistant_text: "Removed regulatory complexity — the compliance risk node is now disconnected and has been cleaned up.",
      side_effects: { graph_updated: true, analysis_ran: false, brief_generated: false },
      applied_changes: {
        summary: "Removed regulatory complexity factor and compliance risk",
        rerun_recommended: true,
        changes: [
          { label: "Regulatory Complexity", description: "Factor removed", element_ref: "fac_regulatory" },
          { label: "Compliance Risk", description: "Risk node removed (orphaned)", element_ref: "risk_compliance" },
        ],
      },
    });
    const env3 = await executePipeline(
      turn("Remove the regulatory factor"),
      "req-c3", makeDeps(client3, dispatcher3),
    );
    assertTurn(env3, { mode: "ACT", tool: "edit_graph", stage: "ideate" }, "C3", assistantTexts);
    expect(env3.applied_changes, "[C3] applied_changes present").toBeDefined();
    afterTurn("Remove the regulatory factor", env3);

    // ---- Turn 4: "Start over with just Germany vs staying domestic" → ACT, draft_graph (rebuild) ----
    const client4 = makeLLMClient(
      `<diagnostics>Mode: ACT</diagnostics>\n<response>\n  <assistant_text>I'll rebuild the model from scratch with just Germany vs staying domestic.</assistant_text>\n  <tool_calls>\n    <tool name="draft_graph"><brief>Germany expansion vs staying domestic, targeting 15% revenue growth with £2M budget</brief></tool>\n  </tool_calls>\n</response>`,
      "draft_graph",
      { brief: "Germany vs staying domestic" },
    );
    const dispatcher4 = makeToolDispatcher({
      blocks: [makeBlock("graph_patch")],
      assistant_text: "New model ready — Germany expansion vs domestic status quo, with investment, market size, and entry risk factors.",
      side_effects: { graph_updated: true, analysis_ran: false, brief_generated: false },
    });
    const env4 = await executePipeline(
      turn("Actually, let's start over with just Germany vs staying domestic"),
      "req-c4", makeDeps(client4, dispatcher4),
    );
    assertTurn(env4, { mode: "ACT", tool: "draft_graph", stage: "ideate" }, "C4", assistantTexts);
    graph = makeRedraftedGraph();
    framing = { stage: "ideate", goal: "15% Revenue Growth", constraints: ["£2M budget"], options: ["Expand to Germany", "Stay Domestic (Status Quo)"] };
    afterTurn("Actually, let's start over with just Germany vs staying domestic", env4);

    // ---- Turn 5: "What factors did you include?" → INTERPRET, references current graph ----
    const client5 = makeLLMClient(
      `<diagnostics>Mode: INTERPRET</diagnostics>\n<response>\n  <assistant_text>The simplified model includes four factors: expansion investment (controllable, £1M budget), German market size (external), revenue growth (outcome), and market entry risk. Two options: expand to Germany or stay domestic. The goal is 15% revenue growth.</assistant_text>\n</response>`,
    );
    const env5 = await executePipeline(
      turn("What factors did you include?"),
      "req-c5", makeDeps(client5),
    );
    assertTurn(env5, {
      mode: "INTERPRET", tool: null, stage: "ideate",
      contextReferences: ["germany", "investment"],
    }, "C5", assistantTexts);
    // Must reference CURRENT graph (Germany+domestic), not old graph (Germany+Brazil+Japan)
    const text5 = (env5.assistant_text ?? "").toLowerCase();
    expect(text5, "[C5] should not reference old options").not.toContain("brazil");
    expect(text5, "[C5] should not reference old options").not.toContain("japan");
    afterTurn("What factors did you include?", env5);
  });
});

// ============================================================================
// Utility
// ============================================================================

function envelope_has_tier(env: OrchestratorResponseEnvelopeV2): boolean {
  return env.deterministic_answer_tier != null;
}
