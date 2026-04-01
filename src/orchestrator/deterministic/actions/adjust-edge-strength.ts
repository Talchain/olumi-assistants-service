/**
 * adjust_edge_strength Action
 *
 * Build update_edge patch. Preserve sign. Check range discipline.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";
import { resolveEntity } from "../entity-resolver.js";

export const adjustEdgeStrengthAction: ActionDefinition = {
  action_type: 'adjust_edge_strength',
  description: 'Adjust the causal strength of an edge between two factors.',
  stage_eligibility: new Set(['ideate', 'evaluate', 'optimise']),
  requires_target: true,
  requires_confirmation: false,
  execution_risk: 'low',
  reversible: true,
  surface: 'inline',
  role: 'facilitator',
  cooldown: 'none',
  input_schema: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Source factor ID' },
      to: { type: 'string', description: 'Target factor ID' },
      strength_mean: { type: 'number', description: 'New edge strength mean (0 to 1)' },
    },
    required: ['from', 'to'],
    additionalProperties: false,
  },

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.graph) return 'No decision model available.';
    if (ctx.entities.edges.length === 0) return 'No edges in the model to adjust.';
    return null;
  },

  async execute(params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const fromRef = params.from as string | undefined;
    const toRef = params.to as string | undefined;
    const newMean = params.strength_mean as number | undefined;

    if (!fromRef || !toRef) {
      return { blocks: [], assistantText: 'Which edge would you like to adjust? Please specify the source and target factors.', guidance_items: [] };
    }

    const fromResolution = resolveEntity(fromRef, ctx.entities, 'low');
    const toResolution = resolveEntity(toRef, ctx.entities, 'low');

    if (fromResolution.status !== 'resolved') {
      return {
        blocks: [],
        assistantText: `I couldn't find a factor called "${fromRef}" in the model.`,
        guidance_items: [],
      };
    }
    if (toResolution.status !== 'resolved') {
      return {
        blocks: [],
        assistantText: `I couldn't find a factor called "${toRef}" in the model.`,
        guidance_items: [],
      };
    }

    const fromEntity = fromResolution.entity!;
    const toEntity = toResolution.entity!;

    // Find the edge
    const edge = ctx.entities.edges.find(
      (e) => e.from === fromEntity.id && e.to === toEntity.id,
    );
    if (!edge) {
      return {
        blocks: [],
        assistantText: `There's no edge from **${fromEntity.label}** to **${toEntity.label}** in the model.`,
        guidance_items: [],
      };
    }

    if (newMean == null || typeof newMean !== 'number') {
      return {
        blocks: [],
        assistantText: `The current strength of **${fromEntity.label}** → **${toEntity.label}** is ${edge.strength_mean.toFixed(2)}. What should the new strength be?`,
        guidance_items: [],
      };
    }

    // Preserve sign direction
    const preservedSign = edge.strength_mean >= 0 ? Math.abs(newMean) : -Math.abs(newMean);

    const operations = [{
      op: 'update_edge' as const,
      path: `${fromEntity.id}->${toEntity.id}`,
      value: {
        strength: { mean: preservedSign, std: edge.strength_std },
      },
    }];

    return {
      blocks: [],
      assistantText: `Adjusted **${fromEntity.label}** → **${toEntity.label}** strength from ${edge.strength_mean.toFixed(2)} to ${preservedSign.toFixed(2)}.`,
      guidance_items: [],
      operations,
    };
  },

  chipLabel(rec) {
    return rec.target_id ? `Adjust ${rec.target_id}` : 'Adjust edge';
  },
  chipPrompt(rec) {
    return rec.target_id ? `Adjust the strength of ${rec.target_id}` : 'Adjust an edge strength';
  },
};
