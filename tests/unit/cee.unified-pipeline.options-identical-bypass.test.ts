/**
 * Tests for the pre-LLM-repair OPTIONS_IDENTICAL bypass gate.
 *
 * Covers:
 * - The gate fires only when an OPTIONS_IDENTICAL violation is present.
 * - It sets ctx.earlyReturn with HTTP 400 CEE_GRAPH_INVALID.
 * - The wire body carries identical_option_ids + intervention_signature in
 *   details for diagnostics (audit-friendly).
 * - The recovery payload has the user-facing clarification copy.
 * - It records a warning on pipelineOutcome.
 * - It does NOT fire on other Bucket C violations (regression — other Bucket
 *   C codes must still route through LLM repair).
 * - It does NOT fire when remainingViolations is empty or undefined.
 *
 * The pipeline-level + route-level integration tests in sibling files cover
 * the broader chain (no LLM repair adapter invoked, no graph persisted,
 * regression briefs still pass).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/utils/telemetry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/utils/telemetry.js")>();
  return {
    ...original,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emit: vi.fn(),
  };
});

import {
  runOptionsIdenticalBypass,
} from "../../src/cee/unified-pipeline/stages/repair/options-identical-bypass.js";
import type { StageContext, PipelineOutcome } from "../../src/cee/unified-pipeline/types.js";

function makeOutcome(): PipelineOutcome {
  return {
    graph_drafted: false,
    graph_structurally_valid: false,
    deterministic_sweep_violations: 0,
    verification_status: "pass",
    validation_status: "pass",
    enrichment_status: "complete",
    coaching_status: "complete",
    warnings: [],
    llm_repair: { applied: false, cost: 0, duration_ms: 0 },
    repair_provenance: [],
  } as PipelineOutcome;
}

function makeCtx(
  overrides: Partial<StageContext> = {},
): StageContext {
  return {
    requestId: "req-test",
    pipelineOutcome: makeOutcome(),
    remainingViolations: undefined,
    ...overrides,
  } as StageContext;
}

describe("runOptionsIdenticalBypass", () => {
  it("fires when remainingViolations contains OPTIONS_IDENTICAL → sets earlyReturn (400 CEE_GRAPH_INVALID)", () => {
    const ctx = makeCtx({
      remainingViolations: [
        {
          code: "OPTIONS_IDENTICAL",
          path: "nodes",
          message: "Options have identical intervention signatures: opt_a, opt_b",
          context: { optionIds: ["opt_a", "opt_b"], signature: "fac_x:1.0000" },
        },
      ],
    });

    const fired = runOptionsIdenticalBypass(ctx);

    expect(fired).toBe(true);
    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn?.statusCode).toBe(400);
    const body = ctx.earlyReturn?.body as Record<string, unknown>;
    expect(body.code).toBe("CEE_GRAPH_INVALID");
    expect(body.reason).toBe("options_identical_unrepairable_by_llm");
  });

  it("surfaces identical_option_ids and intervention_signature on details for dashboards", () => {
    const ctx = makeCtx({
      remainingViolations: [
        {
          code: "OPTIONS_IDENTICAL",
          context: { optionIds: ["opt_49", "opt_99", "opt_status_quo"], signature: "fac_price:0.5000" },
        },
      ],
    });

    runOptionsIdenticalBypass(ctx);

    const body = ctx.earlyReturn?.body as Record<string, unknown>;
    const details = body.details as Record<string, unknown>;
    expect(details.violation_code).toBe("OPTIONS_IDENTICAL");
    expect(details.identical_option_ids).toEqual(["opt_49", "opt_99", "opt_status_quo"]);
    expect(details.intervention_signature).toBe("fac_price:0.5000");
    expect(details.repair_skip_reason).toBe("options_identical_unrepairable_by_llm");
  });

  it("attaches user-facing recovery payload that is DOMAIN-NEUTRAL and retryable", () => {
    // CHANGED 2026-07-24 (draft-honesty lane). This test previously asserted
    // `expect(recovery.suggestion).toMatch(/£49|£99|£199/)` — it PINNED a
    // hardcoded pricing script into copy that fires on every OPTIONS_IDENTICAL,
    // whatever the decision is about. The live probe
    // (STARTER-BRIEF-VALIDATION-2026-07-24, reqs 25f0c95f / a7c24c91) served
    // that pricing script on a BUILD-VS-BUY brief. Recovery copy naming the
    // wrong domain is worse than none — it instructs the user to do something
    // irrelevant. The test now pins the OPPOSITE: no domain script may appear.
    const ctx = makeCtx({
      remainingViolations: [
        { code: "OPTIONS_IDENTICAL", context: { optionIds: ["opt_a", "opt_b"] } },
      ],
    });

    runOptionsIdenticalBypass(ctx);

    const body = ctx.earlyReturn?.body as Record<string, unknown>;
    const recovery = body.recovery as { suggestion?: string; hints?: string[] };

    // POSITIVE CONTROL: there IS copy to inspect, so the absence assertions
    // below are not vacuous.
    expect(typeof recovery.suggestion).toBe("string");
    expect(recovery.suggestion!.length).toBeGreaterThan(20);
    expect(Array.isArray(recovery.hints)).toBe(true);
    expect(recovery.hints!.length).toBeGreaterThan(0);

    const copy = [recovery.suggestion, ...recovery.hints!].join(" ");
    // No currency figures, no per-month price ladder, no assertion about what
    // KIND of decision the user is making.
    expect(copy).not.toMatch(/£|\$|€|\/month/);
    expect(copy.toLowerCase()).not.toContain("pricing decision");
    expect(copy.toLowerCase()).not.toContain("give a price");

    // The real user lever survives, stated neutrally.
    expect(copy.toLowerCase()).toContain("unique value");
    // Retry is offered: the same brief drafts cleanly on other attempts, so a
    // hard dead end (retryable defaults to false on omission) was dishonest.
    expect(body.retryable).toBe(true);
    expect(String(recovery.hints![0]).toLowerCase()).toContain("retry");
  });

  it("records a non-degraded warning on pipelineOutcome (hard fail, no partial graph)", () => {
    const ctx = makeCtx({
      remainingViolations: [
        { code: "OPTIONS_IDENTICAL", context: { optionIds: ["opt_a", "opt_b"] } },
      ],
    });

    runOptionsIdenticalBypass(ctx);

    expect(ctx.pipelineOutcome.warnings).toHaveLength(1);
    const warn = ctx.pipelineOutcome.warnings[0];
    expect(warn.stage).toBe("repair");
    expect(warn.error).toContain("OPTIONS_IDENTICAL");
    expect(warn.degraded).toBe(false);
  });

  it("does NOT fire on other Bucket C codes (NO_PATH_TO_GOAL still routes through LLM repair)", () => {
    const ctx = makeCtx({
      remainingViolations: [
        { code: "NO_PATH_TO_GOAL", path: "nodes[opt_a]" },
        { code: "NO_EFFECT_PATH", path: "nodes[opt_b]" },
      ],
    });

    const fired = runOptionsIdenticalBypass(ctx);

    expect(fired).toBe(false);
    expect(ctx.earlyReturn).toBeUndefined();
    expect(ctx.pipelineOutcome.warnings).toHaveLength(0);
  });

  it("does NOT fire when remainingViolations is empty", () => {
    const ctx = makeCtx({ remainingViolations: [] });
    expect(runOptionsIdenticalBypass(ctx)).toBe(false);
    expect(ctx.earlyReturn).toBeUndefined();
  });

  it("does NOT fire when remainingViolations is undefined (no sweep run)", () => {
    const ctx = makeCtx({ remainingViolations: undefined });
    expect(runOptionsIdenticalBypass(ctx)).toBe(false);
    expect(ctx.earlyReturn).toBeUndefined();
  });

  it("handles missing violation.context (validator omits it) — still bypasses with empty option list", () => {
    const ctx = makeCtx({
      remainingViolations: [{ code: "OPTIONS_IDENTICAL" }],
    });

    const fired = runOptionsIdenticalBypass(ctx);

    expect(fired).toBe(true);
    const body = ctx.earlyReturn?.body as Record<string, unknown>;
    const details = body.details as Record<string, unknown>;
    expect(details.violation_code).toBe("OPTIONS_IDENTICAL");
    expect(details.identical_option_ids).toEqual([]);
    expect(details.intervention_signature).toBeUndefined();
  });

  it("filters non-string entries from context.optionIds (defensive)", () => {
    const ctx = makeCtx({
      remainingViolations: [
        {
          code: "OPTIONS_IDENTICAL",
          context: { optionIds: ["opt_a", 42, null, "opt_b"] as unknown as string[] },
        },
      ],
    });

    runOptionsIdenticalBypass(ctx);

    const body = ctx.earlyReturn?.body as Record<string, unknown>;
    const details = body.details as Record<string, unknown>;
    expect(details.identical_option_ids).toEqual(["opt_a", "opt_b"]);
  });
});
