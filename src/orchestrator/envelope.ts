/**
 * Response Envelope Assembly
 *
 * Assembles OrchestratorResponseEnvelope from turn processing results.
 * Sets turn_id, assistant_text, blocks, suggested_actions, lineage,
 * turn_plan, stage_indicator, and optional error/analysis_response.
 */

import { randomUUID } from "node:crypto";
import type {
  OrchestratorResponseEnvelope,
  ConversationBlock,
  SuggestedAction,
  ResponseLineage,
  TurnPlan,
  OrchestratorError,
  ConversationContext,
  V2RunResponseEnvelope,
  DecisionStage,
} from "./types.js";
import { hashContext } from "./context/hash.js";

// ============================================================================
// Envelope Builder
// ============================================================================

export interface EnvelopeInput {
  /** Turn ID (generated or from idempotency) */
  turnId?: string;
  /** Assistant text from LLM response */
  assistantText: string | null;
  /** Blocks produced by tool handlers */
  blocks: ConversationBlock[];
  /** Suggested follow-up actions */
  suggestedActions?: SuggestedAction[];
  /** Full PLoT analysis response (for UI Results Panel) */
  analysisResponse?: V2RunResponseEnvelope;
  /** Conversation context (for lineage hashing) */
  context: ConversationContext;
  /** Turn plan metadata */
  turnPlan?: TurnPlan;
  /** Error, if the turn failed */
  error?: OrchestratorError;
}

/**
 * Assemble a complete OrchestratorResponseEnvelope.
 */
export function assembleEnvelope(input: EnvelopeInput): OrchestratorResponseEnvelope {
  const turnId = input.turnId ?? randomUUID();

  const lineage = buildLineage(input.context, input.analysisResponse);
  const stage = resolveStage(input.context);

  const envelope: OrchestratorResponseEnvelope = {
    turn_id: turnId,
    assistant_text: input.assistantText,
    blocks: input.blocks,
    lineage,
  };

  if (input.suggestedActions && input.suggestedActions.length > 0) {
    envelope.suggested_actions = input.suggestedActions;
  }

  if (input.analysisResponse) {
    envelope.analysis_response = input.analysisResponse;
  }

  if (input.turnPlan) {
    envelope.turn_plan = input.turnPlan;
  }

  if (stage) {
    envelope.stage_indicator = stage;
    envelope.stage_label = STAGE_LABELS[stage] ?? stage;
  }

  if (input.error) {
    envelope.error = input.error;
  }

  return envelope;
}

// ============================================================================
// Lineage
// ============================================================================

/**
 * Build response lineage from context and optional analysis response.
 *
 * - context_hash: SHA-256 of serialised context (32-char hex)
 * - response_hash: from PLoT response (top-level first, then meta)
 * - seed_used: from PLoT meta (parsed as Number)
 * - n_samples: from PLoT meta
 */
function buildLineage(
  context: ConversationContext,
  analysisResponse?: V2RunResponseEnvelope,
): ResponseLineage {
  const contextHash = hashContext(context);

  const lineage: ResponseLineage = {
    context_hash: contextHash,
  };

  if (analysisResponse) {
    // Top-level response_hash preferred over meta.response_hash
    lineage.response_hash = analysisResponse.response_hash ?? analysisResponse.meta.response_hash;

    // seed_used arrives as string from PLoT — parse as Number
    lineage.seed_used = Number(analysisResponse.meta.seed_used);

    lineage.n_samples = analysisResponse.meta.n_samples;
  }

  return lineage;
}

// Context hashing uses the canonical deterministic implementation from context/hash.ts
// which applies ordering rules for options, constraints, and selected elements.

// ============================================================================
// Stage Indicator
// ============================================================================

const STAGE_LABELS: Record<DecisionStage, string> = {
  frame: 'Framing the decision',
  ideate: 'Exploring options',
  evaluate: 'Evaluating options',
  decide: 'Making the decision',
  optimise: 'Optimising the plan',
};

function resolveStage(context: ConversationContext): DecisionStage | undefined {
  if (!context.framing?.stage) {
    return undefined;
  }

  return context.framing.stage;
}

// ============================================================================
// Turn Plan Builder
// ============================================================================

/**
 * Create a TurnPlan for the envelope.
 */
export function buildTurnPlan(
  selectedTool: string | null,
  routing: 'deterministic' | 'llm',
  longRunning: boolean,
  toolLatencyMs?: number,
): TurnPlan {
  const plan: TurnPlan = {
    selected_tool: selectedTool,
    routing,
    long_running: longRunning,
  };

  if (toolLatencyMs !== undefined) {
    plan.tool_latency_ms = toolLatencyMs;
  }

  return plan;
}
