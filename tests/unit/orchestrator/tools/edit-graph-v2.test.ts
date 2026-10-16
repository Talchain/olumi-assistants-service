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
  // The edit/review lanes resolve prompt bytes AND identity in ONE bound
  // `getSystemPromptSnapshot` call. A mock factory REPLACES the module, so
  // omitting this export hands the code under test `undefined` (trap 12).
  // Content and meta mirror the two mocks above deliberately: production
  // binds them to one resolution, and the mock must not model them as
  // independently divergent.
  getSystemPromptSnapshot: vi.fn().mockResolvedValue({
    content: "You edit causal decision graphs",
    meta: { source: 'default', prompt_version: 'v2' },
  }),
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

import { classifyEditIntent, determineEditResolutionMode, parseEditGraphResponse, resolveEditTarget } from "../../../../src/orchestrator/tools/edit-graph.js";
import type { ConversationContext } from "../../../../src/orchestrator/types.js";

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
  //
  // Phase 2A contract change (deliberate, called out in Phase 2A report):
  // the bare-array branch of parseEditGraphResponse previously set
  // coaching=null. As of Phase 2A it populates safe defaults
  // ({ summary: "Proposed graph edit.", rerun_recommended: false }) so
  // that the success-path text builder produces a non-null assistantText.
  // The previous `expect(result.coaching).toBeNull()` assertion was
  // updated to assert the safe-default shape. See
  // Docs/edit_graph_v9_deferred_items.md (DL-5, DL-5b) for the wider
  // workstream context and
  // tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts
  // (A5) for the canonical Phase 2A contract.
  it("detects and parses legacy array response", () => {
    const legacyOps = [
      { op: "add_node", path: "nodes/new", value: { id: "new", kind: "factor", label: "X" } },
    ];
    const result = parseEditGraphResponse(JSON.stringify(legacyOps));

    expect(result.operations).toHaveLength(1);
    expect(result.removed_edges).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    // Phase 2A: safe defaults instead of null.
    expect(result.coaching).not.toBeNull();
    expect(result.coaching!.summary).toBe("Proposed graph edit.");
    expect(result.coaching!.rerun_recommended).toBe(false);
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
  it("normalises /edges/<from>-><to>/<field> path syntax and nests dotted keys", () => {
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
    expect(result.operations[0].value).toEqual({ strength: { mean: 0.7 } });
    expect(result.operations[0].old_value).toEqual({ strength: { mean: 0.4 } });
  });

  // Markdown fence handling
  it("extracts JSON from markdown fenced code block", () => {
    const wrapped = '```json\n' + JSON.stringify(V2_GOOD_RESPONSE) + '\n```';
    const result = parseEditGraphResponse(wrapped);

    expect(result.operations).toHaveLength(2);
    expect(result.coaching).not.toBeNull();
  });

  // Nested strength passes through unchanged (no longer flattened)
  it("preserves nested strength: { mean, std } without flattening", () => {
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
    expect(value.strength).toEqual({ mean: 0.6, std: 0.15 });
    expect(value.strength_mean).toBeUndefined();
    expect(value.strength_std).toBeUndefined();
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

  it("token overlap matches fuzzy label like 'competitor pressure' → 'Competitive Pressure'", () => {
    const context = makeContext({
      graph: {
        nodes: [
          { id: "goal_1", kind: "goal", label: "Revenue" },
          { id: "fac_1", kind: "factor", label: "Competitive Pressure" },
          { id: "fac_2", kind: "factor", label: "Market Growth" },
        ],
        edges: [],
      } as unknown as ConversationContext["graph"],
    });

    const resolution = resolveEditTarget("set competitor pressure to high", context);
    expect(resolution.resolved_target?.label).toBe("Competitive Pressure");
    expect(resolution.confidence).toBe("high");
  });

  it("token overlap does not match on stopwords alone", () => {
    const context = makeContext({
      graph: {
        nodes: [
          { id: "goal_1", kind: "goal", label: "Revenue" },
          { id: "fac_1", kind: "factor", label: "High Value Segment" },
          { id: "fac_2", kind: "factor", label: "Brand Awareness" },
        ],
        edges: [],
      } as unknown as ConversationContext["graph"],
    });

    // "set X to high" — "high" and "value" are stopwords, should not match "High Value Segment".
    // Multiple factors prevent graph_local single-factor fallback.
    const resolution = resolveEditTarget("set price to high", context);
    expect(resolution.resolved_target?.label).not.toBe("High Value Segment");
    // With no match, confidence should be low
    expect(resolution.confidence).toBe("low");
  });

  it("token overlap rejects short substring matches like 'rate' inside 'corporate'", () => {
    const context = makeContext({
      graph: {
        nodes: [
          { id: "goal_1", kind: "goal", label: "Revenue" },
          { id: "fac_1", kind: "factor", label: "Corporate Governance" },
          { id: "fac_2", kind: "factor", label: "Churn Rate" },
        ],
        edges: [],
      } as unknown as ConversationContext["graph"],
    });

    // "rate" is 4 chars, "corporate" is 9 chars — ratio 0.44, below 0.6 threshold
    // Should NOT falsely match "Corporate Governance" via "rate" substring
    const resolution = resolveEditTarget("set rate to 5%", context);
    // Should match "Churn Rate" (exact substring "rate" in "churn rate"), not "Corporate Governance"
    expect(resolution.resolved_target?.label).toBe("Churn Rate");
  });

  it("parameter_update with low confidence returns propose_and_confirm", () => {
    const context = makeContext({
      graph: {
        nodes: [
          { id: "goal_1", kind: "goal", label: "Revenue" },
          { id: "fac_1", kind: "factor", label: "Customer Satisfaction Index" },
          { id: "fac_2", kind: "factor", label: "Brand Perception Score" },
        ],
        edges: [],
      } as unknown as ConversationContext["graph"],
    });

    // No exact, alias, or token match for "churn rate" — confidence: low
    const intent = classifyEditIntent("set churn rate to 5%");
    expect(intent).toBe("parameter_update");

    const mode = determineEditResolutionMode("set churn rate to 5%", context);
    // Should propose_and_confirm (let user verify) instead of clarify
    expect(mode).toBe("propose_and_confirm");
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
    expect(val.strength).toEqual({ mean: 0.5, std: 0.1 });
    expect(val.strength_mean).toBeUndefined();
  });

  it("remove_edge with /edges/ path", () => {
    const result = parseEditGraphResponse(JSON.stringify(makeResponse([
      { op: "remove_edge", path: "/edges/fac_x->out_y", old_value: { from: "fac_x", to: "out_y" } },
    ])));
    expect(result.operations[0].path).toBe("fac_x::out_y");
  });

  it("update_edge with /edges/<from>-><to>/<field> path nests dotted key", () => {
    const result = parseEditGraphResponse(JSON.stringify(makeResponse([
      { op: "update_edge", path: "/edges/fac_x->out_y/strength.mean", value: 0.9, old_value: 0.5 },
    ])));
    expect(result.operations[0].path).toBe("fac_x::out_y");
    expect(result.operations[0].value).toEqual({ strength: { mean: 0.9 } });
  });
});
