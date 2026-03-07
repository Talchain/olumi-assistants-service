/**
 * Contract tests for analysis_ready payload.
 *
 * 1. Canonical fixture test — validates the saved fixture against the schema
 * 2. extractAnalysisReady unit tests — validates producer behaviour
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AnalysisReadyPayload, ANALYSIS_READY_CONTRACT_VERSION } from "../../src/schemas/analysis-ready.js";
import { extractAnalysisReady } from "../../src/orchestrator/tools/draft-graph.js";

// ============================================================================
// 1. Canonical fixture test
// ============================================================================

describe("canonical analysis-ready fixture", () => {
  const fixturePath = path.resolve("tools/fixtures/canonical/analysis-ready.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

  it("fixture _contract_version matches ANALYSIS_READY_CONTRACT_VERSION", () => {
    expect(fixture._contract_version).toBe(ANALYSIS_READY_CONTRACT_VERSION);
  });

  it("payload passes AnalysisReadyPayload.parse()", () => {
    // The outward contract uses option_id; the schema uses id. Remap for validation.
    const forValidation = {
      ...fixture.payload,
      options: fixture.payload.options.map((o: Record<string, unknown>) => ({
        ...o,
        id: o.option_id ?? o.id,
      })),
    };
    expect(() => AnalysisReadyPayload.parse(forValidation)).not.toThrow();
  });

  it("every option has status as a non-empty string", () => {
    for (const opt of fixture.payload.options) {
      expect(typeof opt.status).toBe("string");
      expect(opt.status.length).toBeGreaterThan(0);
    }
  });

  it("every option has interventions as a non-empty object", () => {
    for (const opt of fixture.payload.options) {
      expect(typeof opt.interventions).toBe("object");
      expect(opt.interventions).not.toBeNull();
      expect(Object.keys(opt.interventions).length).toBeGreaterThan(0);
    }
  });

  it("goal_node_id is a non-empty string", () => {
    expect(typeof fixture.payload.goal_node_id).toBe("string");
    expect(fixture.payload.goal_node_id.length).toBeGreaterThan(0);
  });

  it("every option uses option_id as the field name (not id)", () => {
    for (const opt of fixture.payload.options) {
      expect(opt).toHaveProperty("option_id");
      // The outward contract locks option_id; the UI maps to id at its boundary
    }
  });
});

// ============================================================================
// 2. extractAnalysisReady unit tests
// ============================================================================

// Mock the telemetry logger
vi.mock("../../src/utils/telemetry.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("extractAnalysisReady", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets status: 'ready' on every option from pipeline body with id field", async () => {
    const { log } = await import("../../src/utils/telemetry.js");

    const body: Record<string, unknown> = {
      analysis_ready: {
        options: [
          { id: "opt_a", label: "Option A", interventions: { fac_x: 0.5, fac_y: 1 } },
          { id: "opt_b", label: "Option B", interventions: { fac_x: 0, fac_y: 0.8 } },
        ],
        goal_node_id: "goal_outcome",
        status: "ready",
      },
    };

    const result = extractAnalysisReady(body);
    expect(result).toBeDefined();
    expect(result!.options).toHaveLength(2);

    // Every option must have status: 'ready'
    for (const opt of result!.options) {
      expect(opt.status).toBe("ready");
    }

    // option_id should be mapped from id
    expect(result!.options[0].option_id).toBe("opt_a");
    expect(result!.options[1].option_id).toBe("opt_b");

    // Should pass full schema validation
    const forValidation = {
      ...result!,
      options: result!.options.map(o => ({
        id: o.option_id,
        label: o.label,
        status: o.status,
        interventions: o.interventions,
      })),
    };
    expect(() => AnalysisReadyPayload.parse(forValidation)).not.toThrow();

    // No warnings should have been logged
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("returns undefined when safeParse fails (missing goal_node_id)", () => {
    const body: Record<string, unknown> = {
      analysis_ready: {
        options: [
          { id: "opt_a", label: "Option A", interventions: { fac_x: 0.5 } },
        ],
        // goal_node_id intentionally omitted to trigger validation failure
        status: "ready",
      },
    };

    const result = extractAnalysisReady(body);

    // Should return undefined due to structural check (goal_node_id not a string)
    expect(result).toBeUndefined();
  });

  it("returns undefined and logs when analysis_ready is absent from body", async () => {
    const { log: _log } = await import("../../src/utils/telemetry.js");

    const body: Record<string, unknown> = {
      graph: { nodes: [], edges: [] },
    };

    const result = extractAnalysisReady(body);
    expect(result).toBeUndefined();

    expect(_log.info).toHaveBeenCalledWith(
      expect.objectContaining({ omission_reason: "not_in_pipeline_body" }),
      expect.any(String),
    );
  });

  it("flattens nested intervention values { fac: { value: 0.5 } } → { fac: 0.5 }", () => {
    const body: Record<string, unknown> = {
      analysis_ready: {
        options: [
          {
            id: "opt_a",
            label: "Option A",
            interventions: { fac_x: { value: 0.5 }, fac_y: 1 },
          },
        ],
        goal_node_id: "goal_outcome",
        status: "ready",
      },
    };

    const result = extractAnalysisReady(body);
    expect(result).toBeDefined();
    expect(result!.options[0].interventions).toEqual({ fac_x: 0.5, fac_y: 1 });
  });

  it("returns undefined when options array is empty after filtering", () => {
    const body: Record<string, unknown> = {
      analysis_ready: {
        options: [
          { id: 123, label: "Bad ID type", interventions: { fac_x: 0.5 } },
        ],
        goal_node_id: "goal_outcome",
        status: "ready",
      },
    };

    const result = extractAnalysisReady(body);
    expect(result).toBeUndefined();
  });
});
