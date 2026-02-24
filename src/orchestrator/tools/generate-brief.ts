/**
 * generate_brief Tool Handler
 *
 * Extracts decision_brief from the most recent analysis_response in context.
 * No PLoT call — decision_brief is already produced by PLoT during /v2/run.
 *
 * If context.analysis_response is null or decision_brief absent:
 * → recoverable error: "Run analysis first to generate a brief."
 *
 * Output: BriefBlock wrapping DecisionBriefV1.
 * Actions: Share, Edit, Regenerate ("Run the analysis again.").
 */

import type { ConversationBlock, ConversationContext, OrchestratorError, BlockAction } from "../types.js";
import { createBriefBlock } from "../blocks/factory.js";

// ============================================================================
// Types
// ============================================================================

export interface GenerateBriefResult {
  blocks: ConversationBlock[];
  assistantText: string | null;
}

// ============================================================================
// Default Actions
// ============================================================================

const BRIEF_ACTIONS: BlockAction[] = [
  {
    action_id: 'brief_share',
    label: 'Share',
    action_type: 'navigate',
  },
  {
    action_id: 'brief_edit',
    label: 'Edit',
    action_type: 'prompt',
  },
  {
    action_id: 'brief_regenerate',
    label: 'Regenerate',
    action_type: 'prompt',
  },
];

// ============================================================================
// Handler
// ============================================================================

/**
 * Execute the generate_brief tool.
 *
 * @param context - Conversation context (must have analysis_response with decision_brief)
 * @param turnId - Turn ID for block provenance
 * @returns BriefBlock + optional assistant text
 */
export function handleGenerateBrief(
  context: ConversationContext,
  turnId: string,
): GenerateBriefResult {
  // Check: analysis_response present?
  if (!context.analysis_response) {
    const err: OrchestratorError = {
      code: 'TOOL_EXECUTION_FAILED',
      message: 'Run analysis first to generate a brief.',
      tool: 'generate_brief',
      recoverable: true,
      suggested_retry: 'Run the analysis first, then generate the brief.',
    };
    throw Object.assign(new Error(err.message), { orchestratorError: err });
  }

  // Check: decision_brief present in analysis response?
  const decisionBrief = context.analysis_response.decision_brief;
  if (!decisionBrief) {
    const err: OrchestratorError = {
      code: 'TOOL_EXECUTION_FAILED',
      message: 'The analysis response does not contain a decision brief. Run analysis first to generate a brief.',
      tool: 'generate_brief',
      recoverable: true,
      suggested_retry: 'Run the analysis again.',
    };
    throw Object.assign(new Error(err.message), { orchestratorError: err });
  }

  const block = createBriefBlock(decisionBrief, turnId, BRIEF_ACTIONS);

  return {
    blocks: [block],
    assistantText: null,
  };
}
