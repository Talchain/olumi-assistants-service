/**
 * Decision Review — Route-level grounding & retry tests
 *
 * P1-1: Label fidelity — asserts that winner.label, runner_up.label, and
 *       option_comparison[].option_label reach the LLM userMessage verbatim
 *       through the real buildUserMessage path (via app.inject + chat spy).
 *
 * P1-2: Retry control flow — mocks two sequential LLM responses to verify:
 *       - attempt 1 UNGROUNDED_NUMBER triggers a single retry
 *       - attempt 2 success → 200, no third call
 *       - attempt 2 double failure → 200 with shape_warnings (graceful degradation)
 *       - retry cap respected (exactly two adapter.chat calls)
 *
 * P1-3: _meta.model_used — asserts the field is present and non-null in 200
 *       responses, matching the resolved model string from the adapter.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";

// ============================================================================
// Mock setup — must precede all SUT imports
// ============================================================================

let capturedUserMessage: string | undefined;

const {
  mockGetSystemPrompt,
  mockGetSystemPromptMeta,
  mockBuildScienceClaimsSection,
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
      features: { dskEnabled: false },
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
vi.mock("../../src/cee/decision-review/science-claims.js", () => ({
  buildScienceClaimsSection: mockBuildScienceClaimsSection,
  injectScienceClaimsSection: vi.fn((prompt: string, section: string) => prompt + "\n" + section),
}));
vi.mock("../../src/cee/decision-review/shape-check.js", () => ({
  performShapeCheck: mockPerformShapeCheck,
}));
vi.mock("../../src/adapters/llm/router.js", () => ({
  getAdapter: mockGetAdapter,
  getMaxTokensFromConfig: mockGetMaxTokensFromConfig,
}));
vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: vi.fn((code, msg, opts) => ({
    code,
    message: msg,
    ...opts?.details,
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

const SYSTEM_PROMPT = "<ROLE>Test reviewer</ROLE>";

const MOCK_REVIEW_JSON = {
  narrative_summary: "Test summary",
  story_headlines: { opt1: "Headline" },
  robustness_explanation: {
    summary: "s",
    primary_risk: "r",
    stability_factors: [],
    fragility_factors: [],
  },
  readiness_rationale: "Test rationale",
  evidence_enhancements: {},
  bias_findings: [],
  key_assumptions: ["assumption"],
  decision_quality_prompts: [],
};

const SHAPE_CHECK_OK = { valid: true, errors: [], warnings: [] };
const SHAPE_CHECK_UNGROUNDED = {
  valid: true,
  errors: [],
  warnings: ['UNGROUNDED_NUMBER: "99" in narrative_summary'],
};
const SHAPE_CHECK_DOUBLE_UNGROUNDED = {
  valid: true,
  errors: [],
  warnings: ['UNGROUNDED_NUMBER: "99" in narrative_summary', 'UNGROUNDED_NUMBER: "88" in readiness_rationale'],
};

/** Builds a mock chat result */
function makeChatResult(content: string, model = "test-model") {
  return {
    content,
    model,
    latencyMs: 10,
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

// ============================================================================
// Payload builders
// ============================================================================

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    brief: "Should we expand to the UK market?",
    brief_hash: "test-hash-123",
    graph: { nodes: [{ id: "n1", kind: "goal" }] },
    isl_results: {
      option_comparison: [
        { option_id: "opt1", option_label: "Increase Price to £59", win_probability: 0.65 },
        { option_id: "opt2", option_label: "Option B — Keep at £40", win_probability: 0.35 },
      ],
      factor_sensitivity: [{ factor_id: "f1", elasticity: 0.3 }],
    },
    deterministic_coaching: {
      readiness: "ready",
      headline_type: "clear_winner",
      evidence_gaps: [],
      model_critiques: [],
    },
    winner: { id: "opt1", label: "Increase Price to £59", win_probability: 0.65 },
    runner_up: { id: "opt2", label: "Option B — Keep at £40", win_probability: 0.35 },
    ...overrides,
  };
}

// ============================================================================
// Shared setup
// ============================================================================

function setupDefaultMocks() {
  mockGetRequestId.mockReturnValue("test-req-1");
  mockGetRequestKeyId.mockReturnValue("test-key");
  mockGetRequestCallerContext.mockReturnValue(null);
  mockContextToTelemetry.mockReturnValue({ request_id: "test-req-1" });
  mockGetSystemPrompt.mockResolvedValue(SYSTEM_PROMPT);
  mockGetSystemPromptMeta.mockReturnValue({
    taskId: "decision_review",
    source: "store",
    promptId: "decision_review_default",
    version: 9,
    prompt_version: "decision_review_default@v9 (production)",
  });
  mockGetMaxTokensFromConfig.mockReturnValue(4096);
  mockBuildScienceClaimsSection.mockReturnValue(null);
  mockBuildLLMRawTrace.mockReturnValue({ stored: true, request_id: "test-req-1" });
  mockExtractJsonFromResponse.mockReturnValue({
    json: MOCK_REVIEW_JSON,
    wasExtracted: true,
    extractionMethod: "direct",
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("POST /assist/v1/decision-review — label fidelity (P1-1)", () => {
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
    capturedUserMessage = undefined;

    setupDefaultMocks();

    mockGetAdapter.mockReturnValue({
      name: "test-adapter",
      model: "test-model",
      chat: vi.fn(async (args: { system: string; userMessage: string }) => {
        capturedUserMessage = args.userMessage;
        return makeChatResult(JSON.stringify(MOCK_REVIEW_JSON));
      }),
    });
    mockPerformShapeCheck.mockReturnValue(SHAPE_CHECK_OK);
  });

  it("passes winner.label verbatim in the LLM user message", async () => {
    const payload = makePayload();

    await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload,
    });

    expect(capturedUserMessage).toBeDefined();
    // The label must appear verbatim — with currency symbol and exact casing
    expect(capturedUserMessage).toContain("Increase Price to £59");
  });

  it("passes runner_up.label verbatim in the LLM user message", async () => {
    const payload = makePayload();

    await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload,
    });

    expect(capturedUserMessage).toBeDefined();
    expect(capturedUserMessage).toContain("Option B — Keep at £40");
  });

  it("passes option_comparison[].option_label verbatim in the LLM user message", async () => {
    const payload = makePayload();

    await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload,
    });

    expect(capturedUserMessage).toBeDefined();
    // Both option labels must appear in the isl_results section
    expect(capturedUserMessage).toContain("Increase Price to £59");
    expect(capturedUserMessage).toContain("Option B — Keep at £40");
  });

  it("does not transform or truncate labels with special characters (£, —, punctuation)", async () => {
    const payload = makePayload({
      winner: { id: "w1", label: "Expand: £100k/yr (Best-case)", win_probability: 0.72 },
      runner_up: { id: "r1", label: "Hold — Wait & See", win_probability: 0.28 },
    });

    await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload,
    });

    expect(capturedUserMessage).toBeDefined();
    expect(capturedUserMessage).toContain("Expand: £100k/yr (Best-case)");
    expect(capturedUserMessage).toContain("Hold — Wait & See");
  });
});

describe("POST /assist/v1/decision-review — retry control flow (P1-2)", () => {
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
    capturedUserMessage = undefined;

    setupDefaultMocks();
  });

  it("fires exactly one retry when attempt 1 has UNGROUNDED_NUMBER, then succeeds", async () => {
    const chatFn = vi
      .fn()
      .mockResolvedValueOnce(makeChatResult(JSON.stringify(MOCK_REVIEW_JSON))) // attempt 1
      .mockResolvedValueOnce(makeChatResult(JSON.stringify(MOCK_REVIEW_JSON))); // attempt 2 (retry)

    mockGetAdapter.mockReturnValue({
      name: "test-adapter",
      model: "test-model",
      chat: chatFn,
    });

    // attempt 1: shape OK but has ungrounded number → trigger retry
    // attempt 2 (retry): shape OK, no warnings → resolved
    mockPerformShapeCheck
      .mockReturnValueOnce(SHAPE_CHECK_UNGROUNDED)
      .mockReturnValueOnce(SHAPE_CHECK_OK);

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: makePayload(),
    });

    expect(res.statusCode).toBe(200);
    // Exactly two adapter calls: original + one retry
    expect(chatFn).toHaveBeenCalledTimes(2);
  });

  it("includes the fabricated number in the correction suffix on retry", async () => {
    let attempt2Message: string | undefined;

    const chatFn = vi
      .fn()
      .mockResolvedValueOnce(makeChatResult(JSON.stringify(MOCK_REVIEW_JSON)))
      .mockImplementationOnce(async (args: { system: string; userMessage: string }) => {
        attempt2Message = args.userMessage;
        return makeChatResult(JSON.stringify(MOCK_REVIEW_JSON));
      });

    mockGetAdapter.mockReturnValue({
      name: "test-adapter",
      model: "test-model",
      chat: chatFn,
    });

    mockPerformShapeCheck
      .mockReturnValueOnce(SHAPE_CHECK_UNGROUNDED)
      .mockReturnValueOnce(SHAPE_CHECK_OK);

    await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: makePayload(),
    });

    expect(attempt2Message).toBeDefined();
    // Retry message must include the CORRECTION block with the fabricated number
    expect(attempt2Message).toContain("<CORRECTION>");
    expect(attempt2Message).toContain('"99"');
  });

  it("returns 200 with shape_warnings (graceful degradation) when retry also has UNGROUNDED_NUMBER", async () => {
    const chatFn = vi
      .fn()
      .mockResolvedValueOnce(makeChatResult(JSON.stringify(MOCK_REVIEW_JSON)))
      .mockResolvedValueOnce(makeChatResult(JSON.stringify(MOCK_REVIEW_JSON)));

    mockGetAdapter.mockReturnValue({
      name: "test-adapter",
      model: "test-model",
      chat: chatFn,
    });

    // Both attempts ungrounded → graceful degradation
    mockPerformShapeCheck
      .mockReturnValueOnce(SHAPE_CHECK_UNGROUNDED)
      .mockReturnValueOnce(SHAPE_CHECK_DOUBLE_UNGROUNDED);

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: makePayload(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Degraded response must carry the warnings
    expect(body._meta.shape_warnings).toBeDefined();
    expect(body._meta.shape_warnings).toHaveLength(2);
    expect(body._meta.shape_warnings[0]).toMatch(/UNGROUNDED_NUMBER/);
  });

  it("does NOT fire a third LLM call even when retry also has UNGROUNDED_NUMBER", async () => {
    const chatFn = vi
      .fn()
      .mockResolvedValueOnce(makeChatResult(JSON.stringify(MOCK_REVIEW_JSON)))
      .mockResolvedValueOnce(makeChatResult(JSON.stringify(MOCK_REVIEW_JSON)));

    mockGetAdapter.mockReturnValue({
      name: "test-adapter",
      model: "test-model",
      chat: chatFn,
    });

    mockPerformShapeCheck
      .mockReturnValueOnce(SHAPE_CHECK_UNGROUNDED)
      .mockReturnValueOnce(SHAPE_CHECK_DOUBLE_UNGROUNDED);

    await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: makePayload(),
    });

    // Hard cap: exactly 2 calls regardless of retry outcome
    expect(chatFn).toHaveBeenCalledTimes(2);
  });

  it("returns 422 when retry introduces shape errors (shape invalid on attempt 2)", async () => {
    const chatFn = vi
      .fn()
      .mockResolvedValueOnce(makeChatResult(JSON.stringify(MOCK_REVIEW_JSON)))
      .mockResolvedValueOnce(makeChatResult("corrupted json"));

    mockGetAdapter.mockReturnValue({
      name: "test-adapter",
      model: "test-model",
      chat: chatFn,
    });

    // Attempt 1: shape valid but ungrounded → retry
    // Attempt 2: shape invalid → fall through to 422 path
    mockPerformShapeCheck
      .mockReturnValueOnce(SHAPE_CHECK_UNGROUNDED)
      .mockReturnValueOnce({ valid: false, errors: ["Missing narrative_summary"], warnings: [] });

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: makePayload(),
    });

    expect(res.statusCode).toBe(422);
  });

  it("does not retry when attempt 1 has shape errors (only retries UNGROUNDED_NUMBER)", async () => {
    const chatFn = vi
      .fn()
      .mockResolvedValueOnce(makeChatResult("corrupted json"));

    mockGetAdapter.mockReturnValue({
      name: "test-adapter",
      model: "test-model",
      chat: chatFn,
    });

    mockPerformShapeCheck.mockReturnValueOnce({
      valid: false,
      errors: ["Missing narrative_summary"],
      warnings: [],
    });

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: makePayload(),
    });

    expect(res.statusCode).toBe(422);
    // Only one adapter call — no retry for shape errors
    expect(chatFn).toHaveBeenCalledTimes(1);
  });
});

describe("POST /assist/v1/decision-review — _meta.model_used (P1-3)", () => {
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
    setupDefaultMocks();
    mockPerformShapeCheck.mockReturnValue(SHAPE_CHECK_OK);
  });

  it("includes _meta.model_used as a non-null string in successful responses", async () => {
    mockGetAdapter.mockReturnValue({
      name: "test-adapter",
      model: "claude-sonnet-4-6",
      chat: vi.fn(async () => makeChatResult(JSON.stringify(MOCK_REVIEW_JSON), "claude-sonnet-4-6")),
    });

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: makePayload(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body._meta.model_used).toBeDefined();
    expect(typeof body._meta.model_used).toBe("string");
    expect(body._meta.model_used.length).toBeGreaterThan(0);
  });

  it("_meta.model_used matches the resolved model string from adapter.chat()", async () => {
    const RESOLVED_MODEL = "claude-opus-4-6-20251101";

    mockGetAdapter.mockReturnValue({
      name: "test-adapter",
      model: "claude-opus-4-6",
      chat: vi.fn(async () => makeChatResult(JSON.stringify(MOCK_REVIEW_JSON), RESOLVED_MODEL)),
    });

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: makePayload(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body._meta.model_used).toBe(RESOLVED_MODEL);
  });

  it("_meta.model_used is present even when retry was triggered", async () => {
    const RESOLVED_MODEL = "claude-sonnet-4-6";

    const chatFn = vi
      .fn()
      .mockResolvedValueOnce(makeChatResult(JSON.stringify(MOCK_REVIEW_JSON), RESOLVED_MODEL))
      .mockResolvedValueOnce(makeChatResult(JSON.stringify(MOCK_REVIEW_JSON), RESOLVED_MODEL));

    mockGetAdapter.mockReturnValue({
      name: "test-adapter",
      model: RESOLVED_MODEL,
      chat: chatFn,
    });

    mockPerformShapeCheck
      .mockReturnValueOnce(SHAPE_CHECK_UNGROUNDED)
      .mockReturnValueOnce(SHAPE_CHECK_OK);

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: makePayload(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body._meta.model_used).toBe(RESOLVED_MODEL);
    expect(body._meta.did_retry).toBe(true);
  });
});

// ============================================================================
// Margin pre-computation in LLM user message (route-level, via adapter.chat spy)
// ============================================================================

describe("POST /assist/v1/decision-review — margin in LLM user message (P1-4)", () => {
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
    capturedUserMessage = undefined;
    setupDefaultMocks();
    mockGetAdapter.mockReturnValue({
      name: "test-adapter",
      model: "test-model",
      chat: vi.fn(async (args: { system: string; userMessage: string }) => {
        capturedUserMessage = args.userMessage;
        return makeChatResult(JSON.stringify(MOCK_REVIEW_JSON));
      }),
    });
    mockPerformShapeCheck.mockReturnValue(SHAPE_CHECK_OK);
  });

  it("includes 'margin:' as a named field in the DECISION_CONTEXT block", async () => {
    await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: makePayload(), // winner=0.65, runner_up=0.35 → margin=0.30
    });

    expect(capturedUserMessage).toBeDefined();
    expect(capturedUserMessage).toContain("<DECISION_CONTEXT>");
    expect(capturedUserMessage).toMatch(/margin:/);
  });

  it("margin value equals winner.win_probability minus runner_up.win_probability", async () => {
    await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: makePayload(), // winner.win_probability=0.65, runner_up.win_probability=0.35
    });

    expect(capturedUserMessage).toBeDefined();
    // 0.65 - 0.35 = 0.30 (floating point: may render as 0.30000000000000004 — check for the key prefix)
    // We verify the margin line is present and contains a numeric value derived from subtraction
    const marginLineMatch = capturedUserMessage!.match(/margin:\s*([^\n]+)/);
    expect(marginLineMatch).not.toBeNull();
    const marginStr = marginLineMatch![1].trim();
    const marginVal = parseFloat(marginStr);
    expect(marginVal).toBeCloseTo(0.65 - 0.35, 10);
  });

  it("margin emits JSON null when runner_up is null", async () => {
    await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: makePayload({ runner_up: null }),
    });

    expect(capturedUserMessage).toBeDefined();
    expect(capturedUserMessage).toContain("margin: null");
  });

  it("passes computed margin into performShapeCheck as reviewInput.margin (end-to-end wiring)", async () => {
    // winner=0.65, runner_up=0.35 → expected margin ≈ 0.30
    await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: makePayload(),
    });

    expect(mockPerformShapeCheck).toHaveBeenCalledOnce();
    const reviewInput = mockPerformShapeCheck.mock.calls[0][1];
    expect(reviewInput).toBeDefined();
    expect(typeof reviewInput.margin).toBe("number");
    expect(reviewInput.margin).toBeCloseTo(0.65 - 0.35, 10);
  });

  it("passes margin: null into performShapeCheck for single-option decisions", async () => {
    await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      payload: makePayload({ runner_up: null }),
    });

    expect(mockPerformShapeCheck).toHaveBeenCalledOnce();
    const reviewInput = mockPerformShapeCheck.mock.calls[0][1];
    expect(reviewInput).toBeDefined();
    expect(reviewInput.margin).toBeNull();
  });
});
