/**
 * run_analysis Action
 *
 * Delegates to existing handleRunAnalysis. Check prerequisites.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";
import { log } from "../../../utils/telemetry.js";

export const runAnalysisAction: ActionDefinition = {
  action_type: 'run_analysis',
  description: 'Run Monte Carlo analysis on the decision model.',
  stage_eligibility: new Set(['evaluate', 'optimise']),
  requires_target: false,
  requires_confirmation: false,
  execution_risk: 'none',
  reversible: true,
  surface: 'inline',
  role: 'scientist',
  cooldown: 'suppress_until_state_change',

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.graph) return 'No decision model available.';
    if (!ctx.capabilities.can_run_analysis) return 'Model needs at least one option before analysis can run.';
    return null;
  },

  async execute(_params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    // Delegate to existing handleRunAnalysis — dynamic import to avoid circular deps
    try {
      const { handleRunAnalysis } = await import("../../tools/run-analysis.js");
      const { createPLoTClient } = await import("../../plot-client.js");

      const plotClient = createPLoTClient();
      if (!plotClient) {
        return {
          blocks: [],
          assistantText: 'Analysis service is not configured. Check PLoT connection.',
          guidance_items: [],
        };
      }

      const context = {
        graph: ctx.graph,
        analysis_response: ctx.analysis,
        framing: null,
        messages: [],
        scenario_id: ctx.scenario_id,
        analysis_inputs: null,
      };

      const result = await handleRunAnalysis(
        context as any,
        plotClient,
        'deterministic-pipeline',
        `det-${ctx.scenario_id}`,
      );

      return {
        blocks: result.blocks ?? [],
        assistantText: 'Analysis complete.',
        guidance_items: [],
        analysis_response: result.analysisResponse ?? undefined,
      };
    } catch (err) {
      log.error({ err }, 'deterministic.run_analysis.failed');
      return {
        blocks: [],
        assistantText: 'Analysis could not be completed. Please try again.',
        guidance_items: [],
      };
    }
  },

  chipLabel() { return 'Run analysis'; },
  chipPrompt() { return 'Run the analysis'; },
};
