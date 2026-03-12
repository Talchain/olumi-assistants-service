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
import type { ConversationBlock, ConversationContext, OrchestratorError, PendingClarificationState, PendingProposalState, V2RunResponseEnvelope, ProposedChangesPayload, AppliedChanges } from "../types.js";
import type { PLoTClient, PLoTClientRunOpts } from "../plot-client.js";
import { createPLoTClient } from "../plot-client.js";
import { getAdapter } from "../../adapters/llm/router.js";
import { handleRunAnalysis } from "./run-analysis.js";
import { handleDraftGraph } from "./draft-graph.js";
import { handleGenerateBrief } from "./generate-brief.js";
import { handleEditGraph } from "./edit-graph.js";
import type { EditGraphTraceDiagnostics } from "./edit-graph.js";
import { handleExplainResults } from "./explain-results.js";
import { handleUndoPatch } from "./undo-patch.js";
import { generatePostDraftGuidance } from "../guidance/post-draft.js";
import { generatePostAnalysisGuidance } from "../guidance/post-analysis.js";
import type { GuidanceItem } from "../types/guidance-item.js";
import type { ExerciseType } from "../types/guidance-item.js";
import { handleRunExercise } from "./run-exercise.js";
import { handleResearchTopic } from "./research-topic.js";
import type { RouteMetadata, RouteOutcome } from "../pipeline/types.js";
import { isAnalysisExplainable } from "../analysis-state.js";
import { log } from "../../utils/telemetry.js";
import type { LLMAdapter } from "../../adapters/llm/types.js";

// ============================================================================
// Default route metadata for tools that don't produce their own
// ============================================================================

function buildToolRouteMetadata(toolName: string, outcome?: RouteOutcome, adapter?: LLMAdapter): RouteMetadata {
  return {
    outcome: outcome ?? 'default_llm',
    reasoning: `tool_dispatch:${toolName}`,
    ...(adapter && {
      resolved_model: adapter.model,
      resolved_provider: adapter.name,
    }),
  };
}

/**
 * Log the resolved model and provider for an LLM adapter call.
 * Called after getAdapter() to emit structured observability on every LLM dispatch.
 */
function logResolvedAdapter(task: string, adapter: LLMAdapter, requestId: string): void {
  log.info(
    { request_id: requestId, task, resolved_model: adapter.model, resolved_provider: adapter.name },
    'dispatch.llm_call_resolved_model',
  );
}

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
  /** edit_graph-only diagnostics for orchestrator turn trace. */
  editGraphDiagnostics?: EditGraphTraceDiagnostics;
  pendingClarification?: PendingClarificationState;
  pendingProposal?: PendingProposalState;
  proposedChanges?: ProposedChangesPayload;
  routeMetadata?: RouteMetadata;
  /** Applied change receipt from a successful edit_graph. Absent on failed edits. */
  appliedChanges?: AppliedChanges;
  /** Which explain_results tier resolved this turn: 1 = cached, 2 = review data, 3 = LLM. */
  deterministicAnswerTier?: 1 | 2 | 3;
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
      let deterministicAnswerTier: 1 | 2 | 3 | undefined;

      // Auto-chain explain_results when intent is 'explain' or 'recommend' (not pure 'act')
      const intent = opts?.intentClassification;
      if ((intent === 'explain' || intent === 'recommend') && isAnalysisExplainable(result.analysisResponse)) {
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
          deterministicAnswerTier = explainResult.deterministic_answer_tier;
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
        routeMetadata: buildToolRouteMetadata('run_analysis'),
        ...(deterministicAnswerTier !== undefined && { deterministicAnswerTier }),
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
        routeMetadata: buildToolRouteMetadata('draft_graph'),
      };
    }

    case 'generate_brief': {
      const result = handleGenerateBrief(context, turnId);
      return {
        blocks: result.blocks,
        assistantText: result.assistantText,
        guidanceItems: [],
        routeMetadata: buildToolRouteMetadata('generate_brief'),
      };
    }

    case 'edit_graph': {
      const editDesc = (toolInput.edit_description as string) || '';
      const adapter = getAdapter('edit_graph');
      logResolvedAdapter('edit_graph', adapter, requestId);
      const result = await handleEditGraph(
        context,
        editDesc,
        adapter,
        requestId,
        turnId,
        { plotClient: getPlotClient(), plotOpts: opts?.plotOpts, invocationInput: toolInput },
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
        editGraphDiagnostics: result.diagnostics,
        pendingClarification: result.pendingClarification,
        pendingProposal: result.pendingProposal,
        proposedChanges: result.proposedChanges,
        routeMetadata: result.routeMetadata
          ? { ...result.routeMetadata, resolved_model: adapter.model, resolved_provider: adapter.name }
          : buildToolRouteMetadata('edit_graph', undefined, adapter),
        ...(result.appliedChanges && { appliedChanges: result.appliedChanges }),
      };
    }

    case 'explain_results': {
      const adapter = getAdapter('orchestrator');
      logResolvedAdapter('explain_results', adapter, requestId);
      const focus = toolInput.focus as string | undefined;
      const result = await handleExplainResults(context, adapter, requestId, turnId, focus);
      return {
        blocks: result.blocks,
        assistantText: result.assistantText,
        toolLatencyMs: result.latencyMs,
        guidanceItems: [],
        routeMetadata: buildToolRouteMetadata('explain_results', 'results_explanation', adapter),
        ...(result.deterministic_answer_tier !== undefined && { deterministicAnswerTier: result.deterministic_answer_tier }),
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
      logResolvedAdapter('run_exercise', adapter, requestId);
      const result = await handleRunExercise(exercise, context, adapter, requestId, turnId);
      return {
        blocks: result.blocks,
        assistantText: result.assistantText,
        toolLatencyMs: result.latencyMs,
        guidanceItems: [],
        routeMetadata: buildToolRouteMetadata('run_exercise', undefined, adapter),
      };
    }

    case 'research_topic': {
      const query = (toolInput.query as string) || '';
      const targetFactor = toolInput.target_factor as string | undefined;
      const researchContext = toolInput.context as string | undefined;
      // research_topic uses its own internal adapter — log from within handler
      const result = await handleResearchTopic(query, context, requestId, turnId, targetFactor, researchContext);
      return {
        blocks: result.blocks,
        assistantText: result.assistantText,
        toolLatencyMs: result.latencyMs,
        guidanceItems: [],
        routeMetadata: buildToolRouteMetadata('research_topic'),
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
