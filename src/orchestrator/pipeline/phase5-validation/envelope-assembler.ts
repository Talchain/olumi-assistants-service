/**
 * Envelope Assembler (V2)
 *
 * Composes the final OrchestratorResponseEnvelopeV2 with all new fields:
 * stage_indicator, progress_marker, science_ledger, observability, turn_plan, lineage.
 */

import { isProduction, config } from "../../../config/index.js";
import { isLongRunningTool } from "../../tools/registry.js";
import { getDskVersionHash } from "../../dsk-loader.js";
import { computeContextHash, toHashableContext } from "../../context/context-hash.js";
import { computeStructuralReadiness } from "../../tools/analysis-ready-helper.js";
import { buildModelReceipt } from "./model-receipt.js";
import type {
  EnrichedContext,
  SpecialistResult,
  LLMResult,
  ToolResult,
  OrchestratorResponseEnvelopeV2,
  ScienceLedger,
  ProgressKind,
  SuggestedAction,
  TurnPlan,
} from "../types.js";
import type { StageTransition } from "./stage-transition.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve context_hash for envelope lineage following the three-tier rule:
 *   1. enrichedContext.context_hash exists → use it (pre-computed by Phase 1)
 *   2. enrichedContext exists but context_hash missing → compute via canonical
 *      computeContextHash, extracting only the HashableContext fields (mirrors Phase 1 logic)
 *   3. enrichedContext missing → '' (empty string; enrichment did not complete)
 *
 * Never compute a hash from partial context objects. If enrichment didn't
 * complete, the hash is ''.
 */
export function resolveContextHash(enrichedContext: EnrichedContext | undefined): string {
  if (!enrichedContext) return '';
  if (enrichedContext.context_hash != null) return enrichedContext.context_hash;

  // Tier 2: project to HashableContext via canonical helper (same projection as Phase 1)
  return computeContextHash(toHashableContext(enrichedContext));
}

// ============================================================================
// Envelope Assembly
// ============================================================================

export interface AssembleEnvelopeInput {
  enrichedContext: EnrichedContext;
  specialistResult: SpecialistResult;
  llmResult: LLMResult;
  toolResult: ToolResult;
  progressKind: ProgressKind;
  stageTransition: StageTransition | null;
  scienceLedger: ScienceLedger;
}

/**
 * Assemble the complete V2 response envelope.
 */
export function assembleV2Envelope(input: AssembleEnvelopeInput): OrchestratorResponseEnvelopeV2 {
  const {
    enrichedContext,
    specialistResult,
    llmResult,
    toolResult,
    progressKind,
    stageTransition,
    scienceLedger,
  } = input;

  // Resolve context hash via three-tier rule (pre-computed → canonical compute → '').
  const contextHash = resolveContextHash(enrichedContext);

  // Determine tool name and build turn_plan.
  // Use executed_tools from Phase4Result when available (multi-tool aware).
  // Fall back to first llmResult invocation for backward compatibility.
  const phase4Result = toolResult as (ToolResult & { executed_tools?: string[]; deferred_tools?: string[] });
  const executedTools: string[] = phase4Result.executed_tools ?? [];
  const deferredTools: string[] = phase4Result.deferred_tools ?? [];

  const toolName = executedTools.length > 0
    ? executedTools[0]
    : llmResult.tool_invocations.length > 0
      ? llmResult.tool_invocations[0].name
      : null;

  const isDeterministic = llmResult.tool_invocations.length > 0
    && llmResult.tool_invocations[0].id === 'deterministic';

  const turnPlan: TurnPlan = {
    selected_tool: toolName,
    routing: isDeterministic ? 'deterministic' : 'llm',
    long_running: toolName ? isLongRunningTool(toolName) : false,
  };
  if (toolResult.tool_latency_ms !== undefined) {
    turnPlan.tool_latency_ms = toolResult.tool_latency_ms;
  }
  if (executedTools.length > 1) {
    turnPlan.executed_tools = executedTools;
  }
  if (deferredTools.length > 0) {
    turnPlan.deferred_tools = deferredTools;
  }

  // Merge suggested actions: LLM-originated + tool-originated + rescue routes
  const suggestedActions: SuggestedAction[] = [
    ...llmResult.suggested_actions,
  ];
  if (toolResult.suggested_actions && toolResult.suggested_actions.length > 0) {
    suggestedActions.push(...toolResult.suggested_actions);
  }

  // When stuck, merge rescue routes into suggested_actions
  if (enrichedContext.stuck.detected) {
    suggestedActions.push(...enrichedContext.stuck.rescue_routes);
  }

  // Resolve assistant text: tool result text takes priority, then LLM text
  const assistantText = toolResult.assistant_text ?? llmResult.assistant_text;

  // Stage indicator with optional transition
  const stageIndicator: OrchestratorResponseEnvelopeV2['stage_indicator'] = {
    stage: enrichedContext.stage_indicator.stage,
    confidence: enrichedContext.stage_indicator.confidence,
    source: enrichedContext.stage_indicator.source,
  };
  if (enrichedContext.stage_indicator.substate) {
    stageIndicator.substate = enrichedContext.stage_indicator.substate;
  }
  if (stageTransition) {
    stageIndicator.transition = stageTransition;
    // Update stage to the transitioned value
    stageIndicator.stage = stageTransition.to;
  }

  const envelope: OrchestratorResponseEnvelopeV2 = {
    turn_id: enrichedContext.turn_id,
    assistant_text: assistantText,
    blocks: toolResult.blocks,
    suggested_actions: suggestedActions,
    guidance_items: toolResult.guidance_items,

    lineage: {
      context_hash: contextHash,
      // When DSK v0 is active, prefer the loaded bundle hash over any in-context stub value.
      // When DSK v0 is OFF, always emit null — no DSK presence regardless of context state.
      dsk_version_hash: config.features.dskV0
        ? (getDskVersionHash() ?? enrichedContext.dsk.version_hash)
        : null,
    },

    stage_indicator: stageIndicator,

    science_ledger: scienceLedger,

    progress_marker: {
      kind: progressKind,
    },

    observability: {
      triggers_fired: specialistResult.triggers_fired,
      triggers_suppressed: specialistResult.triggers_suppressed,
      intent_classification: enrichedContext.intent_classification,
      specialist_contributions: [],
      specialist_disagreement: null,
    },

    turn_plan: turnPlan,
  };

  if (toolResult.analysis_response) {
    envelope.analysis_response = toolResult.analysis_response;
  }

  // Add analysis response hash to lineage if available
  if (toolResult.analysis_response) {
    const ar = toolResult.analysis_response;
    envelope.lineage.response_hash = ar.response_hash ?? ar.meta?.response_hash;
  }

  // When analysis was blocked or failed, surface analysis_status fields in the envelope.
  // V2 contract: failures communicated via analysis_status, not HTTP status.
  if (toolResult.analysis_response) {
    const ar = toolResult.analysis_response as Record<string, unknown>;
    if (ar.analysis_status === 'blocked' || ar.analysis_status === 'failed') {
      envelope.analysis_status = ar.analysis_status as string;
      if (typeof ar.status_reason === 'string') envelope.status_reason = ar.status_reason;
      if (typeof ar.retryable === 'boolean') envelope.retryable = ar.retryable;
      if (Array.isArray(ar.critiques)) envelope.critiques = ar.critiques;
      if (typeof ar.meta === 'object' && ar.meta !== null) {
        envelope.meta = ar.meta as Record<string, unknown>;
      }
    }
  }

  // Compute envelope-level analysis_ready from current graph state.
  // Uses the post-tool graph when available (graph_patch blocks carry applied_graph),
  // falling back to enrichedContext.graph for turns without graph mutations.
  // Use the final graph_patch block — it reflects the latest authoritative graph.
  const graphPatchBlock = [...toolResult.blocks].reverse().find((b) => b.block_type === 'graph_patch');
  const appliedGraph = graphPatchBlock
    ? (graphPatchBlock.data as unknown as { applied_graph?: typeof enrichedContext.graph })?.applied_graph
    : undefined;
  const graphForReadiness = appliedGraph ?? enrichedContext.graph;
  if (graphForReadiness) {
    envelope.analysis_ready = computeStructuralReadiness(graphForReadiness);
  }

  // Model receipt (after analysis_ready so receipt can reference readiness)
  const modelReceipt = buildModelReceipt(toolResult.blocks, envelope.analysis_ready);
  if (modelReceipt) {
    envelope.model_receipt = modelReceipt;
  }

  // Debug fields (non-production only)
  if (!isProduction()) {
    if (llmResult.diagnostics) {
      envelope.diagnostics = llmResult.diagnostics;
    }
    if (llmResult.parse_warnings.length > 0) {
      envelope.parse_warnings = llmResult.parse_warnings;
    }
  }

  return envelope;
}

/**
 * Build a default error envelope when the pipeline fails.
 *
 * All new fields populated with safe defaults.
 */
export function buildErrorEnvelope(
  turnId: string,
  errorCode: string,
  errorMessage: string,
  enrichedContext?: EnrichedContext,
): OrchestratorResponseEnvelopeV2 {
  return {
    turn_id: turnId,
    assistant_text: 'I ran into a problem processing that. Could you try again?',
    blocks: [],
    suggested_actions: [],
    guidance_items: [],

    lineage: {
      context_hash: resolveContextHash(enrichedContext),
      dsk_version_hash: null,
    },

    stage_indicator: {
      stage: enrichedContext?.stage_indicator.stage ?? 'frame',
      confidence: 'low',
      source: 'inferred',
    },

    science_ledger: {
      claims_used: [],
      techniques_used: [],
      scope_violations: [],
      phrasing_violations: [],
      rewrite_applied: false,
    },

    progress_marker: {
      kind: 'none',
    },

    observability: {
      triggers_fired: [],
      triggers_suppressed: [],
      intent_classification: enrichedContext?.intent_classification ?? 'conversational',
      specialist_contributions: [],
      specialist_disagreement: null,
    },

    turn_plan: {
      selected_tool: null,
      routing: 'llm',
      long_running: false,
    },

    error: {
      code: errorCode,
      message: errorMessage,
    },
  };
}
