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
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.analysis_summary) return 'No analysis results available. Run analysis first.';
    if (!ctx.analysis) return 'No analysis data available.';
    return null;
  },

  async execute(_params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const analysis = ctx.analysis!;
    const rawResults = analysis.results;
    if (!Array.isArray(rawResults) || rawResults.length === 0) {
      return { blocks: [], assistantText: 'No analysis results available to compare.', guidance_items: [] };
    }
    const results = (rawResults as Array<Record<string, unknown>>)
      .filter((r) => r != null && typeof r === 'object' && typeof r.win_probability === 'number')
      .sort((a, b) => (b.win_probability as number) - (a.win_probability as number));

    if (results.length < 2) {
      return {
        blocks: [],
        assistantText: 'Need at least two options with analysis results to compare.',
        guidance_items: [],
      };
    }

    const drivers = ctx.analysis_summary?.top_drivers ?? [];
    const driverLabels = drivers.slice(0, 3).map((d) => d.label);
    const differentiators = driverLabels.length > 0
      ? driverLabels
      : ['Combined factor effects'];

    const options: ComparisonBlockData['options'] = results.map((r, i) => ({
      id: (r.option_id as string) ?? '',
      label: r.option_label as string,
      probability: r.win_probability as number,
      rank: i + 1,
      strengths: [],
      weaknesses: [],
      key_differentiators: differentiators,
    }));

    const margin = (results[0].win_probability as number - (results[1].win_probability as number)) * 100;
    const narrativeParts: string[] = [];
    if (margin < 5) {
      narrativeParts.push(`This is a close call — only ${margin.toFixed(1)} percentage points separate the top two options.`);
    } else if (margin > 20) {
      narrativeParts.push(`${results[0].option_label} has a clear lead of ${margin.toFixed(0)} percentage points.`);
    }
    // When no driver data but fragile edges exist, surface fragility in the narrative
    const fragileCount = ctx.analysis_summary?.fragile_edge_count ?? 0;
    if (driverLabels.length === 0 && fragileCount > 0) {
      narrativeParts.push(`${fragileCount} fragile edge${fragileCount > 1 ? 's' : ''} detected — small assumption changes could shift the ranking.`);
    }
    const narrative = narrativeParts.join(' ');

    const blockData: ComparisonBlockData = { options, narrative };
    const block = createComparisonBlock(blockData, ctx.turn_id);

    return {
      blocks: [block],
      assistantText: `Comparing ${results.length} options — ${results[0].option_label} leads at ${((results[0].win_probability as number) * 100).toFixed(0)}%.`,
      guidance_items: [],
    };
  },

  chipLabel() { return 'Compare options'; },
  chipPrompt() { return 'Compare the options'; },
};
