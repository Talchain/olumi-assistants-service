/**
 * Action Catalogue Types
 *
 * Defines the ActionDefinition interface and ActionName union
 * for the 14 deterministic actions in the catalogue.
 */

import type { DeterministicTurnContext, ActionResult } from "../types.js";

// ============================================================================
// Action Names
// ============================================================================

export const ACTION_NAMES = [
  'set_factor_value',
  'add_constraint',
  'add_factor',
  'adjust_edge_strength',
  'add_option',
  'remove_factor',
  'set_goal_target',
  'run_analysis',
  'explain_result',
  'compare_options',
  'challenge_assumption',
  'run_premortem',
  'what_would_flip',
  'generate_artefact',
] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

// ============================================================================
// Execution Risk
// ============================================================================

export type ExecutionRisk = 'none' | 'low' | 'moderate' | 'high';

// ============================================================================
// Action Surface
// ============================================================================

export type ActionSurface = 'inline' | 'proposal_card' | 'panel' | 'artefact';

// ============================================================================
// Action Role
// ============================================================================

export type ActionRole = 'facilitator' | 'challenger' | 'scientist';

// ============================================================================
// Cooldown
// ============================================================================

export type ActionCooldown = 'none' | 'suppress_same_turn' | 'suppress_until_state_change';

// ============================================================================
// Stage Eligibility
// ============================================================================

import type { DecisionStage } from "../../types.js";

// ============================================================================
// Action Recommendation (from LLM)
// ============================================================================

export interface ActionRecommendation {
  action_type: ActionName;
  target_id?: string;
  parameters?: Record<string, unknown>;
  rationale?: string;
}

// ============================================================================
// Action Definition
// ============================================================================

export interface ActionDefinition {
  action_type: ActionName;
  description: string;
  stage_eligibility: ReadonlySet<DecisionStage>;
  requires_target: boolean;
  requires_confirmation: boolean;
  execution_risk: ExecutionRisk;
  reversible: boolean;
  surface: ActionSurface;
  role: ActionRole;
  cooldown: ActionCooldown;

  /**
   * Check prerequisites. Returns null if ok, or an error message string.
   */
  prerequisite_checks: (ctx: DeterministicTurnContext) => string | null;

  /**
   * Execute the action. Receives typed params + resolved target + context.
   */
  execute: (
    params: Record<string, unknown>,
    ctx: DeterministicTurnContext,
  ) => Promise<ActionResult>;

  /**
   * Compute the chip label for this action when recommended.
   */
  chipLabel: (rec: ActionRecommendation) => string;

  /**
   * Compute the chip prompt (the user message sent when clicked).
   */
  chipPrompt: (rec: ActionRecommendation) => string;
}
