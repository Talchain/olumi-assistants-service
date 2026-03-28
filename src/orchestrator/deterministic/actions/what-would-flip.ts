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

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.analysis_summary) return 'No analysis results available. Run analysis first.';
    if (!ctx.analysis_summary.winner) return 'No clear winner to flip.';
    return null;
  },

  async execute(_params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const summary = ctx.analysis_summary!;
    const drivers = summary.top_drivers;

    if (drivers.length === 0) {
      return {
        blocks: [],
        assistantText: 'Driver data not available — cannot determine flip conditions.',
        guidance_items: [],
      };
    }

    const winnerNode = [...ctx.entities.nodes.values()].find((n) => n.label === summary.winner);

    const flipConditions: FlipAnalysisBlockData['flip_conditions'] = drivers.slice(0, 3).map((driver) => {
      const node = ctx.entities.nodes.get(driver.factor_id);
      return {
        assumption: driver.label,
        current_value: node?.value ?? 0,
        flip_threshold: 0, // exact flip point requires re-simulation
        direction: driver.sensitivity > 1 ? 'small change needed' : 'moderate change needed',
        alternative_winner: summary.runner_up ?? 'alternative',
      };
    });

    // Build narrative
    const narrativeParts: string[] = [];
    for (const driver of drivers.slice(0, 3)) {
      const node = ctx.entities.nodes.get(driver.factor_id);
      const valueStr = node?.value != null ? ` (current: ${node.value}${node.unit ? ' ' + node.unit : ''})` : '';
      narrativeParts.push(
        `**${driver.label}**${valueStr}: sensitivity ${driver.sensitivity.toFixed(2)} — a ${driver.sensitivity > 1 ? 'small' : 'moderate'} change here could shift the winner.`,
      );
    }

    if (summary.runner_up && summary.winner_probability != null && summary.runner_up_probability != null) {
      const margin = (summary.winner_probability - summary.runner_up_probability) * 100;
      if (margin < 10) {
        narrativeParts.push(`The margin is only ${margin.toFixed(1)} points — relatively easy to flip.`);
      } else {
        narrativeParts.push(`The margin is ${margin.toFixed(0)} points — a significant shift would be needed.`);
      }
    }

    if (ctx.signals.weak_edges.length > 0) {
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

    const block = createFlipAnalysisBlock(blockData, ctx.scenario_id);

    return {
      blocks: [block],
      assistantText: `The top factors that could flip the result away from ${summary.winner}.`,
      guidance_items: [],
    };
  },

  chipLabel() { return 'What would flip?'; },
  chipPrompt() { return 'What would flip the result?'; },
};
