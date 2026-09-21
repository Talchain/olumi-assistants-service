/**
 * ROADMAP 2.1086 — ONE bounded server-side auto-retry when post-enforcement
 * draft validation fails.
 *
 * EVIDENCE (BASELINE.md, deployed CEE a9022e7, 2026-08-12): 5/15 first-attempt
 * drafting failures, ALL `CEE_GRAPH_INVALID` at
 * `last_phase="deterministic_enforcement"`; the gate itself declares
 * `retryable: true` ("stochastic model topology"); failures complete in
 * 17.2–28.3s while successes take 40–81s; a same-brief retry recovered 3/5.
 * The server is better placed than the user to spend that retry: at the
 * observed failure latencies the remaining request budget affords a full
 * fresh attempt (110_000 − 28_300 = 81_700 ms ≥ MIN_DRAFT_RETRY_BUDGET_MS).
 *
 * CONTRACT UNDER TEST (the wrapper in src/cee/unified-pipeline/index.ts):
 *  1. retry EXACTLY ONCE — never zero, never two;
 *  2. trigger = the producer's OWN emitted signature (422 + code +
 *     retryable:true + details.last_phase), never a hand-list of validator
 *     codes — any blocking code the post-enforcement validator emits rides
 *     the same envelope and therefore the same trigger;
 *  3. byte-identical brief/config on the retry;
 *  4. the retry's budgets measure elapsed from the ORIGINAL request start
 *     (requestStartMs pinned across attempts);
 *  5. telemetry attempt=2 on the retry launch;
 *  6. post-retry failure keeps honest copy — "usually succeeds" is stale
 *     after two consecutive identical failures and must not survive;
 *  7. an unaffordable window (elapsed past the derived cut-off) skips the
 *     retry loudly;
 *  8. thrown pipeline errors and non-enforcement failures are NEVER retried.
 *
 * RED-first at pristine 335a9380: tests 1, 2, 4(skip-telemetry) fail because
 * no retry exists (parse runs once, no attempt=2 telemetry, no exhausted
 * copy). Tests 3 and 5 are the opposite-direction twins (trap 22b): green at
 * pristine, they exist to RED the widen-retry-class mutants.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all stage modules before importing the orchestrator (same seam as
// tests/unit/cee.unified-pipeline.orchestrator.test.ts).
vi.mock("../../src/cee/unified-pipeline/stages/parse.js", () => ({
  runStageParse: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/normalise.js", () => ({
  runStageNormalise: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/enrich.js", () => ({
  runStageEnrich: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/index.js", () => ({
  runStageRepair: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/package.js", () => ({
  runStagePackage: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/boundary.js", () => ({
  runStageBoundary: vi.fn(),
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      pipelineCheckpointsEnabled: false,
    },
    features: {
      diagnosticTraceEnabled: false,
    },
  },
}));

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

vi.mock("../../src/cee/corrections.js", () => ({
  createCorrectionCollector: () => ({
    add: vi.fn(),
    addByStage: vi.fn(),
    getCorrections: () => [],
    getSummary: () => ({ total: 0, by_layer: {}, by_type: {} }),
    hasCorrections: () => false,
    count: () => 0,
  }),
}));

vi.mock("../../src/utils/request-id.js", () => ({
  getRequestId: () => "test-request-id",
  generateRequestId: () => "test-plan-id-0000-0000-000000000000",
}));

import { runUnifiedPipeline } from "../../src/cee/unified-pipeline/index.js";
import { runStageParse } from "../../src/cee/unified-pipeline/stages/parse.js";
import { runStageRepair } from "../../src/cee/unified-pipeline/stages/repair/index.js";
import { runStageBoundary } from "../../src/cee/unified-pipeline/stages/boundary.js";
// REAL envelope builder — the fixture body below must be the shape the
// producer actually emits, not a hand-invented one. The literal signature
// values (code / last_phase) are additionally pinned producer-side by
// tests/unit/cee.enforcement-auto-retry-producer-agreement.test.ts, which
// drives the REAL enforcement gate and asserts the trigger recognises its
// output — so if the producer's signature ever moves, that spec REDs even
// though this one uses literals.
import { buildCeeErrorResponse } from "../../src/cee/validation/pipeline.js";
import { log } from "../../src/utils/telemetry.js";
import { LLMTimeoutError } from "../../src/adapters/llm/errors.js";

const mockRequest = {
  id: "test",
  headers: {},
  query: {},
  raw: { destroyed: false },
} as any;

const baseInput = {
  brief: "Should we buy or lease the delivery van for the new region?",
  currencyInstruction: "Use GBP.",
};

const baseOpts = {
  schemaVersion: "v3" as const,
};

/** The post-enforcement fail-closed body EXACTLY as graph-enforcement.ts
 *  builds it (same builder, same option fields, same details keys). */
function enforcementBlockedBody() {
  return buildCeeErrorResponse(
    "CEE_GRAPH_INVALID",
    "Graph failed post-enforcement validation (2 topology error(s))",
    {
      requestId: "test-request-id",
      retryable: true,
      recovery: {
        suggestion:
          "Part of the drafted decision model was left unconnected to your goal, so it was rejected instead of being shown to you — this is usually transient. Try again.",
        hints: [
          "Retrying the same brief usually succeeds",
          "If it keeps happening, state the outcome you are optimising for explicitly",
          "Naming how each consideration affects that outcome helps the model connect them",
        ],
      },
      details: {
        validation_error_codes: ["NO_PATH_TO_GOAL", "MISSING_BRIDGE"],
        enforcement_repairs: 0,
        last_phase: "deterministic_enforcement",
      },
    },
  );
}

/** Stage-mock wiring: repair blocks with the enforcement signature for the
 *  first `blockedAttempts` calls, then succeeds; boundary produces a 200. */
function wirePipeline(blockedAttempts: number) {
  let repairCalls = 0;
  (runStageParse as any).mockImplementation(async (ctx: any) => {
    ctx.graph = { nodes: [], edges: [], version: "1.2" };
  });
  (runStageRepair as any).mockImplementation(async (ctx: any) => {
    repairCalls += 1;
    if (repairCalls <= blockedAttempts) {
      ctx.earlyReturn = { statusCode: 422, body: enforcementBlockedBody() };
    }
  });
  (runStageBoundary as any).mockImplementation(async (ctx: any) => {
    ctx.finalResponse = { graph: { nodes: [], edges: [] }, ok: true };
  });
}

describe("2.1086 — bounded auto-retry on post-enforcement draft validation failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries EXACTLY ONCE when both attempts block, and the terminal 422 carries the honest exhausted copy", async () => {
    wirePipeline(Infinity); // every attempt blocks

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: Date.now() - 20_000, // inside the affordable window
    });

    // EXACTLY ONCE: two pipeline attempts, never one, never three.
    expect(runStageParse, "one bounded retry = exactly 2 pipeline attempts").toHaveBeenCalledTimes(2);
    expect(result.statusCode).toBe(422);

    const body = result.body as Record<string, any>;
    expect(body.code).toBe("CEE_GRAPH_INVALID");
    // The producer's retryability declaration survives — a manual retry is
    // still mechanically possible and sometimes recovers (BASELINE: failure
    // is brief-conditional, not brief-caused).
    expect(body.retryable).toBe(true);
    // Diagnosability: the wire-visible details must say the server already
    // spent the retry.
    expect(body.details.auto_retry).toEqual({ attempted: true, attempts: 2 });
    // The codes-only mirror must survive the copy adjustment untouched.
    expect(body.details.validation_error_codes).toEqual(["NO_PATH_TO_GOAL", "MISSING_BRIDGE"]);
    expect(body.details.last_phase).toBe("deterministic_enforcement");

    // HONEST COPY: after two consecutive identical failures, "usually
    // succeeds" is a stale claim (BASELINE re-adjudications: S3 0/3, M2 0/2)
    // and must not survive anywhere in the recovery block.
    const recoveryText = JSON.stringify(body.recovery).toLowerCase();
    expect(recoveryText, "post-retry copy must not claim retrying usually succeeds").not.toContain("usually succeeds");
    expect(recoveryText, "post-retry copy must not call the failure transient").not.toContain("usually transient");
    // …and it must disclose that a second attempt already happened.
    expect(recoveryText).toMatch(/second draft|tried.*automatically|automatically tried/);
  });

  it("returns the second attempt's success, pins the requestStartMs baseline, and sends byte-identical input", async () => {
    wirePipeline(1); // attempt 1 blocks, attempt 2 succeeds
    const pinnedStart = Date.now() - 15_000;

    const seenInputs: string[] = [];
    const seenStartMs: Array<number | undefined> = [];
    (runStageParse as any).mockImplementation(async (ctx: any) => {
      seenInputs.push(JSON.stringify(ctx.input));
      seenStartMs.push(ctx.opts.requestStartMs);
      ctx.graph = { nodes: [], edges: [], version: "1.2" };
    });

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: pinnedStart,
    });

    expect(runStageParse).toHaveBeenCalledTimes(2);
    expect(result.statusCode).toBe(200);
    expect((result.body as any).ok).toBe(true);

    // BYTE-IDENTICAL brief/config: the retry drafts from exactly the same
    // input bytes — same brief, same currency instruction, nothing appended.
    expect(seenInputs).toHaveLength(2);
    expect(seenInputs[1], "retry input must be byte-identical to attempt 1").toBe(seenInputs[0]);

    // BUDGET HONESTY: attempt 2 measures elapsed from the ORIGINAL request
    // start, so every window it derives already accounts for attempt 1's
    // spend (parse.ts F1 + Step-11 guard share this baseline).
    expect(seenStartMs).toEqual([pinnedStart, pinnedStart]);

    // TELEMETRY attempt=2: the retry launch is observable with its budget.
    const retryLaunch = (log.info as any).mock.calls.find(
      (c: any[]) => c[0] && typeof c[0] === "object" && c[0].attempt === 2,
    );
    expect(retryLaunch, "retry launch telemetry with attempt=2 must fire").toBeDefined();
    expect(retryLaunch[0].retry_budget_ms, "telemetry must carry the derived retry budget").toBeGreaterThan(0);
  });

  it.each([
    [
      "same code at a DIFFERENT phase (orchestrator_validation)",
      () =>
        buildCeeErrorResponse("CEE_GRAPH_INVALID", "Graph failed validation", {
          retryable: true,
          details: { validation_error_codes: ["NO_PATH_TO_GOAL"], last_phase: "orchestrator_validation" },
        }),
    ],
    [
      "right phase but producer says retryable: false",
      () =>
        buildCeeErrorResponse("CEE_GRAPH_INVALID", "Graph failed post-enforcement validation", {
          retryable: false,
          details: { validation_error_codes: ["NO_PATH_TO_GOAL"], last_phase: "deterministic_enforcement" },
        }),
    ],
    [
      "a DIFFERENT error code",
      () =>
        buildCeeErrorResponse("CEE_LLM_VALIDATION_FAILED", "Draft output invalid", {
          retryable: true,
          details: { last_phase: "deterministic_enforcement" },
        }),
    ],
  ])("never auto-retries %s", async (_name, makeBody) => {
    (runStageParse as any).mockImplementation(async (ctx: any) => {
      ctx.graph = { nodes: [], edges: [], version: "1.2" };
    });
    (runStageRepair as any).mockImplementation(async (ctx: any) => {
      ctx.earlyReturn = { statusCode: 422, body: makeBody() };
    });

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: Date.now() - 5_000,
    });

    expect(runStageParse, "non-enforcement failures must run exactly one attempt").toHaveBeenCalledTimes(1);
    expect(result.statusCode).toBe(422);
    // No exhausted-copy transform on a path that never retried.
    expect((result.body as Record<string, any>).details?.auto_retry).toBeUndefined();
  });

  it("skips the retry LOUDLY when the remaining window cannot fund a fresh draft", async () => {
    wirePipeline(Infinity);

    // Elapsed 60s ⇒ getDraftLlmRetryBudgetMs = 110_000 − 60_000 = 50_000
    // < MIN_DRAFT_RETRY_BUDGET_MS (55_000): unaffordable by derivation.
    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: Date.now() - 60_000,
    });

    expect(runStageParse, "an unaffordable retry must not launch").toHaveBeenCalledTimes(1);
    expect(result.statusCode).toBe(422);
    const body = result.body as Record<string, any>;

    // ⚠ UPDATED BY P0d — AND THE OLD ASSERTIONS ARE THE DEFECT, NOT A BASELINE.
    //
    // This block used to assert `auto_retry` was UNDEFINED here and that the
    // copy still CONTAINED "usually succeeds", under the comment "keeps the
    // ORIGINAL honest copy untouched". Both were wrong, and the spec was
    // pinning them:
    //  - "Retrying the same brief usually succeeds" is a rate measured on
    //    failures completing in 17.2–28.3s (BASELINE 3/5). This arm is reachable
    //    ONLY when elapsed is past the ~55s funding floor, i.e. on a population
    //    with no measured recovery rate at all. The sentence asserted a
    //    frequency we had not earned, on a failure path.
    //  - with the disclosure absent, "the server tried twice and both failed"
    //    and "the server never tried" were indistinguishable on the wire —
    //    the two cases whose honest next step differs most.
    // Under the no-hiding ruling the fix is to SAY SO, not to drop the surface.
    // Full reasoning + the opposite-direction twins:
    // tests/unit/cee.unified-pipeline.informed-retry.test.ts.
    expect(body.details.auto_retry).toEqual({
      attempted: false,
      attempts: 1,
      skipped_reason: "budget_unaffordable",
    });
    expect(
      JSON.stringify(body.recovery),
      "an unmeasured frequency claim must not ride the unfunded arm",
    ).not.toContain("usually succeeds");
    expect(
      JSON.stringify(body.recovery),
      "the user must be told no automatic retry was made",
    ).toContain("no time left to try again automatically");
    // The fail-closed verdict and its diagnostics are untouched by the copy fix.
    expect(body.code).toBe("CEE_GRAPH_INVALID");
    expect(body.retryable).toBe(true);
    expect(body.details.validation_error_codes).toEqual(["NO_PATH_TO_GOAL", "MISSING_BRIDGE"]);

    // The skip is telemetry-visible with the derived numbers.
    const skip = (log.warn as any).mock.calls.find(
      (c: any[]) => c[0] && typeof c[0] === "object" && c[0].auto_retry_skip_reason === "budget_unaffordable",
    );
    expect(skip, "budget-unaffordable skip telemetry must fire").toBeDefined();
    expect(skip[0].retry_budget_ms).toBeLessThan(skip[0].min_retry_budget_ms);
  });

  it("never auto-retries a THROWN pipeline error (the retry is bound to the typed enforcement result, not to failure in general)", async () => {
    (runStageParse as any).mockImplementation(async () => {
      throw new LLMTimeoutError("timeout", "model-x", 30000, 35000, "corr-1");
    });

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: Date.now() - 5_000,
    });

    expect(runStageParse).toHaveBeenCalledTimes(1);
    expect(result.statusCode).toBe(504);
  });
});

/**
 * THE SECOND RETRYABLE CLASS — the OPTIONS_IDENTICAL fail-fast bypass.
 *
 * Witnessed 2026-08-20 on the frozen deployed build (canonical-ready-rate):
 * brief `09-nested-subdecision` returned HTTP 500 with no model at all on 2 of
 * 4 draws and drafted cleanly on the other 2, at 27.0s / 31.0s elapsed — a
 * funded 83s / 79s window, unspent, because the trigger was scoped to the
 * post-enforcement 422's `last_phase`.
 *
 * The producer-side signature agreement (that the trigger recognises what the
 * real bypass actually emits, with a contrast control) is pinned separately in
 * tests/unit/cee.options-identical-auto-retry-producer-agreement.test.ts. This
 * block pins the WRAPPER behaviour: that the seam actually runs the second
 * attempt, and what the user ends up with.
 */
describe("bounded auto-retry on the OPTIONS_IDENTICAL fail-fast bypass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** The bypass's fail-fast body EXACTLY as options-identical-bypass.ts builds
   *  it — same builder, same top-level fields, same mutated `details` keys. */
  function optionsIdenticalBody() {
    const body = buildCeeErrorResponse(
      "CEE_GRAPH_INVALID",
      "Options need at least one distinct value to compare",
      {
        requestId: "test-request-id",
        reason: "options_identical_unrepairable_by_llm",
        retryable: true,
        recovery: {
          suggestion:
            "Your options came out looking identical, so there was nothing to compare — " +
            "this often clears on a retry. If it happens again, give each option at least " +
            "one value that differs from the others.",
          hints: ["Retrying the same brief often produces distinct options"],
        },
      },
    ) as Record<string, any>;
    body.details = {
      ...(body.details ?? {}),
      violation_code: "OPTIONS_IDENTICAL",
      // The witnessed ids from the r4 draw.
      identical_option_ids: ["7cb3711f", "dfeedc48"],
      intervention_signature: "8515fef",
      repair_skip_reason: "options_identical_unrepairable_by_llm",
    };
    return body;
  }

  /** Repair fails fast with the bypass signature for the first
   *  `blockedAttempts` calls, then succeeds. */
  function wireBypass(blockedAttempts: number) {
    let repairCalls = 0;
    (runStageParse as any).mockImplementation(async (ctx: any) => {
      ctx.graph = { nodes: [], edges: [], version: "1.2" };
    });
    (runStageRepair as any).mockImplementation(async (ctx: any) => {
      repairCalls += 1;
      if (repairCalls <= blockedAttempts) {
        ctx.earlyReturn = { statusCode: 400, body: optionsIdenticalBody() };
      }
    });
    (runStageBoundary as any).mockImplementation(async (ctx: any) => {
      ctx.finalResponse = { graph: { nodes: [], edges: [] }, ok: true };
    });
  }

  it("⭐ THE HEADLINE: a first-attempt collision now ends with the user holding a MODEL, not a 500", async () => {
    wireBypass(1); // attempt 1 collides, attempt 2 drafts cleanly

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: Date.now() - 27_000, // the witnessed r3 elapsed time
    });

    expect(runStageParse, "the collision must fund exactly one fresh draft").toHaveBeenCalledTimes(2);
    expect(result.statusCode).toBe(200);
    // No exhausted copy on a path that recovered.
    expect((result.body as Record<string, any>)?.details?.auto_retry).toBeUndefined();
  });

  it("retries EXACTLY ONCE when both attempts collide, and ships copy that describes THIS defect", async () => {
    wireBypass(Infinity);

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: Date.now() - 31_000, // the witnessed r4 elapsed time
    });

    expect(runStageParse, "one bounded retry = exactly 2 pipeline attempts").toHaveBeenCalledTimes(2);
    expect(result.statusCode).toBe(400);
    const body = result.body as Record<string, any>;

    // ⚠ THE VALIDATION STILL FIRES. The retry is a re-draft, never a
    // suppression: a second degenerate draft still fails closed, with the
    // diagnostics intact.
    expect(body.code).toBe("CEE_GRAPH_INVALID");
    expect(body.details.violation_code).toBe("OPTIONS_IDENTICAL");
    expect(body.details.identical_option_ids).toEqual(["7cb3711f", "dfeedc48"]);
    expect(body.details.repair_skip_reason).toBe("options_identical_unrepairable_by_llm");

    // The wire-visible retry disclosure.
    expect(body.details.auto_retry).toEqual({ attempted: true, attempts: 2 });

    // Honest copy: the "often clears on a retry" lead is stale once the
    // server has spent the retry.
    const recoveryText = JSON.stringify(body.recovery).toLowerCase();
    expect(recoveryText, "post-retry copy must not lead with 'clears on a retry'").not.toContain(
      "this often clears on a retry",
    );
    expect(recoveryText).toMatch(/second draft|automatically/);
    // And it must NOT borrow the post-enforcement class's copy, which
    // describes a topology failure this class did not have.
    expect(recoveryText, "must not describe the OTHER class's defect").not.toContain(
      "unconnected to your goal",
    );

    // Telemetry discriminates the class (the event NAME still says
    // "Enforcement" — filter on retry_class, not on the name).
    const retryLaunch = (log.info as any).mock.calls.find(
      (c: any[]) => c[0] && typeof c[0] === "object" && c[0].attempt === 2,
    );
    expect(retryLaunch, "retry launch telemetry must fire").toBeDefined();
    expect(retryLaunch[0].retry_class).toBe("options_identical");
  });

  it("CROSS-CLASS — when attempt 2 fails in the OTHER class, the copy describes THAT class", async () => {
    // The exhausted copy is keyed off the SECOND attempt's class, not the
    // first's. A re-draft that fixes the identical options can still fail
    // post-enforcement, and telling that user "your options came out with the
    // same values twice" would describe a defect the final draft did not have.
    (runStageParse as any).mockImplementation(async (ctx: any) => {
      ctx.graph = { nodes: [], edges: [], version: "1.2" };
    });
    let repairCalls = 0;
    (runStageRepair as any).mockImplementation(async (ctx: any) => {
      repairCalls += 1;
      ctx.earlyReturn =
        repairCalls === 1
          ? { statusCode: 400, body: optionsIdenticalBody() }
          : { statusCode: 422, body: enforcementBlockedBody() };
    });

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: Date.now() - 27_000,
    });

    expect(runStageParse).toHaveBeenCalledTimes(2);
    expect(result.statusCode, "the terminal failure is attempt 2's").toBe(422);
    const recoveryText = JSON.stringify((result.body as Record<string, any>).recovery).toLowerCase();
    expect(recoveryText, "copy must describe attempt 2's class").toContain("unconnected to your goal");
    expect(recoveryText, "copy must NOT describe attempt 1's class").not.toContain("what separates");

    // Telemetry keeps BOTH classes visible, so the transition is diagnosable.
    const exhausted = (log.warn as any).mock.calls.find(
      (c: any[]) => c[0] && typeof c[0] === "object" && c[0].retry_class !== undefined,
    );
    expect(exhausted[0].retry_class).toBe("post_enforcement");
    expect(exhausted[0].first_attempt_retry_class).toBe("options_identical");
  });

  it("OPPOSITE-DIRECTION TWIN — a 400 CEE_GRAPH_INVALID with NO violation_code is never retried", async () => {
    // trap 22b: widening the class to 'any retryable 400' would silently start
    // re-drafting unrelated typed refusals. This case must stay green.
    (runStageParse as any).mockImplementation(async (ctx: any) => {
      ctx.graph = { nodes: [], edges: [], version: "1.2" };
    });
    (runStageRepair as any).mockImplementation(async (ctx: any) => {
      ctx.earlyReturn = {
        statusCode: 400,
        body: buildCeeErrorResponse("CEE_GRAPH_INVALID", "Graph failed validation", {
          retryable: true,
          details: { validation_error_codes: ["NO_PATH_TO_GOAL"] },
        }),
      };
    });

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: Date.now() - 5_000,
    });

    expect(runStageParse, "a violation_code-less 400 must run exactly one attempt").toHaveBeenCalledTimes(1);
    expect(result.statusCode).toBe(400);
    expect((result.body as Record<string, any>).details?.auto_retry).toBeUndefined();
  });
});
