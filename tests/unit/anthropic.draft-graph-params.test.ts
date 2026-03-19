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

  it("coaching, goal_constraints, and topology_plan are optional", () => {
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.required).not.toContain("coaching");
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.required).not.toContain("goal_constraints");
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.required).not.toContain("topology_plan");
  });

  it("top-level type is object and allows additional properties", () => {
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.type).toBe("object");
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.additionalProperties).toBe(true);
  });

  it("is serialisable to JSON and round-trips correctly", () => {
    const serialised = JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
    const parsed = JSON.parse(serialised);
    expect(parsed.type).toBe("object");
    expect(parsed.required).toContain("nodes");
    expect(parsed.required).toContain("edges");
  });

  it("causal_claims items require type field", () => {
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.properties.causal_claims.items.required).toContain("type");
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
// Structured Outputs output_format shape
// =============================================================================

describe("Structured Outputs output_format shape", () => {
  it("schema can be embedded in output_format body", () => {
    const outputFormat = {
      type: "json_schema",
      json_schema: ANTHROPIC_DRAFT_GRAPH_SCHEMA,
    };
    expect(outputFormat.type).toBe("json_schema");
    expect(outputFormat.json_schema.required).toContain("nodes");
  });

  it("beta header value matches Anthropic documented format", () => {
    const EXPECTED_BETA_HEADER = "structured-outputs-2025-11-13";
    expect(EXPECTED_BETA_HEADER).toMatch(/^structured-outputs-\d{4}-\d{2}-\d{2}$/);
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

  it("sends temperature=0, max_tokens≥8192, and no output_format when flag is off", async () => {
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

    // No output_format when Structured Outputs disabled
    expect(body).not.toHaveProperty("output_format");

    // No beta header when Structured Outputs disabled
    const headers: Record<string, string> = opts?.headers ?? {};
    expect(headers["anthropic-beta"]).toBeUndefined();
  });

  it("sends output_format + beta header when flag is on and model is supported", async () => {
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

    // output_format must be present with correct type
    expect(body).toHaveProperty("output_format");
    expect(body.output_format.type).toBe("json_schema");
    expect(body.output_format.json_schema).toBeDefined();
    expect(body.output_format.json_schema.required).toContain("nodes");
    expect(body.output_format.json_schema.required).toContain("edges");

    // Beta header must be present
    const headers: Record<string, string> = opts?.headers ?? {};
    expect(headers["anthropic-beta"]).toBe("structured-outputs-2025-11-13");
  });

  it("does NOT send output_format when model is unsupported even if flag is on", async () => {
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

  it("falls back to prompt-only mode when API rejects output_format with 400", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    // First call throws a 400 mentioning output_format; second call succeeds
    createSpy
      .mockRejectedValueOnce(
        Object.assign(new Error("Invalid parameter: output_format not supported"), { status: 400 })
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

    // Second call (fallback) should have no output_format
    const [fallbackBody, fallbackOpts] = createSpy.mock.calls[1];
    expect(fallbackBody).not.toHaveProperty("output_format");
    expect(fallbackOpts?.headers?.["anthropic-beta"]).toBeUndefined();

    // The call should ultimately succeed and return a valid graph
    expect(result.graph.nodes.length).toBeGreaterThan(0);
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

  it("uses safeExtractJson (not JSON.parse) when fallback response contains markdown fences", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    // The fallback (prompt-only) response wraps JSON in markdown fences — real-world Anthropic behaviour
    const fencedResponse = `Here is the decision graph:\n\n\`\`\`json\n${VALID_GRAPH_JSON}\n\`\`\``;

    createSpy
      .mockRejectedValueOnce(
        Object.assign(new Error("Invalid parameter: output_format not supported"), { status: 400 })
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
