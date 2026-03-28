/**
 * add_factor Action
 *
 * Build add_node + add_edge ops. Requires confirmation.
 * CEE code sets all field names — no LLM-generated patches.
 */

import { randomUUID } from "node:crypto";
import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";
import type { PatchOperation } from "../../types.js";

export const addFactorAction: ActionDefinition = {
  action_type: 'add_factor',
  description: 'Add a new factor node to the decision model.',
  stage_eligibility: new Set(['frame', 'ideate']),
  requires_target: false,
  requires_confirmation: true,
  execution_risk: 'moderate',
  reversible: true,
  surface: 'proposal_card',
  role: 'facilitator',
  cooldown: 'suppress_same_turn',

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.graph) return 'No decision model available.';
    return null;
  },

  async execute(params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const label = params.label as string | undefined;
    const value = params.value as number | undefined;
    const unit = params.unit as string | undefined;
    const category = (params.category as string) ?? 'observable';
    const connectTo = params.connect_to as string | undefined;

    if (!label) {
      return { blocks: [], assistantText: 'What should the new factor be called?', guidance_items: [] };
    }

    // Generate canonical node ID
    const nodeId = `factor_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`;

    const operations: PatchOperation[] = [
      {
        op: 'add_node',
        path: nodeId,
        value: {
          id: nodeId,
          kind: 'factor',
          label,
          category,
          ...(value != null || unit ? {
            observed_state: {
              ...(value != null ? { value } : {}),
              ...(unit ? { unit } : {}),
            },
          } : {}),
        },
      },
    ];

    // Add edge to goal or specified target
    const targetId = connectTo ?? ctx.entities.goal_id;
    if (targetId) {
      operations.push({
        op: 'add_edge',
        path: `${nodeId}->${targetId}`,
        value: {
          from: nodeId,
          to: targetId,
          strength: { mean: 0.5, std: 0.15 },
          exists_probability: 0.8,
          effect_direction: 'positive',
        },
      });
    }

    const unitStr = unit ? ` ${unit}` : '';
    const valueStr = value != null ? ` (value: ${value}${unitStr})` : '';

    return {
      blocks: [],
      assistantText: `I'll add **${label}**${valueStr} as a ${category} factor. Please confirm.`,
      guidance_items: [],
      operations,
    };
  },

  chipLabel() { return 'Add factor'; },
  chipPrompt(rec) {
    return rec.parameters?.label ? `Add a factor for ${rec.parameters.label}` : 'Add a new factor';
  },
};
