/**
 * Tests for the draft handler's assistantText behaviour (Fix 3).
 *
 * Verifies that `handleDraftGraph` returns `assistantText: null` when the
 * only available signal is `patchData.summary` — previously the handler
 * called `extractFirstSentence(patchData.summary)`, which pushed patch-count
 * jargon ("Added 5 factors, 3 options, and 24 connections") into the user's
 * first turn. Warnings still produce an assistantText as before.
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

describe("handleDraftGraph — assistantText contract (Fix 3)", () => {
  beforeEach(() => {
    runUnifiedPipelineMock.mockReset();
  });

  it("returns assistantText=null when no warnings and summary is decision-framed", async () => {
    runUnifiedPipelineMock.mockResolvedValue({
      statusCode: 200,
      body: {
        graph: {
          nodes: [
            { id: 'g1', kind: 'goal', label: 'Revenue' },
            { id: 'o1', kind: 'option', label: 'Option A' },
          ],
          edges: [],
        },
        coaching: { summary: 'This model trades A against B.' },
        draft_warnings: [],
      },
    });

    const result = await handleDraftGraph(
      'A decision about launching a new feature and its revenue impact.',
      {} as unknown as import("fastify").FastifyRequest,
      'turn_1',
    );

    // Fix 3: handler no longer pulls the first sentence out of patchData.summary
    // — assistantText stays null so the composer / LLM path decides what to show.
    expect(result.assistantText).toBeNull();
  });

  it("returns warning text when pipeline emits validation warnings", async () => {
    runUnifiedPipelineMock.mockResolvedValue({
      statusCode: 200,
      body: {
        graph: { nodes: [], edges: [] },
        coaching: {},
        draft_warnings: [],
        validation_warnings: ['Something looks off.'],
      },
    });

    const result = await handleDraftGraph(
      'A decision about launching a new feature this quarter.',
      {} as unknown as import("fastify").FastifyRequest,
      'turn_1',
    );

    expect(result.assistantText).toContain('Something looks off');
  });
});
