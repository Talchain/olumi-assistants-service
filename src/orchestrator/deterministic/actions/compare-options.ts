/**
 * compare_options Action
 *
 * Code templates comparison from option probabilities.
 * Returns a ComparisonBlock with structured option data.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult, ComparisonBlockData } from "../types.js";
import { createComparisonBlock } from "../../blocks/factory.js";

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

    const options: ComparisonBlockData['options'] = results.map((r) => ({
      option_id: (r.option_id as string) ?? '',
      label: r.option_label as string,
      win_probability: r.win_probability as number,
      strengths: [],
      weaknesses: [],
    }));

    // Build narrative for the comparison
    const narrativeParts: string[] = [];
    const margin = (results[0].win_probability as number - (results[1].win_probability as number)) * 100;
    if (margin < 5) {
      narrativeParts.push(`This is a close call — only ${margin.toFixed(1)} percentage points separate the top two options.`);
    } else if (margin > 20) {
      narrativeParts.push(`${results[0].option_label} has a clear lead of ${margin.toFixed(0)} percentage points.`);
    }

    const differentiators: string[] = [];
    if (ctx.analysis_summary?.top_drivers && ctx.analysis_summary.top_drivers.length > 0) {
      differentiators.push(...ctx.analysis_summary.top_drivers.slice(0, 3).map((d) => d.label));
    }

    const blockData: ComparisonBlockData = {
      options,
      differentiators,
      narrative: narrativeParts.join(' '),
    };

    const block = createComparisonBlock(blockData, '');

    return {
      blocks: [block],
      assistantText: `Comparing ${results.length} options — ${results[0].option_label} leads at ${((results[0].win_probability as number) * 100).toFixed(0)}%.`,
      guidance_items: [],
    };
  },

  chipLabel() { return 'Compare options'; },
  chipPrompt() { return 'Compare the options'; },
};
