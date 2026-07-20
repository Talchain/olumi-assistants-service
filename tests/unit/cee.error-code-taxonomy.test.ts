import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * CEE 429-family error-code taxonomy (2026-07-20 rename).
 *
 * Three distinct conditions used to share the single wire code
 * `CEE_RATE_LIMIT`, which made a 429 unreadable in the logs — the
 * 2026-07-20 draft-timeout investigation lost time because an elapsed-time
 * deadline breach was indistinguishable from an RPM throttle.
 *
 * The taxonomy is now:
 *   - CEE_RATE_LIMIT     — genuine requests-per-minute throttle
 *                          (src/middleware/rate-limit.ts + assist.v1.* routes)
 *   - CEE_COST_CAP       — money/spend cap (per-request cost guard;
 *                          daily token budget)
 *   - CEE_BUDGET_EXCEEDED — elapsed-time deadline breach
 *                          (RequestBudgetExceededError: budgetMs/elapsedMs)
 *
 * This file pins the two invariants that make the rename safe:
 *   1. The openapi CEEErrorCode enum carries all three (additive — the
 *      rename must not remove CEE_RATE_LIMIT, which is still correct for
 *      the genuine limiter).
 *   2. `mapDraftGraphPipelineReason` produces a BYTE-IDENTICAL wire
 *      `reason`/`retryable` for all three, so the rename is invisible to
 *      any existing wire consumer.
 *
 * The per-site "which guard emits which code" pins live with their
 * harnesses:
 *   - cost guard        → tests/unit/cee.unified-pipeline.stage-1.test.ts
 *   - request budget    → tests/unit/cee.unified-pipeline.orchestrator.test.ts
 *   - daily token budget→ tests/integration/orchestrator/route-daily-budget-code.test.ts
 */

const RATE_LIMIT_FAMILY = [
  "CEE_RATE_LIMIT",
  "CEE_COST_CAP",
  "CEE_BUDGET_EXCEEDED",
] as const;

describe("CEE 429-family error-code taxonomy", () => {
  // ── 1. Contract enum is additive ────────────────────────────────────────

  it("openapi CEEErrorCode enum carries all three 429-family codes", () => {
    const spec = parseYaml(
      readFileSync(resolve(process.cwd(), "openapi.yaml"), "utf8"),
    );
    const enumValues: string[] =
      spec.components.schemas.CEEErrorCode.enum;

    // Derived from the spec itself, not a hand-maintained mirror.
    expect(Array.isArray(enumValues)).toBe(true);
    for (const code of RATE_LIMIT_FAMILY) {
      expect(enumValues).toContain(code);
    }
  });

  it("the three 429-family codes are pairwise distinct", () => {
    expect(new Set(RATE_LIMIT_FAMILY).size).toBe(RATE_LIMIT_FAMILY.length);
  });

  // ── 2. Wire behaviour is preserved ──────────────────────────────────────

  it(
    "mapDraftGraphPipelineReason yields an identical wire reason for all three codes",
    { timeout: 30_000 },
    async () => {
      const { mapDraftGraphPipelineReason } = await import(
        "../../src/orchestrator/route-v2.js"
      );

      // The pre-rename wire contract, spelled out literally so a future
      // edit to the shared case arm cannot silently redefine it.
      const baseline = mapDraftGraphPipelineReason(429, "CEE_RATE_LIMIT");
      expect(baseline).toEqual({
        reason: "draft_graph_cee_rate_limit",
        retryable: true,
      });

      for (const code of RATE_LIMIT_FAMILY) {
        expect(mapDraftGraphPipelineReason(429, code)).toEqual(baseline);
      }
    },
  );

  it(
    "the new codes do NOT fall through to the unknown-code default",
    { timeout: 30_000 },
    async () => {
      const { mapDraftGraphPipelineReason } = await import(
        "../../src/orchestrator/route-v2.js"
      );

      // POSITIVE CONTROL — prove the default branch is reachable and that
      // this assertion can actually see a fall-through. Without this, the
      // `not.toBe` assertions below could pass by testing nothing.
      expect(
        mapDraftGraphPipelineReason(429, "CEE_DEFINITELY_NOT_A_REAL_CODE")
          .reason,
      ).toBe("draft_graph_pipeline_status_429");

      for (const code of ["CEE_COST_CAP", "CEE_BUDGET_EXCEEDED"]) {
        expect(mapDraftGraphPipelineReason(429, code).reason).not.toBe(
          "draft_graph_pipeline_status_429",
        );
      }
    },
  );
});
