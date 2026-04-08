/**
 * what_would_flip Action
 *
 * Fully deterministic from E-values, conditional winners, robustness data.
 * Returns a FlipAnalysisBlock with structured flip conditions.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult, FlipAnalysisBlockData } from "../types.js";
import { createFlipAnalysisBlock } from "../../blocks/factory.js";

export const whatWouldFlipAction: ActionDefinition = {
  action_type: 'what_would_flip',
  description: 'Show what factor changes would flip the winning option.',
  stage_eligibility: new Set(['evaluate', 'decide', 'optimise']),
  requires_target: false,
  requires_confirmation: false,
  execution_risk: 'none',
  reversible: true,
  surface: 'inline',
  role: 'scientist',
  cooldown: 'suppress_same_turn',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.analysis_summary) return 'No analysis results available. Run analysis first.';
    if (!ctx.analysis_summary.winner) return 'No clear leading option to analyse. Run analysis first.';
    return null;
  },

  async execute(_params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const summary = ctx.analysis_summary!;
    const drivers = summary.top_drivers;

    // Extract flip thresholds from raw analysis (factor_sensitivity[].flip_threshold)
    const flipMap = extractFlipThresholds(ctx);

    // Extract fragile edge labels from raw analysis robustness data
    const fragileEdgeLabels = extractFragileEdgeLabels(ctx);

    if (drivers.length === 0) {
      // No driver data — reference fragile edges, weak edges, or combined effect
      const parts: string[] = ['No single driver dominates.'];
      if (fragileEdgeLabels.length > 0) {
        const edgeNames = fragileEdgeLabels.slice(0, 3).join(', ');
        parts.push(`${fragileEdgeLabels.length} fragile edge${fragileEdgeLabels.length > 1 ? 's' : ''} (${edgeNames}) could amplify a flip under small changes.`);
      } else if (ctx.signals.weak_edges.length > 0) {
        const edgeList = ctx.signals.weak_edges.slice(0, 3).join(', ');
        parts.push(`${ctx.signals.weak_edges.length} weak edge${ctx.signals.weak_edges.length > 1 ? 's' : ''} (${edgeList}) could amplify a flip under small changes.`);
      } else {
        parts.push('The result is shaped by the combined effect of multiple factors; no single lever would flip it alone.');
      }
      return {
        blocks: [],
        assistantText: parts.join(' '),
        guidance_items: [],
      };
    }

    const winnerNode = [...ctx.entities.nodes.values()].find((n) => n.label === summary.winner);

    const flipConditions: FlipAnalysisBlockData['flip_conditions'] = drivers.slice(0, 3).map((driver) => {
      const node = ctx.entities.nodes.get(driver.factor_id);
      const threshold = flipMap.get(driver.factor_id);
      return {
        assumption: driver.label,
        current_value: threshold?.current_value ?? node?.value ?? 0,
        flip_threshold: threshold?.flip_value ?? 0,
        direction: driver.sensitivity > 1 ? 'small change needed' : 'moderate change needed',
        alternative_winner: summary.runner_up ?? 'alternative',
      };
    });

    // Build narrative
    const narrativeParts: string[] = [];
    for (const driver of drivers.slice(0, 3)) {
      const node = ctx.entities.nodes.get(driver.factor_id);
      const threshold = flipMap.get(driver.factor_id);
      const valueStr = node?.value != null ? ` (current: ${node.value}${node.unit ? ' ' + node.unit : ''})` : '';
      const flipStr = threshold ? `; flips at ${threshold.flip_value}${threshold.unit ? ' ' + threshold.unit : ''}` : '';
      narrativeParts.push(
        `**${driver.label}**${valueStr}: sensitivity ${driver.sensitivity.toFixed(2)}${flipStr}${!flipStr ? `; a ${driver.sensitivity > 1 ? 'small' : 'moderate'} change here could shift the leading option` : ''}.`,
      );
    }

    if (summary.runner_up && summary.winner_probability != null && summary.runner_up_probability != null) {
      const margin = (summary.winner_probability - summary.runner_up_probability) * 100;
      if (margin < 10) {
        narrativeParts.push(`The margin is only ${margin.toFixed(1)} points: relatively easy to flip.`);
      } else {
        narrativeParts.push(`The margin is ${margin.toFixed(0)} points: a significant shift would be needed.`);
      }
    }

    if (fragileEdgeLabels.length > 0) {
      const edgeNames = fragileEdgeLabels.slice(0, 3).join(', ');
      narrativeParts.push(
        `${fragileEdgeLabels.length} fragile edge${fragileEdgeLabels.length > 1 ? 's' : ''} (${edgeNames}) could amplify a flip.`,
      );
    } else if (ctx.signals.weak_edges.length > 0) {
      narrativeParts.push(
        `${ctx.signals.weak_edges.length} weak edge${ctx.signals.weak_edges.length > 1 ? 's' : ''} in the model could amplify a flip.`,
      );
    }

    const blockData: FlipAnalysisBlockData = {
      current_winner: {
        id: winnerNode?.id ?? '',
        label: summary.winner!,
        probability: summary.winner_probability ?? 0,
      },
      flip_conditions: flipConditions,
      narrative: narrativeParts.join('\n'),
    };

    const block = createFlipAnalysisBlock(blockData, ctx.turn_id);

    // Fix 5: assistantText must name the top 1-2 factors when drivers exist.
    // Include current value + flip threshold per factor when we have them,
    // otherwise fall back to the factor label alone. This is the headline
    // users see in the delta stream; the block narrative still carries the
    // full sensitivity breakdown.
    const topDrivers = drivers.slice(0, 2);
    const factorPhrases = topDrivers.map((driver) => {
      const node = ctx.entities.nodes.get(driver.factor_id);
      const threshold = flipMap.get(driver.factor_id);
      if (threshold) {
        const unit = threshold.unit ? ` ${threshold.unit}` : '';
        return `${driver.label} (currently ${formatFlipValue(threshold.current_value)}${unit}, flips at ${formatFlipValue(threshold.flip_value)}${unit})`;
      }
      if (node?.value != null) {
        const unit = node.unit ? ` ${node.unit}` : '';
        return `${driver.label} (currently ${formatFlipValue(node.value)}${unit})`;
      }
      return driver.label;
    });

    const factorList = factorPhrases.length === 2
      ? `${factorPhrases[0]} or ${factorPhrases[1]}`
      : factorPhrases[0];
    const assistantText = `${factorList} would need to shift to flip away from ${summary.winner}.`;

    return {
      blocks: [block],
      assistantText,
      guidance_items: [],
    };
  },

  chipLabel() { return 'What would flip?'; },
  chipPrompt() { return 'What would flip the result?'; },
};

// ============================================================================
// Helpers
// ============================================================================

interface FlipThresholdEntry {
  current_value: number;
  flip_value: number;
  unit: string | null;
}

/**
 * Format a flip threshold value for display in the headline.
 *
 * Keeps integers as integers (no trailing `.0`), rounds decimals to 2 places,
 * and renders tiny values (< 0.01) in fixed exponential form so we don't
 * display "currently 0.00000000012 $/h". Avoids Number#toFixed's tendency
 * to print trailing zeros on round values.
 */
function formatFlipValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  if (Math.abs(value) < 0.01 && value !== 0) return value.toExponential(1);
  // Round to 2 decimals, strip trailing zeros and any dangling decimal point.
  return String(Math.round(value * 100) / 100);
}

/**
 * Extract flip thresholds from the raw analysis response.
 * Reads factor_sensitivity[].flip_threshold from each option result.
 * Returns a Map keyed by factor_id.
 */
function extractFlipThresholds(ctx: DeterministicTurnContext): Map<string, FlipThresholdEntry> {
  const map = new Map<string, FlipThresholdEntry>();
  if (!ctx.analysis) return map;
  const analysis = ctx.analysis as Record<string, unknown>;
  const results = analysis.results as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(results)) return map;

  for (const result of results) {
    const factors = result.factor_sensitivity as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(factors)) continue;
    for (const factor of factors) {
      const factorId = (factor.factor_id as string) ?? (factor.label as string);
      if (!factorId || map.has(factorId)) continue;

      const flipValue = typeof factor.flip_threshold === 'number' ? factor.flip_threshold
        : typeof factor.flip_value === 'number' ? factor.flip_value
        : null;
      const currentValue = typeof factor.current_value === 'number' ? factor.current_value
        : typeof factor.value === 'number' ? factor.value
        : null;
      if (flipValue === null || currentValue === null) continue;

      map.set(factorId, {
        current_value: currentValue,
        flip_value: flipValue,
        unit: typeof factor.unit === 'string' ? factor.unit : null,
      });
    }
  }
  return map;
}

/**
 * Extract fragile edge labels from the raw analysis robustness data.
 * Returns human-readable "from → to" labels, up to 5.
 */
function extractFragileEdgeLabels(ctx: DeterministicTurnContext): string[] {
  if (!ctx.analysis) return [];
  const analysis = ctx.analysis as Record<string, unknown>;
  const robustness = analysis.robustness as Record<string, unknown> | undefined;
  const fragileEdges = robustness?.fragile_edges;
  if (!Array.isArray(fragileEdges)) return [];

  const labels: string[] = [];
  for (const edge of fragileEdges.slice(0, 5)) {
    if (!edge || typeof edge !== 'object') continue;
    const e = edge as Record<string, unknown>;
    const fromId = (e.from_node_id as string) ?? (e.from as string);
    const toId = (e.to_node_id as string) ?? (e.to as string);
    if (!fromId || !toId) continue;

    const fromLabel = ctx.entities.nodes.get(fromId)?.label
      ?? (typeof e.from_label === 'string' ? e.from_label : fromId);
    const toLabel = ctx.entities.nodes.get(toId)?.label
      ?? (typeof e.to_label === 'string' ? e.to_label : toId);
    labels.push(`${fromLabel} → ${toLabel}`);
  }
  return labels;
}
