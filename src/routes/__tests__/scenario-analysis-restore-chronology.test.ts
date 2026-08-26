import { beforeEach, describe, expect, it, vi } from "vitest";

const SCENARIO_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const readRecent = vi.fn();
const readFactsFor = vi.fn();
const readAnalysisInvalidatedAt = vi.fn();

vi.mock("../../orchestrator-v5/session/index.js", () => ({
  getSessionStore: () => ({
    readRecent,
    readFactsFor,
    readAnalysisInvalidatedAt,
  }),
}));

vi.mock("../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { computeAnalysisAffectingGraphHash } from "../../orchestrator-v5/context/graph-hash.js";
import { readScenarioAnalysis } from "../scenario-graph-analysis-read.js";

const GRAPH = {
  nodes: [
    { id: "goal-a", kind: "goal", label: "Growth" },
    { id: "option-a", kind: "option", label: "Expand" },
  ],
  edges: [],
};
const ANALYSIS_HASH = computeAnalysisAffectingGraphHash(GRAPH as never)!;

function analysisFact(computedAt: string) {
  return {
    fact_type: "run_analysis",
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: "option-a",
      summary: "Expand leads on the current model.",
      graph_hash_at_run: ANALYSIS_HASH,
      computed_at: computedAt,
      win_probabilities: { "option-a": 1 },
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: "evaluated_feasible",
      },
      enrichment: {
        analysis_status: "ok",
        robustness: { level: "strong", near_tie: false },
        option_comparison: [
          {
            option_id: "option-a",
            option_label: "Expand",
            win_probability: 1,
            outcome_mean: 0.8,
          },
        ],
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readRecent.mockResolvedValue([{ id: "turn-row" }]);
  readAnalysisInvalidatedAt.mockResolvedValue("2026-08-24T10:05:00.000Z");
});

describe("scenario analysis restore chronology", () => {
  it("keeps a matching pre-restore analysis stale on reload", async () => {
    readFactsFor.mockResolvedValue([analysisFact("2026-08-24T10:00:00.000Z")]);

    const read = await readScenarioAnalysis({
      scenarioId: SCENARIO_ID,
      graph: GRAPH,
      requestId: "restore-reload",
    });

    expect(readAnalysisInvalidatedAt).toHaveBeenCalledWith(SCENARIO_ID);
    expect(read.analysis_state?.run_state).toEqual({
      kind: "complete_stale",
      computed_at: "2026-08-24T10:00:00.000Z",
      cause: "graph_changed",
    });
    expect(read.analysis_result).toBeNull();
  });

  it("makes a matching analysis current only after a later rerun", async () => {
    readFactsFor.mockResolvedValue([
      analysisFact("2026-08-24T10:06:00.000Z"),
      analysisFact("2026-08-24T10:00:00.000Z"),
    ]);

    const read = await readScenarioAnalysis({
      scenarioId: SCENARIO_ID,
      graph: GRAPH,
      requestId: "post-restore-rerun",
    });

    expect(read.analysis_state?.run_state).toEqual({
      kind: "complete_current",
      computed_at: "2026-08-24T10:06:00.000Z",
    });
    expect(read.analysis_result).not.toBeNull();
  });
});
