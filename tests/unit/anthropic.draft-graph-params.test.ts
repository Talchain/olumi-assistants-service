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

// Lane C (2026-07-23): the draft path now STREAMS (messages.stream). A fake
// MessageStream that yields the JSON as text deltas, then resolves finalMessage
// with the same {content, stop_reason, usage} shape messages.create returned —
// so the body-contract assertions below (temperature / max_tokens /
// output_config / idempotency / salvage / truncation typing) are unchanged; only
// the transport moved. `chunks` lets a test drip the text so the in-stream
// runaway detector sees it grow; `hangAfterChunks` simulates a silent thrash
// (no more deltas) so the time-deadline detector can fire.
type FakeStreamOpts = {
  stop_reason?: string;
  usage?: Record<string, number>;
  chunks?: string[];
  hangAfterChunks?: boolean;
};
function makeAbortError(): Error {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  return e;
}
function makeFakeStream(jsonText: string, opts: FakeStreamOpts = {}) {
  return (_body: unknown, options?: { signal?: AbortSignal; headers?: Record<string, string> }) => {
    const signal = options?.signal;
    const chunks = opts.chunks ?? [jsonText];
    async function* gen() {
      for (const text of chunks) {
        if (signal?.aborted) throw makeAbortError();
        yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
      }
      if (opts.hangAfterChunks) {
        // Silent thrash: emit no more deltas; resolve only when aborted (the
        // real fetch rejects the iteration when the signal fires).
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) return reject(makeAbortError());
          signal?.addEventListener("abort", () => reject(makeAbortError()), { once: true });
        });
      }
    }
    const iterator = gen();
    return {
      [Symbol.asyncIterator]: () => iterator,
      finalMessage: async () => ({
        content: [{ type: "text", text: jsonText }],
        stop_reason: opts.stop_reason ?? "end_turn",
        usage: {
          input_tokens: 100,
          output_tokens: 200,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          ...(opts.usage ?? {}),
        },
      }),
      abort: () => {},
    };
  };
}

// DETECTOR-FIX (2026-07-24): a fake stream that emits deltas at SCHEDULED fake
// times, so a test can model a draft that is actively-but-slowly emitting (the
// progress-aware detector must NOT abort it) or a slow-sparse no-edges runaway
// (the hard ceiling must). Each step's `atMs` is absolute from stream start; the
// generator awaits real setTimeouts that `vi.advanceTimersByTimeAsync` drives.
// Space steps < DRAFT_RUNAWAY_STALL_MS apart to model continuous progress.
function makeTimedStream(
  steps: Array<{ text: string; atMs: number }>,
  finalJson: string,
  finalOpts: FakeStreamOpts = {},
) {
  return (_body: unknown, options?: { signal?: AbortSignal; headers?: Record<string, string> }) => {
    const signal = options?.signal;
    async function* gen() {
      let prev = 0;
      for (const step of steps) {
        const wait = step.atMs - prev;
        prev = step.atMs;
        if (wait > 0) {
          await new Promise<void>((resolve, reject) => {
            if (signal?.aborted) return reject(makeAbortError());
            const t = setTimeout(resolve, wait);
            signal?.addEventListener("abort", () => { clearTimeout(t); reject(makeAbortError()); }, { once: true });
          });
        }
        if (signal?.aborted) throw makeAbortError();
        yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: step.text } };
      }
    }
    const iterator = gen();
    return {
      [Symbol.asyncIterator]: () => iterator,
      finalMessage: async () => ({
        content: [{ type: "text", text: finalJson }],
        stop_reason: finalOpts.stop_reason ?? "end_turn",
        usage: {
          input_tokens: 100,
          output_tokens: 200,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          ...(finalOpts.usage ?? {}),
        },
      }),
      abort: () => {},
    };
  };
}

// Minimal valid graph JSON that passes normaliseDraftResponse + schema validation.
//
// ⚠ THE OPENAI DRAFT PATH ONLY. The Anthropic draft path was cut over to
// draft-by-records (see VALID_RECORDS_JSON below) and now REFUSES a graph-shaped
// response; the OpenAI adapter still asks the model for a graph directly, so its
// regression block at the bottom of this file keeps this fixture.
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

/**
 * ⚠ A RECORD SET, NOT A GRAPH — what the ANTHROPIC draft path now returns.
 *
 * The model is asked for `{stated_items, claims}` and a deterministic projector
 * builds GraphV3 at the post-LLM seam; a graph-shaped response is refused there
 * by design (`draft_records_graph_shaped_response`), so the previous fixture made
 * every Anthropic test in this file fail inside the adapter before reaching its
 * own assertions. These records project to a comparable little graph — the
 * projector mints the decision node and the decision→option edges:
 *
 *   nodes: decision "Decision" · goal "grow revenue without over-hiring" ·
 *          option "hire a contractor" · option "hire a full-time employee" ·
 *          factor "delivery capacity"                              (5)
 *   edges: option→factor · factor→goal · decision→option ×2        (4)
 *
 * The factor is deliberately linked all the way to the goal: the projector
 * WITHDRAWS any factor that cannot reach a goal along emitted causal links
 * (projector.ts pass 3b), so an unlinked factor would simply not appear.
 */
const VALID_RECORDS_JSON = JSON.stringify({
  stated_items: [
    { kind: "goal", source_quote: "grow revenue without over-hiring" },
    { kind: "option", source_quote: "hire a contractor" },
    { kind: "option", source_quote: "hire a full-time employee" },
  ],
  claims: [
    { claim_kind: "factor", label: "delivery capacity", basis: [0] },
    {
      claim_kind: "causal_link",
      label: "a contractor adds capacity sooner",
      basis: [0],
      from_stated: 1,
      to_claim: 0,
      effect: "positive",
    },
    {
      claim_kind: "causal_link",
      label: "a full-time hire adds capacity too",
      basis: [0],
      from_stated: 2,
      to_claim: 0,
      effect: "positive",
    },
    {
      claim_kind: "causal_link",
      label: "capacity drives revenue",
      basis: [0],
      from_claim: 0,
      to_stated: 0,
      effect: "positive",
    },
  ],
});

// Hoisted so the mock factories can reference them before beforeEach runs.
// createSpy → messages.create (chatWithAnthropic path); streamSpy →
// messages.stream (Lane C draft path).
const createSpy = vi.hoisted(() => vi.fn());
const streamSpy = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: createSpy, stream: streamSpy };
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
    streamSpy.mockImplementation(makeFakeStream(VALID_RECORDS_JSON));
  });

  afterEach(() => {
    streamSpy.mockReset();
    // ⚠ `createSpy` TOO, and it did not need resetting until v4. The draft path
    // STREAMS, so it never touched `messages.create` — until the two-pass
    // completion turn, which is a non-streaming call. Without this, completion
    // calls accumulate across this describe and leak into the `chatWithAnthropic`
    // block below, whose `toHaveBeenCalledOnce()` then measures another
    // describe's traffic instead of its own. Caught by that assertion going to
    // "called 2 times" — a cross-describe contamination, not a chat defect.
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

    expect(streamSpy).toHaveBeenCalledOnce();
    const [body, opts] = streamSpy.mock.calls[0];

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

    expect(streamSpy).toHaveBeenCalledOnce();
    const [body, opts] = streamSpy.mock.calls[0];

    // GA parameter: output_config.format (NOT deprecated output_format)
    expect(body).toHaveProperty("output_config");
    expect(body).not.toHaveProperty("output_format");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format).toHaveProperty("schema");
    expect(body.output_config.format).not.toHaveProperty("json_schema");
    // RE-POINTED, not relaxed: the draft grammar in this slot is now the RECORDS
    // grammar. Still bound to the DRAFT grammar's own required keys, so some
    // other schema arriving here fails exactly as before.
    expect(body.output_config.format.schema.required).toContain("stated_items");
    expect(body.output_config.format.schema.required).toContain("claims");

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

    expect(streamSpy).toHaveBeenCalledOnce();
    const [body, opts] = streamSpy.mock.calls[0];

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

    const [, opts] = streamSpy.mock.calls[0];
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

    const [body] = streamSpy.mock.calls[0];
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

    const [body] = streamSpy.mock.calls[0];
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

    const [body] = streamSpy.mock.calls[0];
    // (45s - 15s overhead) * 90 tok/s = 2700 tokens affordable in this window.
    expect(body.max_tokens).toBe(2700);
  });

  it("a runaway generation truncated at max_tokens fails FAST with a truncation-typed error, not a generic non-JSON error", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    // Simulate the API cutting the generation at the token cap: stop_reason
    // "max_tokens" with JSON chopped mid-object.
    //
    // ⚠ CUT POINT MOVED 200 → 60 WITH THE RECORDS CUTOVER, and it is load-bearing.
    // 60 chars lands inside the FIRST stated item's `source_quote`, before any
    // element completes, so `closeTruncatedJson` returns null and salvage cannot
    // fire — which is the state this test is about: truncated, unsalvageable, and
    // therefore fast-failed with the truncation-typed error. (At 200 chars a
    // record set salvages into a complete `stated_items` with NO `claims`, which
    // the projection seam refuses with its own typed error — a different path,
    // and not the one this test names.)
    streamSpy.mockImplementation(makeFakeStream(VALID_RECORDS_JSON.slice(0, 60), {
      stop_reason: "max_tokens",
      usage: { output_tokens: 6000 },
    }));

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
    streamSpy.mockImplementation(makeFakeStream(VALID_RECORDS_JSON, {
      stop_reason: "max_tokens",
      usage: { output_tokens: 6000 },
    }));

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

    // Both record arrays are complete; the cut lands in a trailing `coaching`
    // field. The unparseable tail (`JSON.parse` fails) enters the salvage path,
    // which closes the JSON around the complete RECORD SET → projects → the
    // projected graph is schema-valid → ACCEPTED. (Pre-cutover the same fixture
    // closed around a complete `nodes`+`edges` graph; the mechanism is unchanged,
    // only the shape the model emits.)
    const salvageable =
      VALID_RECORDS_JSON.slice(0, -1) + // drop the root's closing brace
      ',"coaching":"You should weigh the trade-off between speed and co'; // truncated field
    streamSpy.mockImplementation(makeFakeStream(salvageable, {
      stop_reason: "max_tokens",
      usage: { output_tokens: 8550 },
    }));

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

    // ⚠ THE GATE THAT REFUSES THIS MOVED WITH THE RECORDS CUTOVER — recorded
    // rather than left reading as though nothing changed. The fixture is a
    // graph-shaped truncation, which is exactly what the retired draft path
    // emitted; `closeTruncatedJson` still recovers a syntactically-valid
    // `{nodes:[{"id":"a",…}]}` from it (derived, not assumed), but the salvage
    // predicate is now `isSalvageableRecordSet` and reads FALSE on it, so salvage
    // never fires and the typed truncation error is thrown directly. Pre-cutover
    // salvage DID fire here and the draft schema (edges required) did the
    // refusing. Either way the invariant this test exists for is the same and
    // still holds: the salvage must never ship an invalid graph.
    //
    // NOT covered by this fixture any more: the case where salvage OFFERS an
    // incomplete RECORD SET (a cut leaving `stated_items` complete and `claims`
    // absent). That is refused by the projection seam with its own typed error —
    // see the lane report; it wants its own test rather than a silent widening of
    // this one.
    streamSpy.mockImplementation(makeFakeStream(
      '{"nodes":[{"id":"a","kind":"decision","label":"Pick"},{"id":"b","kind":"opt',
      { stop_reason: "max_tokens", usage: { output_tokens: 8550 } },
    ));

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

    // First stream is rejected with a 400 mentioning output_config; second succeeds
    streamSpy
      .mockImplementationOnce(() => {
        throw Object.assign(new Error("Invalid parameter: output_config not supported"), { status: 400 });
      })
      .mockImplementationOnce(makeFakeStream(VALID_RECORDS_JSON));

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    });

    // Should have been called twice: once with structured outputs, once without
    expect(streamSpy).toHaveBeenCalledTimes(2);

    // Second call (fallback) should have no output_config
    const [fallbackBody] = streamSpy.mock.calls[1];
    expect(fallbackBody).not.toHaveProperty("output_config");
    expect(fallbackBody).not.toHaveProperty("output_format");

    // The call should ultimately succeed and return a valid graph
    expect(result.graph.nodes.length).toBeGreaterThan(0);
  });

  it("falls back when API returns 'Unexpected key output_config' (capability rejection)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    streamSpy
      .mockImplementationOnce(() => {
        throw Object.assign(new Error("Unexpected key 'output_config' in request body"), { status: 400 });
      })
      .mockImplementationOnce(makeFakeStream(VALID_RECORDS_JSON));

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    });

    // Should fall back — two calls total
    expect(streamSpy).toHaveBeenCalledTimes(2);
    expect(result.graph.nodes.length).toBeGreaterThan(0);
  });

  it("emits cee.draft_graph.structured_outputs_fell_back telemetry on 'compiled grammar is too large' fallback (Lane 3 — non-silent degradation)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    // The live staging failure: grammar-compilation capacity 400.
    streamSpy
      .mockImplementationOnce(() => {
        throw Object.assign(
          new Error(
            "The compiled grammar is too large. Simplify your tool schemas or reduce the number of strict tools."
          ),
          { status: 400 }
        );
      })
      .mockImplementationOnce(makeFakeStream(VALID_RECORDS_JSON));

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
      expect(streamSpy).toHaveBeenCalledTimes(2);
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

    streamSpy.mockImplementationOnce(makeFakeStream(VALID_RECORDS_JSON));

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

      expect(streamSpy).toHaveBeenCalledTimes(1);
      expect(
        events.some(
          (e) => e.name === telemetry.TelemetryEvents.CeeStructuredOutputsFellBack
        )
      ).toBe(false);
    } finally {
      telemetry.setTestSink(null);
    }
  });

  // ---------------------------------------------------------------------------
  // Prompt-cache observability (2026-07-24). The draft system prefix is already
  // sent as an ephemeral cache block (buildSystemBlocks) and the streamed
  // finalMessage already CARRIES usage.cache_read/creation — but the "draft
  // complete" log never surfaced it, so warm-cache hits were unmeasurable from
  // Render logs. These pin that the tokens are now logged, and that adding the
  // log did NOT change the cached request bytes.
  // ---------------------------------------------------------------------------
  it("logs Anthropic prompt-cache tokens on the 'draft complete' line for a warm-cache read, without altering the cached request", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");
    // Pin the ephemeral system cache block on (repo default, and set true on
    // cee-staging) so the byte-invariance assertion below is deterministic.
    vi.stubEnv("ANTHROPIC_PROMPT_CACHE_ENABLED", "true");

    // Warm read: the streamed finalMessage reports a cache READ (>0) and no
    // fresh creation — a cache HIT.
    streamSpy.mockImplementation(
      makeFakeStream(VALID_RECORDS_JSON, {
        usage: { cache_read_input_tokens: 2560, cache_creation_input_tokens: 0 },
      })
    );

    // Same reset module graph as the adapter import below, so the spy lands on
    // the exact `log` instance the adapter calls.
    const { log } = await import("../../src/utils/telemetry.js");
    const infoSpy = vi.spyOn(log, "info");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    });

    const draftCompleteCall = infoSpy.mock.calls.find((c) => c[1] === "draft complete");
    expect(draftCompleteCall).toBeDefined();
    const payload = draftCompleteCall![0] as Record<string, unknown>;
    expect(payload.cache_read_input_tokens).toBe(2560);
    expect(payload.cache_creation_input_tokens).toBe(0);
    expect(payload.cache_hit).toBe(true);
    expect(payload.input_tokens).toBe(100);
    expect(payload.output_tokens).toBe(200);

    // Byte-invariance: the observability change is a pure read of usage — the
    // request still sends the ephemeral system cache block unchanged.
    const [body] = streamSpy.mock.calls[0] as [{ system: Array<{ cache_control?: unknown }> }];
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("reports a cold cache write (creation>0, read=0) on 'draft complete' as cache_hit:false", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    streamSpy.mockImplementation(
      makeFakeStream(VALID_RECORDS_JSON, {
        usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 2560 },
      })
    );

    const { log } = await import("../../src/utils/telemetry.js");
    const infoSpy = vi.spyOn(log, "info");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    });

    const draftCompleteCall = infoSpy.mock.calls.find((c) => c[1] === "draft complete");
    expect(draftCompleteCall).toBeDefined();
    const payload = draftCompleteCall![0] as Record<string, unknown>;
    expect(payload.cache_creation_input_tokens).toBe(2560);
    expect(payload.cache_read_input_tokens).toBe(0);
    expect(payload.cache_hit).toBe(false);
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

    const [body] = streamSpy.mock.calls[0];

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
    streamSpy.mockImplementation(() => {
      throw Object.assign(
        new Error("output_config.format: Unexpected key 'json_schema'. The expected format is {\"type\": \"json_schema\", \"schema\": {...}}."),
        { status: 400 }
      );
    });

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
    expect(streamSpy).toHaveBeenCalledOnce();
  });

  it("uses safeExtractJson (not JSON.parse) when fallback response contains markdown fences", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");

    // The fallback (prompt-only) response wraps JSON in markdown fences — real-world Anthropic behaviour
    const fencedResponse = `Here is the decision graph:\n\n\`\`\`json\n${VALID_RECORDS_JSON}\n\`\`\``;

    streamSpy
      .mockImplementationOnce(() => {
        throw Object.assign(new Error("Invalid parameter: output_config not supported"), { status: 400 });
      })
      .mockImplementationOnce(makeFakeStream(fencedResponse));

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

    expect(streamSpy).toHaveBeenCalledOnce();
    const [body] = streamSpy.mock.calls[0];

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

    const [body] = streamSpy.mock.calls[0];
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

    const [body] = streamSpy.mock.calls[0];
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

    const [body] = streamSpy.mock.calls[0];
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

    const [body] = streamSpy.mock.calls[0];
    const affordable = getAffordableDraftTokens(32_000);
    // Thinking is dropped rather than shipped unaffordable — F-5 (FINAL-SWEEP): the
    // draft now sends an EXPLICIT disabled posture rather than omitting the field.
    expect(body.thinking).toEqual({ type: "disabled" });
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

    expect(streamSpy).toHaveBeenCalledOnce();
    const [body] = streamSpy.mock.calls[0];

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

    const [body] = streamSpy.mock.calls[0];
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

    const [body] = streamSpy.mock.calls[0];
    expect(body.thinking.type).toBe("enabled");
    // Extended thinking active + non-rejecting model → Anthropic's temperature=1 rule.
    expect(body.temperature).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // LANE C (2026-07-23) — EARLY RUNAWAY DETECTION + CHEAP ABORT-RETRY.
  // The residual draft-failure class (WAVE1 anatomy) cuts INSIDE the nodes array
  // with 0 edges at ~8550 tokens / ~85s. Streaming lets us detect "still in
  // nodes past a derived deadline", abort the doomed attempt, and retry within
  // the remaining budget. Positive controls below; reverting the detector in the
  // adapter turns the two runaway→retry tests RED (the mutation-check).
  // ---------------------------------------------------------------------------

  // A >8000-char partial that is all nodes and NO edges (no `"from":`) — the
  // char-gate signature of a text-heavy runaway.
  const RUNAWAY_NODES_BLOB =
    '{"nodes":[{"id":"n1","kind":"factor","label":"' + "x".repeat(8600) + '"}';

  // ⚠ ARMED REGIME (skip-gate alignment, 2026-07-25). The abort is now authorised
  // only when the post-abort window can RE-FUND the cap being abandoned
  // (`isAbortableRetryViable`) — aborting into a window that cannot is how 60s of
  // a 110s budget got burned on a doomed 3,150-token final attempt (`/assist`
  // A2killer 0/18, 2026-07-24). At the FULL attempt-1 cap (8,550 at the 110s
  // timeout) NO abort is ever re-fundable, so the ladder is correctly silent
  // there — see the DEFAULT-REGIME test in draft-detector-attachment-aware.test.ts.
  // The detector tests below therefore pass an explicit `maxTokensCeiling` to put
  // the adapter in the regime where the ladder IS armed. What they assert — that
  // the char / stall / hard-ceiling gates fire and retry — is unchanged.
  const ARMED_LADDER_OPTS = { maxTokensCeiling: 5_000 } as const;

  it("CHAR-GATE: a runaway (no edges past the char budget) is aborted and RETRIED, and the retry succeeds", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    // Attempt 1 streams a bloated nodes-only blob with no edges → the char-gate
    // fires, the attempt is aborted. Attempt 2 returns a clean valid graph.
    streamSpy
      .mockImplementationOnce(makeFakeStream(RUNAWAY_NODES_BLOB, { stop_reason: "max_tokens", usage: { output_tokens: 8550 } }))
      .mockImplementationOnce(makeFakeStream(VALID_RECORDS_JSON));

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    }, ARMED_LADDER_OPTS);

    // The doomed attempt was aborted and a fresh generation retried → success.
    expect(streamSpy).toHaveBeenCalledTimes(2);
    expect(result.graph.nodes.length).toBeGreaterThan(0);
    expect(result.graph.edges.length).toBeGreaterThan(0);
    // Observable on the meta: exactly one runaway was aborted before success.
    expect((result.meta as { runaway_abort_count?: number }).runaway_abort_count).toBe(1);
    expect((result.meta as { streamed?: boolean }).streamed).toBe(true);
  });

  it("CHAR-GATE: the retry uses a FRESH idempotency key (the provider must re-generate, not replay the doomed one)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    streamSpy
      .mockImplementationOnce(makeFakeStream(RUNAWAY_NODES_BLOB, { stop_reason: "max_tokens", usage: { output_tokens: 8550 } }))
      .mockImplementationOnce(makeFakeStream(VALID_RECORDS_JSON));

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    }, ARMED_LADDER_OPTS);

    const key1 = streamSpy.mock.calls[0][1]?.headers?.["Idempotency-Key"];
    const key2 = streamSpy.mock.calls[1][1]?.headers?.["Idempotency-Key"];
    expect(typeof key1).toBe("string");
    expect(typeof key2).toBe("string");
    // A reused key would make Anthropic replay the SAME (doomed) generation —
    // the retry would be pointless. They MUST differ.
    expect(key1).not.toBe(key2);
  });

  it("STALL-GATE: a silent-thrash runaway (no edges, stops emitting deltas) is aborted by the progress-aware stall gate and RETRIED", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

      // Attempt 1 emits a small nodes-only chunk (no edges), then goes silent —
      // burning wall-clock without forward progress. The progress-aware stall gate
      // (DRAFT_RUNAWAY_DETECT_MS + no delta for DRAFT_RUNAWAY_STALL_MS) catches
      // this; an in-loop delta check alone could not. Attempt 2 succeeds.
      streamSpy
        .mockImplementationOnce(makeFakeStream('{"nodes":[{"id":"n1","kind":"factor","label":"a"}', {
          chunks: ['{"nodes":[{"id":"n1","kind":"factor","label":"a"}'],
          hangAfterChunks: true,
          stop_reason: "max_tokens",
        }))
        .mockImplementationOnce(makeFakeStream(VALID_RECORDS_JSON));

      const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
      const promise = draftGraphWithAnthropic({
        brief: "Should I hire a contractor or full-time employee?",
        docs: [],
        seed: 17,
        model: "claude-sonnet-4-6",
      }, ARMED_LADDER_OPTS);

      // Advance past the stall/ceiling window (>30s) so the progress-aware gate
      // fires on the silent (stalled) attempt, aborts it, and the retry runs (its
      // stream resolves synchronously). The stall gate trips first at ~20s (no
      // delta for ≥8s); the 30s hard ceiling is the backstop.
      await vi.advanceTimersByTimeAsync(31_000);
      const result = await promise;

      expect(streamSpy).toHaveBeenCalledTimes(2);
      expect(result.graph.nodes.length).toBeGreaterThan(0);
      expect((result.meta as { runaway_abort_count?: number }).runaway_abort_count).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("NO FALSE ABORT: a large healthy draft whose nodes section is BELOW the char budget and reaches edges is NOT aborted", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    // Stream a ~7500-char nodes-only chunk (ABOVE the observed healthy max of
    // 6896, but BELOW the 8000 char budget), THEN a chunk that opens the edges
    // array (`"from":`). The detector must NOT fire: healthy drafts are not
    // clipped. finalMessage returns a clean valid graph.
    //
    // ⚠ FIXTURE REBUILT 2026-07-25, and the old one CONTRADICTED THIS TEST'S OWN
    // NAME. It produced its 7,500 chars as a SINGLE 7,400-character node label —
    // which is not "a large healthy draft" at all, it is verbatim the runaway
    // shape (one string value consuming the budget; the live healthy maximum for
    // any single string is 76 chars over a 20-draft corpus). The per-string-value
    // ceiling correctly classified it as a runaway, which is how the
    // contradiction surfaced.
    // Rebuilt to generate the same TOTAL volume the way a genuinely verbose
    // healthy draft does — MANY nodes, each with realistic short strings. That
    // preserves exactly the property this test exists to protect ("total nodes
    // volume below the char budget must not abort") and stops the fixture
    // asserting something it never demonstrated.
    const realisticNodes: string[] = [];
    for (let i = 0; realisticNodes.join(',').length < 7_400; i++) {
      realisticNodes.push(
        `{"id":"fac_${i}","kind":"factor","label":"Support capacity driver ${i}",` +
        `"data":{"value":0.5,"extractionType":"inferred","factor_type":"cost",` +
        `"uncertainty_drivers":["Historical volume is a weak predictor of peak load"]}}`,
      );
    }
    const bigNodesChunk = '{"nodes":[' + realisticNodes.join(',');
    const edgesChunk = '],"edges":[{"from":"n1","to":"n2"}]}';
    streamSpy.mockImplementationOnce(makeFakeStream(VALID_RECORDS_JSON, {
      chunks: [bigNodesChunk, edgesChunk],
    }));

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    const result = await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    });

    // Exactly ONE call — no abort, no retry — and zero runaway aborts on the meta.
    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(result.graph.nodes.length).toBeGreaterThan(0);
    expect((result.meta as { runaway_abort_count?: number }).runaway_abort_count).toBe(0);
    // The time-to-edges was measured (the empirical signal that validates the
    // detection deadline live).
    expect(typeof (result.meta as { time_to_edges_ms?: number }).time_to_edges_ms).toBe("number");
  });

  // ---------------------------------------------------------------------------
  // DETECTOR-FIX (2026-07-24, F4 live adjudication) — PROGRESS-AWARE detection.
  // Both-direction proof: today's healthy-but-slow profile must NOT abort; the
  // runaway sub-types must still abort.
  // ---------------------------------------------------------------------------

  it("NO FALSE ABORT (slow-healthy tail): a draft actively emitting PAST 20s that reaches edges at ~22s is NOT aborted (the F4 fix)", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

      // Continuous nodes deltas every 4s (< DRAFT_RUNAWAY_STALL_MS 8s ⇒ never
      // "stalled"), total < 8000 chars, reaching the edges array at 22s — PAST the
      // old 20s blanket gate that clipped exactly this slow-healthy tail (live p100
      // 19.57s, p90 19.3s). Progress-aware ⇒ left to complete.
      const steps = [
        { text: '{"nodes":[{"id":"n1","label":"' + "y".repeat(400) + '"}', atMs: 4_000 },
        { text: ',{"id":"n2","label":"' + "y".repeat(400) + '"}', atMs: 8_000 },
        { text: ',{"id":"n3","label":"' + "y".repeat(400) + '"}', atMs: 12_000 },
        { text: ',{"id":"n4","label":"' + "y".repeat(400) + '"}', atMs: 16_000 },
        { text: ',{"id":"n5","label":"' + "y".repeat(400) + '"}', atMs: 20_000 },
        { text: '],"edges":[{"from":"n1","to":"n2"}]}', atMs: 22_000 },
      ];
      streamSpy.mockImplementationOnce(makeTimedStream(steps, VALID_RECORDS_JSON));

      const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
      const promise = draftGraphWithAnthropic({
        brief: "Should I hire a contractor or full-time employee?",
        docs: [], seed: 17, model: "claude-sonnet-4-6",
      });
      await vi.advanceTimersByTimeAsync(25_000);
      const result = await promise;

      // MUTATION-CHECK: with the OLD 20s blanket time gate this draft aborts at 20s
      // (runaway_abort_count ≥ 1, streamSpy ≥ 2). Progress-aware ⇒ exactly 1 call, 0 aborts.
      expect(streamSpy).toHaveBeenCalledTimes(1);
      expect((result.meta as { runaway_abort_count?: number }).runaway_abort_count).toBe(0);
      expect(result.graph.nodes.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("HARD-CEILING: an actively-emitting no-edges runaway (never stalls, under the char budget) is aborted at the 30s ceiling and RETRIED", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");
      const { log } = await import("../../src/utils/telemetry.js");
      const warnSpy = vi.spyOn(log, "warn");

      // A small nodes delta every 4s (never "stalled") with NO edges and well under
      // the 8000-char gate — the slow-sparse runaway the stall + char gates cannot
      // catch. Only the absolute hard ceiling (30s) bounds it. Attempt 2 succeeds.
      const steps = Array.from({ length: 12 }, (_v, i) => ({
        text: (i === 0 ? '{"nodes":[' : ",") + '{"id":"n' + i + '","label":"z"}',
        atMs: 4_000 * (i + 1), // 4,8,…,48s
      }));
      streamSpy
        .mockImplementationOnce(makeTimedStream(steps, "{}", { stop_reason: "max_tokens" }))
        .mockImplementationOnce(makeFakeStream(VALID_RECORDS_JSON));

      const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
      const promise = draftGraphWithAnthropic({
        brief: "Should I hire a contractor or full-time employee?",
        docs: [], seed: 17, model: "claude-sonnet-4-6",
      }, ARMED_LADDER_OPTS);
      await vi.advanceTimersByTimeAsync(35_000);
      const result = await promise;

      expect(streamSpy).toHaveBeenCalledTimes(2);
      expect((result.meta as { runaway_abort_count?: number }).runaway_abort_count).toBe(1);
      // The abort came from the hard CEILING (trigger "time"), NOT stall or chars.
      const abortLog = warnSpy.mock.calls.find(
        (c) => (c[0] as { event?: string })?.event === "cee.llm.draft_runaway_aborted",
      );
      expect(abortLog).toBeDefined();
      expect((abortLog![0] as { trigger?: string }).trigger).toBe("time");
    } finally {
      vi.useRealTimers();
    }
  });

  it("DRIFT TRIPWIRE: a healthy draft reaching edges in the slow tail emits the drift WARN (the alarm missing 2026-07-24)", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");
      const { log } = await import("../../src/utils/telemetry.js");
      const warnSpy = vi.spyOn(log, "warn");

      // ⚠ RE-DERIVED 2026-07-25 (FAST-ABORT). The tripwire was 0.6 x ceiling
      // (18s at a 30s ceiling); at the new 25s ceiling that formula would give
      // 15s — BELOW the healthy p50 — and WARN on most healthy drafts. It is now
      // anchored to the observed healthy p100 (21,258 ms). This draft reaches
      // edges at 22s: past the tripwire, still under the 25s ceiling, so it must
      // COMPLETE and WARN. The last delta before the 20s stall check is at 16s
      // (gap 4s < the 8s stall threshold), so the stall gate must not fire.
      const steps = [
        { text: '{"nodes":[{"id":"n1","label":"y"}', atMs: 4_000 },
        { text: ',{"id":"n2","label":"y"}', atMs: 8_000 },
        { text: ',{"id":"n3","label":"y"}', atMs: 12_000 },
        { text: ',{"id":"n4","label":"y"}', atMs: 16_000 },
        { text: '],"edges":[{"from":"n1","to":"n2"}]}', atMs: 22_000 },
      ];
      streamSpy.mockImplementationOnce(makeTimedStream(steps, VALID_RECORDS_JSON));

      const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
      const promise = draftGraphWithAnthropic({
        brief: "Should I hire a contractor or full-time employee?",
        docs: [], seed: 17, model: "claude-sonnet-4-6",
      });
      await vi.advanceTimersByTimeAsync(24_000);
      const result = await promise;

      expect((result.meta as { runaway_abort_count?: number }).runaway_abort_count).toBe(0);
      const driftLog = warnSpy.mock.calls.find(
        (c) => (c[0] as { event?: string })?.event === "cee.llm.draft_edges_time_drift",
      );
      expect(driftLog).toBeDefined();
      expect((driftLog![0] as { time_to_edges_ms?: number }).time_to_edges_ms).toBeGreaterThanOrEqual(21_258);
    } finally {
      vi.useRealTimers();
    }
  });

  it("⭐ A SLOW-BUT-HEALTHY draft at 21.26s — the corpus p100 — is NOT aborted by the 25s ceiling", async () => {
    // The false-abort guard, as a first-class test. The detector was reverted
    // once (2026-07-24) for clipping exactly this population, so lowering the
    // ceiling 30s -> 25s must be pinned against the slowest healthy draft ever
    // measured (21,258 ms). It must COMPLETE, with zero aborts.
    vi.useFakeTimers();
    try {
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");
      const steps = [
        { text: '{"nodes":[{"id":"n1","label":"y"}', atMs: 5_000 },
        { text: ',{"id":"n2","label":"y"}', atMs: 11_000 },
        { text: ',{"id":"n3","label":"y"}', atMs: 17_000 },
        { text: '],"edges":[{"from":"n1","to":"n2"}]}', atMs: 21_258 },
      ];
      streamSpy.mockImplementationOnce(makeTimedStream(steps, VALID_RECORDS_JSON));

      const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
      const promise = draftGraphWithAnthropic({
        brief: "Should I hire a contractor or full-time employee?",
        docs: [], seed: 17, model: "claude-sonnet-4-6",
      });
      await vi.advanceTimersByTimeAsync(24_000);
      const result = await promise;

      expect((result.meta as { runaway_abort_count?: number }).runaway_abort_count).toBe(0);
      expect(streamSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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

  it("R1 (D-61): a chat call with NO explicit thinking arg sends thinking:{type:'disabled'} — Sonnet-5 adaptive thinking is off by default (the decision_review call class)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");

    const { chatWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    // No `thinking` arg — exactly how the decision_review chat call (and other
    // budget-sensitive chat callers) invoke the adapter. The request MUST carry an
    // explicit disabled posture, not omit the field (which lets adaptive thinking
    // run and eat the budget — D-61). MUTATION-CHECK: reverting the `: {}` fallback
    // leaves thinking undefined and turns this RED.
    await chatWithAnthropic({
      system: "You are a test assistant.",
      userMessage: "Test message",
      model: "claude-sonnet-4-6",
    });

    expect(createSpy).toHaveBeenCalledOnce();
    const [body] = createSpy.mock.calls[0];
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("DOES send output_config for claude-sonnet-5 under the env flag (ROADMAP 2.973 — supersedes the shared-allowlist pin)", async () => {
    // ⚠ INTENT REVERSED DELIBERATELY, 2026-08-08. This test previously pinned the
    // OPPOSITE ("does NOT send output_config for claude-sonnet-5"). It was not
    // wrong when written: sonnet-5 was excluded from the ONE shared set that also
    // keyed buildStrictAnthropicTools (strict tool calling, NO env gate), so the
    // only way to hold strict tools steady was to forgo structured outputs too.
    //
    // #871 then made sonnet-5 the draft/edit/orchestrator default, and that pin
    // became a live capability regression: every draft AND every edit_graph chat
    // call fell back to prompt-only JSON under CEE_ANTHROPIC_STRUCTURED_OUTPUTS=true
    // (which staging sets — Render API, 2026-08-08).
    //
    // 2.973 splits the two concepts apart (see anthropic-model-capabilities.ts), so
    // sonnet-5 can have structured outputs WITHOUT gaining strict tool calling. The
    // live-safety intent this test was written to protect is therefore NOT dropped —
    // it moves to the assertion below and to strict-tool-calling-unchanged.test.ts.
    //
    // Evidence (real api.anthropic.com calls, 2026-08-08, controls included):
    //   - sonnet-5 + output_config.format          → HTTP 200
    //   - sonnet-5 + the REAL 995-byte edit_graph schema → HTTP 200, valid ops
    //   - sonnet-5 + the REAL 2689-byte draft grammar    → HTTP 200, 3/3 conformant
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
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema).toEqual(testSchema);
    // The live-safety half that still holds: structured outputs must NOT drag
    // strict tool calling along with it. A bare chat call carries no tools at all.
    expect(body).not.toHaveProperty("tools");
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

// =============================================================================
// F1/F2 (2026-07-24) — per-attempt max_tokens re-derivation from the LIVE clock
//
// The runaway abort-retry loop must derive the FINAL attempt's max_tokens from
// the budget that ACTUALLY remains (F1), and re-derive the abort authorization
// per withRetry invocation (F2) — so a late final attempt truncates AT max_tokens
// INSIDE the wall (salvage/lean-retry reachable) instead of hanging to the
// overall timeout. These tests drive a controlled clock so real wall-time need
// not pass.
// =============================================================================

describe("draftGraphWithAnthropic — F1/F2 live-budget max_tokens re-derivation", () => {
  let mockNow = 0;
  let nowSpy: ReturnType<typeof vi.spyOn> | undefined;

  // >8000 chars, NO `"from":` — trips the char-gate runaway detector before edges.
  const RUNAWAY_NODES_CHUNK =
    '{"nodes":[{"id":"n1","kind":"factor","label":"' + "x".repeat(8_200) + '"}';

  function runawayStream(_body: unknown, options?: { signal?: AbortSignal }) {
    const signal = options?.signal;
    async function* gen() {
      if (signal?.aborted) throw new Error("aborted");
      yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: RUNAWAY_NODES_CHUNK } };
    }
    const it = gen();
    return { [Symbol.asyncIterator]: () => it, finalMessage: async () => ({ content: [], stop_reason: "end_turn", usage: {} }), abort: () => {} };
  }

  function throwingStream(status: number) {
    return (_body: unknown, _options?: unknown) => {
      async function* gen(): AsyncGenerator<never> {
        const e = new Error("Service temporarily unavailable") as Error & { status: number };
        e.status = status;
        throw e;
        // eslint-disable-next-line no-unreachable
        yield undefined as never;
      }
      const it = gen();
      return { [Symbol.asyncIterator]: () => it, finalMessage: async () => ({ content: [], stop_reason: "end_turn", usage: {} }), abort: () => {} };
    };
  }

  beforeEach(() => {
    vi.resetModules();
    mockNow = 1_000_000;
    nowSpy = vi.spyOn(Date, "now").mockImplementation(() => mockNow);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");
  });

  afterEach(() => {
    nowSpy?.mockRestore();
    streamSpy.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("THE NEW INVARIANT: a post-abort final attempt is NEVER handed a cap below the one that was abandoned", async () => {
    // ⚠ THIS REPLACES THE ORIGINAL F1 RUNAWAY ASSERTION, WHICH IS NOW UNREACHABLE
    // BY CONSTRUCTION — recorded, not quietly rewritten.
    //
    // F1 used to assert: 2 runaway aborts burn 50s, then the FINAL attempt's cap
    // is SQUEEZED from 8,550 to aff(60s) = 4,050. That squeeze IS the live defect
    // (`/assist` A2killer 0/18, 2026-07-24: caps 3,146-3,826 against an 8,550-token
    // attempt) — a final attempt funded at ~37% of the budget that was abandoned
    // truncates by construction. The aligned gate makes the state unreachable:
    //   * a final attempt may run only when `finalCap >= abandonedCap`;
    //   * "squeeze observable" means `finalCap <  abandonedCap`;
    // so "squeezed" and "permitted to run" are now mutually exclusive.
    //
    // What is asserted instead is the invariant that replaced it, plus the thing
    // F1 actually cared about: the ladder still reaches a COMPLETING final attempt
    // (salvage/success stays reachable — this is not a 504 regression).
    //
    // The F1 SQUEEZE MECHANISM ITSELF IS STILL COVERED, on the path where it
    // remains reachable: the F2 test immediately below drives it through a
    // withRetry transient (503), which this change does not touch.
    //
    // ⚠ MUTATION-CHECK, HONESTLY SCOPED. This test is a pin for the INVARIANT,
    // not for the abort-authorisation call site: it was RUN against a reverted
    // `canRetryAgain` (bare `hasRoomForAnotherAbortableAttempt`) and stayed
    // GREEN, because at a 4,000 ceiling with 25s burns attempt 2 completes under
    // either rule. Saying otherwise would be exactly the theatre this estate
    // keeps paying for, so it is written down instead.
    //
    // The call site's real, verified mutation-check is the DEFAULT-REGIME test in
    // `src/adapters/llm/__tests__/draft-detector-attachment-aware.test.ts`
    // ("the same runaway is NOT aborted"), which goes RED on that revert; the
    // predicate itself is pinned by the sweep in draft-skip-gate-alignment.test.ts.
    let call = 0;
    streamSpy.mockImplementation((body: unknown, options?: { signal?: AbortSignal }) => {
      const n = call++;
      mockNow += 25_000; // this attempt consumed ~25s of wall-clock
      if (n < 1) return runawayStream(body, options);
      return makeFakeStream(VALID_RECORDS_JSON)(body, options as any); // final attempt completes
    });

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    const result = await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    // 4,000 < aff(110s - 30s) = 5,850, so an abort IS re-fundable → ladder armed.
    }, { maxTokensCeiling: 4_000 });

    // The draft SUCCEEDED via the completing final attempt (salvage path reachable).
    expect(result).toBeDefined();
    expect(Array.isArray((result as any).graph?.nodes ?? (result as any).nodes)).toBe(true);

    // POSITIVE CONTROL — the runaway really fired; without it the cap assertions
    // below would be comparing two ordinary first attempts.
    expect((result.meta as { runaway_abort_count?: number }).runaway_abort_count).toBe(1);
    expect(streamSpy).toHaveBeenCalledTimes(2);

    const abandonedCap = streamSpy.mock.calls[0][0].max_tokens;
    const finalCap = streamSpy.mock.calls[1][0].max_tokens;
    expect(abandonedCap).toBe(4_000);
    // ⭐ THE INVARIANT: the attempt that follows an abort is never starved below
    // the one it replaces. Pre-fix this was 4,050 against an 8,550 abandonment.
    expect(finalCap).toBeGreaterThanOrEqual(abandonedCap);
  });

  it("F2 — a transient retry that consumes budget re-derives the window per invocation (final attempt squeezed + capped)", async () => {
    // timeoutMs 70s: attempt-1 window (70s > HARD_CEILING+MIN_RETRY 65s) authorizes
    // detection. The first withRetry invocation throws a transient 503 and burns
    // 30s; the SECOND invocation must re-read the clock (remaining 40s < 65s →
    // FINAL, capped), NOT reuse the stale loop-top authorization. The transient is
    // a 503 (not a runaway abort), so the part-2 skip-gate (gated on
    // runawayAbortCount>=1) does not fire — the squeezed final still runs+caps.
    let call = 0;
    streamSpy.mockImplementation((body: unknown, options?: { signal?: AbortSignal }) => {
      const n = call++;
      if (n === 0) {
        mockNow += 30_000; // the transient attempt burned 30s before failing
        return throwingStream(503)(body, options);
      }
      return makeFakeStream(VALID_RECORDS_JSON)(body, options as any);
    });

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    const result = await draftGraphWithAnthropic(
      { brief: "Should I hire a contractor or full-time employee?", docs: [], seed: 17, model: "claude-sonnet-4-6" },
      { timeoutMs: 70_000 },
    );

    expect(result).toBeDefined();
    expect(streamSpy).toHaveBeenCalledTimes(2);
    // First invocation: remaining 70000 → affordable (70-15)*90 = 4950, detection on (not final).
    expect(streamSpy.mock.calls[0][0].max_tokens).toBe(4950);
    // Second invocation (post-transient): remaining 40000 → FINAL, capped to
    // affordable (40-15)*90 = 2250. Pre-fix it stayed 4950 with detection still on.
    expect(streamSpy.mock.calls[1][0].max_tokens).toBe(2250);
  });

  it("PART-2 SKIP-GATE: a post-abort FINAL attempt whose window can't fund a viable graph is SKIPPED (honest fast fail), not run", async () => {
    // DETECTOR-FIX part 2 (F4 rec-c) + FINAL-SWEEP F-4 reserve reconciliation,
    // RE-DERIVED for the 2026-07-25 fast-abort yardstick (ceiling 25s, floor
    // 3,581 = the evidence-derived converged-draft requirement).
    //
    //   budget 120s, ceiling 4,000, each abortable attempt burns 38s of clock:
    //   attempt 1: remaining 120s → post-abort 95s affords min(7200,4000)=4,000
    //              ≥ 3,581 ✓ → abort authorised, clock → 82s
    //   attempt 2: remaining  82s (> the 79.789s reserve, so NOT final) →
    //              post-abort 57s affords min(3780,4000)=3,780 ≥ 3,581 ✓ → abort,
    //              clock → 44s
    //   attempt 3: remaining  44s → FINAL, affords (44-15)*90 = 2,610 < 3,581
    //              → SKIPPED with the typed error, WITHOUT a 3rd call.
    streamSpy.mockImplementation((body: unknown, options?: { signal?: AbortSignal }) => {
      mockNow += 38_000; // each abortable attempt burns 38s of wall-clock
      return runawayStream(body, options); // char-gate runaway (no edges)
    });

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await expect(
      draftGraphWithAnthropic(
        {
          brief: "Should I hire a contractor or full-time employee?",
          docs: [], seed: 17, model: "claude-sonnet-4-6",
        },
        { timeoutMs: 120_000, maxTokensCeiling: 4_000 },
      ),
    ).rejects.toThrow(/final attempt unaffordable|converged-draft floor/);

    // MUTATION-CHECK: with the skip-gate reverted, the 3rd attempt RUNS as the
    // (token-starved) final → streamSpy would be 3 and the error message differs.
    expect(streamSpy).toHaveBeenCalledTimes(2);
  });

  it("⭐ THE LIVE 3,150: a final window that CLEARS the legacy 2,700 floor but cannot fund a CONVERGED draft is skipped", async () => {
    // ⭐ THE LIVE DEFECT, AS A TEST — and now pinned on the actual live number.
    // All 18 `/assist` A2killer failures on 2026-07-24 died on a final attempt
    // funded at 3,146-3,826 tokens; 15 of them at exactly aff(50s) = 3,150.
    // 3,150 comfortably CLEARS the bare 2,700 floor, which is why the pre-#675
    // gate waved it through — and it is still below the 3,581 tokens a converged
    // draft is measured to require, so it is still refused. The verdict on the
    // case that mattered is unchanged; only the reason is now true.
    //
    //   budget 90s, ceiling 5,000, each abortable attempt burns 40s:
    //   attempt 1: remaining 90s → post-abort 65s affords min(4500,5000)=4,500
    //              ≥ 3,581 ✓ → abort, clock → 50s
    //   attempt 2: remaining 50s → FINAL (50s < the 79.789s reserve), affords
    //              min(3150,5000) = 3,150 → 2,700 ≤ 3,150 < 3,581 → SKIPPED.
    //
    // MUTATION-CHECK: restore the bare
    // `finalAttemptAffordableTokens < LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR` and this
    // goes RED — 3,150 >= 2,700, so the doomed attempt runs and streamSpy hits 2.
    streamSpy.mockImplementation((body: unknown, options?: { signal?: AbortSignal }) => {
      mockNow += 40_000;
      return runawayStream(body, options);
    });

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    let err: unknown;
    try {
      await draftGraphWithAnthropic(
        { brief: "Should I hire a contractor or full-time employee?", docs: [], seed: 17, model: "claude-sonnet-4-6" },
        { timeoutMs: 90_000, maxTokensCeiling: 5_000 },
      );
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toMatch(/final attempt unaffordable/);
    // The honest numbers are ON the error: what the window affords, and the bar.
    expect(message).toContain("3150 tokens");
    expect(message).toContain("3581-token converged-draft floor");
    // …and it clears the legacy floor, which is the whole point of the case.
    expect(3_150).toBeGreaterThanOrEqual(2_700);
    // Exactly ONE generation ran — the doomed second was refused, not burned.
    expect(streamSpy).toHaveBeenCalledTimes(1);
  });
});
