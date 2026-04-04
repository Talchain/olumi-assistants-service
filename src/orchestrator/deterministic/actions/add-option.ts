/**
 * add_option Action
 *
 * Build multi-op patch (add_node + structural edges + interventions).
 * Requires confirmation. Structural edges use fixed params.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";
import type { PatchOperation } from "../../types.js";

export const addOptionAction: ActionDefinition = {
  action_type: 'add_option',
  description: 'Add a new option to the decision model.',
  stage_eligibility: new Set(['ideate']),
  requires_target: false,
  requires_confirmation: true,
  execution_risk: 'high',
  reversible: true,
  surface: 'proposal_card',
  role: 'facilitator',
  cooldown: 'suppress_same_turn',
  input_schema: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'Name for the new option' },
      interventions: {
        type: 'array',
        description: 'Factor-level intervention overrides',
        items: {
          type: 'object',
          properties: {
            factor_id: { type: 'string', description: 'Target factor ID' },
            value: { type: 'number', description: 'Numeric intervention value' },
          },
          required: ['factor_id', 'value'],
          additionalProperties: false,
        },
      },
    },
    required: ['label'],
    additionalProperties: false,
  },

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.graph) return 'No decision model available.';
    return null;
  },

  async execute(params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const label = params.label as string | undefined;

    if (!label) {
      return { blocks: [], assistantText: 'What should the new option be called?', guidance_items: [] };
    }

    // Normalize interventions: accept both array format (new) and legacy object format
    let interventions: Record<string, number> = {};
    const rawInterventions = params.interventions;

    if (Array.isArray(rawInterventions)) {
      // New array format: [{ factor_id, value }, ...]
      for (const item of rawInterventions) {
        if (item && typeof item === 'object') {
          const factorId = (item as Record<string, unknown>).factor_id;
          const value = (item as Record<string, unknown>).value;
          if (typeof factorId === 'string' && typeof value === 'number') {
            interventions[factorId] = value;
          }
        }
      }
    } else if (rawInterventions && typeof rawInterventions === 'object') {
      // Legacy object format: { factor_id → value }
      interventions = rawInterventions as Record<string, number>;
    }

    const nodeId = `option_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`;

    const operations: PatchOperation[] = [
      {
        op: 'add_node',
        path: nodeId,
        value: {
          id: nodeId,
          kind: 'option',
          label,
          data: { interventions },
        },
      },
    ];

    // No option→goal edge — forbidden by platform STRUCTURAL_RULES.
    // Options connect to factors only; factor→outcome→goal paths already exist.

    // Intervention edges to factors
    if (Object.keys(interventions).length > 0) {
      for (const [factorId, value] of Object.entries(interventions)) {
        operations.push({
          op: 'add_edge',
          path: `${nodeId}->${factorId}`,
          value: {
            from: nodeId,
            to: factorId,
            strength: { mean: 1.0, std: 0.01 },
            exists_probability: 1.0,
            effect_direction: 'positive',
          },
        });
      }
    }

    const interventionCount = Object.keys(interventions).length;
    const summary = interventionCount > 0
      ? ` with ${interventionCount} intervention${interventionCount > 1 ? 's' : ''}`
      : '';

    return {
      blocks: [],
      assistantText: `I'll add option **${label}**${summary}. Please confirm.`,
      guidance_items: [],
      operations,
    };
  },

  chipLabel() { return 'Add option'; },
  chipPrompt(rec) {
    return rec.parameters?.label ? `Add option: ${rec.parameters.label}` : 'Add a new option';
  },
};
