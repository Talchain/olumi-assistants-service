import type { GraphV1 } from "../../contracts/plot/engine.js";

export interface ConvergenceInput {
  currentGraph: GraphV1;
  previousGraph: GraphV1 | null;
  qualityScore: number;
  roundCount: number;
  maxRounds: number;
  previousQualityScore?: number;
}

export type ConvergenceStatus = "complete" | "max_rounds" | "confident";
export type ConvergenceReason =
  | "quality_threshold"
  | "stability"
  | "max_rounds"
  | "diminishing_returns"
  | "continue";

export interface ConvergenceDecision {
  should_continue: boolean;
  status: ConvergenceStatus;
  reason: ConvergenceReason;
  confidence: number;
}

export interface ConvergenceThresholds {
  qualityComplete: number;
  stabilityThreshold: number;
  minImprovement: number;
  minRoundsBeforeEarlyStop: number;
}

const DEFAULT_THRESHOLDS: ConvergenceThresholds = {
  qualityComplete: 8.0,
  stabilityThreshold: 2,
  minImprovement: 0.5,
  minRoundsBeforeEarlyStop: 2,
};

function countGraphChanges(current: GraphV1, previous: GraphV1 | null): number {
  if (!previous) return Infinity;

  const currentNodes = new Set(
    (current.nodes ?? []).map((n) => (n as any).id as string)
  );
  const previousNodes = new Set(
    (previous.nodes ?? []).map((n) => (n as any).id as string)
  );

  const currentEdges = new Set(
    ((current as any).edges ?? []).map(
      (e: any) => `${e.from}->${e.to}`
    )
  );
  const previousEdges = new Set(
    ((previous as any).edges ?? []).map(
      (e: any) => `${e.from}->${e.to}`
    )
  );

  let changes = 0;

  // Count added nodes
  for (const id of currentNodes) {
    if (!previousNodes.has(id)) changes++;
  }
  // Count removed nodes
  for (const id of previousNodes) {
    if (!currentNodes.has(id)) changes++;
  }
  // Count added edges
  for (const edge of currentEdges) {
    if (!previousEdges.has(edge)) changes++;
  }
  // Count removed edges
  for (const edge of previousEdges) {
    if (!currentEdges.has(edge)) changes++;
  }

  return changes;
}

export function detectConvergence(
  input: ConvergenceInput,
  thresholds: Partial<ConvergenceThresholds> = {}
): ConvergenceDecision {
  const config = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const {
    currentGraph,
    previousGraph,
    qualityScore,
    roundCount,
    maxRounds,
    previousQualityScore,
  } = input;

  // Rule 1: Quality threshold met - complete
  if (qualityScore >= config.qualityComplete) {
    return {
      should_continue: false,
      status: "complete",
      reason: "quality_threshold",
      confidence: Math.min(1, qualityScore / 10),
    };
  }

  // Rule 2: Max rounds reached - stop
  if (roundCount >= maxRounds) {
    return {
      should_continue: false,
      status: "max_rounds",
      reason: "max_rounds",
      confidence: qualityScore / 10,
    };
  }

  // Rule 3: Graph stability - few changes from previous round
  if (previousGraph) {
    const changes = countGraphChanges(currentGraph, previousGraph);
    if (changes <= config.stabilityThreshold) {
      return {
        should_continue: false,
        status: "complete",
        reason: "stability",
        confidence: Math.min(1, qualityScore / 10 + 0.1),
      };
    }
  }

  // Rule 4: Diminishing returns - minimal quality improvement after min rounds
  if (
    roundCount >= config.minRoundsBeforeEarlyStop &&
    previousQualityScore !== undefined
  ) {
    const improvement = qualityScore - previousQualityScore;
    if (improvement < config.minImprovement) {
      return {
        should_continue: false,
        status: "complete",
        reason: "diminishing_returns",
        confidence: qualityScore / 10,
      };
    }
  }

  // Default: continue asking
  return {
    should_continue: true,
    status: "confident",
    reason: "continue",
    confidence: qualityScore / 10,
  };
}
