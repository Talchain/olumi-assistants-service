/**
 * V5 recovery chips — egress safety layer for failure responses.
 *
 * Background: cross-service audit §6.1 (P0) flagged that every internal
 * 500-class failure routed through `buildFailureResponse` previously emitted
 * `suggested_actions: []`. The user saw a wire-code message and nothing to
 * click. Per V5 architecture spec §7, every failure path must include a chip.
 *
 * This module supplies the chip. It is a pure function — no side effects, no
 * telemetry inside the builder. The caller (failure-response.ts) calls
 * `buildRecoveryChip` to get the chip array and friendly preface, then calls
 * `emitRecoveryChipServed` separately to record telemetry. Splitting the two
 * keeps the builder trivially testable.
 *
 * Chip styles:
 *  - Prompt-style chips OMIT `action_type`. Clicking them resubmits the
 *    `message` field as a fresh user turn through the normal ingress path.
 *    No handler is invoked from the click directly. No recursion risk.
 *  - Action-style chips set `action_type: 'run_analysis'`. Clicking
 *    dispatches a chip_click event that routes straight to the handler.
 *
 * Stale/ready guard: PLoT failures only emit a "Run analysis again" chip
 * when the graph is structurally ready. If not ready, we fall back to a
 * prompt-style "Review model setup" chip so the user is steered to the
 * configuration step rather than triggering another doomed run.
 *
 * User-facing copy rules (verified by FORBIDDEN_USER_TEXT_TERMS regex in
 * tests): no "error", "failed", "broken", or internal terminology.
 * Sentence case. No em dashes. No exclamation marks.
 */

import type { Action } from '@talchain/schemas/boundary';

import { emit, TelemetryEvents } from '../../utils/telemetry.js';

import type { InternalFailure } from '../types.js';
import { FORBIDDEN_USER_TEXT_TERMS } from './recovery-chips-forbidden-terms.js';
import type { SuggestedAction } from './types.js';

export { FORBIDDEN_USER_TEXT_TERMS };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Recovery vocabulary used throughout this module. Kept distinct from the
 * existing `InternalFailure` enum so chip semantics are decoupled from the
 * internal classification (callers that have richer context — e.g. handler
 * dispatch — can pass `PLOT_HTTP_ERROR` directly without round-tripping
 * through `InternalFailure`).
 */
export type RecoveryFailureType =
  | 'LLM_TIMEOUT'
  | 'LLM_UNAVAILABLE'
  | 'PLOT_HTTP_ERROR'
  | 'PLOT_TIMEOUT'
  | 'HANDLER_ERROR'
  | 'ZOD_REPAIR_FAILED'
  | 'DECISION_REVIEW_FAILED'
  | 'LLM_DENIAL';

export interface RecoveryChipInput {
  readonly failureType: RecoveryFailureType;
  readonly previousUserMessage: string | null | undefined;
  readonly analysisReady: boolean;
}

export interface RecoveryChipResult {
  readonly assistantText: string;
  readonly chips: readonly SuggestedAction[];
}

export interface RecoveryChipTelemetry {
  readonly failureType: RecoveryFailureType;
  readonly chips: readonly SuggestedAction[];
  readonly scenarioId: string;
  readonly turnId: string;
  readonly isRetry: boolean;
  readonly handlerId: string | null;
}

// ---------------------------------------------------------------------------
// Static fallbacks
// ---------------------------------------------------------------------------

const FALLBACK_USER_MESSAGE = 'Try that again';
const REVIEW_MODEL_SETUP_MESSAGE = 'What do I need to fix before running the analysis?';
const RUN_ANALYSIS_MESSAGE = 'Run the analysis';

// ---------------------------------------------------------------------------
// buildRecoveryChip — pure function, no side effects
// ---------------------------------------------------------------------------

export function buildRecoveryChip(input: RecoveryChipInput): RecoveryChipResult {
  const promptMessage = resolvePromptMessage(input.previousUserMessage);

  switch (input.failureType) {
    case 'LLM_TIMEOUT':
      return {
        assistantText: 'That took longer than usual.',
        chips: [retryPromptChip(promptMessage)],
      };
    case 'LLM_UNAVAILABLE':
      return {
        assistantText: "I couldn't complete that just now.",
        chips: [retryPromptChip(promptMessage)],
      };
    case 'PLOT_HTTP_ERROR':
      return {
        assistantText: "Analysis couldn't complete right now.",
        chips: [plotRecoveryChip(input.analysisReady)],
      };
    case 'PLOT_TIMEOUT':
      return {
        assistantText: 'The analysis took longer than expected.',
        chips: [plotRecoveryChip(input.analysisReady)],
      };
    case 'HANDLER_ERROR':
      return {
        assistantText: "I couldn't complete that step.",
        chips: [retryPromptChip(promptMessage)],
      };
    case 'ZOD_REPAIR_FAILED':
      return {
        assistantText: "I couldn't structure that response correctly.",
        chips: [retryPromptChip(promptMessage)],
      };
    case 'DECISION_REVIEW_FAILED':
      return {
        assistantText:
          "Analysis completed, but the detailed summary isn't available yet.",
        chips: [],
      };
    case 'LLM_DENIAL':
      return {
        assistantText: "I wasn't able to help with that. Could you rephrase?",
        chips: [retryPromptChip(promptMessage)],
      };
  }
}

// ---------------------------------------------------------------------------
// recoveryFailureTypeFromInternal — translator
// ---------------------------------------------------------------------------

/**
 * Translate the existing internal failure enum onto the recovery vocabulary.
 *
 * `cause` is an optional refinement read from the failure-response `details`
 * payload (e.g. `'schema_repair_failed'` discriminates the repair-exhausted
 * variant of `LLM_SCHEMA_VIOLATION` from generic schema parse failures).
 *
 * `PLOT_*`, `LLM_DENIAL`, and `DECISION_REVIEW_FAILED` are never produced
 * by this translator — they are values callers pass directly when they have
 * richer context (PLoT errors are caught by handler-failure-responses.ts;
 * LLM_DENIAL has no current detection path; DECISION_REVIEW_FAILED is
 * scoped to the run_analysis post-processing path).
 */
export function recoveryFailureTypeFromInternal(
  internal: InternalFailure,
  cause?: string,
): RecoveryFailureType {
  switch (internal) {
    case 'LLM_TIMEOUT':
    case 'BUDGET_EXCEEDED':
      return 'LLM_TIMEOUT';
    case 'LLM_RATE_LIMITED':
      return 'LLM_UNAVAILABLE';
    case 'LLM_SCHEMA_VIOLATION':
      return cause === 'schema_repair_failed' ? 'ZOD_REPAIR_FAILED' : 'LLM_UNAVAILABLE';
    case 'LLM_REQUEST_INVALID':
    case 'STATE_COMMIT_FAILED':
    case 'HANDLER_INVOCATION_FAILED':
    case 'HANDLER_RESULT_INVALID':
    case 'UNHANDLED':
    case 'UNSUPPORTED_ACTION':
      return 'HANDLER_ERROR';
  }
}

// ---------------------------------------------------------------------------
// emitRecoveryChipServed — telemetry emitter, separate from the builder
// ---------------------------------------------------------------------------

export function emitRecoveryChipServed(t: RecoveryChipTelemetry): void {
  emit(TelemetryEvents.V5RecoveryChipServed, {
    failure_type: t.failureType,
    chip_labels: t.chips.map((c) => c.label),
    scenario_id: t.scenarioId,
    turn_id: t.turnId,
    is_retry: t.isRetry,
    handler_id: t.handlerId,
  });
}

// ---------------------------------------------------------------------------
// Internal chip builders (mirror the chip-generator.ts pattern)
// ---------------------------------------------------------------------------

function chipId(scope: 'action' | 'prompt', discriminator: string): string {
  return `chip_${scope}_${discriminator}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

function retryPromptChip(message: string): SuggestedAction {
  return {
    id: chipId('prompt', 'retry'),
    label: 'Try again',
    message,
  };
}

function plotRecoveryChip(analysisReady: boolean): SuggestedAction {
  if (analysisReady) {
    const action: Action = {
      id: chipId('action', 'run_analysis_retry'),
      label: 'Run analysis again',
      message: RUN_ANALYSIS_MESSAGE,
      action_type: 'run_analysis',
    };
    return action;
  }
  return {
    id: chipId('prompt', 'review_model_setup'),
    label: 'Review model setup',
    message: REVIEW_MODEL_SETUP_MESSAGE,
  };
}

function resolvePromptMessage(previous: string | null | undefined): string {
  if (previous == null) return FALLBACK_USER_MESSAGE;
  const trimmed = previous.trim();
  if (trimmed.length === 0) return FALLBACK_USER_MESSAGE;
  return trimmed;
}
