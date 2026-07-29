/**
 * ROADMAP 2.146 — contested-edge slice 1, CEE condition 1: the Pass-2 await moves
 * BEHIND the coaching pass, and GRAPH_READY stays structure-only.
 *
 * Two properties, and they are different claims — a test that proves one says
 * nothing about the other:
 *
 *  1. **OVERLAP.** GRAPH_READY is emitted while Pass 2 is still in flight, and the
 *     pipeline nonetheless does not reach Stage 5 (Package) until Pass 2 has
 *     settled. That is the whole latency argument: ~10–25 s of Pass 2 hides
 *     behind the ~19.8 s coaching tax instead of landing on graph_ready.
 *  2. **STRUCTURE-ONLY, BY CONSTRUCTION.** The GRAPH_READY frame carries no
 *     validation metadata even when the metadata is ALREADY on `ctx.graph` at the
 *     moment the frame is built. Property 1 makes that a race (the validation
 *     pipeline mutates edges in place); this asserts the strip, not the timing.
 *
 * ── LOAD-INDEPENDENCE (the #525 discipline) ─────────────────────────────────
 * The overlap test does not sleep and does not use the wall clock. The mocked
 * Pass 2 yields through a fixed number of `setImmediate` turns; `setImmediate`
 * callbacks run in the check phase, strictly after the microtask queue that the
 * pipeline's own `await`s drain, so the ordering is a property of the event loop
 * rather than of how busy the machine is. A CPU-starved runner cannot flip it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Stage mocks (same shape as the sibling unified-pipeline unit tests) ──────
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

// The coaching pass is the await this lane overlaps Pass 2 with, so it must be
// the REAL function in the overlap tests. It is wrapped in a spy (importOriginal
// spread — never a hand-written stand-in) purely so ONE test can force it to
// throw and exercise the outer-catch drain.
vi.mock("../../src/cee/unified-pipeline/stages/coaching-pass.js", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    runStageCoachingPass: vi.fn(mod.runStageCoachingPass as (ctx: unknown) => Promise<void>),
  };
});

// The Pass-2 orchestrator itself. Mocked so no LLM, no prompt store, and — the
// point of the suite — so its SETTLING MOMENT is controlled.
vi.mock("../../src/cee/validation-pipeline/index.js", () => ({
  runValidationPipeline: vi.fn(),
}));

// Flag-bearing config. `validationPipelineEnabled` is mutable so both arms of the
// gate can be exercised from one suite.
// `vi.hoisted` because `vi.mock` factories are hoisted above module-scope consts.
const mockConfig = vi.hoisted(() => ({
  cee: {
    pipelineCheckpointsEnabled: false,
    timingDebugEnabled: false,
    validationPipelineEnabled: true,
  },
  features: { diagnosticTraceEnabled: false },
}));
vi.mock("../../src/config/index.js", () => ({ config: mockConfig }));

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
import { runStageCoachingPass } from "../../src/cee/unified-pipeline/stages/coaching-pass.js";
import type { PipelineStageEvent } from "../../src/cee/unified-pipeline/types.js";
import {
  VALIDATION_EDGE_METADATA_KEY,
  VALIDATION_GRAPH_SUMMARY_KEY,
} from "../../src/cee/validation-pipeline/types.js";

const mockRequest = {
  id: "test",
  headers: {},
  query: {},
  raw: { destroyed: false },
} as any;

const baseInput = {
  brief: "A sufficiently long decision brief to exercise the validation-await overlap.",
  seed: "overlap-seed",
};

const testGraph = () => ({
  nodes: [
    { id: "g1", kind: "goal", label: "Decide X" },
    { id: "o1", kind: "option", label: "Option A" },
    { id: "f1", kind: "factor", label: "Cost", category: "controllable", data: { value: 100 } },
  ],
  edges: [
    { id: "e1", from: "f1", to: "g1", strength_mean: 0.7, strength_std: 0.1 },
  ],
  version: "1.2",
});

/**
 * The metadata shape Pass 2 attaches. Only the fields this suite reads are
 * populated — the full shape is pinned by the validation-pipeline unit suite.
 */
const fakeMetadata = {
  status: "contested",
  contested_reasons: ["raw_magnitude"],
  pass2: { reasoning: "PASS2_PROSE_MARKER — an independent reviewer's narrative." },
};

/** Attach Pass-2 output to `ctx.graph` the way the real pipeline does: in place. */
function attachMetadata(ctx: any): void {
  for (const edge of ctx.graph.edges) {
    edge[VALIDATION_EDGE_METADATA_KEY] = fakeMetadata;
  }
  ctx.graph[VALIDATION_GRAPH_SUMMARY_KEY] = { contested_count: 1, total_edges_validated: 1 };
  ctx.validationSummary = { contested_count: 1, total_edges_validated: 1 };
}

/** Yield `n` event-loop turns. Deterministic; no wall clock, no sleep. */
async function yieldTurns(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

interface RunResult {
  order: string[];
  frames: PipelineStageEvent[];
  packageCtx: any;
  result: any;
}

async function runPipeline(opts: {
  /** How the mocked Pass 2 behaves. */
  pass2: "slow" | "instant";
}): Promise<RunResult> {
  const order: string[] = [];
  const frames: PipelineStageEvent[] = [];
  let packageCtx: any;

  (runStageParse as any).mockImplementation(async (ctx: any) => {
    ctx.graph = testGraph();
    ctx.rationales = [];
    ctx.confidence = 0.8;
    ctx.llmMeta = { model: "test-drafter" };
    // No `chat` function ⇒ the real coaching pass returns immediately. The
    // coaching pass is deliberately NOT mocked: it is the await this lane
    // overlaps Pass 2 with, so it must be the real call site.
    ctx.draftAdapter = { model: "test-drafter", name: "draft_graph" };
  });
  (runStageNormalise as any).mockImplementation(async () => {});
  (runStageEnrich as any).mockImplementation(async () => {});
  (runStageRepair as any).mockImplementation(async () => {});
  (runStageThresholdSweep as any).mockImplementation(async () => {});
  (runStagePackage as any).mockImplementation(async (ctx: any) => {
    order.push("package");
    packageCtx = ctx;
  });
  (runStageBoundary as any).mockImplementation(async (ctx: any) => {
    ctx.finalResponse = { ok: true };
  });

  (runValidationPipeline as any).mockImplementation(async (ctx: any) => {
    if (opts.pass2 === "slow") {
      // Three event-loop turns: strictly after every microtask the pipeline
      // drains between the fire site and the coaching pass, so this settles
      // after GRAPH_READY under the 2.146 ordering and before it under the old
      // one. See the load-independence note in the header.
      await yieldTurns(3);
    }
    attachMetadata(ctx);
    order.push("validation_settled");
  });

  const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
    schemaVersion: "v3",
    onStage: (event: PipelineStageEvent) => {
      order.push(event.kind);
      frames.push(structuredClone(event) as PipelineStageEvent);
    },
  } as any);

  return { order, frames, packageCtx, result };
}

function graphReadyEdges(frames: PipelineStageEvent[]): Array<Record<string, unknown>> {
  const ready = frames.find((f) => f.kind === "GRAPH_READY") as any;
  expect(ready, "no GRAPH_READY frame was emitted").toBeDefined();
  return ready.graph.edges as Array<Record<string, unknown>>;
}

describe("ROADMAP 2.146 — Pass-2 await overlaps the coaching pass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.cee.validationPipelineEnabled = true;
  });

  // ── 1. OVERLAP ────────────────────────────────────────────────────────────

  it("emits GRAPH_READY while Pass 2 is still in flight", async () => {
    const { order } = await runPipeline({ pass2: "slow" });

    expect(runValidationPipeline).toHaveBeenCalledTimes(1);
    const iGraphReady = order.indexOf("GRAPH_READY");
    const iSettled = order.indexOf("validation_settled");
    expect(iGraphReady).toBeGreaterThan(-1);
    expect(iSettled).toBeGreaterThan(-1);

    // THE PIN. Under the pre-2.146 ordering (`await validationPromise` before the
    // GRAPH_READY emit) Pass 2 settles FIRST and this inverts.
    expect(iGraphReady).toBeLessThan(iSettled);
  });

  it("still awaits Pass 2 before Stage 5 (Package), its only consumer", async () => {
    const { order, packageCtx } = await runPipeline({ pass2: "slow" });

    const iSettled = order.indexOf("validation_settled");
    const iPackage = order.indexOf("package");
    expect(iPackage).toBeGreaterThan(-1);
    // The other half of the move: overlapping must not become "not waiting".
    expect(iSettled).toBeLessThan(iPackage);

    // And the metadata really is there for Package to read — the positive control
    // for the assertion above (trap 13: an ordering pin that never sees the
    // payload proves nothing about delivery).
    expect(packageCtx.graph.edges[0][VALIDATION_EDGE_METADATA_KEY]).toEqual(fakeMetadata);
    expect(packageCtx.validationSummary).toBeDefined();
  });

  it("overlaps Pass 2 with the coaching pass, not merely with Stage 4b", async () => {
    const { order } = await runPipeline({ pass2: "slow" });
    // COACHING_READY is emitted by the coaching-pass call site. Pass 2 settling
    // after it is what proves the await sits behind the ~19.8 s pass rather than
    // behind the ms-scale threshold sweep.
    const iCoaching = order.indexOf("COACHING_READY");
    const iSettled = order.indexOf("validation_settled");
    expect(iCoaching).toBeGreaterThan(-1);
    expect(iCoaching).toBeLessThan(iSettled);
  });

  it("does not run Pass 2 at all when the flag is off (gate intact)", async () => {
    mockConfig.cee.validationPipelineEnabled = false;
    const { order, packageCtx } = await runPipeline({ pass2: "slow" });

    expect(runValidationPipeline).not.toHaveBeenCalled();
    expect(order).not.toContain("validation_settled");
    // Flag-off must be byte-indistinguishable from today: no key on the edge.
    expect(packageCtx.graph.edges[0]).not.toHaveProperty(VALIDATION_EDGE_METADATA_KEY);
  });

  // ── 2. STRUCTURE-ONLY, BY CONSTRUCTION ────────────────────────────────────

  it("GRAPH_READY carries no validation metadata even when Pass 2 has ALREADY landed", async () => {
    // `instant` = the worst case for a timing-based argument: Pass 2 settles and
    // mutates ctx.graph before the frame is built. Any implementation that relies
    // on winning the race fails here; the strip in projectGraphForStagedFrame
    // passes.
    const { frames, packageCtx } = await runPipeline({ pass2: "instant" });

    const edges = graphReadyEdges(frames);
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) {
      expect(edge).not.toHaveProperty(VALIDATION_EDGE_METADATA_KEY);
    }
    const readyFrame = frames.find((f) => f.kind === "GRAPH_READY") as any;
    expect(readyFrame.graph).not.toHaveProperty(VALIDATION_GRAPH_SUMMARY_KEY);

    // No Pass-2 prose anywhere in the frame, checked on the serialised bytes so a
    // nested or renamed carrier cannot slip through a key-name check.
    expect(JSON.stringify(readyFrame)).not.toContain("PASS2_PROSE_MARKER");

    // POSITIVE CONTROL (trap 13): the metadata WAS present on the graph the frame
    // was projected from, and it survives to Package. Without this, the assertions
    // above would pass just as happily against a pipeline that never ran Pass 2.
    expect(packageCtx.graph.edges[0][VALIDATION_EDGE_METADATA_KEY]).toEqual(fakeMetadata);
  });

  // ── 3. THE ESCAPE PATH THE MOVE CREATED ───────────────────────────────────

  it("drains Pass 2 before building the error body when a stage throws mid-overlap", async () => {
    // The coaching pass is the ONLY thing inside the overlap window that can
    // throw to the outer catch: Stage 4b has its own try/catch and both stage
    // emits swallow throws (emitStageEvent). Its own contract says it never
    // throws — which is exactly why the path needs a pin rather than trust.
    (runStageCoachingPass as any).mockImplementationOnce(async () => {
      throw new Error("coaching exploded mid-overlap");
    });

    const { result } = await runPipeline({ pass2: "slow" });

    // `_pipeline_outcome` is assigned by reference, so the question is not
    // whether the late write lands but WHEN. Read the value at the instant the
    // pipeline returns — undrained, Pass 2 is still pending here and this is
    // null, and whether the wire sees 'passed' depends on serialisation timing.
    const outcome = (result.body as any)._pipeline_outcome;
    expect(outcome).toBeDefined();
    expect(outcome.validation_status).toBe("passed");
  });

  it("stripping the frame does not strip the live graph (no mutation of ctx.graph)", async () => {
    const { packageCtx } = await runPipeline({ pass2: "instant" });
    // The projection must copy, never delete: ctx.graph is what Stage 5 packages
    // and what the terminal frame is built from.
    expect(packageCtx.graph[VALIDATION_GRAPH_SUMMARY_KEY]).toBeDefined();
    expect(packageCtx.graph.edges[0][VALIDATION_EDGE_METADATA_KEY]).toEqual(fakeMetadata);
  });
});
