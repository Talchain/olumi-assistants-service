/**
 * run_premortem Action
 *
 * Code extracts risk paths from target option through graph.
 * Returns a PremortemBlock with structured risk data.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult, PremortemBlockData } from "../types.js";
import { resolveEntity } from "../entity-resolver.js";
import { createPremortemBlock } from "../../blocks/factory.js";

export const runPremortemAction: ActionDefinition = {
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
      targetLabel = ctx.analysis_summary?.winner ?? 'the leading option';
    }

    const drivers = ctx.analysis_summary?.top_drivers ?? [];
    const riskPaths: PremortemBlockData['risk_paths'] = drivers.slice(0, 3).map((driver, i) => {
      const uncertaintyNote = ctx.signals.high_uncertainty_factors.includes(driver.factor_id)
        ? ' (high uncertainty)'
        : '';
      return {
        factor_id: driver.factor_id,
        factor_label: driver.label,
        influence_rank: i + 1,
        failure_mode: `If ${driver.label} moves against ${targetLabel}, the outcome shifts significantly.${uncertaintyNote}`,
      };
    });

    // Build narrative
    const narrativeParts: string[] = [];
    if (ctx.analysis_summary && ctx.analysis_summary.fragile_edge_count > 0) {
      narrativeParts.push(
        `The model has ${ctx.analysis_summary.fragile_edge_count} fragile edge${ctx.analysis_summary.fragile_edge_count > 1 ? 's' : ''} — causal links where small changes in strength could change the result.`,
      );
    }
    if (ctx.signals.close_call) {
      narrativeParts.push(
        'The race is tight — a small shift in any key driver could flip the recommendation.',
      );
    }
    narrativeParts.push(
      'Pre-mortem technique — imagining failure in advance helps identify risks that optimism bias would otherwise hide.',
    );

    const blockData: PremortemBlockData = {
      target_option: targetLabel,
      risk_paths: riskPaths,
      narrative: narrativeParts.join('\n'),
    };

    const block = createPremortemBlock(blockData, '');

    return {
      blocks: [block],
      assistantText: `Pre-mortem for ${targetLabel}: ${riskPaths.length} key vulnerabilities identified.`,
      guidance_items: [],
    };
  },

  chipLabel() { return 'Pre-mortem'; },
  chipPrompt(rec) {
    return rec.target_id ? `Run a pre-mortem on ${rec.target_id}` : 'Run a pre-mortem';
  },
};
