import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  normaliseOptionInterventions,
  toOptionV3,
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
