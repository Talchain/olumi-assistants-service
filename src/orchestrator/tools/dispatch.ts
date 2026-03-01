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

// ============================================================================
// Types
// ============================================================================

export interface ToolDispatchResult {
  blocks: ConversationBlock[];
  assistantText: string | null;
  analysisResponse?: V2RunResponseEnvelope;
  toolLatencyMs?: number;
}

export interface ToolDispatchOpts {
  plotOpts?: PLoTClientRunOpts;
  request?: FastifyRequest;
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
      return {
        blocks: result.blocks,
        assistantText: null,
        analysisResponse: result.analysisResponse,
        toolLatencyMs: result.latencyMs,
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
      return {
        blocks: result.blocks,
        assistantText: result.assistantText,
        toolLatencyMs: result.latencyMs,
      };
    }

    case 'generate_brief': {
      const result = handleGenerateBrief(context, turnId);
      return {
        blocks: result.blocks,
        assistantText: result.assistantText,
      };
    }

    case 'edit_graph': {
      const editDesc = (toolInput.edit_description as string) || '';
      const adapter = getAdapter('orchestrator');
      const result = await handleEditGraph(
        context,
        editDesc,
        adapter,
        requestId,
        turnId,
        { plotOpts: opts?.plotOpts },
      );
      return {
        blocks: result.blocks,
        assistantText: result.assistantText,
        toolLatencyMs: result.latencyMs,
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
      };
    }

    case 'undo_patch': {
      const result = handleUndoPatch();
      return {
        blocks: result.blocks,
        assistantText: result.assistantText,
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
