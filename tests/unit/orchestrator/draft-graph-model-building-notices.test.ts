/**
 * ⭐⭐ RED-FIRST PIN — THE TOOL BOUNDARY STOPS EATING THE R1 DISCLOSURES.
 *
 * `handleDraftGraph` rebuilds its result as a FRESH OBJECT LITERAL from named
 * keys off `pipelineResult.body`. `record_disclosures` is ON that body — the V3
 * transform put it there — and was never named, so it died here with nothing to
 * catch it: the tool's `DraftGraphResult` is a DIFFERENT interface from the
 * adapter's same-named one, and only the adapter's declares the field.
 *
 * This file executes the real handler against a mocked pipeline body and
 * asserts the notices come out the other side. At pristine it REDs on
 * `modelBuildingNotices` being `undefined`.
 *
 * ⚠ A STRUCTURAL GUARD WOULD NOT DO. Grepping `draft-graph.ts` for the symbol
 * proves a string is present in a file; only execution proves the field
 * survives the return literal.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const runUnifiedPipelineMock = vi.fn();

vi.mock("../../../src/cee/unified-pipeline/index.js", () => ({
  runUnifiedPipeline: (...args: unknown[]) => runUnifiedPipelineMock(...args),
}));

vi.mock("../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

vi.mock("../../../src/schemas/analysis-ready.js", () => ({
  AnalysisReadyPayload: { safeParse: () => ({ success: true }) },
}));

vi.mock("../../../src/orchestrator/tools/analysis-ready-helper.js", () => ({
  buildCanonicalAnalysisReadyFromGraph: () => undefined,
}));

import { handleDraftGraph } from "../../../src/orchestrator/tools/draft-graph.js";

const GRAPH = {
  nodes: [
    { id: "g1", kind: "goal", label: "Reduce churn" },
    { id: "o1", kind: "option", label: "Switch supplier" },
  ],
  edges: [],
};

const BRIEF =
  "A decision about switching supplier to cut churn to 8% within the quarter.";

function pipelineBody(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    graph: GRAPH,
    coaching: { summary: "This model trades cost against reliability." },
    draft_warnings: [],
    ...extra,
  };
}

describe("handleDraftGraph — R1 disclosures survive the tool boundary", () => {
  beforeEach(() => {
    runUnifiedPipelineMock.mockReset();
  });

  it("derives model-building notices from the pipeline body's record_disclosures", async () => {
    runUnifiedPipelineMock.mockResolvedValue({
      statusCode: 200,
      body: pipelineBody({
        record_disclosures: [
          { reason: "ref_kind_illegal", label: "Capacity → Attrition", withdrawn: false },
          { reason: "unconnected_to_goal", label: "TAM is €400m", withdrawn: true },
          { reason: "undeveloped_duplicate_of_stated", label: "Renegotiate", withdrawn: false },
        ],
      }),
    });

    const result = await handleDraftGraph(
      BRIEF,
      {} as unknown as import("fastify").FastifyRequest,
      "turn_mbn_1",
    );

    // BOUND BY IDENTITY: exact kinds and counts, so a composer that emitted one
    // hardcoded group cannot satisfy this.
    expect(result.modelBuildingNotices).toEqual({
      total_count: 3,
      groups: [
        { kind: "detail_not_connected", count: 1 },
        { kind: "relationship_not_used", count: 1 },
        { kind: "alternative_consolidated", count: 1 },
      ],
      details_redacted: true,
    });
  });

  it("counts the entries the V3 transform could not render, rather than losing them", async () => {
    runUnifiedPipelineMock.mockResolvedValue({
      statusCode: 200,
      body: pipelineBody({
        record_disclosures: [{ reason: "self_loop", label: "Cost → Cost", withdrawn: false }],
        record_disclosures_omitted: 2,
      }),
    });

    const result = await handleDraftGraph(
      BRIEF,
      {} as unknown as import("fastify").FastifyRequest,
      "turn_mbn_2",
    );

    expect(result.modelBuildingNotices).toEqual({
      total_count: 3,
      groups: [
        { kind: "relationship_not_used", count: 1 },
        { kind: "other", count: 2 },
      ],
      details_redacted: true,
    });
  });

  it("stays undefined when the projector refused nothing", async () => {
    runUnifiedPipelineMock.mockResolvedValue({
      statusCode: 200,
      body: pipelineBody({}),
    });

    const result = await handleDraftGraph(
      BRIEF,
      {} as unknown as import("fastify").FastifyRequest,
      "turn_mbn_3",
    );

    expect(result.modelBuildingNotices).toBeUndefined();
  });
});
