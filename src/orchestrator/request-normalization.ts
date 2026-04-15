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
  analysis_inputs?: unknown;
  scenario_id: string;
}): ConversationContext {
  if (parsed.context) {
    // Prefer nested context.analysis_inputs; fall back to top-level if the
    // nested one is absent (the UI sends analysis_inputs at top level for
    // run_analysis turns — see DecisionGuideAI/src/services/turn-request-builder.ts).
    //
    // Always run normaliseAnalysisInputs when analysis_inputs is present —
    // even for the nested path — so that options carrying `id` without
    // `option_id` (valid Zod shape) are canonicalised for every downstream
    // consumer. When both nested and top-level are absent, return ctx
    // directly to preserve object identity for callers that rely on it.
    const ctx = parsed.context as ConversationContext;
    const rawAnalysisInputs = ctx.analysis_inputs ?? parsed.analysis_inputs ?? null;
    if (rawAnalysisInputs == null) return ctx;
    return {
      ...ctx,
      analysis_inputs: normaliseAnalysisInputs(rawAnalysisInputs),
    };
  }
  return {
    graph: parsed.graph_state ?? null,
    analysis_response: parsed.analysis_state ?? null,
    framing: null,
    messages: (parsed.conversation_history ?? []),
    scenario_id: parsed.scenario_id,
    analysis_inputs: normaliseAnalysisInputs(parsed.analysis_inputs),
  } as ConversationContext;
}

/**
 * Normalise the UI's analysis_inputs shape: the UI emits options with `id`,
 * CEE's historical code expects `option_id`. Mirror id → option_id so every
 * downstream consumer sees the canonical key.
 */
function normaliseAnalysisInputs(raw: unknown): ConversationContext['analysis_inputs'] {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const options = Array.isArray(r.options) ? r.options : [];
  const normalisedOptions = options.map((opt) => {
    if (!opt || typeof opt !== 'object') return opt;
    const o = opt as Record<string, unknown>;
    if (typeof o.option_id === 'string') return o;
    if (typeof o.id === 'string') return { ...o, option_id: o.id };
    return o;
  });
  return { ...r, options: normalisedOptions } as ConversationContext['analysis_inputs'];
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
 * Boundary diagnostic: analysis_state present on non-analysis turns.
 * Non-production debug trace only. The UI intentionally sends analysis_state
 * on conversation turns to provide post-analysis context.
 */
export function warnAnalysisStateOnNonAnalysisTurn(
  data: { analysis_state?: unknown },
  requestId: string,
): void {
  if (!isProduction() && data.analysis_state) {
    const turnType = inferTurnType(data as unknown as Record<string, unknown>);
    if (turnType === 'conversation' || turnType === 'explicit_generate') {
      log.debug(
        { request_id: requestId, turn_type: turnType },
        `analysis_state present on ${turnType} turn`,
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
