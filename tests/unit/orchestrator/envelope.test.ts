import { describe, it, expect } from "vitest";
import { getHttpStatusForError } from "../../../src/orchestrator/types.js";
import type { OrchestratorError } from "../../../src/orchestrator/types.js";

describe("HTTP Status Mapping", () => {
  it.each([
    ["LLM_TIMEOUT" as const, 504],
    ["TOOL_EXECUTION_FAILED" as const, 502],
    ["VALIDATION_REJECTED" as const, 422],
    ["CONTEXT_TOO_LARGE" as const, 413],
    ["INVALID_REQUEST" as const, 400],
    ["UNKNOWN" as const, 500],
  ])("maps %s to %d", (code, expectedStatus) => {
    const error: OrchestratorError = {
      code,
      message: "test",
      recoverable: false,
    };
    expect(getHttpStatusForError(error)).toBe(expectedStatus);
  });
});
