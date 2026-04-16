/**
 * set_factor_value Action
 *
 * Build update_node patch with canonical fields. Validate value against cap.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";
import type { SuggestedAction } from "../../types.js";
import { resolveEntity } from "../entity-resolver.js";
import { log } from "../../../utils/telemetry.js";
import { qualitativeBand, synthesiseDisplayValue } from "../../../cee/factor-extraction/display-value.js";

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
  description: 'Set or update the numeric or categorical value of an existing factor. Use when the user provides a specific value (e.g. "set salary to £95k", "team size is 12", "cost = 300k"). Requires the factor to already exist in the model.',
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
    //
    // S3 recovery branches: when the user passed an absolute real-world
    // number (value > 10) for a factor whose normalised cap is 1, distinguish
    //   A) wrong representation — no real-world metadata on the node →
    //      qualitative chips (moderate / high / very high).
    //   B) above real-world cap — node has unit and a real-world cap > 1 →
    //      offer range-increase (via edit_graph) or set-to-maximum chips.
    // Values in 1.01–10 fall through to the existing CAP_EXCEEDED failure.
    const nodeEntry = ctx.entities.nodes.get(entity.id);
    if (nodeEntry?.cap != null && value > nodeEntry.cap) {
      if (value > 10) {
        // hasRealCap requires a real-world raw_value on the graph node to
        // confirm the factor had genuine real-world metadata at draft time,
        // not just a cosmetic unit label on an otherwise normalised factor.
        // Without that evidence, treat as Case A (wrong representation).
        const graphNode = ctx.graph?.nodes.find((n) => n.id === entity.id);
        const hasRawValue =
          (graphNode as { data?: { raw_value?: unknown } } | undefined)?.data?.raw_value != null
          || (graphNode as { observed_state?: { raw_value?: unknown } } | undefined)?.observed_state?.raw_value != null;
        const hasRealCap =
          nodeEntry.cap > 1
          && typeof nodeEntry.unit === 'string'
          && nodeEntry.unit.length > 0
          && hasRawValue;
        const branch = hasRealCap ? 'above_real_cap' : 'wrong_representation';
        log.info(
          {
            event: 'v4.set_factor_value_cap_hit',
            factor_id: entity.id,
            requested_value: value,
            cap: nodeEntry.cap,
            has_unit: !!nodeEntry.unit,
            has_raw_value: !!(graphNode as { data?: { raw_value?: unknown } } | undefined)?.data?.raw_value,
            branch,
          },
          'CAP_EXCEEDED recovery branch selected',
        );
        if (hasRealCap) {
          return buildAboveRealCapRecovery(entity, nodeEntry, value);
        }
        return buildWrongRepresentationRecovery(entity, nodeEntry, value);
      }
      const graphNode = ctx.graph?.nodes.find((n) => n.id === entity.id);
      log.info(
        {
          event: 'v4.set_factor_value_cap_hit',
          factor_id: entity.id,
          requested_value: value,
          cap: nodeEntry.cap,
          has_unit: !!nodeEntry.unit,
          has_raw_value: !!(graphNode as { data?: { raw_value?: unknown } } | undefined)?.data?.raw_value,
          branch: 'bare_cap_exceeded',
        },
        'CAP_EXCEEDED recovery branch selected',
      );
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

    // Compute display_value for the composer to render instead of the raw
    // numeric. Qualitative bands only apply to unitless 0-1 factors
    // (no unit OR unit === 'scale'); factors with real units (£, %, months,
    // etc.) keep the numeric + unit form.
    const displayValue = computeDisplayValue(value, effectiveUnit);

    return {
      blocks: [],
      assistantText: `Updated **${entity.label}** to ${displayValue}.`,
      guidance_items: [],
      operations,
      fact: {
        action: 'value_set',
        entities_affected: [{ id: entity.id, label: entity.label, kind: 'factor' }],
        what_changed: `${entity.label} to ${displayValue}`,
        stale_analysis: ctx.analysis_summary != null,
        // Operations are present → pipeline emits as a proposal patch
        // (status: 'proposed', auto_apply: false on the block). The fact
        // must agree so the response composer uses proposal language.
        auto_apply: false,
        data: {
          new_value: value,
          unit: effectiveUnit,
          display_value: displayValue,
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

/**
 * Produce the user-facing display value for a factor.
 *
 * Decision tree (matches the DS v5 "no raw 0-1 values" rule):
 *   - Unitless 0-1 factor (no unit OR unit === 'scale') → qualitative band
 *     e.g. 0.25 → "low", 0.75 → "high". Logged under
 *     `v4.display_value_qualitative` so staging can see how often this path
 *     fires and whether it's the dominant display mode.
 *   - Any real unit (£, $, %, months, etc.) → numeric + unit form
 *     ("75,000 £", "3 %", "18 months"). This matches existing surfaces and
 *     avoids inventing qualitative labels for quantities that have a natural
 *     scale.
 *   - Out-of-range numeric (outside 0-1) with no unit → plain numeric.
 */
function computeDisplayValue(value: number, unit?: string): string {
  const hasRealUnit =
    !!unit && unit.toLowerCase() !== 'scale';

  if (!hasRealUnit && value >= 0 && value <= 1) {
    const band = qualitativeBand(value).toLowerCase();
    log.debug(
      {
        event: 'v4.display_value_qualitative',
        value,
        unit: unit ?? null,
        band,
      },
      'set_factor_value: rendered qualitative band for unitless 0-1 factor',
    );
    return band;
  }

  return unit ? `${value} ${unit}` : `${value}`;
}

// ──────────────────────────────────────────────────────────────────────
// S3 recovery builders
// ──────────────────────────────────────────────────────────────────────

interface EntityShape { id: string; label: string }
interface NodeEntryShape { cap?: number; unit?: string }

/**
 * Case A — wrong representation. Factor is normalised (cap ≤ 1) with no
 * trustworthy real-world metadata, and the user passed a real-world value.
 * Offer qualitative chips only — chip labels contain no normalised values;
 * the payload carries the normalised target.
 */
function buildWrongRepresentationRecovery(
  entity: EntityShape,
  _nodeEntry: NodeEntryShape,
  value: number,
): ActionResult {
  const displayValue = synthesiseDisplayValue({
    value,
    raw_value: value,
    unit: _nodeEntry.unit,
  }) ?? String(value);

  const makeChip = (bandLabel: string, normValue: number, index: number): SuggestedAction => {
    const phrase = `Set to ${bandLabel}`;
    return {
      label: phrase,
      prompt: `Set ${entity.label} to ${normValue}`,
      role: 'facilitator',
      action_type: 'set_factor_value',
      parameters: {
        target_id: entity.id,
        value: normValue,
        chip_id: `set_factor_value_qualitative_${index}`,
      },
    };
  };

  const chips: SuggestedAction[] = [
    makeChip('moderate', 0.5, 0),
    makeChip('high', 0.8, 1),
    makeChip('very high', 0.95, 2),
  ];

  log.info({
    event: 'v4.set_factor_value_absolute_recovery',
    factor_id: entity.id,
    raw_value: value,
    case: 'wrong_representation',
    has_metadata: false,
    offered_options: chips.map((c) => c.label),
  }, 'set_factor_value: qualitative recovery for normalised-only factor');

  return {
    blocks: [],
    assistantText: `${entity.label} uses a relative scale. Would you describe ${displayValue} as moderate, high, or very high for this decision?`,
    guidance_items: [],
    suggested_actions_override: chips,
  };
}

/**
 * Case B — above real-world cap. Factor has unit + real-world cap > 1; the
 * user's value exceeds the cap. Offer to raise the range (via edit_graph)
 * or snap to the current maximum.
 */
function buildAboveRealCapRecovery(
  entity: EntityShape,
  nodeEntry: NodeEntryShape,
  value: number,
): ActionResult {
  const unit = nodeEntry.unit;
  const cap = nodeEntry.cap ?? 0;
  const rounded = Math.ceil(value / Math.pow(10, Math.max(0, String(Math.round(value)).length - 2)))
    * Math.pow(10, Math.max(0, String(Math.round(value)).length - 2));
  const newRange = rounded > value ? rounded : value;

  const capDisplay = synthesiseDisplayValue({
    value: cap,
    raw_value: cap,
    unit,
  }) ?? (unit ? `${cap} ${unit}` : String(cap));
  const valueDisplay = synthesiseDisplayValue({
    value,
    raw_value: value,
    unit,
  }) ?? (unit ? `${value} ${unit}` : String(value));
  const rangeDisplay = synthesiseDisplayValue({
    value: newRange,
    raw_value: newRange,
    unit,
  }) ?? (unit ? `${newRange} ${unit}` : String(newRange));

  const chips: SuggestedAction[] = [
    {
      label: `Increase range to ${rangeDisplay}`,
      prompt: `Increase the range of ${entity.label} to ${newRange}${unit ? ' ' + unit : ''}`,
      role: 'facilitator',
      action_type: 'edit_graph',
      parameters: {
        edit_description: `Increase the range of ${entity.label} to ${newRange}${unit ? ' ' + unit : ''}`,
        target_id: entity.id,
        chip_id: 'set_factor_value_range_increase',
      },
    },
    {
      label: 'Set to current maximum',
      prompt: `Set ${entity.label} to ${cap}`,
      role: 'facilitator',
      action_type: 'set_factor_value',
      parameters: {
        target_id: entity.id,
        value: cap,
        chip_id: 'set_factor_value_snap_to_cap',
      },
    },
  ];

  log.info({
    event: 'v4.set_factor_value_absolute_recovery',
    factor_id: entity.id,
    raw_value: value,
    case: 'above_real_cap',
    has_metadata: true,
    offered_options: chips.map((c) => c.label),
  }, 'set_factor_value: range-adjust recovery for real-world factor above cap');

  return {
    blocks: [],
    assistantText: `${entity.label} currently has a maximum of ${capDisplay}. ${valueDisplay} is above that range. Would you like to increase the range, or set it to the current maximum?`,
    guidance_items: [],
    suggested_actions_override: chips,
  };
}
