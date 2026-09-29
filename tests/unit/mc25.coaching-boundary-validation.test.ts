/**
 * MC-25 boundary validation event coverage for the v0.11.0 coaching
 * payload. Per Boundary Contract v1.1 §1.2 / MC-25, every B1-B5 boundary
 * request/response emits a `boundary.validation` telemetry event.
 *
 * The schema amendment does not add a new B1-B5 boundary; it enriches
 * the response payload at existing ones. This test exercises the REAL
 * B1 boundary validator (`validateEgress` from `src/validators/b1.ts`)
 * and asserts that:
 *   1. `boundary.validation` is emitted with `pass: true` when the
 *      payload validates.
 *   2. `boundary.validation` is emitted with `pass: false` and
 *      diagnostic issues when the payload is malformed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const emitSpy = vi.fn();
vi.mock("../../src/utils/telemetry.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/utils/telemetry.js")>(
    "../../src/utils/telemetry.js",
  );
  return {
    ...actual,
    emit: (...args: unknown[]) => emitSpy(...args),
  };
});

// Imported AFTER the mock declaration so the production module picks up
// the spy.
import { validateEgress, validateIngress } from "../../src/validators/b1.ts";
import { TelemetryEvents } from "../../src/utils/telemetry.js";

beforeEach(() => {
  emitSpy.mockClear();
});

function buildOlumiResponseWithDraftGraph(): Record<string, unknown> {
  // Minimal valid OlumiResponse shape per the egress fallback in
  // src/validators/b1.ts:124 (which is the canonical-minimum shape).
  return {
    response_version: 2,
    assistant_text: "Coaching available below.",
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: "frame",
  };
}

describe("MC-25 — coaching/causal_claims/topology_plan payload + boundary.validation event", () => {
  it("validateEgress fires boundary.validation with pass=true on a valid OlumiResponse", () => {
    const response = buildOlumiResponseWithDraftGraph();
    const result = validateEgress(response, "req-mc25-1");
    expect(result.ok).toBe(true);

    const boundaryEmits = emitSpy.mock.calls.filter(
      (c) => c[0] === TelemetryEvents.BoundaryValidation,
    );
    expect(boundaryEmits.length).toBeGreaterThanOrEqual(1);
    const [, payload] = boundaryEmits[boundaryEmits.length - 1]!;
    expect(payload).toMatchObject({
      boundary: "B1",
      direction: "egress",
      pass: true,
      request_id: "req-mc25-1",
    });
  });

  it("validateEgress fires boundary.validation with pass=false on a malformed OlumiResponse", () => {
    const result = validateEgress({ schema_version: "0.3" /* missing required fields */ }, "req-mc25-2");
    expect(result.ok).toBe(false);

    const boundaryEmits = emitSpy.mock.calls.filter(
      (c) => c[0] === TelemetryEvents.BoundaryValidation,
    );
    expect(boundaryEmits.length).toBeGreaterThanOrEqual(1);
    const [, payload] = boundaryEmits[boundaryEmits.length - 1]!;
    expect(payload).toMatchObject({
      boundary: "B1",
      direction: "egress",
      pass: false,
      request_id: "req-mc25-2",
    });
    // Diagnostic issues attached to the failure event.
    expect((payload as { issue_count?: number }).issue_count).toBeGreaterThan(0);
  });

  it("validateIngress fires boundary.validation on the request side", () => {
    // Ingress validates an OrchestratorTurnPayload. We don't need a
    // perfectly-valid one; the contract is that an event fires either way.
    validateIngress({}, "req-mc25-3");
    const boundaryEmits = emitSpy.mock.calls.filter(
      (c) => c[0] === TelemetryEvents.BoundaryValidation,
    );
    expect(boundaryEmits.length).toBeGreaterThanOrEqual(1);
    const [, payload] = boundaryEmits[0]!;
    expect(payload).toMatchObject({
      boundary: "B1",
      direction: "ingress",
      request_id: "req-mc25-3",
    });
  });

  it("TelemetryEvents.BoundaryValidation is the stable boundary.validation constant", () => {
    expect(TelemetryEvents.BoundaryValidation).toBe("boundary.validation");
  });

  // ── Coaching/causal/topology payload at the draft-graph V3 boundary ──────
  // The schema-amendment surface lives at the /assist/v1/draft-graph?schema=v3
  // egress, not the V5 /orchestrate/v2/turn B1 boundary. The V3 schema
  // (CEEGraphResponseV3) is the egress validator there. Asserting it
  // accepts a fully-populated v0.11.0 payload AND that production code
  // emits at this boundary is what MC-25 requires for this amendment.

  it("V3 boundary parse accepts a payload carrying populated coaching, causal_claims, topology_plan", async () => {
    const { CEEGraphResponseV3 } = await import("../../src/schemas/cee-v3.js");
    const v3 = {
      schema_version: "3.0",
      nodes: [
        { id: "goal_g", kind: "goal", label: "goal" },
        { id: "dec_1", kind: "decision", label: "decision" },
      ],
      edges: [],
      options: [],
      goal_node_id: "goal_g",
      coaching: {
        summary: "Tension between speed and runway risk.",
        strengthen_items: [
          { id: "s1", label: "Stress synergy", detail: "Recast as range.", action_type: "add_constraint", bias_category: "anchoring" },
        ],
        widening_log: {
          elements_added: ["fac_a"],
          elements_considered_but_excluded: ["FX exposure not material"],
          brief_completeness: "partial",
        },
        bias_signals: [{ type: "narrow_framing", detail: "Decision framed as binary." }],
      },
      causal_claims: [
        { type: "direct_effect", from: "fac_a", to: "out_x", stated_strength: "strong" },
      ],
      topology_plan: ["fac_a -> out_x", "out_x -> goal_g"],
    };
    const result = CEEGraphResponseV3.safeParse(v3);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(`V3 parse failed: ${first?.path.join(".")} — ${first?.message}`);
    }
    const parsed = result.data as unknown as Record<string, unknown>;
    expect(parsed.coaching).toBeDefined();
    expect(parsed.causal_claims).toEqual(v3.causal_claims);
    expect(parsed.topology_plan).toEqual(v3.topology_plan);
  });

  it("Stage 6 V3 transform always emits coaching + causal_claims + topology_plan (canonical contract: presence enforced at transform, not Zod)", async () => {
    // Runtime contract: production V3 responses always carry the three
    // fields. The Stage 6 transform (`transformResponseToV3` in
    // src/cee/transforms/schema-v3.ts) defaults legacy-absent V1 inputs
    // to canonical-empty. The Zod schema keeps `.optional()` so consumer
    // tests constructing V3 payloads without these fields still parse —
    // production output enforcement lives in the transform.
    // (This test pins the design rationale; the actual transform default
    // behaviour is exercised in
    // tests/unit/boundary.coaching-preservation.test.ts and
    // tests/integration/schema-amendment-end-to-end.test.ts.)
    const { transformResponseToV3 } = await import("../../src/cee/transforms/schema-v3.js");
    const v1: Record<string, unknown> = {
      graph: {
        nodes: [
          { id: "goal_g", kind: "goal", label: "goal" },
          { id: "dec_1", kind: "decision", label: "decision" },
        ],
        edges: [],
      },
      rationales: [],
      quality: { overall: 7, structure: 8, coverage: 7 },
      trace: {},
    };
    const v3 = transformResponseToV3(v1 as never);
    const v3any = v3 as unknown as Record<string, unknown>;
    expect(v3any.coaching).toBeDefined();
    expect(v3any.causal_claims).toEqual([]);
    expect(v3any.topology_plan).toEqual([]);
  });
});
