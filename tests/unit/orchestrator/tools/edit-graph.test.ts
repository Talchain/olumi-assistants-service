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
              // Disable cf-v11.1 pre-validation for legacy tests (tested separately in patch-budget/validator tests).
              // V5 H5 follow-up decoupled `candidateGraph` computation
              // from `patchPreValidationEnabled`, so the V4 success
              // branch can still synthesise `appliedGraph` from the
              // candidate even when validation is disabled here.
              if (ceeProp === "patchPreValidationEnabled") return false;
              if (ceeProp === "patchBudgetEnabled") return false;
              // CEE_EDIT_CAP_SPLIT went DEFAULT-ON 18 Jul (Paul-ratified). This
              // legacy suite asserts the BARE whole-batch MAX_OPERATIONS_EXCEEDED
              // dead-end, so it pins the split flag OFF (the kill-switch path).
              // The default-ON split behaviour is covered by
              // trust-spine-red-edit-cap-split.test.ts.
              if (ceeProp === "editCapSplitEnabled") return false;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import { handleEditGraph, mapOpsForPlot, determineEditResolutionMode } from "../../../../src/orchestrator/tools/edit-graph.js";
import type { EditTargetResolutionResult } from "../../../../src/orchestrator/tools/edit-graph.js";
import { applyPatchOperations } from "../../../../src/orchestrator/patch-applier.js";
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
  // V5 H5 follow-up: default the PLoT mock to include `applied_graph`
  // and `graph_hash` to mirror the production PLoT contract. Real PLoT
  // returns the repaired graph alongside `repairs_applied`; the V4
  // success branch (post-fix) requires this pairing — if PLoT reports
  // repairs but omits `applied_graph`, V4 returns rejection (Rule C).
  // The default applied_graph is a minimal accepted graph; individual
  // tests can override (e.g. set applied_graph: undefined to test the
  // omitted-with-repairs rejection path explicitly).
  const defaultAppliedGraph = {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Revenue' },
      { id: 'factor_1', kind: 'factor', label: 'Price' },
    ],
    edges: [
      {
        from: 'factor_1',
        to: 'goal_1',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  };
  const result: ValidatePatchResult = {
    kind: 'success',
    data: {
      verdict: 'accepted',
      applied_graph: defaultAppliedGraph,
      // 16-char hex matches production `computeGraphHash` output shape.
      // Tests that assert hash.length === 16 read THIS value when not
      // overridden by individual test fixtures.
      graph_hash: 'a1b2c3d4e5f60718',
      ...data,
    },
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
  // `path` is the canonical node id used by applyAddNode — must match
  // CANONICAL_ID_REGEX in src/schemas/cee-v3.ts (lowercase alphanumeric,
  // underscores, colons, hyphens). The previous fixture value
  // "nodes/new_factor" included a slash that failed GraphV3 strict parse
  // when the Layer 2 backstop landed (PR adding GraphV3.safeParse before
  // appliedGraph synthesis). The fixture had been "passing for the wrong
  // reason" — the synthesis path never strict-parsed the result before.
  op: "add_node",
  path: "new_factor",
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

  // Phase 2A contract change (deliberate, called out in Phase 2A report):
  // The previous assertion was `expect(result.assistantText).toBeNull()`,
  // which pinned a downstream consequence of coaching=null on the
  // bare-array path. As of Phase 2A, the bare-array branch populates
  // safe coaching defaults, so the success-path text builder renders a
  // non-null assistantText containing "Proposed graph edit." See
  // edit-graph-bare-array-safe-envelope.test.ts (D1) for the canonical
  // assertion and Docs/edit_graph_v9_deferred_items.md (DL-5b) for the
  // wider workstream context.
  it("returns safe-default assistantText on clean success (no repairs)", async () => {
    const adapter = makeAdapter([VALID_UPDATE_OP]);

    const result = await handleEditGraph(
      makeContext(),
      "Update price label",
      adapter,
      "req-1",
      "turn-1",
    );

    expect(result.assistantText).not.toBeNull();
    expect(result.assistantText).toContain("Proposed graph edit.");
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
    expect(data.operations[0].path).toBe("new_factor");
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
    // Uses canonical V3 nested strength shape. The previous fixture used
    // legacy flat strength_mean/strength_std fields, which fail GraphV3
    // strict parse and were silently surviving only because the synthesis
    // path never strict-parsed the result before the Layer 2 backstop.
    const adapter = makeAdapter([{
      op: "update_edge",
      path: "factor_1::goal_1",
      value: { strength: { mean: 0.8, std: 0.05 } },
    }]);

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
            strength: { mean: 0.5, std: 0.1 },
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
    expect(updateOp!.old_value).toEqual({ strength: { mean: 0.5, std: 0.1 } });
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

// ============================================================================
// V5 H5 — Mode B no-op determinism (false-success at the source)
//
// Previously, `llmResult.coaching.summary` (LLM-authored prose) was
// forwarded to `assistantText` on the empty-operations path. The LLM
// could claim "I've successfully updated X" while emitting zero
// operations, producing the false-success narration observed in
// dl7-edit-graph run 3. The fix drops the coaching passthrough on the
// no-op path so prose is constructed deterministically from
// structured signals only.
// ============================================================================

describe("V5 H5 — handleEditGraph no-op branch (Mode B fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("LLM emits operations=[] with success-claiming coaching → deterministic neutral text (no false success)", async () => {
    const adapter = makeAdapter({
      operations: [],
      removed_edges: [],
      warnings: [],
      coaching: {
        summary: "I've successfully updated the Price factor to reflect your request.",
      },
    });
    const result = await handleEditGraph(
      makeContext(),
      "Make Price more important",
      adapter,
      "req-1",
      "turn-1",
    );

    const text = result.assistantText ?? "";
    // The LLM's success-claim prose must NOT reach the user.
    expect(text).not.toMatch(/successfully\s+updated/i);
    expect(text).not.toMatch(/I['’]ve\s+(?:applied|updated|set|added|removed|changed)/i);
    // Deterministic forward-looking default must fire when no warnings either.
    // Forward-looking (not a denial) so it passes the V5 egress forbidden-
    // phrase guard intact — see edit-graph.ts NO_OP_FALLBACK_TEXT comment.
    expect(text).toMatch(/Tell me the specific factor/i);
    expect(text).not.toMatch(/\bno changes were\b/i);
    // No-commit contract preserved.
    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).toBeNull();
  });

  it("LLM emits operations=[] containing 'validator' in coaching → leak does not reach assistant_text", async () => {
    const adapter = makeAdapter({
      operations: [],
      removed_edges: [],
      warnings: [],
      coaching: {
        summary: "The validator rejected the edge type you proposed.",
      },
    });
    const result = await handleEditGraph(
      makeContext(),
      "Make Price more important",
      adapter,
      "req-1",
      "turn-1",
    );
    const text = result.assistantText ?? "";
    expect(text).not.toMatch(/\bvalidator\b/i);
  });

  // Codex round-1 P0: warnings ARE LLM-authored strings (typed
  // `warnings: string[]` — no structured-code schema), so they can
  // carry the same false-success / jargon vectors as coaching. Both
  // are dropped on the no-op path. The test below pins that warning
  // content does NOT reach assistant_text even when it carries
  // information that would otherwise be useful.
  it("LLM emits operations=[] with informational warnings → warnings dropped, deterministic copy emitted (Codex P0)", async () => {
    const adapter = makeAdapter({
      operations: [],
      removed_edges: [],
      warnings: ["No matching factor found for the requested update."],
      coaching: { summary: "I've applied the change." }, // would have leaked
    });
    const result = await handleEditGraph(
      makeContext(),
      "Make NonExistent more important",
      adapter,
      "req-1",
      "turn-1",
    );
    const text = result.assistantText ?? "";
    // Warning content does NOT reach assistant_text.
    expect(text).not.toContain("No matching factor");
    // Coaching content does NOT reach assistant_text.
    expect(text).not.toMatch(/I['’]ve\s+applied/i);
    // Deterministic copy used instead.
    expect(text).toMatch(/Tell me the specific factor/i);
  });

  it("LLM emits operations=[] with FALSE-SUCCESS warning text → no leak to assistant_text (Codex P0)", async () => {
    // The leak vector: LLM puts terse commit claims into the warnings
    // array. With the P0 fix, neither "Updated Price." nor "Done"
    // reaches user-facing prose.
    const adapter = makeAdapter({
      operations: [],
      removed_edges: [],
      warnings: ["Updated Price.", "Done — value set."],
      coaching: null,
    });
    const result = await handleEditGraph(
      makeContext(),
      "Make Price more important",
      adapter,
      "req-1",
      "turn-1",
    );
    const text = result.assistantText ?? "";
    expect(text).not.toContain("Updated Price");
    expect(text).not.toContain("Done");
    expect(text).not.toContain("value set");
    expect(text).toMatch(/Tell me the specific factor/i);
  });

  it("LLM emits operations=[] with JARGON warning text → no leak to assistant_text (Codex P0)", async () => {
    // The dl7-staleness leak vector: LLM puts "validator" into the
    // warnings array. With the P0 fix, jargon in warnings cannot
    // reach the user even if the dispatcher's jargon regex
    // somehow misses a variant.
    const adapter = makeAdapter({
      operations: [],
      removed_edges: [],
      warnings: ["The validator rejected this edge type."],
      coaching: null,
    });
    const result = await handleEditGraph(
      makeContext(),
      "Make Price more important",
      adapter,
      "req-1",
      "turn-1",
    );
    const text = result.assistantText ?? "";
    expect(text).not.toMatch(/\bvalidator\b/i);
    expect(text).toMatch(/Tell me the specific factor/i);
  });

  it("LLM emits operations=[] with no warnings and no coaching → safe default", async () => {
    const adapter = makeAdapter({
      operations: [],
      removed_edges: [],
      warnings: [],
      coaching: null,
    });
    const result = await handleEditGraph(
      makeContext(),
      "Make Price more important",
      adapter,
      "req-1",
      "turn-1",
    );
    expect(result.assistantText).toMatch(/Tell me the specific factor/i);
    expect(result.assistantText).not.toMatch(/\bno changes were\b/i);
    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).toBeNull();
  });
});

// ============================================================================
// V5 H5 — Mode A copy improvement (propose_and_confirm)
//
// The previous stub text ("I've drafted a change… but I can't apply a
// draft proposal automatically yet") was a dead-end. The new builder
// uses the already-computed `proposedChanges` payload to surface a
// concrete target and example phrasing so the user knows exactly what
// to restate. No "Apply this change" chip is invented — the V5
// pendingProposal round-trip isn't wired in dispatch.
// ============================================================================

describe("V5 H5 — handleEditGraph Mode A copy (propose_and_confirm)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("compound parameter_update with resolved target → multi-change copy referencing all labels", async () => {
    // Compound ("and") + low-impact + parameter_update with a
    // high-confidence resolved target → propose_and_confirm path
    // (line 617 fallthrough). Compound takes the multi-change copy
    // branch in `buildProposeAndConfirmText`.
    const adapter = makeAdapter({ operations: [], removed_edges: [], warnings: [], coaching: null });
    const result = await handleEditGraph(
      makeContext(),
      "Make Price more important and adjust its weight",
      adapter,
      "req-1",
      "turn-1",
    );
    const text = result.assistantText ?? "";
    // Concrete element_label surfaces (Price is the only factor in
    // makeContext's graph and is mentioned in the message).
    expect(text).toMatch(/\bPrice\b/);
    // Honest non-commit framing.
    expect(text).toMatch(/need the specifics|need.*specific|tell me/i);
    // No invented "Apply this change" chip language.
    expect(text).not.toMatch(/apply this change|click apply|tap apply/i);
    // Codex round-1 P1 regression guard: no hardcoded example
    // values. The previous single-change branch interpolated
    // "120k" / "20%" / "100k"; the compound branch never had them.
    // This regression guard pins both branches against future
    // re-introduction.
    expect(text).not.toMatch(/\b120k\b/);
    expect(text).not.toMatch(/\b20%\b/);
    expect(text).not.toMatch(/\b100k\b/);
    // No-commit contract.
    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).toBeNull();
    expect(result.pendingProposal).toBeDefined();
  });

  it("single-change high-impact parameter_update → single-change copy with abstract placeholder example", async () => {
    // Single-change ("no and|comma|also|then") + high-impact verb
    // ("double") + parameter_update → falls past auto_apply gate
    // (isLowImpactEditRequest=false because "double" matches
    // high-impact regex) → final propose_and_confirm fallthrough.
    // This exercises the SINGLE-change branch of
    // `buildProposeAndConfirmText` which used to interpolate
    // "120k" / "20%" hardcoded examples.
    const adapter = makeAdapter({ operations: [], removed_edges: [], warnings: [], coaching: null });
    const result = await handleEditGraph(
      makeContext(),
      "Make Price double",
      adapter,
      "req-1",
      "turn-1",
    );
    const text = result.assistantText ?? "";
    // Concrete element_label surfaces.
    expect(text).toMatch(/\bPrice\b/);
    // Codex round-1 P1: NO hardcoded scale values.
    expect(text).not.toMatch(/\b120k\b/);
    expect(text).not.toMatch(/\b20%\b/);
    expect(text).not.toMatch(/\b100k\b/);
    // Abstract placeholder phrasing replaces the hardcoded examples.
    // Single-change branch uses "value or direction" / "set to N" /
    // "lower by N" — keywords that don't bind to a concrete scale.
    expect(text).toMatch(/value|direction|parameter|element/i);
    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).toBeNull();
    expect(result.pendingProposal).toBeDefined();
  });

  // Codex round-1 improvement #3 — Mode A with malformed / free-text
  // `proposedChanges.changes[0].element_label`. The builder must
  // gracefully fall back rather than interpolate user-controlled or
  // free-text label content into bold markdown.
  it("Mode A builder ignores malformed element_label when no resolved_target exists", async () => {
    // Force the low-confidence path (two-factor graph, message
    // mentions neither). The handler synthesises `proposedChanges`
    // from the user clause, producing an element_label derived from
    // the clause text rather than a graph node label.
    const adapter = makeAdapter({ operations: [], removed_edges: [], warnings: [], coaching: null });
    const twoFactorContext = makeContext({
      graph: {
        nodes: [
          { id: "goal_1", kind: "goal", label: "Revenue" },
          { id: "factor_1", kind: "factor", label: "Price" },
          { id: "factor_2", kind: "factor", label: "Cost" },
        ],
        edges: [
          { from: "factor_1", to: "goal_1", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: "positive" },
          { from: "factor_2", to: "goal_1", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: "positive" },
        ],
      } as unknown as ConversationContext["graph"],
    });
    const result = await handleEditGraph(
      twoFactorContext,
      "Make THE NONEXISTENT FACTOR more important",
      adapter,
      "req-1",
      "turn-1",
    );
    const text = result.assistantText ?? "";
    // The clause-derived label is NOT a real graph node, so the
    // builder must fall back to the generic stub — never
    // interpolating user-controlled text into bold markdown.
    expect(text).not.toMatch(/\*\*THE NONEXISTENT FACTOR\*\*/);
    expect(text).not.toMatch(/\bNONEXISTENT\b/);
    // Generic stub fired.
    expect(text).toMatch(/I['’]ve\s+drafted\s+a\s+change/i);
  });

  it("low-confidence resolution (no target) → falls back to generic stub copy", async () => {
    // parameter_update with no resolvable target → confidence=low →
    // line 598-604 routes to propose_and_confirm. proposedChanges
    // will still build but with clause-derived element_label (no
    // resolved_target). Builder must fall back to generic stub
    // rather than invent target detail.
    //
    // Test graph deliberately has TWO factors so `selectGraphLocalTarget`
    // returns no single-factor fallback (it only auto-picks when there's
    // exactly one factor in the graph). This forces confidence=low.
    const adapter = makeAdapter({ operations: [], removed_edges: [], warnings: [], coaching: null });
    const twoFactorContext = makeContext({
      graph: {
        nodes: [
          { id: "goal_1", kind: "goal", label: "Revenue" },
          { id: "factor_1", kind: "factor", label: "Price" },
          { id: "factor_2", kind: "factor", label: "Cost" },
        ],
        edges: [
          { from: "factor_1", to: "goal_1", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: "positive" },
          { from: "factor_2", to: "goal_1", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: "positive" },
        ],
      } as unknown as ConversationContext["graph"],
    });
    const result = await handleEditGraph(
      twoFactorContext,
      "Make Nonexistent more important",
      adapter,
      "req-1",
      "turn-1",
    );
    const text = result.assistantText ?? "";
    expect(text).toMatch(/I['’]ve\s+drafted\s+a\s+change/i);
    expect(text).toMatch(/specifics|specific factor|specific value/i);
    // No fabricated label that wasn't in the graph.
    expect(text).not.toMatch(/\bNonexistent\b/);
    expect(result.wasRejected).toBe(false);
    expect(result.pendingProposal).toBeDefined();
  });
});


// ============================================================================
// V5 H5 follow-up — appliedGraph persistence fix
//
// V4 success branch must return a non-null `appliedGraph` so the V5
// dispatcher's `isSuccessfulAppliedMutation()` gate accepts the result
// and persists graph + edit_graph fact. When PLoT supplies `applied_graph`
// V4 keeps using it; when PLoT doesn't (no plotClient, OR PLoT validated
// but omitted applied_graph), V4 synthesises appliedGraph from the
// locally-computed `candidateGraph` (Rules A and B). When PLoT reports
// repairs but omits applied_graph, V4 refuses to substitute the
// unrepaired candidate (Rule C). When neither PLoT nor candidate is
// available, V4 returns honest non-commit rejection (Rule D).
// ============================================================================

describe("V5 H5 follow-up — handleEditGraph appliedGraph synthesis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Rule A — no plotClient: synthesises appliedGraph from candidateGraph", async () => {
    // The exact V5 dispatch path: handleEditGraph called without a
    // plotClient. With the source fix, appliedGraph must come from
    // applyPatchOperations(context.graph, operations).
    const adapter = makeAdapter([VALID_UPDATE_OP]);
    const result = await handleEditGraph(
      makeContext(),
      "Update the price label",
      adapter,
      "req-rule-a",
      "turn-rule-a",
    );

    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).not.toBeNull();
    expect(result.appliedGraph).toEqual(
      applyPatchOperations(makeContext().graph!, [VALID_UPDATE_OP] as PatchOperation[]),
    );
    expect(result.operations).toBeDefined();
    expect(result.operations!.length).toBeGreaterThan(0);
  });

  it("Rule A — synthesised appliedGraph reflects update_node mutation deterministically", async () => {
    // Sanity: the synthesis isn't just returning the input graph — it
    // applies the operation. update_node on factor_1 must change the
    // node's label in the returned appliedGraph.
    const adapter = makeAdapter([VALID_UPDATE_OP]);
    const result = await handleEditGraph(
      makeContext(),
      "Update price",
      adapter,
      "req-rule-a-deterministic",
      "turn-rule-a-deterministic",
    );

    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).not.toBeNull();
    const updatedNode = result.appliedGraph!.nodes.find((n) => (n as { id?: string }).id === "factor_1");
    expect(updatedNode).toBeDefined();
    // VALID_UPDATE_OP sets label to "Updated Price"; deterministic
    // application via applyPatchOperations must reflect that.
    expect((updatedNode as { label?: string }).label).toBe("Updated Price");
  });

  it("Rule B — plotClient configured + PLoT returns applied_graph: PLoT wins, candidate is NOT substituted", async () => {
    // PLoT's applied_graph carries any repairs PLoT may have applied.
    // V4 must preserve PLoT's graph rather than overwriting with the
    // local candidate.
    const plotAppliedGraph = {
      nodes: [
        { id: "goal_1", kind: "goal", label: "Revenue (PLoT-repaired)" },
        { id: "factor_1", kind: "factor", label: "Price" },
      ],
      edges: [
        { from: "factor_1", to: "goal_1", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: "positive" },
      ],
    };
    const adapter = makeAdapter([VALID_UPDATE_OP]);
    const plotClient = makePlotClient({
      verdict: "accepted",
      applied_graph: plotAppliedGraph,
      graph_hash: "plotsuppliedhash",
    });
    const result = await handleEditGraph(
      makeContext(),
      "Update price",
      adapter,
      "req-rule-b",
      "turn-rule-b",
      { plotClient },
    );

    expect(result.appliedGraph).toEqual(plotAppliedGraph);
    // PLoT's hash wins over local computation.
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.applied_graph_hash).toBe("plotsuppliedhash");
  });

  it("Rule C — plotClient configured + PLoT reports repairs + omits applied_graph: REFUSES to substitute candidate (returns rejection)", async () => {
    // The unsafe scenario the user explicitly called out: PLoT
    // applied repairs (so the candidate is stale relative to PLoT's
    // result) but omitted applied_graph. V4 must refuse rather than
    // silently persist the unrepaired candidate.
    const adapter = makeAdapter([VALID_UPDATE_OP]);
    // Override the default mock's applied_graph (which the helper sets
    // to a default minimal graph) so the test exercises the omitted case.
    const plotClient: PLoTClient = {
      run: vi.fn().mockResolvedValue({}),
      validatePatch: vi.fn().mockResolvedValue({
        kind: "success",
        data: {
          verdict: "accepted",
          repairs_applied: [
            { code: "STRENGTH_CLAMPED", message: "Clamped strength to [-1,1]" },
          ],
          // applied_graph: deliberately omitted
        },
      } as ValidatePatchResult),
    };
    const result = await handleEditGraph(
      makeContext(),
      "Update price",
      adapter,
      "req-rule-c",
      "turn-rule-c",
      { plotClient, maxRetries: 0 },
    );

    expect(result.wasRejected).toBe(true);
    expect(result.appliedGraph).toBeNull();
    // The user-facing assistant_text is the safe rejection copy from
    // buildEditRejectionResponse — never a success claim, never an
    // operator-grade detail.
    const text = result.assistantText ?? "";
    expect(text).not.toMatch(/successfully|I['’]ve\s+(?:applied|updated)|Strengthened/i);
    // The rejection block on the wire carries the diagnostic code so
    // operators can see what fired.
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("rejected");
    expect(data.rejection?.code).toBe("PLOT_APPLIED_GRAPH_OMITTED_WITH_REPAIRS");
  });

  it("Rule B — plotClient configured + PLoT omits applied_graph + NO repairs: candidate fallback is allowed", async () => {
    // When PLoT validates but reports no repairs, the candidate IS
    // equivalent to what PLoT would have returned. Rule B in the
    // synthesis-block comment lettering: synthesis is safe.
    const adapter = makeAdapter([VALID_UPDATE_OP]);
    const plotClient: PLoTClient = {
      run: vi.fn().mockResolvedValue({}),
      validatePatch: vi.fn().mockResolvedValue({
        kind: "success",
        data: {
          verdict: "accepted",
          // no repairs_applied, no applied_graph
        },
      } as ValidatePatchResult),
    };
    const result = await handleEditGraph(
      makeContext(),
      "Update price",
      adapter,
      "req-rule-c-no-repairs",
      "turn-rule-c-no-repairs",
      { plotClient },
    );

    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).not.toBeNull();
    expect(result.appliedGraph).toEqual(
      applyPatchOperations(makeContext().graph!, [VALID_UPDATE_OP] as PatchOperation[]),
    );
  });

  it("appliedGraphHash is the local 16-char hash when synthesised", async () => {
    // Verifies the hash field is populated when the synthesis path
    // fires (some downstream consumers depend on it).
    const adapter = makeAdapter([VALID_UPDATE_OP]);
    const result = await handleEditGraph(
      makeContext(),
      "Update price",
      adapter,
      "req-hash-shape",
      "turn-hash-shape",
    );

    expect(result.wasRejected).toBe(false);
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.applied_graph_hash).toBeDefined();
    expect(data.applied_graph_hash!.length).toBe(16);
  });

  // End-to-end success on the exact staging op shape. Proves Layer 1's
  // nested-strength merge composes correctly with the synthesis path and
  // (with V3-valid base) survives the Layer 2 backstop. The pure
  // applier tests cover the merge in isolation; this integration test
  // pins the V5 no-PLoT dispatch invariant ("appliedGraph synthesized
  // locally" → persistable graph) for the exact production shape.
  it("staging-shape update_edge with partial strength succeeds end-to-end (V5 no-PLoT path)", async () => {
    const adapter = makeAdapter([
      {
        op: "update_edge",
        path: "factor_1::goal_1",
        value: { strength: { mean: 0.28 }, exists_probability: 0.88 },
      },
    ]);

    const result = await handleEditGraph(
      makeContext(),
      "Strengthen the edge",
      adapter,
      "req-staging-shape",
      "turn-staging-shape",
    );

    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).not.toBeNull();
    const persistedEdge = result.appliedGraph!.edges.find(
      (e) => (e as { from?: string }).from === "factor_1" && (e as { to?: string }).to === "goal_1",
    ) as { strength?: { mean?: unknown; std?: unknown }; exists_probability?: unknown };
    // Layer 1 merges into existing { mean: 0.5, std: 0.1 } → new mean,
    // existing std preserved.
    expect(persistedEdge.strength?.mean).toBe(0.28);
    expect(persistedEdge.strength?.std).toBe(0.1);
    expect(persistedEdge.exists_probability).toBe(0.88);
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
  });

  // Pins the narrowed backstop contract: when the base graph is already
  // V3-invalid (legacy fixture / migration window), the backstop is
  // intentionally skipped — the patch is not the cause of the defect
  // and refusing here would block legitimate edits without closing the
  // failure window. The next read of the persisted graph would have
  // failed regardless.
  it("backstop skips strict-parse when base graph is V3-invalid (narrowed contract)", async () => {
    // Base graph uses legacy flat strength_mean/strength_std — fails
    // GraphV3 strict parse before any patch is applied.
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
    // A patch that itself is well-formed, so the only thing that could
    // trip the backstop is the pre-existing legacy edge in the base.
    const adapter = makeAdapter([
      {
        op: "update_node",
        path: "factor_1",
        value: { label: "Updated Price" },
      },
    ]);

    const result = await handleEditGraph(
      ctx,
      "Rename the factor",
      adapter,
      "req-legacy-base",
      "turn-legacy-base",
    );

    // Backstop must NOT fire — the patch did not introduce new invalidity.
    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).not.toBeNull();
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
  });

  // Backstop for the staging failure on PR #165. Patch-validation
  // (src/orchestrator/patch-validation.ts) accepts UpdateEdgeValue as a
  // record with numeric-bounds checks only (W2E-2), so non-numeric shape
  // violations still pass structural validation. EdgeV3 requires
  // `effect_direction: z.enum(["positive", "negative"])`, so an update
  // setting an out-of-vocabulary enum produces a candidate that passes
  // patch-validation and applyPatchOperations but fails GraphV3 strict
  // parse — the exact gap the Layer 2 backstop is for.
  // (The original fixture here — `strength: { std: 0 }` — is now caught
  // one layer earlier by the W2E-2 numeric-bounds gate in patch-validation
  // and rejects as STRUCTURAL_VALIDATION_FAILED; see
  // tests/unit/orchestrator/patch-validation-numeric-bounds.test.ts.)
  it("refuses to persist candidateGraph that fails GraphV3 strict parse (SYNTHESIZED_GRAPH_INVALID)", async () => {
    const adapter = makeAdapter([
      {
        op: "update_edge",
        path: "factor_1::goal_1",
        // Layer 1 merges into the existing edge so the resulting
        // effect_direction is "sideways". GraphV3 requires
        // positive|negative; safeParse rejects; the backstop must catch it.
        value: { effect_direction: "sideways" },
      },
    ]);

    const result = await handleEditGraph(
      makeContext(),
      "Tighten an edge's uncertainty too far",
      adapter,
      "req-synth-invalid",
      "turn-synth-invalid",
    );

    expect(result.wasRejected).toBe(true);
    expect(result.appliedGraph).toBeNull();
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("rejected");
    expect(data.rejection?.code).toBe("SYNTHESIZED_GRAPH_INVALID");
    // No false-success narration on the user-facing surface.
    const text = result.assistantText ?? "";
    expect(text).not.toMatch(/successfully|I['’]ve\s+(?:applied|updated|added)|Strengthened|Added\b/i);
  });
});

// ============================================================================
// H6 — label-aware compound-edit detection
//
// Failure shape on staging (PR #167 follow-up, 5/8 replays):
//   Step 1's LLM-drafted graph sometimes contains a factor whose label
//   includes "and", "also", "then", or a comma (e.g. "Headcount and
//   Scaling Spend"). The replay harness injects that label into Step 2's
//   message: "Edit the model: make Headcount and Scaling Spend more
//   important." `resolveEditTarget` correctly returns
//   confidence='high' + single resolved_target, but the old
//   `isCompoundEditRequest` returned true because the description
//   contained "and" — and the deciding gate at line 678-684 routed to
//   `propose_and_confirm` (Mode A), producing
//   "I have changes in mind for **Headcount and Scaling Spend** and
//   **Scaling Spend more important.**"
//
// Fix: strip the resolved label from the description before testing for
// compound-edit separators. Only applies when confidence='high' AND
// resolved_target is non-null (non-ambiguous match_type is already
// routed at line 664).
// ============================================================================

describe("H6 — determineEditResolutionMode label-aware compound detection", () => {
  function makeResolution(overrides: Partial<EditTargetResolutionResult> = {}): EditTargetResolutionResult {
    return {
      match_type: 'exact_label',
      resolved_target: { id: 'fac_test', label: 'Test Factor', type: 'factor' },
      confidence: 'high',
      alternatives: [],
      candidate_labels: ['Test Factor'],
      ...overrides,
    };
  }

  it("single-target label with 'and' → auto_apply", () => {
    const mode = determineEditResolutionMode(
      "make Headcount and Scaling Spend more important",
      makeContext(),
      'parameter_update',
      makeResolution({
        resolved_target: { id: 'fac_h', label: 'Headcount and Scaling Spend', type: 'factor' },
        candidate_labels: ['Headcount and Scaling Spend'],
      }),
    );
    expect(mode).toBe('auto_apply');
  });

  it("single-target label with comma → auto_apply", () => {
    const mode = determineEditResolutionMode(
      "make Capacity, Quality more important",
      makeContext(),
      'parameter_update',
      makeResolution({
        resolved_target: { id: 'fac_cq', label: 'Capacity, Quality', type: 'factor' },
        candidate_labels: ['Capacity, Quality'],
      }),
    );
    expect(mode).toBe('auto_apply');
  });

  it("single-target label with 'also' → auto_apply", () => {
    const mode = determineEditResolutionMode(
      "make Hiring also Scaling more important",
      makeContext(),
      'parameter_update',
      makeResolution({
        resolved_target: { id: 'fac_hs', label: 'Hiring also Scaling', type: 'factor' },
        candidate_labels: ['Hiring also Scaling'],
      }),
    );
    expect(mode).toBe('auto_apply');
  });

  it("single-target label with 'then' → auto_apply", () => {
    const mode = determineEditResolutionMode(
      "make Capacity then Quality more important",
      makeContext(),
      'parameter_update',
      makeResolution({
        resolved_target: { id: 'fac_cq', label: 'Capacity then Quality', type: 'factor' },
        candidate_labels: ['Capacity then Quality'],
      }),
    );
    expect(mode).toBe('auto_apply');
  });

  it("label with regex metacharacters does not corrupt the strip", () => {
    // Defensive: a factor named with regex specials must be escaped before
    // being plugged into a literal-strip RegExp.
    const mode = determineEditResolutionMode(
      "make Throughput (per hour) more important",
      makeContext(),
      'parameter_update',
      makeResolution({
        resolved_target: { id: 'fac_t', label: 'Throughput (per hour)', type: 'factor' },
        candidate_labels: ['Throughput (per hour)'],
      }),
    );
    expect(mode).toBe('auto_apply');
  });

  it("case-insensitive label strip", () => {
    // User typed the label in different case than the canonical label.
    const mode = determineEditResolutionMode(
      "make HEADCOUNT AND SCALING SPEND more important",
      makeContext(),
      'parameter_update',
      makeResolution({
        resolved_target: { id: 'fac_h', label: 'Headcount and Scaling Spend', type: 'factor' },
        candidate_labels: ['Headcount and Scaling Spend'],
      }),
    );
    expect(mode).toBe('auto_apply');
  });

  it("genuine compound edit preserved (and outside the resolved label) → propose_and_confirm", () => {
    // The resolved label is `Headcount and Scaling Spend`, but the
    // description also asks to edit a second target after the label.
    // Stripping the label leaves "make  more important and Hiring Pace
    // less important" — still contains a real "and" → compound → Mode A.
    const mode = determineEditResolutionMode(
      "make Headcount and Scaling Spend more important and Hiring Pace less important",
      makeContext(),
      'parameter_update',
      makeResolution({
        resolved_target: { id: 'fac_h', label: 'Headcount and Scaling Spend', type: 'factor' },
        candidate_labels: ['Headcount and Scaling Spend'],
      }),
    );
    expect(mode).toBe('propose_and_confirm');
  });

  it("genuine compound edit preserved with 'also' connector outside label", () => {
    const mode = determineEditResolutionMode(
      "make Hiring also Scaling more important and Delivery Capacity less risky",
      makeContext(),
      'parameter_update',
      makeResolution({
        resolved_target: { id: 'fac_hs', label: 'Hiring also Scaling', type: 'factor' },
        candidate_labels: ['Hiring also Scaling'],
      }),
    );
    expect(mode).toBe('propose_and_confirm');
  });

  it("low-confidence + parameter_update → propose_and_confirm (unchanged)", () => {
    const mode = determineEditResolutionMode(
      "make X more important",
      makeContext(),
      'parameter_update',
      makeResolution({
        match_type: 'none',
        resolved_target: null,
        confidence: 'low',
        candidate_labels: [],
      }),
    );
    expect(mode).toBe('propose_and_confirm');
  });

  it("ambiguous match → clarify (unchanged; routed before compound check)", () => {
    const mode = determineEditResolutionMode(
      "make Headcount more important",
      makeContext(),
      'parameter_update',
      makeResolution({
        match_type: 'ambiguous',
        resolved_target: null,
        confidence: 'medium',
        candidate_labels: ['Headcount Investment', 'Headcount Cost'],
        alternatives: [
          { id: 'fac_hi', label: 'Headcount Investment' },
          { id: 'fac_hc', label: 'Headcount Cost' },
        ],
      }),
    );
    expect(mode).toBe('clarify');
  });

  it("integration: handleEditGraph commits when factor label contains 'and'", async () => {
    // Pin the full Mode B path end-to-end on the exact staging shape: base
    // graph carries a factor whose label contains "and", LLM emits a valid
    // update_edge op on that factor, dispatcher should NOT route to Mode A.
    const adapter = makeAdapter([
      {
        op: "update_edge",
        path: "fac_h::goal_1",
        value: { strength: { mean: 0.8 } },
      },
    ]);
    const ctx = makeContext({
      graph: {
        nodes: [
          { id: "goal_1", kind: "goal", label: "Q3 Delivery" },
          { id: "fac_h", kind: "factor", label: "Headcount and Scaling Spend" },
        ],
        edges: [
          {
            from: "fac_h",
            to: "goal_1",
            strength: { mean: 0.5, std: 0.1 },
            exists_probability: 0.9,
            effect_direction: "positive",
          },
        ],
      } as unknown as ConversationContext["graph"],
    });

    const result = await handleEditGraph(
      ctx,
      "make Headcount and Scaling Spend more important",
      adapter,
      "req-h6-int",
      "turn-h6-int",
    );

    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).not.toBeNull();
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
    // Must not be the Mode A propose-and-confirm copy.
    const text = result.assistantText ?? "";
    expect(text).not.toMatch(/I have (a )?change[s]? in mind|drafted a change/i);
  });

  // High-impact verb on a resolved label that contains a compound separator:
  // routing intentionally falls to Mode A because `isLowImpactEditRequest`
  // returns false (high-impact word present). Pins the
  // `buildProposedChanges` defence-in-depth — even on the Mode A path,
  // the resolved label must NOT be torn into two fake clauses
  // ("Headcount" + "Scaling Spend"). One coherent proposed change should
  // emerge with `element_label` set to the full resolved label.
  //
  // Phrasing chosen: "make … more important entirely" — "make" + "more"
  // classify as parameter_update (value-update verb + value target);
  // "entirely" is a high-impact marker, so `isLowImpactEditRequest`
  // returns false and the auto-apply gate at line 678-684 fails. The
  // simpler "double Headcount and Scaling Spend" would classify as
  // `structural` (no value-update verb) and short-circuit to auto_apply
  // before reaching the Mode A path that this test exercises.
  it("high-impact Mode A on label with separator emits one coherent change (no torn labels)", async () => {
    const adapter = makeAdapter({
      operations: [],
      coaching: { summary: '', rerun_recommended: false },
      warnings: [],
    });
    const ctx = makeContext({
      graph: {
        nodes: [
          { id: "goal_1", kind: "goal", label: "Q3 Delivery" },
          { id: "fac_h", kind: "factor", label: "Headcount and Scaling Spend" },
        ],
        edges: [
          {
            from: "fac_h",
            to: "goal_1",
            strength: { mean: 0.5, std: 0.1 },
            exists_probability: 0.9,
            effect_direction: "positive",
          },
        ],
      } as unknown as ConversationContext["graph"],
    });

    const result = await handleEditGraph(
      ctx,
      "make Headcount and Scaling Spend more important entirely",
      adapter,
      "req-h6-highimpact",
      "turn-h6-highimpact",
    );

    // parameter_update + high-impact ("entirely") + resolved label with
    // separator → Mode A. The defence-in-depth in buildProposedChanges
    // must strip the resolved label before splitting so the label is not
    // torn into two fake clauses.
    expect(result.wasRejected).toBe(false);
    expect(result.diagnostics?.resolution_mode).toBe("propose_and_confirm");
    expect(result.proposedChanges).toBeDefined();
    expect(result.proposedChanges!.changes).toHaveLength(1);
    expect(result.proposedChanges!.changes[0]!.element_label).toBe("Headcount and Scaling Spend");
    // The user-visible Mode A copy must NOT contain a torn "Scaling Spend"
    // fragment as a fake label.
    const text = result.assistantText ?? "";
    expect(text).not.toContain("**Scaling Spend**");
    expect(text).not.toContain("**Scaling Spend more important**");
    expect(text).not.toContain("**Headcount**");
  });
});
