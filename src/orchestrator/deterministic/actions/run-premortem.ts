/**
 * run_premortem Action
 *
 * Code extracts risk paths from target option through graph.
 * LLM narrates failure scenario.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";
import { resolveEntity } from "../entity-resolver.js";

export const runPremortermAction: ActionDefinition = {
  action_type: 'run_premortem',
  description: 'Run a pre-mortem analysis for an option — imagine it failed and explore why.',
  stage_eligibility: new Set(['evaluate', 'decide', 'optimise']),
  requires_target: false,
  requires_confirmation: false,
  execution_risk: 'none',
  reversible: true,
  surface: 'panel',
  role: 'challenger',
  cooldown: 'suppress_same_turn',

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.analysis_summary) return 'No analysis results available. Run analysis first.';
    return null;
  },

  async execute(params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const targetRef = params.target_id as string | undefined;
    let targetLabel: string;

    if (targetRef) {
      const resolution = resolveEntity(targetRef, ctx.entities, 'none');
      targetLabel = resolution.status === 'resolved' ? resolution.entity!.label : targetRef;
    } else {
      // Default to the winner
      targetLabel = ctx.analysis_summary?.winner ?? 'the leading option';
    }

    const sections: string[] = [];
    sections.push(`**Pre-mortem: What if ${targetLabel} fails?**`);

    // Extract risk paths — factors with high sensitivity that could go wrong
    const drivers = ctx.analysis_summary?.top_drivers ?? [];
    if (drivers.length > 0) {
      sections.push('Key vulnerabilities:');
      for (const driver of drivers.slice(0, 3)) {
        const node = ctx.entities.nodes.get(driver.factor_id);
        const uncertaintyNote = ctx.signals.high_uncertainty_factors.includes(driver.factor_id)
          ? ' (high uncertainty)'
          : '';
        sections.push(
          `- **${driver.label}** (sensitivity: ${driver.sensitivity.toFixed(2)})${uncertaintyNote}: If this factor moves against ${targetLabel}, the outcome shifts significantly.`,
        );
      }
    }

    // Fragile edges
    if (ctx.analysis_summary && ctx.analysis_summary.fragile_edge_count > 0) {
      sections.push(
        `\nThe model has ${ctx.analysis_summary.fragile_edge_count} fragile edge${ctx.analysis_summary.fragile_edge_count > 1 ? 's' : ''} — causal links where small changes in strength could change the result.`,
      );
    }

    // Close call warning
    if (ctx.signals.close_call) {
      sections.push(
        '\nThe race is tight — a small shift in any key driver could flip the recommendation.',
      );
    }

    sections.push(
      '\n*Pre-mortem technique* — imagining failure in advance helps identify risks that optimism bias would otherwise hide.',
    );

    return {
      blocks: [],
      assistantText: sections.join('\n\n'),
      guidance_items: [],
    };
  },

  chipLabel() { return 'Pre-mortem'; },
  chipPrompt(rec) {
    return rec.target_id ? `Run a pre-mortem on ${rec.target_id}` : 'Run a pre-mortem';
  },
};
