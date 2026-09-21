/**
 * ⭐⭐ THE RUNAWAY-ABORT DEAD END — the user-visible shape, not a proxy for it.
 *
 * THE DEFECT (F1, /code-review 2026-07-25). When the runaway-abort budget is
 * exhausted, `anthropic.ts` throws `UpstreamNonJsonError` from the
 * `skipped_unaffordable_final` gate. That throw carries `_llm_meta` and NOTHING
 * ELSE — in particular no `truncated_at_max_tokens`. The pipeline's classifier
 * read ONLY that hand-attached property, so it computed `false` and served:
 *
 *   HTTP 400 · reason `llm_non_json` · retryable **false**
 *   · "Provide a clearer, more specific decision brief."
 *   · "State the specific decision…" / "List 2-3 concrete options…"
 *
 * That is the CRUEL INVERSION the same function's own comment twelve lines
 * above the branch names by that phrase: the user is told their brief was
 * vague, when in fact CEE's own guard aborted N generations and ran out of
 * budget — and is told NOT to retry, when one retry is the honest lever. The
 * correct copy (`truncationRecovery`) already existed in the same function and
 * was simply never reached on this path.
 *
 * ⚠ ONE REVIEWER CLAIM CORRECTED AT THE BYTES. The review said `retryable` was
 * "absent entirely". It is not: `buildCeeErrorResponse` (validation/pipeline.ts)
 * ends with `retryable: options.retryable ?? false`, so the omitted spread
 * produces an explicit `"retryable": false` on the wire — confirmed live against
 * deployed staging `5afef51`. The defect is therefore WORSE than reviewed: the
 * product actively tells the user not to retry a failure that is entirely ours.
 * These tests use the REAL `buildCeeErrorResponse` for exactly that reason —
 * the sibling truncation-recovery suite stubs it with
 * `retryable: opts?.retryable`, a mirror that cannot see the `?? false` default
 * and so cannot see this half of the defect.
 *
 * WHY THE FIXTURE IS DERIVED, NOT HAND-TYPED. The error below is built with the
 * REAL `buildFailedCallLlmMeta` — the one canonical failed-call meta builder
 * every failure route already uses (and which
 * `cee.llm-metadata-projection.test.ts` pins against hand-built copies). A
 * hand-written `_llm_meta` literal here would be the same mirror defect the
 * fix exists to remove. The end-to-end proof that the ADAPTER really produces
 * this shape lives in
 * `src/adapters/llm/__tests__/draft-runaway-skip-classification.test.ts`.
 *
 * RED-FIRST: on `5afef510` every assertion in the first test fails
 * (retryable false, reason `llm_non_json`, cruel-inversion copy).
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

// ⭐ NOT MOCKED, deliberately: src/cee/validation/pipeline.js. The whole point
// of this file is the shape the REAL builder puts on the wire.

import { runUnifiedPipeline } from "../../src/cee/unified-pipeline/index.js";
import { runStageParse } from "../../src/cee/unified-pipeline/stages/parse.js";
import { UpstreamNonJsonError } from "../../src/adapters/llm/errors.js";
import { buildFailedCallLlmMeta } from "../../src/adapters/llm/draft-budget.js";

const mockRequest = {
  id: "test",
  headers: {},
  query: {},
  raw: { destroyed: false },
} as any;

const baseOpts = { schemaVersion: "v3" as const };

/**
 * The error `anthropic.ts`'s `shouldSkipDoomedFinalAttempt` gate throws: an
 * `UpstreamNonJsonError` whose second `Object.assign` argument carries ONLY the
 * canonical failed-call meta. No `truncated_at_max_tokens`, because the skipped
 * attempt was never made and so nothing was ever cut at max_tokens.
 */
function makeRunawaySkipError(): UpstreamNonJsonError {
  return Object.assign(
    new UpstreamNonJsonError(
      "anthropic draft_graph final attempt unaffordable — remaining budget 31000ms affords " +
        "1980 tokens < the 3581-token converged-draft floor (derived from the largest successful " +
        "draft ever observed, with headroom) after 2 runaway abort(s) at a 8548-token cap; " +
        "failing fast instead of a doomed sub-viable generation",
      "anthropic",
      "draft_graph",
      79_000,
      "",
    ),
    {
      _llm_meta: buildFailedCallLlmMeta({
        model: "claude-sonnet-4-6",
        promptVersion: "draft_graph_default@v195 (staging)",
        promptHash: "152998b447819c2e",
        temperature: 0,
        providerLatencyMs: 79_000,
        finishReason: "skipped_unaffordable_final",
        streamed: true,
        runawayAbortCount: 2,
        runawayAbortTriggers: ["string", "chars"],
        maxTokens: 1_980,
      }),
    },
  );
}

async function runWithParseError(err: unknown) {
  (runStageParse as any).mockImplementation(async () => {
    throw err;
  });
  return runUnifiedPipeline(
    { brief: "Should we move the team stand-up from 9am to 10am?" } as any,
    {},
    mockRequest,
    baseOpts,
  );
}

describe("F1 — an exhausted runaway-abort budget must not land on the cruel inversion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves the DEMAND-failure shape, never the vague-brief dead end", async () => {
    const result = await runWithParseError(makeRunawaySkipError());

    const body = result.body as any;

    // Still a typed 400 — the request genuinely failed.
    expect(result.statusCode).toBe(400);
    expect(body.code).toBe("CEE_LLM_VALIDATION_FAILED");

    // ⭐ THE THREE THINGS THE USER SEES, all wrong before the fix.
    //
    // 1. An EXPLICIT retryable, and it must be TRUE. Pre-fix this was an
    //    explicit `false` (from `?? false`), i.e. the product telling the user
    //    not to retry a failure that is entirely CEE-side.
    expect(body).toHaveProperty("retryable");
    expect(body.retryable).toBe(true);

    // 2. The diagnosable class, not the vague-brief bucket. Deliberately the
    //    SAME reason string the max_tokens truncation uses: `route-v2.ts:1420`
    //    already switches on it to mark the V5 turn surface retryable, and
    //    minting a second value would force a new hand-maintained branch there
    //    (trap 12) for a class that wants identical treatment.
    expect(body.reason).toBe("llm_truncated_max_tokens");

    // 3. Honest copy. Never null, and never the cruel inversion.
    expect(body.recovery).toBeTruthy();
    const copy = [body.recovery.suggestion, ...(body.recovery.hints ?? [])]
      .join(" ")
      .toLowerCase();
    expect(copy).not.toContain("more specific");
    expect(copy).not.toContain("clearer");
    expect(copy).not.toContain("concrete options you are considering");
    expect(copy).toMatch(/retry|try again/);
    expect(copy).toMatch(/narrow|fewer|scope|one decision/);

    // The flat mirror consumers read instead of passthrough-sniffing.
    expect(body.recovery_suggestion).toBe(body.recovery.suggestion);
  });

  it("classifies from the CANONICAL meta, so no throw site has to remember a flag", async () => {
    // The same failure with the abort count as the ONLY signal — no explicit
    // `truncated_at_max_tokens`, no truncation finish_reason, and a message
    // that matches none of the pipeline's prefix patterns. If the classifier
    // ever goes back to reading a hand-attached property, this goes red.
    const err = Object.assign(
      new UpstreamNonJsonError("upstream produced no parseable JSON", "anthropic", "draft_graph", 60_000, ""),
      {
        _llm_meta: buildFailedCallLlmMeta({
          model: "claude-sonnet-4-6",
          providerLatencyMs: 60_000,
          runawayAbortCount: 1,
          runawayAbortTriggers: ["string"],
        }),
      },
    );

    const body = (await runWithParseError(err)).body as any;
    expect(body.retryable).toBe(true);
    expect(body.reason).toBe("llm_truncated_max_tokens");
  });

  it("POSITIVE CONTROL — a genuine vague-brief failure keeps the vague-brief copy and stays non-retryable", async () => {
    // A draft that produced garbage with ZERO runaway aborts is the case the
    // "be more specific" copy was written for. Without this control the
    // assertions above would pass just as well if the classifier said "demand
    // failure" unconditionally.
    const err = Object.assign(
      new UpstreamNonJsonError(
        "LLM returned non-JSON",
        "anthropic",
        "draft_graph",
        5_000,
        "asdf garbled output...",
      ),
      {
        _llm_meta: buildFailedCallLlmMeta({
          model: "claude-sonnet-4-6",
          providerLatencyMs: 5_000,
          finishReason: "end_turn",
          streamed: true,
          runawayAbortCount: 0,
          runawayAbortTriggers: [],
        }),
      },
    );

    const body = (await runWithParseError(err)).body as any;
    expect(body.reason).toBe("llm_non_json");
    expect(body.retryable).toBe(false);
    expect(body.recovery.suggestion.toLowerCase()).toContain("more specific");
  });

  it("POSITIVE CONTROL — an error with no `_llm_meta` at all is still classified as a vague-brief failure", async () => {
    const body = (
      await runWithParseError(
        new UpstreamNonJsonError("LLM returned non-JSON", "anthropic", "draft_graph", 5_000, "..."),
      )
    ).body as any;
    expect(body.reason).toBe("llm_non_json");
    expect(body.retryable).toBe(false);
  });

  it("the max_tokens truncation path is unchanged — the explicit flag still classifies", async () => {
    const err = Object.assign(
      new UpstreamNonJsonError(
        "anthropic draft_graph output truncated at max_tokens=8548",
        "anthropic",
        "draft_graph",
        52_000,
        '{"nodes":[{"id":"opt_1"',
      ),
      { truncated_at_max_tokens: true },
    );

    const body = (await runWithParseError(err)).body as any;
    expect(body.reason).toBe("llm_truncated_max_tokens");
    expect(body.retryable).toBe(true);
  });

  it("a runaway-aborted draft that fails SCHEMA validation gets the same honest shape (was an untyped 500)", async () => {
    // The schema-invalid branch reads the same classifier. Pre-fix, a
    // runaway-aborted-then-schema-invalid draft matched neither the anchored
    // message regex nor the truncation flag and fell through to
    // CEE_INTERNAL_ERROR 500 with `recovery: undefined` — the
    // retryable-plus-no-recovery dead end.
    const err = Object.assign(
      new Error("anthropic draft_graph produced an object the graph schema rejected"),
      {
        _llm_meta: buildFailedCallLlmMeta({
          model: "claude-sonnet-4-6",
          providerLatencyMs: 71_000,
          finishReason: "skipped_unaffordable_final",
          streamed: true,
          runawayAbortCount: 3,
          runawayAbortTriggers: ["string", "string", "chars"],
        }),
      },
    );

    const result = await runWithParseError(err);
    const body = result.body as any;
    expect(result.statusCode).toBe(400);
    expect(body.code).toBe("CEE_LLM_VALIDATION_FAILED");
    expect(body.retryable).toBe(true);
    expect(body.recovery).toBeTruthy();
  });
});
