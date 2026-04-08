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
/** At most one deferred chip per turn; guarantees ≥2 proactive slots survive. */
const MAX_DEFERRED_CHIPS = 1;

/** Actions excluded from chip generation (stubs or not user-actionable). */
const EXCLUDED_FROM_CHIPS: ReadonlySet<ActionName> = new Set([
  'generate_artefact',
  'draft_graph', // draft_graph is triggered by generate_model, not chips
]);

/**
 * Stage-relevance filter: which actions are appropriate per decision stage.
 * Applied after priority ranking; chips outside the stage's allow-set are
 * dropped. Stages not present here (e.g. 'optimise', null) skip filtering.
 */
const STAGE_ALLOWED_ACTIONS: Record<string, ReadonlySet<ActionName>> = {
  // draft_graph is in EXCLUDED_FROM_CHIPS so is never a chip candidate.
  // add_option and adjust_edge_strength have stage_eligibility that excludes
  // frame, so they are omitted to avoid dead entries.
  // frame chips surface graph-building actions available in the framing stage.
  frame: new Set<ActionName>([
    'add_factor',
    'set_factor_value',
    'add_constraint',
    'set_goal_target',
  ]),
  // run_analysis has stage_eligibility ['evaluate', 'optimise'], so it cannot
  // appear in ideate via eligible_actions today. It is listed here as a
  // forward-compatible entry so it surfaces automatically if the action's
  // eligibility is ever extended to include ideate.
  ideate: new Set<ActionName>([
    'add_factor',
    'add_option',
    'adjust_edge_strength',
    'set_factor_value',
    'add_constraint',
    'run_analysis',
    'remove_factor',
    'set_goal_target',
  ]),
  evaluate: new Set<ActionName>([
    'explain_result',
    'compare_options',
    'what_would_flip',
    'run_premortem',
    'challenge_assumption',
    'set_factor_value',
    'adjust_edge_strength',
    'run_analysis',
  ]),
  // generate_artefact is in EXCLUDED_FROM_CHIPS so is never a chip candidate;
  // it is omitted here to avoid a misleading dead entry.
  decide: new Set<ActionName>([
    'run_premortem',
    'challenge_assumption',
    'compare_options',
  ]),
};

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
 * 5. Filter to actions relevant for the current stage
 * 6. Promote deferred actions (LLM-requested, not executed) to the front
 * 7. Cap at 3
 */
export function buildDeterministicChips(
  ctx: DeterministicTurnContext,
  executedAction?: ActionName | null,
  deferredActions: ActionName[] = [],
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
  let boosted = boostBySignals(candidates, ctx);

  // Stage-aware relevance filter (additive, after priority + boosting).
  // Skipped when stage is unknown so unfamiliar stages don't drop all chips.
  const stageAllowed = STAGE_ALLOWED_ACTIONS[ctx.stage];
  if (stageAllowed) {
    boosted = boosted.filter((c) => stageAllowed.has(c.name));
  }

  // Promote deferred actions (compound calls discarded by one-tool-per-turn)
  // to the front of the chip list so the user can resume the unfulfilled
  // intent on the next turn. Capped at MAX_DEFERRED_CHIPS (1) so proactive
  // coaching chips always retain ≥2 of the 3 available slots. Only the first
  // deferred action is promoted — it is the LLM's immediate next intent; any
  // further discarded calls are lower-signal and not worth displacing.
  if (deferredActions.length > 0) {
    const seen = new Set(boosted.map((c) => c.name));
    const promoted: Array<{ name: ActionName; priority: number }> = [];
    for (const name of deferredActions) {
      if (promoted.length >= MAX_DEFERRED_CHIPS) break;
      if (recentSet.has(name)) continue;
      if (EXCLUDED_FROM_CHIPS.has(name)) continue;
      if (!ACTION_CATALOGUE.get(name)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      promoted.push({ name, priority: -1 });
    }
    boosted = [...promoted, ...boosted];
  }

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
