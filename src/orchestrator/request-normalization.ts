/**
 * Shared request normalization helpers used by both the streaming and
 * non-streaming orchestrator routes.
 *
 * Extracted to guarantee parity and prevent drift between routes.
 */

import { log } from "../utils/telemetry.js";
import { isProduction } from "../config/index.js";
import { inferTurnType } from "./turn-contract.js";
import type { SystemEvent, ConversationContext } from "./types.js";

/**
 * Normalise context from parsed request data.
 * If the `context` field is absent, construct from flat UI fields.
 *
 * Returns ConversationContext — the Zod output shape is structurally compatible
 * because TurnRequestSchema uses .passthrough() on all nested objects.
 */
export function normalizeContext(parsed: {
  context?: unknown;
  graph_state?: unknown;
  analysis_state?: unknown;
  conversation_history?: unknown[];
  scenario_id: string;
}): ConversationContext {
  return (parsed.context ?? {
    graph: parsed.graph_state ?? null,
    analysis_response: parsed.analysis_state ?? null,
    framing: null,
    messages: (parsed.conversation_history ?? []),
    scenario_id: parsed.scenario_id,
    analysis_inputs: null,
  }) as ConversationContext;
}

/**
 * Normalise system event: if only block_id is provided (no patch_id),
 * copy it to patch_id for backward compatibility.
 */
export function normalizeSystemEvent(event: SystemEvent | undefined): SystemEvent | undefined {
  if (
    event &&
    (event.event_type === 'patch_accepted' || event.event_type === 'patch_dismissed')
  ) {
    const det = event.details as { patch_id?: string; block_id?: string };
    // Precedence: if both present, patch_id wins, block_id is ignored.
    if (!det.patch_id && det.block_id) {
      return {
        ...event,
        details: { ...det, patch_id: det.block_id },
      } as SystemEvent;
    }
  }
  return event;
}

/**
 * Normalise generate-model flag: accept both `generate_model` and `explicit_generate`
 * from the request. The UI historically sends `explicit_generate` while the internal
 * pipeline uses `generate_model`. Either flag being true activates the override.
 */
export function normalizeGenerateModel(parsed: {
  generate_model?: boolean;
  explicit_generate?: boolean;
}): boolean {
  return parsed.generate_model === true || parsed.explicit_generate === true;
}

/**
 * Boundary warning: analysis_state present on non-analysis turns.
 * Non-production diagnostic only.
 */
export function warnAnalysisStateOnNonAnalysisTurn(
  data: { analysis_state?: unknown },
  requestId: string,
): void {
  if (!isProduction() && data.analysis_state) {
    const turnType = inferTurnType(data as unknown as Record<string, unknown>);
    if (turnType === 'conversation' || turnType === 'explicit_generate') {
      log.warn(
        { request_id: requestId, turn_type: turnType },
        `[BOUNDARY WARNING] analysis_state present on ${turnType} turn — likely client-side request construction issue`,
      );
    }
  }
}

/**
 * Log extra fields in direct_analysis_run details.
 * Schema expects empty object; passthrough preserves them instead of 400ing,
 * but we surface them for observability.
 */
export function warnDirectAnalysisRunDetails(
  systemEvent: SystemEvent | undefined,
  requestId: string,
): void {
  if (systemEvent?.event_type === 'direct_analysis_run') {
    const detailKeys = Object.keys((systemEvent as Record<string, unknown>).details ?? {});
    if (detailKeys.length > 0) {
      log.warn(
        { request_id: requestId, extra_keys: detailKeys },
        'direct_analysis_run: details contains extra fields beyond empty-object contract',
      );
    }
  }
}
