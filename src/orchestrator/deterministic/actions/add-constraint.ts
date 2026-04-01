/**
 * add_constraint Action
 *
 * Append to goal_constraints[]. Validate node_id exists.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";
import { resolveEntity } from "../entity-resolver.js";

export const addConstraintAction: ActionDefinition = {
  action_type: 'add_constraint',
  description: 'Add a constraint to the decision goal.',
  stage_eligibility: new Set(['frame', 'ideate', 'evaluate', 'optimise']),
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
      target_id: { type: 'string', description: 'ID of the factor to constrain' },
      constraint_type: { type: 'string', enum: ['threshold', 'range'], description: 'Type of constraint' },
      threshold: { type: 'number', description: 'Threshold value for the constraint' },
      label: { type: 'string', description: 'Human-readable constraint name' },
      unit: { type: 'string', description: 'Optional unit label' },
    },
    required: ['target_id', 'threshold', 'label'],
    additionalProperties: false,
  },

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.graph) return 'No decision model available.';
    if (!ctx.entities.goal_id) return 'No goal node in the model.';
    return null;
  },

  async execute(params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const targetRef = params.target_id as string | undefined;
    const rawType = (params.constraint_type as string) ?? 'threshold';
    const constraintType = rawType === 'threshold' || rawType === 'range' ? rawType : 'threshold';
    const threshold = params.threshold as number | undefined;
    const label = params.label as string | undefined;

    if (!targetRef) {
      return { blocks: [], assistantText: 'Which factor should the constraint apply to?', guidance_items: [] };
    }

    const resolution = resolveEntity(targetRef, ctx.entities, 'low');
    if (resolution.status === 'not_found') {
      return {
        blocks: [],
        assistantText: `I couldn't find "${targetRef}" in the model.`,
        guidance_items: [],
      };
    }
    if (resolution.status === 'ambiguous') {
      const names = (resolution.candidates ?? []).map((c) => c.label).join(', ');
      return {
        blocks: [],
        assistantText: `"${targetRef}" could match: ${names}. Which one?`,
        guidance_items: [],
      };
    }

    const entity = resolution.entity!;
    const goalId = ctx.entities.goal_id!;

    // Use add_node op with goal_constraints to append rather than overwrite.
    // The patch applier merges arrays — using update_node with a single-element
    // goal_constraints would replace the existing array.
    const newConstraint = {
      node_id: entity.id,
      type: constraintType,
      ...(threshold != null ? { threshold } : {}),
      ...(label ? { label } : {}),
    };

    // Read existing constraints from graph to append
    const goalNode = ctx.graph?.nodes?.find((n: { id: string }) => n.id === goalId);
    const rawConstraints = (goalNode as Record<string, unknown>)?.goal_constraints;
    const existingConstraints = Array.isArray(rawConstraints) ? rawConstraints : [];

    const operations = [{
      op: 'update_node' as const,
      path: goalId,
      value: {
        goal_constraints: [...existingConstraints, newConstraint],
      },
    }];

    return {
      blocks: [],
      assistantText: `Added a ${constraintType} constraint on **${entity.label}**${threshold != null ? ` (threshold: ${threshold})` : ''}.`,
      guidance_items: [],
      operations,
    };
  },

  chipLabel() { return 'Add constraint'; },
  chipPrompt(rec) {
    return rec.target_id ? `Add a constraint on ${rec.target_id}` : 'Add a constraint';
  },
};
