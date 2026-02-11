import { describe, it, expect } from "vitest";
import {
  STRENGTH_DEFAULT_SIGNATURE,
  STRENGTH_DEFAULT_THRESHOLD,
  STRENGTH_MEAN_DEFAULT_THRESHOLD,
  STRENGTH_DEFAULT_MIN_EDGES,
  EDGE_STRENGTH_LOW_THRESHOLD,
  EDGE_STRENGTH_NEGLIGIBLE_THRESHOLD,
  CIL_WARNING_CODES,
  CIL_WARNING_SEVERITY,
  ValidationWarningSchema,
  CeeErrorCode,
  LIMITS,
  RepairEntrySchema,
  REPAIR_CODES,
  RepairLayer,
} from "@talchain/schemas";
import type {
  CILWarningCode,
  ValidationWarning,
  CeeErrorCodeType,
  RepairEntry,
} from "@talchain/schemas";

// Local re-exports that should match the shared values
import {
  DEFAULT_STRENGTH_MEAN,
  DEFAULT_STRENGTH_STD,
  STRENGTH_MEAN_DOMINANT_THRESHOLD,
  EDGE_STRENGTH_LOW_THRESHOLD as LOCAL_EDGE_STRENGTH_LOW,
} from "../../src/cee/constants.js";

describe("@talchain/schemas contract tests", () => {
  // =========================================================================
  // 1. Package export shape
  // =========================================================================

  describe("exports expected shapes", () => {
    it("exports STRENGTH_DEFAULT_SIGNATURE as { mean, std }", () => {
      expect(STRENGTH_DEFAULT_SIGNATURE).toEqual({ mean: 0.5, std: 0.125 });
      expect(typeof STRENGTH_DEFAULT_SIGNATURE.mean).toBe("number");
      expect(typeof STRENGTH_DEFAULT_SIGNATURE.std).toBe("number");
    });

    it("exports CIL threshold constants as numbers", () => {
      expect(typeof STRENGTH_DEFAULT_THRESHOLD).toBe("number");
      expect(typeof STRENGTH_MEAN_DEFAULT_THRESHOLD).toBe("number");
      expect(typeof STRENGTH_DEFAULT_MIN_EDGES).toBe("number");
      expect(typeof EDGE_STRENGTH_LOW_THRESHOLD).toBe("number");
      expect(typeof EDGE_STRENGTH_NEGLIGIBLE_THRESHOLD).toBe("number");
    });

    it("exports CIL_WARNING_CODES as readonly object with 4 codes", () => {
      expect(Object.keys(CIL_WARNING_CODES)).toHaveLength(4);
      expect(CIL_WARNING_CODES.STRENGTH_DEFAULT_APPLIED).toBe("STRENGTH_DEFAULT_APPLIED");
      expect(CIL_WARNING_CODES.STRENGTH_MEAN_DEFAULT_DOMINANT).toBe("STRENGTH_MEAN_DEFAULT_DOMINANT");
      expect(CIL_WARNING_CODES.EDGE_STRENGTH_LOW).toBe("EDGE_STRENGTH_LOW");
      expect(CIL_WARNING_CODES.EDGE_STRENGTH_NEGLIGIBLE).toBe("EDGE_STRENGTH_NEGLIGIBLE");
    });

    it("exports CIL_WARNING_SEVERITY mapping for all codes", () => {
      for (const code of Object.values(CIL_WARNING_CODES)) {
        expect(CIL_WARNING_SEVERITY[code as CILWarningCode]).toBeDefined();
        expect(["info", "warn"]).toContain(CIL_WARNING_SEVERITY[code as CILWarningCode]);
      }
    });

    it("exports ValidationWarningSchema as a Zod object", () => {
      expect(ValidationWarningSchema).toBeDefined();
      expect(typeof ValidationWarningSchema.parse).toBe("function");
    });

    it("exports CeeErrorCode as a Zod enum with expected values", () => {
      expect(CeeErrorCode).toBeDefined();
      const values = CeeErrorCode.options;
      expect(values).toContain("CEE_LLM_TIMEOUT");
      expect(values).toContain("CEE_REQUEST_BUDGET_EXCEEDED");
      expect(values).toContain("CEE_LLM_UPSTREAM_ERROR");
      expect(values).toContain("CEE_LLM_VALIDATION_FAILED");
      expect(values).toContain("CEE_CLIENT_DISCONNECT");
      expect(values).toContain("CEE_INTERNAL_ERROR");
    });

    it("exports LIMITS with expected keys", () => {
      expect(LIMITS).toBeDefined();
      expect(typeof LIMITS.MAX_NODES).toBe("number");
      expect(typeof LIMITS.MAX_EDGES).toBe("number");
      expect(typeof LIMITS.MAX_OPTIONS).toBe("number");
    });

    it("exports RepairEntrySchema and REPAIR_CODES", () => {
      expect(RepairEntrySchema).toBeDefined();
      expect(typeof RepairEntrySchema.parse).toBe("function");
      expect(REPAIR_CODES).toBeDefined();
      expect(typeof REPAIR_CODES.CLAMP_STD_MINIMUM).toBe("string");
    });

    it("exports RepairLayer as a Zod enum", () => {
      expect(RepairLayer).toBeDefined();
      expect(RepairLayer.options).toContain("cee");
      expect(RepairLayer.options).toContain("plot");
      expect(RepairLayer.options).toContain("isl");
    });
  });

  // =========================================================================
  // 2. Constant alignment — local re-exports match shared values
  // =========================================================================

  describe("constant alignment", () => {
    it("DEFAULT_STRENGTH_MEAN matches STRENGTH_DEFAULT_SIGNATURE.mean", () => {
      expect(DEFAULT_STRENGTH_MEAN).toBe(STRENGTH_DEFAULT_SIGNATURE.mean);
      expect(DEFAULT_STRENGTH_MEAN).toBe(0.5);
    });

    it("DEFAULT_STRENGTH_STD matches STRENGTH_DEFAULT_SIGNATURE.std", () => {
      expect(DEFAULT_STRENGTH_STD).toBe(STRENGTH_DEFAULT_SIGNATURE.std);
      expect(DEFAULT_STRENGTH_STD).toBe(0.125);
    });

    it("STRENGTH_MEAN_DOMINANT_THRESHOLD matches shared threshold", () => {
      expect(STRENGTH_MEAN_DOMINANT_THRESHOLD).toBe(STRENGTH_MEAN_DEFAULT_THRESHOLD);
      expect(STRENGTH_MEAN_DOMINANT_THRESHOLD).toBe(0.7);
    });

    it("EDGE_STRENGTH_LOW_THRESHOLD re-export matches shared value", () => {
      expect(LOCAL_EDGE_STRENGTH_LOW).toBe(EDGE_STRENGTH_LOW_THRESHOLD);
      expect(LOCAL_EDGE_STRENGTH_LOW).toBe(0.05);
    });

    it("STRENGTH_DEFAULT_THRESHOLD is 0.8 (80%)", () => {
      expect(STRENGTH_DEFAULT_THRESHOLD).toBe(0.8);
    });

    it("STRENGTH_DEFAULT_MIN_EDGES is 3", () => {
      expect(STRENGTH_DEFAULT_MIN_EDGES).toBe(3);
    });

    it("EDGE_STRENGTH_NEGLIGIBLE_THRESHOLD is 0.1", () => {
      expect(EDGE_STRENGTH_NEGLIGIBLE_THRESHOLD).toBe(0.1);
    });
  });

  // =========================================================================
  // 3. ValidationWarning schema validation
  // =========================================================================

  describe("ValidationWarning schema", () => {
    it("accepts a minimal valid warning", () => {
      const warning: ValidationWarning = {
        code: "STRENGTH_DEFAULT_APPLIED",
        message: "Test warning",
        severity: "warn",
      };
      expect(() => ValidationWarningSchema.parse(warning)).not.toThrow();
    });

    it("accepts a warning with details", () => {
      const warning: ValidationWarning = {
        code: "EDGE_STRENGTH_LOW",
        message: "Low strength edge",
        severity: "info",
        details: { edge_id: "a->b", mean: 0.03 },
      };
      const parsed = ValidationWarningSchema.parse(warning);
      expect(parsed.details?.edge_id).toBe("a->b");
    });

    it("passthrough preserves CEE-specific fields", () => {
      const warning = {
        code: "STRENGTH_DEFAULT_APPLIED",
        message: "Test",
        severity: "warn" as const,
        affected_node_id: "node-1",
        suggestion: "Review strengths",
        stage: "cil",
      };
      const parsed = ValidationWarningSchema.parse(warning);
      expect((parsed as any).affected_node_id).toBe("node-1");
      expect((parsed as any).suggestion).toBe("Review strengths");
      expect((parsed as any).stage).toBe("cil");
    });

    it("rejects a warning missing required fields", () => {
      expect(() => ValidationWarningSchema.parse({ code: "X" })).toThrow();
      expect(() => ValidationWarningSchema.parse({ message: "Y" })).toThrow();
    });

    it("accepts all three severity levels", () => {
      for (const severity of ["info", "warn", "error"] as const) {
        expect(() =>
          ValidationWarningSchema.parse({
            code: "TEST",
            message: "test",
            severity,
          })
        ).not.toThrow();
      }
    });
  });

  // =========================================================================
  // 4. CeeErrorCode type checking
  // =========================================================================

  describe("CeeErrorCode", () => {
    it("parses valid error codes", () => {
      expect(CeeErrorCode.parse("CEE_LLM_TIMEOUT")).toBe("CEE_LLM_TIMEOUT");
      expect(CeeErrorCode.parse("CEE_LLM_UPSTREAM_ERROR")).toBe("CEE_LLM_UPSTREAM_ERROR");
      expect(CeeErrorCode.parse("CEE_INTERNAL_ERROR")).toBe("CEE_INTERNAL_ERROR");
    });

    it("rejects invalid error codes", () => {
      expect(() => CeeErrorCode.parse("INVALID_CODE")).toThrow();
    });
  });

  // =========================================================================
  // 5. LIMITS — platform vs CEE divergence documentation
  // =========================================================================

  describe("LIMITS platform defaults", () => {
    it("platform MAX_NODES is 50", () => {
      expect(LIMITS.MAX_NODES).toBe(50);
    });

    it("platform MAX_EDGES is 100 (CEE uses 200)", () => {
      expect(LIMITS.MAX_EDGES).toBe(100);
    });

    it("platform MAX_OPTIONS is 10 (CEE uses 6)", () => {
      expect(LIMITS.MAX_OPTIONS).toBe(10);
    });
  });

  // =========================================================================
  // 6. RepairEntry schema
  // =========================================================================

  describe("RepairEntry schema", () => {
    it("accepts a valid repair entry", () => {
      const entry: RepairEntry = {
        code: "CLAMP_STD_MINIMUM",
        layer: "cee",
        field_path: "edges[0].strength_std",
        before: 0.001,
        after: 0.01,
        reason: "Clamped to minimum",
        severity: "info",
      };
      expect(() => RepairEntrySchema.parse(entry)).not.toThrow();
    });

    it("accepts all repair codes", () => {
      for (const code of Object.values(REPAIR_CODES)) {
        expect(() =>
          RepairEntrySchema.parse({
            code,
            layer: "cee",
            field_path: "test",
            before: null,
            after: "fixed",
            reason: "test",
            severity: "info",
          })
        ).not.toThrow();
      }
    });
  });
});
