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
  GraphPatchBlockData,
  GraphV3T,
} from "./types.js";
import { hashContext } from "./context/hash.js";
import { computeStructuralReadiness } from "./tools/analysis-ready-helper.js";
import { buildModelReceipt } from "./pipeline/phase5-validation/model-receipt.js";
import { validateV1EnvelopeContract } from "./validation/response-contract.js";

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
  /** Diagnostics content from LLM <diagnostics> tag */
  diagnostics?: string | null;
  /** Parse warnings from XML envelope extraction */
  parseWarnings?: string[];
  /** Include debug fields (diagnostics, parse_warnings) in the envelope */
  includeDebug?: boolean;
  /** Override context_hash (e.g. from Context Fabric). Falls back to hashContext() if not provided. */
  contextHash?: string;
  /** PLoT graph hash from validate-patch (patch_accepted only). */
  graphHash?: string;
  /** DSK coaching items — omitted when disabled or both arrays empty. */
  dskCoaching?: import("../schemas/dsk-coaching.js").DskCoachingItems;
  /** Authoritative computed stage (from inferStage). Overrides framing.stage if provided. */
  computedStage?: DecisionStage;
}

/**
 * Assemble a complete OrchestratorResponseEnvelope.
 */
export function assembleEnvelope(input: EnvelopeInput): OrchestratorResponseEnvelope {
  const turnId = input.turnId ?? randomUUID();

  const lineage = buildLineage(input.context, input.analysisResponse, input.contextHash, input.graphHash);
  const stage = input.computedStage ?? resolveStage(input.context);

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

  // Debug-only fields: diagnostics and parse_warnings
  if (input.includeDebug) {
    if (input.diagnostics) {
      envelope.diagnostics = input.diagnostics;
    }
    if (input.parseWarnings && input.parseWarnings.length > 0) {
      envelope.parse_warnings = input.parseWarnings;
    }
  }

  // DSK coaching — omit entirely when undefined (flags-off parity / omit-empty)
  if (input.dskCoaching) {
    envelope.dsk_coaching = input.dskCoaching;
  }

  // Recompute analysis_ready on graph_patch blocks from the graph being returned.
  // This is the canonical recompute — avoids stale/pass-through values.
  recomputeAnalysisReady(envelope.blocks, input.context);

  // Model receipt — server-constructed metadata for the UI after draft_graph
  const lastPatchBlock = [...envelope.blocks].reverse().find((b) => b.block_type === 'graph_patch');
  const lastPatchData = lastPatchBlock?.data as GraphPatchBlockData | undefined;
  const modelReceipt = buildModelReceipt(envelope.blocks, lastPatchData?.analysis_ready);
  if (modelReceipt) {
    envelope.model_receipt = modelReceipt;
  }

  // Response contract validation — drop malformed chips/blocks, inject fallback if needed
  validateV1EnvelopeContract(envelope, input.computedStage);

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
  contextHashOverride?: string,
  graphHash?: string,
): ResponseLineage {
  const contextHash = contextHashOverride ?? hashContext(context);

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

  if (graphHash) {
    lineage.graph_hash = graphHash;
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

// ============================================================================
// analysis_ready Recomputation
// ============================================================================

/**
 * Recompute analysis_ready on graph_patch blocks from the post-patch graph.
 *
 * Canonical recompute at envelope assembly time — the graph being returned
 * to the user is the single source of truth. Prefers applied_graph (post-PLoT)
 * over the input context graph (pre-turn).
 *
 * Mutates blocks in place (they are owned by this envelope).
 */
function recomputeAnalysisReady(
  blocks: ConversationBlock[],
  context: ConversationContext,
): void {
  for (const block of blocks) {
    if (block.block_type !== 'graph_patch') continue;
    const data = block.data as GraphPatchBlockData;

    // Resolve the graph to compute readiness from:
    // 1. applied_graph on the block (post-PLoT canonical state)
    // 2. context.graph (pre-turn state, for drafts that haven't been through PLoT yet)
    const graph: GraphV3T | null = data.applied_graph ?? context.graph ?? null;
    if (!graph) continue;

    const readiness = computeStructuralReadiness(graph);
    if (readiness) {
      data.analysis_ready = readiness;
    }
  }
}
