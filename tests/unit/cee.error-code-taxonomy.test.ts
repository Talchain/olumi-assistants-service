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

  // ── 2b. Producer-declared retryability is authoritative (ROADMAP 2.718) ──
  //
  // Witnessed on the wire 2026-08-06 (golden-journey runs 20260806T133133Z
  // -failed-draft-de79da and 20260806T142014Z-failed-draft-39cf53): the
  // post-enforcement gate emitted `CEE_GRAPH_INVALID` with `retryable: true`
  // and retry-first recovery copy ("this is usually transient. Try again"),
  // and the wire delivered `retryable: false` alongside that same copy —
  // because this mapper is a hand-maintained mirror of producer semantics
  // and its CEE_GRAPH_INVALID arm said "retrying reproduces", which is FALSE
  // for the stochastic-topology emitter (the same brief drafted cleanly in
  // the neighbouring fresh runs of the same hour).
  //
  // The rule under test: an EXPLICIT producer `retryable: true` (threaded
  // from the pipeline body as `producerRetryable`) may PROMOTE a mapped
  // false to true, and never demotes. `false`/absent never demotes a mapped
  // true, because `buildCeeErrorResponse` defaults `retryable` to false when
  // the emitter is silent — a false is indistinguishable from an omission.

  it(
    "CEE_GRAPH_INVALID honours an explicit producer retryable: true (the witnessed 2.718 wire defect)",
    { timeout: 30_000 },
    async () => {
      const { mapDraftGraphPipelineReason } = await import(
        "../../src/orchestrator/route-v2.js"
      );

      // The witnessed shape: enforcement gate 422, producer declared true.
      expect(
        mapDraftGraphPipelineReason(422, "CEE_GRAPH_INVALID", null, true),
      ).toEqual({
        reason: "draft_graph_cee_graph_invalid",
        retryable: true,
      });

      // Silent producer (no declaration threaded) keeps the mapped floor —
      // the legacy emitters that never set `retryable` are unchanged.
      expect(
        mapDraftGraphPipelineReason(400, "CEE_GRAPH_INVALID"),
      ).toEqual({
        reason: "draft_graph_cee_graph_invalid",
        retryable: false,
      });

      // An explicit producer FALSE is ambiguous (builder default) and does
      // not promote.
      expect(
        mapDraftGraphPipelineReason(400, "CEE_GRAPH_INVALID", null, false)
          .retryable,
      ).toBe(false);
    },
  );

  it(
    "producer retryable NEVER DEMOTES a mapped true (monotone in the retry direction)",
    { timeout: 30_000 },
    async () => {
      const { mapDraftGraphPipelineReason } = await import(
        "../../src/orchestrator/route-v2.js"
      );

      // CEE_TIMEOUT maps retryable: true; a producer body carrying the
      // builder-default false must not turn a transient timeout into a dead
      // end.
      expect(
        mapDraftGraphPipelineReason(504, "CEE_TIMEOUT", null, false).retryable,
      ).toBe(true);
    },
  );

  it(
    "the promotion rule is generic to the code (producer-authoritative), not a CEE_GRAPH_INVALID special case",
    { timeout: 30_000 },
    async () => {
      const { mapDraftGraphPipelineReason } = await import(
        "../../src/orchestrator/route-v2.js"
      );

      // CEE_VALIDATION_FAILED also maps false; an emitter that explicitly
      // declares retryable: true is believed there too. The authority is the
      // producer's declaration, not this file's per-code opinions.
      expect(
        mapDraftGraphPipelineReason(422, "CEE_VALIDATION_FAILED", null, true)
          .retryable,
      ).toBe(true);
      expect(
        mapDraftGraphPipelineReason(422, "CEE_VALIDATION_FAILED").retryable,
      ).toBe(false);
    },
  );

  // ── 3. Truncation sub-case is RETRYABLE (2026-07-23 firefight) ───────────

  it(
    "CEE_LLM_VALIDATION_FAILED is NOT retryable by default, but a max_tokens TRUNCATION reason flips it to retryable",
    { timeout: 30_000 },
    async () => {
      const { mapDraftGraphPipelineReason } = await import(
        "../../src/orchestrator/route-v2.js"
      );

      // Default (vague/nonsensical brief, schema mismatch): retrying the same
      // input reproduces it → NOT retryable.
      expect(mapDraftGraphPipelineReason(400, "CEE_LLM_VALIDATION_FAILED")).toEqual({
        reason: "draft_graph_cee_llm_validation_failed",
        retryable: false,
      });

      // Truncation (transient model over-generation): RETRY is the honest lever.
      expect(
        mapDraftGraphPipelineReason(400, "CEE_LLM_VALIDATION_FAILED", "llm_truncated_max_tokens"),
      ).toEqual({
        reason: "draft_graph_cee_llm_validation_failed",
        retryable: true,
      });

      // A different reason under the same code stays non-retryable (the flip is
      // scoped to the truncation reason, not to the code).
      expect(
        mapDraftGraphPipelineReason(400, "CEE_LLM_VALIDATION_FAILED", "llm_non_json").retryable,
      ).toBe(false);
    },
  );
});
