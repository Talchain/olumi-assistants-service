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

  it("returns undefined and logs warning when safeParse fails (invalid top-level status)", async () => {
    const { log: warnLog } = await import("../../src/utils/telemetry.js");

    const body: Record<string, unknown> = {
      analysis_ready: {
        options: [
          { id: "opt_a", label: "Option A", interventions: { fac_x: 0.5 } },
        ],
        goal_node_id: "goal_outcome",
        // Invalid status enum value — passes structural check but fails safeParse
        status: "invalid_status_value",
      },
    };

    const result = extractAnalysisReady(body);
    expect(result).toBeUndefined();

    expect(warnLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ omission_reason: "contract_validation_failed" }),
      expect.stringContaining("contract validation"),
    );
  });

  it("returns undefined and logs when structural check fails (missing goal_node_id)", async () => {
    const { log: structLog } = await import("../../src/utils/telemetry.js");

    const body: Record<string, unknown> = {
      analysis_ready: {
        options: [
          { id: "opt_a", label: "Option A", interventions: { fac_x: 0.5 } },
        ],
        status: "ready",
        // goal_node_id intentionally omitted
      },
    };

    const result = extractAnalysisReady(body);
    expect(result).toBeUndefined();

    expect(structLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        omission_reason: "contract_validation_failed",
        field: "goal_node_id",
        analysis_ready_keys: expect.arrayContaining(["options", "status"]),
      }),
      expect.any(String),
    );
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

  // ===========================================================================
  // Batch 1 field carry-through (CEE-2, CEE-9)
  // ===========================================================================

  it("carries through is_baseline from source options", () => {
    const body: Record<string, unknown> = {
      analysis_ready: {
        options: [
          { id: "opt_a", label: "Option A", status: "ready", is_baseline: false, interventions: { fac_x: 0.5 } },
          { id: "opt_b", label: "Status Quo", status: "ready", is_baseline: true, interventions: { fac_x: 0.3 } },
        ],
        goal_node_id: "goal_outcome",
        status: "ready",
      },
    };

    const result = extractAnalysisReady(body);
    expect(result).toBeDefined();
    expect(result!.options[0].is_baseline).toBe(false);
    expect(result!.options[1].is_baseline).toBe(true);
  });

  it("preserves is_baseline: false (distinguishes from undefined)", () => {
    const body: Record<string, unknown> = {
      analysis_ready: {
        options: [
          { id: "opt_a", label: "Option A", status: "ready", is_baseline: false, interventions: { fac_x: 0.5 } },
        ],
        goal_node_id: "goal_outcome",
        status: "ready",
      },
    };

    const result = extractAnalysisReady(body);
    expect(result).toBeDefined();
    expect(result!.options[0].is_baseline).toBe(false);
  });

  it("omits is_baseline when undefined on source (detection didn't run)", () => {
    const body: Record<string, unknown> = {
      analysis_ready: {
        options: [
          { id: "opt_a", label: "Option A", status: "ready", interventions: { fac_x: 0.5 } },
        ],
        goal_node_id: "goal_outcome",
        status: "ready",
      },
    };

    const result = extractAnalysisReady(body);
    expect(result).toBeDefined();
    expect(result!.options[0]).not.toHaveProperty("is_baseline");
  });

  it("carries through intervention_details from source options", () => {
    const details = {
      fac_x: { display_value: "£200k", normalised_value: 0.5, raw_value: 200000, unit: "GBP" },
    };
    const body: Record<string, unknown> = {
      analysis_ready: {
        options: [
          { id: "opt_a", label: "Option A", status: "ready", interventions: { fac_x: 0.5 }, intervention_details: details },
        ],
        goal_node_id: "goal_outcome",
        status: "ready",
      },
    };

    const result = extractAnalysisReady(body);
    expect(result).toBeDefined();
    expect(result!.options[0].intervention_details).toEqual(details);
  });

  it("omits empty intervention_details (not {})", () => {
    const body: Record<string, unknown> = {
      analysis_ready: {
        options: [
          { id: "opt_a", label: "Option A", status: "ready", interventions: { fac_x: 0.5 }, intervention_details: {} },
        ],
        goal_node_id: "goal_outcome",
        status: "ready",
      },
    };

    const result = extractAnalysisReady(body);
    expect(result).toBeDefined();
    expect(result!.options[0]).not.toHaveProperty("intervention_details");
  });

  it("preserves source status instead of hardcoding 'ready'", () => {
    const body: Record<string, unknown> = {
      analysis_ready: {
        options: [
          { id: "opt_a", label: "Option A", status: "needs_encoding", interventions: { fac_x: 0.5 } },
          { id: "opt_b", label: "Option B", status: "ready", interventions: { fac_x: 0.3 } },
        ],
        goal_node_id: "goal_outcome",
        status: "ready",
      },
    };

    const result = extractAnalysisReady(body);
    expect(result).toBeDefined();
    expect(result!.options[0].status).toBe("needs_encoding");
    expect(result!.options[1].status).toBe("ready");
  });

  it("carries through extraction_metadata and status_reason", () => {
    const body: Record<string, unknown> = {
      analysis_ready: {
        options: [
          {
            id: "opt_a", label: "Option A", status: "ready",
            interventions: { fac_x: 0.5 },
            extraction_metadata: { source: "brief_extraction", confidence: "high" },
            status_reason: "Resolved via factor node value fallback",
          },
        ],
        goal_node_id: "goal_outcome",
        status: "ready",
      },
    };

    const result = extractAnalysisReady(body);
    expect(result).toBeDefined();
    expect(result!.options[0].extraction_metadata).toEqual({ source: "brief_extraction", confidence: "high" });
    expect(result!.options[0].status_reason).toBe("Resolved via factor node value fallback");
  });

  it("omits empty extraction_metadata and raw_interventions", () => {
    const body: Record<string, unknown> = {
      analysis_ready: {
        options: [
          {
            id: "opt_a", label: "Option A", status: "ready",
            interventions: { fac_x: 0.5 },
            extraction_metadata: {},
            raw_interventions: {},
          },
        ],
        goal_node_id: "goal_outcome",
        status: "ready",
      },
    };

    const result = extractAnalysisReady(body);
    expect(result).toBeDefined();
    expect(result!.options[0]).not.toHaveProperty("extraction_metadata");
    expect(result!.options[0]).not.toHaveProperty("raw_interventions");
  });

  it("rejects malformed intervention_details via contract validation", async () => {
    const { log: warnLog } = await import("../../src/utils/telemetry.js");

    const body: Record<string, unknown> = {
      analysis_ready: {
        options: [
          {
            id: "opt_a", label: "Option A", status: "ready",
            interventions: { fac_x: 0.5 },
            // display_value should be string, normalised_value should be number
            intervention_details: { fac_x: { display_value: 999, normalised_value: "not_a_number" } },
          },
        ],
        goal_node_id: "goal_outcome",
        status: "ready",
      },
    };

    const result = extractAnalysisReady(body);
    expect(result).toBeUndefined();

    expect(warnLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ omission_reason: "contract_validation_failed" }),
      expect.stringContaining("contract validation"),
    );
  });
});
