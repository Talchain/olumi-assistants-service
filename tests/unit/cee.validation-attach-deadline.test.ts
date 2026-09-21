/**
 * ROADMAP 2.1250, half 2 of 2 — Pass 2 comes OFF the delivery path.
 *
 * ── THE CHANGE, AND WHAT IT IS NOT ──────────────────────────────────────────
 * 2.146 moved the Pass-2 await behind the coaching pass so its 10–25 s hid
 * behind the ~19.8 s coaching tax. The await itself stayed UNBOUNDED: it
 * inherited Pass 2's own 60 s cap, so a slow Pass 2 still held the terminal
 * COMPLETE frame. Pass-2 latency was then measured climbing 23.8 s → 47.2 s
 * MEAN in a single day, which turns the residual 2.146 prices at ~0 into ~27 s
 * of blocking against a ~87 s median delivery and a 130 s client ceiling.
 *
 * This is NOT a weakening of validation. The deterministic validator has
 * already passed the graph, Repair has finished, and GRAPH_READY has already
 * streamed. Pass 2 attaches edge-contested METADATA and, on its own timeout,
 * the turn ships without it TODAY. The only thing that changes is whose clock
 * decides — the provider's tail, or the user's draft.
 *
 * ── THE DISCRIMINATING PAIR ─────────────────────────────────────────────────
 * Neither arm alone proves anything useful:
 *   · SLOW arm only  → passes for an implementation that abandons Pass 2
 *                      unconditionally, i.e. deletes the feature.
 *   · FAST arm only  → passes for the unbounded await this replaces.
 * Run together they pin the actual property: bounded when it must be, attached
 * when it can be.
 *
 * ── ON THE FIXTURE HONOURING `shouldAttach` ─────────────────────────────────
 * `runValidationPipeline` is mocked here (this suite is about the CALLER), and
 * the mock honours `shouldAttach` the way the real one does. A self-authored
 * fixture is not evidence about the producer — so the REAL function's gate is
 * pinned separately, at the producer's own bytes, in
 * `tests/unit/cee.validation-pipeline/attach-gate.test.ts`. The two compose;
 * neither stands alone.
 *
 * ── LOAD-INDEPENDENCE ───────────────────────────────────────────────────────
 * The deadline is mocked to 25 ms and the slow Pass 2 sleeps 750 ms — a 30×
 * margin, and the assertion is an ORDER between two events in the SAME run, so
 * a starved runner delays both and cannot flip it. The fast arm settles in zero
 * event-loop turns against a 5 s deadline.
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
vi.mock("../../src/cee/validation-pipeline/index.js", () => ({
  runValidationPipeline: vi.fn(),
}));

// The two budgets under test. Overridden through an importOriginal SPREAD so
// every unrelated export of timeouts.js stays live (trap 12).
vi.mock("../../src/config/timeouts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/config/timeouts.js")>()),
  VALIDATION_ATTACH_WAIT_MS: 25,
  VALIDATION_PIPELINE_TIMEOUT_MS: 60_000,
}));

const mockConfig = vi.hoisted(() => ({
  cee: {
    pipelineCheckpointsEnabled: false,
    timingDebugEnabled: true,
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
import { log } from "../../src/utils/telemetry.js";
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
  brief: "A sufficiently long decision brief to exercise the Pass-2 attach deadline.",
  seed: "attach-deadline-seed",
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface RunResult {
  order: string[];
  packageCtx: any;
  result: any;
}

async function runPipeline(pass2SleepMs: number): Promise<RunResult> {
  const order: string[] = [];
  let packageCtx: any;

  (runStageParse as any).mockImplementation(async (ctx: any) => {
    ctx.graph = testGraph();
    ctx.rationales = [];
    ctx.confidence = 0.8;
    ctx.llmMeta = { model: "test-drafter" };
    // No `chat` on the adapter ⇒ the real coaching pass returns immediately.
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

  // Mirrors the real pipeline: the model call, THEN the gate, THEN the
  // in-place mutation. See the header on why this fixture is not the evidence
  // for the gate itself.
  (runValidationPipeline as any).mockImplementation(
    async (ctx: any, opts?: { shouldAttach?: () => boolean }) => {
      if (pass2SleepMs > 0) await sleep(pass2SleepMs);
      if (opts?.shouldAttach && !opts.shouldAttach()) {
        order.push("validation_settled_abandoned");
        return { attached: false, pass2LatencyMs: pass2SleepMs };
      }
      for (const edge of ctx.graph.edges) {
        edge[VALIDATION_EDGE_METADATA_KEY] = { status: "contested" };
      }
      ctx.graph[VALIDATION_GRAPH_SUMMARY_KEY] = { contested_count: 1 };
      ctx.validationSummary = { contested_count: 1 };
      order.push("validation_settled_attached");
      return { attached: true, pass2LatencyMs: pass2SleepMs };
    },
  );

  const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, {
    schemaVersion: "v3",
  } as any);

  return { order, packageCtx, result };
}

function warnLines(event: string): Record<string, unknown>[] {
  return (log.warn as any).mock.calls
    .map((c: unknown[]) => c[0] as Record<string, unknown>)
    .filter((a: Record<string, unknown>) => a?.event === event);
}

describe("ROADMAP 2.1250 — the terminal frame stops waiting for Pass 2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.cee.validationPipelineEnabled = true;
  });

  describe("SLOW Pass 2 (750 ms against a 25 ms attach deadline)", () => {
    it("Package runs — and the whole draft finishes — BEFORE Pass 2 settles", async () => {
      const { order } = await runPipeline(750);

      // The load-bearing assertion of the whole lane: the user's draft is not
      // behind Pass 2's tail any more.
      expect(order).toContain("package");
      const settledIndex = order.findIndex((s) => s.startsWith("validation_settled"));
      if (settledIndex !== -1) {
        expect(order.indexOf("package")).toBeLessThan(settledIndex);
      }
    });

    it("reports the degradation on the response rather than silently dropping it", async () => {
      const { result } = await runPipeline(750);

      const outcome = (result.body as any)._pipeline_outcome;
      expect(outcome.validation_status).toBe("failed_degraded");
      expect(outcome.warnings).toContainEqual({
        stage: "validation_pipeline",
        error: "abandoned_deadline",
        degraded: true,
      });
    });

    it("logs the deadline breach with both budgets, so the bound is tunable from the log alone", async () => {
      await runPipeline(750);

      const lines = warnLines("cee.validation_pipeline.attach_deadline_exceeded");
      expect(lines).toHaveLength(1);
      expect(lines[0].attach_wait_budget_ms).toBe(25);
      expect(lines[0].pass2_timeout_ms).toBe(60_000);
      expect(lines[0].waited_ms as number).toBeGreaterThanOrEqual(0);
    });

    it("records how long the draft waited, and does NOT invent a Pass-2 duration", async () => {
      // `validation_pipeline_ms` means "how long Pass 2 took on this turn". On
      // an abandoned turn that number is not known when the response is built,
      // and a late write would land or not land depending on scheduling. An
      // absent field is honest; a nondeterministic one is not.
      const { result } = await runPipeline(750);

      const timings = (result.body as any)._timings.draft_graph;
      expect(typeof timings.validation_pipeline_abandoned_after_ms).toBe("number");
      expect(timings.validation_pipeline_ms).toBeUndefined();
    });

    it("ships the graph WITHOUT Pass-2 metadata rather than a half-attached one", async () => {
      const { packageCtx } = await runPipeline(750);

      expect(packageCtx.graph.edges[0][VALIDATION_EDGE_METADATA_KEY]).toBeUndefined();
      expect(packageCtx.graph[VALIDATION_GRAPH_SUMMARY_KEY]).toBeUndefined();
      expect(packageCtx.validationSummary).toBeUndefined();
    });
  });

  describe("FAST Pass 2 (settles inside the deadline)", () => {
    it("still attaches the metadata — the deadline does not delete the feature", async () => {
      const { packageCtx, order } = await runPipeline(0);

      expect(order).toContain("validation_settled_attached");
      expect(packageCtx.graph.edges[0][VALIDATION_EDGE_METADATA_KEY]).toBeDefined();
      expect(packageCtx.validationSummary).toBeDefined();
    });

    it("Package still runs AFTER Pass 2 — the 2.146 ordering is preserved", async () => {
      const { order } = await runPipeline(0);

      expect(order.indexOf("validation_settled_attached")).toBeLessThan(order.indexOf("package"));
    });

    it("reports `passed` with a real duration, and no deadline warning", async () => {
      const { result } = await runPipeline(0);

      const outcome = (result.body as any)._pipeline_outcome;
      expect(outcome.validation_status).toBe("passed");
      expect(outcome.warnings).not.toContainEqual(
        expect.objectContaining({ error: "abandoned_deadline" }),
      );

      const timings = (result.body as any)._timings.draft_graph;
      expect(typeof timings.validation_pipeline_ms).toBe("number");
      expect(timings.validation_pipeline_abandoned_after_ms).toBeUndefined();
      expect(warnLines("cee.validation_pipeline.attach_deadline_exceeded")).toHaveLength(0);
    });
  });

  describe("the flag-OFF arm is untouched", () => {
    it("does not wait, does not warn, and does not report a degradation", async () => {
      mockConfig.cee.validationPipelineEnabled = false;

      const { result } = await runPipeline(750);

      const outcome = (result.body as any)._pipeline_outcome;
      expect(outcome.validation_status).toBe("skipped");
      expect(warnLines("cee.validation_pipeline.attach_deadline_exceeded")).toHaveLength(0);
      expect(runValidationPipeline).not.toHaveBeenCalled();
    });
  });
});
