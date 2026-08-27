/**
 * Pure projection of the internal ContextPack onto the compact structured
 * object the routing model actually receives.
 *
 * Keep this seam shared by prompt serialisation and whole-pack budgeting. Raw
 * graph/analysis fields remain available to deterministic handlers, but bytes
 * that buildUserMessage removes must never evict model-facing conversation.
 */

import type { ContextPack } from './context-pack-assembler.js';

export function projectModelFacingContextPack(
  contextPack: ContextPack,
): Record<string, unknown> {
  const {
    analysis: _rawAnalysis,
    display_analysis: displayAnalysis,
    graph: _rawGraph,
    display_graph: displayGraph,
    graph_context: graphContext,
    analysis_state: _analysisState,
    conversation_summary: conversationSummary,
    ...rest
  } = contextPack;
  void _rawAnalysis;
  void _rawGraph;
  void _analysisState;

  const resolvedGraphContext: NonNullable<ContextPack['graph_context']> =
    graphContext ?? { status: 'unavailable' };
  const resolvedRecentChangesStatus: ContextPack['recent_changes_status'] =
    contextPack.recent_changes_status === 'complete' ||
    contextPack.recent_changes_status === 'capped' ||
    contextPack.recent_changes_status === 'degraded'
      ? contextPack.recent_changes_status
      : 'degraded';

  return {
    ...rest,
    analysis: displayAnalysis,
    graph_context: resolvedGraphContext,
    graph: displayGraph,
    recent_changes_status: resolvedRecentChangesStatus,
    ...(conversationSummary !== undefined
      ? { conversation_summary: conversationSummary }
      : {}),
  };
}

export function measureModelFacingContextPackChars(
  contextPack: ContextPack,
): number {
  return JSON.stringify(projectModelFacingContextPack(contextPack)).length;
}
