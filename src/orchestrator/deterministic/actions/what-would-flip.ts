/**
 * what_would_flip Action
 *
 * Fully deterministic from E-values, conditional winners, robustness data.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";

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
    const sections: string[] = [];

    sections.push(`**What would flip the result away from ${summary.winner}?**`);

    // Use top drivers — the factors most likely to cause a flip
    const drivers = summary.top_drivers;
    if (drivers.length === 0) {
      sections.push('Driver data not available.');
      return { blocks: [], assistantText: sections.join('\n\n'), guidance_items: [] };
    }

    sections.push('The most sensitive levers:');
    for (const driver of drivers.slice(0, 3)) {
      const node = ctx.entities.nodes.get(driver.factor_id);
      const currentValue = node?.value;
      const valueStr = currentValue != null ? ` (current: ${currentValue}${node?.unit ? ' ' + node.unit : ''})` : '';
      sections.push(
        `- **${driver.label}**${valueStr}: sensitivity ${driver.sensitivity.toFixed(2)} — a ${driver.sensitivity > 1 ? 'small' : 'moderate'} change here could shift the winner.`,
      );
    }

    // Close call indicator
    if (summary.runner_up && summary.winner_probability != null && summary.runner_up_probability != null) {
      const margin = (summary.winner_probability - summary.runner_up_probability) * 100;
      if (margin < 10) {
        sections.push(
          `\nThe margin between **${summary.winner}** and **${summary.runner_up}** is only ${margin.toFixed(1)} points — relatively easy to flip.`,
        );
      } else {
        sections.push(
          `\nThe margin is ${margin.toFixed(0)} points — a significant shift would be needed.`,
        );
      }
    }

    // Fragile edges
    if (ctx.signals.weak_edges.length > 0) {
      sections.push(
        `\n${ctx.signals.weak_edges.length} weak edge${ctx.signals.weak_edges.length > 1 ? 's' : ''} in the model — these uncertain causal links could amplify a flip.`,
      );
    }

    return {
      blocks: [],
      assistantText: sections.join('\n\n'),
      guidance_items: [],
    };
  },

  chipLabel() { return 'What would flip?'; },
  chipPrompt() { return 'What would flip the result?'; },
};
