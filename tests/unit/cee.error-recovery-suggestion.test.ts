/**
 * Wave-2 ask 7 (@talchain/schemas 0.19.0, routed from DGAI #383): the CEE
 * error envelope's flat `recovery_suggestion` — the PINNED producer field
 * name for the recovery sentence.
 *
 * Before this field, the UI's live catch path passthrough-sniffed THREE
 * fallback names (`recovery_suggestion` / `suggested_action` / `recovery`)
 * because CEE only emitted the nested `recovery.suggestion` object and no
 * flat name was typed anywhere. The contract: `recovery_suggestion` is
 * present EXACTLY when `recovery.suggestion` is, and mirrors it verbatim.
 */
import { describe, expect, it } from "vitest";

import { buildCeeErrorResponse } from "../../src/cee/validation/pipeline.js";

describe("buildCeeErrorResponse — flat recovery_suggestion (wave-2 ask 7)", () => {
  it("mirrors recovery.suggestion verbatim when recovery is provided", () => {
    const body = buildCeeErrorResponse("CEE_VALIDATION_FAILED", "invalid input", {
      retryable: false,
      requestId: "req_1",
      recovery: {
        hints: ["Name the decision you want to make."],
        suggestion: "Describe your decision in a sentence or two, then try again.",
        example: "Should we hire locally or engage an offshore partner?",
      },
    });
    expect(body.recovery_suggestion).toBe(
      "Describe your decision in a sentence or two, then try again.",
    );
    // The structured object still ships alongside (both halves of ask 7).
    expect(body.recovery?.suggestion).toBe(body.recovery_suggestion);
    expect(body.recovery?.hints).toEqual(["Name the decision you want to make."]);
  });

  it("is ABSENT when no recovery is provided (absence honest, never a fabricated string)", () => {
    const body = buildCeeErrorResponse("CEE_INTERNAL_ERROR", "boom", {
      retryable: false,
      requestId: "req_2",
    });
    expect(body.recovery_suggestion).toBeUndefined();
    expect(body.recovery).toBeUndefined();
  });

  it("core envelope fields are untouched by the addition (regression pin)", () => {
    const body = buildCeeErrorResponse("CEE_RATE_LIMIT", "rate limited", {
      retryable: true,
      requestId: "req_3",
      details: { retry_after_seconds: 30 },
    });
    expect(body.schema).toBe("cee.error.v1");
    expect(body.code).toBe("CEE_RATE_LIMIT");
    expect(body.retryable).toBe(true);
    expect(body.details).toEqual({ retry_after_seconds: 30 });
  });
});
