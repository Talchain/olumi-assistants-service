import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock config before all imports
vi.mock("../../../src/config/index.js", () => ({
  config: {
    features: { orchestratorStreaming: true, contextFabric: false },
  },
  isProduction: () => false,
}));

vi.mock("../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

vi.mock("../../../src/middleware/rate-limit.js", () => ({
  createOrchestratorRateLimitHook: () => async () => {},
}));

vi.mock("../../../src/utils/request-id.js", () => ({
  getOrGenerateRequestId: () => "test-req-id",
}));

vi.mock("../../../src/orchestrator/idempotency.js", () => ({
  getIdempotentResponse: vi.fn(() => null),
  setIdempotentResponse: vi.fn(),
  getInflightRequest: vi.fn(() => null),
  registerInflightRequest: vi.fn(),
}));

vi.mock("../../../src/config/timeouts.js", () => ({
  ORCHESTRATOR_TURN_BUDGET_MS: 60_000,
  SSE_HEARTBEAT_INTERVAL_MS: 10_000,
  SSE_WRITE_TIMEOUT_MS: 30_000,
}));

vi.mock("../../../src/orchestrator/pipeline/pipeline-stream.js", () => ({
  executePipelineStream: vi.fn(),
}));

vi.mock("../../../src/orchestrator/pipeline/llm-client.js", () => ({
  createProductionLLMClient: () => ({}),
}));

vi.mock("../../../src/orchestrator/pipeline/phase4-tools/index.js", () => ({
  createProductionToolDispatcher: () => ({}),
}));

vi.mock("../../../src/orchestrator/plot-client.js", () => ({
  createPLoTClient: () => ({}),
}));

vi.mock("../../../src/orchestrator/turn-contract.js", () => ({
  inferTurnType: vi.fn(() => "conversation"),
  validateTurnContract: vi.fn(() => ({
    inferred_turn_type: "conversation",
    contract_version: "v2",
    forbidden_fields_present: [],
    missing_required_fields: [],
    partial_fields: [],
  })),
}));

vi.mock("../../../src/orchestrator/request-normalization.js", () => ({
  normalizeContext: vi.fn((d: any) => d.context ?? {}),
  normalizeSystemEvent: vi.fn((e: any) => e),
  warnAnalysisStateOnNonAnalysisTurn: vi.fn(),
  warnDirectAnalysisRunDetails: vi.fn(),
}));

import Fastify from "fastify";
import { ceeOrchestratorStreamRouteV1 } from "../../../src/orchestrator/route-stream.js";
import { executePipelineStream } from "../../../src/orchestrator/pipeline/pipeline-stream.js";
import { config } from "../../../src/config/index.js";
import { emit } from "../../../src/utils/telemetry.js";
import { getIdempotentResponse } from "../../../src/orchestrator/idempotency.js";

// ============================================================================
// Helpers
// ============================================================================

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    message: "What should I do about pricing?",
    scenario_id: "sc-1",
    client_turn_id: "ct-1",
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("ceeOrchestratorStreamRouteV1", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Default: generator that yields nothing (tests that need it override this)
    (executePipelineStream as any).mockImplementation(async function* () {
      yield { type: "turn_start", seq: 0, turn_id: "t1", routing: "deterministic", stage: "frame" };
      yield { type: "turn_complete", seq: 1, envelope: {} };
    });
    app = Fastify({ logger: false });
    await ceeOrchestratorStreamRouteV1(app);
    await app.ready();
  });

  afterEach(async () => {
    // Wait for any in-flight async handlers to complete before closing
    await new Promise((r) => setTimeout(r, 20));
    await app.close();
  });

  describe("feature gate", () => {
    it("returns 404 when orchestratorStreaming is disabled", async () => {
      (config.features as any).orchestratorStreaming = false;

      const res = await app.inject({
        method: "POST",
        url: "/orchestrate/v1/turn/stream",
        payload: makeBody(),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Not found" });

      // Restore
      (config.features as any).orchestratorStreaming = true;
    });

    it("returns 200 when orchestratorStreaming is enabled", async () => {
      (executePipelineStream as any).mockImplementation(async function* () {
        yield { type: "turn_start", seq: 0, turn_id: "t1", routing: "deterministic", stage: "frame" };
        yield { type: "turn_complete", seq: 1, envelope: { turn_id: "t1" } };
      });

      const res = await app.inject({
        method: "POST",
        url: "/orchestrate/v1/turn/stream",
        payload: makeBody(),
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe("validation", () => {
    it("returns 400 for invalid request (missing required fields)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/orchestrate/v1/turn/stream",
        payload: { message: "" },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe("INVALID_REQUEST");
      expect(body.error.recoverable).toBe(false);
    });

    it("returns 400 for message exceeding max length", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/orchestrate/v1/turn/stream",
        payload: makeBody({ message: "x".repeat(5000) }),
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe("INVALID_REQUEST");
      expect(body.error.recoverable).toBe(true);
    });
  });

  describe("idempotency", () => {
    it("returns cached JSON on idempotency cache hit", async () => {
      const cachedEnvelope = { turn_id: "cached", assistant_text: "cached response" };
      (getIdempotentResponse as any).mockReturnValue(cachedEnvelope);

      const res = await app.inject({
        method: "POST",
        url: "/orchestrate/v1/turn/stream",
        payload: makeBody(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(cachedEnvelope);
    });
  });

  describe("normalization parity", () => {
    it("calls shared normalization helpers", async () => {
      const { normalizeContext, normalizeSystemEvent, warnAnalysisStateOnNonAnalysisTurn, warnDirectAnalysisRunDetails } =
        await import("../../../src/orchestrator/request-normalization.js");

      // Use idempotency cache hit to avoid entering SSE path (normalization runs first)
      (getIdempotentResponse as any).mockReturnValue({ turn_id: "cached" });

      await app.inject({
        method: "POST",
        url: "/orchestrate/v1/turn/stream",
        payload: makeBody(),
      });

      expect(normalizeContext).toHaveBeenCalled();
      expect(normalizeSystemEvent).toHaveBeenCalled();
      expect(warnAnalysisStateOnNonAnalysisTurn).toHaveBeenCalled();
      expect(warnDirectAnalysisRunDetails).toHaveBeenCalled();
    });
  });

  // Note: SSE streaming behavior (event framing, observability telemetry,
  // pipeline arg passing) passes in isolation but has timing sensitivity when
  // run alongside tests that also enter the raw-response SSE path. This is a
  // lightMyRequest limitation — heartbeat intervals from prior handlers leak
  // across Fastify inject calls. These behaviors are covered by the
  // pipeline-stream unit tests and verified in integration tests.
});
