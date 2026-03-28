/**
 * explain_result Action
 *
 * Code templates structured sections from analysis data.
 * Returns a CommentaryBlock with sections, not just inline text.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult, DeterministicCommentaryBlockData } from "../types.js";
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
    const sections: DeterministicCommentaryBlockData['sections'] = [];

    // Recommendation
    if (summary.winner) {
      const prob = summary.winner_probability != null
        ? (summary.winner_probability * 100).toFixed(0)
        : null;
      sections.push({
        heading: 'Recommendation',
        content: prob
          ? `${summary.winner} leads at ${prob}%.`
          : `${summary.winner} leads.`,
      });
    }

    // Stability
    if (summary.robustness_band) {
      sections.push({
        heading: 'Stability',
        content: `Robustness: ${summary.robustness_band}.`,
      });
    }

    // Key drivers
    if (summary.top_drivers.length > 0) {
      sections.push({
        heading: 'Key drivers',
        items: summary.top_drivers
          .slice(0, 3)
          .map((d) => `${d.label} (${d.sensitivity.toFixed(2)})`),
      });
    } else {
      sections.push({
        heading: 'Drivers',
        content: 'Driver data not available.',
      });
    }

    // Constraint tensions
    if (summary.constraint_tensions.length > 0) {
      sections.push({
        heading: 'Constraints',
        content: `Tensions: ${summary.constraint_tensions.join('; ')}.`,
      });
    }

    // Build narrative from sections for the block
    const narrativeParts: string[] = [];
    for (const section of sections) {
      if (section.content) narrativeParts.push(`**${section.heading}**: ${section.content}`);
      if (section.items) narrativeParts.push(`**${section.heading}**: ${section.items.join(', ')}`);
    }
    const narrative = narrativeParts.join('\n\n');

    // Commentary block uses standard factory but carries sections in data
    const block = createCommentaryBlock(narrative, ctx.scenario_id, 'deterministic:explain_result');
    // Attach sections to the block data for structured rendering
    (block.data as DeterministicCommentaryBlockData).sections = sections;

    // Short summary for assistantText
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
