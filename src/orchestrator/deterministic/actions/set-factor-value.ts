/**
 * set_factor_value Action
 *
 * Build update_node patch with canonical fields. Validate value against cap.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";
import { resolveEntity } from "../entity-resolver.js";

export const setFactorValueAction: ActionDefinition = {
  action_type: 'set_factor_value',
  description: 'Set or update the observed value of a factor in the model.',
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
      target_id: { type: 'string', description: 'ID of the factor to update' },
      value: { type: 'number', description: 'New observed value' },
      unit: { type: 'string', description: 'Optional unit label' },
    },
    required: ['target_id', 'value'],
    additionalProperties: false,
  },

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.graph) return 'No decision model available.';
    return null;
  },

  async execute(params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const targetRef = params.target_id as string | undefined;
    const value = params.value as number | undefined;

    if (!targetRef) {
      return { blocks: [], assistantText: 'Which factor would you like to update?', guidance_items: [] };
    }
    if (value == null || typeof value !== 'number') {
      return { blocks: [], assistantText: 'What value should this factor be set to?', guidance_items: [] };
    }

    const resolution = resolveEntity(targetRef, ctx.entities, 'low');
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
        assistantText: `"${targetRef}" could match several factors: ${names}. Which one did you mean?`,
        guidance_items: [],
      };
    }

    const entity = resolution.entity!;

    // Check cap. T1 (Phase A): emit a structured failure instead of bare
    // assistant text so the response assembler can route through the
    // failure_code / recovery_hint envelope path AND so future Phase B can
    // thread the failure into next-turn LLM context.
    const nodeEntry = ctx.entities.nodes.get(entity.id);
    if (nodeEntry?.cap != null && value > nodeEntry.cap) {
      return {
        blocks: [],
        assistantText: '',
        guidance_items: [],
        failure: {
          code: 'CAP_EXCEEDED',
          message: `${entity.label} cap ${nodeEntry.cap} exceeded by ${value}`,
          user_message: `${entity.label} is at its maximum in the current model. To reflect a higher level, the model's scale needs adjusting first.`,
          recovery_hint: 'Ask what level they mean in practical terms, then propose a value within range.',
        },
      };
    }

    const operations = [{
      op: 'update_node' as const,
      path: entity.id,
      value: {
        observed_state: {
          value,
          ...(nodeEntry?.unit ? { unit: nodeEntry.unit } : {}),
        },
      },
    }];

    return {
      blocks: [],
      assistantText: `Updated **${entity.label}** to ${value}${nodeEntry?.unit ? ' ' + nodeEntry.unit : ''}.`,
      guidance_items: [],
      operations,
    };
  },

  chipLabel(rec) {
    return rec.target_id ? `Set ${rec.target_id}` : 'Set factor value';
  },
  chipPrompt(rec) {
    const val = rec.parameters?.value;
    return rec.target_id
      ? `Set ${rec.target_id} to ${val ?? '...'}`
      : 'Set a factor value';
  },
};
