/**
 * Envelope Assembler (V2)
 *
 * Composes the final OrchestratorResponseEnvelopeV2 with all new fields:
 * stage_indicator, progress_marker, science_ledger, observability, turn_plan, lineage.
 */

import { createHash } from "node:crypto";
import { isProduction } from "../../../config/index.js";
import { isLongRunningTool } from "../../tools/registry.js";
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
// Context Hash
// ============================================================================

/**
 * Compute SHA-256 hash of canonical JSON serialisation of EnrichedContext.
 *
 * Excluded fields (per spec):
 * - conversation_history (entire array)
 * - system_event
 * - turn_id
 *
 * Everything else is included. This makes the hash stable for the same
 * scenario state regardless of conversation length or transient per-turn data.
 */
export function computeContextHash(enrichedContext: EnrichedContext): string {
  const {
    conversation_history: _history,
    system_event: _event,
    turn_id: _turnId,
    ...hashable
  } = enrichedContext;

  const serialised = JSON.stringify(hashable, sortedReplacer);

  return createHash('sha256')
    .update(serialised)
    .digest('hex');
}

/**
 * Sorted JSON replacer for deterministic serialisation.
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce((sorted: Record<string, unknown>, k) => {
        sorted[k] = (value as Record<string, unknown>)[k];
        return sorted;
      }, {});
  }
  return value;
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

  const contextHash = computeContextHash(enrichedContext);

  // Determine tool name and build turn_plan
  const toolName = llmResult.tool_invocations.length > 0
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

  // Merge suggested actions
  const suggestedActions: SuggestedAction[] = [
    ...llmResult.suggested_actions,
  ];

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

    lineage: {
      context_hash: contextHash,
      dsk_version_hash: enrichedContext.dsk.version_hash,
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

  // Add analysis response hash to lineage if available
  if (toolResult.analysis_response) {
    const ar = toolResult.analysis_response;
    envelope.lineage.response_hash = ar.response_hash ?? ar.meta?.response_hash;
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

    lineage: {
      context_hash: enrichedContext ? computeContextHash(enrichedContext) : '',
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
