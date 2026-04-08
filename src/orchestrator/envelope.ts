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
  OrchestratorDebugPayload,
  TypedConversationBlock,
  SuggestedAction,
  ResponseLineage,
  TurnPlan,
  OrchestratorError,
  ConversationContext,
  V2RunResponseEnvelope,
  DecisionStage,
  GraphPatchBlockData,
} from "./types.js";
import { hashContext } from "./context/hash.js";
import { buildModelReceipt } from "./pipeline/phase5-validation/model-receipt.js";
import { validateV1EnvelopeContract } from "./validation/response-contract.js";
import { AnalysisReadyPayload } from "../schemas/analysis-ready.js";
import { log } from "../utils/telemetry.js";

// ============================================================================
// Envelope Builder
// ============================================================================

export interface EnvelopeInput {
  /** Turn ID (generated or from idempotency) */
  turnId?: string;
  /** Assistant text from LLM response */
  assistantText: string | null;
  /** Blocks produced by tool handlers */
  blocks: TypedConversationBlock[];
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
  /** Read-only debug summary inputs from the current turn flow. */
  debugSummary?: Partial<OrchestratorDebugPayload["turn_summary"]>;
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

  // Validate (do NOT recompute) analysis_ready on graph_patch blocks.
  // Action handlers are the authoritative producers; the envelope only warns
  // when a payload is malformed or missing. Never overwrite handler output.
  validateAnalysisReadyOnBlocks(envelope.blocks);

  // Model receipt — server-constructed metadata for the UI after draft_graph
  const lastPatchBlock = [...envelope.blocks].reverse().find((b) => b.block_type === 'graph_patch');
  const lastPatchData = lastPatchBlock?.data as GraphPatchBlockData | undefined;
  const modelReceipt = buildModelReceipt(envelope.blocks, lastPatchData?.analysis_ready);
  if (modelReceipt) {
    envelope.model_receipt = modelReceipt;
  }

  // Response contract validation — drop malformed chips/blocks, inject fallback if needed
  const contractResult = validateV1EnvelopeContract(envelope, input.computedStage);

  if (input.includeDebug) {
    envelope.debug = buildDebugPayload(envelope, input, contractResult.violations.map((violation) => violation.code));
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
  contextHashOverride?: string,
  graphHash?: string,
): ResponseLineage {
  const contextHash = contextHashOverride ?? hashContext(context);

  const lineage: ResponseLineage = {
    context_hash: contextHash,
  };

  if (analysisResponse) {
    // Top-level response_hash preferred over meta.response_hash
    lineage.response_hash = analysisResponse.response_hash ?? analysisResponse.meta?.response_hash;

    // seed_used arrives as string from PLoT — parse as Number
    lineage.seed_used = Number(analysisResponse.meta?.seed_used);

    lineage.n_samples = analysisResponse.meta?.n_samples;
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

function buildDebugPayload(
  envelope: OrchestratorResponseEnvelope,
  input: EnvelopeInput,
  contractViolationCodes: string[],
): OrchestratorDebugPayload {
  const trimmedAssistantText = envelope.assistant_text?.trim() ?? "";
  const blockCountByType = envelope.blocks.reduce<Record<string, number>>((counts, block) => {
    counts[block.block_type] = (counts[block.block_type] ?? 0) + 1;
    return counts;
  }, {});
  const fallbackInjected = contractViolationCodes.includes("empty_response_fallback");

  return {
    response_summary: {
      assistant_text_present: trimmedAssistantText.length > 0,
      assistant_text_length: envelope.assistant_text?.length ?? 0,
      block_count_by_type: blockCountByType,
      suggested_action_count: envelope.suggested_actions?.length ?? 0,
      error_present: envelope.error !== undefined,
    },
    turn_summary: {
      stage: input.debugSummary?.stage ?? null,
      response_mode_declared: input.debugSummary?.response_mode_declared ?? null,
      response_mode_inferred: input.debugSummary?.response_mode_inferred ?? null,
      tool_selected: input.debugSummary?.tool_selected ?? null,
      tool_permitted: input.debugSummary?.tool_permitted ?? null,
    },
    fallback_summary: {
      fallback_injected: fallbackInjected,
      fallback_reason: fallbackInjected ? "empty_response_fallback" : null,
    },
    contract_summary: {
      contract_violations_count: contractViolationCodes.length,
      contract_violation_codes: contractViolationCodes,
    },
  };
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
// analysis_ready Validation (non-mutating)
// ============================================================================

/**
 * Validates but does not recompute analysis_ready on graph_patch blocks.
 *
 * The action handler (draft_graph, add_option, edit_graph, …) is the
 * authoritative producer of analysis_ready. This validator warns on malformed
 * or missing payloads but never overwrites handler output. The previous
 * recompute path discarded handler-flattened intervention values when the
 * post-patch graph nodes did not carry intervention bundles, silently
 * regressing every option to needs_encoding with empty interventions.
 *
 * See: docs/intervention-lifecycle-and-health-audit-2026-04-08.md §6.
 */
function validateAnalysisReadyOnBlocks(blocks: TypedConversationBlock[]): void {
  for (const block of blocks) {
    if (block.block_type !== 'graph_patch') continue;
    const data = block.data as GraphPatchBlockData;

    // Patches that aren't fresh proposals don't carry analysis_ready by design:
    // - 'rejected' / 'dismissed': proposal failed or user dismissed; nothing to check.
    // - 'accepted': post-acceptance confirmation block from system-event-router;
    //   the UI already has the canonical analysis_ready from the prior turn.
    // analysis_ready is expected on freshly-proposed patches from action handlers.
    if (data.status !== 'proposed') continue;

    if (data.analysis_ready == null) {
      log.warn(
        { block_type: 'graph_patch', patch_type: data.patch_type, status: data.status },
        'graph_patch block has no analysis_ready — handler should provide one',
      );
      continue;
    }

    // Re-map outward-contract option_id → schema id for validation only.
    // (See draft-graph.ts:535-543 and add-option.ts:208-216 for the same pattern.)
    const forValidation = {
      ...data.analysis_ready,
      options: data.analysis_ready.options.map((o) => ({
        id: (o as { option_id?: string; id?: string }).option_id
          ?? (o as { id?: string }).id,
        label: o.label,
        status: o.status,
        interventions: o.interventions,
      })),
    };

    const parseResult = AnalysisReadyPayload.safeParse(forValidation);
    if (!parseResult.success) {
      log.warn(
        {
          block_type: 'graph_patch',
          patch_type: data.patch_type,
          errors_flat: parseResult.error.flatten(),
          error_paths: parseResult.error.issues.slice(0, 3).map((i) => ({
            path: i.path,
            message: i.message,
          })),
        },
        'analysis_ready on graph_patch block failed schema validation',
      );
    }
  }
}
