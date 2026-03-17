/**
 * edit_graph v2 prompt integration tests.
 *
 * Tests the v2 response parser, operation mapping, path normalisation,
 * coaching/warnings wiring, empty operations handling, and legacy compat.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks — must be declared before imports
// ============================================================================

let patchPreValidationEnabledForTest = false;
let patchBudgetEnabledForTest = false;

vi.mock("../../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("You edit causal decision graphs"),
  getSystemPromptMeta: vi.fn().mockReturnValue({ source: 'default', prompt_version: 'v2' }),
}));

vi.mock("../../../../src/config/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../src/config/index.js")>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === "cee") {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ceeTarget, ceeProp) {
              if (ceeProp === "maxRepairRetries") return 1;
              if (ceeProp === "patchPreValidationEnabled") return patchPreValidationEnabledForTest;
              if (ceeProp === "patchBudgetEnabled") return patchBudgetEnabledForTest;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import {
  classifyEditIntent,
  determineEditResolutionMode,
  parseEditGraphResponse,
  handleEditGraph,
  resolveEditTarget,
  type EditGraphLLMResult,
  type EditGraphResult,
} from "../../../../src/orchestrator/tools/edit-graph.js";
import type { ConversationContext, PatchOperation, GraphPatchBlockData } from "../../../../src/orchestrator/types.js";
import type { LLMAdapter } from "../../../../src/adapters/llm/types.js";
import type { PLoTClient, ValidatePatchResult } from "../../../../src/orchestrator/plot-client.js";

beforeEach(() => {
  patchPreValidationEnabledForTest = false;
  patchBudgetEnabledForTest = false;
});

// ============================================================================
// Helpers
// ============================================================================

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: "goal_1", kind: "goal", label: "Revenue" },
        { id: "factor_1", kind: "factor", label: "Price" },
        { id: "out_1", kind: "outcome", label: "Sales" },
      ],
      edges: [
        {
          from: "factor_1",
          to: "out_1",
          strength_mean: 0.5,
          strength_std: 0.1,
          exists_probability: 0.9,
          effect_direction: "positive",
        },
        {
          from: "out_1",
          to: "goal_1",
          strength_mean: 0.8,
          strength_std: 0.05,
          exists_probability: 1.0,
          effect_direction: "positive",
        },
      ],
    } as unknown as ConversationContext["graph"],
    analysis_response: null,
    framing: null,
    messages: [],
    conversational_state: { active_entities: [], stated_constraints: [], current_topic: "framing", last_failed_action: null },
    scenario_id: "test-scenario",
    ...overrides,
  };
}

function makeAdapter(responseContent: string | object): LLMAdapter {
  const content = typeof responseContent === 'string'
    ? responseContent
    : JSON.stringify(responseContent);
  return {
    name: "test",
    model: "test-model",
    chat: vi.fn().mockResolvedValue({ content }),
    draftGraph: vi.fn(),
    repairGraph: vi.fn(),
    suggestOptions: vi.fn(),
    clarifyBrief: vi.fn(),
    critiqueGraph: vi.fn(),
    explainDiff: vi.fn(),
  } as unknown as LLMAdapter;
}

function makePlotClientSuccess(data?: Record<string, unknown>): PLoTClient {
  const result: ValidatePatchResult = {
    kind: 'success',
    data: { verdict: 'accepted', ...data },
  };
  return {
    run: vi.fn().mockResolvedValue({}),
    validatePatch: vi.fn().mockResolvedValue(result),
  };
}

// ============================================================================
// Golden Fixtures
// ============================================================================

const V2_GOOD_RESPONSE = {
  operations: [
    {
      op: "add_node",
      path: "/nodes/fac_competitor",
      value: {
        id: "fac_competitor",
        kind: "factor",
        label: "Competitor Response",
        category: "external",
        prior: { distribution: "uniform", range_min: 0.0, range_max: 1.0 },
      },
      impact: "moderate",
      rationale: "Adds competitive risk path",
    },
    {
      op: "add_edge",
      path: "/edges/fac_competitor->out_1",
      value: {
        from: "fac_competitor",
        to: "out_1",
        strength: { mean: -0.3, std: 0.15 },
        exists_probability: 0.70,
        effect_direction: "negative",
      },
      impact: "moderate",
      rationale: "Competitor pressure reduces sales",
    },
  ],
  removed_edges: [],
  warnings: ["fac_competitor added as external — if any option affects it, change to controllable"],
  coaching: {
    summary: "Added a competitor response factor connected to sales outcome.",
    rerun_recommended: true,
  },
};

const V2_EMPTY_OPS_RESPONSE = {
  operations: [],
  removed_edges: [],
  warnings: ["The relationship factor_1→out_1 already exists (mean=0.5, exists_probability=0.9)."],
  coaching: {
    summary: "This link is already in your model. Want me to adjust its strength?",
    rerun_recommended: false,
  },
};

// ============================================================================
// Parser Tests
// ============================================================================

describe("parseEditGraphResponse", () => {
  // Test 1: Valid JSON object response
  it("parses a valid v2 JSON object response", () => {
    const result = parseEditGraphResponse(JSON.stringify(V2_GOOD_RESPONSE));

    expect(result.operations).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.coaching).not.toBeNull();
    expect(result.coaching!.summary).toContain("competitor response");
    expect(result.coaching!.rerun_recommended).toBe(true);
  });

  // Test 2: Legacy array response — detected and logged
  it("detects and parses legacy array response", () => {
    const legacyOps = [
      { op: "add_node", path: "nodes/new", value: { id: "new", kind: "factor", label: "X" } },
    ];
    const result = parseEditGraphResponse(JSON.stringify(legacyOps));

    expect(result.operations).toHaveLength(1);
    expect(result.removed_edges).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.coaching).toBeNull();
  });

  // Test 3: Malformed JSON — graceful error
  it("throws on malformed JSON", () => {
    expect(() => parseEditGraphResponse("not json at all")).toThrow("No valid JSON found");
  });

  it("throws on response with no operations field", () => {
    expect(() => parseEditGraphResponse('{ "warnings": ["bad"] }')).toThrow("missing required");
  });

  // Test 4: Path syntax normalisation — /nodes/fac_x/label
  it("normalises /nodes/<id>/<field> path syntax", () => {
    const response = {
      operations: [
        {
          op: "update_node",
          path: "/nodes/factor_1/label",
          value: "New Label",
          old_value: "Old Label",
          impact: "low",
          rationale: "Rename",
        },
      ],
      warnings: [],
      coaching: null,
    };
    const result = parseEditGraphResponse(JSON.stringify(response));

    // Path should be normalised to bare ID
    expect(result.operations[0].path).toBe("factor_1");
    // Scalar value should be wrapped into { field: value } for update ops
    expect(result.operations[0].value).toEqual({ label: "New Label" });
    expect(result.operations[0].old_value).toEqual({ label: "Old Label" });
  });

  // Test 5: Path syntax — /edges/fac_a->out_b/strength.mean
  it("normalises /edges/<from>-><to>/<field> path syntax", () => {
    const response = {
      operations: [
        {
          op: "update_edge",
          path: "/edges/factor_1->out_1/strength.mean",
          value: 0.7,
          old_value: 0.4,
          impact: "high",
          rationale: "Strengthen edge",
        },
      ],
      warnings: [],
      coaching: null,
    };
    const result = parseEditGraphResponse(JSON.stringify(response));

    expect(result.operations[0].path).toBe("factor_1::out_1");
    expect(result.operations[0].value).toEqual({ "strength.mean": 0.7 });
    expect(result.operations[0].old_value).toEqual({ "strength.mean": 0.4 });
  });

  // Markdown fence handling
  it("extracts JSON from markdown fenced code block", () => {
    const wrapped = '```json\n' + JSON.stringify(V2_GOOD_RESPONSE) + '\n```';
    const result = parseEditGraphResponse(wrapped);

    expect(result.operations).toHaveLength(2);
    expect(result.coaching).not.toBeNull();
  });

  // Nested strength normalisation
  it("flattens nested strength: { mean, std } to strength_mean, strength_std", () => {
    const response = {
      operations: [
        {
          op: "add_edge",
          path: "/edges/factor_1->goal_1",
          value: {
            from: "factor_1",
            to: "goal_1",
            strength: { mean: 0.6, std: 0.15 },
            exists_probability: 0.8,
            effect_direction: "positive",
          },
          impact: "moderate",
          rationale: "Test",
        },
      ],
      warnings: [],
      coaching: null,
    };
    const result = parseEditGraphResponse(JSON.stringify(response));

    const value = result.operations[0].value as Record<string, unknown>;
    expect(value.strength_mean).toBe(0.6);
    expect(value.strength_std).toBe(0.15);
    expect(value.strength).toBeUndefined();
  });
});

// ============================================================================
// classifyEditIntent Tests
// ============================================================================

describe("classifyEditIntent", () => {
  it("classifies value updates as parameter_update", () => {
    expect(classifyEditIntent("Set customer willingness to pay high")).toBe("parameter_update");
  });

  it("classifies option configuration requests as option_configuration", () => {
    expect(classifyEditIntent("Configure the premium option to increase price")).toBe("option_configuration");
  });

  it("classifies topology changes as structural", () => {
    expect(classifyEditIntent("Add a competitor factor")).toBe("structural");
  });
});

describe("target resolution and resolution modes", () => {
  it("resolves exact label matches with high confidence", () => {
    const resolution = resolveEditTarget("Set Price higher", makeContext());
    expect(resolution.match_type).toBe("exact_label");
    expect(resolution.confidence).toBe("high");
    expect(resolution.resolved_target?.label).toBe("Price");
  });

  it("resolves alias matches with high confidence", () => {
    const resolution = resolveEditTarget(
      "Set onboarding to 2 months",
      makeContext({
        graph: {
          nodes: [
            { id: "f1", kind: "factor", label: "Onboarding Time" },
            { id: "f2", kind: "factor", label: "Hiring Delay" },
          ],
          edges: [],
        } as unknown as ConversationContext["graph"],
      }),
    );

    expect(resolution.match_type).toBe("alias");
    expect(resolution.confidence).toBe("high");
    expect(resolution.resolved_target?.label).toBe("Onboarding Time");
  });

  it("uses conversational active_entities for pronoun/coreference resolution", () => {
    const resolution = resolveEditTarget(
      "Set it to 2 months",
      makeContext({
        graph: {
          nodes: [{ id: "f1", kind: "factor", label: "Onboarding Time" }],
          edges: [],
        } as unknown as ConversationContext["graph"],
        conversational_state: {
          active_entities: ["Onboarding Time"],
          stated_constraints: [],
          current_topic: "editing",
          last_failed_action: null,
        },
      }),
    );

    expect(resolution.match_type).toBe("active_entity");
    expect(resolution.confidence).toBe("high");
    expect(resolution.resolved_target?.label).toBe("Onboarding Time");
  });

  it("returns clarify mode for ambiguous alias matches", () => {
    const context = makeContext({
      graph: {
        nodes: [
          { id: "f1", kind: "factor", label: "Onboarding Time" },
          { id: "f2", kind: "factor", label: "Hiring Delay" },
        ],
        edges: [],
      } as unknown as ConversationContext["graph"],
    });
    const resolution = resolveEditTarget("Set ramp-up time to 2 months", context);

    expect(resolution.match_type).toBe("ambiguous");
    expect(resolution.alternatives.map((candidate) => candidate.label)).toEqual([
      "Onboarding Time",
      "Hiring Delay",
    ]);
    expect(determineEditResolutionMode("Set ramp-up time to 2 months", context)).toBe("clarify");
  });

  it("returns propose_and_confirm for compound edits against one resolved target", () => {
    const context = makeContext();
    expect(determineEditResolutionMode("Update Price and also rename Price", context)).toBe("propose_and_confirm");
  });
});

// ============================================================================
// Operation Mapping Tests
// ============================================================================

describe("operation mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 6: Each op type mapped correctly without impact/rationale
  it("strips impact and rationale from PatchOperation (add_node)", async () => {
    const response = {
      operations: [
        {
          op: "add_node",
          path: "/nodes/fac_new",
          value: { id: "fac_new", kind: "factor", label: "New" },
          impact: "moderate",
          rationale: "User requested",
        },
      ],
      warnings: [],
      coaching: { summary: "Added new factor.", rerun_recommended: false },
    };
    const adapter = makeAdapter(response);
    const result = await handleEditGraph(
      makeContext(),
      "Add a new factor",
      adapter,
      "req-1",
      "turn-1",
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    const op = data.operations[0];
    // impact and rationale must NOT be on PatchOperation
    expect((op as unknown as Record<string, unknown>).impact).toBeUndefined();
    expect((op as unknown as Record<string, unknown>).rationale).toBeUndefined();
    expect(op.op).toBe("add_node");
    expect(op.path).toBe("fac_new");
  });

  // Test 7: impact/rationale preserved as block metadata
  it("stores operation metadata in block provenance _meta", async () => {
    const response = {
      operations: [
        {
          op: "update_node",
          path: "/nodes/factor_1",
          value: { label: "Updated" },
          impact: "high",
          rationale: "User requested rename",
        },
      ],
      warnings: [],
      coaching: { summary: "Renamed factor.", rerun_recommended: false },
    };
    const adapter = makeAdapter(response);
    const result = await handleEditGraph(
      makeContext(),
      "Rename factor",
      adapter,
      "req-1",
      "turn-1",
    );

    const block = result.blocks[0];
    const meta = (block.provenance as unknown as Record<string, unknown>)._meta as Record<string, unknown>;
    expect(meta).toBeDefined();
    const opMeta = meta.operation_meta as Array<{ impact: string; rationale: string }>;
    expect(opMeta[0].impact).toBe("high");
    expect(opMeta[0].rationale).toBe("User requested rename");
  });

  // Test 8: removed_edges stored in debug payload
  it("stores removed_edges in block provenance _meta", async () => {
    const response = {
      operations: [
        {
          op: "remove_edge",
          path: "/edges/factor_1->out_1",
          old_value: { from: "factor_1", to: "out_1" },
          impact: "moderate",
          rationale: "Remove before node removal",
        },
        {
          op: "remove_node",
          path: "/nodes/factor_1",
          old_value: { id: "factor_1", kind: "factor", label: "Price" },
          impact: "high",
          rationale: "User requested removal",
        },
      ],
      removed_edges: [
        { from: "factor_1", to: "out_1", reason: "Parent node factor_1 removed" },
      ],
      warnings: [],
      coaching: { summary: "Removed price factor.", rerun_recommended: true },
    };
    const adapter = makeAdapter(response);
    const result = await handleEditGraph(
      makeContext(),
      "Remove the price factor",
      adapter,
      "req-1",
      "turn-1",
    );

    const block = result.blocks[0];
    const meta = (block.provenance as unknown as Record<string, unknown>)._meta as Record<string, unknown>;
    expect(meta).toBeDefined();
    expect(meta.removed_edges).toEqual([
      { from: "factor_1", to: "out_1", reason: "Parent node factor_1 removed" },
    ]);
  });
});

// ============================================================================
// Envelope / Coaching Tests
// ============================================================================

describe("envelope and coaching wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 9: Non-empty operations → assistant_text is coaching.summary + warnings appended
  it("sets assistant_text to coaching.summary with warnings appended for non-empty ops", async () => {
    const adapter = makeAdapter(V2_GOOD_RESPONSE);
    const result = await handleEditGraph(
      makeContext(),
      "Add competitor",
      adapter,
      "req-1",
      "turn-1",
    );

    expect(result.assistantText).not.toBeNull();
    expect(result.assistantText).toContain("Added a competitor response factor");
    expect(result.assistantText).toContain("Note:");
    expect(result.assistantText).toContain("fac_competitor added as external");
  });

  // Test 10: Empty operations → assistant_text is warnings + coaching
  it("sets assistant_text to warnings then coaching.summary for empty ops", async () => {
    const adapter = makeAdapter(V2_EMPTY_OPS_RESPONSE);
    const result = await handleEditGraph(
      makeContext(),
      "Does factor_1 affect out_1?",
      adapter,
      "req-1",
      "turn-1",
    );

    expect(result.assistantText).not.toBeNull();
    expect(result.assistantText).toContain("already exists");
    expect(result.assistantText).toContain("already in your model");
  });

  // Test 11: substantive ops (add_node/add_edge) + prior analysis → suggested action chip
  it("includes 'Re-run analysis' chip when rerun_recommended is true", async () => {
    const adapter = makeAdapter(V2_GOOD_RESPONSE);
    // rerun_recommended is now deterministic: requires prior analysis + substantive ops
    const contextWithAnalysis = makeContext({
      analysis_response: {
        meta: { seed_used: 1, n_samples: 100, response_hash: "h" },
        results: [{ option_label: "A", win_probability: 0.6 }],
      } as never,
    });
    const result = await handleEditGraph(
      contextWithAnalysis,
      "Add competitor",
      adapter,
      "req-1",
      "turn-1",
    );

    expect(result.suggestedActions).toBeDefined();
    expect(result.suggestedActions).toHaveLength(1);
    expect(result.suggestedActions![0].label).toBe("Re-run analysis");
    expect(result.suggestedActions![0].role).toBe("facilitator");
  });

  // Test 12: coaching.rerun_recommended: false → no rerun chip
  it("omits rerun chip when rerun_recommended is false", async () => {
    const response = {
      operations: [
        {
          op: "update_node",
          path: "/nodes/factor_1",
          value: { label: "Renamed" },
          impact: "low",
          rationale: "Cosmetic rename",
        },
      ],
      warnings: [],
      coaching: { summary: "Renamed the factor.", rerun_recommended: false },
    };
    const adapter = makeAdapter(response);
    const result = await handleEditGraph(
      makeContext(),
      "Rename factor",
      adapter,
      "req-1",
      "turn-1",
    );

    expect(result.suggestedActions).toBeUndefined();
  });

  it("returns clarify output with suggestion chips for ambiguous targets", async () => {
    const adapter = makeAdapter(V2_GOOD_RESPONSE);
    const result = await handleEditGraph(
      makeContext({
        graph: {
          nodes: [
            { id: "f1", kind: "factor", label: "Onboarding Time" },
            { id: "f2", kind: "factor", label: "Hiring Delay" },
          ],
          edges: [],
        } as unknown as ConversationContext["graph"],
      }),
      "Set ramp-up time to 2 months",
      adapter,
      "req-clarify",
      "turn-clarify",
    );

    expect(result.blocks).toEqual([]);
    expect(result.wasRejected).toBe(true);
    expect(result.assistantText).toContain("Which one should I update");
    expect(result.suggestedActions?.map((action) => action.label)).toEqual([
      "Onboarding Time",
      "Hiring Delay",
    ]);
    expect((adapter.chat as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(result.diagnostics?.resolution_mode).toBe("clarify");
    expect(result.diagnostics?.target_resolution?.alternatives_count).toBe(2);
  });

  it("returns minimal proposed_changes for compound edits without executing the LLM path", async () => {
    const adapter = makeAdapter(V2_GOOD_RESPONSE);
    const result = await handleEditGraph(
      makeContext(),
      "Update Price and also lower Price",
      adapter,
      "req-proposal",
      "turn-proposal",
    );

    expect(result.blocks).toEqual([]);
    expect(result.wasRejected).toBe(false);
    expect(result.proposedChanges).toEqual({
      changes: [
        { description: "Update Price", element_label: "Price", action_type: "value_update" },
        { description: "Also lower Price", element_label: "Price", action_type: "value_update" },
      ],
    });
    expect((adapter.chat as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(result.diagnostics?.resolution_mode).toBe("propose_and_confirm");
    expect(result.diagnostics?.proposal_returned).toBe(true);
  });

  it("constrains auto-apply prompt with the resolved target label context", async () => {
    const adapter = makeAdapter({
      operations: [
        {
          op: "update_node",
          path: "/nodes/f1",
          value: { value: "2 months" },
          old_value: { value: "1 month" },
          impact: "low",
          rationale: "Update onboarding time",
        },
      ],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Updated onboarding time.", rerun_recommended: false },
    });

    await handleEditGraph(
      makeContext({
        graph: {
          nodes: [{ id: "f1", kind: "factor", label: "Onboarding Time" }],
          edges: [],
        } as unknown as ConversationContext["graph"],
      }),
      "Set onboarding to 2 months",
      adapter,
      "req-auto-apply",
      "turn-auto-apply",
    );

    const firstCall = (adapter.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstCall.system).toContain("Apply this request to the existing Onboarding Time factor only.");
  });
});

// ============================================================================
// Empty Operations (Integration Tests)
// ============================================================================

describe("empty operations handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 13: Does NOT create a GraphPatchBlock
  it("returns no blocks for empty operations", async () => {
    const adapter = makeAdapter(V2_EMPTY_OPS_RESPONSE);
    const result = await handleEditGraph(
      makeContext(),
      "Does this edge exist?",
      adapter,
      "req-1",
      "turn-1",
    );

    expect(result.blocks).toHaveLength(0);
  });

  // Test 14: Does NOT hit patch validation/apply pipeline
  it("does not call PLoT validatePatch for empty operations", async () => {
    const adapter = makeAdapter(V2_EMPTY_OPS_RESPONSE);
    const plotClient = makePlotClientSuccess();

    const result = await handleEditGraph(
      makeContext(),
      "Already exists?",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    expect(plotClient.validatePatch).not.toHaveBeenCalled();
    expect(result.blocks).toHaveLength(0);
  });

  // Test 15: Does NOT surface as an error envelope
  it("does not set wasRejected for empty operations", async () => {
    const adapter = makeAdapter(V2_EMPTY_OPS_RESPONSE);
    const result = await handleEditGraph(
      makeContext(),
      "Already exists?",
      adapter,
      "req-1",
      "turn-1",
    );

    expect(result.wasRejected).toBe(false);
    expect(result.assistantText).not.toBeNull();
  });
});

// ============================================================================
// Full Round-trip Test
// ============================================================================

describe("full round-trip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 16: Valid operations → GraphPatchBlock with correct PatchOperation[] shape
  it("produces a valid GraphPatchBlock from v2 response", async () => {
    const adapter = makeAdapter(V2_GOOD_RESPONSE);
    const result = await handleEditGraph(
      makeContext(),
      "Add competitor factor",
      adapter,
      "req-1",
      "turn-1",
    );

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe("graph_patch");

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.patch_type).toBe("edit");
    expect(data.status).toBe("proposed");
    expect(data.operations).toHaveLength(2);

    // add_node
    expect(data.operations[0].op).toBe("add_node");
    expect(data.operations[0].path).toBe("fac_competitor");

    // add_edge — strength should be flattened
    expect(data.operations[1].op).toBe("add_edge");
    expect(data.operations[1].path).toBe("fac_competitor::out_1");
    const edgeValue = data.operations[1].value as Record<string, unknown>;
    expect(edgeValue.strength_mean).toBe(-0.3);
    expect(edgeValue.strength_std).toBe(0.15);

    // No impact/rationale on canonical PatchOperations
    for (const op of data.operations) {
      expect((op as unknown as Record<string, unknown>).impact).toBeUndefined();
      expect((op as unknown as Record<string, unknown>).rationale).toBeUndefined();
    }
  });
});

// ============================================================================
// Golden Fixture Tests
// ============================================================================

describe("golden fixtures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 17: Good response fixture parses correctly
  it("parses the golden 'good response' fixture", () => {
    const result = parseEditGraphResponse(JSON.stringify(V2_GOOD_RESPONSE));

    expect(result.operations).toHaveLength(2);
    expect(result.operations[0].op).toBe("add_node");
    expect(result.operations[1].op).toBe("add_edge");
    expect(result.warnings).toHaveLength(1);
    expect(result.coaching!.rerun_recommended).toBe(true);
  });

  // Test 18: Empty operations fixture
  it("parses the golden 'empty operations' fixture", () => {
    const result = parseEditGraphResponse(JSON.stringify(V2_EMPTY_OPS_RESPONSE));

    expect(result.operations).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("already exists");
    expect(result.coaching!.rerun_recommended).toBe(false);
  });
});

// ============================================================================
// Prompt Loading Test
// ============================================================================

describe("prompt loading", () => {
  // Test 19a: Handler loads prompt via getSystemPrompt('edit_graph')
  it("uses prompt-loader for edit_graph system prompt", async () => {
    const { getSystemPrompt } = await import("../../../../src/adapters/llm/prompt-loader.js");
    const adapter = makeAdapter(V2_GOOD_RESPONSE);

    await handleEditGraph(
      makeContext(),
      "Add competitor",
      adapter,
      "req-1",
      "turn-1",
    );

    expect(getSystemPrompt).toHaveBeenCalledWith("edit_graph");
  });

  it("steers narrow value edits toward field-level updates in the system prompt", async () => {
    const adapter = makeAdapter({
      operations: [
        {
          op: "update_node",
          path: "/nodes/factor_1/data.value",
          value: "high",
          old_value: "medium",
          impact: "low",
          rationale: "Update the existing factor value",
        },
      ],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Updated the factor value.", rerun_recommended: false },
    });

    const result = await handleEditGraph(
      makeContext(),
      "Set customer willingness to pay high",
      adapter,
      "req-narrow-prompt",
      "turn-narrow-prompt",
    );

    const firstCall = (adapter.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstCall.system).toContain("Prefer update_node or update_edge operations only.");
    expect(firstCall.system).not.toContain("Prefer the narrowest valid update to an existing option");
    expect(result.diagnostics?.classified_intent).toBe("parameter_update");
    expect(result.diagnostics?.instruction_mode_applied).toBe("narrow_parameter_update");
    expect(result.diagnostics?.operations_proposed_count).toBe(1);
    expect(result.diagnostics?.operations_proposed_types).toEqual(["update_node"]);
    expect(result.diagnostics?.validation_outcome).toBe("success");
    expect(result.diagnostics?.edit_instruction_preview).toContain("Prefer update_node or update_edge operations only.");
  });

  it("uses option_configuration narrow instruction path for option updates", async () => {
    const adapter = makeAdapter({
      operations: [
        {
          op: "update_node",
          path: "/nodes/factor_1/label",
          value: "Premium Option Price",
          old_value: "Price",
          impact: "low",
          rationale: "Adjust option configuration label",
        },
      ],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Updated option configuration.", rerun_recommended: false },
    });

    const result = await handleEditGraph(
      makeContext({
        graph: {
          nodes: [
            { id: "goal_1", kind: "goal", label: "Revenue" },
            { id: "factor_1", kind: "option", label: "Premium Option" },
          ],
          edges: [],
        } as unknown as ConversationContext["graph"],
      }),
      "Configure the premium option to change pricing",
      adapter,
      "req-option-prompt",
      "turn-option-prompt",
    );

    const firstCall = (adapter.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstCall.system).toContain("This is an option/intervention configuration update.");
    expect(firstCall.system).toContain("Prefer the narrowest valid update to an existing option or intervention field.");
    expect(result.diagnostics?.classified_intent).toBe("option_configuration");
    expect(result.diagnostics?.instruction_mode_applied).toBe("narrow_option_configuration");
    expect(result.diagnostics?.validation_outcome).toBe("success");
  });

  it("keeps structural intent on structural validation path", async () => {
    const structuralInvalidResponse = {
      operations: [
        {
          op: "add_edge",
          path: "/edges/missing_factor->out_1",
          value: {
            from: "missing_factor",
            to: "out_1",
            strength: { mean: 0.4, std: 0.1 },
            exists_probability: 0.8,
            effect_direction: "positive",
          },
          impact: "high",
          rationale: "Add missing structural edge",
        },
      ],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Added edge.", rerun_recommended: false },
    };
    const adapter = {
      ...makeAdapter(structuralInvalidResponse),
      chat: vi.fn()
        .mockResolvedValueOnce({ content: JSON.stringify(structuralInvalidResponse) })
        .mockResolvedValueOnce({ content: JSON.stringify(structuralInvalidResponse) }),
    } as unknown as LLMAdapter;

    const result = await handleEditGraph(
      makeContext(),
      "Add a competitor factor and connect it to sales",
      adapter,
      "req-structural",
      "turn-structural",
    );

    expect(result.wasRejected).toBe(true);
    expect(result.diagnostics?.classified_intent).toBe("structural");
    expect(result.diagnostics?.instruction_mode_applied).toBe("structural_default");
    expect(result.diagnostics?.validation_outcome).toBe("structural_validation_failed");
    expect(result.diagnostics?.recovery_path_chosen).toBe("rejection_block");
  });

  it("includes diagnostics on budget_exceeded early exit", async () => {
    patchBudgetEnabledForTest = true;

    const adapter = makeAdapter({
      operations: [
        { op: "update_node", path: "/nodes/factor_1/label", value: "Price A", old_value: "Price", impact: "low", rationale: "A" },
        { op: "update_node", path: "/nodes/factor_1/label", value: "Price B", old_value: "Price A", impact: "low", rationale: "B" },
        { op: "update_node", path: "/nodes/factor_1/label", value: "Price C", old_value: "Price B", impact: "low", rationale: "C" },
        { op: "update_node", path: "/nodes/factor_1/label", value: "Price D", old_value: "Price C", impact: "low", rationale: "D" },
      ],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Updated labels.", rerun_recommended: false },
    });

    const result = await handleEditGraph(
      makeContext(),
      "Set customer willingness to pay higher",
      adapter,
      "req-budget",
      "turn-budget",
    );

    expect(result.wasRejected).toBe(true);
    expect(result.blocks).toEqual([]);
    expect(result.diagnostics?.validation_outcome).toBe("budget_exceeded");
    expect(result.diagnostics?.validation_violation_codes).toEqual(["budget_exceeded"]);
    expect(result.diagnostics?.recovery_path_chosen).toBe("rejection_block");
    expect(result.diagnostics?.operations_proposed_count).toBe(4);
  });

  it("includes diagnostics on graph_structure_invalid early exit", async () => {
    patchPreValidationEnabledForTest = true;

    const adapter = makeAdapter({
      operations: [
        {
          op: "remove_node",
          path: "/nodes/goal_1",
          old_value: { id: "goal_1", kind: "goal", label: "Revenue" },
          impact: "high",
          rationale: "Remove goal node",
        },
      ],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Removed goal.", rerun_recommended: false },
    });

    const result = await handleEditGraph(
      makeContext(),
      "Remove goal node",
      adapter,
      "req-struct-invalid",
      "turn-struct-invalid",
    );

    expect(result.wasRejected).toBe(true);
    expect(result.blocks).toEqual([]);
    expect(result.diagnostics?.validation_outcome).toBe("graph_structure_invalid");
    expect(result.diagnostics?.validation_violation_codes.length).toBeGreaterThan(0);
  });

  it("returns a concise recovery question after repeated structural outputs for a narrow request", async () => {
    const structuralResponse = {
      operations: [
        {
          op: "add_node",
          path: "/nodes/fac_customer_willingness",
          value: { id: "fac_customer_willingness", kind: "factor", label: "Customer Willingness To Pay" },
          impact: "moderate",
          rationale: "Create a new factor for willingness to pay",
        },
      ],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Added a new factor.", rerun_recommended: false },
    };
    const adapter = {
      ...makeAdapter(structuralResponse),
      chat: vi.fn()
        .mockResolvedValueOnce({ content: JSON.stringify(structuralResponse) })
        .mockResolvedValueOnce({ content: JSON.stringify(structuralResponse) }),
    } as unknown as LLMAdapter;

    const result = await handleEditGraph(
      makeContext(),
      "Set customer willingness to pay high",
      adapter,
      "req-recovery",
      "turn-recovery",
    );

    expect(result.blocks).toEqual([]);
    expect(result.wasRejected).toBe(true);
    expect(result.assistantText).toContain("Which existing factor or edge should I update");
    expect((adapter.chat as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  // Test 19b: Default prompt contains v2-specific content (not old inline prompt)
  it("default EDIT_GRAPH_PROMPT contains v2 unique strings", async () => {
    const { EDIT_GRAPH_PROMPT } = await import("../../../../src/prompts/defaults.js");

    // Unique v2 strings that don't exist in the old prompt
    expect(EDIT_GRAPH_PROMPT).toContain("TOPOLOGY_RULES");
    expect(EDIT_GRAPH_PROMPT).toContain("CONTRASTIVE_EXAMPLES");
    expect(EDIT_GRAPH_PROMPT).toContain("IMPACT_ASSESSMENT");
    expect(EDIT_GRAPH_PROMPT).toContain("coaching");
    // Must NOT contain the old instruction to return a bare array
    expect(EDIT_GRAPH_PROMPT).not.toContain("Respond ONLY with a JSON array");
  });
});

// ============================================================================
// All 6 op types
// ============================================================================

describe("all op types through v2 parser", () => {
  const makeResponse = (ops: Record<string, unknown>[]) => ({
    operations: ops.map(op => ({ ...op, impact: "low", rationale: "test" })),
    warnings: [],
    coaching: null,
  });

  it("add_node with /nodes/ path", () => {
    const result = parseEditGraphResponse(JSON.stringify(makeResponse([
      { op: "add_node", path: "/nodes/fac_x", value: { id: "fac_x", kind: "factor", label: "X" } },
    ])));
    expect(result.operations[0].path).toBe("fac_x");
    expect(result.operations[0].op).toBe("add_node");
  });

  it("remove_node with /nodes/ path", () => {
    const result = parseEditGraphResponse(JSON.stringify(makeResponse([
      { op: "remove_node", path: "/nodes/fac_x", old_value: { id: "fac_x" } },
    ])));
    expect(result.operations[0].path).toBe("fac_x");
  });

  it("update_node with /nodes/<id>/<field> path", () => {
    const result = parseEditGraphResponse(JSON.stringify(makeResponse([
      { op: "update_node", path: "/nodes/fac_x/label", value: "New", old_value: "Old" },
    ])));
    expect(result.operations[0].path).toBe("fac_x");
    expect(result.operations[0].value).toEqual({ label: "New" });
  });

  it("add_edge with /edges/ path and nested strength", () => {
    const result = parseEditGraphResponse(JSON.stringify(makeResponse([
      {
        op: "add_edge",
        path: "/edges/fac_x->out_y",
        value: { from: "fac_x", to: "out_y", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: "positive" },
      },
    ])));
    expect(result.operations[0].path).toBe("fac_x::out_y");
    const val = result.operations[0].value as Record<string, unknown>;
    expect(val.strength_mean).toBe(0.5);
    expect(val.strength_std).toBe(0.1);
  });

  it("remove_edge with /edges/ path", () => {
    const result = parseEditGraphResponse(JSON.stringify(makeResponse([
      { op: "remove_edge", path: "/edges/fac_x->out_y", old_value: { from: "fac_x", to: "out_y" } },
    ])));
    expect(result.operations[0].path).toBe("fac_x::out_y");
  });

  it("update_edge with /edges/<from>-><to>/<field> path", () => {
    const result = parseEditGraphResponse(JSON.stringify(makeResponse([
      { op: "update_edge", path: "/edges/fac_x->out_y/strength.mean", value: 0.9, old_value: 0.5 },
    ])));
    expect(result.operations[0].path).toBe("fac_x::out_y");
    expect(result.operations[0].value).toEqual({ "strength.mean": 0.9 });
  });
});

// ============================================================================
// LLM warnings surfaced in validation_warnings on block
// ============================================================================

// ============================================================================
// Baseline structural violations — edits on incomplete graphs
// ============================================================================

describe("baseline structural violations (pre-existing violations ignored)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patchPreValidationEnabledForTest = true;
  });

  it("allows factor update on graph with no options (pre-existing FEWER_THAN_TWO_OPTIONS)", async () => {
    // Graph has goal + factor but no decision or options.
    // Pre-existing violations: NO_DECISION, FEWER_THAN_TWO_OPTIONS.
    // A simple label update should NOT be blocked by these.
    const adapter = makeAdapter({
      operations: [
        {
          op: "update_node",
          path: "/nodes/factor_1",
          value: { label: "Updated Price" },
          impact: "low",
          rationale: "Rename factor",
        },
      ],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Updated label.", rerun_recommended: false },
    });

    const result = await handleEditGraph(
      makeContext(),
      "Update the price factor label",
      adapter,
      "req-baseline-1",
      "turn-baseline-1",
    );

    expect(result.wasRejected).toBe(false);
    expect(result.blocks).toHaveLength(1);
    expect((result.blocks[0].data as GraphPatchBlockData).status).toBe("proposed");
  });

  it("still rejects edit that introduces a NEW structural violation", async () => {
    // Removing the goal introduces NO_GOAL — a new violation not in baseline.
    const adapter = makeAdapter({
      operations: [
        {
          op: "remove_node",
          path: "/nodes/goal_1",
          old_value: { id: "goal_1", kind: "goal", label: "Revenue" },
          impact: "high",
          rationale: "Remove goal",
        },
      ],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Removed goal.", rerun_recommended: false },
    });

    const result = await handleEditGraph(
      makeContext(),
      "Remove goal node",
      adapter,
      "req-baseline-2",
      "turn-baseline-2",
    );

    expect(result.wasRejected).toBe(true);
  });

  it("rejects edit that adds a second orphan when baseline already has one (same-code count delta)", async () => {
    // Input graph: goal + factor + outcome (connected) + an ORPHAN node (fac_orphan, no edges).
    // Baseline has 1× ORPHAN_NODE. Edit adds another disconnected node → 2× ORPHAN_NODE.
    // Count delta: 2 - 1 = 1 new violation → must reject.
    const graphWithOrphan = {
      nodes: [
        { id: "goal_1", kind: "goal", label: "Revenue" },
        { id: "factor_1", kind: "factor", label: "Price" },
        { id: "out_1", kind: "outcome", label: "Sales" },
        { id: "fac_orphan", kind: "factor", label: "Orphan Factor" }, // pre-existing orphan
      ],
      edges: [
        {
          from: "factor_1",
          to: "out_1",
          strength_mean: 0.5,
          strength_std: 0.1,
          exists_probability: 0.9,
          effect_direction: "positive",
        },
        {
          from: "out_1",
          to: "goal_1",
          strength_mean: 0.8,
          strength_std: 0.05,
          exists_probability: 1.0,
          effect_direction: "positive",
        },
      ],
    } as unknown as ConversationContext["graph"];

    const adapter = makeAdapter({
      operations: [
        {
          op: "add_node",
          path: "/nodes/fac_new_orphan",
          value: { id: "fac_new_orphan", kind: "factor", label: "New Orphan" },
          impact: "low",
          rationale: "Add unconnected factor",
        },
      ],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Added factor.", rerun_recommended: false },
    });

    const result = await handleEditGraph(
      makeContext({ graph: graphWithOrphan }),
      "Add a new factor",
      adapter,
      "req-same-code",
      "turn-same-code",
    );

    // Must reject: the edit introduced a NEW orphan (same code as baseline, but count increased)
    expect(result.wasRejected).toBe(true);
  });
});

// ============================================================================
// LLM warnings surfaced in validation_warnings on block
// ============================================================================

describe("LLM warnings surfaced on block", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes LLM warnings in block validation_warnings", async () => {
    const adapter = makeAdapter(V2_GOOD_RESPONSE);
    const result = await handleEditGraph(
      makeContext(),
      "Add competitor",
      adapter,
      "req-1",
      "turn-1",
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.validation_warnings).toBeDefined();
    expect(data.validation_warnings!.some(w => w.includes("fac_competitor added as external"))).toBe(true);
  });
});
