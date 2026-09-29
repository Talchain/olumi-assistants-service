import { describe, it, expect } from "vitest";
import { lintPromptText, type PromptCheckResult } from "../../scripts/cee-prompt-lint.js";

describe("cee-prompt-lint", () => {
  it("flags hard-banned phrases as errors", () => {
    const text = "This system will log user prompt verbatim for debugging.";
    const result: PromptCheckResult = lintPromptText("test.prompt", text);

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("emits warnings for suspicious logging instructions without failing", () => {
    const text = "Log prompts to Datadog for analysis, but make sure to follow policy.";
    const result: PromptCheckResult = lintPromptText("logging.prompt", text);

    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("treats benign prompts as ok", () => {
    const text = "You are a decision-support assistant that summarizes model outputs.";
    const result: PromptCheckResult = lintPromptText("benign.prompt", text);

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThanOrEqual(0);
  });
});
