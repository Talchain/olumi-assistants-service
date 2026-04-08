/**
 * run_analysis Action
 *
 * Delegates to existing handleRunAnalysis with proper ConversationContext.
 * Uses ctx.analysis_inputs from TurnContext (populated by Brief 1 Task 6c).
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult } from "../types.js";
import type { ConversationContext } from "../../types.js";
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
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.graph) return 'No decision model available.';
    if (!ctx.capabilities.can_run_analysis) return 'Model needs at least one option before analysis can run.';
    return null;
  },

  async execute(_params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    if (!ctx.analysis_inputs) {
      return {
        blocks: [],
        assistantText: "Analysis can't run yet: the graph needs option interventions encoded. Check the analysis panel for specific requirements.",
        guidance_items: [],
      };
    }

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

      const context: ConversationContext = {
        graph: ctx.graph,
        analysis_response: ctx.analysis,
        framing: ctx.stage ? { stage: ctx.stage } : null,
        messages: [],
        scenario_id: ctx.scenario_id,
        analysis_inputs: ctx.analysis_inputs,
      };

      const result = await handleRunAnalysis(
        context,
        plotClient,
        'deterministic-pipeline',
        `det-${ctx.scenario_id}`,
      );

      // Check for blocked/failed analysis — surface specific reason instead of generic "complete"
      const analysisResponse = result.analysisResponse;
      const analysisStatus = (analysisResponse as Record<string, unknown>)?.analysis_status as string | undefined;

      if (analysisStatus === 'blocked') {
        const statusReason = (analysisResponse as Record<string, unknown>)?.status_reason as string | undefined;
        const critiques = (analysisResponse as Record<string, unknown>)?.critiques as Array<{ message?: string }> | undefined;
        const critiqueDetail = critiques?.map((c) => c.message).filter(Boolean).join('; ');
        const message = statusReason
          ? `Analysis blocked: ${statusReason}${critiqueDetail ? ` (${critiqueDetail})` : ''}`
          : 'Analysis blocked due to model configuration issues. Check option interventions and retry.';
        return {
          blocks: result.blocks ?? [],
          assistantText: message,
          guidance_items: [],
          analysis_response: analysisResponse ?? undefined,
        };
      }

      if (analysisStatus === 'failed') {
        const statusReason = (analysisResponse as Record<string, unknown>)?.status_reason as string | undefined;
        return {
          blocks: result.blocks ?? [],
          assistantText: statusReason
            ? `The analysis tool couldn't process the full request: ${statusReason}. Here's what I can tell you from the available data.`
            : "The analysis tool couldn't process the full request. Here's what I can tell you from the available data.",
          guidance_items: [],
          analysis_response: analysisResponse ?? undefined,
        };
      }

      return {
        blocks: result.blocks ?? [],
        assistantText: 'Analysis complete.',
        guidance_items: [],
        analysis_response: analysisResponse ?? undefined,
      };
    } catch (err) {
      // Distinguish error types for specific user-facing messages
      const { PLoTTimeoutError: TimeoutErr, PLoTError: PlotErr } = await import("../../plot-client.js");

      if (err instanceof TimeoutErr) {
        log.error({ err, turn_id: ctx.turn_id }, 'deterministic.run_analysis.timeout');
        return {
          blocks: [],
          assistantText: 'The analysis service timed out. Your model is unchanged; try again.',
          guidance_items: [],
        };
      }

      if (err instanceof PlotErr && err.v2RunError) {
        const v2 = err.v2RunError;
        const reason = v2.status_reason ?? 'Unknown analysis error';
        const critiqueDetail = v2.critiques?.map((c) => c.message).filter(Boolean).join('; ');
        log.error({ err, turn_id: ctx.turn_id, analysis_status: v2.analysis_status }, 'deterministic.run_analysis.plot_error');
        return {
          blocks: [],
          assistantText: `Analysis failed: ${reason}${critiqueDetail ? `: ${critiqueDetail}` : ''}`,
          guidance_items: [],
        };
      }

      log.error({ err, turn_id: ctx.turn_id }, 'deterministic.run_analysis.failed');
      return {
        blocks: [],
        assistantText: 'The analysis service returned an error. Your model is unchanged.',
        guidance_items: [],
      };
    }
  },

  chipLabel() { return 'Run analysis'; },
  chipPrompt() { return 'Run the analysis'; },
};
