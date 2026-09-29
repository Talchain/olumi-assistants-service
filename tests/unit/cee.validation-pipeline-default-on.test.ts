/**
 * ROADMAP 2.146 — BEHAVIOURAL WITNESS for the code-default activation.
 *
 * `tests/unit/config.activation-defaults.test.ts` proves the parsed value is
 * `true` with the env unset. On its own that is a test that reads a config value
 * back, which is exactly the theatre this programme refuses. This file proves the
 * consequence: with `CEE_VALIDATION_PIPELINE_ENABLED` ABSENT FROM THE ENVIRONMENT,
 * the unified pipeline actually CALLS `runValidationPipeline`, and the Pass-2
 * metadata reaches Stage 5 (Package).
 *
 * ── WHY THIS FILE EXISTS SEPARATELY FROM `cee.validation-await-overlap.test.ts` ──
 * That suite mocks `src/config/index.js` wholesale with a hand-written object so it
 * can drive BOTH arms of the gate from one file. That mock is the right tool for
 * proving the ordering, and it is structurally incapable of proving the DEFAULT:
 * it never reads the shipped one. Here the config module is deliberately NOT
 * mocked — the real loader runs against the real environment, so reverting
 * `booleanString.default(true)` to `false` turns this RED and nothing else in the
 * repo would.
 *
 * The stage functions are mocked (no LLM, no prompt store, no network) exactly as
 * in the sibling suite; only the flag's own resolution is left real.
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
vi.mock("../../src/cee/unified-pipeline/stages/threshold-sweep.js", () => ({
  runStageThresholdSweep: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/coaching-pass.js", () => ({
  runStageCoachingPass: vi.fn(),
}));
vi.mock("../../src/cee/validation-pipeline/index.js", () => ({
  runValidationPipeline: vi.fn(),
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
vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: (code: string, msg: string) => ({ error: { code, message: msg } }),
}));

import { runUnifiedPipeline } from "../../src/cee/unified-pipeline/index.js";
import { runStageParse } from "../../src/cee/unified-pipeline/stages/parse.js";
import { runStageNormalise } from "../../src/cee/unified-pipeline/stages/normalise.js";
import { runStageEnrich } from "../../src/cee/unified-pipeline/stages/enrich.js";
import { runStageRepair } from "../../src/cee/unified-pipeline/stages/repair/index.js";
import { runStagePackage } from "../../src/cee/unified-pipeline/stages/package.js";
import { runStageBoundary } from "../../src/cee/unified-pipeline/stages/boundary.js";
import { runStageThresholdSweep } from "../../src/cee/unified-pipeline/stages/threshold-sweep.js";
import { runValidationPipeline } from "../../src/cee/validation-pipeline/index.js";
import { VALIDATION_EDGE_METADATA_KEY } from "../../src/cee/validation-pipeline/types.js";
import { config } from "../../src/config/index.js";

const mockRequest = {
  id: "test",
  headers: {},
  query: {},
  raw: { destroyed: false },
} as any;

const baseInput = {
  brief: "A sufficiently long decision brief to exercise the shipped Pass-2 default.",
  seed: "default-on-seed",
};

const testGraph = () => ({
  nodes: [
    { id: "g1", kind: "goal", label: "Decide X" },
    { id: "o1", kind: "option", label: "Option A" },
    { id: "f1", kind: "factor", label: "Cost", category: "controllable", data: { value: 100 } },
  ],
  edges: [{ id: "e1", from: "f1", to: "g1", strength_mean: 0.7, strength_std: 0.1 }],
  version: "1.2",
});

const fakeMetadata = {
  status: "contested",
  contested_reasons: ["raw_magnitude"],
  pass2: { reasoning: "PASS2_PROSE_MARKER — an independent reviewer's narrative." },
};

describe("ROADMAP 2.146 — Pass 2 runs on the SHIPPED default (no env var present)", () => {
  let packageCtx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    packageCtx = undefined;

    (runStageParse as any).mockImplementation(async (ctx: any) => {
      ctx.graph = testGraph();
      ctx.rationales = [];
      ctx.confidence = 0.8;
      ctx.llmMeta = { model: "test-drafter" };
      ctx.draftAdapter = { model: "test-drafter", name: "draft_graph" };
    });
    (runStageNormalise as any).mockImplementation(async () => {});
    (runStageEnrich as any).mockImplementation(async () => {});
    (runStageRepair as any).mockImplementation(async () => {});
    (runStageThresholdSweep as any).mockImplementation(async () => {});
    (runStagePackage as any).mockImplementation(async (ctx: any) => {
      packageCtx = ctx;
    });
    (runStageBoundary as any).mockImplementation(async (ctx: any) => {
      ctx.finalResponse = { ok: true };
    });
    (runValidationPipeline as any).mockImplementation(async (ctx: any) => {
      for (const edge of ctx.graph.edges) edge[VALIDATION_EDGE_METADATA_KEY] = fakeMetadata;
      // ROADMAP 2.1250 — the producer now RETURNS its outcome and the caller
      // derives `validation_status` from `outcome.attached`. Nothing in this
      // suite asserts that field today, so a `undefined`-resolving mock still
      // reads green — which is exactly why it is corrected here rather than
      // left for whoever adds the first assertion on it.
      return { attached: true, pass2LatencyMs: 0 };
    });
  });

  it("PRECONDITION — the flag is genuinely absent from this process's environment", () => {
    // A HARD assertion, not a skip: if a local shell (or a leaked stub) carries
    // the variable, every claim below is about that value rather than about the
    // shipped default, and the run must fail loudly rather than read green.
    expect(process.env.CEE_VALIDATION_PIPELINE_ENABLED).toBeUndefined();
    expect(config.cee.validationPipelineEnabled).toBe(true);
  });

  it("calls runValidationPipeline exactly once with no env var set", async () => {
    await runUnifiedPipeline(baseInput as any, {}, mockRequest, { schemaVersion: "v3" } as any);

    expect(runValidationPipeline).toHaveBeenCalledTimes(1);
  });

  it("the Pass-2 edge metadata reaches Stage 5 (Package) — the capability's output survives", async () => {
    await runUnifiedPipeline(baseInput as any, {}, mockRequest, { schemaVersion: "v3" } as any);

    expect(packageCtx, "Stage 5 never ran").toBeDefined();
    // Bound by IDENTITY: the edge is found by its own id, and the marker is the
    // exact object Pass 2 attached — not "some edge has some validation field".
    const edge = packageCtx.graph.edges.find((e: any) => e.id === "e1");
    expect(edge, "edge e1 missing from the packaged graph").toBeDefined();
    expect(edge[VALIDATION_EDGE_METADATA_KEY]).toStrictEqual(fakeMetadata);
  });

  /**
   * THE DEGRADATION WARNING CARRIES A STABLE CLASS, NOT THE RAW MESSAGE.
   *
   * Found by the activation, not by design review: Pass 2's own error text
   * embeds the request id, so with the pipeline dark this was a per-request
   * value sitting unnoticed on the response payload, and with it ON it broke the
   * staged-SSE↔buffered equivalence pin outright (that suite's volatility
   * derivation refuses to treat a structural `_pipeline_outcome.*` path as
   * ignorable, so it red rather than going hollow — the alarm was right).
   */
  it("a degraded Pass 2 puts the CLASSIFICATION on the payload, with no per-request id", async () => {
    const raw =
      "cee.validation_pipeline.parse_error: Pass 2 response missing 'edges' array " +
      "(request_id=aad05a8f-7310-47fd-b234-db87d0085b7e)";
    (runValidationPipeline as any).mockImplementation(async () => {
      throw new Error(raw);
    });

    await runUnifiedPipeline(baseInput as any, {}, mockRequest, { schemaVersion: "v3" } as any);

    expect(packageCtx, "Stage 5 never ran").toBeDefined();
    const outcome = packageCtx.pipelineOutcome;
    expect(outcome.validation_status).toBe("failed_degraded");

    // Bound by IDENTITY: the warning is found by its own `stage`, not by "the
    // first warning" — other stages push warnings onto the same array.
    const warning = outcome.warnings.find((w: any) => w.stage === "validation_pipeline");
    expect(warning, "no validation_pipeline warning was recorded").toBeDefined();
    expect(warning.degraded).toBe(true);

    // The stable class that `classifyValidationFailure` derives — the exact
    // vocabulary the budget design reasons in.
    expect(warning.error).toBe("parse_error");

    // And the load-bearing negative, stated as its own assertion so a future
    // edit that reinstates the message cannot pass by coincidence: no uuid, and
    // none of the raw text.
    expect(warning.error).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(warning.error).not.toContain("request_id");
    expect(warning.error).not.toContain("missing 'edges' array");
  });
});
