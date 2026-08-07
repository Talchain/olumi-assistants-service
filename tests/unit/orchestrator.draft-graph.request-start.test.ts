/**
 * V5 turn path requestStartMs threading (adversarial review of #576, condition 2).
 *
 * The retry-affordability gate and the Step-11 budget guard in
 * `stages/parse.ts` both measure elapsed time from `ctx.opts.requestStartMs`,
 * falling back to LLM start when absent. Before this change the live V5 turn
 * path (`orchestrator/tools/draft-graph.ts` → `runUnifiedPipeline`) never
 * threaded it, so both measurements silently started at LLM start and were
 * blind to pre-LLM turn time (routing tool-use call, context assembly).
 *
 * These tests pin the threading at the tool boundary: when the caller supplies
 * `requestStartMs`, `runUnifiedPipeline` must receive exactly that value; when
 * the caller does not, the option must stay absent (parse.ts's documented
 * LLM-start fallback, unchanged for legacy callers).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyRequest } from "fastify";

const runUnifiedPipelineMock = vi.fn();
vi.mock("../../src/cee/unified-pipeline/index.js", () => ({
  runUnifiedPipeline: (...args: unknown[]) => runUnifiedPipelineMock(...args),
}));

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, p) => String(p) }),
}));

import { handleDraftGraph } from "../../src/orchestrator/tools/draft-graph.js";

const STUB_REQUEST = {} as FastifyRequest;

const MINIMAL_PIPELINE_BODY = {
  graph: {
    version: "v3",
    nodes: [
      { id: "g1", kind: "goal", label: "Goal" },
      { id: "o1", kind: "option", label: "Option" },
    ],
    edges: [{ from: "o1", to: "g1", strength_mean: 0.5, strength_std: 0.1 }],
  },
};

describe("handleDraftGraph requestStartMs threading (V5 turn path)", () => {
  beforeEach(() => {
    runUnifiedPipelineMock.mockReset();
    runUnifiedPipelineMock.mockResolvedValue({
      statusCode: 200,
      body: MINIMAL_PIPELINE_BODY,
    });
  });

  it("threads requestStartMs into runUnifiedPipeline opts when supplied", async () => {
    const requestStartMs = Date.now() - 12_345;

    await handleDraftGraph(
      "A decision brief that is comfortably longer than thirty characters.",
      STUB_REQUEST,
      "turn-1",
      { requestStartMs },
    );

    expect(runUnifiedPipelineMock).toHaveBeenCalledTimes(1);
    const opts = runUnifiedPipelineMock.mock.calls[0][3] as Record<string, unknown>;
    expect(opts.requestStartMs).toBe(requestStartMs);
  });

  it("omits requestStartMs when the caller does not supply one (legacy fallback preserved)", async () => {
    await handleDraftGraph(
      "A decision brief that is comfortably longer than thirty characters.",
      STUB_REQUEST,
      "turn-1",
    );

    expect(runUnifiedPipelineMock).toHaveBeenCalledTimes(1);
    const opts = runUnifiedPipelineMock.mock.calls[0][3] as Record<string, unknown>;
    expect("requestStartMs" in opts).toBe(false);
  });
});
