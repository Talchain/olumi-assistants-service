import type { components } from "../../generated/openapi.d.ts";
import type { GraphV1 } from "../../contracts/plot/engine.js";
import { summariseValidationIssues } from "../validation/classifier.js";

type CEEQualityMeta = components["schemas"]["CEEQualityMeta"];
type CEEValidationIssue = components["schemas"]["CEEValidationIssue"];

export type CeeQualityBand = "confident" | "uncertain" | "low_confidence";

export interface QualityInputs {
  graph: GraphV1 | undefined;
  confidence: number;
  engineIssueCount: number;
  ceeIssues: CEEValidationIssue[];
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(10, Math.max(1, Math.round(value)));
}

export function getCeeQualityBand(overall: number): CeeQualityBand {
  const score = clampScore(overall);

  if (score >= 7) {
    return "confident";
  }

  if (score >= 4) {
    return "uncertain";
  }

  return "low_confidence";
}

function countNodesByKind(graph: GraphV1 | undefined, kind: string): number {
  if (!graph || !Array.isArray(graph.nodes)) return 0;
  return (graph.nodes as any[]).filter((n) => n && (n as any).kind === kind).length;
}

/**
 * Compute CEE quality metrics from existing engine and graph data.
 *
 * Heuristics (cheap, deterministic, v1.0):
 * - overall: derived directly from engine confidence (0–1 → 1–10).
 * - structure: favours graphs with enough nodes and edges (connected, non-trivial).
 * - coverage: favours graphs with multiple options and some risks/outcomes.
 * - safety: penalises the presence of CEE validation issues (up to -3 points).
 * - structural_proxy: currently mirrors structure as a coarse proxy for cause/effect richness.
 */
export function computeQuality(inputs: QualityInputs): CEEQualityMeta {
  const { graph, confidence, engineIssueCount, ceeIssues } = inputs;

  const safeConfidence = Number.isFinite(confidence) ? confidence : 0.7;
  const overall = clampScore(safeConfidence * 10);

  const nodeCount = graph && Array.isArray(graph.nodes) ? graph.nodes.length : 0;
  const edgeCount = graph && Array.isArray(graph.edges) ? graph.edges.length : 0;

  const optionCount = countNodesByKind(graph, "option");
  const riskCount = countNodesByKind(graph, "risk");
  const outcomeCount = countNodesByKind(graph, "outcome");

  // Structure: start from 7, reward non-trivial, connected-ish graphs, penalise tiny ones.
  let structureBase = 7;
  if (nodeCount < 3) {
    structureBase -= 2;
  } else if (nodeCount >= 3 && nodeCount <= 12) {
    structureBase += 1;
  }
  if (edgeCount < Math.max(0, nodeCount - 1)) {
    structureBase -= 1;
  } else if (edgeCount >= nodeCount - 1 && nodeCount > 1) {
    structureBase += 1;
  }
  const structure = clampScore(structureBase);

  // Coverage: start from 6, reward multiple options and presence of risks/outcomes.
  let coverageBase = 6;
  if (optionCount === 0) {
    coverageBase -= 2;
  } else if (optionCount === 1) {
    coverageBase += 0; // neutral
  } else if (optionCount >= 2 && optionCount <= 6) {
    coverageBase += 2;
  }
  if (riskCount > 0) {
    coverageBase += 1;
  }
  if (outcomeCount > 0) {
    coverageBase += 1;
  }
  const coverage = clampScore(coverageBase);

  // Safety: start from 8 and subtract up to 3 points for CEE validation issues.
  const summary = summariseValidationIssues(Array.isArray(ceeIssues) ? ceeIssues : []);
  const ceeIssueCount = summary.error_count + summary.warning_count + summary.info_count;
  const safetyBase = 8 - Math.min(3, ceeIssueCount);
  const safety = clampScore(safetyBase);

  // Renamed from 'causality' — this score measures structural completeness, not causal validity. A genuine causality score requires scientific definition (see roadmap B5.28b).
  const structural_proxy = structure;

  return {
    overall,
    structure,
    structural_proxy,
    coverage,
    safety,
    issues_by_severity: {
      error: summary.error_count,
      warning: summary.warning_count,
      info: summary.info_count,
    },
    details: {
      raw_confidence: safeConfidence,
      engine_issue_count: engineIssueCount,
      cee_issue_count: ceeIssueCount,
      node_count: nodeCount,
      edge_count: edgeCount,
      option_count: optionCount,
      risk_count: riskCount,
      outcome_count: outcomeCount,
    },
  };
}
