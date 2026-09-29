import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { components } from "../../src/generated/openapi.d.ts";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";
import type { ResponseLimitsLike } from "../../src/cee/guidance/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type CEEValidationIssue = components["schemas"]["CEEValidationIssue"];

export type CeeCalibrationKind = "quality_guidance";

export interface CeeQualityGuidanceInput {
  graph: GraphV1 | undefined;
  confidence: number;
  engine_issue_count: number;
  cee_issues: CEEValidationIssue[];
  limits: ResponseLimitsLike;
}

export interface CeeCalibrationExpectations {
  expected_band: "low" | "medium" | "high";
  expect_validation_issues: boolean;
  expect_any_truncated: boolean;
}

export interface CeeCalibrationCase {
  kind: CeeCalibrationKind;
  id: CeeCalibrationCaseId;
  description: string;
  quality_input: CeeQualityGuidanceInput;
  expectations: CeeCalibrationExpectations;
}

export const CEE_CALIBRATION_CASES = {
  HIGH_QUALITY: "golden_high_quality",
  UNDER_SPECIFIED: "golden_under_specified",
  LIMITS_TRUNCATED: "golden_limits_truncated",
  ENGINE_ISSUES: "golden_engine_issues",
  BOUNDARY_LOW_MEDIUM: "golden_boundary_low_medium",
  BOUNDARY_MEDIUM_HIGH: "golden_boundary_medium_high",
  MIXED_TRUNCATION_ISSUES: "golden_mixed_truncation_issues",
  LOW_CONFIDENCE_NO_ISSUES: "golden_low_confidence_no_issues",
  MEDIUM_WITH_CEE_WARNINGS: "golden_medium_with_cee_warnings",
} as const;

export type CeeCalibrationCaseId = (typeof CEE_CALIBRATION_CASES)[keyof typeof CEE_CALIBRATION_CASES];

const CASE_CACHE = new Map<CeeCalibrationCaseId, CeeCalibrationCase>();

function cloneCase(caseData: CeeCalibrationCase): CeeCalibrationCase {
  // Fixtures are plain JSON; a JSON round-trip is sufficient for a deep copy
  // and avoids tests accidentally mutating shared cached state.
  return JSON.parse(JSON.stringify(caseData)) as CeeCalibrationCase;
}

export async function loadCalibrationCase(name: CeeCalibrationCaseId): Promise<CeeCalibrationCase> {
  const cached = CASE_CACHE.get(name);
  if (cached) return cloneCase(cached);
  const fixturePath = join(__dirname, "../fixtures/cee/golden-calibration", `${name}.json`);
  const content = await readFile(fixturePath, "utf-8");
  const parsed = JSON.parse(content) as CeeCalibrationCase;

  if (parsed.kind !== "quality_guidance") {
    throw new Error(`Unexpected calibration kind for ${name}: ${parsed.kind}`);
  }

  CASE_CACHE.set(name, parsed);
  return cloneCase(parsed);
}
