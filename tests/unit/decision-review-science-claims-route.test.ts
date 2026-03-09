/**
 * Decision Review — Route-level test for SCIENCE_CLAIMS collision handling
 *
 * Exercises the POST /assist/v1/decision-review route handler end-to-end
 * with mocked dependencies:
 * - getSystemPrompt returns a prompt WITH <SCIENCE_CLAIMS> baked in
 * - DSK is enabled with claims loaded
 * - Verifies: endpoint returns 200 (not 500), and the system prompt
 *   passed to adapter.chat contains exactly one <SCIENCE_CLAIMS> section.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";

// ============================================================================
// Mock setup — must precede all SUT imports
// ============================================================================

/** Captured system prompt from adapter.chat() calls */
let capturedSystemPrompt: string | undefined;

const {
  mockGetSystemPrompt,
  mockGetSystemPromptMeta,
  mockBuildScienceClaimsSection,
  mockInjectScienceClaimsSection,
  mockGetAdapter,
  mockGetMaxTokensFromConfig,
  mockLog,
  mockEmit,
  mockConfig,
  mockGetRequestId,
  mockGetRequestKeyId,
  mockGetRequestCallerContext,
  mockContextToTelemetry,
  mockLogCeeCall,
  mockExtractJsonFromResponse,
  mockBuildLLMRawTrace,
  mockPerformShapeCheck,
} = vi.hoisted(() => ({
  mockGetSystemPrompt: vi.fn(),
  mockGetSystemPromptMeta: vi.fn(),
  mockBuildScienceClaimsSection: vi.fn(),
  mockInjectScienceClaimsSection: vi.fn(),
  mockGetAdapter: vi.fn(),
  mockGetMaxTokensFromConfig: vi.fn(),
  mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  mockEmit: vi.fn(),
  mockConfig: {
    config: {
      cee: {
        decisionReviewEnabled: true,
        decisionReviewRateLimitRpm: 100,
        observabilityRawIO: false,
      },
      features: { dskEnabled: true },
    },
  },
  mockGetRequestId: vi.fn(),
  mockGetRequestKeyId: vi.fn(),
  mockGetRequestCallerContext: vi.fn(),
  mockContextToTelemetry: vi.fn(),
  mockLogCeeCall: vi.fn(),
  mockExtractJsonFromResponse: vi.fn(),
  mockBuildLLMRawTrace: vi.fn(),
  mockPerformShapeCheck: vi.fn(),
}));

vi.mock("../../src/config/index.js", () => mockConfig);
vi.mock("../../src/utils/telemetry.js", () => ({
  log: mockLog,
  emit: mockEmit,
  TelemetryEvents: new Proxy({}, { get: (_t, p) => String(p) }),
}));
vi.mock("../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: mockGetSystemPrompt,
  getSystemPromptMeta: mockGetSystemPromptMeta,
}));
vi.mock("../../src/cee/decision-review/science-claims.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/cee/decision-review/science-claims.js")>();
  return {
    ...original,
    buildScienceClaimsSection: mockBuildScienceClaimsSection,
    // Use the REAL injectScienceClaimsSection so collision policy is exercised
  };
});
vi.mock("../../src/cee/decision-review/shape-check.js", () => ({
  performShapeCheck: mockPerformShapeCheck,
}));
vi.mock("../../src/adapters/llm/router.js", () => ({
  getAdapter: mockGetAdapter,
  getMaxTokensFromConfig: mockGetMaxTokensFromConfig,
}));
vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: vi.fn((code, msg, opts) => ({
    code, message: msg, ...opts?.details,
  })),
}));
vi.mock("../../src/utils/request-id.js", () => ({
  getRequestId: mockGetRequestId,
}));
vi.mock("../../src/plugins/auth.js", () => ({
  getRequestKeyId: mockGetRequestKeyId,
  getRequestCallerContext: mockGetRequestCallerContext,
}));
vi.mock("../../src/context/index.js", () => ({
  contextToTelemetry: mockContextToTelemetry,
}));
vi.mock("../../src/cee/logging.js", () => ({
  logCeeCall: mockLogCeeCall,
}));
vi.mock("../../src/utils/json-extractor.js", () => ({
  extractJsonFromResponse: mockExtractJsonFromResponse,
}));
vi.mock("../../src/cee/llm-output-store.js", () => ({
  buildLLMRawTrace: mockBuildLLMRawTrace,
}));
vi.mock("../../src/config/timeouts.js", () => ({
  HTTP_CLIENT_TIMEOUT_MS: 30_000,
}));
vi.mock("../../src/adapters/llm/errors.js", () => ({
  UpstreamHTTPError: class UpstreamHTTPError extends Error {
    status: number;
    code: string;
    provider: string;
    constructor(msg: string, status: number) {
      super(msg);
      this.status = status;
      this.code = "UPSTREAM_ERROR";
      this.provider = "test";
    }
  },
}));

// ============================================================================
// Import SUT (after mocks)
// ============================================================================

import route from "../../src/routes/assist.v1.decision-review.js";

// ============================================================================
// Fixtures
// ============================================================================

/** Prompt that ALREADY has <SCIENCE_CLAIMS> baked in (simulates store v12+) */
const BAKED_IN_PROMPT = `<ROLE>Test role</ROLE>

<INPUT_FIELDS>
Some input fields
</INPUT_FIELDS>

<SCIENCE_CLAIMS>
Baked-in claims from store v12
BIAS CLAIMS:
| DSK-B-001 | strong | Anchoring |
</SCIENCE_CLAIMS>

<CONSTRUCTION_FLOW>
Build the response
</CONSTRUCTION_FLOW>

<OUTPUT_SCHEMA>
Return JSON
</OUTPUT_SCHEMA>`;

/** Prompt without <SCIENCE_CLAIMS> (simulates store v9/default) */
const CLEAN_PROMPT = `<ROLE>Test role</ROLE>

<INPUT_FIELDS>
Some input fields
</INPUT_FIELDS>

<CONSTRUCTION_FLOW>
Build the response
</CONSTRUCTION_FLOW>

<OUTPUT_SCHEMA>
Return JSON
</OUTPUT_SCHEMA>`;

const VALID_PAYLOAD = {
  brief: "Should we expand to the UK market?",
  brief_hash: "test-hash-123",
  graph: { nodes: [{ id: "n1", kind: "goal" }] },
  isl_results: {
    option_comparison: [{ option_id: "opt1", win_prob: 0.65 }],
    factor_sensitivity: [{ factor_id: "f1", elasticity: 0.3 }],
  },
  deterministic_coaching: {
    readiness: "ready",
    headline_type: "clear_winner",
    evidence_gaps: [],
    model_critiques: [],
  },
  winner: { id: "opt1", label: "Option A", win_probability: 0.65 },
  runner_up: { id: "opt2", label: "Option B", win_probability: 0.35 },
};

const MOCK_REVIEW_JSON = {
  narrative_summary: "Test summary",
  story_headlines: { opt1: "Headline" },
  robustness_explanation: { summary: "s", primary_risk: "r", stability_factors: [], fragility_factors: [] },
  readiness_rationale: "Test rationale",
  evidence_enhancements: {},
  bias_findings: [],
  key_assumptions: ["assumption"],
  decision_quality_prompts: [],
};

// ============================================================================
// Tests
// ============================================================================

describe("POST /assist/v1/decision-review — SCIENCE_CLAIMS collision (route-level)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await route(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    capturedSystemPrompt = undefined;

    mockGetRequestId.mockReturnValue("test-req-1");
    mockGetRequestKeyId.mockReturnValue("test-key");
    mockGetRequestCallerContext.mockReturnValue(null);
    mockContextToTelemetry.mockReturnValue({ request_id: "test-req-1" });

    mockGetSystemPromptMeta.mockReturnValue({
      taskId: "decision_review",
      source: "store",
      promptId: "decision_review_default",
      version: 12,
      prompt_version: "decision_review_default@v12 (production)",
    });

    mockGetMaxTokensFromConfig.mockReturnValue(4096);

    // Default: adapter captures system prompt
    mockGetAdapter.mockReturnValue({
      name: "test-adapter",
      model: "test-model",
      chat: vi.fn(async (args: { system: string }) => {
        capturedSystemPrompt = args.system;
        return {
          content: JSON.stringify(MOCK_REVIEW_JSON),
          model: "test-model",
          latencyMs: 10,
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      }),
    });

    mockExtractJsonFromResponse.mockReturnValue({
      json: MOCK_REVIEW_JSON,
      wasExtracted: true,
      extractionMethod: "direct",
    });

    mockBuildLLMRawTrace.mockReturnValue({
      stored: true,
      request_id: "test-req-1",
    });

    mockPerformShapeCheck.mockReturnValue({
      valid: true,
      errors: [],
      warnings: [],
    });

    mockConfig.config.cee.decisionReviewEnabled = true;
  });

  it("returns 200 (not 500) when store prompt already contains <SCIENCE_CLAIMS>", async () => {
    // Store returns prompt with baked-in section
    mockGetSystemPrompt.mockResolvedValue(BAKED_IN_PROMPT);

    // DSK is enabled and returns claims
    mockBuildScienceClaimsSection.mockReturnValue({
      section: "<SCIENCE_CLAIMS>\nRuntime claims\n</SCIENCE_CLAIMS>",
      biasCount: 2,
      techniqueCount: 1,
    });

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: VALID_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.review).toBeDefined();
    expect(body.review.narrative_summary).toBe("Test summary");
  });

  it("passes system prompt with exactly one <SCIENCE_CLAIMS> section to adapter.chat", async () => {
    mockGetSystemPrompt.mockResolvedValue(BAKED_IN_PROMPT);
    mockBuildScienceClaimsSection.mockReturnValue({
      section: "<SCIENCE_CLAIMS>\nRuntime claims\n</SCIENCE_CLAIMS>",
      biasCount: 2,
      techniqueCount: 1,
    });

    await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: VALID_PAYLOAD,
    });

    // Verify the system prompt was captured
    expect(capturedSystemPrompt).toBeDefined();

    // Exactly one <SCIENCE_CLAIMS> section (the baked-in one, not the runtime one)
    const openTags = capturedSystemPrompt!.match(/<SCIENCE_CLAIMS>/g);
    const closeTags = capturedSystemPrompt!.match(/<\/SCIENCE_CLAIMS>/g);
    expect(openTags).toHaveLength(1);
    expect(closeTags).toHaveLength(1);

    // Contains the baked-in content, not the runtime content
    expect(capturedSystemPrompt).toContain("Baked-in claims from store v12");
    expect(capturedSystemPrompt).not.toContain("Runtime claims");
  });

  it("logs structured skip warning with prompt_version when collision detected", async () => {
    mockGetSystemPrompt.mockResolvedValue(BAKED_IN_PROMPT);
    mockBuildScienceClaimsSection.mockReturnValue({
      section: "<SCIENCE_CLAIMS>\nRuntime\n</SCIENCE_CLAIMS>",
      biasCount: 1,
      techniqueCount: 0,
    });

    await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: VALID_PAYLOAD,
    });

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: "test-req-1",
        prompt_version: "decision_review_default@v12 (production)",
        has_open_tag: true,
        has_close_tag: true,
        science_claims_tag_count: 1,
      }),
      "Skipping SCIENCE_CLAIMS injection: prompt already contains section",
    );
  });

  it("injects normally when store prompt does NOT contain <SCIENCE_CLAIMS>", async () => {
    mockGetSystemPrompt.mockResolvedValue(CLEAN_PROMPT);
    mockBuildScienceClaimsSection.mockReturnValue({
      section: "<SCIENCE_CLAIMS>\nRuntime claims\n</SCIENCE_CLAIMS>",
      biasCount: 2,
      techniqueCount: 1,
    });

    await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: VALID_PAYLOAD,
    });

    expect(capturedSystemPrompt).toBeDefined();

    // Should have exactly one section — the injected one
    const openTags = capturedSystemPrompt!.match(/<SCIENCE_CLAIMS>/g);
    expect(openTags).toHaveLength(1);

    // Contains the runtime injected content
    expect(capturedSystemPrompt).toContain("Runtime claims");

    // Info log (not warn) confirms injection
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ bias_claims: 2, technique_claims: 1 }),
      expect.stringContaining("Science claims injected"),
    );
  });

  it("skips injection entirely when DSK is disabled (buildScienceClaimsSection returns null)", async () => {
    mockGetSystemPrompt.mockResolvedValue(CLEAN_PROMPT);
    mockBuildScienceClaimsSection.mockReturnValue(null);

    await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: VALID_PAYLOAD,
    });

    expect(capturedSystemPrompt).toBeDefined();

    // No <SCIENCE_CLAIMS> section at all
    expect(capturedSystemPrompt).not.toContain("<SCIENCE_CLAIMS>");

    // No skip warning logged
    const skipCalls = mockLog.warn.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[1] === "string" && call[1].includes("Skipping SCIENCE_CLAIMS"),
    );
    expect(skipCalls).toHaveLength(0);
  });
});
