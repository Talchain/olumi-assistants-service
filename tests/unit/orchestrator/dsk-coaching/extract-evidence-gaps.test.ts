import { describe, it, expect, vi } from "vitest";

// Mock all dependencies of parallel-generate that aren't relevant
vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../../src/adapters/llm/router.js", () => ({
  getAdapter: vi.fn(),
  getMaxTokensFromConfig: vi.fn(() => 4096),
}));
vi.mock("../../../../src/config/timeouts.js", () => ({
  ORCHESTRATOR_TIMEOUT_MS: 30000,
}));
vi.mock("../../../../src/orchestrator/tools/draft-graph.js", () => ({
  handleDraftGraph: vi.fn(),
}));
vi.mock("../../../../src/orchestrator/envelope.js", () => ({
  assembleEnvelope: vi.fn(),
  buildTurnPlan: vi.fn(),
}));
vi.mock("../../../../src/orchestrator/idempotency.js", () => ({
  getIdempotentResponse: vi.fn(),
  setIdempotentResponse: vi.fn(),
  getInflightRequest: vi.fn(),
  registerInflightRequest: vi.fn(),
}));
vi.mock("../../../../src/orchestrator/brief-intelligence/extract.js", () => ({
  extractBriefIntelligence: vi.fn(),
}));
vi.mock("../../../../src/orchestrator/brief-intelligence/format.js", () => ({
  formatBilForCoaching: vi.fn(() => ""),
}));
vi.mock("../../../../src/config/index.js", () => ({
  config: { features: { bilEnabled: false, dskCoachingEnabled: false } },
}));
vi.mock("../../../../src/orchestrator/dsk-coaching/assemble-coaching-items.js", () => ({
  assembleDskCoachingItems: vi.fn(),
}));
vi.mock("../../../../src/orchestrator/dsk-loader.js", () => ({
  getClaimById: vi.fn(() => null),
  getProtocolById: vi.fn(() => null),
  getAllByType: vi.fn(() => []),
}));

import { extractEvidenceGapsFromGraph } from "../../../../src/orchestrator/parallel-generate.js";
import type { BriefIntelligence } from "../../../../src/schemas/brief-intelligence.js";

function makeBil(factors: Array<{ label: string; confidence: number }>): BriefIntelligence {
  return {
    contract_version: "1.0.0",
    goal: null,
    options: [],
    constraints: [],
    factors,
    completeness_band: "low",
    ambiguity_flags: [],
    missing_elements: [],
    dsk_cues: [],
  } as BriefIntelligence;
}

describe("extractEvidenceGapsFromGraph", () => {
  it("returns [] when BIL has no factors", () => {
    const gaps = extractEvidenceGapsFromGraph(makeBil([]), null);
    expect(gaps).toEqual([]);
  });

  it("maps BIL factors with null graph — uses BIL confidence", () => {
    const gaps = extractEvidenceGapsFromGraph(
      makeBil([{ label: "Revenue", confidence: 0.6 }]),
      null,
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0].factor_id).toBe("revenue");
    expect(gaps[0].factor_label).toBe("Revenue");
    expect(gaps[0].confidence).toBe(0.6);
  });

  it("matches graph node by label — uses graph exists_probability", () => {
    const graph = {
      nodes: [
        { id: "n1", label: "Revenue", exists_probability: 0.85 },
      ],
    } as never;

    const gaps = extractEvidenceGapsFromGraph(
      makeBil([{ label: "Revenue", confidence: 0.6 }]),
      graph,
    );
    expect(gaps[0].confidence).toBe(0.85); // from graph, not BIL
  });

  it("falls back to BIL confidence when graph node not matched", () => {
    const graph = {
      nodes: [
        { id: "n1", label: "Unrelated", exists_probability: 0.9 },
      ],
    } as never;

    const gaps = extractEvidenceGapsFromGraph(
      makeBil([{ label: "Custom factor", confidence: 0.7 }]),
      graph,
    );
    expect(gaps[0].confidence).toBe(0.7); // BIL fallback
  });

  it("always sets nullable fields to null", () => {
    const gaps = extractEvidenceGapsFromGraph(
      makeBil([{ label: "X", confidence: 0.5 }]),
      null,
    );
    expect(gaps[0].has_observed_value).toBeNull();
    expect(gaps[0].is_quantitative).toBeNull();
    expect(gaps[0].voi).toBeNull();
  });

  it("normalises factor_id: lowercase, spaces to underscores", () => {
    const gaps = extractEvidenceGapsFromGraph(
      makeBil([{ label: "Team Culture Fit", confidence: 0.5 }]),
      null,
    );
    expect(gaps[0].factor_id).toBe("team_culture_fit");
  });

  it("case-insensitive label matching against graph nodes", () => {
    const graph = {
      nodes: [
        { id: "n1", label: "REVENUE", exists_probability: 0.9 },
      ],
    } as never;

    const gaps = extractEvidenceGapsFromGraph(
      makeBil([{ label: "revenue", confidence: 0.5 }]),
      graph,
    );
    expect(gaps[0].confidence).toBe(0.9); // matched despite case difference
  });
});
