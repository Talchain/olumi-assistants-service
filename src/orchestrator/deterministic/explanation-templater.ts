/**
 * Explanation Templater
 *
 * Code-templates structured sections from analysis data.
 * LLM writes narrative only — never fabricates numbers.
 *
 * Pattern applies to: explain_result, compare_options,
 * challenge_assumption, run_premortem, what_would_flip.
 */

import type { DeterministicTurnContext, AnalysisSummary, DriverSummary } from "./types.js";

// ============================================================================
// Template Types
// ============================================================================

export interface TemplatedSection {
  heading: string;
  data_lines: string[];
  /** When true, LLM should add narrative. When false, data speaks for itself. */
  needs_narrative: boolean;
}

export interface ExplanationTemplate {
  action_type: string;
  sections: TemplatedSection[];
  /** Data available for the LLM's narrative. */
  context_for_narrative: Record<string, unknown>;
}

// ============================================================================
// Public API
// ============================================================================

export function templateExplainResult(ctx: DeterministicTurnContext): ExplanationTemplate {
  const summary = ctx.analysis_summary;
  const sections: TemplatedSection[] = [];

  sections.push({
    heading: 'Winner',
    data_lines: summary?.winner
      ? [`${summary.winner}: ${formatProbability(summary.winner_probability)}`]
      : ['No clear winner.'],
    needs_narrative: true,
  });

  sections.push({
    heading: 'Robustness',
    data_lines: summary?.robustness_band
      ? [`Level: ${summary.robustness_band}`]
      : ['Robustness data not available.'],
    needs_narrative: false,
  });

  sections.push(buildDriverSection(summary));

  if (summary?.constraint_tensions && summary.constraint_tensions.length > 0) {
    sections.push({
      heading: 'Constraints',
      data_lines: summary.constraint_tensions,
      needs_narrative: true,
    });
  }

  return {
    action_type: 'explain_result',
    sections,
    context_for_narrative: { winner: summary?.winner, robustness: summary?.robustness_band },
  };
}

export function templateCompareOptions(ctx: DeterministicTurnContext): ExplanationTemplate {
  const analysis = ctx.analysis;
  const sections: TemplatedSection[] = [];

  if (!analysis) {
    return { action_type: 'compare_options', sections: [], context_for_narrative: {} };
  }

  const results = (analysis.results as Array<Record<string, unknown>>)
    .filter((r) => typeof r.win_probability === 'number')
    .sort((a, b) => (b.win_probability as number) - (a.win_probability as number));

  sections.push({
    heading: 'Option Probabilities',
    data_lines: results.map((r) => `${r.option_label}: ${formatProbability(r.win_probability as number)}`),
    needs_narrative: true,
  });

  // Margin
  if (results.length >= 2) {
    const margin = ((results[0].win_probability as number) - (results[1].win_probability as number)) * 100;
    sections.push({
      heading: 'Margin',
      data_lines: [`${margin.toFixed(1)} percentage points between top two`],
      needs_narrative: false,
    });
  }

  return {
    action_type: 'compare_options',
    sections,
    context_for_narrative: { option_count: results.length },
  };
}

export function templateChallenge(ctx: DeterministicTurnContext, targetId: string | null): ExplanationTemplate {
  const sections: TemplatedSection[] = [];

  if (targetId) {
    const node = ctx.entities.nodes.get(targetId);
    const edges = ctx.entities.edges.filter((e) => e.from === targetId || e.to === targetId);
    const weakEdges = edges.filter((e) => Math.abs(e.strength_mean) < 0.5);

    sections.push({
      heading: 'Target',
      data_lines: [node ? `${node.label} (${node.kind})` : targetId],
      needs_narrative: false,
    });

    if (weakEdges.length > 0) {
      sections.push({
        heading: 'Weak Connections',
        data_lines: weakEdges.map((e) => `${e.from_label} → ${e.to_label}: strength ${e.strength_mean.toFixed(2)}`),
        needs_narrative: true,
      });
    }

    // Driver status
    const driver = ctx.analysis_summary?.top_drivers.find((d) => d.factor_id === targetId);
    if (driver) {
      sections.push({
        heading: 'Sensitivity',
        data_lines: [`Sensitivity: ${driver.sensitivity.toFixed(2)} (${driver.direction})`],
        needs_narrative: true,
      });
    }
  }

  return {
    action_type: 'challenge_assumption',
    sections,
    context_for_narrative: { target_id: targetId },
  };
}

export function templatePremortem(ctx: DeterministicTurnContext, targetOption: string): ExplanationTemplate {
  const sections: TemplatedSection[] = [];

  sections.push({
    heading: 'Target Option',
    data_lines: [targetOption],
    needs_narrative: false,
  });

  const drivers = ctx.analysis_summary?.top_drivers ?? [];
  if (drivers.length > 0) {
    sections.push({
      heading: 'Key Vulnerabilities',
      data_lines: drivers.slice(0, 3).map((d) => {
        const uncertain = ctx.signals.high_uncertainty_factors.includes(d.factor_id) ? ' [HIGH UNCERTAINTY]' : '';
        return `${d.label}: sensitivity ${d.sensitivity.toFixed(2)}${uncertain}`;
      }),
      needs_narrative: true,
    });
  } else {
    sections.push({
      heading: 'Key Vulnerabilities',
      data_lines: ['Driver data not available.'],
      needs_narrative: false,
    });
  }

  if (ctx.analysis_summary && ctx.analysis_summary.fragile_edge_count > 0) {
    sections.push({
      heading: 'Fragile Edges',
      data_lines: [`${ctx.analysis_summary.fragile_edge_count} fragile edges in the model`],
      needs_narrative: true,
    });
  }

  return {
    action_type: 'run_premortem',
    sections,
    context_for_narrative: { target: targetOption, close_call: ctx.signals.close_call },
  };
}

export function templateFlip(ctx: DeterministicTurnContext): ExplanationTemplate {
  const summary = ctx.analysis_summary;
  const sections: TemplatedSection[] = [];

  if (!summary?.winner) {
    return { action_type: 'what_would_flip', sections: [], context_for_narrative: {} };
  }

  sections.push({
    heading: 'Current Winner',
    data_lines: [`${summary.winner}: ${formatProbability(summary.winner_probability)}`],
    needs_narrative: false,
  });

  const drivers = summary.top_drivers;
  if (drivers.length > 0) {
    sections.push({
      heading: 'Most Sensitive Levers',
      data_lines: drivers.slice(0, 3).map((d) => {
        const node = ctx.entities.nodes.get(d.factor_id);
        const value = node?.value != null ? ` (current: ${node.value}${node.unit ? ' ' + node.unit : ''})` : '';
        return `${d.label}${value}: sensitivity ${d.sensitivity.toFixed(2)}`;
      }),
      needs_narrative: true,
    });
  } else {
    sections.push({
      heading: 'Most Sensitive Levers',
      data_lines: ['Driver data not available.'],
      needs_narrative: false,
    });
  }

  // Margin
  if (summary.runner_up && summary.winner_probability != null && summary.runner_up_probability != null) {
    const margin = (summary.winner_probability - summary.runner_up_probability) * 100;
    sections.push({
      heading: 'Flip Difficulty',
      data_lines: [`Margin: ${margin.toFixed(1)} points (${margin < 10 ? 'easy to flip' : 'significant shift needed'})`],
      needs_narrative: false,
    });
  }

  return {
    action_type: 'what_would_flip',
    sections,
    context_for_narrative: { winner: summary.winner, runner_up: summary.runner_up },
  };
}

// ============================================================================
// Helpers
// ============================================================================

function buildDriverSection(summary: AnalysisSummary | null): TemplatedSection {
  if (!summary || summary.top_drivers.length === 0) {
    return {
      heading: 'Top Drivers',
      data_lines: ['Driver data not available.'],
      needs_narrative: false,
    };
  }

  return {
    heading: 'Top Drivers',
    data_lines: summary.top_drivers.slice(0, 5).map(
      (d) => `${d.label}: sensitivity ${d.sensitivity.toFixed(2)} (${d.direction})`,
    ),
    needs_narrative: true,
  };
}

function formatProbability(p: number | null | undefined): string {
  if (p == null) return 'N/A';
  return `${(p * 100).toFixed(0)}%`;
}
