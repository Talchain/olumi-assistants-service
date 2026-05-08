import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks — must be declared before imports
// ============================================================================

vi.mock("../../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("You are editing a graph."),
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
              // Disable cf-v11.1 pre-validation for legacy tests (tested separately in patch-budget/validator tests)
              if (ceeProp === "patchPreValidationEnabled") return false;
              if (ceeProp === "patchBudgetEnabled") return false;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import { handleEditGraph, mapOpsForPlot } from "../../../../src/orchestrator/tools/edit-graph.js";
import type { ConversationContext, PatchOperation, GraphPatchBlockData } from "../../../../src/orchestrator/types.js";
import type { LLMAdapter } from "../../../../src/adapters/llm/types.js";
import type { PLoTClient, ValidatePatchResult } from "../../../../src/orchestrator/plot-client.js";
import { assertNoBannedInternalTokens } from "../../../helpers/banned-internal-tokens.js";

// ============================================================================
// Helpers
// ============================================================================

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: "goal_1", kind: "goal", label: "Revenue" },
        { id: "factor_1", kind: "factor", label: "Price" },
      ],
      edges: [
        {
          from: "factor_1",
          to: "goal_1",
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: "positive",
        },
      ],
    } as unknown as ConversationContext["graph"],
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: "test-scenario",
    ...overrides,
  };
}

function makeAdapter(responseJson: unknown): LLMAdapter {
  return {
    name: "test",
    model: "test-model",
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify(responseJson),
    }),
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

function makePlotClient(overrides?: Partial<Record<string, unknown>>): PLoTClient {
  return makePlotClientSuccess(overrides);
}

const VALID_ADD_NODE_OP = {
  op: "add_node",
  path: "nodes/new_factor",
  value: { id: "new_factor", kind: "factor", label: "Cost" },
};

const VALID_UPDATE_OP = {
  op: "update_node",
  path: "factor_1",
  value: { label: "Updated Price" },
};

// ============================================================================
// Tests
// ============================================================================

describe("handleEditGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ------------------------------------------------------------------
  // Basic success
  // ------------------------------------------------------------------

  it("returns a GraphPatchBlock on valid operations", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);

    const result = await handleEditGraph(
      makeContext(),
      "Add a cost factor",
      adapter,
      "req-1",
      "turn-1",
    );

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe("graph_patch");
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.patch_type).toBe("edit");
    expect(data.status).toBe("proposed");
    expect(data.operations).toHaveLength(1);
  });

  it("includes base_graph_hash in the block data", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);

    const result = await handleEditGraph(
      makeContext(),
      "Add a cost factor",
      adapter,
      "req-1",
      "turn-1",
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.base_graph_hash).toBeDefined();
    expect(data.base_graph_hash!.length).toBe(16);
  });

  it("returns null assistantText on clean success (no repairs)", async () => {
    const adapter = makeAdapter([VALID_UPDATE_OP]);

    const result = await handleEditGraph(
      makeContext(),
      "Update price label",
      adapter,
      "req-1",
      "turn-1",
    );

    expect(result.assistantText).toBeNull();
  });

  it("reports latencyMs", async () => {
    const adapter = makeAdapter([VALID_UPDATE_OP]);

    const result = await handleEditGraph(
      makeContext(),
      "Update label",
      adapter,
      "req-1",
      "turn-1",
    );

    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  // ------------------------------------------------------------------
  // No graph
  // ------------------------------------------------------------------

  it("throws TOOL_EXECUTION_FAILED when graph is null", async () => {
    const adapter = makeAdapter([]);

    await expect(
      handleEditGraph(
        makeContext({ graph: null }),
        "Add factor",
        adapter,
        "req-1",
        "turn-1",
      ),
    ).rejects.toThrow("no graph in context");
  });

  // ------------------------------------------------------------------
  // Legacy field sanitisation
  // ------------------------------------------------------------------

  it("removes legacy fields (belief, belief_exists, confidence) from operations", async () => {
    const adapter = makeAdapter([
      {
        op: "add_node",
        path: "nodes/new",
        value: { id: "new", kind: "factor", label: "X", belief: 0.8, confidence: "high" },
      },
    ]);

    const result = await handleEditGraph(
      makeContext(),
      "Add node",
      adapter,
      "req-1",
      "turn-1",
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    const value = data.operations[0].value as Record<string, unknown>;
    expect(value.belief).toBeUndefined();
    expect(value.confidence).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // Structural validation → rejection
  // ------------------------------------------------------------------

  it("returns rejection block when all attempts produce invalid ops", async () => {
    // Consistently return an op with an unknown op type (will fail Zod)
    const adapter = makeAdapter([{ op: "bad_op", path: "x" }]);

    const result = await handleEditGraph(
      makeContext(),
      "Do something",
      adapter,
      "req-1",
      "turn-1",
      { maxRetries: 0 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("rejected");
    expect(data.rejection).toBeDefined();
    expect(data.rejection?.code).toBe("STRUCTURAL_VALIDATION_FAILED");
    expect(result.assistantText).toContain("wasn't able");
  });

  it("returns rejection on referential integrity failure (remove non-existent node)", async () => {
    const adapter = makeAdapter([
      { op: "remove_node", path: "ghost_node" },
    ]);

    const result = await handleEditGraph(
      makeContext(),
      "Remove ghost",
      adapter,
      "req-1",
      "turn-1",
      { maxRetries: 0 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("rejected");
    expect(data.rejection?.code).toBe("STRUCTURAL_VALIDATION_FAILED");
  });

  // ------------------------------------------------------------------
  // Repair loop
  // ------------------------------------------------------------------

  it("retries on structural failure and succeeds on second attempt", async () => {
    const adapter = makeAdapter([]);
    const chatMock = adapter.chat as ReturnType<typeof vi.fn>;
    // First call: bad ops, second call: good ops
    chatMock
      .mockResolvedValueOnce({ content: JSON.stringify([{ op: "bad_op", path: "x" }]) })
      .mockResolvedValueOnce({ content: JSON.stringify([VALID_ADD_NODE_OP]) });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { maxRetries: 1 },
    );

    expect(chatMock).toHaveBeenCalledTimes(2);
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
  });

  it("includes error details in repair attempt user message", async () => {
    const adapter = makeAdapter([]);
    const chatMock = adapter.chat as ReturnType<typeof vi.fn>;
    chatMock
      .mockResolvedValueOnce({ content: JSON.stringify([{ op: "remove_node", path: "ghost" }]) })
      .mockResolvedValueOnce({ content: JSON.stringify([VALID_UPDATE_OP]) });

    await handleEditGraph(
      makeContext(),
      "Fix something",
      adapter,
      "req-1",
      "turn-1",
      { maxRetries: 1 },
    );

    const secondCall = chatMock.mock.calls[1];
    const userMessage = secondCall[0].userMessage as string;
    expect(userMessage).toContain("Validation Errors");
    expect(userMessage).toContain("Original Edit Request");
    expect(userMessage).toContain("Fix something");
  });

  // ------------------------------------------------------------------
  // PLoT integration
  // ------------------------------------------------------------------

  it("calls PLoT validatePatch when plotClient is provided", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient();

    await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    expect(plotClient.validatePatch).toHaveBeenCalledOnce();
    const [payload] = (plotClient.validatePatch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.graph).toBeDefined();
    expect(payload.operations).toBeDefined();
    expect(payload.scenario_id).toBe("test-scenario");
  });

  it("returns rejection when PLoT rejects and no retries left", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const rejection: ValidatePatchResult = { kind: 'rejection', status: 'rejected', message: 'Semantic error: self-loop' };
    const plotClient: PLoTClient = {
      run: vi.fn(),
      validatePatch: vi.fn().mockResolvedValue(rejection),
    };

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient, maxRetries: 0 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("rejected");
    expect(data.rejection?.reason).toContain("Semantic error");
    expect(data.rejection?.code).toBe("PLOT_SEMANTIC_REJECTED");
  });

  it("passes through PLoT rejection code and violations", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const rejection: ValidatePatchResult = {
      kind: 'rejection',
      status: 'rejected',
      message: 'Cycle detected between nodes',
      code: 'CYCLE_DETECTED',
      violations: [
        { code: "CYCLE", path: "factor_1::goal_1", message: "Creates cycle" },
      ],
    };
    const plotClient: PLoTClient = {
      run: vi.fn(),
      validatePatch: vi.fn().mockResolvedValue(rejection),
    };

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient, maxRetries: 0 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.rejection?.code).toBe("PLOT_SEMANTIC_REJECTED");
    expect(data.rejection?.plot_code).toBe("CYCLE_DETECTED");
    expect(data.rejection?.plot_violations).toHaveLength(1);
    expect((data.rejection!.plot_violations![0] as Record<string, unknown>).code).toBe("CYCLE");
  });

  it("omits plot_code and plot_violations when PLoT rejects without them", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const rejection: ValidatePatchResult = { kind: 'rejection', status: 'rejected', message: 'Bad patch' };
    const plotClient: PLoTClient = {
      run: vi.fn(),
      validatePatch: vi.fn().mockResolvedValue(rejection),
    };

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient, maxRetries: 0 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.rejection?.code).toBe("PLOT_SEMANTIC_REJECTED");
    expect(data.rejection?.plot_code).toBeUndefined();
    expect(data.rejection?.plot_violations).toBeUndefined();
  });

  it("retries on PLoT rejection and succeeds on second attempt", async () => {
    const adapter = makeAdapter([]);
    const chatMock = adapter.chat as ReturnType<typeof vi.fn>;
    chatMock
      .mockResolvedValueOnce({ content: JSON.stringify([VALID_ADD_NODE_OP]) })
      .mockResolvedValueOnce({ content: JSON.stringify([VALID_UPDATE_OP]) });

    const plotClient = makePlotClient();
    const validateMock = plotClient.validatePatch as ReturnType<typeof vi.fn>;
    validateMock
      .mockResolvedValueOnce({ kind: 'rejection', status: 'rejected', message: 'Bad' } as ValidatePatchResult)
      .mockResolvedValueOnce({ kind: 'success', data: { verdict: 'accepted' } } as ValidatePatchResult);

    const result = await handleEditGraph(
      makeContext(),
      "Edit",
      adapter,
      "req-1",
      "turn-1",
      { plotClient, maxRetries: 1 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  // ────────────────────────────────────────────────────────────────────
  // Internal-vocabulary leak guards (P0 fix 2026-05).
  //
  // The previous narration block at edit-graph.ts:2337 rendered
  // "PLoT applied N repair(s) to ensure semantic consistency:\n
  //  - [CODE] reason" verbatim, where `reason` came from
  // graph-enforcement.ts:237 / applyBudgetRescale / fixBridgeChaining
  // and contained operator-language like `|mean|`, `inbound`,
  // `sum=X.XXX to Y.Y`, `bridge`, `BUDGET_TARGET`, etc.
  //
  // The denylist is canonicalised in tests/helpers/banned-internal-tokens.ts
  // so success-path and rejection-path leak tests share the same list.
  // ────────────────────────────────────────────────────────────────────

  for (const repairFixture of [
    { code: "INBOUND_BUDGET_RESCALED", message: "Rescaled 4 causal inbound edges from sum=1.247 to 1.0" },
    { code: "BRIDGE_CHAIN_REMOVED", message: "Removed forbidden outcome→risk edge; ceiling Σ|mean| ≤ 1.0" },
    { code: "STRENGTH_CLAMPED", message: "Clamped strength to [-1,1]; |mean|>1 not permitted" },
    { code: "ORPHAN_BRIDGE_ADDED", message: "Added bridge to goal with mean=-0.3 std=0.15 to satisfy BUDGET_TARGET" },
  ]) {
    it(`success path: assistant_text has no internal vocabulary when repair "${repairFixture.code}" is applied`, async () => {
      const adapter = makeAdapter([VALID_ADD_NODE_OP]);
      const plotClient = makePlotClient({
        verdict: "accepted",
        repairs_applied: [repairFixture],
      });

      const result = await handleEditGraph(
        makeContext(),
        "Add factor",
        adapter,
        "req-1",
        "turn-1",
        { plotClient },
      );

      const text = result.assistantText ?? "";
      // Verify no banned token appears (canonical denylist via shared helper).
      assertNoBannedInternalTokens(text, (t, re) =>
        expect(t, `assistant_text leaked internal token ${re}: "${t}"`).not.toMatch(re),
      );
      // Repair detail still flows on the wire via the GraphPatchBlock.
      const data = result.blocks[0].data as GraphPatchBlockData;
      expect(data.repairs_applied).toBeDefined();
      expect(data.repairs_applied!.some((r) => r.code === repairFixture.code)).toBe(true);
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Rejection-path leak guards (P1 fix 2026-05). The rejection composer
  // (buildRejectionResult) puts the raw `reason` text on
  // GraphPatchBlock.data.rejection.reason for diagnostics, but produces
  // assistant_text via the canned `buildEditRejectionResponse(...)` map
  // — so a rejection reason containing internal vocabulary must NOT
  // leak into the chat surface even when the raw reason is itself
  // operator-grade.
  // ────────────────────────────────────────────────────────────────────
  it("LLM coaching.summary containing repair vocabulary is scrubbed before reaching the user (P1 fix 2026-05)", async () => {
    // Defence-in-depth: even if Sonnet emits a coaching.summary that
    // echoes prompt vocabulary like "I balanced inbound edges to keep
    // sum=1.0", the final scrubber must replace those tokens before
    // they reach assistant_text. The legacy `scrubFragment` only catches
    // entity-ID prefixes; this test exercises the new
    // `enforceRepairVocabularyDenylist` final pass.
    const v2Response = {
      operations: [VALID_ADD_NODE_OP],
      removed_edges: [],
      warnings: [],
      coaching: {
        summary:
          'I balanced inbound edges to keep sum=1.0; the resulting bridge respects BUDGET_TARGET and Σ|mean|≤1.0.',
      },
    };
    const adapter = makeAdapter(v2Response);
    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
    );

    const text = result.assistantText ?? "";
    // The friendly verb "balanced" survives; banned operator vocabulary
    // is replaced with [REDACTED].
    assertNoBannedInternalTokens(text, (t, re) =>
      expect(t, `assistant_text leaked ${re}: "${t}"`).not.toMatch(re),
    );
    expect(text).toContain('[REDACTED]'); // proves the scrubber fired
    expect(text).toContain('I balanced'); // proves it didn't drop the whole text
  });

  it("LLM warnings array containing repair vocabulary is scrubbed before reaching the user (P1 fix 2026-05)", async () => {
    const v2Response = {
      operations: [VALID_ADD_NODE_OP],
      removed_edges: [],
      warnings: [
        'rescaled inbound edges; |mean| now within bounds',
        'BUDGET_TARGET respected',
      ],
      coaching: { summary: 'Done.' },
    };
    const adapter = makeAdapter(v2Response);
    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
    );

    const text = result.assistantText ?? "";
    assertNoBannedInternalTokens(text, (t, re) =>
      expect(t, `assistant_text leaked ${re}: "${t}"`).not.toMatch(re),
    );
  });

  it("MAX_OPERATIONS rejection: assistant_text has no internal terms", async () => {
    const ops = Array.from({ length: 20 }, (_, i) => ({
      op: "update_node",
      path: "factor_1",
      value: { label: `Label ${i}` },
    }));
    const adapter = makeAdapter(ops);
    const result = await handleEditGraph(
      makeContext(),
      "Bulk edit",
      adapter,
      "req-1",
      "turn-1",
      { maxRetries: 0 },
    );
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("rejected");
    expect(data.rejection?.code).toBe("MAX_OPERATIONS_EXCEEDED");
    // Raw reason CAN contain "20 operations (max 15)" — that's diagnostic-only.
    // Assistant text MUST be friendly with no banned vocabulary.
    const text = result.assistantText ?? "";
    assertNoBannedInternalTokens(text, (t, re) =>
      expect(t, `assistant_text leaked ${re}: "${t}"`).not.toMatch(re),
    );
  });

  it("PLOT verdict-rejected with operator-vocab reason: assistant_text has no internal terms", async () => {
    // Simulate PLOT returning a `verdict: 'rejected'` envelope where the
    // `reason` string is full of internal mechanics — the kind of text
    // that leaked into chat before the 2337 fix.
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient({
      verdict: "rejected",
      reason:
        "Strength_mean exceeds bridge bound; Σ|mean| > BUDGET_TARGET on inbound edges; rescale required",
      code: "BRIDGE_BUDGET_VIOLATION",
    });
    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient, maxRetries: 0 },
    );

    expect(result.wasRejected).toBe(true);
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("rejected");
    // The raw operator-vocabulary reason IS preserved on the
    // diagnostic surface so operators can still debug — assert this so
    // a regression that strips it from the wire is also caught.
    expect(data.rejection?.reason ?? "").toMatch(/\|mean\|/);

    // But the user-facing assistant text MUST be free of every banned
    // internal token.
    const text = result.assistantText ?? "";
    assertNoBannedInternalTokens(text, (t, re) =>
      expect(t, `assistant_text leaked ${re}: "${t}"`).not.toMatch(re),
    );
    // It MUST be a friendly recovery message.
    expect(text).toMatch(/wasn't able|describe|simpler/i);
  });

  it("surfaces repairs_applied on block data but NOT in assistant_text (P0 fix 2026-05)", async () => {
    // Repairs reach the wire via the V4 GraphPatchBlock for operator
    // tooling, but MUST NOT appear in user-facing assistant_text. The
    // previous behaviour rendered "PLoT applied N repair(s) to ensure
    // semantic consistency:\n- [CODE] reason" verbatim, leaking internal
    // terminology like `|mean|`, `inbound`, `sum=`, `bridge`,
    // `[INBOUND_BUDGET_RESCALED]` etc. into the chat surface. Operators
    // continue to see repair detail via PLoT telemetry events,
    // x-cee-failure-cause headers, and the GraphPatchBlock `repairs_applied`
    // field — but the user does not.
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient({
      verdict: "accepted",
      repairs_applied: [
        { code: "STRENGTH_CLAMPED", message: "Clamped strength to [-1,1]" },
      ],
    });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.repairs_applied).toHaveLength(1);
    expect(data.repairs_applied![0].code).toBe("STRENGTH_CLAMPED");
    // Repair narration MUST NOT leak into assistant_text.
    expect(result.assistantText ?? '').not.toContain("PLoT applied");
    expect(result.assistantText ?? '').not.toContain("STRENGTH_CLAMPED");
    expect(result.assistantText ?? '').not.toContain("Clamped strength");
  });

  it("skips validation with warning when PLoT returns FEATURE_DISABLED (501)", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const featureDisabled: ValidatePatchResult = { kind: 'feature_disabled' };
    const plotClient: PLoTClient = {
      run: vi.fn(),
      validatePatch: vi.fn().mockResolvedValue(featureDisabled),
    };

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
    expect(data.validation_warnings).toBeDefined();
    expect(data.validation_warnings!.some(w => w.includes("PLOT_VALIDATION_SKIPPED"))).toBe(true);
    expect(data.validation_warnings!.some(w => w.includes("not available"))).toBe(true);
  });

  it("proceeds without PLoT when plotClient is null and adds PLOT_VALIDATION_SKIPPED warning", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient: null },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
    expect(data.validation_warnings).toBeDefined();
    expect(data.validation_warnings!.some(w => w.includes("PLOT_VALIDATION_SKIPPED"))).toBe(true);
  });

  it("rejects patch when PLoT is configured but call throws (hard reject)", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient: PLoTClient = {
      run: vi.fn(),
      validatePatch: vi.fn().mockRejectedValue(new Error("PLoT timeout")),
    };

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient, maxRetries: 0 },
    );

    // PLoT configured but failed — must hard reject, not silently pass through
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("rejected");
    expect(data.rejection?.reason).toContain("PLoT semantic validation unavailable");
    expect(data.rejection?.code).toBe("PLOT_UNAVAILABLE");
  });

  // ------------------------------------------------------------------
  // LLM parse failures
  // ------------------------------------------------------------------

  it("throws on unparseable LLM response with no retries", async () => {
    const adapter = makeAdapter("not json at all");
    // Override mock to return raw string
    (adapter.chat as ReturnType<typeof vi.fn>).mockResolvedValue({ content: "not json at all" });

    await expect(
      handleEditGraph(
        makeContext(),
        "Edit",
        adapter,
        "req-1",
        "turn-1",
        { maxRetries: 0 },
      ),
    ).rejects.toThrow("No valid JSON found");
  });

  it("retries on parse failure and succeeds on second attempt", async () => {
    const chatMock = vi.fn()
      .mockResolvedValueOnce({ content: "garbage response" })
      .mockResolvedValueOnce({ content: JSON.stringify([VALID_UPDATE_OP]) });

    const adapter = { chat: chatMock } as unknown as LLMAdapter;

    const result = await handleEditGraph(
      makeContext(),
      "Edit",
      adapter,
      "req-1",
      "turn-1",
      { maxRetries: 1 },
    );

    expect(chatMock).toHaveBeenCalledTimes(2);
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
  });

  // ------------------------------------------------------------------
  // LLM call failures
  // ------------------------------------------------------------------

  it("throws on LLM error with no retries", async () => {
    const chatMock = vi.fn().mockRejectedValue(new Error("LLM timeout"));
    const adapter = { chat: chatMock } as unknown as LLMAdapter;

    await expect(
      handleEditGraph(
        makeContext(),
        "Edit",
        adapter,
        "req-1",
        "turn-1",
        { maxRetries: 0 },
      ),
    ).rejects.toThrow("LLM timeout");
  });

  it("retries on LLM error and succeeds on second attempt", async () => {
    const chatMock = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ content: JSON.stringify([VALID_UPDATE_OP]) });

    const adapter = { chat: chatMock } as unknown as LLMAdapter;

    const result = await handleEditGraph(
      makeContext(),
      "Edit",
      adapter,
      "req-1",
      "turn-1",
      { maxRetries: 1 },
    );

    expect(chatMock).toHaveBeenCalledTimes(2);
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
  });

  // ------------------------------------------------------------------
  // Acceptance criteria: canonical convergence fields
  // ------------------------------------------------------------------

  it("populates applied_graph and applied_graph_hash from PLoT response", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const appliedGraph = {
      nodes: [
        { id: "goal_1", kind: "goal", label: "Revenue" },
        { id: "factor_1", kind: "factor", label: "Price" },
        { id: "new_factor", kind: "factor", label: "Cost" },
      ],
      edges: [
        { from: "factor_1", to: "goal_1", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: "positive" },
      ],
    };
    const plotClient = makePlotClient({
      verdict: "accepted",
      applied_graph: appliedGraph,
    });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.applied_graph).toEqual(appliedGraph);
    expect(data.applied_graph_hash).toBeDefined();
    expect(data.applied_graph_hash!.length).toBe(16);
  });

  // ------------------------------------------------------------------
  // Acceptance criteria: base_graph_hash in PLoT payload
  // ------------------------------------------------------------------

  it("sends base_graph_hash in PLoT validate-patch payload", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient();

    await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const [payload] = (plotClient.validatePatch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.base_graph_hash).toBeDefined();
    expect(payload.base_graph_hash.length).toBe(16);
  });

  // ------------------------------------------------------------------
  // Acceptance criteria: no silent operation rewrite
  // ------------------------------------------------------------------

  it("does NOT rewrite operations from PLoT response (no silent semantics)", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const differentOps = [{ op: "update_node", path: "factor_1", value: { label: "PLoT-modified" } }];
    const plotClient = makePlotClient({
      verdict: "accepted",
      // PLoT returns different operations — these must NOT overwrite the original
      operations: differentOps,
      repairs_applied: [{ code: "LABEL_FIXED", message: "Fixed label" }],
    });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    // Operations should be the original CEE-validated ones, not PLoT's rewritten version
    expect(data.operations[0].op).toBe("add_node");
    expect(data.operations[0].path).toBe("nodes/new_factor");
    // Repairs should be surfaced as repairs_applied, not merged into operations
    expect(data.repairs_applied).toHaveLength(1);
    expect(data.repairs_applied![0].code).toBe("LABEL_FIXED");
  });

  // ------------------------------------------------------------------
  // Acceptance criteria: PLoT failure retries before hard reject
  // ------------------------------------------------------------------

  it("retries on PLoT failure and succeeds when PLoT recovers", async () => {
    const adapter = makeAdapter([]);
    const chatMock = adapter.chat as ReturnType<typeof vi.fn>;
    chatMock
      .mockResolvedValueOnce({ content: JSON.stringify([VALID_ADD_NODE_OP]) })
      .mockResolvedValueOnce({ content: JSON.stringify([VALID_UPDATE_OP]) });

    const plotClient: PLoTClient = {
      run: vi.fn(),
      validatePatch: vi.fn()
        .mockRejectedValueOnce(new Error("PLoT transient failure"))
        .mockResolvedValueOnce({ kind: 'success', data: { verdict: 'accepted' } } as ValidatePatchResult),
    };

    const result = await handleEditGraph(
      makeContext(),
      "Edit",
      adapter,
      "req-1",
      "turn-1",
      { plotClient, maxRetries: 1 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  // ------------------------------------------------------------------
  // Addendum: old_value → previous mapping for PLoT
  // ------------------------------------------------------------------

  it("maps old_value to previous in PLoT payload", async () => {
    const opWithOldValue = {
      op: "update_node",
      path: "factor_1",
      value: { label: "New Label" },
      old_value: { label: "Old Label" },
    };
    const adapter = makeAdapter([opWithOldValue]);
    const plotClient = makePlotClient();

    await handleEditGraph(
      makeContext(),
      "Update label",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const [payload] = (plotClient.validatePatch as ReturnType<typeof vi.fn>).mock.calls[0];
    const plotOp = payload.operations[0];
    expect(plotOp.previous).toEqual({ label: "Old Label" });
    expect(plotOp.old_value).toBeUndefined();
  });

  it("omits previous from PLoT payload when old_value is not set", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient();

    await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const [payload] = (plotClient.validatePatch as ReturnType<typeof vi.fn>).mock.calls[0];
    const plotOp = payload.operations[0];
    expect(plotOp.previous).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // Addendum: PLoT graph_hash consumed
  // ------------------------------------------------------------------

  it("uses PLoT graph_hash when returned instead of local computation", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient({
      verdict: "accepted",
      applied_graph: { nodes: [], edges: [] },
      graph_hash: "plot_canonical_hash",
    });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.applied_graph_hash).toBe("plot_canonical_hash");
  });

  it("falls back to local hash when PLoT omits graph_hash", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const appliedGraph = { nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] };
    const plotClient = makePlotClient({
      verdict: "accepted",
      applied_graph: appliedGraph,
      // No graph_hash field
    });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.applied_graph_hash).toBeDefined();
    expect(data.applied_graph_hash!.length).toBe(16); // SHA-256 hex truncated to 16
  });

  // ------------------------------------------------------------------
  // Addendum: PLoT warnings surfaced
  // ------------------------------------------------------------------

  it("surfaces PLoT warnings in validation_warnings", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient({
      verdict: "accepted",
      warnings: [
        { code: "STRENGTH_CLAMPED", message: "Clamped strength_mean to [-1,1]", field_path: "edges[0].strength_mean" },
      ],
    });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.validation_warnings).toBeDefined();
    expect(data.validation_warnings!.some(w => w.includes("Clamped strength_mean"))).toBe(true);
  });

  it("handles PLoT string warnings", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient({
      verdict: "accepted",
      warnings: ["Edge has low confidence"],
    });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.validation_warnings).toContain("Edge has low confidence");
  });

  // ------------------------------------------------------------------
  // Addendum: MAX_PATCH_OPERATIONS cap
  // ------------------------------------------------------------------

  it("rejects patch with more than 15 operations", async () => {
    const ops = Array.from({ length: 16 }, (_, i) => ({
      op: "update_node",
      path: "factor_1",
      value: { label: `Label ${i}` },
    }));
    const adapter = makeAdapter(ops);

    const result = await handleEditGraph(
      makeContext(),
      "Bulk edit",
      adapter,
      "req-1",
      "turn-1",
      { maxRetries: 0 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("rejected");
    expect(data.rejection?.reason).toContain("max 15");
    expect(data.rejection?.code).toBe("MAX_OPERATIONS_EXCEEDED");
  });

  it("accepts patch with exactly 15 operations", async () => {
    // 15 update_node ops targeting factor_1 (all valid against the graph)
    const ops = Array.from({ length: 15 }, (_, i) => ({
      op: "update_node",
      path: "factor_1",
      value: { label: `Label ${i}` },
    }));
    const adapter = makeAdapter(ops);

    const result = await handleEditGraph(
      makeContext(),
      "Batch edit",
      adapter,
      "req-1",
      "turn-1",
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
    expect(data.operations).toHaveLength(15);
  });

  // ------------------------------------------------------------------
  // Addendum: rejection.attempts field
  // ------------------------------------------------------------------

  it("includes attempts=1 on first-pass rejection (no retry)", async () => {
    const adapter = makeAdapter([{ op: "bad_op", path: "x" }]);

    const result = await handleEditGraph(
      makeContext(),
      "Do something",
      adapter,
      "req-1",
      "turn-1",
      { maxRetries: 0 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("rejected");
    expect(data.rejection?.attempts).toBe(1);
  });

  it("includes attempts=2 when repair loop exhausts both attempts", async () => {
    const adapter = makeAdapter([]);
    const chatMock = adapter.chat as ReturnType<typeof vi.fn>;
    chatMock
      .mockResolvedValueOnce({ content: JSON.stringify([{ op: "bad_op", path: "x" }]) })
      .mockResolvedValueOnce({ content: JSON.stringify([{ op: "bad_op", path: "x" }]) });

    const result = await handleEditGraph(
      makeContext(),
      "Do something",
      adapter,
      "req-1",
      "turn-1",
      { maxRetries: 1 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("rejected");
    expect(data.rejection?.attempts).toBe(2);
  });

  // ------------------------------------------------------------------
  // old_value population for undo data
  // ------------------------------------------------------------------

  it("populates old_value on update_node from graph context", async () => {
    const adapter = makeAdapter([VALID_UPDATE_OP]);

    const result = await handleEditGraph(
      makeContext(),
      "Rename price factor",
      adapter,
      "req-1",
      "turn-1",
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
    const updateOp = data.operations.find(o => o.op === "update_node");
    expect(updateOp).toBeDefined();
    expect(updateOp!.old_value).toEqual({ label: "Price" });
  });

  it("populates old_value on remove_node with full node object", async () => {
    const adapter = makeAdapter([{
      op: "remove_node",
      path: "factor_1",
    }]);

    const result = await handleEditGraph(
      makeContext(),
      "Remove price factor",
      adapter,
      "req-1",
      "turn-1",
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
    const removeOp = data.operations.find(o => o.op === "remove_node");
    expect(removeOp).toBeDefined();
    expect(removeOp!.old_value).toEqual(
      expect.objectContaining({ id: "factor_1", kind: "factor", label: "Price" }),
    );
  });

  it("populates old_value on update_edge from graph context", async () => {
    const adapter = makeAdapter([{
      op: "update_edge",
      path: "factor_1::goal_1",
      value: { strength_mean: 0.8, strength_std: 0.05 },
    }]);

    // Use a context where edge has the canonical fields at top level
    const ctx = makeContext({
      graph: {
        nodes: [
          { id: "goal_1", kind: "goal", label: "Revenue" },
          { id: "factor_1", kind: "factor", label: "Price" },
        ],
        edges: [
          {
            from: "factor_1",
            to: "goal_1",
            strength_mean: 0.5,
            strength_std: 0.1,
            exists_probability: 0.9,
            effect_direction: "positive",
          },
        ],
      } as unknown as ConversationContext["graph"],
    });

    const result = await handleEditGraph(
      ctx,
      "Strengthen edge",
      adapter,
      "req-1",
      "turn-1",
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
    const updateOp = data.operations.find(o => o.op === "update_edge");
    expect(updateOp).toBeDefined();
    expect(updateOp!.old_value).toEqual({ strength_mean: 0.5, strength_std: 0.1 });
  });

  it("does not overwrite old_value when LLM already provides it", async () => {
    const adapter = makeAdapter([{
      op: "update_node",
      path: "factor_1",
      value: { label: "New Label" },
      old_value: { label: "LLM-provided" },
    }]);

    const result = await handleEditGraph(
      makeContext(),
      "Rename factor",
      adapter,
      "req-1",
      "turn-1",
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    const updateOp = data.operations.find(o => o.op === "update_node");
    expect(updateOp!.old_value).toEqual({ label: "LLM-provided" });
  });

  it("does not set old_value on add_node ops", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);

    const result = await handleEditGraph(
      makeContext(),
      "Add a factor",
      adapter,
      "req-1",
      "turn-1",
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    const addOp = data.operations.find(o => o.op === "add_node");
    expect(addOp!.old_value).toBeUndefined();
  });

  it("sets auto_apply: false on targeted edit GraphPatchBlock", async () => {
    const adapter = makeAdapter([VALID_UPDATE_OP]);

    const result = await handleEditGraph(
      makeContext(),
      "Rename factor",
      adapter,
      "req-1",
      "turn-auto-apply",
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.auto_apply).toBe(false);
  });
});

// ============================================================================
// mapOpsForPlot — edge path format conversion (Issue 4)
// ============================================================================

describe("mapOpsForPlot", () => {
  it("converts from::to edge paths to from->to for PLoT", () => {
    const ops: PatchOperation[] = [
      { op: "add_edge", path: "price_1::churn_5", value: { from: "price_1", to: "churn_5", strength: { mean: 0.5, std: 0.1 } } },
      { op: "remove_edge", path: "rev_2::cost_3", old_value: {} },
    ];
    const mapped = mapOpsForPlot(ops);
    expect(mapped[0].path).toBe("price_1->churn_5");
    expect(mapped[1].path).toBe("rev_2->cost_3");
  });

  it("preserves node-only paths unchanged", () => {
    const ops: PatchOperation[] = [
      { op: "add_node", path: "factor_new", value: { id: "factor_new", kind: "factor", label: "New" } },
      { op: "remove_node", path: "opt_old", old_value: {} },
    ];
    const mapped = mapOpsForPlot(ops);
    expect(mapped[0].path).toBe("factor_new");
    expect(mapped[1].path).toBe("opt_old");
  });

  it("does not convert :: in node paths even if present (defensive)", () => {
    // Node IDs should never contain :: (canonical regex collapses them),
    // but guard against corruption if they somehow do.
    const ops: PatchOperation[] = [
      { op: "update_node", path: "some::id", value: { label: "X" } },
    ];
    const mapped = mapOpsForPlot(ops);
    expect(mapped[0].path).toBe("some::id");
  });

  it("maps old_value to previous for PLoT field naming", () => {
    const ops: PatchOperation[] = [
      { op: "update_edge", path: "a::b", value: 0.8, old_value: 0.5 },
    ];
    const mapped = mapOpsForPlot(ops);
    expect(mapped[0].previous).toBe(0.5);
    expect(mapped[0].value).toBe(0.8);
    expect((mapped[0] as Record<string, unknown>).old_value).toBeUndefined();
  });
});
