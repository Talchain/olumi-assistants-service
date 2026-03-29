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

export interface ChipAssemblerResult {
  chips: SuggestedAction[];
  /** Action types that were recommended by the LLM but stripped (deduped per turn). */
  strippedActions: string[];
}

/**
 * Build suggested action chips from LLM recommended_actions.
 *
 * Filters:
 * - Must be a valid action in the catalogue
 * - Must be in eligible_actions for this turn
 * - Must not be in recent_actions_taken (suppress repeats)
 * - Capped at 3
 *
 * Returns both the chips and a list of stripped action types (deduped).
 */
export function buildChipsFromRecommendations(
  recommendations: LLMRecommendedAction[],
  ctx: DeterministicTurnContext,
): ChipAssemblerResult {
  const eligibleSet = new Set(ctx.eligible_actions);
  const recentSet = new Set(ctx.conversation.recent_actions_taken);
  const chips: SuggestedAction[] = [];
  const strippedSet = new Set<string>();

  for (const rec of recommendations) {
    if (chips.length >= MAX_CHIPS) break;

    const actionType = rec.action_type;

    // Validate action exists in catalogue
    if (!isValidAction(actionType)) {
      strippedSet.add(actionType);
      continue;
    }

    // Must be eligible this turn
    if (!eligibleSet.has(actionType as ActionName)) {
      strippedSet.add(actionType);
      continue;
    }

    // Suppress if recently taken
    if (recentSet.has(actionType)) continue;

    const definition = ACTION_CATALOGUE.get(actionType as ActionName);
    if (!definition) continue;

    // Extract typed fields from discriminated union into generic params
    const { action_type: _at, priority: _p, rationale, ...rest } = rec;
    const parameters: Record<string, unknown> = { ...rest };

    const actionRec: ActionRecommendation = {
      action_type: actionType as ActionName,
      target_id: 'target_id' in rec ? (rec.target_id as string) : undefined,
      parameters,
      rationale,
    };

    chips.push({
      label: definition.chipLabel(actionRec),
      prompt: definition.chipPrompt(actionRec),
      role: definition.role,
      action_type: actionRec.action_type,
      parameters,
    });
  }

  return { chips, strippedActions: [...strippedSet] };
}
