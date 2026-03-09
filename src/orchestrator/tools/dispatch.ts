/**
 * Shared Tool Dispatch
 *
 * Extracts the tool dispatch logic into a shared module used by both
 * V1 (turn-handler.ts) and V2 (pipeline phase4-tools).
 *
 * Each handler is imported directly from its own module.
 * V1 and V2 share the same tool handler code — no duplication.
 */

import type { FastifyRequest } from "fastify";
import type { ConversationBlock, ConversationContext, OrchestratorError, V2RunResponseEnvelope } from "../types.js";
import type { PLoTClient, PLoTClientRunOpts } from "../plot-client.js";
import { createPLoTClient } from "../plot-client.js";
import { getAdapter } from "../../adapters/llm/router.js";
import { handleRunAnalysis } from "./run-analysis.js";
import { handleDraftGraph } from "./draft-graph.js";
import { handleGenerateBrief } from "./generate-brief.js";
import { handleEditGraph } from "./edit-graph.js";
import { handleExplainResults } from "./explain-results.js";
import { handleUndoPatch } from "./undo-patch.js";
import { generatePostDraftGuidance } from "../guidance/post-draft.js";
import { generatePostAnalysisGuidance } from "../guidance/post-analysis.js";
import type { GuidanceItem } from "../types/guidance-item.js";
import type { ExerciseType } from "../types/guidance-item.js";
import { handleRunExercise } from "./run-exercise.js";
import { handleResearchTopic } from "./research-topic.js";

// ============================================================================
// Types
// ============================================================================

export interface ToolDispatchResult {
  blocks: ConversationBlock[];
  assistantText: string | null;
  analysisResponse?: V2RunResponseEnvelope;
  toolLatencyMs?: number;
  guidanceItems: GuidanceItem[];
  /** Suggested follow-up actions from tool handler (e.g. "Re-run analysis" after edit_graph). */
  suggestedActions?: Array<{ label: string; prompt: string; role: 'facilitator' | 'challenger' }>;
}

export interface ToolDispatchOpts {
  plotOpts?: PLoTClientRunOpts;
  request?: FastifyRequest;
  /**
   * User's intent classification from Phase 1.
   * When run_analysis is dispatched and intent is 'explain' or 'recommend',
   * explain_results is automatically chained after run_analysis completes.
   */
  intentClassification?: string;
}

// ============================================================================
// Singleton PLoT client (lazy)
// ============================================================================

let plotClient: PLoTClient | null | undefined;

function getPlotClient(): PLoTClient | null {
  if (plotClient === undefined) {
    plotClient = createPLoTClient();
  }
  return plotClient;
}

/** Test-only: reset singleton. */
export function _resetDispatchPlotClient(): void {
  plotClient = undefined;
}

// ============================================================================
// Dispatch
// ============================================================================

/**
 * Dispatch a tool invocation to the appropriate handler.
 *
 * Shared by V1 turn-handler and V2 pipeline phase4.
 * Returns raw result (blocks, text, analysis) — envelope assembly is the caller's responsibility.
 */
export async function dispatchToolHandler(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: ConversationContext,
  turnId: string,
  requestId: string,
  opts?: ToolDispatchOpts,
): Promise<ToolDispatchResult> {
  const _startTime = Date.now();

  switch (toolName) {
    case 'run_analysis': {
      const client = getPlotClient();
      if (!client) {
        throw Object.assign(new Error('PLoT client not configured'), {
          orchestratorError: {
            code: 'TOOL_EXECUTION_FAILED' as const,
            message: 'Analysis service not configured. Set PLOT_BASE_URL.',
            tool: 'run_analysis',
            recoverable: false,
          } satisfies OrchestratorError,
        });
      }
      const result = await handleRunAnalysis(context, client, requestId, turnId, opts?.plotOpts);

      const blocks = [...result.blocks];
      let assistantText: string | null = null;

      // Auto-chain explain_results when intent is 'explain' or 'recommend' (not pure 'act')
      const intent = opts?.intentClassification;
      if (intent === 'explain' || intent === 'recommend') {
        const explainContext: ConversationContext = {
          ...context,
          analysis_response: result.analysisResponse,
        };
        const adapter = getAdapter('orchestrator');
        try {
          const explainResult = await handleExplainResults(
            explainContext,
            adapter,
            requestId,
            turnId,
          );
          blocks.push(...explainResult.blocks);
        } catch {
          // Non-fatal: if explanation fails, still return analysis results
        }
      }

      const analysisGuidance = result.analysisResponse
        ? generatePostAnalysisGuidance(result.analysisResponse, context.graph ?? null, {
            intentClassification: opts?.intentClassification,
          })
        : [];

      return {
        blocks,
        assistantText,
        analysisResponse: result.analysisResponse,
        toolLatencyMs: result.latencyMs,
        guidanceItems: analysisGuidance,
      };
    }

    case 'draft_graph': {
      const brief = (toolInput.brief as string) || '';
      if (!opts?.request) {
        throw Object.assign(new Error('draft_graph requires FastifyRequest'), {
          orchestratorError: {
            code: 'TOOL_EXECUTION_FAILED' as const,
            message: 'Internal error: request context missing for draft_graph.',
            tool: 'draft_graph',
            recoverable: false,
          } satisfies OrchestratorError,
        });
      }
      const result = await handleDraftGraph(brief, opts.request, turnId);
      const draftGuidance = result.graphOutput
        ? generatePostDraftGuidance(result.graphOutput, result.draftWarnings, context.framing ?? null)
        : [];
      return {
        blocks: result.blocks,
        assistantText: result.assistantText,
        toolLatencyMs: result.latencyMs,
        guidanceItems: draftGuidance,
      };
    }

    case 'generate_brief': {
      const result = handleGenerateBrief(context, turnId);
      return {
        blocks: result.blocks,
        assistantText: result.assistantText,
        guidanceItems: [],
      };
    }

    case 'edit_graph': {
      const editDesc = (toolInput.edit_description as string) || '';
      const adapter = getAdapter('edit_graph');
      const result = await handleEditGraph(
        context,
        editDesc,
        adapter,
        requestId,
        turnId,
        { plotOpts: opts?.plotOpts },
      );
      // Run post-edit guidance only when edit succeeded (not rejected)
      const editGuidance = (!result.wasRejected && result.appliedGraph)
        ? generatePostDraftGuidance(result.appliedGraph, [], context.framing ?? null)
        : [];
      return {
        blocks: result.blocks,
        assistantText: result.assistantText,
        toolLatencyMs: result.latencyMs,
        guidanceItems: editGuidance,
        suggestedActions: result.suggestedActions,
      };
    }

    case 'explain_results': {
      const adapter = getAdapter('orchestrator');
      const focus = toolInput.focus as string | undefined;
      const result = await handleExplainResults(context, adapter, requestId, turnId, focus);
      return {
        blocks: result.blocks,
        assistantText: result.assistantText,
        toolLatencyMs: result.latencyMs,
        guidanceItems: [],
      };
    }

    // undo_patch: removed in v2, handler exists as latent LLM-invocable stub only (no gate patterns).
    case 'undo_patch': {
      const result = handleUndoPatch();
      return {
        blocks: result.blocks,
        assistantText: result.assistantText,
        guidanceItems: [],
      };
    }

    case 'run_exercise': {
      const exercise = toolInput.exercise as ExerciseType | undefined;
      if (!exercise) {
        const err: OrchestratorError = {
          code: 'TOOL_EXECUTION_FAILED',
          message: 'run_exercise invoked without exercise type. This is an internal routing error.',
          tool: 'run_exercise',
          recoverable: false,
        };
        throw Object.assign(new Error(err.message), { orchestratorError: err });
      }
      const adapter = getAdapter('orchestrator');
      const result = await handleRunExercise(exercise, context, adapter, requestId, turnId);
      return {
        blocks: result.blocks,
        assistantText: result.assistantText,
        toolLatencyMs: result.latencyMs,
        guidanceItems: [],
      };
    }

    case 'research_topic': {
      const query = (toolInput.query as string) || '';
      const targetFactor = toolInput.target_factor as string | undefined;
      const researchContext = toolInput.context as string | undefined;
      const result = await handleResearchTopic(query, context, requestId, turnId, targetFactor, researchContext);
      return {
        blocks: result.blocks,
        assistantText: result.assistantText,
        toolLatencyMs: result.latencyMs,
        guidanceItems: [],
      };
    }

    default: {
      const err: OrchestratorError = {
        code: 'TOOL_EXECUTION_FAILED',
        message: `Unknown tool: ${toolName}`,
        tool: toolName,
        recoverable: false,
      };
      throw Object.assign(new Error(err.message), { orchestratorError: err });
    }
  }
}
