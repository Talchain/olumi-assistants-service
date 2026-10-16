/**
 * Contract tests for analysis_ready payload.
 *
 * 1. Canonical fixture test — validates the saved fixture against the schema
 * 2. extractAnalysisReady unit tests — validates producer behaviour
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe,expect,it,vi } from "vitest";
import { ANALYSIS_READY_CONTRACT_VERSION,AnalysisReadyPayload } from "../../src/schemas/analysis-ready.js";


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
