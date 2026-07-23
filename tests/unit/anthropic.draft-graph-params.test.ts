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
import { getAffordableDraftTokens, DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL } from "../../src/config/timeouts.js";

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

  it("sends temperature=0, an affordable max_tokens, and no output_config when flag is off", async () => {
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

    // max_tokens is DERIVED from the timeout (2026-07-20 outage fix,
    // recalibrated same day): at the derived 110s draft LLM timeout,
    // (110 - 15) * 90 tok/s = 8550 tokens. The overhead/floor constants come
    // from the settled 84-call two-parameter fit (13.26s + tokens/101.5) —
    // see tests/unit/draft-token-affordability.test.ts for the evidence pins.
    expect(body.max_tokens).toBe(8550);

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

  it("max_tokens is raised from a very low CEE_MAX_TOKENS_DRAFT — but only up to the affordable budget", async () => {
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
    // The "minimum safe value" floor still guards a too-low config, capped at
    // affordability: min(8192 floor, 8550 affordable) = 8192. A floor ABOVE
    // affordability was the exact 2026-07-20 defect — at the recalibrated
    // window the floor now genuinely fits.
    expect(body.max_tokens).toBe(8192);
  });

  it("max_tokens CLAMPS CEE_MAX_TOKENS_DRAFT down to the affordable budget (the outage config)", async () => {
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
    // A 32768-token config is unaffordable at every timeout on the ladder and is
    // clamped to the affordable budget. The affordability bound comes from
    // config/timeouts.ts getAffordableDraftTokens — the throughput FLOOR plus the
    // TTFB/overhead reserve — NOT from the fitted 101.5 marginal rate.
    // (Illustrative on the FLOOR basis: 32768/90 + 15s ≈ 379s — recompute from
    // config. At the fitted 101.5 rate the same tokens would be ~336s; the ~379s
    // figure is the floor-basis number, so don't attribute it to the fit.)
    // Honouring the config verbatim is how drafts hung to the timeout.
    expect(body.max_tokens).toBe(8550);
  });

  it("max_tokens is derived from the ACTUAL call-site timeout (opts.timeoutMs), not a global", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    await draftGraphWithAnthropic(
      {
        brief: "Should I hire a contractor or full-time employee?",
        docs: [],
        seed: 17,
        model: "claude-sonnet-4-6",
      },
      { timeoutMs: 45_000 },
    );

    const [body] = createSpy.mock.calls[0];
    // (45s - 15s overhead) * 90 tok/s = 2700 tokens affordable in this window.
    expect(body.max_tokens).toBe(2700);
  });

  it("a runaway generation truncated at max_tokens fails FAST with a truncation-typed error, not a generic non-JSON error", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    // Simulate the API cutting the generation at the token cap: stop_reason
    // "max_tokens" with JSON chopped mid-object.
    createSpy.mockResolvedValue({
      content: [{ type: "text", text: VALID_GRAPH_JSON.slice(0, 200) }],
      stop_reason: "max_tokens",
      usage: {
        input_tokens: 100,
        output_tokens: 6000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    let thrown: unknown;
    try {
      await draftGraphWithAnthropic({
        brief: "Should I hire a contractor or full-time employee?",
        docs: [],
        seed: 17,
        model: "claude-sonnet-4-6",
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/truncated at max_tokens/);

    // Probe aggravator 2 (S-AUDIT-2026-07-20): the failed call must carry its
    // LLM metadata on the thrown error so parse.ts captures it into ctx.llmMeta
    // and `_diagnostic_trace.llm_calls` is populated on failed drafts —
    // diagnosis must not require Render log access. Mirrors the existing
    // `_llm_meta` pattern the schema-validation failure path already uses.
    const meta = (thrown as { _llm_meta?: Record<string, unknown> })._llm_meta;
    expect(meta).toBeDefined();
    expect(meta!.model).toBe("claude-sonnet-4-6");
    expect(meta!.finish_reason).toBe("max_tokens");
    expect((meta!.token_usage as { completion_tokens: number }).completion_tokens).toBe(6000);
    expect(typeof meta!.provider_latency_ms).toBe("number");
    // Structured truncation flag — the pipeline's recovery-copy selection and
    // typed-400 mapping key off THIS, not off message-prefix matching.
    expect((thrown as { truncated_at_max_tokens?: boolean }).truncated_at_max_tokens).toBe(true);
  });

  it("a generation that hits max_tokens but still parses is ACCEPTED (truncated-but-parseable is the payoff)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    // stop_reason max_tokens but the text happens to be complete valid JSON
    // (cap landed exactly at the end of the payload).
    createSpy.mockResolvedValue({
      content: [{ type: "text", text: VALID_GRAPH_JSON }],
      stop_reason: "max_tokens",
      usage: {
        input_tokens: 100,
        output_tokens: 6000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    });
    expect(result.graph.nodes.length).toBeGreaterThan(0);
  });

  it("SALVAGE (2026-07-23 firefight): a truncation cut AFTER nodes+edges is recovered by closing the partial JSON, not thrown", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    // Nodes + edges are complete; the cut lands in a trailing `coaching` field.
    // The unparseable tail (`JSON.parse` fails) enters the salvage path, which
    // closes the JSON around the complete graph → schema-valid → ACCEPTED.
    const salvageable =
      VALID_GRAPH_JSON.slice(0, -1) + // drop the root's closing brace
      ',"coaching":"You should weigh the trade-off between speed and co'; // truncated field
    createSpy.mockResolvedValue({
      content: [{ type: "text", text: salvageable }],
      stop_reason: "max_tokens",
      usage: {
        input_tokens: 100,
        output_tokens: 8550,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    // Must NOT throw — the truncated draft is salvaged into a valid graph.
    const result = await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    });
    expect(result.graph.nodes.length).toBeGreaterThan(0);
    expect(result.graph.edges.length).toBeGreaterThan(0);
    // The salvage is observable on the meta (for the diagnostic trace).
    expect((result.meta as { salvaged_from_truncation?: boolean }).salvaged_from_truncation).toBe(true);
    // The incomplete `coaching` field was dropped, not fabricated.
    expect((result as { coaching?: unknown }).coaching).toBeUndefined();
  });

  it("SALVAGE SAFETY: a truncation cut INSIDE nodes (no edges yet) is NOT accepted — it fails the schema gate and throws typed", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    // Cut mid-nodes, before `edges` is emitted: closeTruncatedJson recovers a
    // syntactically-valid `{nodes:[...]}` with NO edges, which the draft schema
    // (edges required) REJECTS. The salvage must never ship an invalid graph.
    createSpy.mockResolvedValue({
      content: [{ type: "text", text: '{"nodes":[{"id":"a","kind":"decision","label":"Pick"},{"id":"b","kind":"opt' }],
      stop_reason: "max_tokens",
      usage: {
        input_tokens: 100,
        output_tokens: 8550,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    let thrown: unknown;
    try {
      await draftGraphWithAnthropic({
        brief: "Should I hire a contractor or full-time employee?",
        docs: [],
        seed: 17,
        model: "claude-sonnet-4-6",
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/truncated at max_tokens/);
    expect((thrown as { truncated_at_max_tokens?: boolean }).truncated_at_max_tokens).toBe(true);
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

  // ---------------------------------------------------------------------------
  // ROADMAP 2.90 (Codex #8) — THINKING CLAMP. When extended thinking is enabled
  // the TOTAL request (thinking budget + reserved output) must fit the affordable
  // envelope. The pre-2.90 adapter RAISED max_tokens to budget+1024 and warned;
  // the clamp reduces the budget instead so max_tokens is provably ≤ affordable.
  // ---------------------------------------------------------------------------

  it("thinking-on + the DEFAULT budget clamps the request so max_tokens ≤ affordable (no outage resurrection)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    // claude-sonnet-4-6 is in the adapter's thinking-supported allowlist.
    // The default CEE_DRAFT_GRAPH_THINKING_BUDGET is 10000; pre-2.90 that forced
    // max_tokens to 11024 > the 8550 affordable window. Pass it explicitly here.
    await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
      thinking: { type: "enabled", budget_tokens: 10000 },
    }, { timeoutMs: 110_000 });

    expect(createSpy).toHaveBeenCalledOnce();
    const [body] = createSpy.mock.calls[0];

    const affordable = getAffordableDraftTokens(110_000); // 8550
    // THE load-bearing guarantee: the effective request never exceeds affordable.
    expect(body.max_tokens).toBeLessThanOrEqual(affordable);
    // Thinking is still enabled but its budget was clamped below the request…
    expect(body.thinking.type).toBe("enabled");
    expect(body.thinking.budget_tokens).toBeLessThan(10000);
    // …and remains a strict subset of max_tokens (Anthropic's API constraint).
    expect(body.max_tokens).toBeGreaterThan(body.thinking.budget_tokens);
  });

  it("thinking-on with a budget that already fits is passed through unclamped", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
      thinking: { type: "enabled", budget_tokens: 4000 },
    }, { timeoutMs: 110_000 });

    const [body] = createSpy.mock.calls[0];
    const affordable = getAffordableDraftTokens(110_000);
    expect(body.thinking.budget_tokens).toBe(4000);
    expect(body.max_tokens).toBeLessThanOrEqual(affordable);
    expect(body.max_tokens).toBeGreaterThan(4000);
  });

  // ---------------------------------------------------------------------------
  // RECONCILIATION PIN (Lane 0a, 2026-07-21) — the #609 attempt-1 runaway
  // sentinel must STILL cap max_tokens after #608 HOISTED resolveDraftMaxTokens
  // into the provider-independent seam (draft-budget.ts). The hazard both PR
  // bodies flagged: if the hoisted wrapper keeps the OLD single-arg signature,
  // the `maxTokensCeiling` opt is silently dropped and the cap no-ops. This
  // drives the REAL threading end-to-end — opts.maxTokensCeiling → the hoisted
  // resolveDraftMaxTokens ceiling arg → the request body — through the mocked
  // SDK, so it fails RED if the ceiling threading is dropped at any hop.
  // ---------------------------------------------------------------------------

  it("an explicit below-affordability maxTokensCeiling STILL caps max_tokens after the 2.90 hoist (opts.maxTokensCeiling → hoisted wrapper → body)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    // At the default 110s window the timeout affords 8550 tokens. An explicit
    // ceiling BELOW that must be the binding cap (the 2026-07-23 firefight raised
    // the DEFAULT sentinel to the full affordable budget, so we pin the threading
    // mechanism with an explicit below-affordability value rather than the default).
    const affordable = getAffordableDraftTokens(110_000); // 8550
    const explicitCeiling = 6_800;
    expect(explicitCeiling).toBeLessThan(affordable);

    await draftGraphWithAnthropic(
      {
        brief: "Should I hire a contractor or full-time employee?",
        docs: [],
        seed: 17,
        model: "claude-sonnet-4-6",
      },
      { timeoutMs: 110_000, maxTokensCeiling: explicitCeiling },
    );

    const [body] = createSpy.mock.calls[0];
    // THE load-bearing pin: the wire max_tokens equals the ceiling, NOT the
    // 8550 the timeout would otherwise afford. Drop the ceiling threading (in
    // the call site or the hoisted wrapper's signature) and this reads 8550 → RED.
    expect(body.max_tokens).toBe(explicitCeiling);
    expect(body.max_tokens).toBeLessThan(affordable);
  });

  it("the DEFAULT attempt-1 sentinel is the FULL affordable budget — attempt 1 uses the whole window (2026-07-23 firefight)", async () => {
    // Post-firefight: threading the DEFAULT sentinel is a no-op (it equals
    // affordable), so attempt 1 sends the full 8550-token budget. This is what
    // lets the 6,800-8,550-token drafts finish on attempt 1 instead of truncating.
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const affordable = getAffordableDraftTokens(110_000); // 8550
    expect(DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL).toBe(affordable);

    await draftGraphWithAnthropic(
      {
        brief: "Should I hire a contractor or full-time employee?",
        docs: [],
        seed: 17,
        model: "claude-sonnet-4-6",
      },
      { timeoutMs: 110_000, maxTokensCeiling: DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL },
    );

    const [body] = createSpy.mock.calls[0];
    expect(body.max_tokens).toBe(affordable); // 8550 — the ceiling is a no-op
  });

  it("thinking-on but a tight timeout cannot afford it → thinking DISABLED, request stays ≤ affordable", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    // 32s timeout → (32-15)*90 = 1530 affordable; can't fit 1024 thinking + 1024 output.
    await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
      thinking: { type: "enabled", budget_tokens: 4000 },
    }, { timeoutMs: 32_000 });

    const [body] = createSpy.mock.calls[0];
    const affordable = getAffordableDraftTokens(32_000);
    // Thinking is dropped rather than shipped unaffordable — no thinking block sent.
    expect(body).not.toHaveProperty("thinking");
    expect(body.max_tokens).toBeLessThanOrEqual(affordable);
    // Disabled thinking reverts temperature to 0 (thinking requires temperature=1).
    expect(body.temperature).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // SAMPLING-PARAM PARITY (2026-07-23). The draft path was the 4th of 4 Anthropic
  // call sites and the ONLY one that sent temperature unconditionally — so a model
  // with rejectsSamplingParams:true (Sonnet 5 / Opus 4.7+ / Fable 5) 400'd on
  // draft, blocking the draft model-swap lever. The chat / chat_with_tools /
  // stream sites already gate temperature behind rejectsSamplingParams; the fix
  // brings draft to parity (undefined → the SDK drops the key from the request).
  // ---------------------------------------------------------------------------

  it("a rejectsSamplingParams model (claude-sonnet-5) on the draft path OMITS temperature — no explicit sampling param, so no 400", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-5",
    });

    expect(createSpy).toHaveBeenCalledOnce();
    const [body] = createSpy.mock.calls[0];

    // House pattern (mirrors the chat-path sonnet-5 pin at
    // `chatWithAnthropic — output_config.format contract`): temperature is
    // undefined, which the SDK's JSON serialisation drops from the body entirely.
    expect(body.temperature).toBeUndefined();
    // Wire-level truth, mechanism-agnostic: the serialised request carries NO
    // temperature key at all — this is exactly what averts the 400 on Sonnet 5.
    // Revert the rejectsSamplingParams gate on draftTemperature and this reads
    // `"temperature":0` → RED.
    expect(JSON.stringify(body)).not.toContain("temperature");
  });

  it("a non-rejecting model (claude-sonnet-4-6) on the draft path STILL sends temperature=0 — the fix is scoped to rejectsSamplingParams models", async () => {
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
    expect(body.temperature).toBe(0);
  });

  it("thinking-on for a non-rejecting model (claude-sonnet-4-6) STILL sends temperature=1 — the extended-thinking temperature rule is untouched for models that accept sampling params", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    // claude-sonnet-4-6 is in the adapter's thinking allowlist; a 4000-token
    // budget at the 110s window is affordable, so thinking stays enabled.
    await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
      thinking: { type: "enabled", budget_tokens: 4000 },
    }, { timeoutMs: 110_000 });

    const [body] = createSpy.mock.calls[0];
    expect(body.thinking.type).toBe("enabled");
    // Extended thinking active + non-rejecting model → Anthropic's temperature=1 rule.
    expect(body.temperature).toBe(1);
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

  it("does NOT send output_config for claude-sonnet-5 without a per-call override (shared-allowlist live-safety pin)", async () => {
    // claude-sonnet-5 is deliberately NOT in STRUCTURED_OUTPUTS_SUPPORTED_MODELS:
    // that SHARED set also keys buildStrictAnthropicTools (strict tool calling,
    // no env gate) for every live /orchestrate/v2/turn, and would flip the
    // edit_graph/draft prompt-only fallbacks under
    // CEE_ANTHROPIC_STRUCTURED_OUTPUTS=true. A bare chat call on sonnet-5 —
    // which is exactly what edit_graph makes — must keep today's prompt-only
    // fallback even with the env flag on.
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
    expect(body).not.toHaveProperty("output_config");
    expect(body).not.toHaveProperty("output_format");
  });

  it("sends output_config for claude-sonnet-5 when the caller threads structuredOutputsAdditionalModels (M2 review scoped mechanism)", async () => {
    // The V6 dual-draft M2 review is structured-outputs-only by design (D2)
    // and the Paul-adopted v0.4.3 baseline was measured ON Sonnet 5.
    // Live-probed 2026-07-14: the GA output_config endpoint accepts
    // claude-sonnet-5. The capability is opted into PER CALL via
    // structuredOutputsAdditionalModels — threaded from m2-review.ts — so
    // ONLY the M2 call gets structured outputs on sonnet-5; the shared
    // allowlist (and with it strict tool calling + the edit_graph/draft
    // fallbacks) is untouched.
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    const { chatWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const testSchema = { type: "object", properties: { foo: { type: "string" } }, required: ["foo"], additionalProperties: false };

    await chatWithAnthropic({
      system: "You are a test assistant.",
      userMessage: "Test message",
      model: "claude-sonnet-5",
      outputSchema: testSchema,
      structuredOutputsAdditionalModels: ["claude-sonnet-5"],
    });

    expect(createSpy).toHaveBeenCalledOnce();
    const [body] = createSpy.mock.calls[0];
    expect(body).toHaveProperty("output_config");
    expect(body.output_config.format.type).toBe("json_schema");
    // rejectsSamplingParams: no explicit temperature for sonnet-5.
    expect(body.temperature).toBeUndefined();
  });

  it("per-call override still requires CEE_ANTHROPIC_STRUCTURED_OUTPUTS=true (env gate is not bypassed)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    const { chatWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const testSchema = { type: "object", properties: { foo: { type: "string" } }, required: ["foo"], additionalProperties: false };

    await chatWithAnthropic({
      system: "You are a test assistant.",
      userMessage: "Test message",
      model: "claude-sonnet-5",
      outputSchema: testSchema,
      structuredOutputsAdditionalModels: ["claude-sonnet-5"],
    });

    expect(createSpy).toHaveBeenCalledOnce();
    const [body] = createSpy.mock.calls[0];
    expect(body).not.toHaveProperty("output_config");
    expect(body).not.toHaveProperty("output_format");
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
      // Mirrors the real M2 call: sonnet-5 structured outputs are opted into
      // per-call, not via the shared allowlist.
      structuredOutputsAdditionalModels: ["claude-sonnet-5"],
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

  // ---------------------------------------------------------------------------
  // ROADMAP 2.90 (Codex #9) — the OpenAI draft path shares the affordability
  // cap and the truncation policy with the Anthropic path.
  // ---------------------------------------------------------------------------

  it("ALWAYS sends a derived token cap even when CEE_MAX_TOKENS_DRAFT is unset (no more raw/absent cap)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    // CEE_MAX_TOKENS_DRAFT intentionally unset — pre-2.90 this omitted the cap.

    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    // gpt-4o is a legacy model → the cap rides on max_tokens (not max_completion_tokens).
    const adapter = new OpenAIAdapter("gpt-4o");

    await adapter.draftGraph(
      { brief: "Should I expand into the EU market?", docs: [], seed: 42 },
      { requestId: "test-openai-cap", timeoutMs: 110_000 },
    );

    const [callArgs] = openaiCreateSpy.mock.calls[0];
    // The cap is DERIVED from the call-site timeout — recompute it, do not pin.
    const affordable = getAffordableDraftTokens(110_000);
    expect(callArgs.max_tokens).toBe(affordable);
    expect(callArgs.max_tokens).toBeGreaterThanOrEqual(1);
  });

  it("the derived cap follows the ACTUAL call-site timeout, not a global", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const adapter = new OpenAIAdapter("gpt-4o");

    await adapter.draftGraph(
      { brief: "Should I expand into the EU market?", docs: [], seed: 42 },
      { requestId: "test-openai-cap-2", timeoutMs: 45_000 },
    );

    const [callArgs] = openaiCreateSpy.mock.calls[0];
    expect(callArgs.max_tokens).toBe(getAffordableDraftTokens(45_000)); // (45-15)*90 = 2700
  });

  it("a draft truncated at finish_reason=length that STILL parses is ACCEPTED (truncated-but-parseable payoff)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    openaiCreateSpy.mockResolvedValue({
      choices: [{ message: { content: VALID_GRAPH_JSON, role: "assistant" }, finish_reason: "length" }],
      usage: { prompt_tokens: 100, completion_tokens: 8550, total_tokens: 8650 },
    });

    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const adapter = new OpenAIAdapter("gpt-4o");

    const result = await adapter.draftGraph(
      { brief: "Should I expand into the EU market?", docs: [], seed: 42 },
      { requestId: "test-openai-trunc-ok", timeoutMs: 110_000 },
    );
    // Complete valid JSON despite finish_reason=length → accepted.
    expect(result.graph.nodes.length).toBeGreaterThan(0);
    expect(result.meta?.finish_reason).toBe("length");
  });

  it("a runaway draft truncated at finish_reason=length with unparseable JSON fails FAST and TYPED (truncated_at_max_tokens)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    // A generation cut mid-object — valid JSON prefix, no closing braces.
    const partial = '{"nodes":[{"id":"goal_1","kind":"goal","label":"Grow rev';
    openaiCreateSpy.mockResolvedValue({
      choices: [{ message: { content: partial, role: "assistant" }, finish_reason: "length" }],
      usage: { prompt_tokens: 100, completion_tokens: 8550, total_tokens: 8650 },
    });

    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const { UpstreamNonJsonError } = await import("../../src/adapters/llm/errors.js");
    const adapter = new OpenAIAdapter("gpt-4o");

    let thrown: unknown;
    try {
      await adapter.draftGraph(
        { brief: "Should I expand into the EU market?", docs: [], seed: 42 },
        { requestId: "test-openai-trunc-fail", timeoutMs: 110_000 },
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UpstreamNonJsonError);
    expect((thrown as Error).message).toMatch(/truncated at max_tokens/);
    // Structured flag — the pipeline's recovery-copy selection keys off it.
    expect((thrown as { truncated_at_max_tokens?: boolean }).truncated_at_max_tokens).toBe(true);
    // Failed-call metadata carries the finish reason for the diagnostic trace.
    const meta = (thrown as { _llm_meta?: { finish_reason?: string } })._llm_meta;
    expect(meta?.finish_reason).toBe("length");
  });
});
