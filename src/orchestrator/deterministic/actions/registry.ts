/**
 * Action Catalogue Registry
 *
 * Central registry of all 14 deterministic actions with metadata and handlers.
 * Each action is a self-contained module; this file collects them into a Map.
 */

import type { ActionDefinition, ActionName } from "./types.js";
import { setFactorValueAction } from "./set-factor-value.js";
import { addConstraintAction } from "./add-constraint.js";
import { addFactorAction } from "./add-factor.js";
import { adjustEdgeStrengthAction } from "./adjust-edge-strength.js";
import { addOptionAction } from "./add-option.js";
import { removeFactorAction } from "./remove-factor.js";
import { setGoalTargetAction } from "./set-goal-target.js";
import { runAnalysisAction } from "./run-analysis.js";
import { explainResultAction } from "./explain-result.js";
import { compareOptionsAction } from "./compare-options.js";
import { challengeAssumptionAction } from "./challenge-assumption.js";
import { runPremortemAction } from "./run-premortem.js";
import { whatWouldFlipAction } from "./what-would-flip.js";
import { generateArtefactAction } from "./generate-artefact.js";
import { draftGraphAction } from "./draft-graph.js";
import { editGraphAction } from "./edit-graph.js";

// ============================================================================
// Catalogue
// ============================================================================

export const ACTION_CATALOGUE: ReadonlyMap<ActionName, ActionDefinition> = new Map<ActionName, ActionDefinition>([
  ['set_factor_value', setFactorValueAction],
  ['add_constraint', addConstraintAction],
  ['add_factor', addFactorAction],
  ['adjust_edge_strength', adjustEdgeStrengthAction],
  ['add_option', addOptionAction],
  ['remove_factor', removeFactorAction],
  ['set_goal_target', setGoalTargetAction],
  ['run_analysis', runAnalysisAction],
  ['explain_result', explainResultAction],
  ['compare_options', compareOptionsAction],
  ['challenge_assumption', challengeAssumptionAction],
  ['run_premortem', runPremortemAction],
  ['what_would_flip', whatWouldFlipAction],
  ['generate_artefact', generateArtefactAction],
  ['draft_graph', draftGraphAction],
  ['edit_graph', editGraphAction],
]);

// ============================================================================
// Lookup helpers
// ============================================================================

export function getAction(name: ActionName): ActionDefinition | undefined {
  return ACTION_CATALOGUE.get(name);
}

export function isValidAction(name: string): name is ActionName {
  return ACTION_CATALOGUE.has(name as ActionName);
}

export function getEligibleActions(eligibleNames: ActionName[]): ActionDefinition[] {
  return eligibleNames
    .map((name) => ACTION_CATALOGUE.get(name))
    .filter((a): a is ActionDefinition => a != null);
}
