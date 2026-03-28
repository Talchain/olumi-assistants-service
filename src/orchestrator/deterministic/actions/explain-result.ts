/**
 * explain_result Action
 *
 * Code templates structured sections from analysis data.
 * Returns a CommentaryBlock with sections, not just inline text.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";
import { createCommentaryBlock } from "../../blocks/factory.js";

export const explainResultAction: ActionDefinition = {
  action_type: 'explain_result',
  description: 'Explain the analysis results in plain language.',
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
    return null;
  },

  async execute(_params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const summary = ctx.analysis_summary!;
    const sections: string[] = [];

    // Winner
    if (summary.winner) {
      const prob = summary.winner_probability != null
        ? (summary.winner_probability * 100).toFixed(0)
        : null;
      sections.push(prob
        ? `**${summary.winner}** leads at ${prob}%.`
        : `**${summary.winner}** leads.`);
    }

    // Runner up
    if (summary.runner_up && summary.runner_up_probability != null) {
      sections.push(
        `Runner-up: **${summary.runner_up}** at ${(summary.runner_up_probability * 100).toFixed(0)}%.`,
      );
    }

    // Robustness
    if (summary.robustness_band) {
      sections.push(`Robustness: **${summary.robustness_band}**.`);
    }

    // Top drivers
    if (summary.top_drivers.length > 0) {
      const driverList = summary.top_drivers
        .slice(0, 3)
        .map((d) => `${d.label} (sensitivity: ${d.sensitivity.toFixed(2)})`)
        .join(', ');
      sections.push(`Top drivers: ${driverList}.`);
    } else {
      sections.push('Driver data not available.');
    }

    // Constraints
    if (summary.constraint_tensions.length > 0) {
      sections.push(`Constraint tensions: ${summary.constraint_tensions.join('; ')}.`);
    }

    const narrative = sections.join('\n\n');
    const block = createCommentaryBlock(narrative, '', 'deterministic:explain_result');

    // Short summary for assistantText; detail is in the block
    const summaryText = summary.winner
      ? `${summary.winner} leads the analysis${summary.winner_probability != null ? ` at ${(summary.winner_probability * 100).toFixed(0)}%` : ''}.`
      : 'Analysis results are ready.';

    return {
      blocks: [block],
      assistantText: summaryText,
      guidance_items: [],
    };
  },

  chipLabel() { return 'Explain results'; },
  chipPrompt() { return 'Explain the results'; },
};
