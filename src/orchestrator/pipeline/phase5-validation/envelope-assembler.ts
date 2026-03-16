/**
 * Envelope Assembler (V2)
 *
 * Composes the final OrchestratorResponseEnvelopeV2 with all new fields:
 * stage_indicator, progress_marker, science_ledger, observability, turn_plan, lineage.
 */

import { isProduction, config } from "../../../config/index.js";
import { checkFeatureHealth } from "../../../diagnostics/feature-health.js";
import { isLongRunningTool } from "../../tools/registry.js";
import { isToolAllowedAtStage } from "../../tools/stage-policy.js";
import { resolveDskHash } from "../../dsk-loader.js";
import { TURN_CONTRACT_VERSION, inferTurnType } from "../../turn-contract.js";
import { extractDeclaredMode, inferResponseMode } from "../../response-parser.js";
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
// Shared feature health map (used by success, error, and ack envelopes)
// ============================================================================

/**
 * Build a compact feature health map from checkFeatureHealth().
 * Shared factory so all envelope paths (_route_metadata) use identical shape.
 *
 * When zone2EmptyBlocks is provided, cross-references block ownership to
 * downgrade features whose Zone 2 blocks all rendered empty.
 */
export function buildFeatureHealthMap(
  zone2EmptyBlocks?: string[],
): Record<string, { enabled: boolean; healthy: boolean; reason?: string }> {
  const featureReport = checkFeatureHealth();
  const features: Record<string, { enabled: boolean; healthy: boolean; reason?: string }> = {};
  for (const check of featureReport.checks) {
    if (check.enabled) {
      features[check.name] = {
        enabled: true,
        healthy: check.healthy,
        ...(check.reason ? { reason: check.reason } : {}),
      };
    }
  }

  // Cross-reference Zone 2 empty blocks with feature ownership
  if (zone2EmptyBlocks && zone2EmptyBlocks.length > 0) {
    const emptySet = new Set(zone2EmptyBlocks);

    // Group empty blocks by feature.
    // SYNC: Must match owner field in src/orchestrator/prompt-zones/zone2-blocks.ts registry.
    const BLOCK_OWNERSHIP: Record<string, string> = {
      bil_context: 'BIL',
      bil_hint: 'BIL',
      primary_gap_hint: 'BIL',
      analysis_state: 'zone2_registry',
      analysis_hint: 'zone2_registry',
      event_log: 'zone2_registry',
      stage_context: 'zone2_registry',
      graph_state: 'zone2_registry',
      conversation_summary: 'zone2_registry',
      recent_turns: 'zone2_registry',
    };

    // Count total and empty blocks per feature
    const featureBlockCounts = new Map<string, { total: number; empty: number }>();
    for (const [blockName, featureName] of Object.entries(BLOCK_OWNERSHIP)) {
      const entry = featureBlockCounts.get(featureName) ?? { total: 0, empty: 0 };
      entry.total++;
      if (emptySet.has(blockName)) entry.empty++;
      featureBlockCounts.set(featureName, entry);
    }

    // Downgrade features where ALL blocks rendered empty
    for (const [featureName, counts] of featureBlockCounts) {
      if (counts.empty > 0 && counts.empty === counts.total && features[featureName]) {
        features[featureName].healthy = false;
        features[featureName].reason = 'all zone2 blocks rendered empty';
      }
    }
  }

  return features;
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
  const editGraphCarryForwardInvocation = toolName === 'edit_graph'
    ? {
        name: 'edit_graph',
        input: {
          ...(llmResult.tool_invocations.find((invocation) => invocation.name === 'edit_graph')?.input ?? {
            edit_description: toolResult.pending_clarification?.original_edit_request
              ?? toolResult.pending_proposal?.original_edit_request
              ?? '',
          }),
          ...(toolResult.pending_clarification && { pending_clarification: toolResult.pending_clarification }),
          ...(toolResult.pending_proposal && { pending_proposal: toolResult.pending_proposal }),
        },
      }
    : null;

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

  // Resolve DSK hash once — used in both lineage and _route_metadata.
  const resolvedDskHash = resolveDskHash(enrichedContext.dsk.version_hash);

  const envelope: OrchestratorResponseEnvelopeV2 = {
    turn_id: enrichedContext.turn_id,
    assistant_text: assistantText,
    ...(
      editGraphCarryForwardInvocation
      && (toolResult.pending_clarification || toolResult.pending_proposal)
      && { assistant_tool_calls: [editGraphCarryForwardInvocation] }
    ),
    blocks: toolResult.blocks,
    suggested_actions: suggestedActions,
    ...(toolResult.proposed_changes && { proposed_changes: toolResult.proposed_changes }),
    guidance_items: toolResult.guidance_items,

    lineage: {
      context_hash: contextHash,
      dsk_version_hash: resolvedDskHash,
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

  if (toolResult.applied_changes) {
    envelope.applied_changes = toolResult.applied_changes;
  }

  if (toolResult.deterministic_answer_tier !== undefined) {
    envelope.deterministic_answer_tier = toolResult.deterministic_answer_tier;
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

  // Build per-turn feature activation status (always present, independent of route metadata).
  // Cross-reference Zone 2 empty blocks to detect dark features at runtime.
  const features = buildFeatureHealthMap(enrichedContext.zone2_empty_blocks);

  // Build _route_metadata with extended observability fields.
  // Base metadata comes from tool handler or LLM routing; we extend with context.
  // resolved_model/resolved_provider are set by phase3 on llmResult.route_metadata and by
  // LLM-backed tool handlers on their own metadata. Non-LLM tools (run_analysis, draft_graph,
  // generate_brief, research_topic) never touch an adapter, so they don't set these fields.
  // We always preserve them from whichever source has them: tool metadata takes priority for
  // all fields, but falls back to llmResult model fields if the tool didn't set them.
  const toolMeta = toolResult.route_metadata;
  const llmMeta = llmResult.route_metadata;
  const baseMetadata = toolMeta ?? llmMeta;
  if (baseMetadata) {
    // Preserve model observability fields from llmResult when tool metadata omits them.
    const resolvedModel = toolMeta?.resolved_model ?? llmMeta?.resolved_model ?? null;
    const resolvedProvider = toolMeta?.resolved_provider ?? llmMeta?.resolved_provider ?? null;
    // Compute tool_permitted from stage policy (same logic as pipeline telemetry)
    const attemptedTool = toolName;
    const toolPermitted = attemptedTool
      ? isToolAllowedAtStage(attemptedTool, enrichedContext.stage_indicator.stage, enrichedContext.user_message).allowed
      : true;

    // Infer response mode from LLM diagnostics
    const declaredMode = extractDeclaredMode(llmResult.diagnostics);
    const inferredMode = llmResult.tool_invocations.length > 0
      ? 'ACT'
      : inferResponseMode({ assistant_text: llmResult.assistant_text, tool_invocations: llmResult.tool_invocations } as never);
    const responseMode = declaredMode !== 'unknown' ? declaredMode : inferredMode;

    // Infer turn type from enriched context
    const turnTypeBody: Record<string, unknown> = {
      message: enrichedContext.user_message ?? '',
      system_event: enrichedContext.system_event,
      context: { conversational_state: enrichedContext.conversational_state },
    };

    envelope._route_metadata = {
      ...baseMetadata,
      tool_selected: attemptedTool ?? null,
      tool_permitted: toolPermitted,
      response_mode: responseMode,
      turn_type: inferTurnType(turnTypeBody),
      has_graph: enrichedContext.graph !== null,
      has_analysis: enrichedContext.analysis !== null,
      contract_version: TURN_CONTRACT_VERSION,
      resolved_model: resolvedModel,
      resolved_provider: resolvedProvider,
      dsk_version_hash: resolvedDskHash,
      features,
    };
  } else {
    // No route metadata from tool or LLM — still attach feature diagnostics
    envelope._route_metadata = { features, dsk_version_hash: resolvedDskHash } as typeof envelope._route_metadata;
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
  // P0-3 Task 4: Error envelopes include _route_metadata with feature health
  const features = buildFeatureHealthMap();

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

    _route_metadata: {
      outcome: 'default_llm' as const,
      reasoning: `pipeline_error:${errorCode}`,
      dsk_version_hash: resolveDskHash(),
      features,
    },

    error: {
      code: errorCode,
      message: errorMessage,
    },
  };
}
