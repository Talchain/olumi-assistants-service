/**
 * Tests for the user_currency_hint precedence in handleDraftGraph (Fix 4).
 *
 * Verifies that when turnContext.user_currency_hint is populated (ISO code
 * like "GBP"), it is preferred over brief-level detection when building the
 * currency instruction injected into the draft LLM prompt.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Intercept the unified pipeline so we can inspect the input it receives
// without running the full LLM call chain.
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
  computeStructuralReadiness: () => undefined,
}));

import { handleDraftGraph } from "../../../src/orchestrator/tools/draft-graph.js";

function makeStubResponse() {
  return {
    statusCode: 200,
    body: {
      graph: { nodes: [], edges: [] },
      coaching: {},
      draft_warnings: [],
    },
  };
}

describe("handleDraftGraph — currency hint precedence (Fix 4)", () => {
  beforeEach(() => {
    runUnifiedPipelineMock.mockReset();
  });

  it("prefers user_currency_hint over brief-only detection when hint is set", async () => {
    runUnifiedPipelineMock.mockResolvedValue(makeStubResponse());

    // Brief contains NO currency. Hint carries GBP from the full user message.
    await handleDraftGraph(
      'Choosing whether to launch the new feature this quarter or next.',
      {} as unknown as import("fastify").FastifyRequest,
      'turn_1',
      { userCurrencyHint: 'GBP' },
    );

    expect(runUnifiedPipelineMock).toHaveBeenCalledOnce();
    const input = runUnifiedPipelineMock.mock.calls[0][0] as { currencyInstruction?: string };
    expect(input.currencyInstruction).toContain('£ (GBP)');
  });

  it("falls back to brief-level detection when hint is null", async () => {
    runUnifiedPipelineMock.mockResolvedValue(makeStubResponse());

    await handleDraftGraph(
      'Choosing between a £100,000 platform upgrade and a £40,000 patch.',
      {} as unknown as import("fastify").FastifyRequest,
      'turn_1',
      { userCurrencyHint: null },
    );

    expect(runUnifiedPipelineMock).toHaveBeenCalledOnce();
    const input = runUnifiedPipelineMock.mock.calls[0][0] as { currencyInstruction?: string };
    // detectCurrency sees £ in the brief and builds the GBP instruction.
    expect(input.currencyInstruction).toContain('£ (GBP)');
  });

  it("uses hint even when brief has a different currency", async () => {
    runUnifiedPipelineMock.mockResolvedValue(makeStubResponse());

    // Brief has $ (USD) but hint says GBP — hint wins.
    await handleDraftGraph(
      'Comparing platform upgrade that costs about $100,000 against smaller patch.',
      {} as unknown as import("fastify").FastifyRequest,
      'turn_1',
      { userCurrencyHint: 'GBP' },
    );

    const input = runUnifiedPipelineMock.mock.calls[0][0] as { currencyInstruction?: string };
    expect(input.currencyInstruction).toContain('£ (GBP)');
    expect(input.currencyInstruction).not.toContain('$ (USD)');
  });

  it("emits the 'infer from context' instruction when neither hint nor brief signal exists", async () => {
    runUnifiedPipelineMock.mockResolvedValue(makeStubResponse());

    await handleDraftGraph(
      'Choosing whether to launch the new feature this quarter or next.',
      {} as unknown as import("fastify").FastifyRequest,
      'turn_1',
      { userCurrencyHint: null },
    );

    const input = runUnifiedPipelineMock.mock.calls[0][0] as { currencyInstruction?: string };
    // buildCurrencyInstruction(null) returns the "infer from context" string.
    expect(input.currencyInstruction).toContain('No specific currency was detected');
  });
});
