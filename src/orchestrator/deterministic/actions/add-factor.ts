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
import { DEFAULT_EXISTS_PROBABILITY } from "../../context/constants.js";
import { formatNodeValue } from "../format-node-value.js";

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
  input_schema: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'Name for the new factor' },
      category: { type: 'string', enum: ['controllable', 'observable', 'external'], description: 'Factor category' },
      value: { type: 'number', description: 'Initial observed value' },
      unit: { type: 'string', description: 'Unit label for the value' },
      kind: { type: 'string', enum: ['factor', 'risk'], description: 'Node kind — risk factors get negative edge direction to goals' },
      connect_to: { type: 'array', items: { type: 'string' }, description: 'IDs of factors to connect to' },
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
    const value = params.value as number | undefined;
    const unit = params.unit as string | undefined;
    const category = (params.category as string) ?? 'observable';
    const kind = (params.kind as string) === 'risk' ? 'risk' : 'factor';
    const rawConnectTo = params.connect_to;
    // connect_to may arrive as a single string or an array of target IDs
    const connectToTargets: string[] = Array.isArray(rawConnectTo)
      ? rawConnectTo.filter((t): t is string => typeof t === 'string')
      : typeof rawConnectTo === 'string'
        ? [rawConnectTo]
        : [];

    if (!label) {
      return { blocks: [], assistantText: 'What should the new factor be called?', guidance_items: [] };
    }

    // Check for existing factor with matching label (case-insensitive, whitespace-normalised)
    const normalisedLabel = label.toLowerCase().replace(/\s+/g, ' ').trim();
    const existingFactor = findExistingFactor(ctx, normalisedLabel);
    if (existingFactor) {
      // Redirect to update instead of creating a duplicate
      const nodeEntry = ctx.entities.nodes.get(existingFactor.id);
      const operations: PatchOperation[] = [];
      if (value != null || unit) {
        // Enforce cap from existing node. T1 (Phase A): structured failure.
        if (value != null && nodeEntry?.cap != null && value > nodeEntry.cap) {
          return {
            blocks: [],
            assistantText: '',
            guidance_items: [],
            failure: {
              code: 'CAP_EXCEEDED',
              message: `${existingFactor.label} cap ${nodeEntry.cap} exceeded by ${value}`,
              user_message: `**${existingFactor.label}** is at its maximum in the current model. To reflect a higher level, the model's scale needs adjusting first.`,
              recovery_hint: 'Ask what level they mean in practical terms, then propose a value within range.',
            },
          };
        }
        operations.push({
          op: 'update_node',
          path: existingFactor.id,
          value: {
            observed_state: {
              ...(value != null ? { value } : {}),
              // Preserve existing unit unless caller provides one
              ...(unit ? { unit } : nodeEntry?.unit ? { unit: nodeEntry.unit } : {}),
            },
          },
        });
      }
      const effectiveUnit = unit ?? nodeEntry?.unit;
      const valueStr = value != null ? ` to ${value}${effectiveUnit ? ` ${effectiveUnit}` : ''}` : '';
      const actionText = operations.length > 0
        ? `Found existing factor **${existingFactor.label}**. Its value would be updated${valueStr} instead of creating a duplicate.`
        : `**${existingFactor.label}** already exists in the model. If you'd like to update its value, please specify a new value.`;
      return {
        blocks: [],
        assistantText: actionText,
        guidance_items: [],
        ...(operations.length > 0 ? { operations } : {}),
      };
    }

    // Generate canonical node ID — risk nodes get a `risk_` prefix
    const idPrefix = kind === 'risk' ? 'risk_' : 'factor_';
    const nodeId = `${idPrefix}${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`;

    const operations: PatchOperation[] = [
      {
        op: 'add_node',
        path: nodeId,
        value: {
          id: nodeId,
          kind,
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

    // Add edges to specified targets or default to goal
    const targets = connectToTargets.length > 0 ? connectToTargets : (ctx.entities.goal_id ? [ctx.entities.goal_id] : []);
    for (const targetId of targets) {
      operations.push({
        op: 'add_edge',
        path: `${nodeId}->${targetId}`,
        value: {
          from: nodeId,
          to: targetId,
          strength: { mean: 0.5, std: 0.15 },
          exists_probability: DEFAULT_EXISTS_PROBABILITY,
          effect_direction: kind === 'risk' ? 'negative' : 'positive',
        },
      });
    }

    const formattedValue = value != null
      ? formatNodeValue({ value, unit, kind }) ?? `${value}${unit ? ` ${unit}` : ''}`
      : undefined;
    const valueStr = formattedValue != null ? ` (${formattedValue})` : '';

    // WS2: HandlerFact for the response composer. When the composer is
    // enabled it replaces the legacy assistantText below with proposal-
    // language output generated from this fact + coaching context.
    const targetLabel = targets.length > 0
      ? ctx.entities.nodes.get(targets[0])?.label
      : undefined;

    return {
      blocks: [],
      assistantText: `**${label}**${valueStr} would be added as a ${kind === 'risk' ? 'risk factor' : `${category} factor`}.`,
      guidance_items: [],
      operations,
      fact: {
        action: 'factor_added',
        entities_affected: [{ id: nodeId, label, kind }],
        what_changed: formattedValue != null ? `new factor at ${formattedValue}` : 'new factor',
        stale_analysis: ctx.analysis_summary != null,
        auto_apply: false,
        data: {
          value_label: formattedValue ?? undefined,
          target_label: targetLabel,
          category,
        },
      },
    };
  },

  chipLabel() { return 'Add factor'; },
  chipPrompt(rec) {
    return rec.parameters?.label ? `Add a factor for ${rec.parameters.label}` : 'Add a new factor';
  },
};

/**
 * Find an existing factor node whose label matches the given normalised label.
 * Uses case-insensitive, whitespace-normalised comparison.
 */
function findExistingFactor(
  ctx: DeterministicTurnContext,
  normalisedLabel: string,
): { id: string; label: string } | null {
  for (const [id, entry] of ctx.entities.nodes) {
    if (entry.kind !== 'factor' && entry.kind !== 'risk') continue;
    const entryNormalised = entry.label.toLowerCase().replace(/\s+/g, ' ').trim();
    if (entryNormalised === normalisedLabel) {
      return { id, label: entry.label };
    }
  }
  return null;
}
