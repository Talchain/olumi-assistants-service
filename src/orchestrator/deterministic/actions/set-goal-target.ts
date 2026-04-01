/**
 * set_goal_target Action
 *
 * Update goal node threshold fields.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";

export const setGoalTargetAction: ActionDefinition = {
  action_type: 'set_goal_target',
  description: 'Set or update the goal target threshold.',
  stage_eligibility: new Set(['frame', 'ideate']),
  requires_target: false,
  requires_confirmation: false,
  execution_risk: 'low',
  reversible: true,
  surface: 'inline',
  role: 'facilitator',
  cooldown: 'none',
  input_schema: {
    type: 'object',
    properties: {
      threshold: { type: 'number', description: 'Target threshold value' },
      unit: { type: 'string', description: 'Optional unit label' },
      cap: { type: 'number', description: 'Optional upper cap' },
    },
    required: ['threshold'],
    additionalProperties: false,
  },

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.graph) return 'No decision model available.';
    if (!ctx.entities.goal_id) return 'No goal node in the model.';
    return null;
  },

  async execute(params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const threshold = params.threshold as number | undefined;
    const unit = params.unit as string | undefined;
    const cap = params.cap as number | undefined;

    if (threshold == null || typeof threshold !== 'number') {
      return { blocks: [], assistantText: 'What target threshold should the goal have?', guidance_items: [] };
    }

    const goalId = ctx.entities.goal_id!;
    const goalEntry = ctx.entities.nodes.get(goalId);

    const operations = [{
      op: 'update_node' as const,
      path: goalId,
      value: {
        goal_threshold: threshold,
        ...(unit ? { unit } : {}),
        ...(cap != null ? { cap } : {}),
      },
    }];

    return {
      blocks: [],
      assistantText: `Updated the goal target for **${goalEntry?.label ?? 'Goal'}** to ${threshold}.`,
      guidance_items: [],
      operations,
    };
  },

  chipLabel() { return 'Set goal target'; },
  chipPrompt(rec) {
    const t = rec.parameters?.threshold;
    return t != null ? `Set goal target to ${t}` : 'Set the goal target';
  },
};
