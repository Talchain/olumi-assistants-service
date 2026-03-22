/**
 * Brief 2 Liveness Tests: Boundary liveness and type safety (P0-2, P0-4, P1-1)
 *
 * Task 1: PLoT response validation rejects malformed responses (production client path)
 * Task 2: Boundary casts removed — normalizeContext returns ConversationContext
 * Task 3: System event router returns structured error when context is absent
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks — must be declared before imports
// ============================================================================

vi.mock("../../../../src/config/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../src/config/index.js")>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === "plot") {
          return {
            baseUrl: "http://plot-test:3002",
            authToken: "test-token",
          };
        }
        return Reflect.get(target, prop);
      },
    }),
    isProduction: () => false,
  };
});

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

vi.mock("../../../../src/orchestrator/guidance/post-draft.js", () => ({
  generatePostDraftGuidance: vi.fn(() => []),
}));

vi.mock("../../../../src/orchestrator/tools/analysis-blocks.js", () => ({
  buildAnalysisBlocksAndGuidance: vi.fn(() => ({ blocks: [], guidanceItems: [] })),
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { createPLoTClient, PLoTError } from "../../../../src/orchestrator/plot-client.js";
import { routeSystemEvent } from "../../../../src/orchestrator/system-event-router.js";
import { normalizeContext } from "../../../../src/orchestrator/request-normalization.js";

// ============================================================================
// Shared helpers
// ============================================================================

const fetchSpy = vi.spyOn(globalThis, "fetch");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Brief 2: Boundary liveness and type safety", () => {
  // ============================================================================
  // Task 1: PLoT response validation via production client
  // ============================================================================

  describe("Task 1: PLoT /v2/run response validation (production client)", () => {
    it("rejects malformed /v2/run response missing results", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ meta: { response_hash: "h" } }),
      } as any);

      const client = createPLoTClient()!;
      expect(client).not.toBeNull();

      // Payload must pass outbound validation (options need .id and .interventions)
      const validPayload = {
        graph: { nodes: [], edges: [] },
        options: [{ id: "a", option_id: "a", interventions: { fac_1: 1.0 } }],
        goal_node_id: "g1",
      };

      await expect(
        client.run(validPayload, "req-malformed"),
      ).rejects.toThrow(PLoTError);

      try {
        await client.run(validPayload, "req-malformed-2");
      } catch (err) {
        expect(err).toBeInstanceOf(PLoTError);
        const plotErr = err as PLoTError;
        expect(plotErr.orchestratorErrorOverride?.code).toBe("PLOT_RESPONSE_MALFORMED");
        expect(plotErr.orchestratorErrorOverride?.recoverable).toBe(true);
      }
    });

    it("rejects /v2/run response with empty results array", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [], meta: { response_hash: "h" } }),
      } as any);

      const client = createPLoTClient()!;
      const validPayload = {
        graph: { nodes: [], edges: [] },
        options: [{ id: "a", option_id: "a", interventions: { fac_1: 1.0 } }],
        goal_node_id: "g1",
      };
      await expect(
        client.run(validPayload, "req-empty-results"),
      ).rejects.toThrow(PLoTError);
    });

    it("accepts valid /v2/run response with extra fields", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ option_id: "a" }],
            meta: { response_hash: "abc", seed_used: 42, n_samples: 100 },
            fact_objects: [],
          }),
      } as any);

      const client = createPLoTClient()!;
      const validPayload = {
        graph: { nodes: [], edges: [] },
        options: [{ id: "a", option_id: "a", interventions: { fac_1: 1.0 } }],
        goal_node_id: "g1",
      };
      const result = await client.run(validPayload, "req-valid");
      expect(result.meta.response_hash).toBe("abc");
    });

    it("rejects malformed /v1/validate-patch response (non-object)", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve("not an object"),
      } as any);

      const client = createPLoTClient()!;
      await expect(
        client.validatePatch(
          { graph: {}, operations: [{ op: "add_node" }] },
          "req-bad-patch",
        ),
      ).rejects.toThrow(PLoTError);
    });
  });

  // ============================================================================
  // Task 2: normalizeContext return type
  // ============================================================================

  describe("Task 2: normalizeContext returns ConversationContext", () => {
    it("returns context directly when present", () => {
      const context = {
        graph: null,
        analysis_response: null,
        framing: null,
        messages: [],
        scenario_id: "s1",
        analysis_inputs: null,
      };
      const result = normalizeContext({ context, scenario_id: "s1" });
      expect(result).toBe(context);
    });

    it("constructs fallback context from flat fields when context absent", () => {
      const result = normalizeContext({
        scenario_id: "s1",
        graph_state: { nodes: [], edges: [] },
      });
      expect(result).toMatchObject({
        graph: { nodes: [], edges: [] },
        analysis_response: null,
        framing: null,
        messages: [],
        scenario_id: "s1",
        analysis_inputs: null,
      });
    });
  });

  // ============================================================================
  // Task 3: System event router returns structured error for missing context
  // ============================================================================

  describe("Task 3: system event router missing-context guard", () => {
    it("returns 400 MISSING_CONTEXT when context is absent for patch_accepted", async () => {
      const result = await routeSystemEvent({
        event: {
          event_type: "patch_accepted",
          timestamp: "2026-03-16T00:00:00Z",
          event_id: "evt-1",
          details: { patch_id: "p1", operations: [] },
        } as any,
        turnRequest: {
          message: "",
          context: undefined as any,
          scenario_id: "s1",
          client_turn_id: "t1",
        } as any,
        turnId: "turn-1",
        requestId: "req-1",
        plotClient: null,
      });

      expect(result.httpStatus).toBe(400);
      expect(result.error?.code).toBe("MISSING_CONTEXT");
    });

    it("returns 400 MISSING_CONTEXT when context is absent for direct_analysis_run", async () => {
      const result = await routeSystemEvent({
        event: {
          event_type: "direct_analysis_run",
          timestamp: "2026-03-16T00:00:00Z",
          event_id: "evt-2",
          details: {},
        } as any,
        turnRequest: {
          message: "",
          context: undefined as any,
          scenario_id: "s1",
          client_turn_id: "t1",
        } as any,
        turnId: "turn-2",
        requestId: "req-2",
        plotClient: null,
      });

      expect(result.httpStatus).toBe(400);
      expect(result.error?.code).toBe("MISSING_CONTEXT");
    });

    it("does not return MISSING_CONTEXT for feedback_submitted (no context dependency)", async () => {
      const result = await routeSystemEvent({
        event: {
          event_type: "feedback_submitted",
          timestamp: "2026-03-16T00:00:00Z",
          event_id: "evt-3",
          details: { turn_id: "t1", rating: "up" },
        } as any,
        turnRequest: {
          message: "",
          context: undefined as any,
          scenario_id: "s1",
          client_turn_id: "t1",
        } as any,
        turnId: "turn-3",
        requestId: "req-3",
        plotClient: null,
      });

      expect(result.httpStatus).toBe(200);
      expect(result.error).toBeUndefined();
    });
  });
});
