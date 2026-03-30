/**
 * Stage Transition Evaluator
 *
 * Evaluates whether the stage should change based on what happened this turn.
 */

import type { DecisionStage, ToolResult, StageIndicator } from "../types.js";

export interface StageTransition {
  from: DecisionStage;
  to: DecisionStage;
  trigger: string;
}

/**
 * Evaluate whether a stage transition should occur based on tool results.
 *
 * Rules:
 * - Analysis ran AND we were in frame or ideate → transition to evaluate
 * - Brief generated AND we were in evaluate → transition to decide
 * - Otherwise no transition
 */
export function evaluateStageTransition(
  currentStage: StageIndicator,
  toolResult: ToolResult,
): StageTransition | null {
  const stage = currentStage.stage;

  if (toolResult.side_effects.analysis_ran) {
    if (stage === 'frame' || stage === 'ideate') {
      return {
        from: stage,
        to: 'evaluate',
        trigger: 'analysis_completed',
      };
    }
  }

  // brief_generated does NOT auto-promote to 'decide'.
  // Stage should only transition to 'decide' on explicit user commitment language,
  // not because an artefact was generated. Generating a brief is an informational
  // action that doesn't imply the user has committed to a decision.

  return null;
}
