/**
 * set_factor_value Action
 *
 * Build update_node patch with canonical fields. Validate value against cap.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";
import { resolveEntity } from "../entity-resolver.js";
import { log } from "../../../utils/telemetry.js";

/**
 * Map a raw currency signal (symbol or short code) to a canonical unit label.
 * Returns null when the signal is not a recognised currency.
 */
function normaliseCurrency(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Direct symbol → ISO-ish code mapping. Keeping short codes preserves the
  // user's stated currency without inventing locale-specific prose.
  const symbolMap: Record<string, string> = {
    '$': 'USD',
    '£': 'GBP',
    '€': 'EUR',
    '¥': 'JPY',
    '₹': 'INR',
  };
  if (trimmed in symbolMap) return symbolMap[trimmed];
  // 3-letter currency codes pass through (already canonical).
  if (/^[A-Z]{3}$/.test(trimmed)) return trimmed;
  // Symbol + code variants ("$USD") — take the code.
  const codeMatch = trimmed.match(/([A-Z]{3})/);
  if (codeMatch) return codeMatch[1];
  return null;
}

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

    // Resolve effective unit. Precedence (highest to lowest):
    //   1. Unit param supplied by the LLM tool call (if a recognised currency
    //      or plain string).
    //   2. Currency detected in the user's raw message
    //      (ctx.user_currency_hint, populated by turn-context.detectCurrencyInMessage).
    //      This catches the common case where the user says "$100,000" but
    //      the LLM tool call omits `unit`, letting the graph's default unit
    //      silently override the user's stated currency.
    //   3. Graph node's existing unit.
    //
    // On any mismatch between the user-stated currency (params OR message)
    // and the graph node's unit, log `v4.set_factor_value_currency_mismatch`
    // so staging drift is visible in telemetry.
    const paramUnit = typeof params.unit === 'string' ? params.unit : undefined;
    const normalisedParamCurrency = normaliseCurrency(paramUnit);
    const messageCurrency = ctx.user_currency_hint ?? null;
    const nodeUnit = nodeEntry?.unit;
    const nodeCurrency = nodeUnit ? normaliseCurrency(nodeUnit) : null;

    let effectiveUnit: string | undefined;
    let resolvedSource: 'param' | 'message' | 'node' | 'none' = 'none';

    if (normalisedParamCurrency) {
      effectiveUnit = normalisedParamCurrency;
      resolvedSource = 'param';
    } else if (messageCurrency) {
      effectiveUnit = messageCurrency;
      resolvedSource = 'message';
    } else if (paramUnit) {
      // Non-currency unit passed explicitly — honour it.
      effectiveUnit = paramUnit;
      resolvedSource = 'param';
    } else if (nodeUnit) {
      effectiveUnit = nodeUnit;
      resolvedSource = 'node';
    }

    // Log any mismatch between the user's stated currency and the node's
    // stored currency. Fires on both param-user and message-user paths.
    const userCurrency = normalisedParamCurrency ?? messageCurrency;
    if (userCurrency && nodeCurrency && userCurrency !== nodeCurrency) {
      log.warn(
        {
          event: 'v4.set_factor_value_currency_mismatch',
          entity_id: entity.id,
          entity_label: entity.label,
          node_unit: nodeUnit,
          param_unit: paramUnit,
          message_currency: messageCurrency,
          resolved: effectiveUnit,
          source: resolvedSource,
        },
        'set_factor_value: user currency differs from graph node currency — honouring user',
      );
    }

    // Separate warning: the LLM passed a non-currency unit string (e.g.
    // "percentage") but the node was storing a currency. The param wins
    // (honour explicit LLM intent), but we surface the override in telemetry
    // so unit-drift from the currency path becomes visible in staging.
    if (
      paramUnit
      && !normalisedParamCurrency
      && nodeCurrency
      && effectiveUnit === paramUnit
      && effectiveUnit !== nodeCurrency
    ) {
      log.warn(
        {
          event: 'v4.set_factor_value_unit_overwrite',
          entity_id: entity.id,
          entity_label: entity.label,
          node_unit: nodeUnit,
          param_unit: paramUnit,
          resolved: effectiveUnit,
        },
        'set_factor_value: non-currency param unit is overwriting a currency node unit — honouring LLM intent',
      );
    }

    const operations = [{
      op: 'update_node' as const,
      path: entity.id,
      value: {
        observed_state: {
          value,
          ...(effectiveUnit ? { unit: effectiveUnit } : {}),
        },
      },
    }];

    return {
      blocks: [],
      assistantText: `Updated **${entity.label}** to ${value}${effectiveUnit ? ' ' + effectiveUnit : ''}.`,
      guidance_items: [],
      operations,
      fact: {
        action: 'value_set',
        entities_affected: [{ id: entity.id, label: entity.label, kind: 'factor' }],
        what_changed: `${entity.label} to ${value}${effectiveUnit ? ' ' + effectiveUnit : ''}`,
        stale_analysis: ctx.analysis_summary != null,
        auto_apply: true,
        data: {
          new_value: value,
          unit: effectiveUnit,
        },
      },
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
