import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  normaliseOptionInterventions,
  toOptionV3,
  extractOptionsFromNodes,
  type ExtractedOption,
} from "../../src/cee/extraction/intervention-extractor.js";
import * as telemetry from "../../src/utils/telemetry.js";

describe("Option Interventions Normalisation", () => {
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    emitSpy = vi.spyOn(telemetry, "emit").mockImplementation(() => {});
  });

  afterEach(() => {
    emitSpy.mockRestore();
  });

  describe("normaliseOptionInterventions", () => {
    it("returns empty object when interventions is undefined", () => {
      const option = {
        id: "option_1",
        status: "ready",
        interventions: undefined as any,
      };

      const result = normaliseOptionInterventions(option);

      expect(result.interventions).toEqual({});
    });

    it("returns empty object when interventions is null", () => {
      const option = {
        id: "option_2",
        status: "ready",
        interventions: null as any,
      };

      const result = normaliseOptionInterventions(option);

      expect(result.interventions).toEqual({});
    });

    it("preserves existing interventions when present", () => {
      const existingInterventions = {
        factor_1: { value: 1.0, target_match: { node_id: "factor_1" } },
      };
      const option = {
        id: "option_3",
        status: "ready",
        interventions: existingInterventions,
      };

      const result = normaliseOptionInterventions(option);

      expect(result.interventions).toBe(existingInterventions);
    });

    it("emits telemetry when interventions missing on ready status", () => {
      const option = {
        id: "option_telemetry",
        status: "ready",
        interventions: undefined as any,
      };

      normaliseOptionInterventions(option);

      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.InterventionsMissingDefaulted,
        {
          option_id: "option_telemetry",
          option_status: "ready",
        }
      );
    });

    it("emits telemetry when interventions missing on needs_encoding status", () => {
      const option = {
        id: "option_encoding",
        status: "needs_encoding",
        interventions: null as any,
      };

      normaliseOptionInterventions(option);

      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.InterventionsMissingDefaulted,
        {
          option_id: "option_encoding",
          option_status: "needs_encoding",
        }
      );
    });

    it("emits telemetry with unknown status when status is missing", () => {
      const option = {
        id: "option_no_status",
        // status is intentionally missing
        interventions: undefined as any,
      };

      normaliseOptionInterventions(option);

      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.InterventionsMissingDefaulted,
        {
          option_id: "option_no_status",
          option_status: "unknown",
        }
      );
    });

    it("does NOT emit telemetry when status is needs_user_mapping", () => {
      const option = {
        id: "option_mapping",
        status: "needs_user_mapping",
        interventions: undefined as any,
      };

      normaliseOptionInterventions(option);

      expect(emitSpy).not.toHaveBeenCalled();
    });

    it("does NOT emit telemetry when interventions are present", () => {
      const option = {
        id: "option_present",
        status: "ready",
        interventions: { factor_1: { value: 1 } },
      };

      normaliseOptionInterventions(option);

      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe("toOptionV3 — is_baseline field", () => {
    it("carries is_baseline:true through toOptionV3", () => {
      const extracted: ExtractedOption = {
        id: "opt_status_quo",
        label: "Keep current",
        status: "ready",
        interventions: {},
        is_baseline: true,
      };

      const result = toOptionV3(extracted);
      expect((result as any).is_baseline).toBe(true);
    });

    it("carries is_baseline:false through toOptionV3", () => {
      const extracted: ExtractedOption = {
        id: "opt_new",
        label: "New approach",
        status: "ready",
        interventions: {},
        is_baseline: false,
      };

      const result = toOptionV3(extracted);
      expect((result as any).is_baseline).toBe(false);
    });

    it("does not add is_baseline when absent — pipeline does not crash", () => {
      const extracted: ExtractedOption = {
        id: "opt_no_baseline",
        label: "Option A",
        status: "ready",
        interventions: {},
        // is_baseline intentionally absent (v190 LLM / pre-v191 data)
      };

      const result = toOptionV3(extracted);
      expect((result as any).is_baseline).toBeUndefined();
    });
  });

  describe("extractOptionsFromNodes — is_baseline field", () => {
    const emptyNodes: any[] = [];
    const emptyEdges: any[] = [];
    const goalNodeId = "goal_1";

    it("carries is_baseline:true from source node through to ExtractedOption", () => {
      const optionNodes = [
        { id: "opt_sq", label: "Status Quo", is_baseline: true, v4Interventions: {} },
        { id: "opt_a", label: "Option A", is_baseline: false, v4Interventions: {} },
      ];

      const results = extractOptionsFromNodes(optionNodes, emptyNodes, emptyEdges, goalNodeId);

      const sq = results.find((o) => o.id === "opt_sq");
      const a = results.find((o) => o.id === "opt_a");
      expect(sq?.is_baseline).toBe(true);
      expect(a?.is_baseline).toBe(false);
    });

    it("does not set is_baseline when not provided — no crash", () => {
      const optionNodes = [
        { id: "opt_a", label: "Option A", v4Interventions: {} },
        { id: "opt_b", label: "Option B", v4Interventions: {} },
      ];

      // Should not throw even with no is_baseline on any option
      const results = extractOptionsFromNodes(optionNodes, emptyNodes, emptyEdges, goalNodeId);
      expect(results).toHaveLength(2);
      expect(results[0].is_baseline).toBeUndefined();
      expect(results[1].is_baseline).toBeUndefined();
    });

    it("preserves is_baseline on all options when multiple are flagged (PLoT deduplicates downstream)", () => {
      // Multiple baselines are technically invalid but the pipeline must not crash or drop data.
      // PLoT handles deduplication.
      const optionNodes = [
        { id: "opt_sq1", label: "Status Quo A", is_baseline: true, v4Interventions: {} },
        { id: "opt_sq2", label: "Status Quo B", is_baseline: true, v4Interventions: {} },
        { id: "opt_new", label: "New Option", is_baseline: false, v4Interventions: {} },
      ];

      const results = extractOptionsFromNodes(optionNodes, emptyNodes, emptyEdges, goalNodeId);

      const baselines = results.filter((o) => o.is_baseline === true);
      expect(baselines).toHaveLength(2); // All preserved — PLoT handles deduplication
      expect(results.find((o) => o.id === "opt_new")?.is_baseline).toBe(false);
    });
  });

  describe("toOptionV3", () => {
    it("normalises interventions when undefined", () => {
      const extracted: ExtractedOption = {
        id: "option_v3",
        label: "Test Option",
        status: "ready",
        interventions: undefined as any,
      };

      const result = toOptionV3(extracted);

      expect(result.interventions).toEqual({});
    });

    it("normalises interventions when null", () => {
      const extracted: ExtractedOption = {
        id: "option_v3_null",
        label: "Test Option",
        status: "ready",
        interventions: null as any,
      };

      const result = toOptionV3(extracted);

      expect(result.interventions).toEqual({});
    });

    it("preserves existing interventions", () => {
      const intervention = {
        value: 100,
        source: "brief_extraction" as const,
        target_match: {
          node_id: "factor_1",
          match_type: "exact_id" as const,
          confidence: "high" as const,
        },
      };
      const extracted: ExtractedOption = {
        id: "option_with_interventions",
        label: "Test Option",
        status: "ready",
        interventions: { factor_1: intervention },
      };

      const result = toOptionV3(extracted);

      expect(result.interventions).toEqual({ factor_1: intervention });
    });
  });

  describe("Regression: no crash on iteration", () => {
    it("Object.entries on normalised option does not throw", () => {
      const option = normaliseOptionInterventions({
        id: "opt",
        status: "ready",
        interventions: undefined as any,
      });

      // This would throw "interventions is not iterable" without normalisation
      expect(() => {
        for (const [_k, _v] of Object.entries(option.interventions)) {
          // iterate
        }
      }).not.toThrow();
    });

    it("Object.values on normalised option does not throw", () => {
      const option = normaliseOptionInterventions({
        id: "opt",
        status: "ready",
        interventions: null as any,
      });

      expect(() => {
        for (const _v of Object.values(option.interventions)) {
          // iterate
        }
      }).not.toThrow();
    });

    it("Object.keys on normalised option does not throw", () => {
      const option = normaliseOptionInterventions({
        id: "opt",
        status: "ready",
        interventions: undefined as any,
      });

      expect(() => {
        const keys = Object.keys(option.interventions);
        expect(keys).toEqual([]);
      }).not.toThrow();
    });
  });
});
