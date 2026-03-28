/**
 * Chip Assembler
 *
 * Builds SuggestedAction chips from validated LLM recommendations
 * using catalogue metadata.
 */

import type { SuggestedAction } from "../types.js";
import type { ActionRecommendation, ActionName } from "./actions/types.js";
import type { LLMRecommendedAction, DeterministicTurnContext } from "./types.js";
import { ACTION_CATALOGUE, isValidAction } from "./actions/registry.js";

// ============================================================================
// Constants
// ============================================================================

const MAX_CHIPS = 3;

// ============================================================================
// Public API
// ============================================================================

/**
 * Build suggested action chips from LLM recommended_actions.
 *
 * Filters:
 * - Must be a valid action in the catalogue
 * - Must be in eligible_actions for this turn
 * - Must not be in recent_actions_taken (suppress repeats)
 * - Capped at 3
 */
export function buildChipsFromRecommendations(
  recommendations: LLMRecommendedAction[],
  ctx: DeterministicTurnContext,
): SuggestedAction[] {
  const eligibleSet = new Set(ctx.eligible_actions);
  const recentSet = new Set(ctx.conversation.recent_actions_taken);
  const chips: SuggestedAction[] = [];

  for (const rec of recommendations) {
    if (chips.length >= MAX_CHIPS) break;

    const actionType = rec.action_type;

    // Validate action exists in catalogue
    if (!isValidAction(actionType)) continue;

    // Must be eligible this turn
    if (!eligibleSet.has(actionType as ActionName)) continue;

    // Suppress if recently taken
    if (recentSet.has(actionType)) continue;

    const definition = ACTION_CATALOGUE.get(actionType as ActionName);
    if (!definition) continue;

    const actionRec: ActionRecommendation = {
      action_type: actionType as ActionName,
      target_id: rec.target_id,
      parameters: rec.parameters,
      rationale: rec.rationale,
    };

    chips.push({
      label: definition.chipLabel(actionRec),
      prompt: definition.chipPrompt(actionRec),
      role: definition.role === 'scientist' ? 'facilitator' : definition.role,
    });
  }

  return chips;
}
