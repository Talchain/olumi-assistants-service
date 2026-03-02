/**
 * V2 Pipeline Orchestrator
 *
 * Thin orchestration layer: Phase 1 → 2 → 3 → 4 → 5.
 * Receives validated request, returns V2 envelope.
 *
 * ~50-80 lines. No shared mutable state. No side effects except
 * Phase 4 (tool execution) and Phase 5 (persistence stubs).
 */

import { log } from "../../utils/telemetry.js";
import type { OrchestratorTurnRequest } from "../types.js";
import type { PipelineDeps, OrchestratorResponseEnvelopeV2 } from "./types.js";
import { phase1Enrich } from "./phase1-enrichment/index.js";
import { phase2Route } from "./phase2-specialists/index.js";
import { phase3Generate } from "./phase3-llm/index.js";
import { phase4Execute } from "./phase4-tools/index.js";
import { phase5Validate } from "./phase5-validation/index.js";
import { buildErrorEnvelope, computeContextHash } from "./phase5-validation/envelope-assembler.js";

/**
 * Execute the five-phase pipeline.
 *
 * Each phase receives explicitly typed inputs and returns explicitly typed outputs.
 * No shared mutable state between phases.
 *
 * Error handling: if any phase throws, the pipeline catches and returns an error
 * envelope with all new fields populated with defaults.
 */
// Phase inputs are treated as immutable — do not mutate enrichedContext or other phase outputs.
// Each phase receives typed inputs and returns new typed outputs. No shared mutable state.
export async function executePipeline(
  request: OrchestratorTurnRequest,
  requestId: string,
  deps: PipelineDeps,
): Promise<OrchestratorResponseEnvelopeV2> {
  let enrichedContext;

  try {
    // Phase 1: Enrichment (deterministic, <50ms)
    enrichedContext = phase1Enrich(
      request.message,
      request.context,
      request.scenario_id,
      request.system_event,
    );

    // Early exit: feedback_submitted requires no LLM response (system prompt: "Do not respond.")
    if (request.system_event?.type === 'feedback_submitted') {
      log.info(
        { request_id: requestId, turn_id: enrichedContext.turn_id },
        'V2 pipeline: feedback_submitted — returning empty envelope',
      );
      return buildFeedbackAckEnvelope(enrichedContext);
    }

    // Phase 2: Specialist Routing (stub)
    const specialistResult = phase2Route();

    // Phase 3: LLM Call (or deterministic routing)
    const llmResult = await phase3Generate(
      enrichedContext,
      specialistResult,
      deps.llmClient,
      requestId,
      request.message,
    );

    // Phase 4: Tool Execution
    const toolResult = await phase4Execute(
      llmResult,
      enrichedContext,
      deps.toolDispatcher,
      requestId,
    );

    // Phase 5: Validation + Envelope Assembly
    const envelope = phase5Validate(
      llmResult,
      toolResult,
      enrichedContext,
      specialistResult,
    );

    return envelope;
  } catch (error) {
    const turnId = enrichedContext?.turn_id ?? 'pipeline-error';
    const message = error instanceof Error ? error.message : String(error);

    log.error(
      { error: message, turn_id: turnId, request_id: requestId },
      "V2 pipeline error",
    );

    return buildErrorEnvelope(
      turnId,
      'PIPELINE_ERROR',
      'Something went wrong.',
      enrichedContext,
    );
  }
}

// ============================================================================
// Helpers
// ============================================================================

import type { EnrichedContext } from "./types.js";

/**
 * Build a silent acknowledgement envelope for feedback_submitted events.
 *
 * System prompt contract: "feedback_submitted → Do not respond."
 * Returns a minimal envelope: null assistant_text, empty blocks, empty actions.
 * No LLM call is made.
 */
function buildFeedbackAckEnvelope(enrichedContext: EnrichedContext): OrchestratorResponseEnvelopeV2 {
  return {
    turn_id: enrichedContext.turn_id,
    assistant_text: null,
    blocks: [],
    suggested_actions: [],

    lineage: {
      context_hash: computeContextHash(enrichedContext),
      dsk_version_hash: enrichedContext.dsk.version_hash,
    },

    stage_indicator: {
      stage: enrichedContext.stage_indicator.stage,
      confidence: enrichedContext.stage_indicator.confidence,
      source: enrichedContext.stage_indicator.source,
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
      intent_classification: enrichedContext.intent_classification,
      specialist_contributions: [],
      specialist_disagreement: null,
    },

    turn_plan: {
      selected_tool: null,
      routing: 'deterministic',
      long_running: false,
    },
  };
}
