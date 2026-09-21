/**
 * OPTIONS_IDENTICAL ↔ AUTO-RETRY TRIGGER AGREEMENT, at the real bytes.
 *
 * THE DEFECT (canonical-ready-rate-2026-08-20, frozen deployed build
 * UI 2b6ec553 · CEE 19a60fd · PLoT fb63b03 · ISL 28fe0c9). Brief
 * `09-nested-subdecision` returned HTTP 500 with no model at all on 2 of 4
 * draws — `violation_code: OPTIONS_IDENTICAL`, `identical_option_ids`
 * ["c1148bbb","dfeedc48"] (r3) / ["7cb3711f","dfeedc48"] (r4) — while
 * drafting cleanly on the other 2. Same brief, same build, both outcomes:
 * the class is stochastic, and the bypass's own copy already tells the user
 * "this often clears on a retry".
 *
 * The server did not spend that retry. `decideEnforcementAutoRetry`'s trigger
 * was `isEnforcementBlockedResult` alone — 422 + `last_phase =
 * "deterministic_enforcement"` — and the bypass fails fast at substep 1.5
 * with a 400 carrying `violation_code` and no `last_phase`, so the classifier
 * never matched and the seam was never entered. At 27.0s / 31.0s elapsed the
 * affordable window was 83s / 79s against a 55s floor: funded, and unspent.
 *
 * WHAT THIS SPEC PINS. The trigger claims to recognise the bypass's own
 * emission. A fixture written by the retry lane cannot prove that (trap 16: a
 * self-authored fixture encodes the author's model of the producer, not the
 * producer). So the chain here is REAL end to end — the real `validateGraph`
 * raises the violation, the deterministic sweep's own mapping carries it, the
 * real `runOptionsIdenticalBypass` builds the body through the real
 * `buildCeeErrorResponse` — and the trigger is asserted against what that
 * chain ACTUALLY produced.
 *
 * CONTRAST CONTROL (trap 13e): the same probe on options with DISTINCT
 * interventions must raise no violation, fire no gate, and classify as null —
 * proving the trigger discriminates rather than agreeing with everything.
 *
 * PRECONDITION PINNED IN-TEST (trap 13b): the graceful dedup must DECLINE on
 * this fixture (guard 3b — the labels differ, so dropping one would delete an
 * option the user named). If it ever starts resolving the collision instead,
 * the bypass never fires and every assertion below would pass vacuously, so
 * the firing is asserted directly rather than assumed.
 *
 * RED at pristine 19a60fd0: `isOptionsIdenticalBypassResult` and
 * `classifyRetryableDraftFailure` do not exist, and `decideDraftAutoRetry`
 * does not exist (its predecessor refuses this class as
 * `not_enforcement_blocked`).
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

import { validateGraph } from "../../src/validators/graph-validator.js";
import {
  runOptionsIdenticalBypass,
  isOptionsIdenticalBypassResult,
  OPTIONS_IDENTICAL_BLOCK_STATUS_CODE,
  OPTIONS_IDENTICAL_BLOCK_ERROR_CODE,
  OPTIONS_IDENTICAL_VIOLATION_CODE,
} from "../../src/cee/unified-pipeline/stages/repair/options-identical-bypass.js";
import {
  classifyRetryableDraftFailure,
  decideDraftAutoRetry,
  applyRetryExhaustedCopy,
} from "../../src/cee/unified-pipeline/draft-auto-retry.js";
import {
  isEnforcementBlockedResult,
  ENFORCEMENT_BLOCK_STATUS_CODE,
  ENFORCEMENT_BLOCK_ERROR_CODE,
  ENFORCEMENT_BLOCK_LAST_PHASE,
} from "../../src/cee/unified-pipeline/stages/repair/graph-enforcement.js";
import { buildCeeErrorResponse } from "../../src/cee/validation/pipeline.js";
import {
  getDraftLlmRetryBudgetMs,
  MIN_DRAFT_RETRY_BUDGET_MS,
} from "../../src/config/timeouts.js";
import type { StageContext, PipelineOutcome } from "../../src/cee/unified-pipeline/types.js";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";

/** The two elapsed times WITNESSED on the failing draws, in ms. */
const WITNESSED_ELAPSED_MS = { r3: 27_000, r4: 31_000 } as const;

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
  } as unknown as PipelineOutcome;
}

/**
 * The witnessed SHAPE: a nested sub-decision whose leaf options are
 * LABEL-DISTINCT but whose intervention values the model collapsed onto one
 * signature. `identical: false` is the contrast control — same topology,
 * genuinely different values.
 */
function makeGraph(identical: boolean): GraphV1 {
  return {
    version: "1",
    default_seed: 42,
    nodes: [
      { id: "decision_1", kind: "decision", label: "Build our own fleet or partner?" },
      {
        id: "opt_electric",
        kind: "option",
        label: "Electric vans",
        data: { interventions: { fac_cost_per_delivery: 0.45 } },
      },
      {
        id: "opt_diesel",
        kind: "option",
        label: "Diesel vans",
        // The collision: distinct label, same number.
        data: { interventions: { fac_cost_per_delivery: identical ? 0.45 : 0.3 } },
      },
      {
        id: "fac_cost_per_delivery",
        kind: "factor",
        label: "Cost per delivery",
        category: "controllable",
        data: {
          value: 0.5,
          extractionType: "inferred",
          factor_type: "continuous",
          uncertainty_drivers: ["fuel price"],
        },
      },
      { id: "goal_cost", kind: "goal", label: "Cost per delivery below £7" },
    ],
    edges: [
      {
        from: "opt_electric",
        to: "fac_cost_per_delivery",
        strength_mean: 1,
        strength_std: 0.01,
        belief_exists: 1,
        effect_direction: "positive",
      },
      {
        from: "opt_diesel",
        to: "fac_cost_per_delivery",
        strength_mean: 1,
        strength_std: 0.01,
        belief_exists: 1,
        effect_direction: "positive",
      },
      {
        from: "fac_cost_per_delivery",
        to: "goal_cost",
        strength_mean: 0.6,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: "positive",
      },
    ],
  } as unknown as GraphV1;
}

/** The deterministic sweep's OWN step-9 mapping (deterministic-sweep.ts:2496)
 *  — validator issues → `ctx.remainingViolations`, `context` preserved.
 *  Restated here only because the sweep does not export it; the SHAPE is
 *  derived from the real validator's output, never hand-written. */
function toRemainingViolations(graph: GraphV1) {
  const result = validateGraph({
    graph: graph as never,
    requestId: "req-producer-agreement",
  });
  return result.errors.map((v) => ({
    code: v.code,
    path: v.path,
    message: v.message,
    ...((v as { context?: Record<string, unknown> }).context
      ? { context: (v as { context?: Record<string, unknown> }).context }
      : {}),
  }));
}

/** Drive the REAL chain and hand back what the gate actually emitted. */
function driveRealBypass(identical: boolean) {
  const graph = makeGraph(identical);
  const remainingViolations = toRemainingViolations(graph);
  const ctx = {
    requestId: "req-producer-agreement",
    pipelineOutcome: makeOutcome(),
    graph,
    remainingViolations,
  } as unknown as StageContext;
  const fired = runOptionsIdenticalBypass(ctx);
  return { fired, ctx, remainingViolations };
}

describe("the REAL validator raises OPTIONS_IDENTICAL on the witnessed shape", () => {
  it("raises it for label-distinct options with one collapsed signature", () => {
    const codes = toRemainingViolations(makeGraph(true)).map((v) => v.code);
    expect(codes).toContain(OPTIONS_IDENTICAL_VIOLATION_CODE);
  });

  it("CONTRAST CONTROL — does NOT raise it once the values differ", () => {
    const codes = toRemainingViolations(makeGraph(false)).map((v) => v.code);
    expect(codes).not.toContain(OPTIONS_IDENTICAL_VIOLATION_CODE);
  });
});

describe("isOptionsIdenticalBypassResult — the trigger recognises the gate's OWN emission", () => {
  it("fires the gate and recognises what it produced", () => {
    const { fired, ctx } = driveRealBypass(true);

    // PRECONDITION, pinned rather than assumed: the graceful dedup declined
    // (guard 3b, labels differ) and the gate genuinely fired. Without this,
    // every assertion below could pass on an unfired gate.
    expect(fired).toBe(true);
    expect(ctx.earlyReturn).toBeDefined();

    const emitted = ctx.earlyReturn!;
    expect(emitted.statusCode).toBe(OPTIONS_IDENTICAL_BLOCK_STATUS_CODE);
    const body = emitted.body as Record<string, any>;
    expect(body.code).toBe(OPTIONS_IDENTICAL_BLOCK_ERROR_CODE);
    expect(body.retryable).toBe(true);
    expect(body.details.violation_code).toBe(OPTIONS_IDENTICAL_VIOLATION_CODE);

    // The load-bearing claim.
    expect(isOptionsIdenticalBypassResult(emitted)).toBe(true);
    expect(classifyRetryableDraftFailure(emitted as never)).toBe("options_identical");
  });

  it("CONTRAST CONTROL — no gate, no classification, on distinct options", () => {
    const { fired, ctx } = driveRealBypass(false);
    expect(fired).toBe(false);
    expect(ctx.earlyReturn).toBeUndefined();
  });

  it.each([
    ["a different status code", { statusCode: 422 }],
    ["a different error code", { code: "CEE_LLM_VALIDATION_FAILED" }],
    ["producer-declared retryable: false", { retryable: false }],
    ["a different violation_code", { violation_code: "NO_EFFECT_PATH" }],
  ])("rejects %s", (_name, mutation: Record<string, unknown>) => {
    const { ctx } = driveRealBypass(true);
    const emitted = ctx.earlyReturn!;
    const body = { ...(emitted.body as Record<string, unknown>) };
    const details = { ...(body.details as Record<string, unknown>) };
    if ("violation_code" in mutation) details.violation_code = mutation.violation_code;
    if ("code" in mutation) body.code = mutation.code;
    if ("retryable" in mutation) body.retryable = mutation.retryable;
    body.details = details;
    const mutated = {
      statusCode: (mutation.statusCode as number) ?? emitted.statusCode,
      body,
    };
    expect(isOptionsIdenticalBypassResult(mutated)).toBe(false);
  });

  it.each([
    ["an undefined result", undefined],
    ["a null body", { statusCode: 400, body: null }],
    ["a bodiless 400", { statusCode: 400, body: {} }],
  ])("rejects %s", (_name, result) => {
    expect(isOptionsIdenticalBypassResult(result as never)).toBe(false);
  });
});

describe("the two retryable classes are MUTUALLY EXCLUSIVE", () => {
  /** The post-enforcement gate's own envelope, built by the REAL builder with
   *  the REAL shared constants. */
  function enforcementBlocked() {
    const body = buildCeeErrorResponse(ENFORCEMENT_BLOCK_ERROR_CODE as never, "post-enforcement", {
      requestId: "req-producer-agreement",
      retryable: true,
      details: { validation_error_codes: ["NO_PATH_TO_GOAL"], last_phase: ENFORCEMENT_BLOCK_LAST_PHASE },
    });
    return { statusCode: ENFORCEMENT_BLOCK_STATUS_CODE, body: body as unknown };
  }

  it("neither producer's emission satisfies the other's signature", () => {
    const optionsIdentical = driveRealBypass(true).ctx.earlyReturn!;
    const enforcement = enforcementBlocked();

    expect(isOptionsIdenticalBypassResult(optionsIdentical)).toBe(true);
    expect(isEnforcementBlockedResult(optionsIdentical)).toBe(false);

    expect(isEnforcementBlockedResult(enforcement)).toBe(true);
    expect(isOptionsIdenticalBypassResult(enforcement)).toBe(false);

    // So classification cannot depend on the order the classifier tests them.
    expect(classifyRetryableDraftFailure(optionsIdentical as never)).toBe("options_identical");
    expect(classifyRetryableDraftFailure(enforcement as never)).toBe("post_enforcement");
  });
});

describe("decideDraftAutoRetry funds the retry at the WITNESSED failure latencies", () => {
  it.each(Object.entries(WITNESSED_ELAPSED_MS))(
    "funds a fresh draft at the %s draw's elapsed time",
    (_draw, elapsedMs) => {
      const emitted = driveRealBypass(true).ctx.earlyReturn!;
      const d = decideDraftAutoRetry(emitted as never, elapsedMs);
      expect(d.retry).toBe(true);
      if (d.retry) {
        expect(d.retryClass).toBe("options_identical");
        // Derived from the real primitives, never a re-encoded number.
        expect(d.retryBudgetMs).toBe(getDraftLlmRetryBudgetMs(elapsedMs));
        expect(d.retryBudgetMs).toBeGreaterThanOrEqual(MIN_DRAFT_RETRY_BUDGET_MS);
      }
    },
  );

  it("still refuses once the remaining window cannot fund a healthy draft", () => {
    const emitted = driveRealBypass(true).ctx.earlyReturn!;
    let boundary = 0;
    while (getDraftLlmRetryBudgetMs(boundary + 1_000) >= MIN_DRAFT_RETRY_BUDGET_MS) boundary += 1_000;
    while (getDraftLlmRetryBudgetMs(boundary + 1) >= MIN_DRAFT_RETRY_BUDGET_MS) boundary += 1;
    expect(decideDraftAutoRetry(emitted as never, boundary).retry).toBe(true);
    const past = decideDraftAutoRetry(emitted as never, boundary + 1);
    expect(past.retry).toBe(false);
    if (!past.retry) expect(past.reason).toBe("budget_unaffordable");
  });
});

describe("the exhausted copy describes THIS defect, and preserves the diagnostics", () => {
  it("replaces the now-stale 'clears on a retry' lead and keeps every diagnostic field", () => {
    const emitted = driveRealBypass(true).ctx.earlyReturn!;
    const before = JSON.stringify(emitted.body);
    const originalDetails = (emitted.body as Record<string, any>).details;

    const adjusted = applyRetryExhaustedCopy(emitted as never, "options_identical");
    const body = adjusted.body as Record<string, any>;

    // Unchanged mechanics: still the same typed failure, still retryable.
    expect(adjusted.statusCode).toBe(OPTIONS_IDENTICAL_BLOCK_STATUS_CODE);
    expect(body.code).toBe(OPTIONS_IDENTICAL_BLOCK_ERROR_CODE);
    expect(body.retryable).toBe(true);

    // Every OPTIONS_IDENTICAL diagnostic survives byte-for-byte.
    expect(body.details.violation_code).toBe(originalDetails.violation_code);
    expect(body.details.identical_option_ids).toEqual(originalDetails.identical_option_ids);
    expect(body.details.intervention_signature).toBe(originalDetails.intervention_signature);
    expect(body.details.repair_skip_reason).toBe(originalDetails.repair_skip_reason);

    // The wire-visible retry disclosure.
    expect(body.details.auto_retry).toEqual({ attempted: true, attempts: 2 });

    // Honest copy: retry demoted from the lead, the spent attempt disclosed,
    // and the real user lever promoted.
    const recovery = JSON.stringify(body.recovery).toLowerCase();
    expect(recovery).not.toContain("this often clears on a retry");
    expect(recovery).not.toContain("often produces distinct options");
    expect(recovery).toMatch(/second draft|automatically/);
    expect(recovery).toContain("what separates");

    // It must NOT borrow the post-enforcement class's copy, which describes a
    // topology failure this class did not have.
    expect(recovery).not.toContain("unconnected to your goal");

    // The pinned flat mirror agrees with the nested sentence.
    expect(body.recovery_suggestion).toBe(body.recovery.suggestion);

    // Pure transform: the input result was not mutated.
    expect(JSON.stringify(emitted.body)).toBe(before);
  });
});
