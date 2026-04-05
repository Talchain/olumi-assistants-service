/**
 * Deterministic Chip Builder (v4)
 *
 * Builds SuggestedAction chips entirely from code — no LLM input.
 * Chips are derived from TurnContext eligible actions filtered by
 * recent execution, context signals, and cooldown policy.
 */

import type { SuggestedAction } from "../types.js";
import type { ActionName } from "./actions/types.js";
import type { DeterministicTurnContext } from "./types.js";
import { ACTION_CATALOGUE } from "./actions/registry.js";

const MAX_CHIPS = 3;

/** Actions excluded from chip generation (stubs or not user-actionable). */
const EXCLUDED_FROM_CHIPS: ReadonlySet<ActionName> = new Set([
  'generate_artefact',
  'draft_graph', // draft_graph is triggered by generate_model, not chips
]);

/**
 * Priority tiers for chip ordering.
 * Lower number = higher priority in the chip bar.
 */
const CHIP_PRIORITY: Partial<Record<ActionName, number>> = {
  run_analysis: 1,
  explain_result: 2,
  compare_options: 3,
  what_would_flip: 4,
  challenge_assumption: 5,
  run_premortem: 6,
  set_factor_value: 7,
  add_factor: 8,
  add_option: 8,
  add_constraint: 9,
  adjust_edge_strength: 9,
  remove_factor: 10,
  set_goal_target: 10,
};

/**
 * Build suggested action chips deterministically from TurnContext.
 *
 * Rules:
 * 1. Only eligible actions (passed prerequisites + stage policy)
 * 2. Exclude recently executed actions (cooldown: suppress_same_turn)
 * 3. Exclude stub/internal actions
 * 4. Promote signal-driven actions (e.g. run_analysis when model changed)
 * 5. Cap at 3
 */
export function buildDeterministicChips(
  ctx: DeterministicTurnContext,
  executedAction?: ActionName | null,
): SuggestedAction[] {
  const recentSet = new Set(ctx.conversation.recent_actions_taken);
  if (executedAction) recentSet.add(executedAction);

  const candidates: Array<{ name: ActionName; priority: number }> = [];

  for (const name of ctx.eligible_actions) {
    if (EXCLUDED_FROM_CHIPS.has(name)) continue;
    if (recentSet.has(name)) continue;

    const def = ACTION_CATALOGUE.get(name);
    if (!def) continue;

    candidates.push({
      name,
      priority: CHIP_PRIORITY[name] ?? 99,
    });
  }

  // Sort by priority (lower number = higher priority)
  candidates.sort((a, b) => a.priority - b.priority);

  // Boost signal-driven actions to top
  const boosted = boostBySignals(candidates, ctx);

  // Take top 3
  const chips: SuggestedAction[] = [];
  for (const candidate of boosted.slice(0, MAX_CHIPS)) {
    const def = ACTION_CATALOGUE.get(candidate.name)!;
    const dummyRec = { action_type: candidate.name };

    chips.push({
      label: def.chipLabel(dummyRec),
      prompt: def.chipPrompt(dummyRec),
      role: def.role,
      action_type: candidate.name,
    });
  }

  return chips;
}

/**
 * Boost signal-driven actions to the front of the list.
 */
function boostBySignals(
  candidates: Array<{ name: ActionName; priority: number }>,
  ctx: DeterministicTurnContext,
): Array<{ name: ActionName; priority: number }> {
  const result = [...candidates];

  for (const c of result) {
    // Boost run_analysis when model has changed and no recent analysis
    if (c.name === 'run_analysis' && !ctx.analysis_summary) {
      c.priority = 0;
    }
    // Deprioritise run_analysis when analysis is complete and current —
    // explanation and comparison chips should dominate post-analysis.
    // Do not deprioritise when analysis_summary is null (stale/absent).
    if (c.name === 'run_analysis' && ctx.analysis_summary && ctx.capabilities.can_explain_results) {
      c.priority = 8;
    }
    // Boost explain_result right after analysis completes
    if (c.name === 'explain_result' && ctx.analysis_summary && ctx.conversation.recent_actions_taken.includes('run_analysis')) {
      c.priority = 0;
    }
    // Boost challenge_assumption when there's a dominant factor
    if (c.name === 'challenge_assumption' && ctx.signals.dominant_factor) {
      c.priority = Math.min(c.priority, 2);
    }
    // Boost what_would_flip when it's a close call
    if (c.name === 'what_would_flip' && ctx.signals.close_call) {
      c.priority = Math.min(c.priority, 2);
    }
  }

  result.sort((a, b) => a.priority - b.priority);
  return result;
}
