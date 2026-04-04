/**
 * Deterministic System Event Handler
 *
 * Defense-in-depth handler for system events that reach the deterministic
 * pipeline. Upstream routing (pipeline-stream.ts, turn-handler.ts) normally
 * intercepts system events before they reach this pipeline, but if one
 * leaks through, this handler produces a valid response without an LLM call.
 *
 * Design:
 * - System events with a user message get brief deterministic acknowledgement
 * - System events without a user message get a silent response
 * - Unknown event types get a silent response with a warning log
 * - Never calls the LLM
 */

import type { OrchestratorTurnRequest, SystemEvent } from "../types.js";
import type { DeterministicPipelineResult } from "./types.js";
import { log } from "../../utils/telemetry.js";

// ============================================================================
// Acknowledgement Templates
// ============================================================================

/**
 * Acknowledgement templates by system event type.
 *
 * Graph-mutation events (patch_accepted, patch_dismissed, direct_graph_edit)
 * return null — the UI graph patch block already confirms the operation,
 * so emitting text would duplicate the confirmation as a message bubble.
 */
const TEMPLATES: Record<string, string | null> = {
  patch_accepted: null,     // Graph patch block shows "Changes applied"
  patch_dismissed: null,     // Graph patch block shows dismissal
  direct_graph_edit: null,   // Graph patch block shows mutation result
  direct_analysis_run: 'Analysis is running. You\u2019ll see the results in the analysis panel when it completes.',
  feedback_submitted: null,  // Always silent
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Handle a system event deterministically, returning a valid pipeline result.
 *
 * Returns null if the request has no system_event (caller should continue
 * normal pipeline processing).
 */
export function handleSystemEvent(
  turnRequest: OrchestratorTurnRequest,
  turnId: string,
  requestId: string,
): DeterministicPipelineResult | null {
  const event = turnRequest.system_event;
  if (!event) return null;

  const eventType = event.event_type;
  const hasUserMessage = !!turnRequest.message && turnRequest.message.trim().length > 0;
  const template = TEMPLATES[eventType];
  const isKnown = template !== undefined;

  if (!isKnown) {
    log.warn({
      request_id: requestId,
      event_type: eventType,
    }, 'deterministic.system_event.unknown_type');
  }

  // Events without a user message → always silent (the UI already shows the
  // visual update; adding text here would duplicate it or pollute history).
  // Events with a user message → brief acknowledgement from template.
  // feedback_submitted (empty template), unknown events → always silent.
  const assistantText = (hasUserMessage && isKnown && template) ? template : null;
  const isSilent = assistantText === null;

  log.info({
    request_id: requestId,
    event_type: eventType,
    has_user_message: hasUserMessage,
    response_type: isSilent ? 'silent' : 'acknowledgement',
  }, 'deterministic.system_event_handled');

  return {
    envelope: {
      turn_id: turnId,
      assistant_text: assistantText,
      blocks: [],
      suggested_actions: undefined,
      analysis_response: undefined,
      lineage: { context_hash: '' },
      turn_plan: {
        selected_tool: null,
        routing: 'deterministic',
        long_running: false,
        executed_tools: [],
        deferred_tools: [],
      },
      stage_indicator: turnRequest.context?.framing?.stage ?? 'frame',
      response_version: 2,
    },
    httpStatus: 200,
    _quality: {
      parse_method: 'native',
      banned_terms_found: [],
      ineligible_actions_stripped: [],
      insights_count: 0,
      actions_count: 0,
      text_word_count: assistantText ? assistantText.split(/\s+/).filter(Boolean).length : 0,
      has_science_concept: false,
      disambiguation_triggered: false,
      empty_before_normalisation: !assistantText,
      llm_action_count_pre_filter: 0,
      context_fallback_used: false,
      prompt_char_count: 0,
    },
  };
}
