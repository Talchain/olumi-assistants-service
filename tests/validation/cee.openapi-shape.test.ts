import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readOpenApiSpec(): string {
  const path = resolve(process.cwd(), "openapi.yaml");
  return readFileSync(path, "utf8");
}

describe("CEE OpenAPI doc-shape spec drift gate", () => {
  it("includes CEE draft response_limits with expected caps fields", () => {
    const spec = readOpenApiSpec();

    // Ensure the CEEDraftGraphResponseV1 schema and response_limits block exist
    expect(spec).toContain("CEEDraftGraphResponseV1");
    expect(spec).toContain("response_limits:");

    // Response limits fields for CEE draft v1 (see Docs/CEE-v1.md and CEE-limits-and-budgets.md)
    expect(spec).toContain("bias_findings_max");
    expect(spec).toContain("bias_findings_truncated");
    expect(spec).toContain("options_max");
    expect(spec).toContain("options_truncated");
    expect(spec).toContain("evidence_suggestions_max");
    expect(spec).toContain("evidence_suggestions_truncated");
    expect(spec).toContain("sensitivity_suggestions_max");
    expect(spec).toContain("sensitivity_suggestions_truncated");
  });

  it("defines all CEE v1 endpoints under /assist/v1/*", () => {
    const spec = readOpenApiSpec();

    // Draft My Model
    expect(spec).toContain("/assist/v1/draft-graph:");
    // Explain My Model
    expect(spec).toContain("/assist/v1/explain-graph:");
    // Evidence Helper
    expect(spec).toContain("/assist/v1/evidence-helper:");
    // Bias Check
    expect(spec).toContain("/assist/v1/bias-check:");
    // Options Helper
    expect(spec).toContain("/assist/v1/options:");
    // Sensitivity Coach
    expect(spec).toContain("/assist/v1/sensitivity-coach:");
    // Team Perspectives
    expect(spec).toContain("/assist/v1/team-perspectives:");
  });
});
