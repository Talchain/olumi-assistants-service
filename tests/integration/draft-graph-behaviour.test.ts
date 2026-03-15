/**
 * Draft Graph Behaviour Tests
 *
 * Validates draft graph response structure and completeness via mock-based
 * integration tests exercising executePipeline.
 *
 * Five scenarios:
 *   1. Immediate drafting on complete brief
 *   2. Graph completeness (node kinds, interventions, edges)
 *   3. Operations format handling
 *   4. Intervention config completeness
 *   5. Status quo present
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
// Module mocks
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
    prompt_hash: "draft-graph-hash-0123456789abcdef0123456789abcdef0123456789abcdef01234567",
    instance_id: "draft-graph-instance",
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
// Mock data
// ============================================================================

const MOCK_DRAFT_GRAPH = {
  nodes: [
    { id: "dec_1", kind: "decision", label: "Pricing Strategy" },
    { id: "opt_raise", kind: "option", label: "Raise Pro Plan to £59", data: { interventions: { fac_price: 0.59, fac_churn: 0.06 } } },
    { id: "opt_keep", kind: "option", label: "Keep Pro Plan at £49 (Status Quo)", data: { interventions: { fac_price: 0.49, fac_churn: 0.04 } } },
    { id: "fac_price", kind: "factor", label: "Pro Plan Price", category: "controllable", data: { value: 0.49, raw_value: 49, unit: "GBP/mo", factor_type: "price", extractionType: "explicit", uncertainty_drivers: ["competitor pricing"] } },
    { id: "fac_churn", kind: "factor", label: "Monthly Churn Rate", category: "controllable", data: { value: 0.04, raw_value: 4, unit: "%", factor_type: "probability", extractionType: "explicit", uncertainty_drivers: ["customer satisfaction"] } },
    { id: "fac_demand", kind: "factor", label: "AI Feature Demand", category: "external", prior: { distribution: "uniform", range_min: 0.3, range_max: 0.8 } },
    { id: "out_mrr", kind: "outcome", label: "Monthly Recurring Revenue" },
    { id: "risk_churn_spike", kind: "risk", label: "Churn Spike Risk" },
    { id: "goal_1", kind: "goal", label: "Reach £20k MRR Within 12 Months", goal_threshold: 0.8, goal_threshold_raw: 20000, goal_threshold_unit: "GBP/mo", goal_threshold_cap: 25000 },
  ],
  edges: [
    { from: "dec_1", to: "opt_raise", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0 },
    { from: "dec_1", to: "opt_keep", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0 },
    { from: "opt_raise", to: "fac_price", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0 },
    { from: "opt_raise", to: "fac_churn", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0 },
    { from: "opt_keep", to: "fac_price", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0 },
    { from: "opt_keep", to: "fac_churn", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0 },
    { from: "fac_price", to: "out_mrr", strength: { mean: 0.7, std: 0.1 }, exists_probability: 0.9, effect_direction: "positive" },
    { from: "fac_churn", to: "risk_churn_spike", strength: { mean: 0.6, std: 0.15 }, exists_probability: 0.85, effect_direction: "positive" },
    { from: "fac_demand", to: "out_mrr", strength: { mean: 0.4, std: 0.2 }, exists_probability: 0.75, effect_direction: "positive" },
    { from: "out_mrr", to: "goal_1", strength: { mean: 0.8, std: 0.05 }, exists_probability: 0.95, effect_direction: "positive" },
    { from: "risk_churn_spike", to: "goal_1", strength: { mean: -0.3, std: 0.1 }, exists_probability: 0.85, effect_direction: "negative" },
  ],
};

const MOCK_OPERATIONS = [
  ...MOCK_DRAFT_GRAPH.nodes.map((node) => ({
    op: "add_node" as const,
    path: `/nodes/${node.id}`,
    value: node,
  })),
  ...MOCK_DRAFT_GRAPH.edges.map((edge, i) => ({
    op: "add_edge" as const,
    path: `/edges/${i}`,
    value: edge,
  })),
];

const COMPLETE_BRIEF =
  "We are considering raising the price of our Pro plan from £49 to £59. Goal: reach £20k MRR within 12 months. Two options: raise or keep current pricing. Constraints: churn must stay under 5%.";

// ============================================================================
// Helpers
// ============================================================================

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
      content: "Here is your decision graph for the pricing strategy.",
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

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: null,
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: "test-scenario",
    ...overrides,
  };
}

function makeRequest(overrides?: Partial<OrchestratorTurnRequest>): OrchestratorTurnRequest {
  return {
    scenario_id: "test-scenario",
    client_turn_id: "client-1",
    message: "Test message",
    context: makeContext(),
    ...overrides,
  } as OrchestratorTurnRequest;
}

function makeGraphPatchBlock(): ConversationBlock {
  return {
    block_id: `b-${Date.now()}`,
    block_type: "graph_patch" as ConversationBlock["block_type"],
    data: { full_graph: MOCK_DRAFT_GRAPH } as unknown as ConversationBlock["data"],
    provenance: { trigger: "draft_graph", turn_id: "t1", timestamp: new Date().toISOString() },
  };
}

function makeGraphPatchBlockOperations(): ConversationBlock {
  return {
    block_id: `b-${Date.now()}`,
    block_type: "graph_patch" as ConversationBlock["block_type"],
    data: { patch_type: "full_draft", operations: MOCK_OPERATIONS } as unknown as ConversationBlock["data"],
    provenance: { trigger: "draft_graph", turn_id: "t1", timestamp: new Date().toISOString() },
  };
}

/**
 * Extracts nodes from a graph_patch block, handling both full_graph and
 * operations format.
 */
function extractNodesFromBlock(block: ConversationBlock): unknown[] {
  const data = block.data as Record<string, unknown>;
  // Full graph format: data.full_graph.nodes
  if (data.full_graph && typeof data.full_graph === "object") {
    const fg = data.full_graph as Record<string, unknown>;
    if (Array.isArray(fg.nodes)) return fg.nodes;
  }
  // Operations format: filter for add_node ops, extract value
  if (Array.isArray(data.operations)) {
    return (data.operations as Array<{ op: string; value: unknown }>)
      .filter((op) => op.op === "add_node")
      .map((op) => op.value);
  }
  return [];
}

// ============================================================================
// Tests
// ============================================================================

describe("Draft graph behaviour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Immediate drafting on complete brief", async () => {
    const llm = makeLLMClient(
      "<diagnostics>Mode: ACT</diagnostics>I've drafted a decision graph for your pricing strategy.",
      "draft_graph",
      { brief: COMPLETE_BRIEF },
    );

    const dispatcher = makeToolDispatcher({
      blocks: [makeGraphPatchBlock()],
      side_effects: { graph_updated: true, analysis_ran: false, brief_generated: false },
      assistant_text: "I've drafted a decision graph modelling your pricing strategy with two options, key factors, and your MRR goal.",
    });

    const request = makeRequest({ message: COMPLETE_BRIEF });

    const envelope = await executePipeline(request, "req-draft-1", makeDeps(llm, dispatcher));

    // Response should have blocks including graph_patch
    expect(envelope.blocks.length).toBeGreaterThan(0);
    const graphPatchBlocks = envelope.blocks.filter(
      (b: ConversationBlock) => b.block_type === "graph_patch",
    );
    expect(graphPatchBlocks.length).toBeGreaterThanOrEqual(1);

    // assistant_text should NOT be a clarifying question
    const text = envelope.assistant_text ?? "";
    expect(text).not.toMatch(/\?/);
  });

  it("Graph completeness", async () => {
    const llm = makeLLMClient(
      "<diagnostics>Mode: ACT</diagnostics>Graph drafted.",
      "draft_graph",
      { brief: COMPLETE_BRIEF },
    );

    const dispatcher = makeToolDispatcher({
      blocks: [makeGraphPatchBlock()],
      side_effects: { graph_updated: true, analysis_ran: false, brief_generated: false },
      assistant_text: "Here is your complete decision graph.",
    });

    const request = makeRequest({ message: COMPLETE_BRIEF });
    const envelope = await executePipeline(request, "req-draft-2", makeDeps(llm, dispatcher));

    const graphPatchBlock = envelope.blocks.find(
      (b: ConversationBlock) => b.block_type === "graph_patch",
    );
    expect(graphPatchBlock).toBeDefined();

    const nodes = extractNodesFromBlock(graphPatchBlock!);
    const typed = nodes as Array<{ id: string; kind: string; category?: string; data?: Record<string, unknown> }>;

    // At least 1 decision node
    expect(typed.filter((n) => n.kind === "decision").length).toBeGreaterThanOrEqual(1);

    // At least 2 option nodes
    expect(typed.filter((n) => n.kind === "option").length).toBeGreaterThanOrEqual(2);

    // At least 1 goal node
    expect(typed.filter((n) => n.kind === "goal").length).toBeGreaterThanOrEqual(1);

    // At least 1 outcome or risk node
    const outcomeOrRisk = typed.filter((n) => n.kind === "outcome" || n.kind === "risk");
    expect(outcomeOrRisk.length).toBeGreaterThanOrEqual(1);

    // All option nodes have non-empty interventions
    const options = typed.filter((n) => n.kind === "option");
    for (const opt of options) {
      expect(opt.data).toBeDefined();
      expect(opt.data!.interventions).toBeDefined();
      expect(Object.keys(opt.data!.interventions as Record<string, unknown>).length).toBeGreaterThan(0);
    }

    // All controllable factors have at least one incoming edge from an option
    const controllableFactorIds = typed
      .filter((n) => n.kind === "factor" && n.category === "controllable")
      .map((n) => n.id);
    const blockData = (graphPatchBlock!.data as Record<string, unknown>).full_graph as Record<string, unknown>;
    const edges = blockData.edges as Array<{ from: string; to: string }>;
    const optionIds = new Set(options.map((n) => n.id));

    for (const facId of controllableFactorIds) {
      const hasIncoming = edges.some((e) => e.to === facId && optionIds.has(e.from));
      expect(hasIncoming, `Controllable factor ${facId} should have an incoming edge from an option`).toBe(true);
    }
  });

  it("Operations format handling", async () => {
    const llm = makeLLMClient(
      "<diagnostics>Mode: ACT</diagnostics>Graph drafted via operations.",
      "draft_graph",
      { brief: COMPLETE_BRIEF },
    );

    const dispatcher = makeToolDispatcher({
      blocks: [makeGraphPatchBlockOperations()],
      side_effects: { graph_updated: true, analysis_ran: false, brief_generated: false },
      assistant_text: "Graph drafted using operations format.",
    });

    const request = makeRequest({ message: COMPLETE_BRIEF });
    const envelope = await executePipeline(request, "req-draft-3", makeDeps(llm, dispatcher));

    const graphPatchBlock = envelope.blocks.find(
      (b: ConversationBlock) => b.block_type === "graph_patch",
    );
    expect(graphPatchBlock).toBeDefined();

    const nodes = extractNodesFromBlock(graphPatchBlock!);
    expect(nodes.length).toBeGreaterThan(0);

    // Verify nodes extracted from operations match the original count
    expect(nodes.length).toBe(MOCK_DRAFT_GRAPH.nodes.length);
  });

  it("Intervention config completeness", async () => {
    const llm = makeLLMClient(
      "<diagnostics>Mode: ACT</diagnostics>Graph drafted.",
      "draft_graph",
      { brief: COMPLETE_BRIEF },
    );

    const dispatcher = makeToolDispatcher({
      blocks: [makeGraphPatchBlock()],
      side_effects: { graph_updated: true, analysis_ran: false, brief_generated: false },
      assistant_text: "Decision graph with full intervention mappings.",
    });

    const request = makeRequest({ message: COMPLETE_BRIEF });
    const envelope = await executePipeline(request, "req-draft-4", makeDeps(llm, dispatcher));

    const graphPatchBlock = envelope.blocks.find(
      (b: ConversationBlock) => b.block_type === "graph_patch",
    );
    expect(graphPatchBlock).toBeDefined();

    const nodes = extractNodesFromBlock(graphPatchBlock!);
    const typed = nodes as Array<{ id: string; kind: string; category?: string; data?: Record<string, unknown> }>;

    const options = typed.filter((n) => n.kind === "option");
    const controllableFactorIds = new Set(
      typed
        .filter((n) => n.kind === "factor" && n.category === "controllable")
        .map((n) => n.id),
    );

    // Every option has non-empty interventions
    for (const opt of options) {
      expect(opt.data).toBeDefined();
      const interventions = opt.data!.interventions as Record<string, unknown>;
      expect(Object.keys(interventions).length).toBeGreaterThan(0);

      // Every intervention key matches a controllable factor ID in the graph
      for (const key of Object.keys(interventions)) {
        expect(
          controllableFactorIds.has(key),
          `Option "${opt.id}" intervention key "${key}" should match a controllable factor`,
        ).toBe(true);
      }
    }
  });

  it("Status quo present", async () => {
    const llm = makeLLMClient(
      "<diagnostics>Mode: ACT</diagnostics>Graph includes status quo.",
      "draft_graph",
      { brief: COMPLETE_BRIEF },
    );

    const dispatcher = makeToolDispatcher({
      blocks: [makeGraphPatchBlock()],
      side_effects: { graph_updated: true, analysis_ran: false, brief_generated: false },
      assistant_text: "Graph includes status quo option for comparison.",
    });

    const request = makeRequest({ message: COMPLETE_BRIEF });
    const envelope = await executePipeline(request, "req-draft-5", makeDeps(llm, dispatcher));

    const graphPatchBlock = envelope.blocks.find(
      (b: ConversationBlock) => b.block_type === "graph_patch",
    );
    expect(graphPatchBlock).toBeDefined();

    const nodes = extractNodesFromBlock(graphPatchBlock!);
    const typed = nodes as Array<{ id: string; kind: string; label: string; data?: Record<string, unknown> }>;

    const options = typed.filter((n) => n.kind === "option");
    const statusQuoPattern = /status\s*quo|keep|current/i;

    // At least one option matches the status quo pattern
    const statusQuoOptions = options.filter((n) => statusQuoPattern.test(n.label));
    expect(statusQuoOptions.length).toBeGreaterThanOrEqual(1);

    // The status quo option's interventions should have at least one value
    // matching the corresponding factor's data.value (baseline alignment)
    const factorMap = new Map<string, number>();
    for (const node of typed) {
      if (node.kind === "factor" && node.data && typeof node.data.value === "number") {
        factorMap.set(node.id, node.data.value);
      }
    }

    for (const sqOpt of statusQuoOptions) {
      const interventions = sqOpt.data!.interventions as Record<string, number>;
      let hasBaselineMatch = false;
      for (const [facId, interventionValue] of Object.entries(interventions)) {
        const factorBaseline = factorMap.get(facId);
        if (factorBaseline !== undefined && interventionValue === factorBaseline) {
          hasBaselineMatch = true;
          break;
        }
      }
      expect(
        hasBaselineMatch,
        `Status quo option "${sqOpt.id}" should have at least one intervention matching the factor baseline value`,
      ).toBe(true);
    }
  });
});
