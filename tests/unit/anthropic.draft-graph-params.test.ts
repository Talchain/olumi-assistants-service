/**
 * Unit tests for Anthropic adapter draft_graph parameter construction.
 *
 * Two layers:
 * 1. Static schema tests — ANTHROPIC_DRAFT_GRAPH_SCHEMA structure and model registry.
 * 2. Mock-based payload tests — assert the actual request params (body + headers +
 *    max_tokens + timeout) sent to messages.create for both flag states.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ANTHROPIC_DRAFT_GRAPH_SCHEMA } from "../../src/cee/draft/anthropic-graph-schema.js";
import { getModelProvider, isModelEnabled, supportsExtendedThinking } from "../../src/config/models.js";

// =============================================================================
// Static schema tests
// =============================================================================

describe("ANTHROPIC_DRAFT_GRAPH_SCHEMA", () => {
  it("requires nodes and edges at the top level", () => {
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.required).toContain("nodes");
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.required).toContain("edges");
  });

  it("nodes array items require id and kind", () => {
    const nodeSchema = ANTHROPIC_DRAFT_GRAPH_SCHEMA.properties.nodes;
    expect(nodeSchema.type).toBe("array");
    expect(nodeSchema.items.required).toContain("id");
    expect(nodeSchema.items.required).toContain("kind");
  });

  it("edges array items require from and to", () => {
    const edgeSchema = ANTHROPIC_DRAFT_GRAPH_SCHEMA.properties.edges;
    expect(edgeSchema.type).toBe("array");
    expect(edgeSchema.items.required).toContain("from");
    expect(edgeSchema.items.required).toContain("to");
  });

  it("node kind enum includes all valid graph node types", () => {
    const kindEnum = ANTHROPIC_DRAFT_GRAPH_SCHEMA.properties.nodes.items.properties.kind.enum;
    expect(kindEnum).toContain("goal");
    expect(kindEnum).toContain("decision");
    expect(kindEnum).toContain("option");
    expect(kindEnum).toContain("outcome");
    expect(kindEnum).toContain("risk");
    expect(kindEnum).toContain("factor");
    expect(kindEnum).toContain("action");
  });

  it("goal_constraints, coaching, causal_claims, topology_plan are all required (v0.11.0)", () => {
    // v0.11.0 schema amendment: coaching, causal_claims, topology_plan
    // are first-class declared types in @talchain/schemas and required
    // at the LLM structured-output boundary. `widening_log` and
    // `bias_signals` within coaching are optional during the v192b →
    // v194 transition; CEE's ingress normaliser fills empty defaults.
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.required).toContain("goal_constraints");
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.required).toContain("coaching");
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.required).toContain("causal_claims");
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.required).toContain("topology_plan");
  });

  it("top-level type is object with closed envelope (additionalProperties: false)", () => {
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.type).toBe("object");
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.additionalProperties).toBe(false);
  });

  it("is serialisable to JSON and round-trips correctly", () => {
    const serialised = JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
    const parsed = JSON.parse(serialised);
    expect(parsed.type).toBe("object");
    expect(parsed.required).toContain("nodes");
    expect(parsed.required).toContain("edges");
  });

  it("goal_constraints items require node_id and operator", () => {
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.properties.goal_constraints.items.required).toContain("node_id");
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.properties.goal_constraints.items.required).toContain("operator");
  });
});

// =============================================================================
// Model registry — claude-sonnet-4-6
// =============================================================================

describe("MODEL_REGISTRY — claude-sonnet-4-6", () => {
  it("provider is anthropic", () => {
    expect(getModelProvider("claude-sonnet-4-6")).toBe("anthropic");
  });

  it("is enabled", () => {
    expect(isModelEnabled("claude-sonnet-4-6")).toBe(true);
  });

  it("does not support extended thinking (not a capability of Sonnet 4.6)", () => {
    expect(supportsExtendedThinking("claude-sonnet-4-6")).toBe(false);
  });
});

// =============================================================================
// Structured Outputs — GA output_config.format shape
// =============================================================================

describe("Structured Outputs GA output_config.format shape", () => {
  it("uses output_config.format with schema key (GA path, not deprecated output_format)", () => {
    const outputConfig = {
      format: {
        type: "json_schema" as const,
        schema: ANTHROPIC_DRAFT_GRAPH_SCHEMA,
      },
    };
    expect(outputConfig.format.type).toBe("json_schema");
    expect(outputConfig.format.schema.required).toContain("nodes");
    expect(outputConfig.format.schema.required).toContain("edges");
    // Must NOT use the old json_schema key — that causes 400 from the API
    expect(outputConfig.format).not.toHaveProperty("json_schema");
  });

  it("no beta header required for GA structured outputs", () => {
    // GA since Jan 2026 — beta header "structured-outputs-2025-11-13" is NOT sent.
    // This test documents the expected state; the mock-based tests below verify it.
  });
});

// =============================================================================
// Mock-based request payload tests
//
// Strategy: mock `@anthropic-ai/sdk` so messages.create is a spy, then invoke
// draftGraphWithAnthropic and assert on the captured call arguments.
// vi.resetModules() + dynamic import ensures each test gets a fresh module
// with the mocked SDK wired in correctly.
// =============================================================================

// Minimal valid Anthropic response that passes schema validation downstream
function makeAnthropicResponse(jsonText: string) {
  return {
    content: [{ type: "text", text: jsonText }],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

// Minimal valid graph JSON that passes normaliseDraftResponse + schema validation
const VALID_GRAPH_JSON = JSON.stringify({
  nodes: [
    { id: "goal_1", kind: "goal", label: "Test goal" },
    { id: "dec_1", kind: "decision", label: "Test decision" },
    { id: "opt_1", kind: "option", label: "Option A" },
    { id: "out_1", kind: "outcome", label: "Revenue" },
  ],
  edges: [
    { from: "goal_1", to: "dec_1" },
    { from: "dec_1", to: "opt_1" },
    { from: "opt_1", to: "out_1", belief: 0.7, weight: 0.5 },
  ],
  rationales: [],
});

// Hoisted so the mock factories can reference them before beforeEach runs
const createSpy = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: createSpy };
    },
  };
});

// Stub the prompt loader to avoid Supabase network calls in unit tests.
// Returns a minimal system prompt string synchronously.
vi.mock("../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("You are an expert at drafting decision graphs."),
  getSystemPromptMeta: vi.fn().mockReturnValue({
    taskId: "draft_graph",
    prompt_version: "v19",
    prompt_hash: "test-hash",
    source: "default",
    version: null,
    instance_id: undefined,
    cache_age_ms: undefined,
    cache_status: "test",
    use_staging_mode: false,
  }),
  invalidatePromptCache: vi.fn(),
}));

describe("draftGraphWithAnthropic — request payload construction", () => {
  beforeEach(() => {
    vi.resetModules();
    createSpy.mockResolvedValue(makeAnthropicResponse(VALID_GRAPH_JSON));
  });

  afterEach(() => {
    createSpy.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("sends temperature=0, max_tokens≥8192, and no output_config when flag is off", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    });

    expect(createSpy).toHaveBeenCalledOnce();
    const [body, opts] = createSpy.mock.calls[0];

    // temperature must be 0 for analytical consistency
    expect(body.temperature).toBe(0);

    // max_tokens must meet the 8192 hard floor
    expect(body.max_tokens).toBeGreaterThanOrEqual(8192);

    // No structured outputs params when flag is off
    expect(body).not.toHaveProperty("output_config");
    expect(body).not.toHaveProperty("output_format");

    // No beta header (GA — never sent)
    const headers: Record<string, string> = opts?.headers ?? {};
    expect(headers["anthropic-beta"]).toBeUndefined();
  });

  it("sends output_config.format (GA) when flag is on and model is supported", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    });

    expect(createSpy).toHaveBeenCalledOnce();
    const [body, opts] = createSpy.mock.calls[0];

    // GA parameter: output_config.format (NOT deprecated output_format)
    expect(body).toHaveProperty("output_config");
    expect(body).not.toHaveProperty("output_format");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format).toHaveProperty("schema");
    expect(body.output_config.format).not.toHaveProperty("json_schema");
    expect(body.output_config.format.schema.required).toContain("nodes");
    expect(body.output_config.format.schema.required).toContain("edges");

    // No beta header — GA since Jan 2026
    const headers: Record<string, string> = opts?.headers ?? {};
    expect(headers["anthropic-beta"]).toBeUndefined();
  });

  it("does NOT send output_config when model is unsupported even if flag is on", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    // claude-3-5-haiku is not in the supported allowlist
    await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-3-5-haiku-20241022",
    });

    expect(createSpy).toHaveBeenCalledOnce();
    const [body, opts] = createSpy.mock.calls[0];

    expect(body).not.toHaveProperty("output_config");
    expect(body).not.toHaveProperty("output_format");
    const headers: Record<string, string> = opts?.headers ?? {};
    expect(headers["anthropic-beta"]).toBeUndefined();
  });

  it("always sends Idempotency-Key header", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    });

    const [, opts] = createSpy.mock.calls[0];
    const headers: Record<string, string> = opts?.headers ?? {};
    expect(typeof headers["Idempotency-Key"]).toBe("string");
    expect(headers["Idempotency-Key"].length).toBeGreaterThan(0);
  });

  it("max_tokens is floored at 8192 even when CEE_MAX_TOKENS_DRAFT is set very low", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_MAX_TOKENS_DRAFT", "512"); // well below the floor
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    });

    const [body] = createSpy.mock.calls[0];
    // Floor must be enforced regardless of config
    expect(body.max_tokens).toBeGreaterThanOrEqual(8192);
  });

  it("max_tokens respects CEE_MAX_TOKENS_DRAFT when above the floor", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_MAX_TOKENS_DRAFT", "32768");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    });

    const [body] = createSpy.mock.calls[0];
    expect(body.max_tokens).toBe(32768);
  });

  it("falls back to prompt-only mode when API rejects output_config as unsupported", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    // First call throws a 400 mentioning output_config; second call succeeds
    createSpy
      .mockRejectedValueOnce(
        Object.assign(new Error("Invalid parameter: output_config not supported"), { status: 400 })
      )
      .mockResolvedValueOnce(makeAnthropicResponse(VALID_GRAPH_JSON));

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    });

    // Should have been called twice: once with structured outputs, once without
    expect(createSpy).toHaveBeenCalledTimes(2);

    // Second call (fallback) should have no output_config
    const [fallbackBody] = createSpy.mock.calls[1];
    expect(fallbackBody).not.toHaveProperty("output_config");
    expect(fallbackBody).not.toHaveProperty("output_format");

    // The call should ultimately succeed and return a valid graph
    expect(result.graph.nodes.length).toBeGreaterThan(0);
  });

  it("falls back when API returns 'Unexpected key output_config' (capability rejection)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    createSpy
      .mockRejectedValueOnce(
        Object.assign(new Error("Unexpected key 'output_config' in request body"), { status: 400 })
      )
      .mockResolvedValueOnce(makeAnthropicResponse(VALID_GRAPH_JSON));

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    });

    // Should fall back — two calls total
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(result.graph.nodes.length).toBeGreaterThan(0);
  });

  it("emits cee.draft_graph.structured_outputs_fell_back telemetry on 'compiled grammar is too large' fallback (Lane 3 — non-silent degradation)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    // The live staging failure: grammar-compilation capacity 400.
    createSpy
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            "The compiled grammar is too large. Simplify your tool schemas or reduce the number of strict tools."
          ),
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(makeAnthropicResponse(VALID_GRAPH_JSON));

    // Same module registry as the adapter import below, so the sink is
    // installed on the exact telemetry instance the adapter calls.
    const telemetry = await import("../../src/utils/telemetry.js");
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    telemetry.setTestSink((name, data) => events.push({ name, data }));

    try {
      const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
      const result = await draftGraphWithAnthropic({
        brief: "Should I hire a contractor or full-time employee?",
        docs: [],
        seed: 17,
        model: "claude-sonnet-4-6",
      });

      // Fallback happened and succeeded.
      expect(createSpy).toHaveBeenCalledTimes(2);
      expect(result.graph.nodes.length).toBeGreaterThan(0);

      // The degradation is NOT silent: the telemetry event fired with the
      // diagnostic payload (alongside the WARN-level pino log).
      const fellBack = events.filter(
        (e) => e.name === telemetry.TelemetryEvents.CeeStructuredOutputsFellBack
      );
      expect(fellBack).toHaveLength(1);
      expect(fellBack[0].data.operation).toBe("draft_graph");
      expect(fellBack[0].data.model).toBe("claude-sonnet-4-6");
      expect(String(fellBack[0].data.error_snippet)).toContain("compiled grammar is too large");
      expect(Number(fellBack[0].data.schema_bytes)).toBeGreaterThan(0);
    } finally {
      telemetry.setTestSink(null);
    }
  });

  it("does NOT emit the fell-back event when structured outputs succeeds", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    createSpy.mockResolvedValueOnce(makeAnthropicResponse(VALID_GRAPH_JSON));

    const telemetry = await import("../../src/utils/telemetry.js");
    const events: Array<{ name: string }> = [];
    telemetry.setTestSink((name) => events.push({ name }));

    try {
      const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
      await draftGraphWithAnthropic({
        brief: "Should I hire a contractor or full-time employee?",
        docs: [],
        seed: 17,
        model: "claude-sonnet-4-6",
      });

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(
        events.some(
          (e) => e.name === telemetry.TelemetryEvents.CeeStructuredOutputsFellBack
        )
      ).toBe(false);
    } finally {
      telemetry.setTestSink(null);
    }
  });

  it("uses system parameter (not first user message) for the prompt", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    });

    const [body] = createSpy.mock.calls[0];

    // system must be an array of blocks (Anthropic system parameter)
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system.length).toBeGreaterThan(0);
    expect(body.system[0].type).toBe("text");

    // First user message must NOT contain the system prompt instructions
    const firstMessage = body.messages[0];
    expect(firstMessage.role).toBe("user");
    // The user message contains the brief, not raw system instructions
    expect(firstMessage.content).toContain("Should I hire a contractor");
  });

  it("does NOT fall back when API returns nested 'unexpected key' error (schema shape error)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    // Nested "unexpected key" is a schema shape error — must NOT trigger fallback.
    // This is different from "Unexpected key 'output_config'" which is a capability rejection.
    createSpy.mockRejectedValue(
      Object.assign(
        new Error("output_config.format: Unexpected key 'json_schema'. The expected format is {\"type\": \"json_schema\", \"schema\": {...}}."),
        { status: 400 }
      )
    );

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    await expect(
      draftGraphWithAnthropic({
        brief: "Should I hire a contractor or full-time employee?",
        docs: [],
        seed: 17,
        model: "claude-sonnet-4-6",
      })
    ).rejects.toThrow("Unexpected key");

    // Must NOT have retried with fallback — only the single failing call
    expect(createSpy).toHaveBeenCalledOnce();
  });

  it("uses safeExtractJson (not JSON.parse) when fallback response contains markdown fences", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    // The fallback (prompt-only) response wraps JSON in markdown fences — real-world Anthropic behaviour
    const fencedResponse = `Here is the decision graph:\n\n\`\`\`json\n${VALID_GRAPH_JSON}\n\`\`\``;

    createSpy
      .mockRejectedValueOnce(
        Object.assign(new Error("Invalid parameter: output_config not supported"), { status: 400 })
      )
      .mockResolvedValueOnce(makeAnthropicResponse(fencedResponse));

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    // Before the bug fix this threw because JSON.parse was called on the fenced response
    const result = await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    });

    expect(result.graph.nodes.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// chatWithAnthropic — structured outputs contract test (edit_graph path)
// =============================================================================

describe("chatWithAnthropic — output_config.format contract", () => {
  beforeEach(() => {
    vi.resetModules();
    createSpy.mockResolvedValue({
      content: [{ type: "text", text: '{"operations":[],"removed_edges":[],"warnings":[],"coaching":{}}' }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
  });

  afterEach(() => {
    createSpy.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("sends output_config.format (GA) with outputSchema and no beta header", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    const { chatWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    // Schema must be Anthropic-compliant by construction (no runtime normaliser)
    const testSchema = { type: "object", properties: { foo: { type: "string" } }, required: ["foo"], additionalProperties: false };

    await chatWithAnthropic({
      system: "You are a test assistant.",
      userMessage: "Test message",
      model: "claude-sonnet-4-6",
      outputSchema: testSchema,
    });

    expect(createSpy).toHaveBeenCalledOnce();
    const [body, opts] = createSpy.mock.calls[0];

    // Must use GA output_config.format, NOT deprecated output_format
    expect(body).toHaveProperty("output_config");
    expect(body).not.toHaveProperty("output_format");
    expect(body.output_config.format.type).toBe("json_schema");
    // Schema is passed through directly (compliant by construction, no normaliser)
    expect(body.output_config.format.schema.type).toBe("object");
    expect(body.output_config.format.schema.properties).toHaveProperty("foo");
    expect(body.output_config.format.schema.additionalProperties).toBe(false);
    expect(body.output_config.format.schema.required).toContain("foo");

    // No beta header
    const headers: Record<string, string> = opts?.headers ?? {};
    expect(headers["anthropic-beta"]).toBeUndefined();
  });

  it("sends output_config for claude-sonnet-5 (M2 review model — allowlist coverage)", async () => {
    // The V6 dual-draft M2 review is structured-outputs-only by design (D2)
    // and the Paul-adopted v0.4.3 baseline was measured ON Sonnet 5. Without
    // sonnet-5 in STRUCTURED_OUTPUTS_SUPPORTED_MODELS the adapter silently
    // falls back to prompt-only JSON — exactly the unconstrained-output churn
    // the M2 model-resolution gate exists to prevent. Live-probed 2026-07-14:
    // the GA output_config endpoint accepts claude-sonnet-5.
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    const { chatWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const testSchema = { type: "object", properties: { foo: { type: "string" } }, required: ["foo"], additionalProperties: false };

    await chatWithAnthropic({
      system: "You are a test assistant.",
      userMessage: "Test message",
      model: "claude-sonnet-5",
      outputSchema: testSchema,
    });

    expect(createSpy).toHaveBeenCalledOnce();
    const [body] = createSpy.mock.calls[0];
    expect(body).toHaveProperty("output_config");
    expect(body.output_config.format.type).toBe("json_schema");
    // rejectsSamplingParams: no explicit temperature for sonnet-5.
    expect(body.temperature).toBeUndefined();
  });

  it("passes thinking {type:'disabled'} through to the API body, keeping structured outputs active", async () => {
    // Models with ADAPTIVE thinking on by default (Sonnet 5) think unless the
    // request EXPLICITLY disables it — omitting the field is not neutral.
    // ThinkingConfig has carried {type:'disabled'} since it was introduced,
    // but the chat body builder silently dropped it. The V6 dual-draft M2
    // review depends on this passthrough to fit its 25s timeout.
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    const { chatWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const testSchema = { type: "object", properties: { foo: { type: "string" } }, required: ["foo"], additionalProperties: false };

    await chatWithAnthropic({
      system: "You are a test assistant.",
      userMessage: "Test message",
      model: "claude-sonnet-5",
      thinking: { type: "disabled" },
      outputSchema: testSchema,
    });

    expect(createSpy).toHaveBeenCalledOnce();
    const [body] = createSpy.mock.calls[0];
    expect(body.thinking).toEqual({ type: "disabled" });
    // Disabled thinking is NOT "thinking enabled": structured outputs stay on.
    expect(body).toHaveProperty("output_config");
  });

  it("does NOT send output_config when no outputSchema provided", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    const { chatWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    await chatWithAnthropic({
      system: "You are a test assistant.",
      userMessage: "Test message",
      model: "claude-sonnet-4-6",
    });

    const [body] = createSpy.mock.calls[0];
    expect(body).not.toHaveProperty("output_config");
    expect(body).not.toHaveProperty("output_format");
  });
});

// =============================================================================
// OpenAI adapter regression — draft_graph with gpt-4.1 is unaffected
// =============================================================================

describe("OpenAI draft_graph — unaffected by Anthropic structured outputs changes", () => {
  // This test uses a separate mock for the OpenAI SDK to verify the OpenAI
  // draft_graph path is independent of the Anthropic output_config changes.
  const openaiCreateSpy = vi.hoisted(() => vi.fn());

  vi.mock("openai", () => {
    return {
      default: class MockOpenAI {
        chat = {
          completions: {
            create: openaiCreateSpy,
          },
        };
      },
    };
  });

  beforeEach(() => {
    vi.resetModules();
    openaiCreateSpy.mockResolvedValue({
      choices: [{
        message: {
          content: VALID_GRAPH_JSON,
          role: "assistant",
        },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    });
  });

  afterEach(() => {
    openaiCreateSpy.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("sends response_format json_object (not output_config) for gpt-4.1", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const adapter = new OpenAIAdapter("gpt-4.1-2025-04-14");

    await adapter.draftGraph(
      { brief: "Should I expand into the EU market?", docs: [], seed: 42 },
      { requestId: "test-req-1" },
    );

    expect(openaiCreateSpy).toHaveBeenCalled();
    const [callArgs] = openaiCreateSpy.mock.calls[0];

    // OpenAI uses response_format, NOT output_config
    expect(callArgs.response_format).toEqual({ type: "json_object" });
    expect(callArgs).not.toHaveProperty("output_config");
    expect(callArgs).not.toHaveProperty("output_format");
    expect(callArgs.model).toBe("gpt-4.1-2025-04-14");
  });
});
