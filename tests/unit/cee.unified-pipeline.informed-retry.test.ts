/**
 * P0d — THE RETRY CARRIES INFORMATION, AND THE UNFUNDED CASE STOPS LYING.
 *
 * TWO defects, both on the "brief → a draft appears" journey link, both in the
 * bounded auto-retry seam (`unified-pipeline/index.ts` + `draft-auto-retry.ts`):
 *
 * 1. THE RETRY IS UNINFORMED. `runUnifiedPipeline` re-drafts with byte-identical
 *    input: no prompt change, no error feedback. The enforcement gate's own
 *    `revalidation.errors` already names what was wrong, is serialised into
 *    `details`, and is DISCARDED. Two identical samples from a distribution that
 *    mostly disconnects will mostly disconnect twice — 40–80 seconds spent
 *    reproducing the failure.
 *
 * 2. THE UNFUNDED RETRY SHIPS A FALSE CLAIM. The retry is funded only when
 *    `getDraftLlmRetryBudgetMs(elapsed) >= MIN_DRAFT_RETRY_BUDGET_MS`, i.e. only
 *    when attempt 1 finished fast. A SLOW enforcement failure silently gets no
 *    retry at all — while the single-attempt copy still tells the user
 *    "Retrying the same brief usually succeeds". That frequency claim is
 *    inherited from a population this user is not in (BASELINE: 3/5 recovered,
 *    measured on failures completing in 17.2–28.3s), and the user cannot tell
 *    "the server tried and failed twice" from "the server never tried".
 *
 * RED-first at pristine 85c677c5:
 *   - the directive block REDs on every case (no builder, no thread, no opt);
 *   - the unfunded-copy block REDs on the disclosure + frequency-claim cases.
 * The opposite-direction twins (a funded retry must NOT claim it was unfunded;
 * a healthy success must carry no directive) are GREEN at pristine by
 * construction and exist to RED the widen-the-predicate mutants (trap 22b).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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
    cee: { pipelineCheckpointsEnabled: false },
    features: { diagnosticTraceEnabled: false },
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
import { buildCeeErrorResponse } from "../../src/cee/validation/pipeline.js";
import { buildPriorAttemptDirective } from "../../src/cee/unified-pipeline/retry-directive.js";
import {
  ENFORCEMENT_RETRY_EXHAUSTED_SUGGESTION,
  RETRY_UNAFFORDABLE_SUGGESTION,
} from "../../src/cee/unified-pipeline/draft-auto-retry.js";

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

const baseOpts = { schemaVersion: "v3" as const };

/**
 * The post-enforcement fail-closed body EXACTLY as graph-enforcement.ts builds
 * it. `codes` is the producer's own codes-only mirror — the field the directive
 * builder reads, and the one the estate has already adjudicated as safe to
 * carry off the pipeline (fixed validator enums, no user content: see the
 * PIPELINE_DETAILS_ALLOWLIST note in orchestrator/tools/draft-graph.ts).
 */
function enforcementBlockedBody(codes: string[] = ["NO_EFFECT_PATH", "NO_PATH_TO_GOAL"]) {
  return buildCeeErrorResponse(
    "CEE_GRAPH_INVALID",
    `Graph failed post-enforcement validation (${codes.length} topology error(s))`,
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
        validation_error_codes: codes,
        enforcement_repairs: 0,
        last_phase: "deterministic_enforcement",
      },
    },
  );
}

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
          "Your options came out looking identical, so there was nothing to compare — this often clears on a retry.",
        hints: ["Retrying the same brief often produces distinct options"],
      },
    },
  ) as Record<string, any>;
  body.details = {
    ...(body.details ?? {}),
    violation_code: "OPTIONS_IDENTICAL",
    identical_option_ids: ["7cb3711f", "dfeedc48"],
    intervention_signature: "8515fef",
    repair_skip_reason: "options_identical_unrepairable_by_llm",
  };
  return body;
}

/** Repair blocks with `makeBody()` for the first `blockedAttempts` calls. */
function wire(
  blockedAttempts: number,
  statusCode: number,
  makeBody: () => unknown,
  onParse?: (ctx: any) => void,
) {
  let repairCalls = 0;
  (runStageParse as any).mockImplementation(async (ctx: any) => {
    onParse?.(ctx);
    ctx.graph = { nodes: [], edges: [], version: "1.2" };
  });
  (runStageRepair as any).mockImplementation(async (ctx: any) => {
    repairCalls += 1;
    if (repairCalls <= blockedAttempts) {
      ctx.earlyReturn = { statusCode, body: makeBody() };
    }
  });
  (runStageBoundary as any).mockImplementation(async (ctx: any) => {
    ctx.finalResponse = { graph: { nodes: [], edges: [] }, ok: true };
  });
}

// ---------------------------------------------------------------------------
// 1 · THE DIRECTIVE BUILDER — derived from the producer's own emitted codes
// ---------------------------------------------------------------------------

describe("P0d · buildPriorAttemptDirective — the retry's corrective context", () => {
  it("names the STRUCTURAL RULE every option must satisfy, in the model's own terms", () => {
    const directive = buildPriorAttemptDirective({
      statusCode: 422,
      body: enforcementBlockedBody(["NO_EFFECT_PATH", "NO_EFFECT_PATH", "NO_PATH_TO_GOAL"]),
    });

    expect(directive, "an enforcement-blocked result must yield a directive").toBeTruthy();
    const text = directive as string;

    // The rule the second attempt has to satisfy — stated positively, and in
    // the vocabulary of the draft prompt (options, factors, goal), never as a
    // raw validator enum the draft model has never been shown. The
    // VIOLATION_REFERENCE table that glosses these codes lives in the
    // repair_graph prompt, NOT in draft_graph (src/prompts/defaults.ts:723).
    expect(text.toLowerCase()).toContain("option");
    expect(text.toLowerCase()).toContain("goal");

    // The codes themselves ride along, so the directive stays diagnosable and
    // a code with no gloss is still NAMED (see the fabricated-code case below).
    expect(text).toContain("NO_EFFECT_PATH");
    expect(text).toContain("NO_PATH_TO_GOAL");
  });

  it("⭐ MULTIPLICITY IS REPORTED, because the count IS the finding", () => {
    // P0c derived that NO_EFFECT_PATH and NO_PATH_TO_GOAL arrive at EQUAL
    // multiplicity because both are emitted once per stranded option — it is
    // the count of stranded options, not two independent defects. A directive
    // that says "an option was unconnected" when three were is understating
    // the failure to the one party that could fix it.
    const directive = buildPriorAttemptDirective({
      statusCode: 422,
      body: enforcementBlockedBody([
        "NO_EFFECT_PATH",
        "NO_EFFECT_PATH",
        "NO_EFFECT_PATH",
        "NO_PATH_TO_GOAL",
      ]),
    }) as string;

    expect(directive).toMatch(/NO_EFFECT_PATH[^\n]*\b3\b|\b3\b[^\n]*NO_EFFECT_PATH/);
    expect(directive).toMatch(/NO_PATH_TO_GOAL[^\n]*\b1\b|\b1\b[^\n]*NO_PATH_TO_GOAL/);
  });

  it("⛔ NEVER instructs the model to invent a connection — the refusal is explicit", () => {
    // The lane's binding constraint. An invented edge is a machine-authored
    // causal claim presented to the user as their own reasoning, and it is
    // strictly worse than a visible failure. The directive must give the model
    // INFORMATION, and must say in terms what it may not do with it.
    const directive = (buildPriorAttemptDirective({
      statusCode: 422,
      body: enforcementBlockedBody(),
    }) as string).toLowerCase();

    expect(
      directive,
      "the directive must forbid inventing a link the brief does not support",
    ).toMatch(/do not invent|never invent|do not add.*(cannot|can't) justif|not supported by the brief/);
  });

  it("⭐ AN UNGLOSSED CODE IS STILL NAMED — the gloss table degrades visibly, never silently", () => {
    // trap 12: a hand-maintained gloss table WILL fall behind the validator's
    // code union. The failure mode that matters is the SILENT one — a code
    // dropped from the directive because nobody wrote its sentence. A code with
    // no gloss must still reach the model by name and count.
    const directive = buildPriorAttemptDirective({
      statusCode: 422,
      body: enforcementBlockedBody(["ZZ_FABRICATED_FUTURE_CODE", "NO_EFFECT_PATH"]),
    }) as string;

    expect(directive, "an unglossed code must still be named").toContain("ZZ_FABRICATED_FUTURE_CODE");
    expect(directive, "and must not suppress its glossed neighbours").toContain("NO_EFFECT_PATH");
  });

  it("carries NO node ids, labels or messages — the directive is system-authored throughout", () => {
    // Two independent reasons, and BOTH are load-bearing:
    //  (a) SAFETY. `systemDirective` lands OUTSIDE the
    //      [BEGIN/END]_UNTRUSTED_USER_CONTENT markers (anthropic.ts:494-497),
    //      deliberately, so it carries system authority. Node labels are
    //      drafted FROM the user's brief; routing them there is an injection
    //      carrier. The producer already draws this exact line — it keeps
    //      `validation_errors[].message` off the wire for the same reason
    //      (graph-enforcement.ts:707-714).
    //  (b) USEFULNESS. Node ids are `sha8(claim_kind, label)` content hashes
    //      minted by the PROJECTOR (records/projector.ts:2589) — the model has
    //      never seen them and does not emit them. Attempt 2 mints its own.
    //      Naming attempt 1's ids would be noise at best.
    const body = enforcementBlockedBody() as Record<string, any>;
    body.details.validation_errors = [
      { code: "NO_EFFECT_PATH", message: 'Option "opt_x" has no controllable factors with path to goal', path: "nodesById.7cb3711f" },
    ];
    const directive = buildPriorAttemptDirective({ statusCode: 422, body }) as string;

    expect(directive).not.toContain("7cb3711f");
    expect(directive).not.toContain("nodesById");
    expect(directive).not.toContain("opt_x");
  });

  it("describes the OPTIONS_IDENTICAL class in ITS OWN terms, not the topology class's", () => {
    const raw = buildPriorAttemptDirective({
      statusCode: 400,
      body: optionsIdenticalBody(),
    });
    expect(raw, "the bypass class must yield its own directive").toBeTruthy();
    const directive = (raw as string).toLowerCase();

    // Bind by IDENTITY to the finding this class emits (trap 19).
    expect(raw as string).toContain("OPTIONS_IDENTICAL");

    // ⚠ THIS ASSERTION WAS WEAK AND A MUTANT CAUGHT IT. It was
    // `toMatch(/differ|distinct|same value|apart/)`, which the directive's own
    // CAVEAT sentence satisfied on its own — "manufacture a diffe|rence" matches
    // /differ/. Replacing the entire actionable instruction left the guard
    // GREEN: a guard agreeing with itself (trap 13b). It now binds to the
    // instruction's own object — the intervention VALUES the model must vary.
    expect(directive, "must instruct on the intervention values, not merely mention difference").toContain(
      "intervention value",
    );

    // These options were connected fine — they came out with the same numbers.
    // Borrowing the topology class's rule would describe a defect this draft
    // did not have, and point the model's effort at the wrong thing.
    expect(directive).not.toContain("unconnected");
    expect(directive, "must not carry the topology class's structural rule").not.toContain(
      "chain of causal links reaching the goal",
    );
  });

  it("OPPOSITE-DIRECTION TWIN — a SUCCESS and a non-retryable failure yield NO directive", () => {
    // The predicate must bind to the retryable draft-failure classes, never to
    // "a result exists". A directive built from a success would append a
    // correction to a draft that had nothing wrong with it.
    expect(buildPriorAttemptDirective({ statusCode: 200, body: { ok: true } })).toBeUndefined();
    expect(
      buildPriorAttemptDirective({
        statusCode: 504,
        body: buildCeeErrorResponse("CEE_TIMEOUT", "timeout", { retryable: true }),
      }),
    ).toBeUndefined();
    expect(buildPriorAttemptDirective(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2 · THE THREAD — the directive actually reaches attempt 2
// ---------------------------------------------------------------------------

describe("P0d · the informed retry reaches the second attempt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("⭐ THE HEADLINE: attempt 2 receives the corrective context attempt 1 produced", async () => {
    const seenDirectives: Array<string | undefined> = [];
    wire(Infinity, 422, () => enforcementBlockedBody(), (ctx) => {
      seenDirectives.push(ctx.opts.priorAttemptDirective);
    });

    await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: Date.now() - 20_000,
    });

    expect(runStageParse).toHaveBeenCalledTimes(2);
    expect(seenDirectives).toHaveLength(2);
    expect(seenDirectives[0], "attempt 1 has no prior attempt to learn from").toBeUndefined();
    expect(seenDirectives[1], "attempt 2 must know what went wrong with attempt 1").toBeTruthy();
    expect(seenDirectives[1]).toContain("NO_EFFECT_PATH");
  });

  it("the directive is DERIVED from attempt 1's own emitted codes, not from a constant", () => {
    // Bind by identity, not by a predicate another object could satisfy
    // (trap 19): a hardcoded directive would satisfy "attempt 2 got a string".
    // These two runs must produce DIFFERENT directives because the producer
    // emitted different codes — that discrimination is the whole point.
    const a = buildPriorAttemptDirective({
      statusCode: 422,
      body: enforcementBlockedBody(["NO_EFFECT_PATH"]),
    }) as string;
    const b = buildPriorAttemptDirective({
      statusCode: 422,
      body: enforcementBlockedBody(["INVALID_EDGE_TYPE", "CYCLE_DETECTED"]),
    }) as string;

    expect(a).not.toBe(b);
    expect(a).toContain("NO_EFFECT_PATH");
    expect(a).not.toContain("CYCLE_DETECTED");
    expect(b).toContain("CYCLE_DETECTED");
    expect(b).not.toContain("NO_EFFECT_PATH");
  });

  it("the BRIEF itself is still byte-identical — the correction rides system-side, never in the brief", async () => {
    // #595 review P2: a corrective concatenated into `input.brief` lands INSIDE
    // the untrusted markers, telling the model to treat its own retry
    // instruction as untrusted user text. The input object must not move.
    const seenInputs: string[] = [];
    wire(Infinity, 422, () => enforcementBlockedBody(), (ctx) => {
      seenInputs.push(JSON.stringify(ctx.input));
    });

    await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: Date.now() - 20_000,
    });

    expect(seenInputs).toHaveLength(2);
    expect(seenInputs[1], "the brief must not be rewritten by the retry").toBe(seenInputs[0]);
  });

  it("OPPOSITE-DIRECTION TWIN — a first-attempt SUCCESS never runs a second, directive or not", async () => {
    wire(0, 422, () => enforcementBlockedBody());

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: Date.now() - 20_000,
    });

    expect(runStageParse).toHaveBeenCalledTimes(1);
    expect(result.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 3 · THE UNFUNDED RETRY STOPS LYING
// ---------------------------------------------------------------------------

describe("P0d · the unfunded retry is disclosed instead of being papered over", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Elapsed 60s ⇒ budget 110_000 − 60_000 = 50_000 < MIN (55_000). */
  const UNAFFORDABLE_ELAPSED_MS = 60_000;
  /** Elapsed 20s ⇒ budget 90_000 ≥ MIN. */
  const AFFORDABLE_ELAPSED_MS = 20_000;

  it("⭐ drops the frequency claim it has no evidence for in THIS case", async () => {
    // "Retrying the same brief usually succeeds" is a rate inherited from a
    // population this user is not in: BASELINE measured 3/5 recovery on
    // failures completing in 17.2–28.3s. A failure slow enough to be
    // unaffordable (>55s of the request budget spent) has NO measured recovery
    // rate. Asserting one is a confident claim we have not earned — the exact
    // thing that costs two people a day.
    wire(Infinity, 422, () => enforcementBlockedBody());

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: Date.now() - UNAFFORDABLE_ELAPSED_MS,
    });

    expect(runStageParse, "an unaffordable retry must not launch").toHaveBeenCalledTimes(1);
    const body = result.body as Record<string, any>;
    expect(
      JSON.stringify(body.recovery).toLowerCase(),
      "unmeasured frequency claim must not survive on the unfunded path",
    ).not.toContain("usually succeeds");
  });

  it("⭐ SAYS SO: the user is told the server could not try again, and why", async () => {
    // The no-hiding ruling. An honest "I could not try again" beats a silent
    // omission — and without it the user cannot tell this case apart from
    // "the server tried twice and both failed", which ships DIFFERENT advice.
    wire(Infinity, 422, () => enforcementBlockedBody());

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: Date.now() - UNAFFORDABLE_ELAPSED_MS,
    });

    const recoveryText = JSON.stringify((result.body as Record<string, any>).recovery).toLowerCase();
    expect(recoveryText).toMatch(/could not|couldn't|no time|not enough time|ran out of time|didn't have time/);
    // …and it must NOT claim a second attempt happened, because none did.
    expect(recoveryText, "must not claim an attempt that never ran").not.toMatch(
      /second draft was tried|tried .* automatically|automatically tried/,
    );
  });

  it("⭐ the funding condition is VISIBLE ON THE WIRE, not only in a log line", async () => {
    // `auto_retry` is already allowlisted through the route boundary
    // (draft-graph.ts PIPELINE_DETAILS_ALLOWLIST) and is the ONLY place a
    // consumer can learn what the server did. Present-and-true when the retry
    // ran; absent when it did not — so "no retry" and "no disclosure" were
    // indistinguishable. Fixed shape, fixed enum reason, no user content.
    wire(Infinity, 422, () => enforcementBlockedBody());

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: Date.now() - UNAFFORDABLE_ELAPSED_MS,
    });

    const body = result.body as Record<string, any>;
    expect(body.details.auto_retry).toEqual({
      attempted: false,
      attempts: 1,
      skipped_reason: "budget_unaffordable",
    });
    // The routing half, by identity — the symmetric twin of the funded arm's
    // assertion below. Content is asked semantically by the two tests above.
    expect(body.recovery.suggestion, "the unfunded arm must ship the UNFUNDED copy").toBe(
      RETRY_UNAFFORDABLE_SUGGESTION,
    );
    expect(body.recovery.suggestion, "and NOT the exhausted copy").not.toBe(
      ENFORCEMENT_RETRY_EXHAUSTED_SUGGESTION,
    );
  });

  it("the diagnostics and the fail-closed verdict survive untouched", async () => {
    // The copy change may not weaken enforcement, or launder the failure.
    wire(Infinity, 422, () => enforcementBlockedBody());

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: Date.now() - UNAFFORDABLE_ELAPSED_MS,
    });

    expect(result.statusCode).toBe(422);
    const body = result.body as Record<string, any>;
    expect(body.code).toBe("CEE_GRAPH_INVALID");
    expect(body.retryable).toBe(true);
    expect(body.details.validation_error_codes).toEqual(["NO_EFFECT_PATH", "NO_PATH_TO_GOAL"]);
    expect(body.details.last_phase).toBe("deterministic_enforcement");
  });

  it("OPPOSITE-DIRECTION TWIN — a FUNDED retry that fails twice must NOT claim it was unfunded", async () => {
    // trap 22b: one predicate, two opposite harms. Telling a user we could not
    // try again when we did is the mirror lie of the one being fixed, and a
    // single window cannot guard both. This case is GREEN at pristine and
    // exists to RED any mutant that widens the unfunded copy across both arms.
    wire(Infinity, 422, () => enforcementBlockedBody());

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: Date.now() - AFFORDABLE_ELAPSED_MS,
    });

    expect(runStageParse, "the affordable arm must run two attempts").toHaveBeenCalledTimes(2);
    const body = result.body as Record<string, any>;
    expect(body.details.auto_retry).toEqual({ attempted: true, attempts: 2 });

    // ⚠ BOUND BY IDENTITY TO THE EXPORTED CONSTANTS, AND A MUTANT IS WHY.
    // This assertion was originally a regex pair written from phrasings I
    // imagined (`/could not try again|not enough time|ran out of time/`). The
    // sentence actually shipped on the unfunded arm says "no time left to try
    // again automatically" — which matches NONE of them, while satisfying the
    // positive `/automatically/` on its way past. So swapping the two copy
    // tables wholesale left this twin GREEN: a corpus drawn from the author's
    // head cannot see the class the author did not imagine (trap 22).
    //
    // The routing question ("does the right arm get the right copy?") is
    // therefore asked by IDENTITY against the constants themselves, which no
    // rewording can slip past. The CONTENT question ("is that copy honest?") is
    // asked semantically by the two tests above. Two questions, two guards.
    expect(body.recovery.suggestion, "the funded arm must ship the EXHAUSTED copy").toBe(
      ENFORCEMENT_RETRY_EXHAUSTED_SUGGESTION,
    );
    expect(body.recovery.suggestion, "the funded arm must NOT ship the unfunded copy").not.toBe(
      RETRY_UNAFFORDABLE_SUGGESTION,
    );
    expect(body.recovery_suggestion, "the flat mirror must agree with the nested one").toBe(
      ENFORCEMENT_RETRY_EXHAUSTED_SUGGESTION,
    );
  });

  it("OPPOSITE-DIRECTION TWIN — a NON-retryable failure is not given retry copy at all", async () => {
    // The unfunded copy is scoped to the retryable classes. A typed refusal
    // that was never eligible for a retry must keep its own copy: telling that
    // user "there wasn't time to try again" invents a reason that is not the
    // one they hit.
    (runStageParse as any).mockImplementation(async (ctx: any) => {
      ctx.graph = { nodes: [], edges: [], version: "1.2" };
    });
    (runStageRepair as any).mockImplementation(async (ctx: any) => {
      ctx.earlyReturn = {
        statusCode: 422,
        body: buildCeeErrorResponse("CEE_GRAPH_INVALID", "Graph failed validation", {
          retryable: false,
          details: { validation_error_codes: ["NO_PATH_TO_GOAL"], last_phase: "deterministic_enforcement" },
        }),
      };
    });

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
      ...baseOpts,
      requestStartMs: Date.now() - UNAFFORDABLE_ELAPSED_MS,
    });

    expect(runStageParse).toHaveBeenCalledTimes(1);
    expect((result.body as Record<string, any>).details?.auto_retry).toBeUndefined();
  });
});
