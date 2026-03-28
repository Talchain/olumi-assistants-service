/**
 * compare_options Action
 *
 * Code templates comparison table from option probabilities.
 * LLM writes interpretive narrative.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";

export const compareOptionsAction: ActionDefinition = {
  action_type: 'compare_options',
  description: 'Compare options side-by-side with probabilities and trade-offs.',
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
    if (!ctx.analysis) return 'No analysis data available.';
    return null;
  },

  async execute(_params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const analysis = ctx.analysis!;
    const results = (analysis.results as Array<Record<string, unknown>>)
      .filter((r) => typeof r.win_probability === 'number')
      .sort((a, b) => (b.win_probability as number) - (a.win_probability as number));

    if (results.length < 2) {
      return {
        blocks: [],
        assistantText: 'Need at least two options with analysis results to compare.',
        guidance_items: [],
      };
    }

    const lines: string[] = ['**Option Comparison**\n'];

    for (const result of results) {
      const label = result.option_label as string;
      const prob = ((result.win_probability as number) * 100).toFixed(0);
      lines.push(`- **${label}**: ${prob}% win probability`);
    }

    // Margin
    if (results.length >= 2) {
      const margin = ((results[0].win_probability as number) - (results[1].win_probability as number)) * 100;
      if (margin < 5) {
        lines.push(`\nThis is a **close call** — only ${margin.toFixed(1)} percentage points separate the top two options.`);
      } else if (margin > 20) {
        lines.push(`\n**${results[0].option_label}** has a clear lead of ${margin.toFixed(0)} percentage points.`);
      }
    }

    return {
      blocks: [],
      assistantText: lines.join('\n'),
      guidance_items: [],
    };
  },

  chipLabel() { return 'Compare options'; },
  chipPrompt() { return 'Compare the options'; },
};
