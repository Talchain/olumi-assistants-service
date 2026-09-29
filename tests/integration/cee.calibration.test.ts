import { describe, it, expect } from "vitest";
import { computeQuality } from "../../src/cee/quality/index.js";
import { buildCeeGuidance, ceeAnyTruncated } from "../../src/cee/guidance/index.js";
import { CEE_QUALITY_HIGH_MIN, CEE_QUALITY_MEDIUM_MIN } from "../../src/cee/policy.js";
import {
  CEE_CALIBRATION_CASES,
  loadCalibrationCase,
  type CeeCalibrationCaseId,
} from "../utils/cee-calibration.js";

function bandFromOverall(overall: number | undefined): "low" | "medium" | "high" {
  if (overall === undefined || !Number.isFinite(overall)) {
    throw new Error(`Calibration produced invalid overall score: ${overall}`);
  }

  if (overall >= CEE_QUALITY_HIGH_MIN) return "high";
  if (overall >= CEE_QUALITY_MEDIUM_MIN) return "medium";
  return "low";
}

const CASE_IDS: CeeCalibrationCaseId[] = Object.values(CEE_CALIBRATION_CASES);

describe("CEE calibration - quality and guidance golden cases", () => {
  for (const caseId of CASE_IDS) {
    it(`matches quality band and truncation/validation flags for ${caseId}`, async () => {
      const calibration = await loadCalibrationCase(caseId);
      const { quality_input, expectations } = calibration;

      const quality = computeQuality({
        graph: quality_input.graph,
        confidence: quality_input.confidence,
        engineIssueCount: quality_input.engine_issue_count,
        ceeIssues: quality_input.cee_issues,
      });

      const limits = quality_input.limits;
      const guidance = buildCeeGuidance({
        quality,
        validationIssues: quality_input.cee_issues,
        limits,
      });

      const band = bandFromOverall(quality.overall);
      expect(band).toBe(expectations.expected_band);

      const hasValidationIssues =
        Array.isArray(quality_input.cee_issues) && quality_input.cee_issues.length > 0;
      expect(hasValidationIssues).toBe(expectations.expect_validation_issues);

      const limitsTruncated = ceeAnyTruncated(limits);
      const guidanceTruncated = !!guidance.any_truncated;

      expect(guidanceTruncated).toBe(limitsTruncated);
      expect(guidanceTruncated).toBe(expectations.expect_any_truncated);
    });
  }
});

describe("CEE calibration fixture immutability", () => {
  it("returns a fresh copy on each load", async () => {
    const id: CeeCalibrationCaseId = CEE_CALIBRATION_CASES.HIGH_QUALITY;

    const first = await loadCalibrationCase(id);
    const originalIssueCount = first.quality_input.cee_issues.length;

    // Mutate the first copy in a way that would be observable if the cache
    // returned the same object instance.
    first.quality_input.cee_issues.push({
      code: "structural_gap",
      severity: "error",
      message: "test-only mutation",
    } as any);

    const second = await loadCalibrationCase(id);

    expect(second.quality_input.cee_issues.length).toBe(originalIssueCount);
  });
});
