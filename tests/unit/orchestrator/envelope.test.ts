import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { assembleEnvelope, buildTurnPlan } from "../../../src/orchestrator/envelope.js";
import { getHttpStatusForError } from "../../../src/orchestrator/types.js";
import type {
  ConversationContext,
  V2RunResponseEnvelope,
  OrchestratorError,
  TypedConversationBlock,
  GraphPatchBlockData,
  GraphV3T,
} from "../../../src/orchestrator/types.js";
import { createGraphPatchBlock } from "../../../src/orchestrator/blocks/factory.js";
import { log } from "../../../src/utils/telemetry.js";

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: null,
    analysis_response: null,
    framing: { stage: "frame" },
    messages: [],
    scenario_id: "test-scenario",
    ...overrides,
  };
}

describe("Envelope Assembly", () => {
  it("assembles minimal envelope", () => {
    const envelope = assembleEnvelope({
      assistantText: "Hello",
      blocks: [],
      context: makeContext(),
    });

    expect(envelope.turn_id).toBeDefined();
    expect(envelope.assistant_text).toBe("Hello");
    expect(envelope.blocks).toEqual([]);
    expect(envelope.lineage.context_hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("uses provided turnId", () => {
    const envelope = assembleEnvelope({
      turnId: "my-turn-id",
      assistantText: null,
      blocks: [],
      context: makeContext(),
    });

    expect(envelope.turn_id).toBe("my-turn-id");
  });

  it("includes analysis response when provided", () => {
    const analysisResponse = {
      meta: { seed_used: 42, n_samples: 1000, response_hash: "meta-hash" },
      results: [],
      response_hash: "top-level-hash",
    } as unknown as V2RunResponseEnvelope;

    const envelope = assembleEnvelope({
      assistantText: null,
      blocks: [],
      context: makeContext(),
      analysisResponse,
    });

    expect(envelope.analysis_response).toBeDefined();
    expect(envelope.lineage.response_hash).toBe("top-level-hash");
    expect(envelope.lineage.seed_used).toBe(42);
    expect(envelope.lineage.n_samples).toBe(1000);
  });

  it("falls back to meta.response_hash if top-level absent", () => {
    const analysisResponse = {
      meta: { seed_used: "42", n_samples: 1000, response_hash: "meta-hash" },
      results: [],
    } as unknown as V2RunResponseEnvelope;

    const envelope = assembleEnvelope({
      assistantText: null,
      blocks: [],
      context: makeContext(),
      analysisResponse,
    });

    expect(envelope.lineage.response_hash).toBe("meta-hash");
    // seed_used arrives as string — should be parsed as Number
    expect(envelope.lineage.seed_used).toBe(42);
  });

  it("includes stage indicator from framing", () => {
    const envelope = assembleEnvelope({
      assistantText: null,
      blocks: [],
      context: makeContext({ framing: { stage: "evaluate" } }),
    });

    expect(envelope.stage_indicator).toBe("evaluate");
    expect(envelope.stage_label).toBe("Evaluating options");
  });

  it("omits stage indicator when framing absent", () => {
    const envelope = assembleEnvelope({
      assistantText: null,
      blocks: [],
      context: makeContext({ framing: null }),
    });

    expect(envelope.stage_indicator).toBeUndefined();
  });

  it("includes turn plan when provided", () => {
    const plan = buildTurnPlan("run_analysis", "deterministic", true, 1500);

    const envelope = assembleEnvelope({
      assistantText: null,
      blocks: [],
      context: makeContext(),
      turnPlan: plan,
    });

    expect(envelope.turn_plan).toEqual({
      selected_tool: "run_analysis",
      routing: "deterministic",
      long_running: true,
      tool_latency_ms: 1500,
    });
  });

  it("includes error when provided", () => {
    const error: OrchestratorError = {
      code: "TOOL_EXECUTION_FAILED",
      message: "PLoT failed",
      tool: "run_analysis",
      recoverable: true,
    };

    const envelope = assembleEnvelope({
      assistantText: null,
      blocks: [],
      context: makeContext(),
      error,
    });

    expect(envelope.error).toEqual(error);
  });
});

describe("Turn Plan Builder", () => {
  it("builds plan without latency", () => {
    const plan = buildTurnPlan("draft_graph", "llm", true);
    expect(plan).toEqual({
      selected_tool: "draft_graph",
      routing: "llm",
      long_running: true,
    });
    expect(plan.tool_latency_ms).toBeUndefined();
  });

  it("builds plan with latency", () => {
    const plan = buildTurnPlan("run_analysis", "deterministic", true, 2500);
    expect(plan.tool_latency_ms).toBe(2500);
  });

  it("builds plan for pure conversation", () => {
    const plan = buildTurnPlan(null, "llm", false);
    expect(plan.selected_tool).toBeNull();
    expect(plan.long_running).toBe(false);
  });
});

// ============================================================================
// Regression: analysis_ready validator (no recompute)
// ============================================================================
//
// Until 2026-04-08, assembleEnvelope ran recomputeAnalysisReady which called
// computeStructuralReadiness on the post-patch graph and unconditionally
// overwrote the handler-produced analysis_ready. Pipeline option nodes do not
// reliably carry intervention bundles on node.interventions, so the recompute
// returned needs_encoding with empty interventions, silently corrupting the
// happy-path draft_graph response. These tests pin the new contract: the
// envelope must validate but never overwrite handler-produced analysis_ready.
//
// See: docs/intervention-lifecycle-and-health-audit-2026-04-08.md §6.

function makeOptionNodeWithoutInterventions(id: string, label: string) {
  // The shape that triggered the original bug: option node with no
  // node.interventions bundle. The unified pipeline carries interventions
  // on options[].interventions, not on node.interventions, so a recompute
  // against this graph would have stripped the handler payload.
  return { id, kind: "option" as const, label };
}

function makeContextWithBareOptionGraph(): ConversationContext {
  const graph = {
    nodes: [
      { id: "goal_revenue", kind: "goal", label: "Revenue", goal_threshold: 100 },
      { id: "fac_price", kind: "factor", label: "Price" },
      makeOptionNodeWithoutInterventions("opt_raise", "Raise prices"),
      makeOptionNodeWithoutInterventions("opt_hold", "Hold prices"),
    ],
    edges: [
      { from: "fac_price", to: "goal_revenue", strength: { mean: 0.5, std: 0.1 }, exists_probability: 1.0, effect_direction: "positive" },
      { from: "opt_raise", to: "fac_price", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: "positive" },
      { from: "opt_hold", to: "fac_price", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: "positive" },
    ],
  } as unknown as GraphV3T;

  return {
    graph,
    analysis_response: null,
    framing: { stage: "ideate" },
    messages: [],
    scenario_id: "regression-scenario",
  };
}

function makeReadyAnalysisReady(): NonNullable<GraphPatchBlockData['analysis_ready']> {
  return {
    options: [
      { option_id: "opt_raise", label: "Raise prices", status: "ready", interventions: { fac_price: 0.7 } },
      { option_id: "opt_hold", label: "Hold prices", status: "ready", interventions: { fac_price: 0.3 } },
    ],
    goal_node_id: "goal_revenue",
    status: "ready",
  };
}

function makeFullDraftPatchBlock(
  data: Partial<GraphPatchBlockData> & Pick<GraphPatchBlockData, 'patch_type' | 'operations' | 'status'>,
  turnId = "regression-turn",
): TypedConversationBlock {
  return createGraphPatchBlock(data as GraphPatchBlockData, turnId);
}

describe("Envelope analysis_ready validation (regression)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => log);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("preserves handler-produced ready analysis_ready unchanged", () => {
    const handlerProduced = makeReadyAnalysisReady();
    const block = makeFullDraftPatchBlock({
      patch_type: 'full_draft',
      operations: [{ op: 'add_node', path: '/nodes/opt_raise', value: { id: 'opt_raise', kind: 'option', label: 'Raise prices' } }],
      status: 'proposed',
      auto_apply: true,
      analysis_ready: handlerProduced,
    });

    const envelope = assembleEnvelope({
      assistantText: "Drafted.",
      blocks: [block],
      context: makeContextWithBareOptionGraph(),
    });

    const outBlock = envelope.blocks[0];
    expect(outBlock).toBeDefined();
    expect(outBlock.block_type).toBe('graph_patch');
    const outData = outBlock.data as GraphPatchBlockData;
    // The critical assertion: the handler payload survives the envelope intact.
    expect(outData.analysis_ready).toEqual(handlerProduced);
    expect(outData.analysis_ready?.status).toBe('ready');
    for (const opt of outData.analysis_ready?.options ?? []) {
      expect(opt.status).toBe('ready');
      expect(Object.keys(opt.interventions).length).toBeGreaterThan(0);
      for (const v of Object.values(opt.interventions)) {
        expect(typeof v).toBe('number');
      }
    }
    // No needs_encoding regressions.
    for (const opt of outData.analysis_ready?.options ?? []) {
      expect(opt.status).not.toBe('needs_encoding');
    }
  });

  it("warns but does not mutate when analysis_ready is missing on a graph_patch block", () => {
    const block = makeFullDraftPatchBlock({
      patch_type: 'edit',
      operations: [{ op: 'add_node', path: '/nodes/fac_x', value: { id: 'fac_x', kind: 'factor', label: 'X' } }],
      status: 'proposed',
      auto_apply: false,
    });

    const envelope = assembleEnvelope({
      assistantText: null,
      blocks: [block],
      context: makeContextWithBareOptionGraph(),
    });

    const outData = envelope.blocks[0].data as GraphPatchBlockData;
    expect(outData.analysis_ready).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    const warnedMessages = warnSpy.mock.calls.map((c) => c[1]);
    expect(warnedMessages.some((m) => typeof m === 'string' && m.includes('no analysis_ready'))).toBe(true);
  });

  it("does not throw when analysis_ready.options is missing entirely", () => {
    // Defensive regression: an earlier draft of the validator did
    // `data.analysis_ready.options.map(...)` without guarding, which would
    // throw TypeError on a payload like this and crash envelope assembly.
    const malformed = {
      goal_node_id: 'goal_revenue',
      status: 'ready',
      // options field intentionally absent
    } as unknown as NonNullable<GraphPatchBlockData['analysis_ready']>;

    const block = makeFullDraftPatchBlock({
      patch_type: 'full_draft',
      operations: [{ op: 'add_node', path: '/nodes/g', value: { id: 'g', kind: 'goal', label: 'G' } }],
      status: 'proposed',
      auto_apply: true,
      analysis_ready: malformed,
    });

    expect(() => assembleEnvelope({
      assistantText: null,
      blocks: [block],
      context: makeContextWithBareOptionGraph(),
    })).not.toThrow();

    const warnedMessages = warnSpy.mock.calls.map((c) => c[1]);
    expect(warnedMessages.some((m) => typeof m === 'string' && m.includes('missing or non-array options'))).toBe(true);
  });

  it("does not throw when analysis_ready.options is non-array (e.g. null)", () => {
    const malformed = {
      goal_node_id: 'goal_revenue',
      status: 'ready',
      options: null,
    } as unknown as NonNullable<GraphPatchBlockData['analysis_ready']>;

    const block = makeFullDraftPatchBlock({
      patch_type: 'full_draft',
      operations: [{ op: 'add_node', path: '/nodes/g', value: { id: 'g', kind: 'goal', label: 'G' } }],
      status: 'proposed',
      auto_apply: true,
      analysis_ready: malformed,
    });

    expect(() => assembleEnvelope({
      assistantText: null,
      blocks: [block],
      context: makeContextWithBareOptionGraph(),
    })).not.toThrow();

    const warnedMessages = warnSpy.mock.calls.map((c) => c[1]);
    expect(warnedMessages.some((m) => typeof m === 'string' && m.includes('missing or non-array options'))).toBe(true);
  });

  it("validates analysis_ready shape on accepted/rejected blocks too when present", () => {
    // Skip rule applies only to the missing-payload warning. If a non-proposed
    // block does carry analysis_ready, we still validate its shape — that's
    // a useful upstream-bug detector.
    const malformed = {
      goal_node_id: 'goal_revenue',
      status: 'ready',
      // options missing
    } as unknown as NonNullable<GraphPatchBlockData['analysis_ready']>;

    const block = makeFullDraftPatchBlock({
      patch_type: 'edit',
      operations: [],
      status: 'accepted',
      analysis_ready: malformed,
    });

    assembleEnvelope({
      assistantText: null,
      blocks: [block],
      context: makeContextWithBareOptionGraph(),
    });

    const warnedMessages = warnSpy.mock.calls.map((c) => c[1]);
    expect(warnedMessages.some((m) => typeof m === 'string' && m.includes('missing or non-array options'))).toBe(true);
  });

  it("warns but does not mutate when analysis_ready fails Zod validation", () => {
    const malformed = {
      // Missing goal_node_id and status — schema must reject.
      options: [
        { option_id: "opt_raise", label: "Raise", status: "ready", interventions: { fac_price: 0.7 } },
      ],
    } as unknown as NonNullable<GraphPatchBlockData['analysis_ready']>;

    const block = makeFullDraftPatchBlock({
      patch_type: 'full_draft',
      operations: [{ op: 'add_node', path: '/nodes/opt_raise', value: { id: 'opt_raise', kind: 'option', label: 'Raise' } }],
      status: 'proposed',
      auto_apply: true,
      analysis_ready: malformed,
    });

    const envelope = assembleEnvelope({
      assistantText: null,
      blocks: [block],
      context: makeContextWithBareOptionGraph(),
    });

    const outData = envelope.blocks[0].data as GraphPatchBlockData;
    // Validator must NOT mutate — malformed payload passes through unchanged.
    expect(outData.analysis_ready).toBe(malformed);
    expect(warnSpy).toHaveBeenCalled();
    const warnedMessages = warnSpy.mock.calls.map((c) => c[1]);
    expect(warnedMessages.some((m) => typeof m === 'string' && m.includes('failed schema validation'))).toBe(true);
  });

  it.each(['rejected', 'accepted', 'dismissed'] as const)(
    "does not warn for %s patches without analysis_ready",
    (status) => {
      const block = makeFullDraftPatchBlock({
        patch_type: 'edit',
        operations: [{ op: 'add_node', path: '/nodes/fac_x', value: { id: 'fac_x', kind: 'factor', label: 'X' } }],
        status,
        ...(status === 'rejected' ? { rejection: { reason: 'validation failed' } } : {}),
      });

      assembleEnvelope({
        assistantText: null,
        blocks: [block],
        context: makeContextWithBareOptionGraph(),
      });

      // Only freshly proposed patches are validated; other statuses skip silently.
      const warnedMessages = warnSpy.mock.calls.map((c) => c[1]);
      expect(warnedMessages.some((m) => typeof m === 'string' && m.includes('no analysis_ready'))).toBe(false);
    },
  );
});

describe("HTTP Status Mapping", () => {
  it.each([
    ["LLM_TIMEOUT" as const, 504],
    ["TOOL_EXECUTION_FAILED" as const, 502],
    ["VALIDATION_REJECTED" as const, 422],
    ["CONTEXT_TOO_LARGE" as const, 413],
    ["INVALID_REQUEST" as const, 400],
    ["UNKNOWN" as const, 500],
  ])("maps %s to %d", (code, expectedStatus) => {
    const error: OrchestratorError = {
      code,
      message: "test",
      recoverable: false,
    };
    expect(getHttpStatusForError(error)).toBe(expectedStatus);
  });
});
