/**
 * Operation builder for the deterministic `add_risk` edit template.
 *
 * Produces three operations from a (label, graph) pair:
 *   1. add_node — risk_<slug> with kind: 'risk'
 *   2. add_edge — decision -> risk (positive bridge; satisfies
 *      validateGraphStructure's NO_PATH_TO_GOAL check, since a risk with
 *      only an outbound edge to the goal is not reachable from the
 *      decision via directed paths)
 *   3. add_edge — risk -> goal (NEGATIVE bridge; risks hurt the goal,
 *      matches the A5 sign convention from commit 82b96b61)
 *
 * If the graph has no goal node OR no decision node, throws
 * TemplateBuildError so the caller can fall through to the LLM path.
 *
 * No causal source connections are invented. The confirmation message
 * (built by `buildAddRiskConfirmation`) explicitly asks the user what
 * factors drive the risk, so the user — not the system — specifies the
 * causal structure on the next turn.
 */

import type { GraphV3T } from "../../../schemas/cee-v3.js";
import type { PatchOperation } from "../../../orchestrator/types.js";
import { riskNodeIdFor } from "./classify-add-risk.js";

export class TemplateBuildError extends Error {
  readonly code: 'no_goal' | 'no_decision';
  constructor(code: 'no_goal' | 'no_decision', message: string) {
    super(message);
    this.code = code;
    this.name = 'TemplateBuildError';
  }
}

export interface AddRiskOperationsResult {
  operations: PatchOperation[];
  riskNodeId: string;
  goalId: string;
  decisionId: string;
}

// Default edge parameters — match the typical magnitudes draft_graph
// emits for non-structural causal edges. The risk -> goal edge uses a
// negative mean so a downstream effect-direction reading agrees with
// the sign (risk reduces goal probability).
const DECISION_TO_RISK_STRENGTH_MEAN = 0.3;
const DECISION_TO_RISK_STRENGTH_STD = 0.15;
const DECISION_TO_RISK_EXISTS_PROBABILITY = 0.7;

const RISK_TO_GOAL_STRENGTH_MEAN = -0.3;
const RISK_TO_GOAL_STRENGTH_STD = 0.15;
const RISK_TO_GOAL_EXISTS_PROBABILITY = 0.8;

export function buildAddRiskOperations(label: string, graph: GraphV3T): AddRiskOperationsResult {
  const goal = graph.nodes.find((n) => n.kind === 'goal');
  if (!goal) {
    throw new TemplateBuildError('no_goal', 'add_risk template requires a goal node in the graph');
  }
  const decision = graph.nodes.find((n) => n.kind === 'decision');
  if (!decision) {
    throw new TemplateBuildError('no_decision', 'add_risk template requires a decision node in the graph');
  }

  const riskId = riskNodeIdFor(label);

  // patch-applier.applyAddNode reads op.path AS the node ID (no prefix).
  // applyAddEdge does not consume op.path; it reads value.from / value.to.
  // Match the existing convention used by the LLM edit path.
  const operations: PatchOperation[] = [
    {
      op: 'add_node',
      path: riskId,
      value: { id: riskId, kind: 'risk', label },
    },
    {
      op: 'add_edge',
      path: `${decision.id}::${riskId}`,
      value: {
        from: decision.id,
        to: riskId,
        strength: { mean: DECISION_TO_RISK_STRENGTH_MEAN, std: DECISION_TO_RISK_STRENGTH_STD },
        exists_probability: DECISION_TO_RISK_EXISTS_PROBABILITY,
        effect_direction: 'positive',
      },
    },
    {
      op: 'add_edge',
      path: `${riskId}::${goal.id}`,
      value: {
        from: riskId,
        to: goal.id,
        strength: { mean: RISK_TO_GOAL_STRENGTH_MEAN, std: RISK_TO_GOAL_STRENGTH_STD },
        exists_probability: RISK_TO_GOAL_EXISTS_PROBABILITY,
        effect_direction: 'negative',
      },
    },
  ];

  return { operations, riskNodeId: riskId, goalId: goal.id, decisionId: decision.id };
}

export function buildAddRiskConfirmation(label: string): string {
  return (
    `I've added '${label}' as a risk to your model, connected to the goal. ` +
    `What factors drive this risk? For example, does it increase with team size or budget?`
  );
}
