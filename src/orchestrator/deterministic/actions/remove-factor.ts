/**
 * remove_factor Action
 *
 * Build remove ops (edges first, then node). Requires confirmation.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";
import type { PatchOperation } from "../../types.js";
import { resolveEntity } from "../entity-resolver.js";

export const removeFactorAction: ActionDefinition = {
  action_type: 'remove_factor',
  description: 'Remove a factor and all its connected edges from the model.',
  stage_eligibility: new Set(['ideate']),
  requires_target: true,
  requires_confirmation: true,
  execution_risk: 'high',
  reversible: false,
  surface: 'proposal_card',
  role: 'challenger',
  cooldown: 'suppress_same_turn',
  input_schema: {
    type: 'object',
    properties: {
      target_id: { type: 'string', description: 'ID of the factor to remove' },
    },
    required: ['target_id'],
    additionalProperties: false,
  },

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.graph) return 'No decision model available.';
    return null;
  },

  async execute(params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const targetRef = params.target_id as string | undefined;

    if (!targetRef) {
      return { blocks: [], assistantText: 'Which factor would you like to remove?', guidance_items: [] };
    }

    const resolution = resolveEntity(targetRef, ctx.entities, 'high');
    if (resolution.status === 'not_found') {
      return {
        blocks: [],
        assistantText: `I couldn't find a factor called "${targetRef}" in the model.`,
        guidance_items: [],
      };
    }
    if (resolution.status === 'ambiguous') {
      const names = (resolution.candidates ?? []).map((c) => c.label).join(', ');
      return {
        blocks: [],
        assistantText: `"${targetRef}" could match: ${names}. Which one did you mean?`,
        guidance_items: [],
      };
    }

    const entity = resolution.entity!;
    const operations: PatchOperation[] = [];

    // Remove connected edges first
    const connectedEdges = ctx.entities.edges.filter(
      (e) => e.from === entity.id || e.to === entity.id,
    );
    for (const edge of connectedEdges) {
      operations.push({
        op: 'remove_edge',
        path: `${edge.from}->${edge.to}`,
      });
    }

    // Remove the node
    operations.push({
      op: 'remove_node',
      path: entity.id,
    });

    return {
      blocks: [],
      assistantText: `I'll remove **${entity.label}** and its ${connectedEdges.length} connected edge${connectedEdges.length !== 1 ? 's' : ''}. This can't be undone. Please confirm.`,
      guidance_items: [],
      operations,
    };
  },

  chipLabel(rec) {
    return rec.target_id ? `Remove ${rec.target_id}` : 'Remove factor';
  },
  chipPrompt(rec) {
    return rec.target_id ? `Remove ${rec.target_id} from the model` : 'Remove a factor';
  },
};
