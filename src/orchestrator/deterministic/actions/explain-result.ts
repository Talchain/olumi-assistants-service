/**
 * explain_result Action
 *
 * Code templates structured sections from analysis data.
 * LLM writes narrative paragraph only (via explanation templater).
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";

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
    // Execution delegated to pipeline — uses explanation templater
    // See explanation-templater.ts for the code-templated sections
    const summary = ctx.analysis_summary!;

    const sections: string[] = [];

    // Winner
    if (summary.winner) {
      const prob = summary.winner_probability != null
        ? ` with a ${(summary.winner_probability * 100).toFixed(0)}% win probability`
        : '';
      sections.push(`**${summary.winner}** leads${prob}.`);
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

    return {
      blocks: [],
      assistantText: sections.join('\n\n'),
      guidance_items: [],
    };
  },

  chipLabel() { return 'Explain results'; },
  chipPrompt() { return 'Explain the results'; },
};
