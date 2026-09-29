import { describe, it, expect } from "vitest";
import { buildCeeGuidance, type ResponseLimitsLike } from "../../src/cee/guidance/index.js";

// Lightweight helpers to build quality and validation fixtures without
// importing the full OpenAPI types into tests.

function makeQuality(overall?: number) {
  return {
    overall,
  } as any;
}

function makeIssue(severity: "info" | "warning" | "error") {
  return {
    code: "TEST_ISSUE",
    severity,
  } as any;
}

function makeLimits(flags?: Partial<ResponseLimitsLike>): ResponseLimitsLike {
  return {
    bias_findings_truncated: false,
    options_truncated: false,
    evidence_suggestions_truncated: false,
    sensitivity_suggestions_truncated: false,
    ...flags,
  };
}

describe("CEE guidance helper", () => {
  it("produces a benign summary when there are no truncation flags or validation issues", () => {
    const quality = makeQuality(8);
    const issues: any[] = [];
    const limits = makeLimits();

    const guidance = buildCeeGuidance({ quality, validationIssues: issues, limits });

    expect(guidance.summary).toContain("Overall CEE model quality is");
    expect(guidance.summary).toContain("No major truncation flags or validation issues were detected.");
    expect(guidance.any_truncated).toBeUndefined();
    expect(guidance.risks ?? []).toHaveLength(0);
    expect(guidance.next_actions).toBeDefined();
    expect(guidance.next_actions!.length).toBeGreaterThan(0);
  });

  it("marks guidance as truncated and adds truncation-focused risks and actions when any list is capped", () => {
    const quality = makeQuality(6);
    const issues: any[] = [];
    const limits = makeLimits({ evidence_suggestions_truncated: true });

    const guidance = buildCeeGuidance({ quality, validationIssues: issues, limits });

    expect(guidance.any_truncated).toBe(true);
    const risks = guidance.risks ?? [];
    expect(risks.some((r) => r.toLowerCase().includes("truncated"))).toBe(true);
    const actions = guidance.next_actions ?? [];
    expect(actions.some((a) => a.toLowerCase().includes("narrow"))).toBe(true);
  });

  it("reflects validation issues in risks and next actions", () => {
    const quality = makeQuality(4);
    const issues = [makeIssue("warning"), makeIssue("error")];
    const limits = makeLimits();

    const guidance = buildCeeGuidance({ quality, validationIssues: issues, limits });

    const risks = guidance.risks ?? [];
    expect(risks.some((r) => r.toLowerCase().includes("validation"))).toBe(true);
    const actions = guidance.next_actions ?? [];
    expect(actions.some((a) => a.toLowerCase().includes("validation_issues"))).toBe(true);
  });
});
